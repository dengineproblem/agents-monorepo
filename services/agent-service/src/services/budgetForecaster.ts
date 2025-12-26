/**
 * BUDGET FORECASTER SERVICE
 *
 * Прогнозирование бюджета на основе исторических данных:
 * - Baseline forecast: что будет если ничего не менять
 * - Scaling forecast: что будет при увеличении spend на +20/50/100%
 * - Модель эластичности k с pooling (ad → account → global → fallback)
 */

import { supabase } from '../lib/supabaseClient.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'budgetForecaster' });

// ============================================================================
// TYPES
// ============================================================================

/**
 * Контекст аккаунта для запросов.
 * Legacy: user_account_id NOT NULL, ad_account_id NULL
 * Multi-account: ad_account_id NOT NULL
 */
export interface AccountContext {
  user_account_id: string;
  ad_account_id: string | null;
  is_legacy: boolean;
}

export interface WeeklyForecast {
  week_offset: number;        // 1 или 2
  spend_predicted: number;
  cpr_predicted: number;
  results_predicted: number;
  confidence: number;
}

export interface ElasticityK {
  ad_level: number | null;
  account_family_level: number | null;
  global_family_level: number | null;
  fallback: number;
  effective: number;
  source: 'ad' | 'account_family' | 'global_family' | 'fallback';
  events_used: number;
}

export interface ForecastEligibility {
  is_eligible: boolean;
  reason?: string;
  min_spend_met: boolean;
  min_results_met: boolean;
  weeks_with_data: number;
}

export interface BaselineForecast {
  median_cpr: number;
  median_spend: number;
  median_results: number;
  cpr_slope: number;
  weeks_analyzed: number;
}

export interface AdForecast {
  fb_ad_id: string;
  ad_name: string;
  result_family: string;
  current_week: {
    week_start_date: string;
    spend: number;
    cpr: number;
    results: number;
  };
  baseline: BaselineForecast;
  forecasts: {
    no_change: WeeklyForecast[];
    scaling: {
      delta_20: WeeklyForecast[];
      delta_50: WeeklyForecast[];
      delta_100: WeeklyForecast[];
    };
  };
  elasticity: ElasticityK;
  eligibility: ForecastEligibility;
}

export interface ForecastMetrics {
  spend: number;
  results: number;
  cpr: number;
}

export interface CampaignForecastSummary {
  total_ads: number;
  eligible_ads: number;
  current_weekly_spend: number;
  current_weekly_results: number;
  avg_cpr: number;
  forecasts: {
    no_change: { week_1: ForecastMetrics; week_2: ForecastMetrics };
    scaling: Record<string, { week_1: ForecastMetrics; week_2: ForecastMetrics }>;
  };
}

export interface CampaignForecastResponse {
  campaign_id: string;
  campaign_name: string;
  ads: AdForecast[];
  summary: CampaignForecastSummary;
  computed_at: string;
}

interface SpendGrowthEvent {
  fb_ad_id: string;
  result_family: string;
  spend_ratio: number;
  cpr_ratio: number;
  x: number;  // ln(spend_ratio)
  y: number;  // ln(cpr_ratio)
}

