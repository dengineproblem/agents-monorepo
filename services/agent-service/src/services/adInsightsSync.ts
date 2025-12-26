/**
 * AD INSIGHTS SYNC SERVICE
 *
 * Синхронизация weekly insights из Facebook Marketing API
 * с поддержкой async jobs и rate limiting
 *
 * Iteration 2: Campaign/Adset level + Rankings
 */

import { graph } from '../adapters/facebook.js';
import { supabase } from '../lib/supabaseClient.js';
import { createLogger } from '../lib/logger.js';
import { getCredentials } from '../lib/adAccountHelper.js';

const log = createLogger({ module: 'adInsightsSync' });

// ============================================================================
// RANKING SCORE CONVERSION
// ============================================================================

/**
 * Конвертирует ranking в числовой score
 * ABOVE_AVERAGE → +2, AVERAGE → 0, BELOW_AVERAGE_10 → -1, BELOW_AVERAGE_20 → -2, BELOW_AVERAGE_35 → -3
 */
function rankingToScore(ranking: string | null | undefined): number | null {
  if (!ranking) return null;

  const upper = ranking.toUpperCase();
  if (upper.includes('ABOVE')) return 2;
  if (upper === 'AVERAGE') return 0;
  if (upper.includes('BELOW') && upper.includes('35')) return -3;
  if (upper.includes('BELOW') && upper.includes('20')) return -2;
  if (upper.includes('BELOW')) return -1;
  return 0;
}

// Константы
const FB_API_VERSION = process.env.FB_API_VERSION || 'v20.0';
const BATCH_SIZE = 50; // Facebook batch API limit
const ASYNC_POLL_INTERVAL = 5000; // 5 секунд
const ASYNC_MAX_POLLS = 60; // Максимум 5 минут ожидания
const RATE_LIMIT_THRESHOLD = 80; // % использования лимита, после которого тормозим

// Типы
interface AdAccount {
  id: string;
  ad_account_id: string;
  access_token: string;
  user_account_id: string;
}

// Контекст синхронизации для поддержки legacy/multi-account
interface SyncContext {
  // UUID для сохранения в таблицы
  adAccountId: string | null;  // null для legacy
  userAccountId: string;       // всегда заполнен
  // FB credentials
  accessToken: string;
  fbAdAccountId: string;       // act_xxx
  isLegacy: boolean;
}

interface SyncJob {
  id: string;
  ad_account_id: string;
  job_type: string;
  status: string;
  fb_report_run_id?: string;
  params?: any;
  total_items?: number;
  processed_items?: number;
  cursor?: string;
  attempts: number;
  last_error?: string;
}

interface RateLimitState {
  call_count: number;
  total_cputime: number;
  total_time: number;
  throttle_until?: Date;
}

// ============================================================================
// RATE LIMITING
// ============================================================================

/**
 * Парсит X-Business-Use-Case-Usage header от Facebook
 */
