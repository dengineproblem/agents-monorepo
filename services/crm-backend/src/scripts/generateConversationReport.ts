import { OpenAI } from 'openai';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { analyzeDialogs } from './analyzeDialogs.js';

const log = createLogger({ module: 'conversationReport' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.LOG_ALERT_TELEGRAM_BOT_TOKEN;

/**
 * Отправляет отчёт в Telegram
 */
async function sendReportToTelegram(telegramId: string, reportText: string, reportId: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    log.warn('TELEGRAM_BOT_TOKEN not configured, skipping Telegram notification');
    return false;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        text: reportText
      })
    });

    const result = await response.json() as { ok: boolean; description?: string };

    if (!result.ok) {
      log.error({ telegramId, error: result.description }, 'Failed to send Telegram message');
      return false;
    }

    // Помечаем отчёт как отправленный
    await supabase
      .from('conversation_reports')
      .update({ sent_to_telegram: true, sent_at: new Date().toISOString() })
      .eq('id', reportId);

    log.info({ telegramId, reportId }, 'Report sent to Telegram');
    return true;
  } catch (error: any) {
    log.error({ telegramId, error: error.message }, 'Error sending Telegram message');
    return false;
  }
}

// Типы данных
interface DialogAnalysis {
  id: string;
  contact_phone: string;
  contact_name: string | null;
  interest_level: 'hot' | 'warm' | 'cold' | null;
  funnel_stage: string;
  score: number;
  objection: string | null;
  reasoning: string | null;
  incoming_count: number;
  outgoing_count: number;
  first_message: string;
  last_message: string;
  instance_name: string | null;
  direction_id: string | null; // Прямая связь с direction (migration 129)
  messages: Array<{
    text: string;
    from_me: boolean;
    timestamp: string;
    is_system?: boolean;
  }>;
  analyzed_at: string;
  created_at: string;
  updated_at: string;
  // Новые поля для расширенного анализа
  last_unanswered_message: string | null;
  drop_point: string | null;
  hidden_objections: string[];
  engagement_trend: 'falling' | 'stable' | 'rising' | null;
  // CAPI tracking fields
  capi_interest_sent: boolean;
  capi_qualified_sent: boolean;
  capi_scheduled_sent: boolean;
}

// Метрики для одного направления
interface DirectionMetrics {
  direction_id: string;
  direction_name: string;
  total_dialogs: number;
  new_dialogs: number;
  capi_enabled: boolean;
  capi_has_data: boolean;
  capi_distribution: { interest: number; qualified: number; scheduled: number };
  interest_distribution: { hot: number; warm: number; cold: number };
  incoming_messages: number;
  outgoing_messages: number;
  avg_response_time_minutes: number | null;
  funnel_distribution: Record<string, number>;
  drop_points: Array<{ point: string; count: number }>;
  hidden_objections: Array<{ type: string; count: number }>;
  engagement_trends: { falling: number; stable: number; rising: number };
}

// Направление с WhatsApp номерами
interface DirectionWithPhones {
  id: string;
  name: string;
  capi_enabled: boolean;
  whatsapp_phone_numbers: Array<{ instance_name: string }>;
}

interface ConversationReportData {
  user_account_id: string;
  telegram_id: string | null;
  report_date: string;
  period_start: string;
  period_end: string;
  total_dialogs: number;
  new_dialogs: number;
  active_dialogs: number;
  conversions: Record<string, number>;
  interest_distribution: Record<string, number>;
  funnel_distribution: Record<string, number>;
  avg_response_time_minutes: number | null;
  min_response_time_minutes: number | null;
  max_response_time_minutes: number | null;
  total_incoming_messages: number;
  total_outgoing_messages: number;
  insights: string[];
  rejection_reasons: Array<{ reason: string; count: number }>;
  common_objections: Array<{ objection: string; count: number; suggested_response?: string }>;
  recommendations: string[];
  report_text: string;
  // Новые поля для расширенной аналитики
  traffic_source: { from_ads: number; smart_match: number; organic: number };
  drop_points_summary: Array<{ point: string; count: number }>;
  hidden_objections_summary: Array<{ type: string; count: number }>;
  engagement_trends: { falling: number; stable: number; rising: number };
  // CAPI интеграция (legacy для обратной совместимости - агрегированные данные)
  capi_distribution: { interest: number; qualified: number; scheduled: number };
  capi_source_used: boolean;
  capi_has_data: boolean;
  capi_direction_id: string | null;
  // Новое: метрики по каждому направлению
  directions_data: DirectionMetrics[];
}

