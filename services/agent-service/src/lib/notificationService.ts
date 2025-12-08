/**
 * Notification Service
 *
 * Централизованный сервис для отправки engagement уведомлений
 * - Проверка лимитов (3/день, 10/неделю)
 * - Проверка cooldown по типам
 * - Отправка в Telegram и/или In-App
 * - Логирование истории отправок
 *
 * @module lib/notificationService
 */

import { supabase } from './supabase.js';
import { sendTelegramNotification } from './telegramNotifier.js';
import { createLogger } from './logger.js';

const logger = createLogger({ module: 'notificationService' });

// =====================================================
// Константы
// =====================================================

export const TELEGRAM_TECH_CHAT_ID = '-5079020326';
export const APP_BASE_URL = 'https://app.performanteaiagency.com';

// =====================================================
// Типы
// =====================================================

export interface NotificationTemplate {
  type: string;
  title: string;
  message: string;
  telegramMessage: string;
  ctaUrl?: string;
  ctaLabel?: string;
  cooldownDays: number;
  channels: ('telegram' | 'in_app')[];
}

export interface SendNotificationOptions {
  userId: string;
  template: NotificationTemplate;
  variables?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface SendNotificationResult {
  success: boolean;
  telegramSent: boolean;
  inAppCreated: boolean;
  notificationId?: string;
  historyId?: string;
  error?: string;
}

export interface NotificationSettings {
  id: string;
  daily_limit: number;
  weekly_limit: number;
  send_hour: number;
  type_cooldowns: Record<string, number>;
  enabled_types: string[];
  is_active: boolean;
}

export interface NotificationLimits {
  canSend: boolean;
  dailyCount: number;
  weeklyCount: number;
  dailyLimit: number;
  weeklyLimit: number;
}

// =====================================================
// Получение настроек
// =====================================================

/**
 * Получает глобальные настройки системы уведомлений
 */
export async function getNotificationSettings(): Promise<NotificationSettings | null> {
  const { data, error } = await supabase
    .from('notification_settings')
    .select('*')
    .eq('id', '00000000-0000-0000-0000-000000000001')
    .single();

  if (error) {
    logger.error({ error: error.message }, 'Failed to get notification settings');
    return null;
  }

  return data;
}

// =====================================================
// Проверка лимитов
// =====================================================

/**
 * Проверяет, не превышен ли лимит уведомлений для пользователя
 */
export async function checkNotificationLimits(userId: string): Promise<NotificationLimits> {
  const settings = await getNotificationSettings();
  const dailyLimit = settings?.daily_limit ?? 3;
  const weeklyLimit = settings?.weekly_limit ?? 10;

  const now = new Date();

  // Начало сегодняшнего дня (UTC)
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  // 7 дней назад
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Считаем за сегодня
  const { count: dailyCount } = await supabase
    .from('notification_history')
    .select('*', { count: 'exact', head: true })
    .eq('user_account_id', userId)
    .gte('created_at', todayStart.toISOString());

  // Считаем за неделю
  const { count: weeklyCount } = await supabase
    .from('notification_history')
    .select('*', { count: 'exact', head: true })
    .eq('user_account_id', userId)
    .gte('created_at', weekAgo.toISOString());

  const daily = dailyCount ?? 0;
  const weekly = weeklyCount ?? 0;

  return {
    canSend: daily < dailyLimit && weekly < weeklyLimit,
    dailyCount: daily,
    weeklyCount: weekly,
    dailyLimit,
    weeklyLimit
  };
}

// =====================================================
// Проверка cooldown
// =====================================================

/**
 * Проверяет cooldown для конкретного типа уведомления
 * @returns true если можно отправлять
 */
export async function checkCooldown(
  userId: string,
  notificationType: string,
  cooldownDays: number
): Promise<boolean> {
  // 9999 дней = только один раз (для достижений)
  if (cooldownDays >= 9999) {
    const { count } = await supabase
      .from('notification_history')
      .select('*', { count: 'exact', head: true })
      .eq('user_account_id', userId)
      .eq('notification_type', notificationType);

    return (count ?? 0) === 0;
  }

  const cooldownDate = new Date();
  cooldownDate.setDate(cooldownDate.getDate() - cooldownDays);

  const { count } = await supabase
    .from('notification_history')
    .select('*', { count: 'exact', head: true })
    .eq('user_account_id', userId)
    .eq('notification_type', notificationType)
    .gte('created_at', cooldownDate.toISOString());

  return (count ?? 0) === 0;
}

/**
 * Проверяет, включён ли тип уведомления в настройках
 */
export async function isNotificationTypeEnabled(notificationType: string): Promise<boolean> {
  const settings = await getNotificationSettings();

  if (!settings?.is_active) {
    return false;
  }

  const enabledTypes = settings.enabled_types || [];
  return enabledTypes.includes(notificationType);
}

// =====================================================
// Вспомогательные функции
// =====================================================

/**
 * Подставляет переменные в текст шаблона
 */
function replaceVariables(text: string, variables: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return result;
}

/**
 * Получает telegram_id пользователя
 */
export async function getUserTelegramId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('user_accounts')
    .select('telegram_id')
    .eq('id', userId)
    .single();