function parseUsageHeader(headers: any): RateLimitState | null {
  const usage = headers?.['x-business-use-case-usage'] || headers?.['x-app-usage'];
  if (!usage) return null;

  try {
    const parsed = JSON.parse(usage);
    // X-Business-Use-Case-Usage имеет структуру {ad_account_id: [{call_count, ...}]}
    const values = Object.values(parsed)[0] as any;
    if (Array.isArray(values) && values[0]) {
      return {
        call_count: values[0].call_count || 0,
        total_cputime: values[0].total_cputime || 0,
        total_time: values[0].total_time || 0,
      };
    }
    // X-App-Usage имеет прямую структуру {call_count, ...}
    return {
      call_count: parsed.call_count || 0,
      total_cputime: parsed.total_cputime || 0,
      total_time: parsed.total_time || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Проверяет и обновляет состояние rate limit
 */
async function checkRateLimit(adAccountId: string): Promise<boolean> {
  const { data: state } = await supabase
    .from('fb_rate_limit_state')
    .select('*')
    .eq('ad_account_id', adAccountId)
    .single();

  if (state?.throttle_until && new Date(state.throttle_until) > new Date()) {
    log.warn({
      adAccountId,
      throttle_until: state.throttle_until
    }, 'Rate limited, skipping request');
    return false;
  }

  return true;
}

/**
 * Обновляет состояние rate limit после запроса
 */
async function updateRateLimitState(adAccountId: string, usage: RateLimitState | null) {
  if (!usage) return;

  const maxUsage = Math.max(usage.call_count, usage.total_cputime, usage.total_time);

  let throttleUntil: Date | null = null;
  let throttleReason: string | null = null;

  // Если использование > 80%, делаем паузу
  if (maxUsage >= RATE_LIMIT_THRESHOLD) {
    const pauseMinutes = maxUsage >= 95 ? 30 : maxUsage >= 90 ? 15 : 5;
    throttleUntil = new Date(Date.now() + pauseMinutes * 60 * 1000);
    throttleReason = `Usage at ${maxUsage}%, pausing for ${pauseMinutes} minutes`;
    log.warn({ adAccountId, maxUsage, pauseMinutes }, throttleReason);
  }

  await supabase
    .from('fb_rate_limit_state')
    .upsert({
      ad_account_id: adAccountId,
      usage_headers: usage,
      throttle_until: throttleUntil,
      throttle_reason: throttleReason,
      requests_today: 1,
      last_request_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'ad_account_id' });
}

// ============================================================================
// RETRY HELPER FOR SUPABASE OPERATIONS
// ============================================================================

const SUPABASE_MAX_RETRIES = 3;
const SUPABASE_RETRY_DELAY = 2000; // 2 seconds

/**
 * Выполняет Supabase операцию с retry на сетевых ошибках
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  context: string
): Promise<T> {
  let lastError: any;

  for (let attempt = 1; attempt <= SUPABASE_MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      const isNetworkError =
        error?.message?.includes('fetch failed') ||
        error?.message?.includes('ECONNRESET') ||
        error?.message?.includes('ETIMEDOUT') ||
        error?.code === 'ECONNRESET' ||
        error?.code === 'ETIMEDOUT';

      if (isNetworkError && attempt < SUPABASE_MAX_RETRIES) {
        log.warn({ attempt, context, error: error?.message }, `Network error, retrying in ${SUPABASE_RETRY_DELAY}ms...`);
        await new Promise(resolve => setTimeout(resolve, SUPABASE_RETRY_DELAY));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

// ============================================================================
// SYNC JOBS MANAGEMENT
// ============================================================================

/**
 * Создаёт новый sync job
 */
async function createSyncJob(
  adAccountId: string,
  jobType: 'campaigns' | 'adsets' | 'ads' | 'insights_weekly',
  params?: any
): Promise<SyncJob> {
  const { data, error } = await supabase
    .from('insights_sync_jobs')
    .insert({
      ad_account_id: adAccountId,
      job_type: jobType,
      status: 'pending',
      params,
      attempts: 0,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Обновляет статус sync job
 */
async function updateSyncJob(
  jobId: string,
  updates: Partial<SyncJob>
) {
  const { error } = await supabase
    .from('insights_sync_jobs')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) throw error;
}

// ============================================================================
// СПРАВОЧНИКИ (CAMPAIGNS, ADSETS, ADS)
// ============================================================================

/**
 * Синхронизирует кампании для ad account
 */
export async function syncCampaigns(adAccountId: string, accessToken: string, fbAdAccountId: string): Promise<number> {
  log.info({ adAccountId, fbAdAccountId }, 'Syncing campaigns');

  const fields = 'id,name,status,objective,created_time,updated_time';
  let cursor: string | undefined;
  let totalSynced = 0;

  do {
    const params: any = { fields, limit: 500 };
    if (cursor) params.after = cursor;

    const result = await graph('GET', `act_${fbAdAccountId}/campaigns`, accessToken, params);

    if (result.data && result.data.length > 0) {
      const campaigns = result.data.map((c: any) => ({
        ad_account_id: adAccountId,
        fb_campaign_id: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective,
        created_time: c.created_time,
        updated_time: c.updated_time,
        synced_at: new Date().toISOString(),
      }));

      await withRetry(async () => {
        const { error } = await supabase
          .from('meta_campaigns')
          .upsert(campaigns, { onConflict: 'ad_account_id,fb_campaign_id' });
        if (error) throw error;
      }, 'upsert campaigns');

      totalSynced += campaigns.length;
    }

    cursor = result.paging?.cursors?.after;
  } while (cursor);

  log.info({ adAccountId, totalSynced }, 'Campaigns synced');
  return totalSynced;
}

/**
 * Синхронизирует adsets для ad account
 */
export async function syncAdsets(adAccountId: string, accessToken: string, fbAdAccountId: string): Promise<number> {
  log.info({ adAccountId, fbAdAccountId }, 'Syncing adsets');

  const fields = 'id,name,status,campaign_id,optimization_goal,billing_event,targeting,created_time,updated_time';
  let cursor: string | undefined;
  let totalSynced = 0;

  do {
    const params: any = { fields, limit: 500 };
    if (cursor) params.after = cursor;

    const result = await graph('GET', `act_${fbAdAccountId}/adsets`, accessToken, params);

    if (result.data && result.data.length > 0) {
      const adsets = result.data.map((a: any) => ({
        ad_account_id: adAccountId,
        fb_adset_id: a.id,
        fb_campaign_id: a.campaign_id,
        name: a.name,
        status: a.status,
        optimization_goal: a.optimization_goal,
        billing_event: a.billing_event,
        targeting: a.targeting,
        created_time: a.created_time,
        updated_time: a.updated_time,
        synced_at: new Date().toISOString(),
      }));

      await withRetry(async () => {
        const { error } = await supabase
          .from('meta_adsets')
          .upsert(adsets, { onConflict: 'ad_account_id,fb_adset_id' });
        if (error) throw error;
      }, 'upsert adsets');

      totalSynced += adsets.length;
    }

    cursor = result.paging?.cursors?.after;
  } while (cursor);

  log.info({ adAccountId, totalSynced }, 'Adsets synced');
  return totalSynced;
}

/**
 * Синхронизирует ads для ad account
 */
export async function syncAds(adAccountId: string, accessToken: string, fbAdAccountId: string): Promise<number> {
  log.info({ adAccountId, fbAdAccountId }, 'Syncing ads');

  const fields = 'id,name,status,adset_id,campaign_id,creative{id,object_story_spec},created_time,updated_time';
  let cursor: string | undefined;
  let totalSynced = 0;

  do {
    const params: any = { fields, limit: 500 };
    if (cursor) params.after = cursor;

    const result = await graph('GET', `act_${fbAdAccountId}/ads`, accessToken, params);

    if (result.data && result.data.length > 0) {
      const ads = result.data.map((a: any) => ({
        ad_account_id: adAccountId,
        fb_ad_id: a.id,
        fb_adset_id: a.adset_id,
        fb_campaign_id: a.campaign_id,
        fb_creative_id: a.creative?.id,
        name: a.name,
        status: a.status,
        object_story_spec: a.creative?.object_story_spec,
        created_time: a.created_time,
        updated_time: a.updated_time,
        synced_at: new Date().toISOString(),
      }));

      await withRetry(async () => {
        const { error } = await supabase
          .from('meta_ads')
          .upsert(ads, { onConflict: 'ad_account_id,fb_ad_id' });
        if (error) throw error;
      }, 'upsert ads');

      totalSynced += ads.length;
    }

    cursor = result.paging?.cursors?.after;
  } while (cursor);

  log.info({ adAccountId, totalSynced }, 'Ads synced');
  return totalSynced;
}

// ============================================================================
// WEEKLY INSIGHTS (ASYNC JOBS)
// ============================================================================

/**
 * Вычисляет диапазон дат для последних N месяцев
 */
function getDateRange(months: number = 12): { since: string; until: string } {
  const until = new Date();
  const since = new Date();
  since.setMonth(since.getMonth() - months);

  return {
    since: since.toISOString().split('T')[0],
    until: until.toISOString().split('T')[0],
  };
}

/**
 * Вычисляет понедельник для даты
 */
function getWeekStart(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(date.setDate(diff));
  return monday.toISOString().split('T')[0];
}

/**
 * Запускает async insights job в Facebook
 */
async function startAsyncInsightsJob(
  accessToken: string,
  fbAdAccountId: string,
  timeRange: { since: string; until: string }
): Promise<string> {
  const fields = [
    'ad_id',
    'ad_name',
    'adset_id',
    'campaign_id',
    'spend',
    'impressions',
    'reach',
    'frequency',
    'cpm',
    'ctr',
    'cpc',
    'clicks',
    'actions',
    'cost_per_action_type',
    'video_p25_watched_actions',
    'video_p50_watched_actions',
    'video_p75_watched_actions',
    'video_p95_watched_actions',
    'video_avg_time_watched_actions',
    'quality_ranking',
    'engagement_rate_ranking',
    'conversion_rate_ranking',
  ].join(',');

  const result = await graph('POST', `act_${fbAdAccountId}/insights`, accessToken, {
    level: 'ad',
    time_increment: 7, // weekly
    time_range: JSON.stringify(timeRange),
    fields,
    // Фиксируем attribution window для сравнимости
    action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
  });

  if (!result.report_run_id) {
    throw new Error('No report_run_id in response');
  }

  return result.report_run_id;
}

/**
 * Проверяет статус async job
 */
async function pollAsyncJobStatus(accessToken: string, reportRunId: string): Promise<{
  status: string;
  async_percent_completion: number;
}> {
  const result = await graph('GET', reportRunId, accessToken, {
    fields: 'async_status,async_percent_completion',
  });

  return {
    status: result.async_status,
    async_percent_completion: result.async_percent_completion || 0,
  };
}

/**
 * Получает результаты async job
 */
async function fetchAsyncJobResults(accessToken: string, reportRunId: string): Promise<any[]> {
  const results: any[] = [];
  let cursor: string | undefined;
  let lastCursor: string | undefined;

  do {
    const params: any = { limit: 500 };
    if (cursor) params.after = cursor;

    const result = await graph('GET', `${reportRunId}/insights`, accessToken, params);

    if (result.data && result.data.length > 0) {
      results.push(...result.data);
    }

    const newCursor = result.paging?.cursors?.after;

    // Выходим если: нет cursor, пустые данные, или cursor не изменился (бесконечный цикл)
    if (!newCursor || !result.data?.length || newCursor === lastCursor) {
      break;
    }

    lastCursor = cursor;
    cursor = newCursor;
  } while (cursor);

  return results;
}

/**
 * Извлекает link_clicks из actions
 */
function extractLinkClicks(actions: any[]): number {
  if (!Array.isArray(actions)) return 0;
  const linkClick = actions.find(a => a.action_type === 'link_click');
  return linkClick ? parseInt(linkClick.value) || 0 : 0;
}

/**
 * Извлекает video views из actions
 */
function extractVideoViews(actions: any[]): number {
  if (!Array.isArray(actions)) return 0;
  const videoView = actions.find(a => a.action_type === 'video_view');
  return videoView ? parseInt(videoView.value) || 0 : 0;
}

/**
 * Извлекает percent watched из actions
 */
function extractVideoPercentWatched(actions: any[], percent: string): number {
  if (!Array.isArray(actions)) return 0;
  const action = actions.find(a => a.action_type === `video_p${percent}_watched_actions`);
  return action ? parseInt(action.value) || 0 : 0;
}

/**
 * Синхронизирует weekly insights для ad account
 */
export async function syncWeeklyInsights(
  adAccountId: string,
  accessToken: string,
  fbAdAccountId: string,
  months: number = 12
): Promise<{ inserted: number; updated: number }> {
  log.info({ adAccountId, fbAdAccountId, months }, 'Starting weekly insights sync');

  // 1. Проверяем rate limit
  const canProceed = await checkRateLimit(adAccountId);
  if (!canProceed) {
    throw new Error('Rate limited, try again later');
  }

  // 2. Запускаем async job
  const timeRange = getDateRange(months);
  log.info({ adAccountId, timeRange }, 'Starting async insights job');

  const reportRunId = await startAsyncInsightsJob(accessToken, fbAdAccountId, timeRange);
  log.info({ adAccountId, reportRunId }, 'Async job started');

  // 3. Ждём завершения
  let pollCount = 0;
  let status = 'Job Running';

  while (status !== 'Job Completed' && pollCount < ASYNC_MAX_POLLS) {
    await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL));

    const jobStatus = await pollAsyncJobStatus(accessToken, reportRunId);
    status = jobStatus.status;

    log.info({
      adAccountId,
      reportRunId,
      status,
      progress: jobStatus.async_percent_completion
    }, 'Polling async job');

    if (status === 'Job Failed') {
      throw new Error('Async insights job failed');
    }

    pollCount++;
  }

  if (status !== 'Job Completed') {
    throw new Error(`Async job timeout after ${pollCount} polls`);
  }

  // 4. Получаем результаты
  const results = await fetchAsyncJobResults(accessToken, reportRunId);
  log.info({ adAccountId, resultsCount: results.length }, 'Fetched async job results');

  // 5. Сохраняем в БД
  let inserted = 0;
  let updated = 0;

  for (const row of results) {
    const weekStart = getWeekStart(row.date_start);

    const impressions = parseInt(row.impressions) || 0;
    const linkClicks = extractLinkClicks(row.actions);
    // Link CTR = link_clicks / impressions (CTR по ссылкам отдельно от общего CTR)
    const linkCtr = impressions > 0 ? (linkClicks / impressions) * 100 : null;

    const insight = {
      ad_account_id: adAccountId,
      fb_ad_id: row.ad_id,
      week_start_date: weekStart,
      spend: parseFloat(row.spend) || 0,
      impressions,
      reach: parseInt(row.reach) || 0,
      frequency: parseFloat(row.frequency) || 0,
      cpm: parseFloat(row.cpm) || 0,
      ctr: parseFloat(row.ctr) || 0,
      cpc: parseFloat(row.cpc) || 0,
      clicks: parseInt(row.clicks) || 0,
      link_clicks: linkClicks,
      link_ctr: linkCtr,
      actions_json: row.actions || [],
      cost_per_action_type_json: row.cost_per_action_type || [],
      video_views: extractVideoViews(row.actions),
      video_p25_watched: row.video_p25_watched_actions?.[0]?.value || 0,
      video_p50_watched: row.video_p50_watched_actions?.[0]?.value || 0,
      video_p75_watched: row.video_p75_watched_actions?.[0]?.value || 0,
      video_p95_watched: row.video_p95_watched_actions?.[0]?.value || 0,
      video_avg_time_watched_sec: row.video_avg_time_watched_actions?.[0]?.value || 0,
      // Rankings (raw + normalized scores)
      quality_ranking: row.quality_ranking,
      engagement_rate_ranking: row.engagement_rate_ranking,
      conversion_rate_ranking: row.conversion_rate_ranking,
      quality_rank_score: rankingToScore(row.quality_ranking),
      engagement_rank_score: rankingToScore(row.engagement_rate_ranking),
      conversion_rank_score: rankingToScore(row.conversion_rate_ranking),
      attribution_window: '7d_click_1d_view',
      synced_at: new Date().toISOString(),
    };

    try {
      await withRetry(async () => {
        const { error } = await supabase
          .from('meta_insights_weekly')
          .upsert(insight, {
            onConflict: 'ad_account_id,fb_ad_id,week_start_date',
            ignoreDuplicates: false
          });
        if (error) throw error;
      }, `upsert insight ad=${row.ad_id} week=${weekStart}`);
      inserted++;
    } catch (error) {
      log.error({ error, adId: row.ad_id, weekStart }, 'Failed to upsert insight');
    }
  }

  log.info({ adAccountId, inserted, updated }, 'Weekly insights synced');
  return { inserted, updated };
}

// ============================================================================
// CAMPAIGN/ADSET LEVEL WEEKLY INSIGHTS
// ============================================================================

/**
 * Синхронизирует weekly insights на уровне campaign
 */
export async function syncWeeklyInsightsCampaign(
  adAccountId: string,
  accessToken: string,
  fbAdAccountId: string,
  months: number = 12
): Promise<{ inserted: number }> {
  log.info({ adAccountId, fbAdAccountId, months }, 'Starting campaign-level insights sync');

  const canProceed = await checkRateLimit(adAccountId);
  if (!canProceed) {
    throw new Error('Rate limited, try again later');
  }

  const timeRange = getDateRange(months);

  const fields = [
    'campaign_id',
    'campaign_name',
    'spend',
    'impressions',
    'reach',
    'frequency',
    'cpm',
    'ctr',
    'cpc',
    'clicks',
    'actions',
    'cost_per_action_type',
    'quality_ranking',
    'engagement_rate_ranking',
    'conversion_rate_ranking',
  ].join(',');

  // Используем async job для campaign level
  const result = await graph('POST', `act_${fbAdAccountId}/insights`, accessToken, {
    level: 'campaign',
    time_increment: 7,
    time_range: JSON.stringify(timeRange),
    fields,
    action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
  });

  const reportRunId = result.report_run_id;
  if (!reportRunId) {
    throw new Error('No report_run_id in response for campaign insights');
  }

  // Poll for completion
  let pollCount = 0;
  let status = 'Job Running';

  while (status !== 'Job Completed' && pollCount < ASYNC_MAX_POLLS) {
    await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL));
    const jobStatus = await pollAsyncJobStatus(accessToken, reportRunId);
    status = jobStatus.status;

    if (status === 'Job Failed') {
      throw new Error('Async campaign insights job failed');
    }
    pollCount++;
  }

  if (status !== 'Job Completed') {
    throw new Error(`Async campaign job timeout after ${pollCount} polls`);
  }

  const results = await fetchAsyncJobResults(accessToken, reportRunId);
  log.info({ adAccountId, resultsCount: results.length }, 'Fetched campaign insights');

  let inserted = 0;

  for (const row of results) {
    const weekStart = getWeekStart(row.date_start);

    const insight = {
      ad_account_id: adAccountId,
      fb_campaign_id: row.campaign_id,
      week_start_date: weekStart,
      spend: parseFloat(row.spend) || 0,
      impressions: parseInt(row.impressions) || 0,
      reach: parseInt(row.reach) || 0,
      frequency: parseFloat(row.frequency) || 0,
      cpm: parseFloat(row.cpm) || 0,
      ctr: parseFloat(row.ctr) || 0,
      cpc: parseFloat(row.cpc) || 0,
      clicks: parseInt(row.clicks) || 0,
      link_clicks: extractLinkClicks(row.actions),
      actions_json: row.actions || [],
      cost_per_action_type_json: row.cost_per_action_type || [],
      quality_ranking: row.quality_ranking,
      engagement_rate_ranking: row.engagement_rate_ranking,
      conversion_rate_ranking: row.conversion_rate_ranking,
      attribution_window: '7d_click_1d_view',
      synced_at: new Date().toISOString(),
    };

    try {
      await withRetry(async () => {
        const { error } = await supabase
          .from('meta_insights_weekly_campaign')
          .upsert(insight, {
            onConflict: 'ad_account_id,fb_campaign_id,week_start_date',
            ignoreDuplicates: false
          });
        if (error) throw error;
      }, `upsert campaign insight campaign=${row.campaign_id} week=${weekStart}`);
      inserted++;
    } catch (error) {
      log.error({ error, campaignId: row.campaign_id, weekStart }, 'Failed to upsert campaign insight');
    }
  }

  log.info({ adAccountId, inserted }, 'Campaign-level insights synced');
  return { inserted };
}

/**
 * Синхронизирует weekly insights на уровне adset
 */
export async function syncWeeklyInsightsAdset(
  adAccountId: string,
  accessToken: string,
  fbAdAccountId: string,
  months: number = 12
): Promise<{ inserted: number }> {
  log.info({ adAccountId, fbAdAccountId, months }, 'Starting adset-level insights sync');

  const canProceed = await checkRateLimit(adAccountId);
  if (!canProceed) {
    throw new Error('Rate limited, try again later');
  }

  const timeRange = getDateRange(months);

  const fields = [
    'adset_id',
    'adset_name',
    'campaign_id',
    'spend',
    'impressions',
    'reach',
    'frequency',
    'cpm',
    'ctr',
    'cpc',
    'clicks',
    'actions',
    'cost_per_action_type',
    'quality_ranking',
    'engagement_rate_ranking',
    'conversion_rate_ranking',
  ].join(',');

  const result = await graph('POST', `act_${fbAdAccountId}/insights`, accessToken, {
    level: 'adset',
    time_increment: 7,
    time_range: JSON.stringify(timeRange),
    fields,
    action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
  });

  const reportRunId = result.report_run_id;
  if (!reportRunId) {
    throw new Error('No report_run_id in response for adset insights');
  }

  // Poll for completion
  let pollCount = 0;
  let status = 'Job Running';

  while (status !== 'Job Completed' && pollCount < ASYNC_MAX_POLLS) {
    await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL));
    const jobStatus = await pollAsyncJobStatus(accessToken, reportRunId);
    status = jobStatus.status;

    if (status === 'Job Failed') {
      throw new Error('Async adset insights job failed');
    }
    pollCount++;
  }

  if (status !== 'Job Completed') {
    throw new Error(`Async adset job timeout after ${pollCount} polls`);
  }

  const results = await fetchAsyncJobResults(accessToken, reportRunId);
  log.info({ adAccountId, resultsCount: results.length }, 'Fetched adset insights');

  let inserted = 0;

  for (const row of results) {
    const weekStart = getWeekStart(row.date_start);

    const insight = {
      ad_account_id: adAccountId,
      fb_adset_id: row.adset_id,
      fb_campaign_id: row.campaign_id,
      week_start_date: weekStart,
      spend: parseFloat(row.spend) || 0,
      impressions: parseInt(row.impressions) || 0,
      reach: parseInt(row.reach) || 0,
      frequency: parseFloat(row.frequency) || 0,
      cpm: parseFloat(row.cpm) || 0,
      ctr: parseFloat(row.ctr) || 0,
      cpc: parseFloat(row.cpc) || 0,
      clicks: parseInt(row.clicks) || 0,
      link_clicks: extractLinkClicks(row.actions),
      actions_json: row.actions || [],
      cost_per_action_type_json: row.cost_per_action_type || [],
      quality_ranking: row.quality_ranking,
      engagement_rate_ranking: row.engagement_rate_ranking,
      conversion_rate_ranking: row.conversion_rate_ranking,
      attribution_window: '7d_click_1d_view',
      synced_at: new Date().toISOString(),
    };

    try {
      await withRetry(async () => {
        const { error } = await supabase
          .from('meta_insights_weekly_adset')
          .upsert(insight, {
            onConflict: 'ad_account_id,fb_adset_id,week_start_date',
            ignoreDuplicates: false
          });
        if (error) throw error;
      }, `upsert adset insight adset=${row.adset_id} week=${weekStart}`);
      inserted++;
    } catch (error) {
      log.error({ error, adsetId: row.adset_id, weekStart }, 'Failed to upsert adset insight');
    }
  }

  log.info({ adAccountId, inserted }, 'Adset-level insights synced');
  return { inserted };
}

