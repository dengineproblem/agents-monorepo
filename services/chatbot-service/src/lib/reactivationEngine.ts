import { supabase } from './supabase.js';
import { redis } from './redis.js';
import OpenAI from 'openai';
import { sendWhatsAppMessage } from './chatbotEngine.js';
import { FastifyInstance } from 'fastify';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

export interface LeadForReactivation {
  id: string;
  user_account_id: string;
  instance_name: string;
  contact_phone: string;
  contact_name?: string;
  funnel_stage: string;
  interest_level: string;
  business_type?: string;
  objection?: string;
  last_message?: string;
  last_bot_message_at?: string;
  reactivation_attempts: number;
  reactivation_score?: number;
}

/**
 * Выбор лидов для реанимации (топ-300 по скорингу)
 */
export async function selectLeadsForReactivation(params: {
  userAccountId: string;
  limit: number; // обычно 300
}): Promise<LeadForReactivation[]> {
  const { userAccountId, limit } = params;
  
  // Получить всех лидов, которым можно писать
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const { data: leads, error } = await supabase
    .from('dialog_analysis')
    .select('*')
    .eq('user_account_id', userAccountId)
    .eq('assigned_to_human', false) // Не в работе у менеджера
    .eq('bot_paused', false) // Бот не на паузе
    .in('funnel_stage', ['not_qualified', 'qualified', 'consultation_booked', 'new_lead'])
    .or(`last_bot_message_at.is.null,last_bot_message_at.lt.${sevenDaysAgo.toISOString()}`);
  
  if (error || !leads) {
    console.error('Error fetching leads for reactivation:', error);
    return [];
  }
  
  // Скоринг для приоритизации
  const scored = leads.map(lead => ({
    ...lead,
    reactivation_score: calculateReactivationScore(lead)
  }));
  
  // Сортировать по score + выбрать топ-N
  const top = scored
    .sort((a, b) => b.reactivation_score - a.reactivation_score)
    .slice(0, limit);
  
  return top;
}

/**
 * Расчёт скоринга для приоритизации реанимации
 */
export function calculateReactivationScore(lead: any): number {
  let score = 0;
  
  // 1. Интерес (базовый score)
  switch (lead.interest_level) {
    case 'hot':
      score += 50;
      break;
    case 'warm':
      score += 30;
      break;
    case 'cold':
      score += 10;
      break;
    default:
      score += 15;
  }
  
  // 2. Этап воронки (ближе к сделке = важнее)
  const stagePoints: Record<string, number> = {
    'new_lead': 5,
    'not_qualified': 10,
    'qualified': 30,
    'consultation_booked': 50
  };
  score += stagePoints[lead.funnel_stage] || 0;
  
  // 3. Дни без ответа (чем дольше молчит, тем ниже приоритет)
  if (lead.last_message) {
    const daysSilent = getDaysSince(new Date(lead.last_message));
    if (daysSilent <= 3) {
      score += 20; // Недавно писал
    } else if (daysSilent <= 7) {
      score += 10;
    } else if (daysSilent <= 14) {
      score += 5;
    } else {
      score -= 5; // Совсем холодный
    }
  }
  
  // 4. Количество попыток реанимации (не спамим)
  const attempts = lead.reactivation_attempts || 0;
  score -= attempts * 10;
  
  // Ограничение: не более 5 попыток реанимации
  if (attempts >= 5) {
    return 0;
  }
  
  return Math.max(0, score);
}

/**
 * Вычислить количество дней с даты
 */
