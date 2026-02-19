/**
 * Worker для обработки отложенных follow-up сообщений
 *
 * Запускается каждую минуту и:
 * 1. Берёт pending записи где scheduled_at <= now
 * 2. Проверяет рабочие часы бота
 * 3. Генерирует сообщение через LLM с prompt
 * 4. Отправляет через Evolution API
 * 5. Обновляет статус на sent
 * 6. Планирует следующий step если есть
 */

import cron from 'node-cron';
import OpenAI from 'openai';
import { supabase } from '../lib/supabase.js';
import { sendWhatsAppMessageWithRetry } from '../lib/evolutionApi.js';
import { createLogger } from '../lib/logger.js';
import {
  getPendingFollowUps,
  updateFollowUpStatus,
  getBotConfigForFollowUp,
  scheduleNextFollowUp,
  calculateScheduledTime
} from '../lib/delayedFollowUps.js';

const log = createLogger({ module: 'delayedFollowUpWorker' });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MAX_RETRY_COUNT = 3;

// Ленивая инициализация OpenAI клиента
let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured');
    }
    openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
  }
  return openaiClient;
}

/**
 * Получить историю диалога для контекста
 */
async function getDialogHistory(dialogAnalysisId: string): Promise<string> {
  try {
    const { data: lead } = await supabase
      .from('dialog_analysis')
      .select('contact_name, business_name, funnel_stage, interest_level, messages')
      .eq('id', dialogAnalysisId)
      .single();

    if (!lead) {
      return '';
    }

    // Сообщения хранятся в JSONB поле messages
    const messages = Array.isArray(lead.messages) ? lead.messages : [];

    if (messages.length === 0) {
      return '';
    }

    // Берём последние 10 сообщений
    const recentMessages = messages.slice(-10);

    // Формируем краткую историю
    const history = recentMessages
      .map((m: any) => {
        const role = m.sender === 'bot' || m.role === 'assistant' ? 'Бот' : 'Клиент';
        const content = m.content || m.text || '';
        return `${role}: ${content}`;
      })
      .join('\n');

    const leadInfo = `Клиент: ${lead.contact_name || 'Неизвестно'}, Этап: ${lead.funnel_stage || 'unknown'}, Интерес: ${lead.interest_level || 'unknown'}`;

    return `${leadInfo}\n\nПоследние сообщения:\n${history}`;
  } catch (error) {
    log.error({ error, dialogAnalysisId }, 'Failed to get dialog history');
    return '';
  }
}

/**
 * Получить системный промпт бота
 */
async function getBotSystemPrompt(botId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('ai_bot_configurations')
      .select('system_prompt')
      .eq('id', botId)
      .single();

    return data?.system_prompt || '';
  } catch {
    return '';
  }
}

/**
 * Генерация follow-up сообщения через LLM
 */
async function generateFollowUpMessage(
  botId: string,
  dialogAnalysisId: string,
  miniPrompt: string
): Promise<string | null> {
  try {
    const [systemPrompt, dialogHistory] = await Promise.all([
      getBotSystemPrompt(botId),
      getDialogHistory(dialogAnalysisId)
    ]);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `${systemPrompt}

ВАЖНО: Сейчас ты отправляешь follow-up сообщение клиенту, который не ответил на предыдущее сообщение.
Твоя задача: ${miniPrompt}

Правила:
- Будь краток (1-3 предложения)
- Не повторяй предыдущие сообщения дословно
- Звучи естественно и дружелюбно
- Не давай никаких объяснений, только текст сообщения`
      },
      {
        role: 'user',
        content: `Контекст диалога:\n${dialogHistory}\n\nСгенерируй follow-up сообщение:`
      }
    ];

    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: 200
    });

    const content = response.choices[0]?.message?.content?.trim();

    if (!content) {
      log.error({ botId, dialogAnalysisId }, 'Empty response from LLM');
      return null;
    }

    return content;
  } catch (error) {
    log.error({ error, botId, dialogAnalysisId }, 'Failed to generate follow-up message');
    return null;
  }
}

/**
 * Получить час в timezone
 */
function getHourInTimezone(date: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false
    });
    return parseInt(formatter.format(date), 10);
  } catch {
    return (date.getUTCHours() + 3) % 24;
  }
}

/**
 * Проверка рабочих часов и перепланирование если нужно
 */