// ============================================================================
// CONTEXT-AWARE SYNC FUNCTIONS (support legacy + multi-account)
// ============================================================================

/**
 * Возвращает объект для upsert с правильными ID полями
 */
function getAccountIds(ctx: SyncContext): { ad_account_id: string | null; user_account_id: string } {
  return {
    ad_account_id: ctx.adAccountId,
    user_account_id: ctx.userAccountId,
  };
}

/**
 * Синхронизирует кампании с поддержкой контекста
 */
async function syncCampaignsWithContext(ctx: SyncContext): Promise<number> {
  log.info({ userAccountId: ctx.userAccountId, fbAdAccountId: ctx.fbAdAccountId, isLegacy: ctx.isLegacy }, 'Syncing campaigns');

  const fields = 'id,name,status,objective,created_time,updated_time';
  let cursor: string | undefined;
  let totalSynced = 0;
  const accountIds = getAccountIds(ctx);

  do {
    const params: any = { fields, limit: 500 };
    if (cursor) params.after = cursor;

    const result = await graph('GET', `act_${ctx.fbAdAccountId}/campaigns`, ctx.accessToken, params);

    if (result.data && result.data.length > 0) {
      const campaigns = result.data.map((c: any) => ({
        ...accountIds,
        fb_campaign_id: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective,
        created_time: c.created_time,
        updated_time: c.updated_time,
        synced_at: new Date().toISOString(),
      }));

      await withRetry(async () => {
        const { error } = await supabase
          .from('meta_campaigns')
          .upsert(campaigns, { onConflict: ctx.isLegacy ? 'user_account_id,fb_campaign_id' : 'ad_account_id,fb_campaign_id' });
        if (error) throw error;
      }, 'upsert campaigns');

      totalSynced += campaigns.length;
    }

    cursor = result.paging?.cursors?.after;
  } while (cursor);

  log.info({ userAccountId: ctx.userAccountId, totalSynced }, 'Campaigns synced');
  return totalSynced;
}