function getDaysSince(date: Date): number {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/**
 * Распределить сообщения равномерно по рабочим часам
 */
export function distributeMessages(
  leads: LeadForReactivation[],
  schedule: {
    startHour: number;
    endHour: number;
    daysOfWeek: number[]; // 1-5 для Пн-Пт
  }
): Array<{ leadId: string; timestamp: number }> {
  const { startHour, endHour, daysOfWeek } = schedule;
  const workingHours = endHour - startHour; // 10 часов для 10:00-20:00
  const messagesPerHour = Math.ceil(leads.length / workingHours);
  
  const now = new Date();
  const result: Array<{ leadId: string; timestamp: number }> = [];
  
  let currentDay = getNextWorkingDay(now, daysOfWeek);
  let currentHour = startHour;
  let countInHour = 0;
  
  for (const lead of leads) {
    const timestamp = new Date(currentDay);
    timestamp.setHours(currentHour);
    timestamp.setMinutes(Math.floor(Math.random() * 60)); // Случайная минута
    timestamp.setSeconds(0);
    
    result.push({ leadId: lead.id, timestamp: timestamp.getTime() });
    
    countInHour++;
    if (countInHour >= messagesPerHour) {
      currentHour++;
      countInHour = 0;
      
      if (currentHour >= endHour) {
        currentDay = getNextWorkingDay(currentDay, daysOfWeek);
        currentHour = startHour;
      }
    }
  }
  
  return result;
}

/**
 * Получить следующий рабочий день
 */
function getNextWorkingDay(from: Date, daysOfWeek: number[]): Date {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  
  // Если текущий день не рабочий, найти следующий рабочий
  while (!daysOfWeek.includes(next.getDay())) {
    next.setDate(next.getDate() + 1);
  }
  
  return next;
}

/**
 * Добавить лидов в очередь реанимации в Redis
 */
export async function scheduleReactivationMessages(
  schedule: Array<{ leadId: string; timestamp: number }>
): Promise<void> {
  const pipeline = redis.pipeline();
  
  for (const item of schedule) {
    // Использовать sorted set с timestamp как score
    pipeline.zadd(
      'reactivation_queue',
      item.timestamp,
      JSON.stringify({ leadId: item.leadId, scheduledAt: item.timestamp })
    );
  }
  
  await pipeline.exec();
  
  console.log(`Scheduled ${schedule.length} reactivation messages`);
}

/**
 * Генерация персонализированного сообщения для реанимации
 */
export async function generateReactivationMessage(
  leadId: string,
  app: FastifyInstance
): Promise<string> {
  try {
    // Получить информацию о лиде
    const { data: lead } = await supabase
      .from('dialog_analysis')
      .select('*')
      .eq('id', leadId)
      .single();
    
    if (!lead) {
      throw new Error('Lead not found');
    }
    
    // Получить историю диалога (последние 10 сообщений)
    // TODO: Интеграция с evolutionDb для получения истории
    const history = lead.last_message || 'Нет истории диалога';
    
    const prompt = `История диалога с ${lead.contact_name || 'клиентом'}:
${history}

Этап воронки: ${lead.funnel_stage}
Тип бизнеса: ${lead.business_type || 'неизвестно'}
Уровень интереса: ${lead.interest_level}
Возражение: ${lead.objection || 'нет'}
Попытка реанимации: ${(lead.reactivation_attempts || 0) + 1}

Задача: Написать короткое (1-2 предложения) персонализированное сообщение для реанимации лида.
Упомяни что-то из истории диалога, чтобы показать, что помнишь контекст.
Будь дружелюбным, не навязчивым.

Примеры:
- "Иван, помните обсуждали AI-таргетолога для вашей клиники? Готовы показать примеры работ 🚀"
- "Мария, как дела с запуском рекламы? Есть новые вопросы?"
- "Александр, вы интересовались настройкой рекламы. Может быть, уже готовы начать?"

Сообщение (только текст, без кавычек):`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens: 150
    });
    
    const message = completion.choices[0].message.content?.trim() || '';
    
    return message;
  } catch (error: any) {
    app.log.error({ error: error.message, leadId }, 'Error generating reactivation message');
    return 'Здравствуйте! Как дела? Есть вопросы по нашим услугам?';
  }
}

/**
 * Получить статус кампании реанимации
 */
export async function getReactivationCampaignStatus(
  userAccountId: string
): Promise<{
  queueSize: number;
  todaySent: number;
  nextScheduled?: number;
  topLeads: LeadForReactivation[];
}> {
  // Размер очереди
  const queueSize = await redis.zcard('reactivation_queue');
  
  // Сообщения отправленные сегодня
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  
  const { count: todaySent } = await supabase
    .from('dialog_analysis')
    .select('id', { count: 'exact', head: true })
    .eq('user_account_id', userAccountId)
    .gte('last_reactivation_at', todayStart.toISOString());
  
  // Следующее запланированное сообщение
  const next = await redis.zrange('reactivation_queue', 0, 0, 'WITHSCORES');
  const nextScheduled = next.length > 1 ? parseInt(next[1]) : undefined;
  
  // Топ-50 лидов в очереди
  const topLeads = await selectLeadsForReactivation({
    userAccountId,
    limit: 50
  });
  
  return {
    queueSize,
    todaySent: todaySent || 0,
    nextScheduled,
    topLeads
  };
}

