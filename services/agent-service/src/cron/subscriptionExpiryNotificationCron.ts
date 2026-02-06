/**
 * Subscription Expiry Notification CRON
 *
 * Ежедневно отправляет Telegram-напоминания за 7/3/1 день
 * до окончания активной подписки.
 *
 * @module cron/subscriptionExpiryNotificationCron
 */

import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { sendTelegramNotification } from '../lib/telegramNotifier.js';
import type { RobokassaPlanSlug } from '../lib/robokassa.js';

const logger = createLogger({ module: 'subscriptionExpiryNotificationCron' });

const ALMATY_TIMEZONE = 'Asia/Almaty';
const REMINDER_DAYS = new Set([7, 3, 1]);
const PAYMENT_BASE_URL = (
  process.env.ROBO_REDIRECT_BASE_URL ||
  process.env.APP_URL ||
  'https://app.performanteaiagency.com/api'
).replace(/\/$/, '');

interface SubscriptionUserRow {
  id: string;
  username: string | null;
  telegram_id: string | null;
  is_active: boolean | null;
  tarif: string | null;
  tarif_expires: string | null;
  tarif_renewal_cost: number | string | null;
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
    0,
    0,
    0,
    0
  ));
}

function getDatePart(parts: Intl.DateTimeFormatPart[], type: 'year' | 'month' | 'day'): number {
  return Number(parts.find((part) => part.type === type)?.value || 0);
}