/**
 * Синхронизирует adsets с поддержкой контекста
 */
async function syncAdsetsWithContext(ctx: SyncContext): Promise<number> {
  log.info({ userAccountId: ctx.userAccountId, fbAdAccountId: ctx.fbAdAccountId, isLegacy: ctx.isLegacy }, 'Syncing adsets');

  const fields = 'id,name,status,campaign_id,optimization_goal,billing_event,targeting,created_time,updated_time';
  let cursor: string | undefined;
  let totalSynced = 0;
  const accountIds = getAccountIds(ctx);

  do {
    const params: any = { fields, limit: 500 };
    if (cursor) params.after = cursor;

    const result = await graph('GET', `act_${ctx.fbAdAccountId}/adsets`, ctx.accessToken, params);

    if (result.data && result.data.length > 0) {
      const adsets = result.data.map((a: any) => ({
        ...accountIds,
        fb_adset_id: a.id,
        fb_campaign_id: a.campaign_id,
        name: a.name,
        status: a.status,
        optimization_goal: a.optimization_goal,
        billing_event: a.billing_event,
        targeting: a.targeting,
        created_time: a.created_time,
        updated_time: a.updated_time,
        synced_at: new Date().toISOString(),
      }));

      await withRetry(async () => {
        const { error } = await supabase
          .from('meta_adsets')
          .upsert(adsets, { onConflict: ctx.isLegacy ? 'user_account_id,fb_adset_id' : 'ad_account_id,fb_adset_id' });
        if (error) throw error;
      }, 'upsert adsets');

      totalSynced += adsets.length;
    }

    cursor = result.paging?.cursors?.after;
  } while (cursor);

  log.info({ userAccountId: ctx.userAccountId, totalSynced }, 'Adsets synced');
  return totalSynced;
}

