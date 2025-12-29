/**
 * Модуль управления отложенными follow-up сообщениями
 *
 * Функции:
 * - cancelPendingFollowUps: отмена всех pending follow-ups при входящем сообщении
 * - scheduleFirstFollowUp: планирование первого follow-up после ответа бота
 * - scheduleNextFollowUp: планирование следующего follow-up (из worker)
 * - calculateScheduledTime: расчёт времени с учётом рабочих часов
 */

import { supabase } from './supabase.js';
import { createLogger } from './logger.js';

const log = createLogger('delayedFollowUps');

// Тип конфигурации бота (минимальный для follow-ups)
interface BotConfigForFollowUp {
  id: string;
  is_active: boolean;
  delayed_schedule_enabled: boolean;
  delayed_schedule_hours_start: number;
  delayed_schedule_hours_end: number;
  delayed_messages: Array<{
    delay_minutes: number;
    prompt: string;
  }>;
  timezone: string;
}

/**
 * Отмена всех pending follow-ups для диалога
 * Вызывается при входящем сообщении от клиента
 */
export async function cancelPendingFollowUps(dialogAnalysisId: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('delayed_follow_ups')
      .update({ status: 'cancelled' })
      .eq('dialog_analysis_id', dialogAnalysisId)
      .eq('status', 'pending')
      .select('id');

    if (error) {
      log.error({ error, dialogAnalysisId }, 'Failed to cancel pending follow-ups');
      throw error;
    }

    const cancelledCount = data?.length || 0;
    if (cancelledCount > 0) {
      log.info({ dialogAnalysisId, cancelledCount }, 'Cancelled pending follow-ups');
    }

    return cancelledCount;
  } catch (error) {
    log.error({ error, dialogAnalysisId }, 'Error in cancelPendingFollowUps');
    throw error;
  }
}

/**
 * Планирование первого follow-up после ответа бота
 * Вызывается из aiBotEngine после отправки ответа
 */
export async function scheduleFirstFollowUp(
  botConfig: BotConfigForFollowUp,
  dialogAnalysisId: string,
  instanceName: string,
  phone: string
): Promise<boolean> {
  try {
    // Проверяем что бот активен и функция включена
    if (!botConfig.is_active) {
      log.debug({ botId: botConfig.id }, 'Bot is not active, skipping follow-up scheduling');
      return false;
    }

    if (!botConfig.delayed_schedule_enabled) {
      return false;
    }

    if (!botConfig.delayed_messages || botConfig.delayed_messages.length === 0) {
      return false;
    }

    const firstMessage = botConfig.delayed_messages[0];
    if (!firstMessage || firstMessage.delay_minutes < 15) {
      log.warn({ botId: botConfig.id }, 'Invalid first follow-up message config');
      return false;
    }

    // Отменяем существующие pending follow-ups
    await cancelPendingFollowUps(dialogAnalysisId);

    // Рассчитываем время отправки
    const scheduledAt = calculateScheduledTime(
      firstMessage.delay_minutes,
      botConfig.delayed_schedule_hours_start,
      botConfig.delayed_schedule_hours_end,
      botConfig.timezone || 'Europe/Moscow'
    );

    // Создаём запись в очереди
    const { error } = await supabase
      .from('delayed_follow_ups')
      .insert({
        bot_id: botConfig.id,
        dialog_analysis_id: dialogAnalysisId,
        instance_name: instanceName,
        phone: phone,
        step_index: 0,
        prompt: firstMessage.prompt,
        scheduled_at: scheduledAt.toISOString(),
        status: 'pending'
      });

    if (error) {
      log.error({ error, botId: botConfig.id, dialogAnalysisId }, 'Failed to schedule first follow-up');
      throw error;
    }

    log.info({
      botId: botConfig.id,
      dialogAnalysisId,
      scheduledAt: scheduledAt.toISOString(),
      delayMinutes: firstMessage.delay_minutes
    }, 'Scheduled first follow-up');

    return true;
  } catch (error) {
    log.error({ error, botId: botConfig.id, dialogAnalysisId }, 'Error in scheduleFirstFollowUp');
    return false;
  }
}