async function checkAndRescheduleIfNeeded(
  followUp: any,
  botConfig: any
): Promise<boolean> {
  const now = new Date();
  const currentHour = getHourInTimezone(now, botConfig.timezone || 'Europe/Moscow');

  const hoursStart = botConfig.delayed_schedule_hours_start ?? 9;
  const hoursEnd = botConfig.delayed_schedule_hours_end ?? 19;

  // В рабочие часы — продолжаем
  if (currentHour >= hoursStart && currentHour < hoursEnd) {
    return true;
  }

  // Вне рабочих часов — перепланируем на утро
  log.info({
    followUpId: followUp.id,
    currentHour,
    hoursStart,
    hoursEnd
  }, 'Outside working hours, rescheduling');

  const newScheduledAt = calculateScheduledTime(
    0, // без дополнительной задержки
    hoursStart,
    hoursEnd,
    botConfig.timezone || 'Europe/Moscow'
  );

  await supabase
    .from('delayed_follow_ups')
    .update({ scheduled_at: newScheduledAt.toISOString() })
    .eq('id', followUp.id);

  return false;
}

/**
 * Проверить состояние диалога перед отправкой
 * Возвращает причину отмены или null если можно отправлять
 */
async function checkDialogState(
  dialogAnalysisId: string,
  scheduledAt: string,
  stopOnConsultation: boolean = true
): Promise<string | null> {
  try {
    const { data: lead, error } = await supabase
      .from('dialog_analysis')
      .select('bot_paused, assigned_to_human, last_client_message_at, funnel_stage')
      .eq('id', dialogAnalysisId)
      .single();

    if (error || !lead) {
      return 'Lead not found';
    }

    // Проверяем паузу бота
    if (lead.bot_paused) {
      return 'Bot is paused';
    }

    // Проверяем передачу оператору
    if (lead.assigned_to_human) {
      return 'Assigned to human';
    }

    // Проверяем запись на консультацию — follow-up не нужен
    if (stopOnConsultation) {
      const consultationStages = ['consultation_booked', 'consultation_scheduled', 'consultation_completed'];
      if (lead.funnel_stage && consultationStages.includes(lead.funnel_stage)) {
        return 'Consultation booked';
      }
    }

    // Проверяем свежие сообщения клиента (race condition protection)
    if (lead.last_client_message_at) {
      const lastMessageAt = new Date(lead.last_client_message_at);
      const scheduledTime = new Date(scheduledAt);

      if (lastMessageAt > scheduledTime) {
        return 'Client responded after scheduling';
      }
    }

    return null; // Можно отправлять
  } catch (error) {
    log.error({ error, dialogAnalysisId }, 'Failed to check dialog state');
    return 'Error checking dialog state';
  }
}

/**
 * Сохранить сообщение в историю (в JSONB поле dialog_analysis.messages)
 */
async function saveMessageToHistory(
  dialogAnalysisId: string,
  message: string
): Promise<void> {
  try {
    // Получаем текущую историю
    const { data: lead } = await supabase
      .from('dialog_analysis')
      .select('messages')
      .eq('id', dialogAnalysisId)
      .single();

    const currentMessages = Array.isArray(lead?.messages) ? lead.messages : [];

    // Добавляем follow-up сообщение
    currentMessages.push({
      sender: 'bot',
      content: message,
      timestamp: new Date().toISOString(),
      type: 'follow_up'
    });

    // Ограничиваем историю (последние 100 сообщений)
    const trimmedMessages = currentMessages.slice(-100);

    // Сохраняем
    await supabase
      .from('dialog_analysis')
      .update({
        messages: trimmedMessages,
        last_bot_message_at: new Date().toISOString()
      })
      .eq('id', dialogAnalysisId);

  } catch (error) {
    log.error({ error, dialogAnalysisId }, 'Failed to save follow-up to history');
  }
}

/**
 * Инкремент retry count
 */
async function incrementRetryCount(followUpId: string): Promise<number> {
  // Получаем текущее значение
  const { data: current } = await supabase
    .from('delayed_follow_ups')
    .select('retry_count')
    .eq('id', followUpId)
    .single();

  const newCount = (current?.retry_count || 0) + 1;

  // Обновляем
  await supabase
    .from('delayed_follow_ups')
    .update({ retry_count: newCount })
    .eq('id', followUpId);

  return newCount;
}

/**
 * Обработка одного follow-up
 */