/**
 * Синхронизирует ads с поддержкой контекста
 */
async function syncAdsWithContext(ctx: SyncContext): Promise<number> {
  log.info({ userAccountId: ctx.userAccountId, fbAdAccountId: ctx.fbAdAccountId, isLegacy: ctx.isLegacy }, 'Syncing ads');

  const fields = 'id,name,status,adset_id,campaign_id,creative{id,object_story_spec},created_time,updated_time';
  let cursor: string | undefined;
  let totalSynced = 0;
  const accountIds = getAccountIds(ctx);

  do {
    const params: any = { fields, limit: 500 };
    if (cursor) params.after = cursor;

    const result = await graph('GET', `act_${ctx.fbAdAccountId}/ads`, ctx.accessToken, params);

    if (result.data && result.data.length > 0) {
      const ads = result.data.map((a: any) => ({
        ...accountIds,
        fb_ad_id: a.id,
        fb_adset_id: a.adset_id,
        fb_campaign_id: a.campaign_id,
        fb_creative_id: a.creative?.id,
        name: a.name,
        status: a.status,
        object_story_spec: a.creative?.object_story_spec,
        created_time: a.created_time,
        updated_time: a.updated_time,
        synced_at: new Date().toISOString(),
      }));

      await withRetry(async () => {
        const { error } = await supabase
          .from('meta_ads')
          .upsert(ads, { onConflict: ctx.isLegacy ? 'user_account_id,fb_ad_id' : 'ad_account_id,fb_ad_id' });
        if (error) throw error;
      }, 'upsert ads');

      totalSynced += ads.length;
    }

    cursor = result.paging?.cursors?.after;
  } while (cursor);

  log.info({ userAccountId: ctx.userAccountId, totalSynced }, 'Ads synced');
  return totalSynced;
}

/**
 * Синхронизирует weekly insights с поддержкой контекста
 */
async function syncWeeklyInsightsWithContext(ctx: SyncContext, months: number = 12): Promise<{ inserted: number; updated: number }> {
  log.info({ userAccountId: ctx.userAccountId, fbAdAccountId: ctx.fbAdAccountId, months, isLegacy: ctx.isLegacy }, 'Starting weekly insights sync');

  // Для rate limit используем userAccountId (он всегда есть)
  const rateLimitKey = ctx.adAccountId || ctx.userAccountId;
  const canProceed = await checkRateLimit(rateLimitKey);
  if (!canProceed) {
    throw new Error('Rate limited, try again later');
  }

  const timeRange = getDateRange(months);
  log.info({ userAccountId: ctx.userAccountId, timeRange }, 'Starting async insights job');

  const reportRunId = await startAsyncInsightsJob(ctx.accessToken, ctx.fbAdAccountId, timeRange);
  log.info({ userAccountId: ctx.userAccountId, reportRunId }, 'Async job started');

  let pollCount = 0;
  let status = 'Job Running';

  while (status !== 'Job Completed' && pollCount < ASYNC_MAX_POLLS) {
    await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL));
    const jobStatus = await pollAsyncJobStatus(ctx.accessToken, reportRunId);
    status = jobStatus.status;

    log.info({
      userAccountId: ctx.userAccountId,
      reportRunId,
      status,
      progress: jobStatus.async_percent_completion
    }, 'Polling async job');

    if (status === 'Job Failed') {
      throw new Error('Async insights job failed');
    }
    pollCount++;
  }

  if (status !== 'Job Completed') {
    throw new Error(`Async job timeout after ${pollCount} polls`);
  }

  const results = await fetchAsyncJobResults(ctx.accessToken, reportRunId);
  log.info({ userAccountId: ctx.userAccountId, resultsCount: results.length }, 'Fetched async job results');

  let inserted = 0;
  const updated = 0;
  const accountIds = getAccountIds(ctx);

  for (const row of results) {
    const weekStart = getWeekStart(row.date_start);
    const impressions = parseInt(row.impressions) || 0;
    const linkClicks = extractLinkClicks(row.actions);
    const linkCtr = impressions > 0 ? (linkClicks / impressions) * 100 : null;

    const insight = {
      ...accountIds,
      fb_ad_id: row.ad_id,
      week_start_date: weekStart,
      spend: parseFloat(row.spend) || 0,
      impressions,
      reach: parseInt(row.reach) || 0,
      frequency: parseFloat(row.frequency) || 0,
      cpm: parseFloat(row.cpm) || 0,
      ctr: parseFloat(row.ctr) || 0,
      cpc: parseFloat(row.cpc) || 0,
      clicks: parseInt(row.clicks) || 0,
      link_clicks: linkClicks,
      link_ctr: linkCtr,
      actions_json: row.actions || [],
      cost_per_action_type_json: row.cost_per_action_type || [],
      video_views: extractVideoViews(row.actions),
      video_p25_watched: row.video_p25_watched_actions?.[0]?.value || 0,
      video_p50_watched: row.video_p50_watched_actions?.[0]?.value || 0,
      video_p75_watched: row.video_p75_watched_actions?.[0]?.value || 0,
      video_p95_watched: row.video_p95_watched_actions?.[0]?.value || 0,
      video_avg_time_watched_sec: row.video_avg_time_watched_actions?.[0]?.value || 0,
      quality_ranking: row.quality_ranking,
      engagement_rate_ranking: row.engagement_rate_ranking,
      conversion_rate_ranking: row.conversion_rate_ranking,
      quality_rank_score: rankingToScore(row.quality_ranking),
      engagement_rank_score: rankingToScore(row.engagement_rate_ranking),
      conversion_rank_score: rankingToScore(row.conversion_rate_ranking),
      attribution_window: '7d_click_1d_view',
      synced_at: new Date().toISOString(),
    };

    try {
      await withRetry(async () => {
        const { error } = await supabase
          .from('meta_insights_weekly')
          .upsert(insight, {
            onConflict: ctx.isLegacy ? 'user_account_id,fb_ad_id,week_start_date' : 'ad_account_id,fb_ad_id,week_start_date',
            ignoreDuplicates: false
          });
        if (error) throw error;
      }, `upsert insight ad=${row.ad_id} week=${weekStart}`);
      inserted++;
    } catch (error) {
      log.error({ error, adId: row.ad_id, weekStart }, 'Failed to upsert insight');
    }
  }

  log.info({ userAccountId: ctx.userAccountId, inserted, updated }, 'Weekly insights synced');
  return { inserted, updated };
}

