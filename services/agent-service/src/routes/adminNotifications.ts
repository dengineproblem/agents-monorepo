/**
 * Admin Notifications Routes
 *
 * API для уведомлений в админ-панели:
 * - dropdown уведомления админов
 * - конструктор пользовательских уведомлений
 * - массовая отправка по сегментам
 * - история фактических отправок
 *
 * @module routes/adminNotifications
 */

import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import { NOTIFICATION_TEMPLATES } from '../lib/notificationTemplates.js';
import { sendTelegramNotification } from '../lib/telegramNotifier.js';

const log = createLogger({ module: 'adminNotifications' });

const SETTINGS_ID = '00000000-0000-0000-0000-000000000001';
const CHANNELS = ['telegram', 'in_app'] as const;

type NotificationChannel = typeof CHANNELS[number];

interface TemplateOverride {
  title?: string;
  message?: string;
  telegram_message?: string;
  cta_url?: string | null;
  cta_label?: string | null;
  cooldown_days?: number;
  channels?: NotificationChannel[];
}

interface ParsedSettings {
  daily_limit: number;
  weekly_limit: number;
  send_hour: number;
  is_active: boolean;
  enabled_types: string[];
  type_cooldowns: Record<string, number>;
  template_overrides: Record<string, TemplateOverride>;
}

const BROADCAST_SEGMENTS = [
  'all',
  'all_active',
  'subscription_active',
  'with_telegram',
  'without_subscription',
  'subscription_expiring_7d',
  'custom',
] as const;

type BroadcastSegment = typeof BROADCAST_SEGMENTS[number];

interface BroadcastRecipientRow {
  id: string;
  telegram_id: string | null;
  is_active: boolean | null;
  tarif: string | null;
  tarif_expires: string | null;
}

interface BroadcastPayload {
  type: string;
  title: string;
  message: string;
  telegram_message?: string;
  cta_url?: string;
  cta_label?: string;
  channels: NotificationChannel[];
  segment: BroadcastSegment;
  user_ids?: string[];
  only_with_telegram: boolean;
}

interface BroadcastExecutionOptions {
  senderId?: string | null;
  source: 'admin_broadcast' | 'scheduled_campaign';
  campaignId?: string | null;
}

interface BroadcastExecutionResult {
  success: true;
  broadcast_id: string;
  recipients: number;
  in_app_created: number;
  telegram_sent: number;
  telegram_failed: number;
}

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  type: z.string().optional(),
  user_id: z.string().uuid().optional(),
  search: z.string().optional(),
});

const recipientsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  search: z.string().optional(),
});

const settingsUpdateSchema = z.object({
  daily_limit: z.coerce.number().int().min(0).max(1000).optional(),
  weekly_limit: z.coerce.number().int().min(0).max(5000).optional(),
  send_hour: z.coerce.number().int().min(0).max(23).optional(),
  is_active: z.boolean().optional(),
  enabled_types: z.array(z.string().min(1)).optional(),
  type_cooldowns: z.record(z.coerce.number().int().min(0).max(9999)).optional(),
});

const templateUpdateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  message: z.string().min(1).optional(),
  telegram_message: z.string().min(1).optional(),
  cta_url: z.string().optional(),
  cta_label: z.string().optional(),
  cooldown_days: z.coerce.number().int().min(0).max(9999).optional(),
  channels: z.array(z.enum(CHANNELS)).min(1).optional(),
  enabled: z.boolean().optional(),
});

const broadcastSchema = z.object({
  type: z.string().min(1).max(80).default('admin_broadcast'),
  title: z.string().min(1).max(255),
  message: z.string().min(1),
  telegram_message: z.string().optional(),
  cta_url: z.string().optional(),
  cta_label: z.string().optional(),
  channels: z.array(z.enum(CHANNELS)).min(1).default(['in_app']),
  segment: z.enum(BROADCAST_SEGMENTS).default('all'),
  user_ids: z.array(z.string().uuid()).optional(),
  only_with_telegram: z.boolean().default(false),
});

const campaignCreateSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.string().min(1).max(80).default('admin_broadcast'),
  title: z.string().min(1).max(255),
  message: z.string().min(1),
  telegram_message: z.string().optional(),
  cta_url: z.string().optional(),
  cta_label: z.string().optional(),
  channels: z.array(z.enum(CHANNELS)).min(1).default(['in_app']),
  segment: z.enum(BROADCAST_SEGMENTS).default('all_active'),
  user_ids: z.array(z.string().uuid()).optional(),
  only_with_telegram: z.boolean().default(false),
  schedule_mode: z.enum(['once', 'daily', 'weekly']),
  scheduled_at: z.string().optional(),
  send_hour_utc: z.coerce.number().int().min(0).max(23).optional(),
  send_minute_utc: z.coerce.number().int().min(0).max(59).default(0),
  weekly_day: z.coerce.number().int().min(0).max(6).optional(),
  is_active: z.boolean().default(true),
});

const campaignUpdateSchema = campaignCreateSchema.partial();

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (items.length === 0) return [];

  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
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

function normalizeChannels(value: unknown, fallback: NotificationChannel[]): NotificationChannel[] {
  if (!Array.isArray(value)) return fallback;

  const next: NotificationChannel[] = [];
  for (const channel of value) {
    const normalized = String(channel || '').trim() as NotificationChannel;
    if (CHANNELS.includes(normalized) && !next.includes(normalized)) {
      next.push(normalized);
    }
  }

  return next.length > 0 ? next : fallback;
}

