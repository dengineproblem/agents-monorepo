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
  template_overrides: Record<string, Record<string, unknown>>;
  is_active: boolean;
}

export interface NotificationLimits {
  canSend: boolean;
  dailyCount: number;
  weeklyCount: number;
  dailyLimit: number;
  weeklyLimit: number;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    const next = String(item || '').trim();
    if (!next) continue;
    unique.add(next);
  }
  return Array.from(unique);
}

function normalizeCooldowns(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const mapped: Record<string, number> = {};
  for (const [type, cooldown] of Object.entries(value as Record<string, unknown>)) {
    const cooldownNumber = Number(cooldown);
    if (!Number.isFinite(cooldownNumber)) continue;
    mapped[type] = Math.max(0, Math.min(9999, Math.round(cooldownNumber)));
  }
  return mapped;
}

function normalizeTemplateOverrides(value: unknown): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const mapped: Record<string, Record<string, unknown>> = {};
  for (const [type, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    mapped[type] = raw as Record<string, unknown>;
  }

  return mapped;
}

function normalizeChannels(
  value: unknown,
  fallback: ('telegram' | 'in_app')[]
): ('telegram' | 'in_app')[] {
  if (!Array.isArray(value)) return fallback;

  const next: ('telegram' | 'in_app')[] = [];
  for (const channel of value) {
    const normalized = String(channel || '').trim();
    if ((normalized === 'telegram' || normalized === 'in_app') && !next.includes(normalized)) {
      next.push(normalized);
    }
  }

  return next.length > 0 ? next : fallback;
}

function applyTemplateOverrides(
  template: NotificationTemplate,
  settings: NotificationSettings | null
): NotificationTemplate {
  if (!settings) return template;

  const rawOverride = settings.template_overrides?.[template.type];
  const override = rawOverride && typeof rawOverride === 'object' ? rawOverride : {};

  const overrideCooldown = Number((override as any).cooldown_days);
  const cooldownRaw = settings.type_cooldowns?.[template.type];
  const legacyCooldownRaw =
    template.type.startsWith('onboarding_') ? settings.type_cooldowns?.onboarding_reminder : undefined;
  const cooldownByType = Number(cooldownRaw ?? legacyCooldownRaw);
  const cooldownDays = Number.isFinite(overrideCooldown)
    ? Math.max(0, Math.min(9999, Math.round(overrideCooldown)))
    : Number.isFinite(cooldownByType)
      ? Math.max(0, Math.min(9999, Math.round(cooldownByType)))
      : template.cooldownDays;

  return {
    ...template,
    title: typeof (override as any).title === 'string' && (override as any).title.trim().length > 0
      ? String((override as any).title)
      : template.title,
    message: typeof (override as any).message === 'string' && (override as any).message.trim().length > 0
      ? String((override as any).message)
      : template.message,
    telegramMessage: typeof (override as any).telegram_message === 'string' && (override as any).telegram_message.trim().length > 0
      ? String((override as any).telegram_message)
      : template.telegramMessage,
    ctaUrl: typeof (override as any).cta_url === 'string'
      ? String((override as any).cta_url)
      : template.ctaUrl,
    ctaLabel: typeof (override as any).cta_label === 'string'
      ? String((override as any).cta_label)
      : template.ctaLabel,
    channels: normalizeChannels((override as any).channels, template.channels),
    cooldownDays,
  };
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

  return {
    id: data.id,
    daily_limit: Number(data.daily_limit ?? 3),
    weekly_limit: Number(data.weekly_limit ?? 10),
    send_hour: Number(data.send_hour ?? 4),
    type_cooldowns: normalizeCooldowns(data.type_cooldowns),
    enabled_types: normalizeStringArray(data.enabled_types),
    template_overrides: normalizeTemplateOverrides((data as any).template_overrides),
    is_active: Boolean(data.is_active),
  };
}

// =====================================================
// Проверка лимитов
// =====================================================

/**
 * Проверяет, не превышен ли лимит уведомлений для пользователя
 */
export async function checkNotificationLimits(
  userId: string,
  settingsOverride?: NotificationSettings | null
): Promise<NotificationLimits> {
  const settings = settingsOverride ?? await getNotificationSettings();
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
export async function isNotificationTypeEnabled(
  notificationType: string,
  settingsOverride?: NotificationSettings | null
): Promise<boolean> {
  const settings = settingsOverride ?? await getNotificationSettings();

  if (!settings?.is_active) {
    return false;
  }

  const enabledTypes = settings.enabled_types || [];
  if (enabledTypes.includes(notificationType)) {
    return true;
  }

  if (notificationType.startsWith('onboarding_') && enabledTypes.includes('onboarding_reminder')) {
    return true;
  }

  return false;
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
    const settings = await getNotificationSettings();
    const effectiveTemplate = applyTemplateOverrides(template, settings);

    // 1. Проверяем, включён ли тип
    const isEnabled = await isNotificationTypeEnabled(effectiveTemplate.type, settings);
    if (!isEnabled) {
      logger.debug({ userId, type: effectiveTemplate.type }, 'Notification type is disabled');
      result.error = 'Type disabled';
      return result;
    }

    // 2. Проверяем лимиты
    const limits = await checkNotificationLimits(userId, settings);
    if (!limits.canSend) {
      logger.info({
        userId,
        type: effectiveTemplate.type,
        dailyCount: limits.dailyCount,
        weeklyCount: limits.weeklyCount
      }, 'Notification limit reached');
      result.error = 'Limit reached';
      return result;
    }

    // 3. Проверяем cooldown
    const canSend = await checkCooldown(
      userId,
      effectiveTemplate.type,
      effectiveTemplate.cooldownDays
    );
    if (!canSend) {
      logger.debug({
        userId,
        type: effectiveTemplate.type,
        cooldownDays: effectiveTemplate.cooldownDays
      }, 'Notification in cooldown period');
      result.error = 'In cooldown';
      return result;
    }

    // 4. Подготавливаем тексты
    const title = replaceVariables(effectiveTemplate.title, variables);
    const message = replaceVariables(effectiveTemplate.message, variables);
    const telegramMessage = replaceVariables(effectiveTemplate.telegramMessage, variables);

    // 5. Создаем In-App уведомление
    if (effectiveTemplate.channels.includes('in_app')) {
      const { data: notification, error } = await supabase
        .from('user_notifications')
        .insert({
          user_account_id: userId,
          type: effectiveTemplate.type,
          title,
          message,
          metadata: {
            ...metadata,
            cta_url: effectiveTemplate.ctaUrl,
            cta_label: effectiveTemplate.ctaLabel
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
    if (effectiveTemplate.channels.includes('telegram')) {
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
    const channel = effectiveTemplate.channels.length === 2 ? 'both' : effectiveTemplate.channels[0];
    const { data: history } = await supabase
      .from('notification_history')
      .insert({
        user_account_id: userId,
        notification_type: effectiveTemplate.type,
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
      type: effectiveTemplate.type,
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