/**
 * Синхронизирует campaign-level insights с контекстом
 */
async function syncWeeklyInsightsCampaignWithContext(ctx: SyncContext, months: number = 12): Promise<{ inserted: number }> {
  log.info({ userAccountId: ctx.userAccountId, fbAdAccountId: ctx.fbAdAccountId, months }, 'Starting campaign-level insights sync');

  const rateLimitKey = ctx.adAccountId || ctx.userAccountId;
  const canProceed = await checkRateLimit(rateLimitKey);
  if (!canProceed) {
    throw new Error('Rate limited, try again later');
  }

  const timeRange = getDateRange(months);
  const fields = [
    'campaign_id', 'campaign_name', 'spend', 'impressions', 'reach', 'frequency',
    'cpm', 'ctr', 'cpc', 'clicks', 'actions', 'cost_per_action_type',
    'quality_ranking', 'engagement_rate_ranking', 'conversion_rate_ranking',
  ].join(',');

  const result = await graph('POST', `act_${ctx.fbAdAccountId}/insights`, ctx.accessToken, {
    level: 'campaign',
    time_increment: 7,
    time_range: JSON.stringify(timeRange),
    fields,
    action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
  });

  const reportRunId = result.report_run_id;
  if (!reportRunId) throw new Error('No report_run_id in response for campaign insights');

  let pollCount = 0;
  let status = 'Job Running';

  while (status !== 'Job Completed' && pollCount < ASYNC_MAX_POLLS) {
    await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL));
    const jobStatus = await pollAsyncJobStatus(ctx.accessToken, reportRunId);
    status = jobStatus.status;
    if (status === 'Job Failed') throw new Error('Async campaign insights job failed');
    pollCount++;
  }

  if (status !== 'Job Completed') throw new Error(`Async campaign job timeout after ${pollCount} polls`);

  const results = await fetchAsyncJobResults(ctx.accessToken, reportRunId);
  log.info({ userAccountId: ctx.userAccountId, resultsCount: results.length }, 'Fetched campaign insights');

  let inserted = 0;
  const accountIds = getAccountIds(ctx);

  for (const row of results) {
    const weekStart = getWeekStart(row.date_start);

    const insight = {
      ...accountIds,
      fb_campaign_id: row.campaign_id,
      week_start_date: weekStart,
      spend: parseFloat(row.spend) || 0,
      impressions: parseInt(row.impressions) || 0,
      reach: parseInt(row.reach) || 0,
      frequency: parseFloat(row.frequency) || 0,
      cpm: parseFloat(row.cpm) || 0,
      ctr: parseFloat(row.ctr) || 0,
      cpc: parseFloat(row.cpc) || 0,
      clicks: parseInt(row.clicks) || 0,
      link_clicks: extractLinkClicks(row.actions),
      actions_json: row.actions || [],
      cost_per_action_type_json: row.cost_per_action_type || [],
      quality_ranking: row.quality_ranking,
      engagement_rate_ranking: row.engagement_rate_ranking,
      conversion_rate_ranking: row.conversion_rate_ranking,
      attribution_window: '7d_click_1d_view',
      synced_at: new Date().toISOString(),
    };

    try {
      await withRetry(async () => {
        const { error } = await supabase
          .from('meta_insights_weekly_campaign')
          .upsert(insight, {
            onConflict: ctx.isLegacy ? 'user_account_id,fb_campaign_id,week_start_date' : 'ad_account_id,fb_campaign_id,week_start_date',
            ignoreDuplicates: false
          });
        if (error) throw error;
      }, `upsert campaign insight campaign=${row.campaign_id} week=${weekStart}`);
      inserted++;
    } catch (error) {
      log.error({ error, campaignId: row.campaign_id, weekStart }, 'Failed to upsert campaign insight');
    }
  }

  log.info({ userAccountId: ctx.userAccountId, inserted }, 'Campaign-level insights synced');
  return { inserted };
}

/**
 * Синхронизирует adset-level insights с контекстом
 */
async function syncWeeklyInsightsAdsetWithContext(ctx: SyncContext, months: number = 12): Promise<{ inserted: number }> {
  log.info({ userAccountId: ctx.userAccountId, fbAdAccountId: ctx.fbAdAccountId, months }, 'Starting adset-level insights sync');

  const rateLimitKey = ctx.adAccountId || ctx.userAccountId;
  const canProceed = await checkRateLimit(rateLimitKey);
  if (!canProceed) {
    throw new Error('Rate limited, try again later');
  }

  const timeRange = getDateRange(months);
  const fields = [
    'adset_id', 'adset_name', 'campaign_id', 'spend', 'impressions', 'reach', 'frequency',
    'cpm', 'ctr', 'cpc', 'clicks', 'actions', 'cost_per_action_type',
    'quality_ranking', 'engagement_rate_ranking', 'conversion_rate_ranking',
  ].join(',');

  const result = await graph('POST', `act_${ctx.fbAdAccountId}/insights`, ctx.accessToken, {
    level: 'adset',
    time_increment: 7,
    time_range: JSON.stringify(timeRange),
    fields,
    action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
  });

  const reportRunId = result.report_run_id;
  if (!reportRunId) throw new Error('No report_run_id in response for adset insights');

  let pollCount = 0;
  let status = 'Job Running';

  while (status !== 'Job Completed' && pollCount < ASYNC_MAX_POLLS) {
    await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL));
    const jobStatus = await pollAsyncJobStatus(ctx.accessToken, reportRunId);
    status = jobStatus.status;
    if (status === 'Job Failed') throw new Error('Async adset insights job failed');
    pollCount++;
  }

  if (status !== 'Job Completed') throw new Error(`Async adset job timeout after ${pollCount} polls`);

  const results = await fetchAsyncJobResults(ctx.accessToken, reportRunId);
  log.info({ userAccountId: ctx.userAccountId, resultsCount: results.length }, 'Fetched adset insights');

  let inserted = 0;
  const accountIds = getAccountIds(ctx);

  for (const row of results) {
    const weekStart = getWeekStart(row.date_start);

    const insight = {
      ...accountIds,
      fb_adset_id: row.adset_id,
      fb_campaign_id: row.campaign_id,
      week_start_date: weekStart,
      spend: parseFloat(row.spend) || 0,
      impressions: parseInt(row.impressions) || 0,
      reach: parseInt(row.reach) || 0,
      frequency: parseFloat(row.frequency) || 0,
      cpm: parseFloat(row.cpm) || 0,
      ctr: parseFloat(row.ctr) || 0,
      cpc: parseFloat(row.cpc) || 0,
      clicks: parseInt(row.clicks) || 0,
      link_clicks: extractLinkClicks(row.actions),
      actions_json: row.actions || [],
      cost_per_action_type_json: row.cost_per_action_type || [],
      quality_ranking: row.quality_ranking,
      engagement_rate_ranking: row.engagement_rate_ranking,
      conversion_rate_ranking: row.conversion_rate_ranking,
      attribution_window: '7d_click_1d_view',
      synced_at: new Date().toISOString(),
    };

    try {
      await withRetry(async () => {
        const { error } = await supabase
          .from('meta_insights_weekly_adset')
          .upsert(insight, {
            onConflict: ctx.isLegacy ? 'user_account_id,fb_adset_id,week_start_date' : 'ad_account_id,fb_adset_id,week_start_date',
            ignoreDuplicates: false
          });
        if (error) throw error;
      }, `upsert adset insight adset=${row.adset_id} week=${weekStart}`);
      inserted++;
    } catch (error) {
      log.error({ error, adsetId: row.adset_id, weekStart }, 'Failed to upsert adset insight');
    }
  }

  log.info({ userAccountId: ctx.userAccountId, inserted }, 'Adset-level insights synced');
  return { inserted };
}

