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
  messages: Array<{
    text: string;
    from_me: boolean;
    timestamp: string;
    is_system?: boolean;
  }>;
  analyzed_at: string;
  created_at: string;
  updated_at: string;
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

  // Основная статистика
  report += `📈 СТАТИСТИКА ДИАЛОГОВ\n`;
  report += `• Активных диалогов: ${data.total_dialogs}\n`;
  if (data.new_dialogs > 0) {
    report += `• Новых: ${data.new_dialogs}\n`;
  }
  report += `• Сообщений: 📥 ${data.total_incoming_messages} / 📤 ${data.total_outgoing_messages}\n\n`;

  // Распределение по интересу
  const interest = data.interest_distribution;
  report += `🎯 ИНТЕРЕС КЛИЕНТОВ\n`;
  report += `• 🔥 Горячие: ${interest.hot || 0}\n`;
  report += `• ☀️ Тёплые: ${interest.warm || 0}\n`;
  report += `• ❄️ Холодные: ${interest.cold || 0}\n\n`;

  // Конверсии
  const conv = data.conversions;
  if (Object.keys(conv).length > 0) {
    report += `📊 КОНВЕРСИИ\n`;
    if (conv.new_to_qualified) report += `• Новый → Квалифицирован: ${conv.new_to_qualified}\n`;
    if (conv.qualified_to_booked) report += `• Квалифицирован → Запись: ${conv.qualified_to_booked}\n`;
    if (conv.booked_to_completed) report += `• Запись → Консультация: ${conv.booked_to_completed}\n`;
    if (conv.completed_to_closed) report += `• Консультация → Сделка: ${conv.completed_to_closed}\n`;
    if (conv.deal_lost) report += `• ❌ Потеряно: ${conv.deal_lost}\n`;
    report += `\n`;
  }

  // Скорость ответов (конвертируем минуты в секунды)
  if (data.avg_response_time_minutes) {
    report += `⏱️ СКОРОСТЬ ОТВЕТОВ\n`;
    report += `• Средняя: ${Math.round(data.avg_response_time_minutes * 60)} сек\n`;
    if (data.min_response_time_minutes) report += `• Минимальная: ${Math.round(data.min_response_time_minutes * 60)} сек\n`;
    if (data.max_response_time_minutes) report += `• Максимальная: ${Math.round(data.max_response_time_minutes * 60)} сек\n`;
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

    // Получаем WhatsApp instance через direction → whatsapp_phone_numbers
    // Это правильная связь: direction привязан к конкретному whatsapp номеру
    const { data: direction, error: directionError } = await supabase
      .from('account_directions')
      .select('id, name, whatsapp_phone_number_id')
      .eq('user_account_id', userAccountId)
      .eq('objective', 'whatsapp')
      .limit(1)
      .single();

    let instanceName: string | null = null;

    if (directionError || !direction?.whatsapp_phone_number_id) {
      log.warn({ userAccountId, error: directionError?.message }, 'No WhatsApp direction found, skipping dialog analysis');
    } else {
      // Получаем instance_name из whatsapp_phone_numbers
      const { data: phoneNumber, error: phoneError } = await supabase
        .from('whatsapp_phone_numbers')
        .select('instance_name')
        .eq('id', direction.whatsapp_phone_number_id)
        .single();

      if (phoneError || !phoneNumber?.instance_name) {
        log.warn({ userAccountId, whatsappPhoneNumberId: direction.whatsapp_phone_number_id }, 'No instance_name in whatsapp_phone_numbers');
      } else {
        instanceName = phoneNumber.instance_name;
      }
    }

    if (!instanceName) {
      log.warn({ userAccountId }, 'No active WhatsApp instance found, skipping dialog analysis');
    } else {
      // Запускаем анализ диалогов для обновления данных
      log.info({ instanceName }, 'Running dialog analysis before report generation');

      try {
        const analysisResult = await analyzeDialogs({
          instanceName,
          userAccountId,
          minIncoming: 3
          // maxDialogs убран — анализируем все диалоги за период
        });

        log.info({
          analyzed: analysisResult.analyzed,
          new_leads: analysisResult.new_leads,
          errors: analysisResult.errors
        }, 'Dialog analysis completed');
      } catch (analysisError: any) {
        log.error({ error: analysisError.message }, 'Dialog analysis failed, continuing with existing data');
      }
    }

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
