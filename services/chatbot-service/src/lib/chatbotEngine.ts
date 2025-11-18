import { FastifyInstance } from 'fastify';
import { supabase } from './supabase.js';
import { redis } from './redis.js';
import OpenAI from 'openai';
import axios from 'axios';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://evolution-api:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

export interface DialogAnalysis {
  id: string;
  user_account_id: string;
  instance_name: string;
  contact_phone: string;
  contact_name?: string;
  funnel_stage: string;
  interest_level?: string;
  business_type?: string;
  objection?: string;
  assigned_to_human?: boolean;
  bot_paused?: boolean;
  bot_paused_until?: string;
  last_bot_message_at?: string;
  last_message?: string;
  reactivation_attempts?: number;
}

export interface BotConfig {
  ai_instructions: string;
  triggers: Array<{
    keyword: string;
    response: string;
    moveToStage?: string;
  }>;
  working_hours: {
    start: string;
    end: string;
    days: number[];
  };
}

/**
 * Проверка условий, когда бот должен ответить
 */
export function shouldBotRespond(lead: DialogAnalysis): boolean {
  // 1. Менеджер взял в работу
  if (lead.assigned_to_human) return false;
  
  // 2. Этап воронки, где бот молчит
  const silentStages = ['consultation_completed', 'deal_closed', 'deal_lost'];
  if (silentStages.includes(lead.funnel_stage)) return false;
  
  // 3. Бот отключен для этого лида
  if (lead.bot_paused) return false;
  
  // 4. Проверка паузы с таймаутом
  if (lead.bot_paused_until) {
    const pausedUntil = new Date(lead.bot_paused_until);
    if (pausedUntil > new Date()) return false;
  }
  
  // 5. Вне рабочих часов (по умолчанию 10:00-20:00, Пн-Пт)
  if (!isWorkingHours()) return false;
  
  return true;
}

/**
 * Проверка рабочих часов (10:00-20:00, Пн-Пт)
 */
function isWorkingHours(): boolean {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  
  // Проверка дня недели (Пн-Пт = 1-5)
  if (day === 0 || day === 6) return false;
  
  // Проверка времени (10:00-20:00)
  if (hour < 10 || hour >= 20) return false;
  
  return true;
}

/**
 * Склейка сообщений через Redis с задержкой 5 секунд
 */
export async function collectMessages(
  phone: string,
  instanceName: string,
  newMessage: string,
  app: FastifyInstance
): Promise<void> {
  const key = `pending_messages:${instanceName}:${phone}`;
  
  // Добавить сообщение в очередь
  await redis.rpush(key, newMessage);
  await redis.expire(key, 10); // TTL 10 секунд
  
  // Установить таймер на 5 секунд
  const timerId = `timer:${key}`;
  const exists = await redis.exists(timerId);
  
  if (!exists) {
    await redis.set(timerId, '1', 'EX', 5);
    
    // Через 5 секунд обработать все сообщения
    setTimeout(async () => {
      try {
        const messages = await redis.lrange(key, 0, -1);
        await redis.del(key, timerId);
        
        if (messages.length > 0) {
          const combined = messages.join('\n');
          await processBotResponse(phone, instanceName, combined, app);
        }
      } catch (error: any) {
        app.log.error({ error: error.message, phone, instanceName }, 'Error processing collected messages');
      }
    }, 5000);
  }
}

/**
 * Обработка и генерация ответа бота
 */