/**
 * Синхронизирует daily insights с контекстом
 */
async function syncDailyInsightsWithContext(ctx: SyncContext, months: number = 3): Promise<{ inserted: number }> {
  log.info({ userAccountId: ctx.userAccountId, fbAdAccountId: ctx.fbAdAccountId, months }, 'Starting daily insights sync');

  const rateLimitKey = ctx.adAccountId || ctx.userAccountId;
  const canProceed = await checkRateLimit(rateLimitKey);
  if (!canProceed) {
    throw new Error('Rate limited, try again later');
  }

  const timeRange = getDateRange(months);
  const fields = ['ad_id', 'spend', 'impressions', 'reach', 'clicks', 'actions', 'outbound_clicks'].join(',');

  const result = await graph('POST', `act_${ctx.fbAdAccountId}/insights`, ctx.accessToken, {
    level: 'ad',
    time_increment: 1,
    time_range: JSON.stringify(timeRange),
    fields,
    action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
  });

  const reportRunId = result.report_run_id;
  if (!reportRunId) throw new Error('No report_run_id in response for daily insights');

  log.info({ userAccountId: ctx.userAccountId, reportRunId }, 'Daily async job started');

  let pollCount = 0;
  let status = 'Job Running';

  while (status !== 'Job Completed' && pollCount < ASYNC_MAX_POLLS) {
    await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL));
    const jobStatus = await pollAsyncJobStatus(ctx.accessToken, reportRunId);
    status = jobStatus.status;

    log.info({
      userAccountId: ctx.userAccountId,
      reportRunId,
      status,
      progress: jobStatus.async_percent_completion
    }, 'Polling daily async job');

    if (status === 'Job Failed') throw new Error('Async daily insights job failed');
    pollCount++;
  }

  if (status !== 'Job Completed') throw new Error(`Async daily job timeout after ${pollCount} polls`);

  const results = await fetchAsyncJobResults(ctx.accessToken, reportRunId);
  log.info({ userAccountId: ctx.userAccountId, resultsCount: results.length }, 'Fetched daily async job results');

  let inserted = 0;
  const accountIds = getAccountIds(ctx);

  for (const row of results) {
    const date = row.date_start;
    const impressions = parseInt(row.impressions) || 0;
    const clicks = parseInt(row.clicks) || 0;
    const spend = parseFloat(row.spend) || 0;
    const reach = parseInt(row.reach) || 0;

    const linkClicks = row.outbound_clicks?.[0]?.value
      ? parseInt(row.outbound_clicks[0].value)
      : extractLinkClicks(row.actions);

    const ctr = impressions > 0 ? (clicks / impressions) * 100 : null;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : null;
    const cpc = clicks > 0 ? spend / clicks : null;
    const frequency = reach > 0 ? impressions / reach : null;
    const linkCtr = impressions > 0 ? (linkClicks / impressions) * 100 : null;

    const insight = {
      ...accountIds,
      fb_ad_id: row.ad_id,
      date,
      impressions,
      clicks,
      spend,
      reach,
      ctr,
      cpm,
      cpc,
      frequency,
      link_clicks: linkClicks,
      link_ctr: linkCtr,
      actions_json: row.actions || null,
      results_count: extractResultsCount(row.actions),
      created_at: new Date().toISOString(),
    };

    try {
      await withRetry(async () => {
        const { error } = await supabase
          .from('meta_insights_daily')
          .upsert(insight, {
            onConflict: ctx.isLegacy ? 'user_account_id,fb_ad_id,date' : 'ad_account_id,fb_ad_id,date',
            ignoreDuplicates: false
          });
        if (error) throw error;
      }, `upsert daily insight ad=${row.ad_id} date=${date}`);
      inserted++;
    } catch (error) {
      log.error({ error, adId: row.ad_id, date }, 'Failed to upsert daily insight');
    }
  }

  log.info({ userAccountId: ctx.userAccountId, inserted }, 'Daily insights synced');
  return { inserted };
}

// ============================================================================
// FULL SYNC ORCHESTRATOR
// ============================================================================

/**
 * Полная синхронизация ad account (справочники + insights на всех уровнях)
 * Поддерживает legacy и multi-account режимы
 */
export async function fullSync(accountUuid: string, options?: {
  syncCampaignInsights?: boolean;
  syncAdsetInsights?: boolean;
  syncDailyInsights?: boolean;
  // Credentials могут быть переданы извне (для legacy режима)
  accessToken?: string;
  fbAdAccountId?: string;
  isLegacy?: boolean;
}): Promise<{
  campaigns: number;
  adsets: number;
  ads: number;
  insights: { inserted: number; updated: number };
  campaignInsights?: { inserted: number };
  adsetInsights?: { inserted: number };
  dailyInsights?: { inserted: number };
}> {
  const {
    syncCampaignInsights = true,
    syncAdsetInsights = true,
    syncDailyInsights: shouldSyncDaily = true,
    accessToken: providedToken,
    fbAdAccountId: providedFbAccountId,
    isLegacy = false,
  } = options || {};

  let ctx: SyncContext;

  if (isLegacy && providedToken && providedFbAccountId) {
    // Legacy режим: credentials переданы извне, accountUuid = user_account_id
    ctx = {
      adAccountId: null,  // Для legacy не используем ad_account_id
      userAccountId: accountUuid,
      accessToken: providedToken,
      fbAdAccountId: providedFbAccountId.replace('act_', ''),
      isLegacy: true,
    };
  } else {
    // Multi-account режим: получаем credentials из ad_accounts
    const { data: adAccount, error } = await supabase
      .from('ad_accounts')
      .select('id, ad_account_id, access_token, user_account_id')
      .eq('id', accountUuid)
      .single();

    if (error || !adAccount) {
      throw new Error(`Ad account not found: ${accountUuid}`);
    }

    if (!adAccount.access_token) {
      throw new Error('No access token for ad account');
    }

    ctx = {
      adAccountId: adAccount.id,
      userAccountId: adAccount.user_account_id,
      accessToken: adAccount.access_token,
      fbAdAccountId: adAccount.ad_account_id.replace('act_', ''),
      isLegacy: false,
    };
  }

  log.info({ accountUuid, fbAdAccountId: ctx.fbAdAccountId, isLegacy: ctx.isLegacy }, 'Starting full sync');

  // 2. Синхронизируем справочники
  const campaigns = await syncCampaignsWithContext(ctx);
  const adsets = await syncAdsetsWithContext(ctx);
  const ads = await syncAdsWithContext(ctx);

  // 3. Синхронизируем ad-level insights
  const insights = await syncWeeklyInsightsWithContext(ctx, 12);

  // 4. Синхронизируем campaign-level insights (опционально)
  let campaignInsights: { inserted: number } | undefined;
  if (syncCampaignInsights) {
    try {
      campaignInsights = await syncWeeklyInsightsCampaignWithContext(ctx, 12);
    } catch (err: any) {
      log.error({ errorMessage: err?.message, errorStack: err?.stack, accountUuid }, 'Failed to sync campaign insights');
    }
  }

  // 5. Синхронизируем adset-level insights (опционально)
  let adsetInsights: { inserted: number } | undefined;
  if (syncAdsetInsights) {
    try {
      adsetInsights = await syncWeeklyInsightsAdsetWithContext(ctx, 12);
    } catch (err: any) {
      log.error({ errorMessage: err?.message, errorStack: err?.stack, accountUuid }, 'Failed to sync adset insights');
    }
  }

  // 6. Синхронизируем daily insights (для детекции пауз)
  let dailyInsights: { inserted: number } | undefined;
  if (shouldSyncDaily) {
    try {
      dailyInsights = await syncDailyInsightsWithContext(ctx, 3);
    } catch (err: any) {
      log.error({ errorMessage: err?.message, errorStack: err?.stack, accountUuid }, 'Failed to sync daily insights');
    }
  }

  log.info({
    accountUuid,
    isLegacy: ctx.isLegacy,
    campaigns,
    adsets,
    ads,
    insights,
    campaignInsights,
    adsetInsights,
    dailyInsights,
  }, 'Full sync completed');

  return { campaigns, adsets, ads, insights, campaignInsights, adsetInsights, dailyInsights };
}