/**
 * Планирование следующего follow-up после отправки предыдущего
 * Вызывается из worker после успешной отправки
 */
export async function scheduleNextFollowUp(
  botConfig: BotConfigForFollowUp,
  dialogAnalysisId: string,
  instanceName: string,
  phone: string,
  currentStep: number
): Promise<boolean> {
  try {
    const nextStep = currentStep + 1;

    // Проверяем есть ли следующее сообщение в цепочке
    if (!botConfig.delayed_messages || nextStep >= botConfig.delayed_messages.length) {
      log.info({
        botId: botConfig.id,
        dialogAnalysisId,
        currentStep
      }, 'No more follow-ups in chain');
      return false;
    }

    const nextMessage = botConfig.delayed_messages[nextStep];
    if (!nextMessage || nextMessage.delay_minutes < 15) {
      log.warn({ botId: botConfig.id, nextStep }, 'Invalid next follow-up message config');
      return false;
    }

    // Рассчитываем время отправки
    const scheduledAt = calculateScheduledTime(
      nextMessage.delay_minutes,
      botConfig.delayed_schedule_hours_start,
      botConfig.delayed_schedule_hours_end,
      botConfig.timezone || 'Europe/Moscow'
    );

    // Создаём запись в очереди
    const { error } = await supabase
      .from('delayed_follow_ups')
      .insert({
        bot_id: botConfig.id,
        dialog_analysis_id: dialogAnalysisId,
        instance_name: instanceName,
        phone: phone,
        step_index: nextStep,
        prompt: nextMessage.prompt,
        scheduled_at: scheduledAt.toISOString(),
        status: 'pending'
      });

    if (error) {
      log.error({ error, botId: botConfig.id, dialogAnalysisId, nextStep }, 'Failed to schedule next follow-up');
      throw error;
    }

    log.info({
      botId: botConfig.id,
      dialogAnalysisId,
      nextStep,
      scheduledAt: scheduledAt.toISOString(),
      delayMinutes: nextMessage.delay_minutes
    }, 'Scheduled next follow-up');

    return true;
  } catch (error) {
    log.error({ error, botId: botConfig.id, dialogAnalysisId }, 'Error in scheduleNextFollowUp');
    return false;
  }
}

/**
 * Расчёт времени отправки с учётом рабочих часов
 * Если время попадает вне рабочих часов — переносится на начало следующего рабочего дня
 */
export function calculateScheduledTime(
  delayMinutes: number,
  hoursStart: number,
  hoursEnd: number,
  timezone: string
): Date {
  // Текущее время в UTC
  const now = new Date();

  // Добавляем задержку
  const scheduled = new Date(now.getTime() + delayMinutes * 60 * 1000);

  // Получаем час в указанном timezone
  const scheduledHour = getHourInTimezone(scheduled, timezone);

  // Проверяем рабочие часы
  if (scheduledHour >= hoursStart && scheduledHour < hoursEnd) {
    // В рабочие часы — отправляем как есть
    return scheduled;
  }

  // Вне рабочих часов — переносим на начало следующего рабочего дня
  const nextWorkingDay = getNextWorkingDayStart(scheduled, hoursStart, timezone);

  log.info({
    originalTime: scheduled.toISOString(),
    adjustedTime: nextWorkingDay.toISOString(),
    scheduledHour,
    hoursStart,
    hoursEnd,
    timezone
  }, 'Follow-up time adjusted to working hours');

  return nextWorkingDay;
}

/**
 * Получить час в указанном timezone
 */
function getHourInTimezone(date: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false
    });
    const hour = parseInt(formatter.format(date), 10);
    return hour;
  } catch {
    // Fallback to UTC+3 (Moscow)
    return (date.getUTCHours() + 3) % 24;
  }
}

/**
 * Получить начало следующего рабочего дня
 */