function normalizeCooldownMap(value: unknown): Record<string, number> {
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

function normalizeTemplateOverrides(value: unknown): Record<string, TemplateOverride> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, TemplateOverride> = {};
  for (const [type, rawOverride] of Object.entries(value as Record<string, unknown>)) {
    if (!rawOverride || typeof rawOverride !== 'object' || Array.isArray(rawOverride)) {
      continue;
    }

    const source = rawOverride as Record<string, unknown>;
    const cooldown = Number(source.cooldown_days);
    const override: TemplateOverride = {
      title: typeof source.title === 'string' ? source.title : undefined,
      message: typeof source.message === 'string' ? source.message : undefined,
      telegram_message: typeof source.telegram_message === 'string' ? source.telegram_message : undefined,
      cta_url: source.cta_url === null || typeof source.cta_url === 'string' ? (source.cta_url as string | null) : undefined,
      cta_label: source.cta_label === null || typeof source.cta_label === 'string' ? (source.cta_label as string | null) : undefined,
      channels: normalizeChannels(source.channels, ['telegram', 'in_app']),
      cooldown_days: Number.isFinite(cooldown) ? Math.max(0, Math.min(9999, Math.round(cooldown))) : undefined,
    };

    result[type] = override;
  }

  return result;
}

function parseSettingsRow(row: any): ParsedSettings {
  return {
    daily_limit: Number(row?.daily_limit ?? 3),
    weekly_limit: Number(row?.weekly_limit ?? 10),
    send_hour: Number(row?.send_hour ?? 4),
    is_active: Boolean(row?.is_active),
    enabled_types: normalizeStringArray(row?.enabled_types),
    type_cooldowns: normalizeCooldownMap(row?.type_cooldowns),
    template_overrides: normalizeTemplateOverrides(row?.template_overrides),
  };
}

function getDefaultsByType() {
  const templateByType = new Map<string, any>();
  const keysByType = new Map<string, string[]>();

  for (const [templateKey, template] of Object.entries(NOTIFICATION_TEMPLATES)) {
    const type = String((template as any)?.type || templateKey).trim();
    if (!type) continue;

    if (!keysByType.has(type)) keysByType.set(type, []);
    keysByType.get(type)!.push(templateKey);

    if (!templateByType.has(type)) {
      templateByType.set(type, template);
    }
  }

  return { templateByType, keysByType };
}

function buildTemplateList(settings: ParsedSettings) {
  const { templateByType, keysByType } = getDefaultsByType();
  const entries = Array.from(templateByType.entries()).sort(([a], [b]) => a.localeCompare(b));

  return entries.map(([type, defaultTemplate]) => {
    const override = settings.template_overrides[type] || {};
    const fallbackChannels: NotificationChannel[] = normalizeChannels(defaultTemplate.channels, ['telegram', 'in_app']);
    const channels = normalizeChannels(override.channels, fallbackChannels);
    const cooldownFromType = settings.type_cooldowns[type]
      ?? (type.startsWith('onboarding_') ? settings.type_cooldowns.onboarding_reminder : undefined);
    const enabledByType = settings.enabled_types.includes(type)
      || (type.startsWith('onboarding_') && settings.enabled_types.includes('onboarding_reminder'));

    return {
      type,
      title: override.title ?? String(defaultTemplate.title || ''),
      message: override.message ?? String(defaultTemplate.message || ''),
      telegram_message: override.telegram_message ?? String(defaultTemplate.telegramMessage || ''),
      cta_url: override.cta_url ?? defaultTemplate.ctaUrl ?? null,
      cta_label: override.cta_label ?? defaultTemplate.ctaLabel ?? null,
      cooldown_days: override.cooldown_days ?? cooldownFromType ?? Number(defaultTemplate.cooldownDays || 0),
      channels,
      enabled: enabledByType && settings.is_active,
      source_template_keys: keysByType.get(type) || [],
      merged_from_multiple_templates: (keysByType.get(type) || []).length > 1,
    };
  });
}

function buildConfigPayload(row: any) {
  const parsed = parseSettingsRow(row);

  return {
    settings: {
      daily_limit: parsed.daily_limit,
      weekly_limit: parsed.weekly_limit,
      send_hour: parsed.send_hour,
      is_active: parsed.is_active,
      enabled_types: parsed.enabled_types,
      type_cooldowns: parsed.type_cooldowns,
    },
    templates: buildTemplateList(parsed),
  };
}

function escapeTelegramHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function buildTelegramBroadcastMessage(params: {
  title: string;
  message: string;
  ctaUrl?: string | null;
  ctaLabel?: string | null;
}): string {
  const title = escapeTelegramHtml(params.title.trim());
  const message = escapeTelegramHtml(params.message.trim());
  let content = `<b>${title}</b>\n\n${message}`;

  if (params.ctaUrl && params.ctaUrl.trim().length > 0) {
    const ctaUrl = params.ctaUrl.trim();
    const ctaLabel = escapeTelegramHtml((params.ctaLabel || 'Открыть').trim());
    content += `\n\n<a href="${ctaUrl}">${ctaLabel}</a>`;
  }

  return content;
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 0, 0, 0, 0));
}