  return data?.telegram_id || null;
}

/**
 * Получает дату последней сессии пользователя
 */
export async function getLastSessionDate(userId: string): Promise<Date | null> {
  // Сначала пробуем из user_accounts.last_session_at
  const { data: user } = await supabase
    .from('user_accounts')
    .select('last_session_at')
    .eq('id', userId)
    .single();

  if (user?.last_session_at) {
    return new Date(user.last_session_at);
  }

  // Fallback: из user_sessions
  const { data: session } = await supabase
    .from('user_sessions')
    .select('started_at')
    .eq('user_account_id', userId)
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  return session?.started_at ? new Date(session.started_at) : null;
}

/**
 * Вычисляет количество дней с последней сессии
 */
export async function getDaysSinceLastSession(userId: string): Promise<number | null> {
  const lastSession = await getLastSessionDate(userId);

  if (!lastSession) {
    return null;
  }

  const now = new Date();
  const diffMs = now.getTime() - lastSession.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// =====================================================
// Основная функция отправки
// =====================================================

/**
 * Централизованная отправка уведомлений
 * - Проверяет лимиты
 * - Проверяет cooldown
 * - Отправляет в Telegram и/или In-App
 * - Логирует в историю
 */
export async function sendEngagementNotification(
  options: SendNotificationOptions
): Promise<SendNotificationResult> {
  const { userId, template, variables = {}, metadata = {} } = options;

  const result: SendNotificationResult = {
    success: false,
    telegramSent: false,
    inAppCreated: false
  };

  try {
    // 1. Проверяем, включён ли тип
    const isEnabled = await isNotificationTypeEnabled(template.type);
    if (!isEnabled) {
      logger.debug({ userId, type: template.type }, 'Notification type is disabled');
      result.error = 'Type disabled';
      return result;
    }

    // 2. Проверяем лимиты
    const limits = await checkNotificationLimits(userId);
    if (!limits.canSend) {
      logger.info({
        userId,
        type: template.type,
        dailyCount: limits.dailyCount,
        weeklyCount: limits.weeklyCount
      }, 'Notification limit reached');
      result.error = 'Limit reached';
      return result;
    }

    // 3. Проверяем cooldown
    const canSend = await checkCooldown(userId, template.type, template.cooldownDays);
    if (!canSend) {
      logger.debug({
        userId,
        type: template.type,
        cooldownDays: template.cooldownDays
      }, 'Notification in cooldown period');
      result.error = 'In cooldown';
      return result;
    }

    // 4. Подготавливаем тексты
    const title = replaceVariables(template.title, variables);
    const message = replaceVariables(template.message, variables);
    const telegramMessage = replaceVariables(template.telegramMessage, variables);

    // 5. Создаем In-App уведомление
    if (template.channels.includes('in_app')) {
      const { data: notification, error } = await supabase
        .from('user_notifications')
        .insert({
          user_account_id: userId,
          type: template.type,
          title,
          message,
          metadata: {
            ...metadata,
            cta_url: template.ctaUrl,
            cta_label: template.ctaLabel
          }
        })
        .select('id')
        .single();

      if (!error && notification) {
        result.inAppCreated = true;
        result.notificationId = notification.id;
      } else {
        logger.error({ error: error?.message, userId }, 'Failed to create in-app notification');
      }
    }

    // 6. Отправляем в Telegram
    if (template.channels.includes('telegram')) {
      const telegramId = await getUserTelegramId(userId);

      if (telegramId) {
        const sent = await sendTelegramNotification(telegramId, telegramMessage);
        result.telegramSent = sent;

        // Обновляем статус в user_notifications
        if (sent && result.notificationId) {
          await supabase
            .from('user_notifications')
            .update({ telegram_sent: true })
            .eq('id', result.notificationId);
        }
      } else {
        logger.debug({ userId }, 'User has no telegram_id, skipping Telegram');
      }
    }

    // 7. Записываем в историю
    const channel = template.channels.length === 2 ? 'both' : template.channels[0];
    const { data: history } = await supabase
      .from('notification_history')
      .insert({
        user_account_id: userId,
        notification_type: template.type,
        channel,
        telegram_sent: result.telegramSent,
        in_app_created: result.inAppCreated,
        notification_id: result.notificationId || null,
        message_preview: message.substring(0, 200),
        metadata
      })
      .select('id')
      .single();

    result.historyId = history?.id;
    result.success = result.telegramSent || result.inAppCreated;

    logger.info({
      userId,
      type: template.type,
      telegramSent: result.telegramSent,
      inAppCreated: result.inAppCreated
    }, 'Engagement notification processed');

    return result;
  } catch (err) {
    logger.error({
      error: String(err),
      userId,
      type: template.type
    }, 'Exception in sendEngagementNotification');
    result.error = String(err);
    return result;
  }
}

// =====================================================
// Уведомления в админ-группу
// =====================================================

/**
 * Отправляет уведомление в группу техподдержки
 */
export async function notifyAdminGroup(message: string): Promise<boolean> {
  return sendTelegramNotification(TELEGRAM_TECH_CHAT_ID, message);
}