async function processFollowUp(followUp: any): Promise<void> {
  const { id, bot_id, dialog_analysis_id, instance_name, phone, step_index, prompt, scheduled_at, retry_count } = followUp;

  log.info({ followUpId: id, botId: bot_id, stepIndex: step_index, retryCount: retry_count }, 'Processing follow-up');

  try {
    // 0. Проверяем лимит retry
    if ((retry_count || 0) >= MAX_RETRY_COUNT) {
      log.warn({ followUpId: id, retryCount: retry_count }, 'Max retry count reached');
      await updateFollowUpStatus(id, 'failed', `Max retry count (${MAX_RETRY_COUNT}) reached`);
      return;
    }

    // 1. Получаем конфиг бота
    const botConfig = await getBotConfigForFollowUp(bot_id);
    if (!botConfig) {
      log.error({ followUpId: id, botId: bot_id }, 'Bot config not found');
      await updateFollowUpStatus(id, 'failed', 'Bot config not found');
      return;
    }

    // 2. Проверяем что бот активен и функция включена
    if (!botConfig.is_active) {
      log.info({ followUpId: id }, 'Bot is inactive, cancelling');
      await updateFollowUpStatus(id, 'cancelled', 'Bot inactive');
      return;
    }

    if (!botConfig.delayed_schedule_enabled) {
      log.info({ followUpId: id }, 'Follow-up disabled, cancelling');
      await updateFollowUpStatus(id, 'cancelled', 'Feature disabled');
      return;
    }

    // 3. Проверяем состояние диалога (пауза, оператор, свежие сообщения, консультация)
    const stopOnConsultation = botConfig.delayed_stop_on_consultation ?? true;
    const cancelReason = await checkDialogState(dialog_analysis_id, scheduled_at, stopOnConsultation);
    if (cancelReason) {
      log.info({ followUpId: id, reason: cancelReason }, 'Cancelling follow-up due to dialog state');
      await updateFollowUpStatus(id, 'cancelled', cancelReason);
      return;
    }

    // 4. Проверяем рабочие часы
    const canSendNow = await checkAndRescheduleIfNeeded(followUp, botConfig);
    if (!canSendNow) {
      return; // Перепланировано на утро
    }

    // 5. Генерируем сообщение
    const message = await generateFollowUpMessage(bot_id, dialog_analysis_id, prompt);
    if (!message) {
      log.error({ followUpId: id }, 'Failed to generate message');
      const newRetry = await incrementRetryCount(id);
      if (newRetry >= MAX_RETRY_COUNT) {
        await updateFollowUpStatus(id, 'failed', 'Failed to generate message');
      }
      return;
    }

    // 6. Отправляем
    const result = await sendWhatsAppMessageWithRetry({
      instanceName: instance_name,
      phone: phone,
      message: message
    });

    if (!result.success) {
      log.error({ followUpId: id, error: result.error }, 'Failed to send follow-up');
      const newRetry = await incrementRetryCount(id);
      if (newRetry >= MAX_RETRY_COUNT) {
        await updateFollowUpStatus(id, 'failed', result.error || 'Send failed');
      }
      return;
    }

    // 7. Обновляем статус
    await updateFollowUpStatus(id, 'sent');

    // 8. Сохраняем в историю
    await saveMessageToHistory(dialog_analysis_id, message);

    // 9. Планируем следующий follow-up
    await scheduleNextFollowUp(botConfig, dialog_analysis_id, instance_name, phone, step_index);

    log.info({
      followUpId: id,
      stepIndex: step_index,
      messagePreview: message.substring(0, 50)
    }, 'Follow-up sent successfully');

  } catch (error: any) {
    log.error({ error: error.message, followUpId: id }, 'Error processing follow-up');
    const newRetry = await incrementRetryCount(id);
    if (newRetry >= MAX_RETRY_COUNT) {
      await updateFollowUpStatus(id, 'failed', error.message);
    }
  }
}

/**
 * Основной tick worker'а
 */
async function workerTick(): Promise<void> {
  try {
    // Получаем pending follow-ups
    const followUps = await getPendingFollowUps(50);

    if (followUps.length === 0) {
      return;
    }

    log.info({ count: followUps.length }, 'Processing pending follow-ups');

    // Обрабатываем последовательно с задержкой
    for (const followUp of followUps) {
      await processFollowUp(followUp);

      // Небольшая задержка между отправками
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    log.info({ processed: followUps.length }, 'Follow-up tick completed');
  } catch (error: any) {
    log.error({ error: error.message }, 'Follow-up worker tick failed');
  }
}

/**
 * Запуск worker'а
 */
export function startDelayedFollowUpWorker(): void {
  // Запускаем каждую минуту
  cron.schedule('* * * * *', workerTick);

  log.info('Delayed follow-up worker started (every minute)');
}