// Промпт для анализа переписок через LLM
const REPORT_ANALYSIS_PROMPT = `Ты — аналитик продаж, анализирующий WhatsApp переписки за день.

Проанализируй данные переписок и создай отчет. Данные:

СТАТИСТИКА:
- Всего диалогов: {{total_dialogs}}
- Новых диалогов: {{new_dialogs}}
- Активных за период: {{active_dialogs}}
- Входящих сообщений: {{incoming_messages}}
- Исходящих сообщений: {{outgoing_messages}}

РАСПРЕДЕЛЕНИЕ ПО ИНТЕРЕСУ:
{{interest_distribution}}

РАСПРЕДЕЛЕНИЕ ПО ВОРОНКЕ:
{{funnel_distribution}}

ВОЗРАЖЕНИЯ ИЗ ДИАЛОГОВ:
{{objections}}

ПРИМЕРЫ ДИАЛОГОВ (последние сообщения):
{{dialog_samples}}

Верни JSON (только JSON, без дополнительного текста):

{
  "insights": [
    "Инсайт 1 о поведении клиентов",
    "Инсайт 2 о трендах",
    "Инсайт 3 о проблемах"
  ],
  "rejection_reasons": [
    { "reason": "Причина отказа 1", "count": N },
    { "reason": "Причина отказа 2", "count": N }
  ],
  "common_objections": [
    { "objection": "Возражение 1", "count": N, "suggested_response": "Рекомендуемый ответ" },
    { "objection": "Возражение 2", "count": N, "suggested_response": "Рекомендуемый ответ" }
  ],
  "recommendations": [
    "Рекомендация 1 для улучшения",
    "Рекомендация 2 для улучшения",
    "Рекомендация 3 для улучшения"
  ]
}

ПРАВИЛА:
1. Инсайты должны быть конкретными и основанными на данных
2. Причины отказа группируй по смыслу
3. Для возражений предлагай конкретные ответы
4. Рекомендации должны быть actionable (можно сразу применить)
5. Максимум 5 пунктов в каждой категории`;

/**
 * Рассчитывает время ответа между сообщениями
 */
function calculateResponseTimes(messages: DialogAnalysis['messages']): number[] {
  const responseTimes: number[] = [];

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];

    // Считаем время ответа агента на сообщение клиента
    if (!prev.from_me && curr.from_me && !prev.is_system && !curr.is_system) {
      const prevTime = new Date(prev.timestamp).getTime();
      const currTime = new Date(curr.timestamp).getTime();
      const diffMinutes = (currTime - prevTime) / (1000 * 60);

      // Игнорируем слишком большие значения (> 24 часов)
      if (diffMinutes > 0 && diffMinutes < 1440) {
        responseTimes.push(diffMinutes);
      }
    }
  }

  return responseTimes;
}

/**
 * Рассчитывает метрики для одного направления
 */