function getNextWorkingDayStart(date: Date, hoursStart: number, timezone: string): Date {
  try {
    // Получаем текущую дату в timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    const currentHour = getHourInTimezone(date, timezone);

    // Определяем дату для начала рабочего дня
    let targetDate: Date;

    if (currentHour >= hoursStart) {
      // Уже после начала рабочего дня (но вне рабочих часов = после конца)
      // Переносим на следующий день
      targetDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);
    } else {
      // До начала рабочего дня — отправляем сегодня в hoursStart
      targetDate = date;
    }

    // Форматируем дату
    const dateStr = formatter.format(targetDate);

    // Создаём время начала рабочего дня
    // Формат: YYYY-MM-DD в timezone, час hoursStart
    const [year, month, day] = dateStr.split('-').map(Number);

    // Создаём дату в UTC, корректируя на timezone offset
    // Приблизительный offset для Europe/Moscow = +3
    const tzOffsets: Record<string, number> = {
      'Europe/Moscow': 3,
      'Europe/Kaliningrad': 2,
      'Asia/Yekaterinburg': 5,
      'Asia/Almaty': 6,
      'Asia/Novosibirsk': 7,
      'Asia/Vladivostok': 10,
      'Asia/Tashkent': 5,
      'Asia/Bishkek': 6
    };

    const offset = tzOffsets[timezone] || 3;
    const utcHour = (hoursStart - offset + 24) % 24;

    const result = new Date(Date.UTC(year, month - 1, day, utcHour, 0, 0, 0));

    return result;
  } catch (error) {
    log.error({ error, timezone }, 'Error calculating next working day');
    // Fallback: просто добавляем время до hoursStart следующего дня
    const tomorrow = new Date(date.getTime() + 24 * 60 * 60 * 1000);
    tomorrow.setUTCHours(hoursStart - 3, 0, 0, 0); // Moscow offset
    return tomorrow;
  }
}

/**
 * Получить pending follow-ups для обработки worker'ом
 */
export async function getPendingFollowUps(limit: number = 100): Promise<any[]> {
  try {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('delayed_follow_ups')
      .select(`
        id,
        bot_id,
        dialog_analysis_id,
        instance_name,
        phone,
        step_index,
        prompt,
        scheduled_at,
        created_at,
        retry_count
      `)
      .eq('status', 'pending')
      .lte('scheduled_at', now)
      .order('scheduled_at', { ascending: true })
      .limit(limit);

    if (error) {
      log.error({ error }, 'Failed to get pending follow-ups');
      throw error;
    }

    return data || [];
  } catch (error) {
    log.error({ error }, 'Error in getPendingFollowUps');
    return [];
  }
}

/**
 * Обновить статус follow-up после обработки
 */
export async function updateFollowUpStatus(
  followUpId: string,
  status: 'sent' | 'failed' | 'cancelled',
  errorMessage?: string
): Promise<void> {
  try {
    const updateData: Record<string, any> = {
      status,
      ...(status === 'sent' ? { sent_at: new Date().toISOString() } : {}),
      ...(errorMessage ? { error_message: errorMessage } : {})
    };

    const { error } = await supabase
      .from('delayed_follow_ups')
      .update(updateData)
      .eq('id', followUpId);

    if (error) {
      log.error({ error, followUpId, status }, 'Failed to update follow-up status');
      throw error;
    }

    log.info({ followUpId, status }, 'Updated follow-up status');
  } catch (error) {
    log.error({ error, followUpId }, 'Error in updateFollowUpStatus');
    throw error;
  }
}

/**
 * Получить конфигурацию бота по ID
 */
export async function getBotConfigForFollowUp(botId: string): Promise<BotConfigForFollowUp | null> {
  try {
    const { data, error } = await supabase
      .from('ai_bot_configurations')
      .select(`
        id,
        is_active,
        delayed_schedule_enabled,
        delayed_schedule_hours_start,
        delayed_schedule_hours_end,
        delayed_messages,
        timezone
      `)
      .eq('id', botId)
      .single();

    if (error) {
      log.error({ error, botId }, 'Failed to get bot config for follow-up');
      return null;
    }

    return data as BotConfigForFollowUp;
  } catch (error) {
    log.error({ error, botId }, 'Error in getBotConfigForFollowUp');
    return null;
  }
}