interface WeeklyResultRow {
  fb_ad_id: string;
  week_start_date: string;
  result_family: string;
  spend: number;
  result_count: number;
  cpr: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ELIGIBILITY = {
  min_spend_per_week: 10,       // $10 минимум
  min_results_per_week: 3,      // 3 результата
  min_weeks_with_data: 2,       // 2 недели истории (минимум для прогноза)
  min_spend_events_ad: 3,       // для ad-level k
  min_spend_events_account: 10, // для account-level k
  min_spend_events_global: 30,  // для global k
};

const FALLBACK_K = 0.15;  // консервативная эластичность
const SPEND_GROWTH_THRESHOLD = 1.15;  // минимум 15% рост spend для события
const WEEKS_FOR_BASELINE = 4;  // недель для baseline (берет сколько есть, минимум 2)

// Целевые result_family для прогнозирования (исключаем click, video_view)
const TARGET_RESULT_FAMILIES = ['messages', 'leadgen_form', 'website_lead', 'purchase'];

// ============================================================================
// ACCOUNT CONTEXT HELPERS
// ============================================================================

/**
 * Применяет фильтр по аккаунту к query на основе контекста
 * Legacy: фильтрует по user_account_id + ad_account_id IS NULL
 * Multi-account: фильтрует по ad_account_id
 */
function applyAccountFilter<T extends { eq: (column: string, value: string) => T; is: (column: string, value: null) => T }>(
  query: T,
  ctx: AccountContext
): T {
  if (ctx.is_legacy) {
    // Для legacy: фильтруем по user_account_id И проверяем что ad_account_id IS NULL
    // Это исключает данные от multi-account режима того же пользователя
    return query.eq('user_account_id', ctx.user_account_id).is('ad_account_id', null);
  }
  return query.eq('ad_account_id', ctx.ad_account_id!);
}

/**
 * Возвращает ID аккаунта для использования в ключах кэша и логах
 */
function getAccountIdForContext(ctx: AccountContext): string {
  return ctx.is_legacy ? ctx.user_account_id : ctx.ad_account_id!;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function linearRegressionSlope(points: { x: number; y: number }[]): number {
  if (points.length < 2) return 0;

  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

// ============================================================================
// ELASTICITY COMPUTATION (k)
// ============================================================================

/**
 * Вычисляет события spend growth для объявления
 */
async function getSpendGrowthEvents(
  ctx: AccountContext,
  fbAdId?: string,
  resultFamily?: string
): Promise<SpendGrowthEvent[]> {
  // Получаем все недельные данные
  let query = supabase
    .from('meta_weekly_results')
    .select('fb_ad_id, week_start_date, result_family, spend, cpr')
    .gt('spend', 0)
    .gt('cpr', 0)
    .order('fb_ad_id')
    .order('result_family')
    .order('week_start_date');

  // Применяем фильтр по аккаунту
  query = applyAccountFilter(query, ctx);

  if (fbAdId) {
    query = query.eq('fb_ad_id', fbAdId);
  }
  if (resultFamily) {
    query = query.eq('result_family', resultFamily);
  }

  const { data, error } = await query;

  if (error || !data) {
    log.error({ error }, 'Failed to get spend data');
    return [];
  }

  // Группируем по ad_id + result_family и вычисляем события
  const events: SpendGrowthEvent[] = [];
  const grouped = new Map<string, typeof data>();

  for (const row of data) {
    const key = `${row.fb_ad_id}|${row.result_family}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(row);
  }

  for (const [, rows] of grouped) {
    // Сортируем по дате
    rows.sort((a, b) => a.week_start_date.localeCompare(b.week_start_date));

    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];

      if (prev.spend > 0 && prev.cpr > 0 && curr.spend > 0 && curr.cpr > 0) {
        const spendRatio = curr.spend / prev.spend;
        const cprRatio = curr.cpr / prev.cpr;

        // Только события роста spend >= 15%
        if (spendRatio >= SPEND_GROWTH_THRESHOLD) {
          events.push({
            fb_ad_id: curr.fb_ad_id,
            result_family: curr.result_family,
            spend_ratio: spendRatio,
            cpr_ratio: cprRatio,
            x: Math.log(spendRatio),
            y: Math.log(cprRatio)
          });
        }
      }
    }
  }

  return events;
}

/**
 * Вычисляет k из событий: k = sum(x*y) / sum(x^2)
 */
function calculateK(events: SpendGrowthEvent[]): number | null {
  if (events.length === 0) return null;

  const sumXY = events.reduce((s, e) => s + e.x * e.y, 0);
  const sumXX = events.reduce((s, e) => s + e.x * e.x, 0);

  if (sumXX === 0) return null;
  return sumXY / sumXX;
}

/**
 * Вычисляет коэффициент эластичности k на уровне объявления
 */
async function computeAdLevelK(
  ctx: AccountContext,
  fbAdId: string,
  resultFamily: string
): Promise<{ k: number | null; events: number }> {
  const events = await getSpendGrowthEvents(ctx, fbAdId, resultFamily);
  const k = calculateK(events);

  return {
    k,
    events: events.length
  };
}

/**
 * Вычисляет коэффициент эластичности k на уровне аккаунта + семейства
 */
async function computeAccountFamilyK(
  ctx: AccountContext,
  resultFamily: string
): Promise<{ k: number | null; events: number }> {
  // Получаем все события для аккаунта + семейства (без фильтра по ad)
  const events = await getSpendGrowthEvents(ctx, undefined, resultFamily);
  const k = calculateK(events);

  return {
    k,
    events: events.length
  };
}

/**
 * Вычисляет коэффициент эластичности k глобально для семейства
 * Используем кэш для глобальных k (обновляется раз в час)
 */
const globalKCache = new Map<string, { k: number | null; events: number; timestamp: number }>();
const GLOBAL_K_CACHE_TTL = 60 * 60 * 1000; // 1 час

async function computeGlobalFamilyK(
  resultFamily: string
): Promise<{ k: number | null; events: number }> {
  // Проверяем кэш
  const cached = globalKCache.get(resultFamily);
  if (cached && Date.now() - cached.timestamp < GLOBAL_K_CACHE_TTL) {
    return { k: cached.k, events: cached.events };
  }

  // Для глобального k делаем выборку по всем аккаунтам (лимит 10000 записей)
  const { data, error } = await supabase
    .from('meta_weekly_results')
    .select('ad_account_id, fb_ad_id, week_start_date, result_family, spend, cpr')
    .eq('result_family', resultFamily)
    .gt('spend', 0)
    .gt('cpr', 0)
    .order('ad_account_id')
    .order('fb_ad_id')
    .order('week_start_date')
    .limit(10000);

  if (error || !data) {
    log.error({ error }, 'Failed to get global spend data');
    return { k: null, events: 0 };
  }

  // Группируем по account+ad+family и вычисляем события
  const events: SpendGrowthEvent[] = [];
  const grouped = new Map<string, typeof data>();

  for (const row of data) {
    const key = `${row.ad_account_id}|${row.fb_ad_id}|${row.result_family}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(row);
  }

  for (const [, rows] of grouped) {
    rows.sort((a, b) => a.week_start_date.localeCompare(b.week_start_date));

    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];

      if (prev.spend > 0 && prev.cpr > 0 && curr.spend > 0 && curr.cpr > 0) {
        const spendRatio = curr.spend / prev.spend;
        const cprRatio = curr.cpr / prev.cpr;

        if (spendRatio >= SPEND_GROWTH_THRESHOLD) {
          events.push({
            fb_ad_id: curr.fb_ad_id,
            result_family: curr.result_family,
            spend_ratio: spendRatio,
            cpr_ratio: cprRatio,
            x: Math.log(spendRatio),
            y: Math.log(cprRatio)
          });
        }
      }
    }
  }

  const k = calculateK(events);

  // Сохраняем в кэш
  globalKCache.set(resultFamily, { k, events: events.length, timestamp: Date.now() });

  return { k, events: events.length };
}

/**
 * Вычисляет коэффициент эластичности k с pooling
 */
export async function computeElasticityK(
  ctx: AccountContext,
  fbAdId: string,
  resultFamily: string
): Promise<ElasticityK> {
  // 1. Ad-level k (минимум 3 события)
  const adLevel = await computeAdLevelK(ctx, fbAdId, resultFamily);

  // 2. Account + Family level (минимум 10 событий)
  const accountFamily = await computeAccountFamilyK(ctx, resultFamily);

  // 3. Global + Family level (минимум 30 событий)
  const globalFamily = await computeGlobalFamilyK(resultFamily);

  // Выбираем первый доступный уровень
  let effective = FALLBACK_K;
  let source: ElasticityK['source'] = 'fallback';
  let eventsUsed = 0;

  if (adLevel.k !== null && adLevel.events >= ELIGIBILITY.min_spend_events_ad) {
    effective = adLevel.k;
    source = 'ad';
    eventsUsed = adLevel.events;
  } else if (accountFamily.k !== null && accountFamily.events >= ELIGIBILITY.min_spend_events_account) {
    effective = accountFamily.k;
    source = 'account_family';
    eventsUsed = accountFamily.events;
  } else if (globalFamily.k !== null && globalFamily.events >= ELIGIBILITY.min_spend_events_global) {
    effective = globalFamily.k;
    source = 'global_family';
    eventsUsed = globalFamily.events;
  }

  return {
    ad_level: adLevel.k,
    account_family_level: accountFamily.k,
    global_family_level: globalFamily.k,
    fallback: FALLBACK_K,
    effective,
    source,
    events_used: eventsUsed
  };
}

// ============================================================================
// BASELINE FORECAST
// ============================================================================

/**
 * Вычисляет baseline прогноз на основе медианы последних недель
 */
export async function computeBaselineForecast(
  ctx: AccountContext,
  fbAdId: string,
  resultFamily: string
): Promise<BaselineForecast | null> {
  let query = supabase
    .from('meta_weekly_results')
    .select('week_start_date, spend, result_count, cpr')
    .eq('fb_ad_id', fbAdId)
    .eq('result_family', resultFamily)
    .gt('spend', 0)
    .gt('cpr', 0)
    .order('week_start_date', { ascending: false })
    .limit(WEEKS_FOR_BASELINE);

  query = applyAccountFilter(query, ctx);

  const { data, error } = await query;

  if (error || !data || data.length < ELIGIBILITY.min_weeks_with_data) {
    return null;
  }

  const cprs = data.map(d => d.cpr).filter(Boolean) as number[];
  const spends = data.map(d => d.spend).filter(Boolean) as number[];
  const results = data.map(d => d.result_count).filter(Boolean) as number[];

  // Вычисляем slope для CPR (тренд)
  const cprPoints = data.map((d, i) => ({ x: i, y: d.cpr || 0 }));
  const cprSlope = linearRegressionSlope(cprPoints);

  return {
    median_cpr: median(cprs),
    median_spend: median(spends),
    median_results: median(results),
    cpr_slope: cprSlope,
    weeks_analyzed: data.length
  };
}

// ============================================================================
// SCALING FORECAST
// ============================================================================

/**
 * Вычисляет прогноз при увеличении spend на delta%
 *
 * Важно: slope НЕ применяется к scaling прогнозам, потому что:
 * - slope отражает исторический тренд CPR БЕЗ изменения бюджета
 * - при scaling эластичность k уже учитывает влияние бюджета на CPR
 * - применение slope к scaling давало бы нереалистичные результаты
 */
function computeScalingForecast(
  currentCpr: number,
  currentSpend: number,
  delta: number,
  elasticityK: number,
  weekOffset: number
): WeeklyForecast {
  // Формула: cpr_pred = current_cpr * exp(k * ln(1 + delta))
  const spendPred = currentSpend * (1 + delta);
  const cprPred = currentCpr * Math.exp(elasticityK * Math.log(1 + delta));
  const resultsPred = cprPred > 0 ? spendPred / cprPred : 0;

  // Confidence зависит от источника k и weekOffset
  let confidence = 0.6;
  if (weekOffset === 1) confidence += 0.1;
  if (delta <= 0.2) confidence += 0.1;

  return {
    week_offset: weekOffset,
    spend_predicted: Math.round(spendPred * 100) / 100,
    cpr_predicted: Math.round(cprPred * 100) / 100,
    results_predicted: Math.round(resultsPred * 10) / 10,
    confidence: Math.min(confidence, 0.9)
  };
}

/**
 * Вычисляет baseline прогноз (без изменения spend)
 * Использует текущие метрики + тренд CPR, чтобы показать "что будет если ничего не менять"
 */
function computeNoChangeForecast(
  currentSpend: number,
  currentCpr: number,
  cprSlope: number,
  weekOffset: number
): WeeklyForecast {
  // CPR = текущий CPR + тренд (slope показывает изменение CPR за неделю)
  const cprPred = currentCpr + cprSlope * weekOffset;
  const spendPred = currentSpend;
  const resultsPred = cprPred > 0 ? spendPred / cprPred : 0;

  return {
    week_offset: weekOffset,
    spend_predicted: Math.round(spendPred * 100) / 100,
    cpr_predicted: Math.round(cprPred * 100) / 100,
    results_predicted: Math.round(resultsPred * 10) / 10,
    confidence: 0.75
  };
}

// ============================================================================
// ELIGIBILITY CHECK
// ============================================================================

/**
 * Проверяет eligibility объявления для прогнозирования
 */
async function checkEligibility(
  ctx: AccountContext,
  fbAdId: string,
  resultFamily: string
): Promise<ForecastEligibility> {
  let query = supabase
    .from('meta_weekly_results')
    .select('spend, result_count')
    .eq('fb_ad_id', fbAdId)
    .eq('result_family', resultFamily)
    .gt('spend', 0)
    .order('week_start_date', { ascending: false })
    .limit(WEEKS_FOR_BASELINE);

  query = applyAccountFilter(query, ctx);

  const { data, error } = await query;

  if (error || !data) {
    return {
      is_eligible: false,
      reason: 'Нет данных',
      min_spend_met: false,
      min_results_met: false,
      weeks_with_data: 0
    };
  }

  const weeksWithData = data.length;
  const avgSpend = data.reduce((s, w) => s + (w.spend || 0), 0) / Math.max(weeksWithData, 1);
  const avgResults = data.reduce((s, w) => s + (w.result_count || 0), 0) / Math.max(weeksWithData, 1);

  const minSpendMet = avgSpend >= ELIGIBILITY.min_spend_per_week;
  const minResultsMet = avgResults >= ELIGIBILITY.min_results_per_week;

  if (weeksWithData < ELIGIBILITY.min_weeks_with_data) {
    return {
      is_eligible: false,
      reason: `Недостаточно данных (${weeksWithData}/${ELIGIBILITY.min_weeks_with_data} недель)`,
      min_spend_met: minSpendMet,
      min_results_met: minResultsMet,
      weeks_with_data: weeksWithData
    };
  }

  if (!minSpendMet) {
    return {
      is_eligible: false,
      reason: `Низкий spend (${avgSpend.toFixed(2)} < ${ELIGIBILITY.min_spend_per_week})`,
      min_spend_met: false,
      min_results_met: minResultsMet,
      weeks_with_data: weeksWithData
    };
  }

  if (!minResultsMet) {
    return {
      is_eligible: false,
      reason: `Мало результатов (${avgResults.toFixed(1)} < ${ELIGIBILITY.min_results_per_week})`,
      min_spend_met: minSpendMet,
      min_results_met: false,
      weeks_with_data: weeksWithData
    };
  }

  return {
    is_eligible: true,
    min_spend_met: true,
    min_results_met: true,
    weeks_with_data: weeksWithData
  };
}

// ============================================================================
// MAIN FORECAST FUNCTIONS
// ============================================================================

/**
 * Получает текущую неделю данных для объявления
 */
async function getCurrentWeekData(
  ctx: AccountContext,
  fbAdId: string,
  resultFamily: string
): Promise<WeeklyResultRow | null> {
  let query = supabase
    .from('meta_weekly_results')
    .select('fb_ad_id, week_start_date, result_family, spend, result_count, cpr')
    .eq('fb_ad_id', fbAdId)
    .eq('result_family', resultFamily)
    .gt('spend', 0)
    .order('week_start_date', { ascending: false })
    .limit(1);

  query = applyAccountFilter(query, ctx);

  const { data, error } = await query.single();

  if (error || !data) return null;
  return data;
}

/**
 * Прогноз для одного объявления
 */
export async function forecastAd(
  ctx: AccountContext,
  fbAdId: string,
  adName: string,
  resultFamily: string
): Promise<AdForecast | null> {
  // Проверяем eligibility
  const eligibility = await checkEligibility(ctx, fbAdId, resultFamily);

  // Получаем текущие данные
  const currentWeek = await getCurrentWeekData(ctx, fbAdId, resultFamily);
  if (!currentWeek) {
    return null;
  }

  // Получаем baseline
  const baseline = await computeBaselineForecast(ctx, fbAdId, resultFamily);
  if (!baseline) {
    return null;
  }

  // Получаем эластичность
  const elasticity = await computeElasticityK(ctx, fbAdId, resultFamily);

  // Вычисляем прогнозы
  const currentCpr = currentWeek.cpr || baseline.median_cpr;
  const currentSpend = currentWeek.spend || baseline.median_spend;

  const forecasts = {
    no_change: [
      computeNoChangeForecast(currentSpend, currentCpr, baseline.cpr_slope, 1),
      computeNoChangeForecast(currentSpend, currentCpr, baseline.cpr_slope, 2)
    ],
    scaling: {
      delta_20: [
        computeScalingForecast(currentCpr, currentSpend, 0.20, elasticity.effective, 1),
        computeScalingForecast(currentCpr, currentSpend, 0.20, elasticity.effective, 2)
      ],
      delta_50: [
        computeScalingForecast(currentCpr, currentSpend, 0.50, elasticity.effective, 1),
        computeScalingForecast(currentCpr, currentSpend, 0.50, elasticity.effective, 2)
      ],
      delta_100: [
        computeScalingForecast(currentCpr, currentSpend, 1.00, elasticity.effective, 1),
        computeScalingForecast(currentCpr, currentSpend, 1.00, elasticity.effective, 2)
      ]
    }
  };

  return {
    fb_ad_id: fbAdId,
    ad_name: adName,
    result_family: resultFamily,
    current_week: {
      week_start_date: currentWeek.week_start_date,
      spend: currentWeek.spend,
      cpr: currentWeek.cpr,
      results: currentWeek.result_count
    },
    baseline,
    forecasts,
    elasticity,
    eligibility
  };
}

/**
 * Прогноз для всех объявлений кампании
 */
export async function forecastCampaignBudget(
  ctx: AccountContext,
  fbCampaignId: string
): Promise<CampaignForecastResponse | null> {
  const accountId = getAccountIdForContext(ctx);
  log.info({ accountId, fbCampaignId, isLegacy: ctx.is_legacy }, 'Starting campaign budget forecast');

  // Получаем название кампании
  let campaignQuery = supabase
    .from('meta_campaigns')
    .select('name')
    .eq('fb_campaign_id', fbCampaignId);

  campaignQuery = applyAccountFilter(campaignQuery, ctx);

  const { data: campaignData } = await campaignQuery.single();
  const campaignName = campaignData?.name || fbCampaignId;

  // Получаем все adsets кампании
  let adsetsQuery = supabase
    .from('meta_adsets')
    .select('fb_adset_id, ad_account_id, user_account_id')
    .eq('fb_campaign_id', fbCampaignId);

  adsetsQuery = applyAccountFilter(adsetsQuery, ctx);

  let { data: adsetsData } = await adsetsQuery;

  // Контекст для последующих запросов (может измениться при fallback)
  let effectiveCtx = ctx;

  // Если не нашли и это multi-account - пробуем найти кампанию в любом аккаунте пользователя
  // (fallback для случая когда кампания была синхронизирована под другим ad_account_id)
  if (!ctx.is_legacy && (!adsetsData || adsetsData.length === 0)) {
    const { data: campaignAdsets } = await supabase
      .from('meta_adsets')
      .select('fb_adset_id, ad_account_id, user_account_id')
      .eq('fb_campaign_id', fbCampaignId)
      .eq('user_account_id', ctx.user_account_id)
      .limit(10);

    if (campaignAdsets && campaignAdsets.length > 0) {
      adsetsData = campaignAdsets;

      // Определяем контекст на основе найденных данных
      const foundAdAccountId = campaignAdsets[0].ad_account_id;
      if (foundAdAccountId) {
        // Данные с ad_account_id - используем multi-account контекст
        effectiveCtx = {
          user_account_id: ctx.user_account_id,
          ad_account_id: foundAdAccountId,
          is_legacy: false
        };
      } else {
        // Данные без ad_account_id - это legacy данные
        effectiveCtx = {
          user_account_id: ctx.user_account_id,
          ad_account_id: null,
          is_legacy: true
        };
      }

      log.info({
        originalAccountId: accountId,
        effectiveAccountId: getAccountIdForContext(effectiveCtx),
        isLegacyFallback: effectiveCtx.is_legacy,
        fbCampaignId,
      }, 'Campaign found via user_account_id fallback');
    }
  }

  if (!adsetsData || adsetsData.length === 0) {
    log.warn({ accountId, fbCampaignId }, 'No adsets found for campaign');
    return null;
  }

  const adsetIds = adsetsData.map(a => a.fb_adset_id);

  // Получаем все объявления этих adsets (используем effectiveCtx!)
  let adsQuery = supabase
    .from('meta_ads')
    .select('fb_ad_id, name')
    .in('fb_adset_id', adsetIds);

  adsQuery = applyAccountFilter(adsQuery, effectiveCtx);

  const { data: adsData, error: adsError } = await adsQuery;

  if (adsError || !adsData || adsData.length === 0) {
    log.warn({ accountId, fbCampaignId, adsetIds }, 'No ads found for campaign adsets');
    return null;
  }

  // Для каждого объявления получаем primary_family из последних данных
  const adForecasts: AdForecast[] = [];

  for (const ad of adsData) {
    // Получаем primary_family для этого объявления (только целевые: messages, leads, purchase)
    let resultQuery = supabase
      .from('meta_weekly_results')
      .select('result_family, result_count')
      .eq('fb_ad_id', ad.fb_ad_id)
      .in('result_family', TARGET_RESULT_FAMILIES)
      .gt('result_count', 0)
      .order('week_start_date', { ascending: false })
      .limit(1);

    resultQuery = applyAccountFilter(resultQuery, effectiveCtx);

    const { data: resultData, error: resultError } = await resultQuery.maybeSingle();

    // Если не нашли целевой result_family — логируем и пропускаем объявление
    if (!resultData) {
      log.debug({
        fbAdId: ad.fb_ad_id,
        effectiveCtxIsLegacy: effectiveCtx.is_legacy,
        error: resultError?.message
      }, 'No target result_family found for ad, skipping');
      continue;
    }

    const resultFamily = resultData.result_family;

    try {
      const forecast = await forecastAd(effectiveCtx, ad.fb_ad_id, ad.name || ad.fb_ad_id, resultFamily);
      if (forecast) {
        adForecasts.push(forecast);
      }
    } catch (err) {
      log.warn({ err, fbAdId: ad.fb_ad_id }, 'Failed to forecast ad');
    }
  }

  if (adForecasts.length === 0) {
    return null;
  }

  // Вычисляем summary
  // current spend/results считаем по ВСЕМ объявлениям кампании
  const eligibleAds = adForecasts.filter(a => a.eligibility.is_eligible);
  const currentSpend = adForecasts.reduce((s, a) => s + a.current_week.spend, 0);
  const currentResults = adForecasts.reduce((s, a) => s + a.current_week.results, 0);
  const avgCpr = currentResults > 0 ? currentSpend / currentResults : 0;

  // Агрегируем прогнозы
  const aggregateForecasts = (ads: AdForecast[], delta: 'no_change' | 'delta_20' | 'delta_50' | 'delta_100') => {
    const week1 = { spend: 0, results: 0, cpr: 0 };
    const week2 = { spend: 0, results: 0, cpr: 0 };

    for (const ad of ads) {
      const forecasts = delta === 'no_change'
        ? ad.forecasts.no_change
        : ad.forecasts.scaling[delta];

      if (forecasts[0]) {
        week1.spend += forecasts[0].spend_predicted;
        week1.results += forecasts[0].results_predicted;
      }
      if (forecasts[1]) {
        week2.spend += forecasts[1].spend_predicted;
        week2.results += forecasts[1].results_predicted;
      }
    }

    week1.cpr = week1.results > 0 ? week1.spend / week1.results : 0;
    week2.cpr = week2.results > 0 ? week2.spend / week2.results : 0;

    return { week_1: week1, week_2: week2 };
  };

  const summary: CampaignForecastSummary = {
    total_ads: adForecasts.length,
    eligible_ads: eligibleAds.length,
    current_weekly_spend: Math.round(currentSpend * 100) / 100,
    current_weekly_results: Math.round(currentResults * 10) / 10,
    avg_cpr: Math.round(avgCpr * 100) / 100,
    forecasts: {
      no_change: aggregateForecasts(eligibleAds, 'no_change'),
      scaling: {
        delta_20: aggregateForecasts(eligibleAds, 'delta_20'),
        delta_50: aggregateForecasts(eligibleAds, 'delta_50'),
        delta_100: aggregateForecasts(eligibleAds, 'delta_100')
      }
    }
  };

  log.info({
    accountId,
    fbCampaignId,
    isLegacy: ctx.is_legacy,
    totalAds: adForecasts.length,
    eligibleAds: eligibleAds.length
  }, 'Campaign budget forecast completed');

  return {
    campaign_id: fbCampaignId,
    campaign_name: campaignName,
    ads: adForecasts,
    summary,
    computed_at: new Date().toISOString()
  };
}