function calculateDirectionMetrics(
  direction: DirectionWithPhones,
  dialogs: DialogAnalysis[],
  newDialogsSet: Set<string>
): DirectionMetrics {
  // CAPI распределение
  const capiDistribution = { interest: 0, qualified: 0, scheduled: 0 };
  dialogs.forEach(d => {
    if (d.capi_interest_sent) capiDistribution.interest++;
    if (d.capi_qualified_sent) capiDistribution.qualified++;
    if (d.capi_scheduled_sent) capiDistribution.scheduled++;
  });
  const capiHasData = capiDistribution.interest > 0 || capiDistribution.qualified > 0 || capiDistribution.scheduled > 0;

  // Interest distribution (hot/warm/cold)
  const interestDistribution = { hot: 0, warm: 0, cold: 0 };
  dialogs.forEach(d => {
    if (d.interest_level === 'hot') interestDistribution.hot++;
    else if (d.interest_level === 'warm') interestDistribution.warm++;
    else if (d.interest_level === 'cold') interestDistribution.cold++;
  });

  // Сообщения и время ответа
  let incomingMessages = 0;
  let outgoingMessages = 0;
  const allResponseTimes: number[] = [];
  dialogs.forEach(d => {
    incomingMessages += d.incoming_count || 0;
    outgoingMessages += d.outgoing_count || 0;
    if (d.messages && Array.isArray(d.messages)) {
      allResponseTimes.push(...calculateResponseTimes(d.messages));
    }
  });

  // Funnel distribution
  const funnelDistribution: Record<string, number> = {};
  dialogs.forEach(d => {
    if (d.funnel_stage) {
      funnelDistribution[d.funnel_stage] = (funnelDistribution[d.funnel_stage] || 0) + 1;
    }
  });

  // Drop points
  const dropPointCounts: Record<string, number> = {};
  dialogs.forEach(d => {
    if (d.drop_point) {
      dropPointCounts[d.drop_point] = (dropPointCounts[d.drop_point] || 0) + 1;
    }
  });
  const dropPoints = Object.entries(dropPointCounts)
    .map(([point, count]) => ({ point, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // Hidden objections
  const hiddenObjectionCounts: Record<string, number> = {};
  dialogs.forEach(d => {
    if (d.hidden_objections && Array.isArray(d.hidden_objections)) {
      d.hidden_objections.forEach(obj => {
        const type = obj.split(' ')[0] || obj;
        hiddenObjectionCounts[type] = (hiddenObjectionCounts[type] || 0) + 1;
      });
    }
  });
  const hiddenObjections = Object.entries(hiddenObjectionCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // Engagement trends
  const engagementTrends = { falling: 0, stable: 0, rising: 0 };
  dialogs.forEach(d => {
    if (d.engagement_trend && engagementTrends.hasOwnProperty(d.engagement_trend)) {
      engagementTrends[d.engagement_trend]++;
    }
  });

  // Новые диалоги в этом направлении
  const newDialogsCount = dialogs.filter(d => newDialogsSet.has(d.id)).length;

  return {
    direction_id: direction.id,
    direction_name: direction.name,
    total_dialogs: dialogs.length,
    new_dialogs: newDialogsCount,
    capi_enabled: direction.capi_enabled || false,
    capi_has_data: capiHasData,
    capi_distribution: capiDistribution,
    interest_distribution: interestDistribution,
    incoming_messages: incomingMessages,
    outgoing_messages: outgoingMessages,
    avg_response_time_minutes: allResponseTimes.length > 0
      ? allResponseTimes.reduce((a, b) => a + b, 0) / allResponseTimes.length
      : null,
    funnel_distribution: funnelDistribution,
    drop_points: dropPoints,
    hidden_objections: hiddenObjections,
    engagement_trends: engagementTrends,
  };
}

/**
 * Генерирует секцию отчёта для одного направления
 */
function generateDirectionSection(dir: DirectionMetrics): string {
  let section = `\n📌 ${dir.direction_name}\n`;

  // Статистика диалогов
  section += `• Диалогов: ${dir.total_dialogs}`;
  if (dir.new_dialogs > 0) {
    section += ` (новых: ${dir.new_dialogs})`;
  }
  section += `\n`;
  section += `• Сообщений: 📥 ${dir.incoming_messages} / 📤 ${dir.outgoing_messages}\n`;

  // CAPI или hot/warm/cold
  if (dir.capi_enabled && dir.capi_has_data) {
    // CAPI метрики
    const capi = dir.capi_distribution;
    section += `\n🎯 Воронка CAPI:\n`;
    section += `  👋 Интерес: ${capi.interest}\n`;
    section += `  ✅ Квалиф.: ${capi.qualified}\n`;
    section += `  📅 Записался: ${capi.scheduled}\n`;

    // Конверсии
    if (capi.interest > 0) {
      const qualifiedRate = Math.round((capi.qualified / capi.interest) * 100);
      section += `  📊 Конверсия: ${qualifiedRate}%\n`;
    }
  } else if (dir.capi_enabled && !dir.capi_has_data) {
    // CAPI включен, но данных нет
    section += `\n🎯 CAPI: пиксель подключен, событий пока нет\n`;
    // Fallback на hot/warm/cold
    const i = dir.interest_distribution;
    section += `🌡️ Интерес: 🔥${i.hot} ☀️${i.warm} ❄️${i.cold}\n`;
  } else {
    // Без CAPI - hot/warm/cold
    const i = dir.interest_distribution;
    section += `\n🌡️ Интерес: 🔥${i.hot} ☀️${i.warm} ❄️${i.cold}\n`;
  }

  // Время ответа
  if (dir.avg_response_time_minutes) {
    section += `⏱️ Среднее время ответа: ${Math.round(dir.avg_response_time_minutes * 60)} сек\n`;
  }

  return section;
}

/**
 * Генерирует текст отчета для Telegram
 */
function generateReportText(data: Omit<ConversationReportData, 'report_text'>): string {
  const date = new Date(data.report_date).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  let report = `📊 Отчёт по перепискам за ${date}\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Общая статистика
  report += `📈 ОБЩАЯ СТАТИСТИКА\n`;
  report += `• Всего диалогов: ${data.total_dialogs}\n`;
  if (data.new_dialogs > 0) {
    report += `• Новых: ${data.new_dialogs}\n`;
  }
  report += `• Сообщений: 📥 ${data.total_incoming_messages} / 📤 ${data.total_outgoing_messages}\n`;

  // Если есть directions_data - показываем секции по направлениям
  if (data.directions_data && data.directions_data.length > 0) {
    report += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `📁 ПО НАПРАВЛЕНИЯМ (${data.directions_data.length})\n`;

    data.directions_data.forEach(dir => {
      report += generateDirectionSection(dir);
    });

    report += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  } else {
    // Legacy режим - без разбивки по направлениям
    report += `\n`;

    // Распределение: CAPI воронка или hot/warm/cold
    if (data.capi_source_used && data.capi_distribution && data.capi_has_data) {
      const capi = data.capi_distribution;
      report += `🎯 ВОРОНКА CAPI (Meta Pixel)\n`;
      report += `• 👋 Интерес (Lead): ${capi.interest}\n`;
      report += `• ✅ Квалифицирован: ${capi.qualified}\n`;
      report += `• 📅 Записался: ${capi.scheduled}\n`;

      if (capi.interest > 0) {
        const qualifiedRate = Math.round((capi.qualified / capi.interest) * 100);
        report += `\n📊 Конверсия интерес → квалиф.: ${qualifiedRate}%\n`;
      }
    } else {
      const interest = data.interest_distribution;
      report += `🎯 ИНТЕРЕС КЛИЕНТОВ\n`;
      report += `• 🔥 Горячие: ${interest.hot || 0}\n`;
      report += `• ☀️ Тёплые: ${interest.warm || 0}\n`;
      report += `• ❄️ Холодные: ${interest.cold || 0}\n`;
    }
    report += `\n`;
  }

  // Источник трафика
  const traffic = data.traffic_source;
  if (traffic && (traffic.from_ads > 0 || traffic.smart_match > 0 || traffic.organic > 0)) {
    const total = traffic.from_ads + traffic.smart_match + traffic.organic;
    const adsPercent = total > 0 ? Math.round((traffic.from_ads + traffic.smart_match) / total * 100) : 0;
    report += `📣 ИСТОЧНИК ТРАФИКА\n`;
    report += `• С рекламы: ${traffic.from_ads + traffic.smart_match} (${adsPercent}%)\n`;
    report += `• Органика: ${traffic.organic} (${100 - adsPercent}%)\n\n`;
  }

  // Скорость ответов
  if (data.avg_response_time_minutes) {
    report += `⏱️ СКОРОСТЬ ОТВЕТОВ\n`;
    report += `• Средняя: ${Math.round(data.avg_response_time_minutes * 60)} сек\n`;
    report += `\n`;
  }

  // Инсайты
  if (data.insights.length > 0) {
    report += `💡 ИНСАЙТЫ\n`;
    data.insights.forEach((insight, i) => {
      report += `${i + 1}. ${insight}\n`;
    });
    report += `\n`;
  }

  // Частые возражения
  if (data.common_objections.length > 0) {
    report += `⚠️ ЧАСТЫЕ ВОЗРАЖЕНИЯ\n`;
    data.common_objections.slice(0, 3).forEach((obj) => {
      report += `• "${obj.objection}" (${obj.count}x)\n`;
    });
    report += `\n`;
  }

  // Причины отказа
  if (data.rejection_reasons.length > 0) {
    report += `❌ ПРИЧИНЫ ОТКАЗА\n`;
    data.rejection_reasons.slice(0, 3).forEach((rej) => {
      report += `• ${rej.reason}: ${rej.count}\n`;
    });
    report += `\n`;
  }

  // Drop points
  if (data.drop_points_summary && data.drop_points_summary.length > 0) {
    report += `🚫 ГДЕ ТЕРЯЕМ КЛИЕНТОВ\n`;
    data.drop_points_summary.slice(0, 3).forEach((dp) => {
      report += `• ${dp.point}: ${dp.count}x\n`;
    });
    report += `\n`;
  }

  // Рекомендации
  if (data.recommendations.length > 0) {
    report += `✅ РЕКОМЕНДАЦИИ\n`;
    data.recommendations.forEach((rec, i) => {
      report += `${i + 1}. ${rec}\n`;
    });
  }

  return report;
}

/**
 * Генерирует отчёт по перепискам для пользователя
 */
export async function generateConversationReport(params: {
  userAccountId: string;
  date?: Date;  // По умолчанию - вчера
}): Promise<{
  success: boolean;
  report?: ConversationReportData;
  error?: string;
}> {
  const { userAccountId, date } = params;

  // Определяем период (вчерашний день)
  const reportDate = date || new Date(Date.now() - 24 * 60 * 60 * 1000);
  const startOfDay = new Date(reportDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(reportDate);
  endOfDay.setHours(23, 59, 59, 999);

  const reportDateStr = startOfDay.toISOString().split('T')[0];

  log.info({ userAccountId, reportDate: reportDateStr }, 'Generating conversation report');

  try {
    // Получаем telegram_id пользователя
    const { data: userAccount, error: userError } = await supabase
      .from('user_accounts')
      .select('telegram_id')
      .eq('id', userAccountId)
      .single();

    if (userError) {
      log.error({ error: userError.message, userAccountId }, 'Failed to get user account');
    }

    // Получаем ВСЕ WhatsApp направления с их телефонными номерами
    const { data: directionsRaw, error: directionError } = await supabase
      .from('account_directions')
      .select(`
        id, name, capi_enabled,
        whatsapp_phone_numbers!account_directions_whatsapp_phone_number_id_fkey(instance_name)
      `)
      .eq('user_account_id', userAccountId)
      .eq('objective', 'whatsapp');

    if (directionError) {
      log.warn({ userAccountId, error: directionError.message }, 'Failed to fetch directions');
    }

    // Преобразуем в удобный формат
    const directions: DirectionWithPhones[] = (directionsRaw || []).map(d => {
      const phones = d.whatsapp_phone_numbers as any;
      let phonesList: Array<{ instance_name: string }> = [];

      if (phones) {
        if (Array.isArray(phones)) {
          phonesList = phones.filter((p: any) => p?.instance_name);
        } else if (phones.instance_name) {
          phonesList = [phones];
        }
      }

      return {
        id: d.id,
        name: d.name,
        capi_enabled: d.capi_enabled || false,
        whatsapp_phone_numbers: phonesList
      };
    });

    log.info({
      userAccountId,
      totalDirections: directions.length,
      directionsInfo: directions.map(d => ({
        id: d.id,
        name: d.name,
        capi_enabled: d.capi_enabled,
        instances: d.whatsapp_phone_numbers.map(p => p.instance_name)
      }))
    }, 'Fetched all WhatsApp directions for report');

    // Строим маппинг instance_name → direction
    const instanceToDirection = new Map<string, DirectionWithPhones>();
    for (const dir of directions) {
      for (const phone of dir.whatsapp_phone_numbers) {
        if (phone.instance_name) {
          instanceToDirection.set(phone.instance_name, dir);
        }
      }
    }

    // Запускаем анализ диалогов для каждого направления
    for (const dir of directions) {
      for (const phone of dir.whatsapp_phone_numbers) {
        if (phone.instance_name) {
          try {
            log.info({ instanceName: phone.instance_name, directionName: dir.name }, 'Running dialog analysis for direction');
            const analysisResult = await analyzeDialogs({
              instanceName: phone.instance_name,
              userAccountId,
              minIncoming: 3,
              startDate: startOfDay,
              endDate: endOfDay
            });
            log.info({
              directionName: dir.name,
              analyzed: analysisResult.analyzed,
              new_leads: analysisResult.new_leads,
              errors: analysisResult.errors
            }, 'Dialog analysis completed for direction');
          } catch (analysisError: any) {
            log.error({ directionName: dir.name, error: analysisError.message }, 'Dialog analysis failed for direction');
          }
        }
      }
    }

    // Legacy переменные для обратной совместимости
    const primaryDirection = directions.find(d => d.capi_enabled) || directions[0] || null;
    const capiEnabled = primaryDirection?.capi_enabled || false;
    const capiDirectionId = capiEnabled ? primaryDirection?.id || null : null;

    // Получаем ВСЕ диалоги пользователя (пагинация)
    const PAGE_SIZE = 1000;
    let allDialogs: DialogAnalysis[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error } = await supabase
        .from('dialog_analysis')
        .select('*')
        .eq('user_account_id', userAccountId)
        .range(from, to);

      if (error) {
        log.error({ error: error.message }, 'Failed to fetch dialogs');
        throw error;
      }

      if (data && data.length > 0) {
        allDialogs.push(...data);
        hasMore = data.length === PAGE_SIZE;
        page++;
      } else {
        hasMore = false;
      }
    }

    log.info({ totalDialogs: allDialogs.length }, 'Fetched all dialogs');

    // Фильтруем активные за период (по last_message)
    const activeDialogs = allDialogs.filter(d => {
      const lastMsg = new Date(d.last_message);
      return lastMsg >= startOfDay && lastMsg <= endOfDay;
    });

    // Новые диалоги за период (по first_message — когда клиент написал первый раз)
    const newDialogs = allDialogs.filter(d => {
      const firstMsg = new Date(d.first_message);
      return firstMsg >= startOfDay && firstMsg <= endOfDay;
    });
    const newDialogsSet = new Set(newDialogs.map(d => d.id));

    // === ГРУППИРОВКА ДИАЛОГОВ ПО НАПРАВЛЕНИЯМ ===
    const dialogsByDirection = new Map<string, DialogAnalysis[]>();
    const unknownDirectionDialogs: DialogAnalysis[] = [];

    for (const dialog of activeDialogs) {
      let directionId: string | null = null;

      // Сначала пробуем direction_id (если миграция 129 применена)
      if (dialog.direction_id) {
        directionId = dialog.direction_id;
      }
      // Fallback на маппинг через instance_name
      else if (dialog.instance_name) {
        const direction = instanceToDirection.get(dialog.instance_name);
        if (direction) {
          directionId = direction.id;
        }
      }

      if (directionId) {
        if (!dialogsByDirection.has(directionId)) {
          dialogsByDirection.set(directionId, []);
        }
        dialogsByDirection.get(directionId)!.push(dialog);
      } else {
        unknownDirectionDialogs.push(dialog);
      }
    }

    log.info({
      totalActiveDialogs: activeDialogs.length,
      groupedByDirection: dialogsByDirection.size,
      unknownDirection: unknownDirectionDialogs.length,
      perDirection: Array.from(dialogsByDirection.entries()).map(([id, dialogs]) => ({
        directionId: id,
        directionName: directions.find(d => d.id === id)?.name || 'Unknown',
        dialogsCount: dialogs.length
      }))
    }, 'Grouped dialogs by direction');

    // Рассчитываем метрики для каждого направления
    const directionsData: DirectionMetrics[] = [];
    for (const dir of directions) {
      const dirDialogs = dialogsByDirection.get(dir.id) || [];
      if (dirDialogs.length > 0) {
        const metrics = calculateDirectionMetrics(dir, dirDialogs, newDialogsSet);
        directionsData.push(metrics);
      }
    }

    // Добавляем "Без направления" если есть такие диалоги
    if (unknownDirectionDialogs.length > 0) {
      const unknownDir: DirectionWithPhones = {
        id: 'unknown',
        name: 'Без направления',
        capi_enabled: false,
        whatsapp_phone_numbers: []
      };
      const metrics = calculateDirectionMetrics(unknownDir, unknownDirectionDialogs, newDialogsSet);
      directionsData.push(metrics);
    }

    log.info({
      directionsDataCount: directionsData.length,
      directionsNames: directionsData.map(d => d.direction_name)
    }, 'Calculated metrics for all directions');

    // === КОНЕЦ ГРУППИРОВКИ ===

    // Распределение по интересу (только активные за период)
    const interestDistribution: Record<string, number> = {
      hot: 0,
      warm: 0,
      cold: 0
    };
    activeDialogs.forEach(d => {
      if (d.interest_level) {
        interestDistribution[d.interest_level] = (interestDistribution[d.interest_level] || 0) + 1;
      }
    });

    // CAPI распределение по воронке (если CAPI включен)
    const capiDistribution = { interest: 0, qualified: 0, scheduled: 0 };
    let capiHasData = false;

    if (capiEnabled) {
      activeDialogs.forEach(d => {
        if (d.capi_interest_sent) capiDistribution.interest++;
        if (d.capi_qualified_sent) capiDistribution.qualified++;
        if (d.capi_scheduled_sent) capiDistribution.scheduled++;
      });

      // Проверяем есть ли хотя бы одно CAPI событие
      capiHasData = capiDistribution.interest > 0 || capiDistribution.qualified > 0 || capiDistribution.scheduled > 0;

      log.info({
        capiDistribution,
        capiHasData,
        activeDialogsCount: activeDialogs.length,
        dialogsWithCapiInterest: capiDistribution.interest,
        dialogsWithCapiQualified: capiDistribution.qualified,
        dialogsWithCapiScheduled: capiDistribution.scheduled
      }, 'CAPI: Distribution calculated');

      if (!capiHasData) {
        log.warn({
          userAccountId,
          directionId: capiDirectionId,
          activeDialogsCount: activeDialogs.length
        }, 'CAPI: Enabled but no CAPI events found in active dialogs, will show both CAPI and hot/warm/cold');
      }
    }

    // Распределение по воронке (только активные за период)
    const funnelDistribution: Record<string, number> = {};
    activeDialogs.forEach(d => {
      if (d.funnel_stage) {
        funnelDistribution[d.funnel_stage] = (funnelDistribution[d.funnel_stage] || 0) + 1;
      }
    });

    // Подсчёт сообщений
    let totalIncoming = 0;
    let totalOutgoing = 0;
    const allResponseTimes: number[] = [];

    activeDialogs.forEach(d => {
      totalIncoming += d.incoming_count || 0;
      totalOutgoing += d.outgoing_count || 0;

      if (d.messages && Array.isArray(d.messages)) {
        const times = calculateResponseTimes(d.messages);
        allResponseTimes.push(...times);
      }
    });

    // Расчёт времени ответа
    let avgResponseTime: number | null = null;
    let minResponseTime: number | null = null;
    let maxResponseTime: number | null = null;

    if (allResponseTimes.length > 0) {
      avgResponseTime = allResponseTimes.reduce((a, b) => a + b, 0) / allResponseTimes.length;
      minResponseTime = Math.min(...allResponseTimes);
      maxResponseTime = Math.max(...allResponseTimes);
    }

    // Собираем возражения (только активные за период)
    const objectionCounts: Record<string, number> = {};
    activeDialogs.forEach(d => {
      if (d.objection) {
        objectionCounts[d.objection] = (objectionCounts[d.objection] || 0) + 1;
      }
    });

    // === НОВАЯ СТАТИСТИКА ===

    // 1. Drop Points - где клиенты "отваливаются"
    const dropPointCounts: Record<string, number> = {};
    activeDialogs.forEach(d => {
      if (d.drop_point) {
        dropPointCounts[d.drop_point] = (dropPointCounts[d.drop_point] || 0) + 1;
      }
    });
    const dropPointsSummary = Object.entries(dropPointCounts)
      .map(([point, count]) => ({ point, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Топ 5 drop points

    // 2. Скрытые возражения
    const hiddenObjectionCounts: Record<string, number> = {};
    activeDialogs.forEach(d => {
      if (d.hidden_objections && Array.isArray(d.hidden_objections)) {
        d.hidden_objections.forEach(obj => {
          // Группируем по типу (первое слово)
          const type = obj.split(' ')[0] || obj;
          hiddenObjectionCounts[type] = (hiddenObjectionCounts[type] || 0) + 1;
        });
      }
    });
    const hiddenObjectionsSummary = Object.entries(hiddenObjectionCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Топ 5 типов

    // 3. Тренды интереса
    const engagementTrends = { falling: 0, stable: 0, rising: 0 };
    activeDialogs.forEach(d => {
      if (d.engagement_trend && engagementTrends.hasOwnProperty(d.engagement_trend)) {
        engagementTrends[d.engagement_trend]++;
      }
    });

    // 4. Источник трафика - сопоставление с leads
    let trafficSource = { from_ads: 0, smart_match: 0, organic: 0 };

    // Получаем телефоны активных диалогов
    const activePhones = activeDialogs.map(d => d.contact_phone);

    if (activePhones.length > 0) {
      // Ищем соответствующие leads
      const { data: matchedLeads } = await supabase
        .from('leads')
        .select('phone, source_id, needs_manual_match')
        .eq('user_account_id', userAccountId)
        .in('phone', activePhones);

      if (matchedLeads) {
        const leadsMap = new Map(matchedLeads.map(l => [l.phone, l]));

        activePhones.forEach(phone => {
          const lead = leadsMap.get(phone);
          if (lead) {
            if (lead.source_id) {
              // Есть source_id = точно с рекламы
              trafficSource.from_ads++;
            } else if (lead.needs_manual_match) {
              // Smart match = вероятно реклама
              trafficSource.smart_match++;
            } else {
              // Органика
              trafficSource.organic++;
            }
          } else {
            // Нет в leads = органика
            trafficSource.organic++;
          }
        });
      } else {
        // Все органика если нет данных leads
        trafficSource.organic = activePhones.length;
      }
    }

    // === КОНЕЦ НОВОЙ СТАТИСТИКИ ===

    // Примеры диалогов для LLM (последние 5 активных)
    const dialogSamples = activeDialogs.slice(0, 5).map(d => {
      const lastMessages = (d.messages || []).slice(-5);
      return lastMessages.map(m =>
        `${m.from_me ? 'Агент' : 'Клиент'}: ${m.text?.substring(0, 100) || '[без текста]'}`
      ).join('\n');
    }).join('\n---\n');

    // Анализ через LLM
    let llmAnalysis = {
      insights: [] as string[],
      rejection_reasons: [] as Array<{ reason: string; count: number }>,
      common_objections: [] as Array<{ objection: string; count: number; suggested_response?: string }>,
      recommendations: [] as string[]
    };

    if (activeDialogs.length > 0) {
      try {
        const prompt = REPORT_ANALYSIS_PROMPT
          .replace('{{total_dialogs}}', activeDialogs.length.toString())
          .replace('{{new_dialogs}}', newDialogs.length.toString())
          .replace('{{active_dialogs}}', activeDialogs.length.toString())
          .replace('{{incoming_messages}}', totalIncoming.toString())
          .replace('{{outgoing_messages}}', totalOutgoing.toString())
          .replace('{{interest_distribution}}', JSON.stringify(interestDistribution, null, 2))
          .replace('{{funnel_distribution}}', JSON.stringify(funnelDistribution, null, 2))
          .replace('{{objections}}', Object.entries(objectionCounts)
            .map(([obj, count]) => `- "${obj}": ${count}`)
            .join('\n') || 'Нет данных')
          .replace('{{dialog_samples}}', dialogSamples || 'Нет примеров');

        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a helpful assistant that analyzes sales conversations.' },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' },
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
          llmAnalysis = JSON.parse(content);
        }
      } catch (llmError: any) {
        log.error({ error: llmError.message }, 'LLM analysis failed, using default values');
      }
    }

    // Собираем данные отчёта
    const reportData: Omit<ConversationReportData, 'report_text'> = {
      user_account_id: userAccountId,
      telegram_id: userAccount?.telegram_id || null,
      report_date: reportDateStr,
      period_start: startOfDay.toISOString(),
      period_end: endOfDay.toISOString(),
      total_dialogs: activeDialogs.length,
      new_dialogs: newDialogs.length,
      active_dialogs: activeDialogs.length,
      conversions: {}, // TODO: реализовать отслеживание конверсий
      interest_distribution: interestDistribution,
      funnel_distribution: funnelDistribution,
      avg_response_time_minutes: avgResponseTime,
      min_response_time_minutes: minResponseTime,
      max_response_time_minutes: maxResponseTime,
      total_incoming_messages: totalIncoming,
      total_outgoing_messages: totalOutgoing,
      insights: llmAnalysis.insights || [],
      rejection_reasons: llmAnalysis.rejection_reasons || [],
      common_objections: llmAnalysis.common_objections || [],
      recommendations: llmAnalysis.recommendations || [],
      // Новые поля для расширенной аналитики
      traffic_source: trafficSource,
      drop_points_summary: dropPointsSummary,
      hidden_objections_summary: hiddenObjectionsSummary,
      engagement_trends: engagementTrends,
      // CAPI интеграция (legacy для обратной совместимости)
      capi_distribution: capiDistribution,
      capi_source_used: capiEnabled,
      capi_has_data: capiHasData,
      capi_direction_id: capiDirectionId,
      // Новое: метрики по каждому направлению
      directions_data: directionsData,
    };

    // Генерируем текст отчёта
    const reportText = generateReportText(reportData);
    const fullReportData: ConversationReportData = {
      ...reportData,
      report_text: reportText
    };

    // Сохраняем в БД
    const dataToSave = {
      user_account_id: userAccountId,
      telegram_id: fullReportData.telegram_id,
      report_date: fullReportData.report_date,
      period_start: fullReportData.period_start,
      period_end: fullReportData.period_end,
      total_dialogs: fullReportData.total_dialogs,
      new_dialogs: fullReportData.new_dialogs,
      active_dialogs: fullReportData.active_dialogs,
      conversions: fullReportData.conversions,
      interest_distribution: fullReportData.interest_distribution,
      funnel_distribution: fullReportData.funnel_distribution,
      avg_response_time_minutes: fullReportData.avg_response_time_minutes,
      min_response_time_minutes: fullReportData.min_response_time_minutes,
      max_response_time_minutes: fullReportData.max_response_time_minutes,
      total_incoming_messages: fullReportData.total_incoming_messages,
      total_outgoing_messages: fullReportData.total_outgoing_messages,
      insights: fullReportData.insights,
      rejection_reasons: fullReportData.rejection_reasons,
      common_objections: fullReportData.common_objections,
      recommendations: fullReportData.recommendations,
      report_text: fullReportData.report_text,
      // Новые поля для расширенной аналитики
      traffic_source: fullReportData.traffic_source,
      drop_points_summary: fullReportData.drop_points_summary,
      hidden_objections_summary: fullReportData.hidden_objections_summary,
      engagement_trends: fullReportData.engagement_trends,
      // CAPI интеграция
      capi_distribution: fullReportData.capi_distribution,
      capi_source_used: fullReportData.capi_source_used,
      capi_has_data: fullReportData.capi_has_data,
      capi_direction_id: fullReportData.capi_direction_id,
      // Метрики по направлениям
      directions_data: fullReportData.directions_data,
      generated_at: new Date().toISOString(),
    };

    log.info({ dataToSave: JSON.stringify(dataToSave).substring(0, 500) }, 'Saving report data');

    // Сначала пробуем insert, если конфликт - делаем update
    let savedData;
    const { data: insertData, error: insertError } = await supabase
      .from('conversation_reports')
      .insert(dataToSave)
      .select();

    if (insertError) {
      // Если конфликт - пробуем update
      if (insertError.code === '23505') {
        log.info('Report exists, updating...');
        const { data: updateData, error: updateError } = await supabase
          .from('conversation_reports')
          .update(dataToSave)
          .eq('user_account_id', userAccountId)
          .eq('report_date', dataToSave.report_date)
          .select();

        if (updateError) {
          console.error('Update error:', updateError);
          log.error({ error: updateError.message, code: updateError.code }, 'Failed to update report');
          throw updateError;
        }
        savedData = updateData;
      } else {
        console.error('Insert error:', insertError);
        log.error({ error: insertError.message, code: insertError.code }, 'Failed to insert report');
        throw insertError;
      }
    } else {
      savedData = insertData;
    }

    log.info({ savedCount: savedData?.length }, 'Report saved');

    // Отправляем отчёт в Telegram, если есть telegram_id
    if (fullReportData.telegram_id && savedData?.[0]?.id) {
      await sendReportToTelegram(
        fullReportData.telegram_id,
        fullReportData.report_text,
        savedData[0].id
      );
    }

    log.info({ userAccountId, reportDate: reportDateStr, totalDialogs: allDialogs.length }, 'Report generated successfully');

    return {
      success: true,
      report: fullReportData
    };
  } catch (error: any) {
    log.error({ error: error.message, userAccountId }, 'Failed to generate conversation report');
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Генерирует отчёты для всех пользователей с WhatsApp интеграцией
 */
export async function generateAllConversationReports(date?: Date): Promise<{
  success: boolean;
  total: number;
  generated: number;
  failed: number;
  errors: string[];
}> {
  log.info('Starting batch conversation reports generation');

  try {
    // Получаем всех пользователей с WhatsApp инстансами
    const { data: instances, error } = await supabase
      .from('whatsapp_instances')
      .select('user_account_id')
      .not('user_account_id', 'is', null);

    if (error) {
      throw error;
    }

    // Уникальные user_account_id
    const userAccountIds = [...new Set(instances?.map(i => i.user_account_id) || [])];

    log.info({ totalUsers: userAccountIds.length }, 'Found users with WhatsApp');

    let generated = 0;
    let failed = 0;
    const errors: string[] = [];

    // Генерируем отчёты параллельно (batch по 5)
    const BATCH_SIZE = 5;
    for (let i = 0; i < userAccountIds.length; i += BATCH_SIZE) {
      const batch = userAccountIds.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(userAccountId => generateConversationReport({ userAccountId, date }))
      );

      results.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value.success) {
          generated++;
        } else {
          failed++;
          const errorMsg = result.status === 'rejected'
            ? result.reason?.message
            : result.value.error;
          errors.push(`${batch[idx]}: ${errorMsg}`);
        }
      });
    }

    log.info({ total: userAccountIds.length, generated, failed }, 'Batch generation completed');

    return {
      success: true,
      total: userAccountIds.length,
      generated,
      failed,
      errors
    };
  } catch (error: any) {
    log.error({ error: error.message }, 'Batch generation failed');
    return {
      success: false,
      total: 0,
      generated: 0,
      failed: 0,
      errors: [error.message]
    };
  }
}

// CLI execution support
if (import.meta.url === `file://${process.argv[1]}`) {
  const userAccountId = process.argv[2];
  const dateStr = process.argv[3];

  if (userAccountId === '--all') {
    // Генерация для всех
    const date = dateStr ? new Date(dateStr) : undefined;
    generateAllConversationReports(date)
      .then(result => {
        console.log('Batch result:', result);
        process.exit(result.success ? 0 : 1);
      })
      .catch(error => {
        console.error('Failed:', error);
        process.exit(1);
      });
  } else if (userAccountId) {
    // Генерация для одного пользователя
    const date = dateStr ? new Date(dateStr) : undefined;
    generateConversationReport({ userAccountId, date })
      .then(result => {
        console.log('Report generated:', result.success);
        if (result.report) {
          console.log('\n' + result.report.report_text);
        }
        process.exit(result.success ? 0 : 1);
      })
      .catch(error => {
        console.error('Failed:', error);
        process.exit(1);
      });
  } else {
    console.error('Usage:');
    console.error('  tsx generateConversationReport.ts <userAccountId> [date]');
    console.error('  tsx generateConversationReport.ts --all [date]');
    console.error('Example:');
    console.error('  tsx generateConversationReport.ts abc-123-uuid');
    console.error('  tsx generateConversationReport.ts --all 2024-01-15');
    process.exit(1);
  }
}