async function processBotResponse(
  phone: string,
  instanceName: string,
  messageText: string,
  app: FastifyInstance
): Promise<void> {
  try {
    // Получить информацию о лиде
    const { data: lead } = await supabase
      .from('dialog_analysis')
      .select('*')
      .eq('contact_phone', phone)
      .eq('instance_name', instanceName)
      .maybeSingle();

    if (!lead) {
      app.log.warn({ phone, instanceName }, 'Lead not found in dialog_analysis');
      return;
    }

    // Проверить, должен ли бот ответить
    if (!shouldBotRespond(lead)) {
      app.log.debug({ phone, leadId: lead.id }, 'Bot should not respond');
      return;
    }

    // Получить конфигурацию бота
    const { data: botConfig } = await supabase
      .from('chatbot_configurations')
      .select('*')
      .eq('user_account_id', lead.user_account_id)
      .eq('active', true)
      .maybeSingle();

    if (!botConfig) {
      app.log.warn({ userAccountId: lead.user_account_id }, 'No active bot configuration found');
      return;
    }

    // Сгенерировать ответ
    const response = await generateBotResponse(lead, messageText, botConfig, app);
    
    if (!response.response) {
      app.log.debug({ phone }, 'No response generated');
      return;
    }

    // Разбить длинные сообщения
    const chunks = splitLongMessage(response.response);

    // Отправить сообщения
    for (const chunk of chunks) {
      await sendWhatsAppMessage(instanceName, phone, chunk, app);
      if (chunks.length > 1) {
        await delay(2000); // 2 сек между сообщениями
      }
    }

    // Обновить этап воронки, если нужно
    if (response.move_to_stage) {
      await moveFunnelStage(lead.id, response.move_to_stage, app);
    }

    // Сохранить важную информацию о клиенте
    if (response.save_info) {
      await saveLeadInfo(lead.id, response.save_info, app);
    }

    // Если клиент просит менеджера
    if (response.needs_human) {
      await supabase
        .from('dialog_analysis')
        .update({ assigned_to_human: true })
        .eq('id', lead.id);
      
      app.log.info({ leadId: lead.id }, 'Lead requests human manager');
    }

    // Обновить время последнего сообщения бота
    await supabase
      .from('dialog_analysis')
      .update({ last_bot_message_at: new Date().toISOString() })
      .eq('id', lead.id);

    // Запланировать догоняющее сообщение через час
    await scheduleFollowUp(lead.id, instanceName, phone, 60 * 60 * 1000, app);

  } catch (error: any) {
    app.log.error({ error: error.message, phone, instanceName }, 'Error in processBotResponse');
  }
}

/**
 * Генерация ответа бота (гибридная логика: правила + GPT)
 */