/**
 * Синхронизация всех активных ad accounts
 */
export async function syncAllAccounts(): Promise<Map<string, any>> {
  const { data: accounts, error } = await supabase
    .from('ad_accounts')
    .select('id, ad_account_id')
    .eq('connection_status', 'connected')
    .not('access_token', 'is', null);

  if (error) {
    log.error({ error }, 'Failed to fetch ad accounts');
    throw error;
  }

  const results = new Map<string, any>();

  for (const account of accounts || []) {
    try {
      const result = await fullSync(account.id);
      results.set(account.id, { success: true, ...result });
    } catch (err: any) {
      log.error({ error: err, adAccountId: account.id }, 'Failed to sync account');
      results.set(account.id, { success: false, error: err.message });
    }
  }

  return results;
}

// ============================================================================
// DAILY INSIGHTS SYNC (для детекции пауз)
// ============================================================================

/**
 * Извлекает общее количество результатов из actions
 */
function extractResultsCount(actions: any[]): number {
  if (!Array.isArray(actions)) return 0;
  // Результаты - это различные conversion actions
  const resultTypes = [
    'lead', 'purchase', 'complete_registration', 'contact',
    'add_to_cart', 'initiate_checkout', 'submit_application'
  ];
  let total = 0;
  for (const action of actions) {
    if (resultTypes.includes(action.action_type)) {
      total += parseInt(action.value) || 0;
    }
  }
  return total;
}

/**
 * Синхронизирует daily insights для ad account
 * Используется для детекции пауз в доставке
 */
export async function syncDailyInsights(
  adAccountId: string,
  accessToken: string,
  fbAdAccountId: string,
  months: number = 3 // За 3 месяца для анализа пауз
): Promise<{ inserted: number }> {
  log.info({ adAccountId, fbAdAccountId, months }, 'Starting daily insights sync');

  // 1. Проверяем rate limit
  const canProceed = await checkRateLimit(adAccountId);
  if (!canProceed) {
    throw new Error('Rate limited, try again later');
  }

  // 2. Запускаем async job с time_increment=1 (daily)
  const timeRange = getDateRange(months);

  const fields = [
    'ad_id',
    'spend',
    'impressions',
    'reach',
    'clicks',
    'actions',
    'outbound_clicks',  // Для link_clicks
  ].join(',');

  const result = await graph('POST', `act_${fbAdAccountId}/insights`, accessToken, {
    level: 'ad',
    time_increment: 1, // DAILY (not weekly)
    time_range: JSON.stringify(timeRange),
    fields,
    action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
  });

  const reportRunId = result.report_run_id;
  if (!reportRunId) {
    throw new Error('No report_run_id in response for daily insights');
  }

  log.info({ adAccountId, reportRunId }, 'Daily async job started');

  // 3. Ждём завершения
  let pollCount = 0;
  let status = 'Job Running';

  while (status !== 'Job Completed' && pollCount < ASYNC_MAX_POLLS) {
    await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL));

    const jobStatus = await pollAsyncJobStatus(accessToken, reportRunId);
    status = jobStatus.status;

    log.info({
      adAccountId,
      reportRunId,
      status,
      progress: jobStatus.async_percent_completion
    }, 'Polling daily async job');

    if (status === 'Job Failed') {
      throw new Error('Async daily insights job failed');
    }

    pollCount++;
  }

  if (status !== 'Job Completed') {
    throw new Error(`Async daily job timeout after ${pollCount} polls`);
  }

  // 4. Получаем результаты
  const results = await fetchAsyncJobResults(accessToken, reportRunId);
  log.info({ adAccountId, resultsCount: results.length }, 'Fetched daily async job results');

  // 5. Сохраняем в БД
  let inserted = 0;

  for (const row of results) {
    const date = row.date_start; // Дата без времени
    const impressions = parseInt(row.impressions) || 0;
    const clicks = parseInt(row.clicks) || 0;
    const spend = parseFloat(row.spend) || 0;
    const reach = parseInt(row.reach) || 0;

    // Link clicks: приоритет outbound_clicks, иначе из actions
    const linkClicks = row.outbound_clicks?.[0]?.value
      ? parseInt(row.outbound_clicks[0].value)
      : extractLinkClicks(row.actions);

    // Вычисляемые метрики
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : null;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : null;
    const cpc = clicks > 0 ? spend / clicks : null;
    const frequency = reach > 0 ? impressions / reach : null;
    const linkCtr = impressions > 0 ? (linkClicks / impressions) * 100 : null;

    const insight = {
      ad_account_id: adAccountId,
      fb_ad_id: row.ad_id,
      date,
      impressions,
      clicks,
      spend,
      reach,
      ctr,
      cpm,
      cpc,
      // Новые поля (миграция 123)
      frequency,
      link_clicks: linkClicks,
      link_ctr: linkCtr,
      actions_json: row.actions || null,
      results_count: extractResultsCount(row.actions),
      created_at: new Date().toISOString(),
    };

    try {
      await withRetry(async () => {
        const { error } = await supabase
          .from('meta_insights_daily')
          .upsert(insight, {
            onConflict: 'ad_account_id,fb_ad_id,date',
            ignoreDuplicates: false
          });
        if (error) throw error;
      }, `upsert daily insight ad=${row.ad_id} date=${date}`);
      inserted++;
    } catch (error) {
      log.error({ error, adId: row.ad_id, date }, 'Failed to upsert daily insight');
    }
  }

  log.info({ adAccountId, inserted }, 'Daily insights synced');
  return { inserted };
}