function getTodayUtcDateOnly(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

function hasTelegramId(user: BroadcastRecipientRow): boolean {
  return Boolean(user.telegram_id && String(user.telegram_id).trim().length > 0);
}

function hasActiveSubscription(user: BroadcastRecipientRow, today: Date): boolean {
  if (!user.is_active) return false;
  if (!user.tarif || !String(user.tarif).startsWith('subscription_')) return false;
  const expiry = parseDateOnly(user.tarif_expires);
  if (!expiry) return false;
  return expiry.getTime() >= today.getTime();
}

function isSubscriptionExpiringInDays(user: BroadcastRecipientRow, today: Date, days: number): boolean {
  if (!hasActiveSubscription(user, today)) return false;
  const expiry = parseDateOnly(user.tarif_expires);
  if (!expiry) return false;

  const diffDays = Math.floor((expiry.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  return diffDays >= 0 && diffDays <= days;
}

function filterRecipientsBySegment(
  recipients: BroadcastRecipientRow[],
  segment: BroadcastSegment,
  today: Date
): BroadcastRecipientRow[] {
  if (segment === 'all') return recipients;
  if (segment === 'all_active') return recipients.filter((user) => Boolean(user.is_active));
  if (segment === 'subscription_active') return recipients.filter((user) => hasActiveSubscription(user, today));
  if (segment === 'with_telegram') return recipients.filter((user) => hasTelegramId(user));
  if (segment === 'without_subscription') return recipients.filter((user) => !hasActiveSubscription(user, today));
  if (segment === 'subscription_expiring_7d') {
    return recipients.filter((user) => isSubscriptionExpiringInDays(user, today, 7));
  }
  return recipients;
}

async function fetchRecipientPool(args: { segment: BroadcastSegment; userIds?: string[] }): Promise<BroadcastRecipientRow[]> {
  const fields = 'id, telegram_id, is_active, tarif, tarif_expires';

  if (args.segment === 'custom') {
    const ids = normalizeStringArray(args.userIds || []);
    if (ids.length === 0) return [];

    const rows: BroadcastRecipientRow[] = [];
    for (const idsChunk of chunkArray(ids, 200)) {
      const { data, error } = await supabase
        .from('user_accounts')
        .select(fields)
        .in('id', idsChunk);

      if (error) throw error;
      rows.push(...((data || []) as BroadcastRecipientRow[]));
    }

    return rows;
  }

  const rows: BroadcastRecipientRow[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('user_accounts')
      .select(fields)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const batch = (data || []) as BroadcastRecipientRow[];
    if (batch.length === 0) break;

    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function resolveRecipientsForBroadcast(payload: BroadcastPayload): Promise<BroadcastRecipientRow[]> {
  const today = getTodayUtcDateOnly();
  const pool = await fetchRecipientPool({
    segment: payload.segment,
    userIds: payload.user_ids,
  });

  let filtered = payload.segment === 'custom'
    ? pool
    : filterRecipientsBySegment(pool, payload.segment, today);

  if (payload.only_with_telegram) {
    filtered = filtered.filter((user) => hasTelegramId(user));
  }

  return filtered;
}

async function getSegmentStats() {
  const today = getTodayUtcDateOnly();
  const users = await fetchRecipientPool({ segment: 'all' });

  return {
    total_users: users.length,
    active_users: users.filter((user) => Boolean(user.is_active)).length,
    subscription_active_users: users.filter((user) => hasActiveSubscription(user, today)).length,
    users_with_telegram: users.filter((user) => hasTelegramId(user)).length,
    users_without_subscription: users.filter((user) => !hasActiveSubscription(user, today)).length,
    subscription_expiring_7d_users: users.filter((user) => isSubscriptionExpiringInDays(user, today, 7)).length,
  };
}

function toNullableText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCampaignChannels(channels: NotificationChannel[]): NotificationChannel[] {
  return normalizeChannels(channels, ['in_app']);
}

function buildBroadcastPayloadFromCampaign(campaign: any): BroadcastPayload {
  return {
    type: String(campaign.type || 'admin_broadcast'),
    title: String(campaign.title || ''),
    message: String(campaign.message || ''),
    telegram_message: typeof campaign.telegram_message === 'string' ? campaign.telegram_message : undefined,
    cta_url: typeof campaign.cta_url === 'string' ? campaign.cta_url : undefined,
    cta_label: typeof campaign.cta_label === 'string' ? campaign.cta_label : undefined,
    channels: normalizeCampaignChannels(campaign.channels || ['in_app']),
    segment: (BROADCAST_SEGMENTS as readonly string[]).includes(String(campaign.segment))
      ? (campaign.segment as BroadcastSegment)
      : 'all_active',
    user_ids: normalizeStringArray(campaign.user_ids),
    only_with_telegram: Boolean(campaign.only_with_telegram),
  };
}

async function executeBroadcast(
  payload: BroadcastPayload,
  options: BroadcastExecutionOptions
): Promise<BroadcastExecutionResult> {
  const recipients = await resolveRecipientsForBroadcast(payload);
  if (recipients.length === 0) {
    return {
      success: true,
      broadcast_id: crypto.randomUUID(),
      recipients: 0,
      in_app_created: 0,
      telegram_sent: 0,
      telegram_failed: 0,
    };
  }

  const broadcastId = crypto.randomUUID();
  const metadata = {
    source: options.source,
    broadcast_id: broadcastId,
    segment: payload.segment,
    created_by_admin_id: options.senderId || null,
    campaign_id: options.campaignId || null,
    cta_url: payload.cta_url || null,
    cta_label: payload.cta_label || null,
  };

  const notificationIdByUser = new Map<string, string>();
  const sentTelegramUsers = new Set<string>();
  const channelType = payload.channels.length === 2 ? 'both' : payload.channels[0];

  if (payload.channels.includes('in_app')) {
    const rows = recipients.map((recipient) => ({
      user_account_id: recipient.id,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      metadata,
      telegram_sent: false,
      is_read: false,
    }));

    for (const batch of chunkArray(rows, 300)) {
      const { data: inserted, error } = await supabase
        .from('user_notifications')
        .insert(batch)
        .select('id, user_account_id');

      if (error) throw error;
      for (const row of inserted || []) {
        notificationIdByUser.set(row.user_account_id, row.id);
      }
    }
  }

  if (payload.channels.includes('telegram')) {
    const telegramMessage = payload.telegram_message && payload.telegram_message.trim().length > 0
      ? payload.telegram_message
      : buildTelegramBroadcastMessage({
          title: payload.title,
          message: payload.message,
          ctaUrl: payload.cta_url,
          ctaLabel: payload.cta_label,
        });

    for (const recipient of recipients) {
      if (!recipient.telegram_id) continue;
      const sent = await sendTelegramNotification(
        recipient.telegram_id,
        telegramMessage,
        {
          userAccountId: recipient.id,
          source: 'broadcast',
          skipLog: true,
        }
      );
      if (sent) {
        sentTelegramUsers.add(recipient.id);
      }
    }
  }

  if (payload.channels.includes('in_app') && sentTelegramUsers.size > 0) {
    const notificationIds = Array.from(sentTelegramUsers)
      .map((userId) => notificationIdByUser.get(userId))
      .filter((id): id is string => Boolean(id));

    for (const batch of chunkArray(notificationIds, 300)) {
      const { error } = await supabase
        .from('user_notifications')
        .update({ telegram_sent: true })
        .in('id', batch);

      if (error) {
        log.warn({ error: error.message }, 'Failed to update telegram_sent for broadcast notifications');
      }
    }
  }

  const historyRows = recipients.map((recipient) => ({
    user_account_id: recipient.id,
    notification_type: payload.type,
    channel: channelType,
    telegram_sent: sentTelegramUsers.has(recipient.id),
    in_app_created: notificationIdByUser.has(recipient.id),
    notification_id: notificationIdByUser.get(recipient.id) || null,
    message_preview: payload.message.slice(0, 200),
    metadata,
  }));

  for (const batch of chunkArray(historyRows, 400)) {
    const { error } = await supabase.from('notification_history').insert(batch);
    if (error) throw error;
  }

  const telegramEligible = recipients.filter((recipient) => Boolean(recipient.telegram_id)).length;
  const telegramSent = sentTelegramUsers.size;

  return {
    success: true,
    broadcast_id: broadcastId,
    recipients: recipients.length,
    in_app_created: notificationIdByUser.size,
    telegram_sent: telegramSent,
    telegram_failed: payload.channels.includes('telegram')
      ? Math.max(telegramEligible - telegramSent, 0)
      : 0,
  };
}

function parseDateTime(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function computeNextRunAt(params: {
  scheduleMode: 'once' | 'daily' | 'weekly';
  scheduledAt?: string;
  sendHourUtc?: number;
  sendMinuteUtc?: number;
  weeklyDay?: number;
  from?: Date;
}): string {
  const now = params.from || new Date();
  const minute = Number(params.sendMinuteUtc ?? 0);

  if (params.scheduleMode === 'once') {
    const scheduledAt = parseDateTime(params.scheduledAt);
    if (!scheduledAt) throw new Error('scheduled_at is required for once campaign');
    return scheduledAt.toISOString();
  }

  const hour = Number(params.sendHourUtc);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
    throw new Error('send_hour_utc is required for recurring campaign');
  }

  if (minute < 0 || minute > 59) {
    throw new Error('send_minute_utc must be between 0 and 59');
  }

  if (params.scheduleMode === 'daily') {
    const candidate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hour,
      minute,
      0,
      0
    ));

    if (candidate.getTime() <= now.getTime()) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
    }

    return candidate.toISOString();
  }

  const weeklyDay = Number(params.weeklyDay);
  if (!Number.isFinite(weeklyDay) || weeklyDay < 0 || weeklyDay > 6) {
    throw new Error('weekly_day is required for weekly campaign');
  }

  const candidate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hour,
    minute,
    0,
    0
  ));

  const currentWeekday = candidate.getUTCDay();
  let diff = (weeklyDay - currentWeekday + 7) % 7;
  if (diff === 0 && candidate.getTime() <= now.getTime()) {
    diff = 7;
  }
  candidate.setUTCDate(candidate.getUTCDate() + diff);

  return candidate.toISOString();
}