async function generateBotResponse(
  lead: DialogAnalysis,
  messages: string,
  botConfig: any,
  app: FastifyInstance
): Promise<{
  response: string;
  move_to_stage?: string;
  needs_human?: boolean;
  save_info?: Record<string, any>;
}> {
  // 1. Проверить базовые триггеры (быстро)
  const trigger = checkTriggers(messages, botConfig.triggers || []);
  if (trigger) {
    app.log.debug({ trigger: trigger.keyword }, 'Matched trigger keyword');
    return { 
      response: trigger.response, 
      move_to_stage: trigger.moveToStage 
    };
  }
  
  // 2. GPT анализ для сложных случаев
  const prompt = `${botConfig.ai_instructions || 'Ты — AI-ассистент по продажам.'}

История диалога:
${messages}

Текущий этап воронки: ${lead.funnel_stage}
Информация о клиенте:
- Имя: ${lead.contact_name || 'неизвестно'}
- Тип бизнеса: ${lead.business_type || 'неизвестно'}
- Уровень интереса: ${lead.interest_level || 'неизвестно'}

Задачи:
1. Ответь клиенту естественно, как продавец (1-3 предложения)
2. Определи, нужно ли двигать на следующий этап воронки
3. Если клиент просит менеджера или хочет поговорить с человеком → установи needs_human: true

Возможные этапы воронки:
- new_lead → not_qualified (если не подходит)
- new_lead → qualified (после квалификации)
- qualified → consultation_booked (после записи на встречу)
- consultation_booked → consultation_completed (после встречи)

Ответ СТРОГО в JSON формате:
{
  "response": "текст ответа клиенту",
  "move_to_stage": "qualified" или null,
  "needs_human": true или false,
  "save_info": { "business_type": "..." } или null
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0].message.content || '{}');
    app.log.debug({ result }, 'GPT response generated');
    
    return result;
  } catch (error: any) {
    app.log.error({ error: error.message }, 'Error calling OpenAI');
    return { response: '' };
  }
}

/**
 * Проверка триггерных ключевых слов
 */
function checkTriggers(
  message: string,
  triggers: Array<{ keyword: string; response: string; moveToStage?: string }>
): { keyword: string; response: string; moveToStage?: string } | null {
  const lowerMessage = message.toLowerCase();
  
  for (const trigger of triggers) {
    if (lowerMessage.includes(trigger.keyword.toLowerCase())) {
      return trigger;
    }
  }
  
  return null;
}

/**
 * Дробление длинных сообщений
 */
function splitLongMessage(text: string, maxLength = 500): string[] {
  if (text.length <= maxLength) return [text];
  
  const sentences = text.split(/[.!?]\s+/);
  const chunks: string[] = [];
  let current = '';
  
  for (const sentence of sentences) {
    if ((current + sentence).length > maxLength) {
      if (current) chunks.push(current.trim());
      current = sentence;
    } else {
      current += (current ? '. ' : '') + sentence;
    }
  }
  
  if (current) chunks.push(current.trim());
  return chunks;
}

/**
 * Отправка сообщения через Evolution API
 */
export async function sendWhatsAppMessage(
  instanceName: string,
  phone: string,
  text: string,
  app: FastifyInstance
): Promise<void> {
  try {
    const formattedPhone = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
    
    await axios.post(
      `${EVOLUTION_API_URL}/message/sendText/${instanceName}`,
      {
        number: formattedPhone,
        text: text
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'apikey': EVOLUTION_API_KEY
        }
      }
    );

    app.log.info({ instanceName, phone, textLength: text.length }, 'WhatsApp message sent');
  } catch (error: any) {
    app.log.error({ 
      error: error.message, 
      instanceName, 
      phone 
    }, 'Failed to send WhatsApp message');
    throw error;
  }
}

/**
 * Движение по воронке продаж
 */
async function moveFunnelStage(
  leadId: string,
  newStage: string,
  app: FastifyInstance
): Promise<void> {
  // Get lead info first
  const { data: lead } = await supabase
    .from('dialog_analysis')
    .select('user_account_id')
    .eq('id', leadId)
    .single();

  const { error } = await supabase
    .from('dialog_analysis')
    .update({ funnel_stage: newStage })
    .eq('id', leadId);

  if (error) {
    app.log.error({ error, leadId, newStage }, 'Failed to move funnel stage');
  } else {
    app.log.info({ leadId, newStage }, 'Moved lead to new funnel stage');
    
    // Mark target action for campaign analytics
    if (lead?.user_account_id) {
      const { markTargetAction } = await import('./campaignAnalytics.js');
      await markTargetAction(leadId, lead.user_account_id, newStage);
    }
  }
}

/**
 * Сохранение информации о лиде
 */
async function saveLeadInfo(
  leadId: string,
  info: Record<string, any>,
  app: FastifyInstance
): Promise<void> {
  const { error } = await supabase
    .from('dialog_analysis')
    .update(info)
    .eq('id', leadId);

  if (error) {
    app.log.error({ error, leadId }, 'Failed to save lead info');
  } else {
    app.log.debug({ leadId, info }, 'Saved lead info');
  }
}

/**
 * Запланировать догоняющее сообщение
 */
async function scheduleFollowUp(
  leadId: string,
  instanceName: string,
  phone: string,
  delayMs: number,
  app: FastifyInstance
): Promise<void> {
  const key = `follow_up:${leadId}`;
  
  // Сохранить в Redis с TTL
  await redis.setex(
    key,
    Math.ceil(delayMs / 1000),
    JSON.stringify({ leadId, instanceName, phone, scheduledAt: Date.now() })
  );

  app.log.debug({ leadId, delayMs }, 'Follow-up scheduled');
}

/**
 * Утилита для задержки
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

