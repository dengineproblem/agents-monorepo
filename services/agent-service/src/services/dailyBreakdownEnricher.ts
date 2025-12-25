/**
 * DAILY BREAKDOWN ENRICHER SERVICE
 *
 * Обогащает аномалии детализацией по дням.
 * Запрашивает данные из Facebook API если их нет в БД.
 *
 * Вызывается отдельным endpoint:
 * POST /admin/ad-insights/:accountId/enrich-daily-breakdown
 */

import { supabase } from '../lib/supabaseClient.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'dailyBreakdownEnricher' });

// ============================================================================
// TYPES
// ============================================================================

type DeviationDirection = 'bad' | 'good' | 'neutral';
type MetricName = 'frequency' | 'ctr' | 'link_ctr' | 'cpm' | 'cpr' | 'spend' | 'results';

interface DailyMetrics {
  impressions: number;
  spend: number;
  frequency: number | null;
  ctr: number | null;
  link_ctr: number | null;
  cpm: number | null;
  cpr: number | null;
  results: number;
}

interface DailyDeviation {
  metric: MetricName;
  value: number;
  week_avg: number;
  delta_pct: number;
  is_significant: boolean;
  direction: DeviationDirection;
}

interface DayBreakdown {
  date: string;
  metrics: DailyMetrics;
  deviations: DailyDeviation[];
}

interface DailyBreakdownResult {
  days: DayBreakdown[];
  summary: {
    worst_day: string | null;
    best_day: string | null;
    active_days: number;
    pause_days: number;
  };
}

interface Anomaly {
  id: string;
  fb_ad_id: string;
  week_start_date: string;
  result_family: string;
}

// ============================================================================
// FACEBOOK API
// ============================================================================

const FB_API_VERSION = 'v21.0';
const FB_BASE_URL = `https://graph.facebook.com/${FB_API_VERSION}`;
const ASYNC_POLL_INTERVAL = 5000;
const ASYNC_MAX_POLLS = 120; // 10 минут максимум для большых диапазонов

