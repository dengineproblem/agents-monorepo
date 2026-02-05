import { supabase } from './supabase.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'subscriptionBilling' });

const ALMATY_OFFSET_HOURS = 5;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

interface UserAccountSubscriptionRow {
  id: string;
  username: string;
  created_at: string | null;
  tarif: string | null;
  tarif_expires: string | null;
  is_active: boolean | null;
}

interface UserForSubscriptionSweep extends UserAccountSubscriptionRow {
  telegram_id: string | null;
  telegram_id_2: string | null;
  telegram_id_3: string | null;
  telegram_id_4: string | null;
}

interface NotificationDispatchResult {
  notificationId: string | null;
  inAppCreated: boolean;
  telegramSent: boolean;
  channel: 'in_app' | 'telegram' | 'both' | 'none';
}

export interface ApplySubscriptionParams {
  userAccountId: string;
  months: number;
  renewalCost: number;
  actorUserAccountId?: string;
  source?: string;
  sourceSaleId?: string;
  comment?: string;
  startDate?: string;
  forceStartDate?: boolean;
}

export interface ApplySubscriptionResult {
  userAccountId: string;
  previousTarif: string | null;
  previousTarifExpires: string | null;
  newTarif: string;
  newTarifExpires: string;
  startDateUsed: string;
  months: number;
  renewalCost: number;
}

export interface SubscriptionBillingSweepStats {
  scannedUsers: number;
  remindersSent: number;
  remindersSkipped: number;
  deactivatedUsers: number;
  errors: number;
}

export function normalizePhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');

  if (digits.length < 10) {
    throw new Error('Phone must contain at least 10 digits');
  }

  if (digits.length > 15) {
    throw new Error('Phone is too long');
  }

  if (digits.length === 10) {
    return `7${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('8')) {
    return `7${digits.slice(1)}`;
  }

  return digits;
}

export function getAlmatyTodayDateString(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + ALMATY_OFFSET_HOURS * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getAlmatyDayStartUtcIso(dateString: string): string {
  const [year, month, day] = dateString.split('-').map(Number);
  const utcMs = Date.UTC(year, month - 1, day, -ALMATY_OFFSET_HOURS, 0, 0, 0);
  return new Date(utcMs).toISOString();
}

export function dateDiffInDays(fromDate: string, toDate: string): number {
  const fromUtc = toUtcDay(fromDate);
  const toUtc = toUtcDay(toDate);
  return Math.floor((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
}

function toUtcDay(dateString: string): number {
  const [y, m, d] = dateString.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function toDateString(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${value}`);
  }

  return date.toISOString().slice(0, 10);
}

export function getTarifCodeByMonths(months: number): string {
  if (months === 1) return 'subscription_1m';
  if (months === 3) return 'subscription_3m';
  if (months === 12) return 'subscription_12m';
  return `subscription_${months}m`;
}

export function addMonthsToDateString(dateString: string, months: number): string {
  const [y, m, d] = dateString.split('-').map(Number);

  const result = new Date(Date.UTC(y, m - 1, d));
  const originalDay = result.getUTCDate();

  result.setUTCMonth(result.getUTCMonth() + months);

  // Clamp to month end when original day does not exist in target month
  if (result.getUTCDate() !== originalDay) {
    result.setUTCDate(0);
  }

  return result.toISOString().slice(0, 10);
}

function resolveSubscriptionStartDate(args: {
  currentTarifExpires: string | null;
  userCreatedAt: string | null;
  explicitStartDate?: string;
  today: string;
  forceStartDate?: boolean;
}): string {
  const { currentTarifExpires, userCreatedAt, explicitStartDate, today, forceStartDate } = args;

  if (!forceStartDate && currentTarifExpires) {
    const currentExpiry = toDateString(currentTarifExpires);

    // Продление только если текущий срок в будущем (по ТЗ)
    if (currentExpiry > today) {
      return currentExpiry;
    }
  }

  if (explicitStartDate) {
    return toDateString(explicitStartDate);
  }

  if (userCreatedAt) {
    return toDateString(userCreatedAt);
  }

  return today;
}