export async function runCampaignNow(campaignRow: any): Promise<BroadcastExecutionResult> {
  const payload = buildBroadcastPayloadFromCampaign(campaignRow);
  return executeBroadcast(payload, {
    source: 'scheduled_campaign',
    senderId: campaignRow.created_by_admin_id || null,
    campaignId: campaignRow.id || null,
  });
}

export async function processDueNotificationCampaigns(maxCampaigns = 20): Promise<void> {
  const nowIso = new Date().toISOString();

  const { data: dueCampaigns, error } = await supabase
    .from('notification_campaigns')
    .select('*')
    .eq('is_active', true)
    .not('next_run_at', 'is', null)
    .lte('next_run_at', nowIso)
    .order('next_run_at', { ascending: true })
    .limit(maxCampaigns);

  if (error) {
    log.error({ error: error.message }, 'Failed to fetch due notification campaigns');
    return;
  }

  for (const campaign of dueCampaigns || []) {
    try {
      const result = await runCampaignNow(campaign);
      const now = new Date().toISOString();

      let isActive = Boolean(campaign.is_active);
      let nextRunAt: string | null = null;

      if (campaign.schedule_mode === 'once') {
        isActive = false;
      } else if (campaign.schedule_mode === 'daily') {
        nextRunAt = computeNextRunAt({
          scheduleMode: 'daily',
          sendHourUtc: campaign.send_hour_utc,
          sendMinuteUtc: campaign.send_minute_utc,
          from: new Date(now),
        });
      } else if (campaign.schedule_mode === 'weekly') {
        nextRunAt = computeNextRunAt({
          scheduleMode: 'weekly',
          sendHourUtc: campaign.send_hour_utc,
          sendMinuteUtc: campaign.send_minute_utc,
          weeklyDay: campaign.weekly_day,
          from: new Date(now),
        });
      }

      const { error: updateError } = await supabase
        .from('notification_campaigns')
        .update({
          is_active: isActive,
          next_run_at: nextRunAt,
          last_run_at: now,
          last_result: {
            ...result,
            success: true,
            processed_at: now,
          },
          updated_at: now,
        })
        .eq('id', campaign.id);

      if (updateError) {
        log.warn({ campaignId: campaign.id, error: updateError.message }, 'Failed to update campaign after run');
      }
    } catch (err: any) {
      const now = new Date().toISOString();
      log.error({ campaignId: campaign.id, error: String(err) }, 'Failed to run scheduled notification campaign');

      await supabase
        .from('notification_campaigns')
        .update({
          last_run_at: now,
          last_result: {
            success: false,
            error: err?.message || String(err),
            processed_at: now,
          },
          updated_at: now,
        })
        .eq('id', campaign.id);
    }
  }
}