function getTodayAlmatyDateOnly(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ALMATY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = getDatePart(parts, 'year');
  const month = getDatePart(parts, 'month');
  const day = getDatePart(parts, 'day');

  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function formatDateRu(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = String(date.getUTCFullYear());
  return `${day}.${month}.${year}`;
}

function normalizeRenewalCost(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function resolvePaymentPlanSlug(params: {
  tarif: string | null;
  renewalCost: number | string | null;
}): RobokassaPlanSlug | null {
  const cost = normalizeRenewalCost(params.renewalCost);

  if (cost === 35000) return '1m-35k';
  if (cost === 49000) return '1m-49k';
  if (cost === 99000) return '3m-99k';
  if (cost === 500) return 'test-500';

  if (params.tarif === 'subscription_1m') return '1m-49k';
  if (params.tarif === 'subscription_3m') return '3m-99k';

  return null;
}

function buildPaymentRedirectUrl(params: {
  userId: string;
  planSlug: RobokassaPlanSlug;
}): string {
  const query = new URLSearchParams({
    plan: params.planSlug,
    user_id: params.userId,
  });
  return `${PAYMENT_BASE_URL}/robokassa/redirect?${query.toString()}`;
}

function escapeHtmlLink(url: string): string {
  return url
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function getDaysLabel(daysLeft: number): string {
  if (daysLeft === 1) return '1 день';
  if (daysLeft === 3) return '3 дня';
  return '7 дней';
}

function buildReminderMessage(params: {
  daysLeft: number;
  expiryDate: Date;
  paymentUrl: string;
}): string {
  const expiryDate = formatDateRu(params.expiryDate);
  const daysLabel = getDaysLabel(params.daysLeft);
  const paymentUrl = escapeHtmlLink(params.paymentUrl);

  return `<b>Подписка заканчивается через ${daysLabel}</b>

Ваша подписка активна до ${expiryDate}.
Чтобы доступ не прервался, продлите подписку заранее.

<a href="${paymentUrl}">Оплатить продление</a>`;
}

function getReminderType(daysLeft: number): string {
  if (daysLeft === 7) return 'subscription_expiring_7d';
  if (daysLeft === 3) return 'subscription_expiring_3d';
  return 'subscription_expiring_1d';
}

function getDaysLeft(targetDate: Date, todayDate: Date): number {
  return Math.floor((targetDate.getTime() - todayDate.getTime()) / (24 * 60 * 60 * 1000));
}

async function fetchSubscriptionUsers(): Promise<SubscriptionUserRow[]> {
  const users: SubscriptionUserRow[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('user_accounts')
      .select('id, username, telegram_id, is_active, tarif, tarif_expires, tarif_renewal_cost')
      .eq('is_tech_admin', false)
      .eq('is_active', true)
      .like('tarif', 'subscription_%')
      .not('tarif_expires', 'is', null)
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    const batch = (data || []) as SubscriptionUserRow[];
    if (batch.length === 0) {
      break;
    }

    users.push(...batch);
    if (batch.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return users;
}

async function wasReminderSent(args: {
  userId: string;
  reminderType: string;
  expiryDate: string;
}): Promise<boolean> {
  const { count, error } = await supabase
    .from('notification_history')
    .select('*', { count: 'exact', head: true })
    .eq('user_account_id', args.userId)
    .eq('notification_type', args.reminderType)
    .eq('telegram_sent', true)
    .contains('metadata', {
      source: 'subscription_expiry_cron',
      expiry_date: args.expiryDate,
    });

  if (error) {
    logger.warn({
      userId: args.userId,
      reminderType: args.reminderType,
      error: error.message,
    }, 'Failed to check duplicate subscription reminder');
    return false;
  }

  return (count || 0) > 0;
}

async function saveReminderHistory(args: {
  userId: string;
  reminderType: string;
  messagePreview: string;
  expiryDate: string;
  daysLeft: number;
  planSlug: RobokassaPlanSlug;
  paymentUrl: string;
  tarif: string | null;
  renewalCost: number | string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('notification_history')
    .insert({
      user_account_id: args.userId,
      notification_type: args.reminderType,
      channel: 'telegram',
      telegram_sent: true,
      in_app_created: false,
      notification_id: null,
      message_preview: args.messagePreview,
      metadata: {
        source: 'subscription_expiry_cron',
        expiry_date: args.expiryDate,
        days_left: args.daysLeft,
        plan_slug: args.planSlug,
        payment_url: args.paymentUrl,
        tarif: args.tarif,
        tarif_renewal_cost: args.renewalCost,
      },
    });

  if (error) {
    throw new Error(error.message);
  }
}

async function processSubscriptionExpiryNotifications(): Promise<void> {
  logger.info('Starting subscription expiry reminders processing');

  const today = getTodayAlmatyDateOnly();
  const users = await fetchSubscriptionUsers();

  let checked = 0;
  let eligible = 0;
  let sent = 0;
  let skippedNoTelegram = 0;
  let skippedNoPlan = 0;
  let skippedNotDue = 0;
  let skippedDuplicate = 0;
  let errors = 0;

  for (const user of users) {
    checked += 1;

    try {
      const expiryDate = parseDateOnly(user.tarif_expires);
      if (!expiryDate) {
        skippedNotDue += 1;
        continue;
      }

      const daysLeft = getDaysLeft(expiryDate, today);
      if (!REMINDER_DAYS.has(daysLeft)) {
        skippedNotDue += 1;
        continue;
      }

      if (!user.telegram_id || user.telegram_id.trim().length === 0) {
        skippedNoTelegram += 1;
        continue;
      }

      const planSlug = resolvePaymentPlanSlug({
        tarif: user.tarif,
        renewalCost: user.tarif_renewal_cost,
      });
      if (!planSlug) {
        skippedNoPlan += 1;
        logger.warn({
          userId: user.id,
          username: user.username,
          tarif: user.tarif,
          renewalCost: user.tarif_renewal_cost,
        }, 'Skipping subscription reminder: unable to resolve Robokassa plan');
        continue;
      }

      const reminderType = getReminderType(daysLeft);
      const expiryDateKey = expiryDate.toISOString().slice(0, 10);
      const duplicate = await wasReminderSent({
        userId: user.id,
        reminderType,
        expiryDate: expiryDateKey,
      });
      if (duplicate) {
        skippedDuplicate += 1;
        continue;
      }

      const paymentUrl = buildPaymentRedirectUrl({
        userId: user.id,
        planSlug,
      });
      const message = buildReminderMessage({
        daysLeft,
        expiryDate,
        paymentUrl,
      });

      eligible += 1;

      const telegramSent = await sendTelegramNotification(user.telegram_id, message, {
        userAccountId: user.id,
        source: 'bot',
      });

      if (!telegramSent) {
        errors += 1;
        continue;
      }

      await saveReminderHistory({
        userId: user.id,
        reminderType,
        messagePreview: `Подписка истекает через ${daysLeft} дн. До ${formatDateRu(expiryDate)}`,
        expiryDate: expiryDateKey,
        daysLeft,
        planSlug,
        paymentUrl,
        tarif: user.tarif,
        renewalCost: user.tarif_renewal_cost,
      });

      sent += 1;
    } catch (err) {
      errors += 1;
      logger.error({ userId: user.id, error: String(err) }, 'Failed to process subscription reminder for user');
    }
  }

  logger.info({
    checked,
    eligible,
    sent,
    skippedNoTelegram,
    skippedNoPlan,
    skippedNotDue,
    skippedDuplicate,
    errors,
    paymentBaseUrl: PAYMENT_BASE_URL,
  }, 'Subscription expiry reminders processing completed');
}

export function startSubscriptionExpiryNotificationCron(app: FastifyInstance): void {
  app.log.info('Subscription expiry notification cron started (runs daily at 10:05 Almaty)');

  cron.schedule('5 10 * * *', async () => {
    try {
      await processSubscriptionExpiryNotifications();
    } catch (err) {
      logger.error({ error: String(err) }, 'Unexpected error in subscription expiry notification cron');
    }
  }, {
    timezone: ALMATY_TIMEZONE,
  });
}

export async function runSubscriptionExpiryNotificationsManually(): Promise<void> {
  await processSubscriptionExpiryNotifications();
}