async function createInAppNotification(params: {
  userAccountId: string;
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_notifications')
    .insert({
      user_account_id: params.userAccountId,
      type: params.type,
      title: params.title,
      message: params.message,
      metadata: params.metadata || {}
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) {
    log.warn({
      userAccountId: params.userAccountId,
      type: params.type,
      error: error?.message
    }, 'Failed to create in-app notification');
    return null;
  }

  return data.id;
}

async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    return false;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      })
    });

    if (!response.ok) {
      const textResponse = await response.text();
      log.warn({ chatId, status: response.status, response: textResponse }, 'Telegram send failed');
      return false;
    }

    return true;
  } catch (error: any) {
    log.warn({ chatId, error: error.message }, 'Telegram send exception');
    return false;
  }
}

function extractTelegramIds(user: UserForSubscriptionSweep): string[] {
  const rawIds = [user.telegram_id, user.telegram_id_2, user.telegram_id_3, user.telegram_id_4]
    .map((value) => (value || '').trim())
    .filter((value) => value.length > 0);

  return Array.from(new Set(rawIds));
}

function resolveChannel(inAppCreated: boolean, telegramSent: boolean): 'in_app' | 'telegram' | 'both' | 'none' {
  if (inAppCreated && telegramSent) return 'both';
  if (inAppCreated) return 'in_app';
  if (telegramSent) return 'telegram';
  return 'none';
}

async function dispatchUserNotification(params: {
  user: UserForSubscriptionSweep;
  type: string;
  title: string;
  message: string;
  telegramMessage: string;
  metadata?: Record<string, unknown>;
}): Promise<NotificationDispatchResult> {
  const notificationId = await createInAppNotification({
    userAccountId: params.user.id,
    type: params.type,
    title: params.title,
    message: params.message,
    metadata: params.metadata
  });

  let telegramSent = false;
  const telegramIds = extractTelegramIds(params.user);
  for (const telegramId of telegramIds) {
    const sent = await sendTelegramMessage(telegramId, params.telegramMessage);
    telegramSent = telegramSent || sent;
  }

  const inAppCreated = Boolean(notificationId);
  const channel = resolveChannel(inAppCreated, telegramSent);

  return {
    notificationId,
    inAppCreated,
    telegramSent,
    channel
  };
}