async function fetchSettingsRow() {
  const { data, error } = await supabase
    .from('notification_settings')
    .select('*')
    .eq('id', SETTINGS_ID)
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to load notification settings');
  }

  return data;
}

export default async function adminNotificationsRoutes(app: FastifyInstance) {
  /**
   * GET /admin/notifications
   * Блок уведомлений админа в шапке
   */
  app.get('/admin/notifications', async (req, res) => {
    try {
      const { limit = '50' } = req.query as { limit?: string };

      const { data: notifications, error } = await supabase
        .from('admin_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(parseInt(limit, 10));

      if (error) throw error;

      return res.send({ notifications: notifications || [] });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error fetching notifications');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_list_notifications',
        endpoint: '/admin/notifications',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Failed to fetch notifications' });
    }
  });

  /**
   * GET /admin/notifications/unread-count
   */
  app.get('/admin/notifications/unread-count', async (_req, res) => {
    try {
      const { count } = await supabase
        .from('admin_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('is_read', false);

      return res.send({ count: count || 0 });
    } catch (err) {
      log.error({ error: String(err) }, 'Error fetching unread count');
      return res.send({ count: 0 });
    }
  });

  /**
   * POST /admin/notifications/:id/read
   */
  app.post('/admin/notifications/:id/read', async (req, res) => {
    try {
      const { id } = req.params as { id: string };

      const { error } = await supabase
        .from('admin_notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;

      return res.send({ success: true });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error marking notification as read');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_mark_notification_read',
        endpoint: '/admin/notifications/:id/read',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Failed to mark as read' });
    }
  });

  /**
   * POST /admin/notifications/mark-all-read
   */
  app.post('/admin/notifications/mark-all-read', async (_req, res) => {
    try {
      const { error } = await supabase
        .from('admin_notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq('is_read', false);

      if (error) throw error;

      return res.send({ success: true });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error marking all as read');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_mark_all_notifications_read',
        endpoint: '/admin/notifications/mark-all-read',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Failed to mark all as read' });
    }
  });

  /**
   * GET /admin/notifications/config
   * Настройки и конструктор системных уведомлений
   */
  app.get('/admin/notifications/config', async (_req, res) => {
    try {
      const settingsRow = await fetchSettingsRow();
      return res.send(buildConfigPayload(settingsRow));
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error fetching notifications config');
      return res.status(500).send({ error: 'Failed to fetch notifications config' });
    }
  });

  /**
   * PUT /admin/notifications/config
   * Сохранение общих настроек системы уведомлений
   */
  app.put('/admin/notifications/config', async (req, res) => {
    const parsed = settingsUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).send({
        error: 'Invalid payload',
        details: parsed.error.flatten(),
      });
    }

    try {
      const payload = parsed.data;
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (payload.daily_limit !== undefined) updates.daily_limit = payload.daily_limit;
      if (payload.weekly_limit !== undefined) updates.weekly_limit = payload.weekly_limit;
      if (payload.send_hour !== undefined) updates.send_hour = payload.send_hour;
      if (payload.is_active !== undefined) updates.is_active = payload.is_active;
      if (payload.enabled_types !== undefined) updates.enabled_types = normalizeStringArray(payload.enabled_types);
      if (payload.type_cooldowns !== undefined) updates.type_cooldowns = normalizeCooldownMap(payload.type_cooldowns);

      const { data: updated, error } = await supabase
        .from('notification_settings')
        .update(updates)
        .eq('id', SETTINGS_ID)
        .select('*')
        .single();

      if (error || !updated) throw error || new Error('Failed to update config');

      return res.send({
        success: true,
        ...buildConfigPayload(updated),
      });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error updating notifications config');
      return res.status(500).send({ error: 'Failed to update notifications config' });
    }
  });

  /**
   * PUT /admin/notifications/templates/:type
   * Обновление текстов/каналов/периодичности конкретного типа уведомления
   */
  app.put('/admin/notifications/templates/:type', async (req, res) => {
    const { type } = req.params as { type: string };
    const parsed = templateUpdateSchema.safeParse(req.body || {});

    if (!parsed.success) {
      return res.status(400).send({
        error: 'Invalid payload',
        details: parsed.error.flatten(),
      });
    }

    if (!type || type.trim().length === 0) {
      return res.status(400).send({ error: 'Invalid template type' });
    }

    const changes = parsed.data;
    if (Object.keys(changes).length === 0) {
      return res.status(400).send({ error: 'No changes provided' });
    }

    try {
      const settingsRow = await fetchSettingsRow();
      const settings = parseSettingsRow(settingsRow);

      const templateType = type.trim();
      const override = settings.template_overrides[templateType] || {};

      if (changes.title !== undefined) override.title = changes.title;
      if (changes.message !== undefined) override.message = changes.message;
      if (changes.telegram_message !== undefined) override.telegram_message = changes.telegram_message;
      if (changes.cta_url !== undefined) override.cta_url = changes.cta_url.trim() ? changes.cta_url.trim() : null;
      if (changes.cta_label !== undefined) override.cta_label = changes.cta_label.trim() ? changes.cta_label.trim() : null;
      if (changes.channels !== undefined) override.channels = changes.channels;
      if (changes.cooldown_days !== undefined) override.cooldown_days = changes.cooldown_days;

      const nextOverrides = { ...settings.template_overrides, [templateType]: override };
      const nextTypeCooldowns = { ...settings.type_cooldowns };
      let nextEnabledTypes = [...settings.enabled_types];

      if (changes.cooldown_days !== undefined) {
        nextTypeCooldowns[templateType] = changes.cooldown_days;
      }

      if (changes.enabled !== undefined) {
        if (changes.enabled && !nextEnabledTypes.includes(templateType)) {
          nextEnabledTypes.push(templateType);
        }
        if (!changes.enabled) {
          nextEnabledTypes = nextEnabledTypes.filter((x) => x !== templateType);
        }
      }

      const { data: updated, error } = await supabase
        .from('notification_settings')
        .update({
          template_overrides: nextOverrides,
          type_cooldowns: nextTypeCooldowns,
          enabled_types: normalizeStringArray(nextEnabledTypes),
          updated_at: new Date().toISOString(),
        })
        .eq('id', SETTINGS_ID)
        .select('*')
        .single();

      if (error || !updated) throw error || new Error('Failed to update template');

      const payload = buildConfigPayload(updated);
      const template = payload.templates.find((item) => item.type === templateType) || null;

      return res.send({
        success: true,
        template,
        settings: payload.settings,
      });
    } catch (err: any) {
      log.error({ error: String(err), type }, 'Error updating template');
      return res.status(500).send({ error: 'Failed to update template' });
    }
  });

  /**
   * DELETE /admin/notifications/templates/:type
   * Сброс текста/каналов к системным дефолтам (без удаления истории)
   */
  app.delete('/admin/notifications/templates/:type', async (req, res) => {
    const { type } = req.params as { type: string };
    if (!type || type.trim().length === 0) {
      return res.status(400).send({ error: 'Invalid template type' });
    }

    try {
      const settingsRow = await fetchSettingsRow();
      const settings = parseSettingsRow(settingsRow);
      const templateType = type.trim();

      const nextOverrides = { ...settings.template_overrides };
      delete nextOverrides[templateType];

      const { data: updated, error } = await supabase
        .from('notification_settings')
        .update({
          template_overrides: nextOverrides,
          updated_at: new Date().toISOString(),
        })
        .eq('id', SETTINGS_ID)
        .select('*')
        .single();

      if (error || !updated) throw error || new Error('Failed to reset template override');

      const payload = buildConfigPayload(updated);
      const template = payload.templates.find((item) => item.type === templateType) || null;

      return res.send({
        success: true,
        template,
      });
    } catch (err: any) {
      log.error({ error: String(err), type }, 'Error resetting template');
      return res.status(500).send({ error: 'Failed to reset template' });
    }
  });

  /**
   * GET /admin/notifications/segments
   * Быстрые сегменты получателей для рассылки
   */
  app.get('/admin/notifications/segments', async (_req, res) => {
    try {
      return res.send(await getSegmentStats());
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error fetching recipient segments');
      return res.status(500).send({ error: 'Failed to fetch recipient segments' });
    }
  });

  /**
   * GET /admin/notifications/recipients
   * Поиск пользователей для custom-сегмента
   */
  app.get('/admin/notifications/recipients', async (req, res) => {
    const parsed = recipientsQuerySchema.safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).send({
        error: 'Invalid query',
        details: parsed.error.flatten(),
      });
    }

    try {
      const { limit, search } = parsed.data;
      let query = supabase
        .from('user_accounts')
        .select('id, username, telegram_id, is_active, tarif, tarif_expires, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (search && search.trim().length > 0) {
        const escaped = search.trim().replaceAll(',', ' ');
        query = query.or(`username.ilike.%${escaped}%,telegram_id.ilike.%${escaped}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      return res.send({ recipients: data || [] });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error fetching recipients');
      return res.status(500).send({ error: 'Failed to fetch recipients' });
    }
  });

  /**
   * POST /admin/notifications/broadcast
   * Ручная отправка уведомления сегменту пользователей
   */
  app.post('/admin/notifications/broadcast', async (req, res) => {
    const parsed = broadcastSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).send({
        error: 'Invalid payload',
        details: parsed.error.flatten(),
      });
    }

    const senderId = String(req.headers['x-user-id'] || '').trim();
    const payload = parsed.data;

    if (payload.segment === 'custom' && (!payload.user_ids || payload.user_ids.length === 0)) {
      return res.status(400).send({ error: 'user_ids are required for custom segment' });
    }

    try {
      const result = await executeBroadcast(payload, {
        source: 'admin_broadcast',
        senderId,
      });
      return res.send(result);
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error sending broadcast');
      return res.status(500).send({ error: 'Failed to send broadcast' });
    }
  });

  /**
   * GET /admin/notifications/campaigns
   * Список запланированных кампаний уведомлений
   */
  app.get('/admin/notifications/campaigns', async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from('notification_campaigns')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.send({ campaigns: data || [] });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error fetching campaigns');
      return res.status(500).send({ error: 'Failed to fetch campaigns' });
    }
  });

  /**
   * POST /admin/notifications/campaigns
   * Создание новой кампании рассылки
   */
  app.post('/admin/notifications/campaigns', async (req, res) => {
    const parsed = campaignCreateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).send({
        error: 'Invalid payload',
        details: parsed.error.flatten(),
      });
    }

    const senderId = String(req.headers['x-user-id'] || '').trim() || null;
    const payload = parsed.data;

    if (payload.segment === 'custom' && (!payload.user_ids || payload.user_ids.length === 0)) {
      return res.status(400).send({ error: 'user_ids are required for custom segment' });
    }

    try {
      const nextRunAt = payload.is_active
        ? computeNextRunAt({
            scheduleMode: payload.schedule_mode,
            scheduledAt: payload.scheduled_at,
            sendHourUtc: payload.send_hour_utc,
            sendMinuteUtc: payload.send_minute_utc,
            weeklyDay: payload.weekly_day,
          })
        : null;

      const { data, error } = await supabase
        .from('notification_campaigns')
        .insert({
          name: payload.name.trim(),
          type: payload.type.trim(),
          title: payload.title,
          message: payload.message,
          telegram_message: toNullableText(payload.telegram_message),
          cta_url: toNullableText(payload.cta_url),
          cta_label: toNullableText(payload.cta_label),
          channels: normalizeCampaignChannels(payload.channels),
          segment: payload.segment,
          user_ids: payload.segment === 'custom' ? normalizeStringArray(payload.user_ids || []) : [],
          only_with_telegram: payload.only_with_telegram,
          schedule_mode: payload.schedule_mode,
          scheduled_at: payload.schedule_mode === 'once'
            ? parseDateTime(payload.scheduled_at || '')?.toISOString() || null
            : null,
          send_hour_utc: payload.schedule_mode === 'once' ? null : payload.send_hour_utc ?? null,
          send_minute_utc: payload.schedule_mode === 'once' ? 0 : payload.send_minute_utc,
          weekly_day: payload.schedule_mode === 'weekly' ? payload.weekly_day ?? null : null,
          next_run_at: nextRunAt,
          created_by_admin_id: senderId,
          is_active: payload.is_active,
          updated_at: new Date().toISOString(),
        })
        .select('*')
        .single();

      if (error || !data) throw error || new Error('Failed to create campaign');

      return res.send({ success: true, campaign: data });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error creating campaign');
      return res.status(500).send({ error: err?.message || 'Failed to create campaign' });
    }
  });

  /**
   * PUT /admin/notifications/campaigns/:id
   * Обновление кампании рассылки
   */
  app.put('/admin/notifications/campaigns/:id', async (req, res) => {
    const { id } = req.params as { id: string };
    const parsed = campaignUpdateSchema.safeParse(req.body || {});

    if (!parsed.success) {
      return res.status(400).send({
        error: 'Invalid payload',
        details: parsed.error.flatten(),
      });
    }

    try {
      const { data: existing, error: existingError } = await supabase
        .from('notification_campaigns')
        .select('*')
        .eq('id', id)
        .single();

      if (existingError || !existing) {
        return res.status(404).send({ error: 'Campaign not found' });
      }

      const payload = parsed.data;
      const merged = {
        ...existing,
        ...payload,
      } as any;

      const segment = (BROADCAST_SEGMENTS as readonly string[]).includes(String(merged.segment))
        ? (merged.segment as BroadcastSegment)
        : 'all_active';

      if (segment === 'custom') {
        const ids = normalizeStringArray(merged.user_ids || []);
        if (ids.length === 0) {
          return res.status(400).send({ error: 'user_ids are required for custom segment' });
        }
        merged.user_ids = ids;
      } else {
        merged.user_ids = [];
      }

      const nextRunAt = merged.is_active
        ? computeNextRunAt({
            scheduleMode: merged.schedule_mode,
            scheduledAt: merged.scheduled_at,
            sendHourUtc: merged.send_hour_utc,
            sendMinuteUtc: merged.send_minute_utc,
            weeklyDay: merged.weekly_day,
          })
        : null;

      const { data: updated, error } = await supabase
        .from('notification_campaigns')
        .update({
          name: String(merged.name || '').trim(),
          type: String(merged.type || '').trim(),
          title: merged.title,
          message: merged.message,
          telegram_message: toNullableText(merged.telegram_message),
          cta_url: toNullableText(merged.cta_url),
          cta_label: toNullableText(merged.cta_label),
          channels: normalizeCampaignChannels(merged.channels || ['in_app']),
          segment,
          user_ids: merged.user_ids,
          only_with_telegram: Boolean(merged.only_with_telegram),
          schedule_mode: merged.schedule_mode,
          scheduled_at: merged.schedule_mode === 'once'
            ? parseDateTime(merged.scheduled_at || '')?.toISOString() || null
            : null,
          send_hour_utc: merged.schedule_mode === 'once' ? null : merged.send_hour_utc ?? null,
          send_minute_utc: merged.schedule_mode === 'once' ? 0 : merged.send_minute_utc ?? 0,
          weekly_day: merged.schedule_mode === 'weekly' ? merged.weekly_day ?? null : null,
          next_run_at: nextRunAt,
          is_active: Boolean(merged.is_active),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single();

      if (error || !updated) throw error || new Error('Failed to update campaign');

      return res.send({ success: true, campaign: updated });
    } catch (err: any) {
      log.error({ error: String(err), campaignId: id }, 'Error updating campaign');
      return res.status(500).send({ error: err?.message || 'Failed to update campaign' });
    }
  });

  /**
   * POST /admin/notifications/campaigns/:id/run-now
   * Мгновенный запуск кампании
   */
  app.post('/admin/notifications/campaigns/:id/run-now', async (req, res) => {
    const { id } = req.params as { id: string };
    try {
      const { data: campaign, error } = await supabase
        .from('notification_campaigns')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !campaign) {
        return res.status(404).send({ error: 'Campaign not found' });
      }

      const result = await runCampaignNow(campaign);

      await supabase
        .from('notification_campaigns')
        .update({
          last_run_at: new Date().toISOString(),
          last_result: {
            ...result,
            success: true,
            processed_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      return res.send({
        success: true,
        result,
      });
    } catch (err: any) {
      log.error({ error: String(err), campaignId: id }, 'Error running campaign now');
      return res.status(500).send({ error: err?.message || 'Failed to run campaign' });
    }
  });

  /**
   * DELETE /admin/notifications/campaigns/:id
   */
  app.delete('/admin/notifications/campaigns/:id', async (req, res) => {
    const { id } = req.params as { id: string };
    try {
      const { error } = await supabase
        .from('notification_campaigns')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return res.send({ success: true });
    } catch (err: any) {
      log.error({ error: String(err), campaignId: id }, 'Error deleting campaign');
      return res.status(500).send({ error: 'Failed to delete campaign' });
    }
  });

  /**
   * GET /admin/notifications/user-history
   * История user_notifications (фактические in-app уведомления)
   */
  app.get('/admin/notifications/user-history', async (req, res) => {
    const parsed = historyQuerySchema.safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).send({
        error: 'Invalid query',
        details: parsed.error.flatten(),
      });
    }

    try {
      const { limit, offset, type, user_id: userId, search } = parsed.data;

      let query = supabase
        .from('user_notifications')
        .select('id, user_account_id, type, title, message, is_read, telegram_sent, metadata, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (type && type !== 'all') query = query.eq('type', type);
      if (userId) query = query.eq('user_account_id', userId);
      if (search && search.trim().length > 0) {
        const escaped = search.trim().replaceAll(',', ' ');
        query = query.or(`title.ilike.%${escaped}%,message.ilike.%${escaped}%,type.ilike.%${escaped}%`);
      }

      const { data: notifications, error, count } = await query;
      if (error) throw error;

      const userIds = Array.from(new Set((notifications || []).map((item) => item.user_account_id).filter(Boolean)));
      const usersMap = new Map<string, any>();

      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('user_accounts')
          .select('id, username, telegram_id, is_active, tarif, tarif_expires')
          .in('id', userIds);

        for (const user of users || []) {
          usersMap.set(user.id, user);
        }
      }

      const items = (notifications || []).map((item) => ({
        ...item,
        user: usersMap.get(item.user_account_id) || null,
      }));

      return res.send({
        notifications: items,
        total: count || 0,
        limit,
        offset,
      });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error fetching user notification history');
      return res.status(500).send({ error: 'Failed to fetch user notification history' });
    }
  });

  /**
   * GET /admin/notifications/delivery-history
   * История notification_history (включая telegram-only отправки)
   */
  app.get('/admin/notifications/delivery-history', async (req, res) => {
    const parsed = historyQuerySchema.safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).send({
        error: 'Invalid query',
        details: parsed.error.flatten(),
      });
    }

    try {
      const { limit, offset, type, user_id: userId, search } = parsed.data;

      let query = supabase
        .from('notification_history')
        .select('id, user_account_id, notification_type, channel, telegram_sent, in_app_created, notification_id, message_preview, metadata, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (type && type !== 'all') query = query.eq('notification_type', type);
      if (userId) query = query.eq('user_account_id', userId);
      if (search && search.trim().length > 0) {
        const escaped = search.trim().replaceAll(',', ' ');
        query = query.or(`notification_type.ilike.%${escaped}%,message_preview.ilike.%${escaped}%`);
      }

      const { data: history, error, count } = await query;
      if (error) throw error;

      const userIds = Array.from(new Set((history || []).map((item) => item.user_account_id).filter(Boolean)));
      const usersMap = new Map<string, any>();

      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('user_accounts')
          .select('id, username, telegram_id, is_active, tarif, tarif_expires')
          .in('id', userIds);

        for (const user of users || []) {
          usersMap.set(user.id, user);
        }
      }

      const items = (history || []).map((item) => ({
        ...item,
        user: usersMap.get(item.user_account_id) || null,
      }));

      return res.send({
        history: items,
        total: count || 0,
        limit,
        offset,
      });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error fetching delivery history');
      return res.status(500).send({ error: 'Failed to fetch delivery history' });
    }
  });
}