async function graph(
  method: 'GET' | 'POST',
  endpoint: string,
  accessToken: string,
  params: Record<string, any> = {}
): Promise<any> {
  const url = new URL(`${FB_BASE_URL}/${endpoint}`);

  if (method === 'GET') {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, String(value));
    });
    url.searchParams.append('access_token', accessToken);
  }

  const response = await fetch(url.toString(), {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
    body: method === 'POST'
      ? new URLSearchParams({ ...params, access_token: accessToken }).toString()
      : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FB API error: ${response.status} ${errorText}`);
  }

  return response.json();
}

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

async function fetchAsyncJobResults(accessToken: string, reportRunId: string): Promise<any[]> {
  const results: any[] = [];
  let cursor: string | undefined;
  let pageNum = 0;
  let emptyPages = 0;
  const MAX_EMPTY_PAGES = 3; // Останавливаемся после 3 пустых страниц подряд

  log.info({ reportRunId }, 'Starting to fetch async job results...');

  do {
    const params: Record<string, any> = { limit: 500 };
    if (cursor) params.after = cursor;

    const result = await graph('GET', `${reportRunId}/insights`, accessToken, params);
    const pageRows = result.data?.length || 0;

    if (pageRows > 0) {
      results.push(...result.data);
      emptyPages = 0; // Сбрасываем счётчик пустых страниц
    } else {
      emptyPages++;
      if (emptyPages >= MAX_EMPTY_PAGES) {
        log.info({ reportRunId, pageNum, emptyPages }, 'Stopping after consecutive empty pages');
        break;
      }
    }

    pageNum++;
    if (pageRows > 0) {
      log.info({ reportRunId, pageNum, pageRows, totalRows: results.length }, 'Fetched results page');
    }

    cursor = result.paging?.cursors?.after;
  } while (cursor);

  log.info({ reportRunId, totalRows: results.length }, 'Finished fetching async job results');
  return results;
}

function extractLinkClicks(actions: any[]): number {
  if (!Array.isArray(actions)) return 0;
  const linkClickTypes = ['link_click', 'outbound_click'];
  for (const action of actions) {
    if (linkClickTypes.includes(action.action_type)) {
      return parseInt(action.value) || 0;
    }
  }
  return 0;
}

function extractResultsCount(actions: any[]): number {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  const resultTypes = ['lead', 'purchase', 'complete_registration', 'submit_application', 'contact'];
  for (const action of actions) {
    if (resultTypes.includes(action.action_type)) {
      total += parseInt(action.value) || 0;
    }
  }
  return total;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEVIATION_THRESHOLDS: Record<MetricName, number> = {
  frequency: 15,
  ctr: 15,
  link_ctr: 15,
  cpm: 15,
  cpr: 20,
  spend: 30,
  results: 20,
};

const BAD_DIRECTION: Record<MetricName, 'increase' | 'decrease'> = {
  frequency: 'increase',
  ctr: 'decrease',
  link_ctr: 'decrease',
  cpm: 'increase',
  cpr: 'increase',
  spend: 'increase',
  results: 'decrease',
};

// ============================================================================
// HELPERS
// ============================================================================

function median(values: number[]): number | null {
  const filtered = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (filtered.length === 0) return null;

  const sorted = [...filtered].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function getDeviationDirection(metric: MetricName, deltaPct: number): DeviationDirection {
  const threshold = DEVIATION_THRESHOLDS[metric];
  if (Math.abs(deltaPct) < threshold) {
    return 'neutral';
  }

  const badDirection = BAD_DIRECTION[metric];
  if (badDirection === 'increase') {
    return deltaPct > 0 ? 'bad' : 'good';
  } else {
    return deltaPct < 0 ? 'bad' : 'good';
  }
}

function getWeekEndDate(weekStartDate: string): string {
  const start = new Date(weekStartDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return end.toISOString().split('T')[0];
}

// ============================================================================
// FETCH DAILY DATA FROM FB API
// ============================================================================

/**
 * Запрашивает daily insights из FB API для конкретного диапазона дат
 * и сохраняет в meta_insights_daily
 */
async function fetchAndSaveDailyInsights(
  adAccountId: string,
  accessToken: string,
  fbAdAccountId: string,
  since: string,
  until: string
): Promise<number> {
  log.info({ adAccountId, since, until }, 'Fetching daily insights from FB API');

  const fields = [
    'ad_id',
    'spend',
    'impressions',
    'reach',
    'clicks',
    'actions',
    'outbound_clicks',
  ].join(',');

  const timeRange = JSON.stringify({ since, until });

  const result = await graph('POST', `act_${fbAdAccountId}/insights`, accessToken, {
    level: 'ad',
    time_increment: 1, // DAILY
    time_range: timeRange,
    fields,
    action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
  });

  const reportRunId = result.report_run_id;
  if (!reportRunId) {
    throw new Error('No report_run_id in response');
  }

  log.info({ adAccountId, reportRunId }, 'Daily async job started');

  // Ждём завершения
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
      progress: jobStatus.async_percent_completion,
      pollCount
    }, 'Polling daily async job');

    if (status === 'Job Failed') {
      throw new Error('Async daily insights job failed');
    }

    pollCount++;
  }

  if (status !== 'Job Completed') {
    throw new Error(`Async daily job timeout after ${pollCount} polls`);
  }

  // Получаем результаты
  const results = await fetchAsyncJobResults(accessToken, reportRunId);
  log.info({ adAccountId, resultsCount: results.length }, 'Fetched daily insights from FB API');

  // Сохраняем в БД batch-ами
  const total = results.length;
  const BATCH_SIZE = 500;

  log.info({ adAccountId, total }, 'Saving daily insights to DB (batch mode)...');

  // Подготавливаем все записи
  const insights = results.map(row => {
    const impressions = parseInt(row.impressions) || 0;
    const clicks = parseInt(row.clicks) || 0;
    const spend = parseFloat(row.spend) || 0;
    const reach = parseInt(row.reach) || 0;

    const linkClicks = row.outbound_clicks?.[0]?.value
      ? parseInt(row.outbound_clicks[0].value)
      : extractLinkClicks(row.actions);

    return {
      ad_account_id: adAccountId,
      fb_ad_id: row.ad_id,
      date: row.date_start,
      impressions,
      clicks,
      spend,
      reach,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
      cpc: clicks > 0 ? spend / clicks : null,
      frequency: reach > 0 ? impressions / reach : null,
      link_clicks: linkClicks,
      link_ctr: impressions > 0 ? (linkClicks / impressions) * 100 : null,
      actions_json: row.actions || null,
      results_count: extractResultsCount(row.actions),
      created_at: new Date().toISOString(),
    };
  });

  // Batch upsert
  let saved = 0;
  for (let i = 0; i < insights.length; i += BATCH_SIZE) {
    const batch = insights.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from('meta_insights_daily')
      .upsert(batch, {
        onConflict: 'ad_account_id,fb_ad_id,date',
      });

    if (!error) {
      saved += batch.length;
    } else {
      log.error({ error, batchStart: i }, 'Batch upsert failed');
    }

    log.info({ adAccountId, saved, total }, 'Batch saved');
  }

  log.info({ adAccountId, saved, total }, 'Saved daily insights to DB');
  return saved;
}

// ============================================================================
// BUILD DAILY BREAKDOWN
// ============================================================================

/**
 * Формирует daily breakdown для одной аномалии
 */
async function buildDailyBreakdown(
  adAccountId: string,
  fbAdId: string,
  weekStartDate: string
): Promise<DailyBreakdownResult | null> {
  const weekEndDate = getWeekEndDate(weekStartDate);

  // Загружаем daily insights за неделю
  const { data: dailyData, error } = await supabase
    .from('meta_insights_daily')
    .select('date, impressions, clicks, spend, reach, ctr, cpm, cpc, frequency, link_clicks, link_ctr, results_count')
    .eq('ad_account_id', adAccountId)
    .eq('fb_ad_id', fbAdId)
    .gte('date', weekStartDate)
    .lte('date', weekEndDate)
    .order('date', { ascending: true });

  if (error) {
    log.error({ error, fbAdId, weekStartDate }, 'Failed to load daily insights');
    return null;
  }

  if (!dailyData || dailyData.length === 0) {
    log.debug({ fbAdId, weekStartDate }, 'No daily data found');
    return null;
  }

  // Вычисляем CPR для каждого дня
  const daysWithCpr = dailyData.map(day => {
    const results = day.results_count || 0;
    const spend = parseFloat(day.spend) || 0;
    const cpr = results > 0 ? spend / results : null;
    return { ...day, cpr, spend };
  });

  // Вычисляем week averages (медианы)
  const weekAvgs = {
    ctr: median(daysWithCpr.map(d => d.ctr).filter(v => v !== null && v > 0) as number[]),
    link_ctr: median(daysWithCpr.map(d => d.link_ctr).filter(v => v !== null && v > 0) as number[]),
    cpm: median(daysWithCpr.map(d => d.cpm).filter(v => v !== null && v > 0) as number[]),
    frequency: median(daysWithCpr.map(d => d.frequency).filter(v => v !== null && v > 0) as number[]),
    cpr: median(daysWithCpr.map(d => d.cpr).filter(v => v !== null && v > 0) as number[]),
    spend: median(daysWithCpr.map(d => d.spend).filter(v => v > 0)),
    results: median(daysWithCpr.map(d => d.results_count).filter(v => v > 0)),
  };

  // Формируем breakdown по дням
  const days: DayBreakdown[] = daysWithCpr.map(day => {
    const metrics: DailyMetrics = {
      impressions: day.impressions || 0,
      spend: day.spend,
      frequency: day.frequency,
      ctr: day.ctr,
      link_ctr: day.link_ctr,
      cpm: day.cpm,
      cpr: day.cpr,
      results: day.results_count || 0,
    };

    const deviations: DailyDeviation[] = [];

    const addDeviation = (
      metric: MetricName,
      value: number | null,
      weekAvg: number | null
    ) => {
      if (value !== null && weekAvg !== null && weekAvg > 0) {
        const deltaPct = ((value - weekAvg) / weekAvg) * 100;
        const threshold = DEVIATION_THRESHOLDS[metric];
        const isSignificant = Math.abs(deltaPct) >= threshold;
        const direction = getDeviationDirection(metric, deltaPct);

        deviations.push({
          metric,
          value,
          week_avg: weekAvg,
          delta_pct: Math.round(deltaPct * 10) / 10,
          is_significant: isSignificant,
          direction,
        });
      }
    };

    addDeviation('cpr', day.cpr, weekAvgs.cpr);
    addDeviation('ctr', day.ctr, weekAvgs.ctr);
    addDeviation('link_ctr', day.link_ctr, weekAvgs.link_ctr);
    addDeviation('cpm', day.cpm, weekAvgs.cpm);
    addDeviation('frequency', day.frequency, weekAvgs.frequency);
    addDeviation('spend', day.spend, weekAvgs.spend);
    addDeviation('results', day.results_count, weekAvgs.results);

    return {
      date: day.date,
      metrics,
      deviations,
    };
  });

  // Определяем worst/best дни по CPR
  const daysWithResults = days.filter(d => d.metrics.results > 0 && d.metrics.cpr !== null);
  let worstDay: string | null = null;
  let bestDay: string | null = null;

  if (daysWithResults.length > 0) {
    const sorted = [...daysWithResults].sort((a, b) =>
      (b.metrics.cpr ?? 0) - (a.metrics.cpr ?? 0)
    );
    worstDay = sorted[0].date;
    bestDay = sorted[sorted.length - 1].date;
  }

  const activeDays = days.filter(d => d.metrics.impressions > 0).length;
  const pauseDays = 7 - activeDays;

  return {
    days,
    summary: {
      worst_day: worstDay,
      best_day: bestDay,
      active_days: activeDays,
      pause_days: pauseDays,
    },
  };
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Обогащает аномалии для ad account детализацией по дням
 * Если данных нет в БД — запрашивает из FB API
 */
export async function enrichDailyBreakdown(adAccountId: string, options?: {
  forceRefresh?: boolean;
  limit?: number;
}): Promise<{ enriched: number; skipped: number; errors: number; fetched: number }> {
  const { forceRefresh = false, limit } = options || {};

  log.info({ adAccountId, forceRefresh, limit }, 'Starting daily breakdown enrichment');

  // 1. Получаем credentials
  const { data: adAccount, error: accountError } = await supabase
    .from('ad_accounts')
    .select('id, ad_account_id, access_token')
    .eq('id', adAccountId)
    .single();

  if (accountError || !adAccount) {
    log.error({ error: accountError, adAccountId }, 'Failed to get ad account');
    throw new Error('Ad account not found');
  }

  if (!adAccount.access_token) {
    throw new Error('No access token for ad account');
  }

  const fbAdAccountId = adAccount.ad_account_id.replace('act_', '');
  const accessToken = adAccount.access_token;

  // 2. Загружаем аномалии
  let query = supabase
    .from('ad_weekly_anomalies')
    .select('id, fb_ad_id, week_start_date, result_family')
    .eq('ad_account_id', adAccountId)
    .order('week_start_date', { ascending: false });

  if (!forceRefresh) {
    query = query.is('daily_breakdown', null);
  }

  if (limit) {
    query = query.limit(limit);
  }

  const { data: anomalies, error } = await query;

  if (error) {
    log.error({ error, adAccountId }, 'Failed to load anomalies');
    throw error;
  }

  if (!anomalies || anomalies.length === 0) {
    log.info({ adAccountId }, 'No anomalies to enrich');
    return { enriched: 0, skipped: 0, errors: 0, fetched: 0 };
  }

  log.info({ adAccountId, count: anomalies.length }, 'Anomalies to process');

  // 3. Определяем диапазон дат для всех аномалий
  const weekDates = anomalies.map(a => a.week_start_date);
  const minDate = weekDates.reduce((a, b) => a < b ? a : b);
  const maxWeekStart = weekDates.reduce((a, b) => a > b ? a : b);
  const maxDate = getWeekEndDate(maxWeekStart);

  log.info({ adAccountId, minDate, maxDate }, 'Date range for daily insights');

  // 4. Проверяем какие данные уже есть в БД
  const { data: existingDates } = await supabase
    .from('meta_insights_daily')
    .select('date')
    .eq('ad_account_id', adAccountId)
    .gte('date', minDate)
    .lte('date', maxDate);

  const existingSet = new Set((existingDates || []).map(d => d.date));

  // Проверяем нужно ли запрашивать данные из FB API
  let fetched = 0;
  const needFetch = anomalies.some(a => {
    const weekEnd = getWeekEndDate(a.week_start_date);
    // Проверяем есть ли хотя бы одна дата из этой недели
    for (let d = new Date(a.week_start_date); d <= new Date(weekEnd); d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      if (existingSet.has(dateStr)) {
        return false; // Есть данные, не нужно запрашивать
      }
    }
    return true; // Нет данных, нужно запросить
  });

  if (needFetch) {
    log.info({ adAccountId, minDate, maxDate }, 'Fetching missing daily data from FB API');
    try {
      fetched = await fetchAndSaveDailyInsights(adAccountId, accessToken, fbAdAccountId, minDate, maxDate);
    } catch (err: any) {
      log.error({ error: err?.message, adAccountId }, 'Failed to fetch daily insights from FB API');
      // Продолжаем с тем что есть
    }
  }

  // 5. Обрабатываем каждую аномалию
  let enriched = 0;
  let skipped = 0;
  let errors = 0;

  for (const anomaly of anomalies) {
    try {
      const breakdown = await buildDailyBreakdown(
        adAccountId,
        anomaly.fb_ad_id,
        anomaly.week_start_date
      );

      if (!breakdown) {
        skipped++;
        continue;
      }

      const { error: updateError } = await supabase
        .from('ad_weekly_anomalies')
        .update({ daily_breakdown: breakdown })
        .eq('id', anomaly.id);

      if (updateError) {
        log.error({ error: updateError, anomalyId: anomaly.id }, 'Failed to update anomaly');
        errors++;
      } else {
        enriched++;
      }
    } catch (err) {
      log.error({ error: err, anomalyId: anomaly.id }, 'Error processing anomaly');
      errors++;
    }
  }

  log.info({ adAccountId, enriched, skipped, errors, fetched }, 'Daily breakdown enrichment completed');

  return { enriched, skipped, errors, fetched };
}