async function insertNotificationHistory(params: {
  userAccountId: string;
  notificationType: string;
  channel: 'in_app' | 'telegram' | 'both' | 'none';
  telegramSent: boolean;
  inAppCreated: boolean;
  notificationId: string | null;
  messagePreview: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase
    .from('notification_history')
    .insert({
      user_account_id: params.userAccountId,
      notification_type: params.notificationType,
      channel: params.channel,
      telegram_sent: params.telegramSent,
      in_app_created: params.inAppCreated,
      notification_id: params.notificationId,
      message_preview: params.messagePreview,
      metadata: params.metadata || {}
    });

  if (error) {
    log.warn({ userAccountId: params.userAccountId, error: error.message }, 'Failed to insert notification history');
  }
}

async function hasNotificationSentSince(params: {
  userAccountId: string;
  notificationType: string;
  sinceIso: string;
}): Promise<boolean> {
  const { count, error } = await supabase
    .from('notification_history')
    .select('*', { count: 'exact', head: true })
    .eq('user_account_id', params.userAccountId)
    .eq('notification_type', params.notificationType)
    .gte('created_at', params.sinceIso);

  if (error) {
    log.warn({
      userAccountId: params.userAccountId,
      notificationType: params.notificationType,
      error: error.message
    }, 'Failed to check notification deduplication');
    return false;
  }

  return (count || 0) > 0;
}

async function createSubscriptionUpdateInAppNotification(params: {
  userAccountId: string;
  tarif: string;
  tarifExpires: string;
  months: number;
  renewalCost: number;
}): Promise<void> {
  const title = 'Подписка обновлена';
  const message = `Подписка продлена на ${params.months} мес. до ${params.tarifExpires}.`;

  const notificationId = await createInAppNotification({
    userAccountId: params.userAccountId,
    type: 'subscription_updated',
    title,
    message,
    metadata: {
      tarif: params.tarif,
      tarif_expires: params.tarifExpires,
      months: params.months,
      renewal_cost: params.renewalCost
    }
  });

  await insertNotificationHistory({
    userAccountId: params.userAccountId,
    notificationType: 'subscription_updated',
    channel: notificationId ? 'in_app' : 'none',
    telegramSent: false,
    inAppCreated: Boolean(notificationId),
    notificationId,
    messagePreview: message,
    metadata: {
      tarif: params.tarif,
      tarif_expires: params.tarifExpires,
      months: params.months,
      renewal_cost: params.renewalCost
    }
  });
}

export async function applySubscriptionToUserAccount(
  params: ApplySubscriptionParams
): Promise<ApplySubscriptionResult> {
  if (!params.userAccountId) {
    throw new Error('userAccountId is required');
  }

  if (!Number.isInteger(params.months) || params.months <= 0) {
    throw new Error('months must be a positive integer');
  }

  if (params.renewalCost < 0) {
    throw new Error('renewalCost must be >= 0');
  }

  const { data: user, error: userError } = await supabase
    .from('user_accounts')
    .select('id, username, created_at, tarif, tarif_expires, is_active')
    .eq('id', params.userAccountId)
    .single<UserAccountSubscriptionRow>();

  if (userError || !user) {
    throw new Error(`User account not found: ${params.userAccountId}`);
  }

  const todayAlmaty = getAlmatyTodayDateString();
  const startDate = resolveSubscriptionStartDate({
    currentTarifExpires: user.tarif_expires,
    userCreatedAt: user.created_at,
    explicitStartDate: params.startDate,
    today: todayAlmaty,
    forceStartDate: params.forceStartDate
  });

  const newTarifExpires = addMonthsToDateString(startDate, params.months);
  const newTarif = getTarifCodeByMonths(params.months);

  const { error: updateError } = await supabase
    .from('user_accounts')
    .update({
      tarif: newTarif,
      tarif_expires: newTarifExpires,
      tarif_renewal_cost: params.renewalCost,
      is_active: true
    })
    .eq('id', params.userAccountId);

  if (updateError) {
    throw new Error(`Failed to update user subscription: ${updateError.message}`);
  }

  await createSubscriptionUpdateInAppNotification({
    userAccountId: params.userAccountId,
    tarif: newTarif,
    tarifExpires: newTarifExpires,
    months: params.months,
    renewalCost: params.renewalCost
  });

  // Best-effort history row; failures do not break business flow
  await insertNotificationHistory({
    userAccountId: params.userAccountId,
    notificationType: 'subscription_applied',
    channel: 'in_app',
    telegramSent: false,
    inAppCreated: true,
    notificationId: null,
    messagePreview: `Subscription applied until ${newTarifExpires}`,
    metadata: {
      source: params.source || 'manual',
      source_sale_id: params.sourceSaleId || null,
      actor_user_account_id: params.actorUserAccountId || null,
      comment: params.comment || null,
      months: params.months,
      renewal_cost: params.renewalCost,
      old_tarif: user.tarif,
      old_tarif_expires: user.tarif_expires,
      new_tarif: newTarif,
      new_tarif_expires: newTarifExpires
    }
  });

  log.info({
    userAccountId: params.userAccountId,
    previousTarif: user.tarif,
    previousTarifExpires: user.tarif_expires,
    newTarif,
    newTarifExpires,
    months: params.months,
    renewalCost: params.renewalCost
  }, 'Subscription applied to user account');

  return {
    userAccountId: params.userAccountId,
    previousTarif: user.tarif,
    previousTarifExpires: user.tarif_expires,
    newTarif,
    newTarifExpires,
    startDateUsed: startDate,
    months: params.months,
    renewalCost: params.renewalCost
  };
}

async function sendExpiryReminderNotification(
  user: UserForSubscriptionSweep,
  daysLeft: 1 | 3 | 7,
  todayAlmaty: string
): Promise<boolean> {
  if (!user.tarif_expires) {
    return false;
  }

  const notificationType = `subscription_expiry_d${daysLeft}`;
  const dayStartUtcIso = getAlmatyDayStartUtcIso(todayAlmaty);
  const alreadySent = await hasNotificationSentSince({
    userAccountId: user.id,
    notificationType,
    sinceIso: dayStartUtcIso
  });

  if (alreadySent) {
    return false;
  }

  const title = 'Подписка скоро закончится';
  const message = `До окончания подписки осталось ${daysLeft} дн. Дата окончания: ${user.tarif_expires}.`;
  const telegramMessage = `Напоминание: до окончания подписки осталось ${daysLeft} дн.\nДата окончания: ${user.tarif_expires}.`;

  const dispatch = await dispatchUserNotification({
    user,
    type: notificationType,
    title,
    message,
    telegramMessage,
    metadata: {
      days_left: daysLeft,
      tarif_expires: user.tarif_expires,
      tarif: user.tarif
    }
  });

  await insertNotificationHistory({
    userAccountId: user.id,
    notificationType,
    channel: dispatch.channel,
    telegramSent: dispatch.telegramSent,
    inAppCreated: dispatch.inAppCreated,
    notificationId: dispatch.notificationId,
    messagePreview: message,
    metadata: {
      days_left: daysLeft,
      tarif_expires: user.tarif_expires,
      tarif: user.tarif
    }
  });

  return dispatch.channel !== 'none';
}

async function deactivateExpiredAccount(user: UserForSubscriptionSweep, todayAlmaty: string): Promise<boolean> {
  if (!user.tarif_expires) {
    return false;
  }

  if (user.tarif_expires >= todayAlmaty) {
    return false;
  }

  if (user.is_active === false) {
    return false;
  }

  const { error: updateError } = await supabase
    .from('user_accounts')
    .update({ is_active: false })
    .eq('id', user.id);

  if (updateError) {
    log.error({ userAccountId: user.id, error: updateError.message }, 'Failed to deactivate expired account');
    return false;
  }

  const notificationType = 'subscription_expired';
  const dayStartUtcIso = getAlmatyDayStartUtcIso(todayAlmaty);
  const alreadySent = await hasNotificationSentSince({
    userAccountId: user.id,
    notificationType,
    sinceIso: dayStartUtcIso
  });

  if (!alreadySent) {
    const title = 'Подписка истекла';
    const message = `Подписка истекла ${user.tarif_expires}. Доступ переведен в read-only режим.`;
    const telegramMessage = `Подписка истекла ${user.tarif_expires}.\nДоступ переведен в read-only режим.`;

    const dispatch = await dispatchUserNotification({
      user,
      type: notificationType,
      title,
      message,
      telegramMessage,
      metadata: {
        tarif_expires: user.tarif_expires,
        read_only: true
      }
    });

    await insertNotificationHistory({
      userAccountId: user.id,
      notificationType,
      channel: dispatch.channel,
      telegramSent: dispatch.telegramSent,
      inAppCreated: dispatch.inAppCreated,
      notificationId: dispatch.notificationId,
      messagePreview: message,
      metadata: {
        tarif_expires: user.tarif_expires,
        read_only: true
      }
    });
  }

  return true;
}

export async function processSubscriptionBillingSweep(): Promise<SubscriptionBillingSweepStats> {
  const stats: SubscriptionBillingSweepStats = {
    scannedUsers: 0,
    remindersSent: 0,
    remindersSkipped: 0,
    deactivatedUsers: 0,
    errors: 0
  };

  const todayAlmaty = getAlmatyTodayDateString();

  const { data: users, error } = await supabase
    .from('user_accounts')
    .select('id, username, created_at, tarif, tarif_expires, is_active, telegram_id, telegram_id_2, telegram_id_3, telegram_id_4')
    .eq('is_tech_admin', false)
    .not('tarif_expires', 'is', null);

  if (error) {
    throw new Error(`Failed to fetch users for subscription sweep: ${error.message}`);
  }

  const sweepUsers = (users || []) as UserForSubscriptionSweep[];
  stats.scannedUsers = sweepUsers.length;

  for (const user of sweepUsers) {
    try {
      const expiryDate = toDateString(String(user.tarif_expires));
      const daysLeft = dateDiffInDays(todayAlmaty, expiryDate);

      if (user.is_active !== false && (daysLeft === 7 || daysLeft === 3 || daysLeft === 1)) {
        const reminderSent = await sendExpiryReminderNotification(user, daysLeft as 1 | 3 | 7, todayAlmaty);
        if (reminderSent) {
          stats.remindersSent += 1;
        } else {
          stats.remindersSkipped += 1;
        }
      }

      const deactivated = await deactivateExpiredAccount(user, todayAlmaty);
      if (deactivated) {
        stats.deactivatedUsers += 1;
      }
    } catch (error: any) {
      stats.errors += 1;
      log.error({ userAccountId: user.id, error: error.message }, 'Error during subscription sweep user processing');
    }
  }

  log.info({
    todayAlmaty,
    ...stats
  }, 'Subscription billing sweep completed');

  return stats;
}

export async function isTechAdminUser(userAccountId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_accounts')
    .select('is_tech_admin')
    .eq('id', userAccountId)
    .maybeSingle<{ is_tech_admin: boolean | null }>();

  if (error || !data) {
    return false;
  }

  return data.is_tech_admin === true;
}
