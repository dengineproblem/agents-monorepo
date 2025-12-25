/**
 * ANOMALY DETECTOR SERVICE
 *
 * Детекция аномалий CPR (Cost Per Result) с анализом предшествующих отклонений.
 *
 * Фокус только на CPR spike (рост стоимости результата):
 * - Для каждой аномалии анализируем предшествующие отклонения за 1-2 недели до
 * - Отслеживаемые метрики-предшественники:
 *   - Performance: frequency, CTR, link_ctr, CPM, spend
 *   - Creative quality (Ad Relevance Diagnostics): quality_ranking, engagement_ranking, conversion_ranking
 * - Пороги значимости: 15% для performance, 20% для rankings, 30% для spend
 *
 * Вычисление features и baselines для анализа зависимостей.
 */

import { supabase } from '../lib/supabaseClient.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'anomalyDetector' });

// Конфигурация по умолчанию
const DEFAULT_CONFIG = {
  cpr_spike_threshold: 1.20,    // 20% рост = аномалия
  ctr_drop_threshold: 0.80,     // 20% падение
  freq_high_threshold: 1.50,    // 50% выше baseline
  min_results_messages: 5,
  min_results_leads: 5,
  min_results_purchases: 3,
  min_results_clicks: 50,
  baseline_weeks: 8,
  cpr_weight: 0.40,
  freq_weight: 0.25,
  ctr_weight: 0.20,
  cpc_weight: 0.15,
};

interface AnomalyConfig {
  cpr_spike_threshold: number;
  ctr_drop_threshold: number;
  freq_high_threshold: number;
  min_results_messages: number;
  min_results_leads: number;
  min_results_purchases: number;
  min_results_clicks: number;
  baseline_weeks: number;
  cpr_weight: number;
  freq_weight: number;
  ctr_weight: number;
  cpc_weight: number;
}

interface WeeklyData {
  week_start_date: string;
  spend: number;
  frequency: number;
  ctr: number;
  cpc: number;
  cpm: number;
  reach: number;
  link_ctr: number;
  result_count: number;
  cpr: number | null;
  quality_rank_score: number | null;
  engagement_rank_score: number | null;
  conversion_rank_score: number | null;
}

interface FeatureSet {
  spend: number;
  frequency: number;
  ctr: number;
  cpc: number;
  cpm: number;
  reach: number;
  link_ctr: number;
  result_count: number;
  cpr: number | null;
  baseline_cpr: number | null;
  baseline_frequency: number | null;
  baseline_ctr: number | null;
  baseline_cpc: number | null;
  baseline_cpm: number | null;
  baseline_spend: number | null;
  baseline_link_ctr: number | null;
  cpr_delta_pct: number | null;
  freq_delta_pct: number | null;
  ctr_delta_pct: number | null;
  cpc_delta_pct: number | null;
  cpm_delta_pct: number | null;
  spend_delta_pct: number | null;
  link_ctr_delta_pct: number | null;
  cpr_lag1: number | null;
  cpr_lag2: number | null;
  freq_lag1: number | null;
  freq_lag2: number | null;
  ctr_lag1: number | null;
  ctr_lag2: number | null;
  cpm_lag1: number | null;
  cpm_lag2: number | null;
  spend_lag1: number | null;
  spend_lag2: number | null;
  link_ctr_lag1: number | null;
  link_ctr_lag2: number | null;
  results_lag1: number | null;
  results_lag2: number | null;
  baseline_results: number | null;
  results_delta_pct: number | null;
  freq_slope: number | null;
  ctr_slope: number | null;
  reach_growth_rate: number | null;
  spend_change_pct: number | null;
  weeks_with_data: number;
  min_results_met: boolean;
  // Ranking scores (Iteration 2)
  quality_score: number | null;
  engagement_score: number | null;
  conversion_score: number | null;
  relevance_health: number | null;
  quality_drop: number | null;
  engagement_drop: number | null;
  conversion_drop: number | null;
  relevance_drop: number | null;
  // Ranking baselines
  baseline_quality: number | null;
  baseline_engagement: number | null;
  baseline_conversion: number | null;
  // Ranking lags (Iteration 3 - Preceding Deviations)
  quality_rank_lag1: number | null;
  quality_rank_lag2: number | null;
  engagement_rank_lag1: number | null;
  engagement_rank_lag2: number | null;
  conversion_rank_lag1: number | null;
  conversion_rank_lag2: number | null;
}

interface Anomaly {
  anomaly_type: string;
  current_value: number;
  baseline_value: number;
  delta_pct: number;
  anomaly_score: number;
  confidence: number;
  likely_triggers: { metric: string; value: number; delta: string }[];
  preceding_deviations?: PrecedingDeviations;
  // Pause detection (Iteration 4)
  pause_days_count?: number;
  has_delivery_gap?: boolean;
}

interface PauseAnalysis {
  pause_days_count: number;
  has_delivery_gap: boolean;
  active_days: number;
  min_daily_impressions: number;
  max_daily_impressions: number;
  daily_impressions_cv: number | null;  // Coefficient of variation
}

// Типы для предшествующих отклонений
type DeviationDirection = 'bad' | 'good' | 'neutral';
type MetricName = 'frequency' | 'ctr' | 'link_ctr' | 'cpm' | 'cpr' | 'spend' | 'results' | 'quality_ranking' | 'engagement_ranking' | 'conversion_ranking';

interface MetricDeviation {
  metric: MetricName;
  value: number;
  baseline: number;
  delta_pct: number;
  is_significant: boolean;
  direction: DeviationDirection;
}

interface WeekDeviations {
  week_start: string;
  week_end: string;
  deviations: MetricDeviation[];
  // Raw ranking values (без порогов, просто для отображения)
  quality_ranking: number | null;
  engagement_ranking: number | null;
  conversion_ranking: number | null;
}

interface PrecedingDeviations {
  week_0: WeekDeviations | null;      // Неделя аномалии (текущая)
  week_minus_1: WeekDeviations | null;
  week_minus_2: WeekDeviations | null;
}

// Конфигурация порогов значимости
const DEVIATION_THRESHOLDS: Record<MetricName, number> = {
  frequency: 0.15,           // 15% отклонение = значимое
  ctr: 0.15,
  link_ctr: 0.15,
  cpm: 0.15,
  cpr: 0.20,                 // 20% рост CPR = значимый (основная метрика аномалии)
  spend: 0.30,               // 30% для spend
  results: 0.20,             // 20% падение результатов = значимое
  quality_ranking: 0.20,     // 20% падение ranking = значимо (score 5 → 4)
  engagement_ranking: 0.20,
  conversion_ranking: 0.20,
};

// Логика определения "плохого" направления для метрики
const BAD_DIRECTION: Record<MetricName, 'increase' | 'decrease'> = {
  frequency: 'increase',       // Рост частоты = плохо
  ctr: 'decrease',             // Падение CTR = плохо
  link_ctr: 'decrease',        // Падение Link CTR = плохо
  cpm: 'increase',             // Рост CPM = плохо
  cpr: 'increase',             // Рост CPR = плохо (дороже за результат)
  spend: 'increase',           // Рост spend = информационно
  results: 'decrease',         // Падение результатов = плохо
  quality_ranking: 'decrease', // Падение качества = плохо
  engagement_ranking: 'decrease',
  conversion_ranking: 'decrease',
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Вычисляет медиану массива
 */
function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Вычисляет slope (наклон тренда) методом линейной регрессии
 */
function calculateSlope(values: number[]): number | null {
  if (values.length < 2) return null;

  const n = values.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return null;

  return (n * sumXY - sumX * sumY) / denominator;
}

/**
 * Получает минимальное количество результатов для семейства
 */
function getMinResults(family: string, config: AnomalyConfig): number {
  switch (family) {
    case 'messages':
      return config.min_results_messages;
    case 'leadgen_form':
    case 'website_lead':
      return config.min_results_leads;
    case 'purchase':
      return config.min_results_purchases;
    case 'click':
      return config.min_results_clicks;
    default:
      return 10;
  }
}

/**
 * Загружает конфигурацию из БД
 */
async function loadConfig(): Promise<AnomalyConfig> {
  const { data } = await supabase
    .from('anomaly_detection_config')
    .select('*')
    .limit(1)
    .single();

  return data || DEFAULT_CONFIG;
}

// ============================================================================
// FEATURE COMPUTATION
// ============================================================================

interface ComputeFeaturesResult {
  features: FeatureSet;
  weeklyData: WeeklyData[];
}

/**
 * Вычисляет features для одного ad на одну неделю
 */
async function computeFeatures(
  adAccountId: string,
  fbAdId: string,
  weekStartDate: string,
  primaryFamily: string,
  config: AnomalyConfig
): Promise<ComputeFeaturesResult | null> {
  // Получаем данные за последние 12 недель (текущая + 11 предыдущих)
  const { data: insights, error } = await supabase
    .from('meta_insights_weekly')
    .select('week_start_date, spend, frequency, ctr, cpc, cpm, reach, link_ctr, quality_rank_score, engagement_rank_score, conversion_rank_score')
    .eq('ad_account_id', adAccountId)
    .eq('fb_ad_id', fbAdId)
    .lte('week_start_date', weekStartDate)
    .order('week_start_date', { ascending: false })
    .limit(12);

  if (error || !insights || insights.length === 0) {
    return null;
  }

  // Получаем результаты по primary_family
  const { data: results } = await supabase
    .from('meta_weekly_results')
    .select('week_start_date, result_count, cpr')
    .eq('ad_account_id', adAccountId)
    .eq('fb_ad_id', fbAdId)
    .eq('result_family', primaryFamily)
    .lte('week_start_date', weekStartDate)
    .order('week_start_date', { ascending: false })
    .limit(12);

  // Объединяем данные
  const weeklyData: WeeklyData[] = insights.map(i => {
    const result = results?.find(r => r.week_start_date === i.week_start_date);
    return {
      week_start_date: i.week_start_date,
      spend: parseFloat(i.spend as any) || 0,
      frequency: parseFloat(i.frequency as any) || 0,
      ctr: parseFloat(i.ctr as any) || 0,
      cpc: parseFloat(i.cpc as any) || 0,
      cpm: parseFloat(i.cpm as any) || 0,
      reach: parseInt(i.reach as any) || 0,
      link_ctr: parseFloat((i as any).link_ctr as any) || 0,
      result_count: result?.result_count || 0,
      cpr: result?.cpr ? parseFloat(result.cpr as any) : null,
      quality_rank_score: (i as any).quality_rank_score ?? null,
      engagement_rank_score: (i as any).engagement_rank_score ?? null,
      conversion_rank_score: (i as any).conversion_rank_score ?? null,
    };
  });

  const current = weeklyData[0];
  if (!current || current.week_start_date !== weekStartDate) {
    return null;
  }

  // Baseline (недели 1-8, т.е. индексы 1-8)
  const baselineWeeks = weeklyData.slice(1, config.baseline_weeks + 1);

  // Вычисляем baselines (медианы)
  const baselineCprs = baselineWeeks.map(w => w.cpr).filter((v): v is number => v !== null && v > 0);
  const baselineFreqs = baselineWeeks.map(w => w.frequency).filter(v => v > 0);
  const baselineCtrs = baselineWeeks.map(w => w.ctr).filter(v => v > 0);
  const baselineCpcs = baselineWeeks.map(w => w.cpc).filter(v => v > 0);
  const baselineCpms = baselineWeeks.map(w => w.cpm).filter(v => v > 0);
  const baselineSpends = baselineWeeks.map(w => w.spend).filter(v => v > 0);
  const baselineLinkCtrs = baselineWeeks.map(w => w.link_ctr).filter(v => v > 0);
  const baselineResults = baselineWeeks.map(w => w.result_count).filter(v => v > 0);

  const baseline_cpr = median(baselineCprs);
  const baseline_frequency = median(baselineFreqs);
  const baseline_ctr = median(baselineCtrs);
  const baseline_cpc = median(baselineCpcs);
  const baseline_cpm = median(baselineCpms);
  const baseline_spend = median(baselineSpends);
  const baseline_link_ctr = median(baselineLinkCtrs);
  const baseline_results = median(baselineResults);

  // Дельты
  const cpr_delta_pct = baseline_cpr && current.cpr
    ? ((current.cpr - baseline_cpr) / baseline_cpr) * 100
    : null;
  const freq_delta_pct = baseline_frequency && current.frequency
    ? ((current.frequency - baseline_frequency) / baseline_frequency) * 100
    : null;
  const ctr_delta_pct = baseline_ctr && current.ctr
    ? ((current.ctr - baseline_ctr) / baseline_ctr) * 100
    : null;
  const cpc_delta_pct = baseline_cpc && current.cpc
    ? ((current.cpc - baseline_cpc) / baseline_cpc) * 100
    : null;
  const cpm_delta_pct = baseline_cpm && current.cpm
    ? ((current.cpm - baseline_cpm) / baseline_cpm) * 100
    : null;
  const spend_delta_pct = baseline_spend && current.spend
    ? ((current.spend - baseline_spend) / baseline_spend) * 100
    : null;
  const link_ctr_delta_pct = baseline_link_ctr && current.link_ctr
    ? ((current.link_ctr - baseline_link_ctr) / baseline_link_ctr) * 100
    : null;
  const results_delta_pct = baseline_results && current.result_count
    ? ((current.result_count - baseline_results) / baseline_results) * 100
    : null;

  // Лаги
  const cpr_lag1 = weeklyData[1]?.cpr || null;
  const cpr_lag2 = weeklyData[2]?.cpr || null;
  const freq_lag1 = weeklyData[1]?.frequency || null;
  const freq_lag2 = weeklyData[2]?.frequency || null;
  const ctr_lag1 = weeklyData[1]?.ctr || null;
  const ctr_lag2 = weeklyData[2]?.ctr || null;
  const cpm_lag1 = weeklyData[1]?.cpm || null;
  const cpm_lag2 = weeklyData[2]?.cpm || null;
  const spend_lag1 = weeklyData[1]?.spend || null;
  const spend_lag2 = weeklyData[2]?.spend || null;
  const link_ctr_lag1 = weeklyData[1]?.link_ctr || null;
  const link_ctr_lag2 = weeklyData[2]?.link_ctr || null;
  const results_lag1 = weeklyData[1]?.result_count || null;
  const results_lag2 = weeklyData[2]?.result_count || null;

  // Ranking лаги (Iteration 3 - Preceding Deviations)
  const quality_rank_lag1 = weeklyData[1]?.quality_rank_score ?? null;
  const quality_rank_lag2 = weeklyData[2]?.quality_rank_score ?? null;
  const engagement_rank_lag1 = weeklyData[1]?.engagement_rank_score ?? null;
  const engagement_rank_lag2 = weeklyData[2]?.engagement_rank_score ?? null;
  const conversion_rank_lag1 = weeklyData[1]?.conversion_rank_score ?? null;
  const conversion_rank_lag2 = weeklyData[2]?.conversion_rank_score ?? null;

  // Slopes (тренды за последние 4 недели)
  const last4Weeks = weeklyData.slice(0, 4);
  const freq_slope = calculateSlope(last4Weeks.map(w => w.frequency).reverse());
  const ctr_slope = calculateSlope(last4Weeks.map(w => w.ctr).reverse());

  // Reach growth rate
  const reach_growth_rate = weeklyData[1]?.reach && weeklyData[1].reach > 0
    ? ((current.reach - weeklyData[1].reach) / weeklyData[1].reach) * 100
    : null;

  // Spend change
  const spend_change_pct = weeklyData[1]?.spend && weeklyData[1].spend > 0
    ? ((current.spend - weeklyData[1].spend) / weeklyData[1].spend) * 100
    : null;

  // Качество данных
  const weeks_with_data = weeklyData.filter(w => w.spend > 0).length;
  const minResults = getMinResults(primaryFamily, config);
  const min_results_met = current.result_count >= minResults;

  // Ranking scores (Iteration 2)
  const quality_score = current.quality_rank_score;
  const engagement_score = current.engagement_rank_score;
  const conversion_score = current.conversion_rank_score;

  // Relevance health (сумма трёх scores, null если все null)
  const relevance_health = (quality_score !== null || engagement_score !== null || conversion_score !== null)
    ? (quality_score ?? 0) + (engagement_score ?? 0) + (conversion_score ?? 0)
    : null;

  // Baseline rankings (медианы за baseline period)
  const baselineQuality = baselineWeeks
    .map(w => w.quality_rank_score)
    .filter((v): v is number => v !== null);
  const baselineEngagement = baselineWeeks
    .map(w => w.engagement_rank_score)
    .filter((v): v is number => v !== null);
  const baselineConversion = baselineWeeks
    .map(w => w.conversion_rank_score)
    .filter((v): v is number => v !== null);

  const baseline_quality = baselineQuality.length > 0 ? median(baselineQuality) : null;
  const baseline_engagement = baselineEngagement.length > 0 ? median(baselineEngagement) : null;
  const baseline_conversion = baselineConversion.length > 0 ? median(baselineConversion) : null;
  const baseline_relevance = (baseline_quality !== null || baseline_engagement !== null || baseline_conversion !== null)
    ? (baseline_quality ?? 0) + (baseline_engagement ?? 0) + (baseline_conversion ?? 0)
    : null;

  // Drops (delta vs baseline, отрицательное = падение)
  const quality_drop = quality_score !== null && baseline_quality !== null
    ? quality_score - baseline_quality
    : null;
  const engagement_drop = engagement_score !== null && baseline_engagement !== null
    ? engagement_score - baseline_engagement
    : null;
  const conversion_drop = conversion_score !== null && baseline_conversion !== null
    ? conversion_score - baseline_conversion
    : null;
  const relevance_drop = relevance_health !== null && baseline_relevance !== null
    ? relevance_health - baseline_relevance
    : null;

  const features: FeatureSet = {
    spend: current.spend,
    frequency: current.frequency,
    ctr: current.ctr,
    cpc: current.cpc,
    cpm: current.cpm,
    reach: current.reach,
    link_ctr: current.link_ctr,
    result_count: current.result_count,
    cpr: current.cpr,
    // Baselines
    baseline_cpr,
    baseline_frequency,
    baseline_ctr,
    baseline_cpc,
    baseline_cpm,
    baseline_spend,
    baseline_link_ctr,
    baseline_results,
    // Дельты
    cpr_delta_pct,
    freq_delta_pct,
    ctr_delta_pct,
    cpc_delta_pct,
    cpm_delta_pct,
    spend_delta_pct,
    link_ctr_delta_pct,
    results_delta_pct,
    // Лаги
    cpr_lag1,
    cpr_lag2,
    freq_lag1,
    freq_lag2,
    ctr_lag1,
    ctr_lag2,
    cpm_lag1,
    cpm_lag2,
    spend_lag1,
    spend_lag2,
    link_ctr_lag1,
    link_ctr_lag2,
    results_lag1,
    results_lag2,
    // Тренды
    freq_slope,
    ctr_slope,
    reach_growth_rate,
    spend_change_pct,
    weeks_with_data,
    min_results_met,
    // Ranking scores (Iteration 2)
    quality_score,
    engagement_score,
    conversion_score,
    relevance_health,
    quality_drop,
    engagement_drop,
    conversion_drop,
    relevance_drop,
    // Ranking baselines (Iteration 3)
    baseline_quality,
    baseline_engagement,
    baseline_conversion,
    // Ranking лаги (Iteration 3 - Preceding Deviations)
    quality_rank_lag1,
    quality_rank_lag2,
    engagement_rank_lag1,
    engagement_rank_lag2,
    conversion_rank_lag1,
    conversion_rank_lag2,
  };

  return { features, weeklyData };
}

/**
 * Вычисляет features из предзагруженного кэша (БЕЗ запросов к БД!)
 */
function computeFeaturesFromCache(
  insightsCache: InsightsCache,
  resultsCache: ResultsCache,
  fbAdId: string,
  weekStartDate: string,
  primaryFamily: string,
  config: AnomalyConfig
): ComputeFeaturesResult | null {
  // Получаем данные из кэша
  const allInsights = insightsCache.get(fbAdId) || [];
  const allResults = resultsCache.get(fbAdId) || [];

  // Фильтруем по дате (до weekStartDate включительно, отсортировано desc)
  const insights = allInsights
    .filter(i => i.week_start_date <= weekStartDate)
    .slice(0, 12); // последние 12 недель

  if (insights.length === 0) {
    return null;
  }

  // Фильтруем results по primary_family
  const familyResults = allResults.filter(r => r.result_family === primaryFamily);
  const results = familyResults
    .filter(r => r.week_start_date <= weekStartDate)
    .slice(0, 12);

  // Объединяем данные
  const weeklyData: WeeklyData[] = insights.map(i => {
    const result = results.find(r => r.week_start_date === i.week_start_date);
    return {
      week_start_date: i.week_start_date,
      spend: i.spend,
      frequency: i.frequency,
      ctr: i.ctr,
      cpc: i.cpc,
      cpm: i.cpm,
      reach: i.reach,
      link_ctr: i.link_ctr || 0,
      result_count: result?.result_count || 0,
      cpr: result?.cpr || null,
      quality_rank_score: i.quality_rank_score,
      engagement_rank_score: i.engagement_rank_score,
      conversion_rank_score: i.conversion_rank_score,
    };
  });

  const current = weeklyData[0];
  if (!current || current.week_start_date !== weekStartDate) {
    return null;
  }

  // Baseline (недели 1-8)
  const baselineWeeks = weeklyData.slice(1, config.baseline_weeks + 1);

  // DEBUG: логируем для первых 3 ads
  if (Math.random() < 0.002) {
    log.info({
      fbAdId,
      weekStartDate,
      weeklyDataLength: weeklyData.length,
      baselineWeeksLength: baselineWeeks.length,
      sample: baselineWeeks.slice(0, 2).map(w => ({ week: w.week_start_date, cpm: w.cpm, spend: w.spend })),
    }, 'DEBUG: computeFeaturesFromCache baseline data');
  }

  // Baselines (медианы)
  const baselineCprs = baselineWeeks.map(w => w.cpr).filter((v): v is number => v !== null && v > 0);
  const baselineFreqs = baselineWeeks.map(w => w.frequency).filter(v => v > 0);
  const baselineCtrs = baselineWeeks.map(w => w.ctr).filter(v => v > 0);
  const baselineCpcs = baselineWeeks.map(w => w.cpc).filter(v => v > 0);
  const baselineCpms = baselineWeeks.map(w => w.cpm).filter(v => v > 0);
  const baselineSpends = baselineWeeks.map(w => w.spend).filter(v => v > 0);
  const baselineLinkCtrs = baselineWeeks.map(w => w.link_ctr).filter(v => v > 0);
  const baselineResults = baselineWeeks.map(w => w.result_count).filter(v => v > 0);

  const baseline_cpr = median(baselineCprs);
  const baseline_frequency = median(baselineFreqs);
  const baseline_ctr = median(baselineCtrs);
  const baseline_cpc = median(baselineCpcs);
  const baseline_cpm = median(baselineCpms);
  const baseline_spend = median(baselineSpends);
  const baseline_link_ctr = median(baselineLinkCtrs);
  const baseline_results = median(baselineResults);

  // Дельты
  const cpr_delta_pct = baseline_cpr && current.cpr
    ? ((current.cpr - baseline_cpr) / baseline_cpr) * 100
    : null;
  const freq_delta_pct = baseline_frequency && current.frequency
    ? ((current.frequency - baseline_frequency) / baseline_frequency) * 100
    : null;
  const ctr_delta_pct = baseline_ctr && current.ctr
    ? ((current.ctr - baseline_ctr) / baseline_ctr) * 100
    : null;
  const cpc_delta_pct = baseline_cpc && current.cpc
    ? ((current.cpc - baseline_cpc) / baseline_cpc) * 100
    : null;
  const cpm_delta_pct = baseline_cpm && current.cpm
    ? ((current.cpm - baseline_cpm) / baseline_cpm) * 100
    : null;
  const spend_delta_pct = baseline_spend && current.spend
    ? ((current.spend - baseline_spend) / baseline_spend) * 100
    : null;
  const link_ctr_delta_pct = baseline_link_ctr && current.link_ctr
    ? ((current.link_ctr - baseline_link_ctr) / baseline_link_ctr) * 100
    : null;
  const results_delta_pct = baseline_results && current.result_count
    ? ((current.result_count - baseline_results) / baseline_results) * 100
    : null;

  // Лаги
  const cpr_lag1 = weeklyData[1]?.cpr || null;
  const cpr_lag2 = weeklyData[2]?.cpr || null;
  const freq_lag1 = weeklyData[1]?.frequency || null;
  const freq_lag2 = weeklyData[2]?.frequency || null;
  const ctr_lag1 = weeklyData[1]?.ctr || null;
  const ctr_lag2 = weeklyData[2]?.ctr || null;
  const cpm_lag1 = weeklyData[1]?.cpm || null;
  const cpm_lag2 = weeklyData[2]?.cpm || null;
  const spend_lag1 = weeklyData[1]?.spend || null;
  const spend_lag2 = weeklyData[2]?.spend || null;
  const link_ctr_lag1 = weeklyData[1]?.link_ctr || null;
  const link_ctr_lag2 = weeklyData[2]?.link_ctr || null;
  const results_lag1 = weeklyData[1]?.result_count || null;
  const results_lag2 = weeklyData[2]?.result_count || null;

  // Ranking лаги
  const quality_rank_lag1 = weeklyData[1]?.quality_rank_score ?? null;
  const quality_rank_lag2 = weeklyData[2]?.quality_rank_score ?? null;
  const engagement_rank_lag1 = weeklyData[1]?.engagement_rank_score ?? null;
  const engagement_rank_lag2 = weeklyData[2]?.engagement_rank_score ?? null;
  const conversion_rank_lag1 = weeklyData[1]?.conversion_rank_score ?? null;
  const conversion_rank_lag2 = weeklyData[2]?.conversion_rank_score ?? null;

  // Slopes (тренды за последние 4 недели)
  const last4Weeks = weeklyData.slice(0, 4);
  const freq_slope = calculateSlope(last4Weeks.map(w => w.frequency).reverse());
  const ctr_slope = calculateSlope(last4Weeks.map(w => w.ctr).reverse());

  // Reach growth rate
  const reach_growth_rate = weeklyData[1]?.reach && weeklyData[1].reach > 0
    ? ((current.reach - weeklyData[1].reach) / weeklyData[1].reach) * 100
    : null;

  // Spend change
  const spend_change_pct = weeklyData[1]?.spend && weeklyData[1].spend > 0
    ? ((current.spend - weeklyData[1].spend) / weeklyData[1].spend) * 100
    : null;

  // Качество данных
  const weeks_with_data = weeklyData.filter(w => w.spend > 0).length;
  const minResults = getMinResults(primaryFamily, config);
  const min_results_met = current.result_count >= minResults;

  // Ranking scores
  const quality_score = current.quality_rank_score;
  const engagement_score = current.engagement_rank_score;
  const conversion_score = current.conversion_rank_score;

  const relevance_health = (quality_score !== null || engagement_score !== null || conversion_score !== null)
    ? (quality_score ?? 0) + (engagement_score ?? 0) + (conversion_score ?? 0)
    : null;

  // Baseline rankings
  const baselineQuality = baselineWeeks.map(w => w.quality_rank_score).filter((v): v is number => v !== null);
  const baselineEngagement = baselineWeeks.map(w => w.engagement_rank_score).filter((v): v is number => v !== null);
  const baselineConversion = baselineWeeks.map(w => w.conversion_rank_score).filter((v): v is number => v !== null);

  const baseline_quality = baselineQuality.length > 0 ? median(baselineQuality) : null;
  const baseline_engagement = baselineEngagement.length > 0 ? median(baselineEngagement) : null;
  const baseline_conversion = baselineConversion.length > 0 ? median(baselineConversion) : null;
  const baseline_relevance = (baseline_quality !== null || baseline_engagement !== null || baseline_conversion !== null)
    ? (baseline_quality ?? 0) + (baseline_engagement ?? 0) + (baseline_conversion ?? 0)
    : null;

  // Drops
  const quality_drop = quality_score !== null && baseline_quality !== null
    ? quality_score - baseline_quality : null;
  const engagement_drop = engagement_score !== null && baseline_engagement !== null
    ? engagement_score - baseline_engagement : null;
  const conversion_drop = conversion_score !== null && baseline_conversion !== null
    ? conversion_score - baseline_conversion : null;
  const relevance_drop = relevance_health !== null && baseline_relevance !== null
    ? relevance_health - baseline_relevance : null;

  const features: FeatureSet = {
    spend: current.spend,
    frequency: current.frequency,
    ctr: current.ctr,
    cpc: current.cpc,
    cpm: current.cpm,
    reach: current.reach,
    link_ctr: current.link_ctr,
    result_count: current.result_count,
    cpr: current.cpr,
    baseline_cpr, baseline_frequency, baseline_ctr, baseline_cpc, baseline_cpm, baseline_spend, baseline_link_ctr, baseline_results,
    cpr_delta_pct, freq_delta_pct, ctr_delta_pct, cpc_delta_pct, cpm_delta_pct, spend_delta_pct, link_ctr_delta_pct, results_delta_pct,
    cpr_lag1, cpr_lag2, freq_lag1, freq_lag2, ctr_lag1, ctr_lag2, cpm_lag1, cpm_lag2, spend_lag1, spend_lag2, link_ctr_lag1, link_ctr_lag2, results_lag1, results_lag2,
    freq_slope, ctr_slope, reach_growth_rate, spend_change_pct, weeks_with_data, min_results_met,
    quality_score, engagement_score, conversion_score, relevance_health,
    quality_drop, engagement_drop, conversion_drop, relevance_drop,
    baseline_quality, baseline_engagement, baseline_conversion,
    quality_rank_lag1, quality_rank_lag2, engagement_rank_lag1, engagement_rank_lag2, conversion_rank_lag1, conversion_rank_lag2,
  };

  return { features, weeklyData };
}

/**
 * Определяет primary_family для ad
 */
async function determinePrimaryFamily(
  adAccountId: string,
  fbAdId: string,
  weekStartDate: string
): Promise<string> {
  // Получаем optimization_goal из adset
  const { data: ad } = await supabase
    .from('meta_ads')
    .select('fb_adset_id')
    .eq('ad_account_id', adAccountId)
    .eq('fb_ad_id', fbAdId)
    .single();

  if (ad?.fb_adset_id) {
    const { data: adset } = await supabase
      .from('meta_adsets')
      .select('optimization_goal')
      .eq('ad_account_id', adAccountId)
      .eq('fb_adset_id', ad.fb_adset_id)
      .single();

    // Простой маппинг
    const goal = adset?.optimization_goal;
    if (goal === 'CONVERSATIONS') return 'messages';
    if (goal === 'LEAD_GENERATION') return 'leadgen_form';
    if (goal === 'VALUE') return 'purchase';
  }

  // Fallback: выбираем семейство с наибольшим количеством результатов
  const { data: results } = await supabase
    .from('meta_weekly_results')
    .select('result_family, result_count')
    .eq('ad_account_id', adAccountId)
    .eq('fb_ad_id', fbAdId)
    .lte('week_start_date', weekStartDate);

  const familyCounts = new Map<string, number>();
  for (const r of results || []) {
    const current = familyCounts.get(r.result_family) || 0;
    familyCounts.set(r.result_family, current + (r.result_count || 0));
  }

  let bestFamily = 'click';
  let bestCount = 0;
  for (const [family, count] of familyCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestFamily = family;
    }
  }

  return bestFamily;
}

// ============================================================================
// ANOMALY DETECTION
// ============================================================================

/**
 * Вычисляет дату конца недели (+ 6 дней от начала)
 */
function getWeekEndDate(weekStart: string): string {
  const start = new Date(weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return end.toISOString().split('T')[0];
}

/**
 * Определяет направление отклонения: плохо, хорошо или нейтрально
 */
function getDeviationDirection(metric: MetricName, deltaPct: number): DeviationDirection {
  if (Math.abs(deltaPct) < DEVIATION_THRESHOLDS[metric] * 100) {
    return 'neutral';
  }

  const badDirection = BAD_DIRECTION[metric];

  if (badDirection === 'increase') {
    // Для frequency, cpm, spend: рост = плохо, падение = хорошо
    return deltaPct > 0 ? 'bad' : 'good';
  } else {
    // Для ctr, link_ctr: падение = плохо, рост = хорошо
    return deltaPct < 0 ? 'bad' : 'good';
  }
}

// ============================================================================
// PAUSE DETECTION (Iteration 4) - BATCH OPTIMIZED
// ============================================================================

type DailyInsightsMap = Map<string, Array<{ date: string; impressions: number; spend: number }>>;

// Типы для batch-кэшей
type AdsMap = Map<string, { fb_adset_id: string | null }>;
type AdsetsMap = Map<string, { optimization_goal: string | null }>;
type WeeklyResultsMap = Map<string, Array<{ result_family: string; result_count: number }>>;

// Типы для batch-кэширования insights (для computeFeatures)
interface WeeklyInsightRow {
  fb_ad_id: string;
  week_start_date: string;
  spend: number;
  frequency: number;
  ctr: number;
  cpc: number;
  cpm: number;
  reach: number;
  link_ctr: number | null;
  quality_rank_score: number | null;
  engagement_rank_score: number | null;
  conversion_rank_score: number | null;
}
type InsightsCache = Map<string, WeeklyInsightRow[]>; // key = fb_ad_id

interface WeeklyResultRow {
  fb_ad_id: string;
  week_start_date: string;
  result_family: string;
  result_count: number;
  cpr: number | null;
}
type ResultsCache = Map<string, WeeklyResultRow[]>; // key = fb_ad_id

// Supabase PostgREST имеет серверный лимит 1000 строк
const SUPABASE_PAGE_SIZE = 1000;

/**
 * Пагинированная загрузка данных из Supabase (обходит лимит 1000 строк)
 */
async function fetchAllPaginated<T>(
  queryFn: () => any,
  tableName: string
): Promise<T[]> {
  let allData: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: page, error } = await queryFn().range(offset, offset + SUPABASE_PAGE_SIZE - 1);

    if (error) {
      log.warn({ error, tableName, offset }, 'Failed to fetch page');
      break;
    }

    if (page && page.length > 0) {
      allData = allData.concat(page as T[]);
      offset += SUPABASE_PAGE_SIZE;
      hasMore = page.length === SUPABASE_PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allData;
}

/**
 * Загружает ВСЕ ads для аккаунта с пагинацией
 */
async function loadAllAds(adAccountId: string): Promise<AdsMap> {
  log.info({ adAccountId }, 'Loading all ads...');

  const data = await fetchAllPaginated<{ fb_ad_id: string; fb_adset_id: string }>(
    () => supabase
      .from('meta_ads')
      .select('fb_ad_id, fb_adset_id')
      .eq('ad_account_id', adAccountId),
    'meta_ads'
  );

  log.info({ adAccountId, count: data.length }, 'Loaded all ads');
  const map: AdsMap = new Map();
  for (const row of data) {
    map.set(row.fb_ad_id, { fb_adset_id: row.fb_adset_id });
  }
  return map;
}

/**
 * Загружает ВСЕ adsets для аккаунта с пагинацией
 */
async function loadAllAdsets(adAccountId: string): Promise<AdsetsMap> {
  log.info({ adAccountId }, 'Loading all adsets...');

  const data = await fetchAllPaginated<{ fb_adset_id: string; optimization_goal: string | null }>(
    () => supabase
      .from('meta_adsets')
      .select('fb_adset_id, optimization_goal')
      .eq('ad_account_id', adAccountId),
    'meta_adsets'
  );

  log.info({ adAccountId, count: data.length }, 'Loaded all adsets');
  const map: AdsetsMap = new Map();
  for (const row of data) {
    map.set(row.fb_adset_id, { optimization_goal: row.optimization_goal });
  }
  return map;
}

/**
 * Загружает ВСЕ weekly_results для аккаунта с пагинацией
 */
async function loadAllWeeklyResults(adAccountId: string): Promise<WeeklyResultsMap> {
  log.info({ adAccountId }, 'Loading all weekly results...');

  const data = await fetchAllPaginated<{
    fb_ad_id: string;
    week_start_date: string;
    result_family: string;
    result_count: number;
  }>(
    () => supabase
      .from('meta_weekly_results')
      .select('fb_ad_id, week_start_date, result_family, result_count')
      .eq('ad_account_id', adAccountId),
    'meta_weekly_results'
  );

  log.info({ adAccountId, count: data.length }, 'Loaded all weekly results');
  // Группируем по fb_ad_id (для определения primary family)
  const map: WeeklyResultsMap = new Map();
  for (const row of data) {
    if (!map.has(row.fb_ad_id)) {
      map.set(row.fb_ad_id, []);
    }
    map.get(row.fb_ad_id)!.push({
      result_family: row.result_family,
      result_count: row.result_count || 0,
    });
  }
  return map;
}

/**
 * Загружает ВСЕ weekly insights для computeFeatures с пагинацией
 */
async function loadAllInsightsForCompute(adAccountId: string): Promise<InsightsCache> {
  log.info({ adAccountId }, 'Loading all insights for compute...');

  const data = await fetchAllPaginated<{
    fb_ad_id: string;
    week_start_date: string;
    spend: any;
    frequency: any;
    ctr: any;
    cpc: any;
    cpm: any;
    reach: any;
    link_ctr: any;
    quality_rank_score: number | null;
    engagement_rank_score: number | null;
    conversion_rank_score: number | null;
  }>(
    () => supabase
      .from('meta_insights_weekly')
      .select('fb_ad_id, week_start_date, spend, frequency, ctr, cpc, cpm, reach, link_ctr, quality_rank_score, engagement_rank_score, conversion_rank_score')
      .eq('ad_account_id', adAccountId)
      .order('week_start_date', { ascending: false }),
    'meta_insights_weekly'
  );

  log.info({ adAccountId, count: data.length }, 'Loaded all insights for compute');
  const map: InsightsCache = new Map();
  for (const row of data) {
    if (!map.has(row.fb_ad_id)) {
      map.set(row.fb_ad_id, []);
    }
    map.get(row.fb_ad_id)!.push({
      fb_ad_id: row.fb_ad_id,
      week_start_date: row.week_start_date,
      spend: parseFloat(row.spend as any) || 0,
      frequency: parseFloat(row.frequency as any) || 0,
      ctr: parseFloat(row.ctr as any) || 0,
      cpc: parseFloat(row.cpc as any) || 0,
      cpm: parseFloat(row.cpm as any) || 0,
      reach: parseInt(row.reach as any) || 0,
      link_ctr: row.link_ctr ? parseFloat(row.link_ctr as any) : null,
      quality_rank_score: row.quality_rank_score ?? null,
      engagement_rank_score: row.engagement_rank_score ?? null,
      conversion_rank_score: row.conversion_rank_score ?? null,
    });
  }
  return map;
}

/**
 * Загружает ВСЕ weekly results для computeFeatures с пагинацией
 */
async function loadAllResultsForCompute(adAccountId: string): Promise<ResultsCache> {
  log.info({ adAccountId }, 'Loading all results for compute...');

  const data = await fetchAllPaginated<{
    fb_ad_id: string;
    week_start_date: string;
    result_family: string;
    result_count: number;
    cpr: any;
  }>(
    () => supabase
      .from('meta_weekly_results')
      .select('fb_ad_id, week_start_date, result_family, result_count, cpr')
      .eq('ad_account_id', adAccountId)
      .order('week_start_date', { ascending: false }),
    'meta_weekly_results'
  );

  log.info({ adAccountId, count: data.length }, 'Loaded all results for compute');
  const map: ResultsCache = new Map();
  for (const row of data) {
    if (!map.has(row.fb_ad_id)) {
      map.set(row.fb_ad_id, []);
    }
    map.get(row.fb_ad_id)!.push({
      fb_ad_id: row.fb_ad_id,
      week_start_date: row.week_start_date,
      result_family: row.result_family,
      result_count: row.result_count || 0,
      cpr: row.cpr ? parseFloat(row.cpr as any) : null,
    });
  }
  return map;
}

/**
 * Определяет primary family из кэша (без запросов к БД)
 */
function determinePrimaryFamilyFromCache(
  adsMap: AdsMap,
  adsetsMap: AdsetsMap,
  weeklyResultsMap: WeeklyResultsMap,
  fbAdId: string
): string {
  // Проверяем optimization_goal
  const ad = adsMap.get(fbAdId);
  if (ad?.fb_adset_id) {
    const adset = adsetsMap.get(ad.fb_adset_id);
    const goal = adset?.optimization_goal;
    if (goal === 'CONVERSATIONS') return 'messages';
    if (goal === 'LEAD_GENERATION') return 'leadgen_form';
    if (goal === 'VALUE') return 'purchase';
  }

  // Fallback: выбираем семейство с наибольшим количеством результатов
  const results = weeklyResultsMap.get(fbAdId);
  if (results && results.length > 0) {
    const familyCounts = new Map<string, number>();
    for (const r of results) {
      const current = familyCounts.get(r.result_family) || 0;
      familyCounts.set(r.result_family, current + r.result_count);
    }

    let maxFamily = 'other';
    let maxCount = 0;
    for (const [family, count] of familyCounts) {
      if (count > maxCount) {
        maxCount = count;
        maxFamily = family;
      }
    }
    return maxFamily;
  }

  return 'other';
}

/**
 * Загружает ВСЕ daily insights для аккаунта с пагинацией
 * Возвращает Map с ключом "fb_ad_id|week_start"
 */
async function loadAllDailyInsights(adAccountId: string): Promise<DailyInsightsMap> {
  const data = await fetchAllPaginated<{
    fb_ad_id: string;
    date: string;
    impressions: number;
    spend: number;
  }>(
    () => supabase
      .from('meta_insights_daily')
      .select('fb_ad_id, date, impressions, spend')
      .eq('ad_account_id', adAccountId)
      .order('date', { ascending: true }),
    'meta_insights_daily'
  );

  // Группируем по ad_id + week_start
  const map: DailyInsightsMap = new Map();

  for (const row of data) {
    // Вычисляем week_start для этой даты
    const date = new Date(row.date);
    const dayOfWeek = date.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() + mondayOffset);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const key = `${row.fb_ad_id}|${weekStartStr}`;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push({
      date: row.date,
      impressions: row.impressions || 0,
      spend: row.spend || 0,
    });
  }

  log.info({ adAccountId, totalDays: data.length, uniqueWeeks: map.size }, 'Loaded daily insights for pause detection');
  return map;
}

/**
 * Анализирует паузы используя предзагруженные данные
 */
function analyzePauseFromCache(
  dailyMap: DailyInsightsMap,
  fbAdId: string,
  weekStartDate: string
): PauseAnalysis {
  const key = `${fbAdId}|${weekStartDate}`;
  const dailyData = dailyMap.get(key);

  if (!dailyData || dailyData.length === 0) {
    return {
      pause_days_count: 0,
      has_delivery_gap: false,
      active_days: 0,
      min_daily_impressions: 0,
      max_daily_impressions: 0,
      daily_impressions_cv: null,
    };
  }

  const impressions = dailyData.map(d => d.impressions);
  const hasSpend = dailyData.some(d => d.spend > 0);

  const activeDays = impressions.filter(i => i > 0).length;
  const pauseDays = impressions.filter(i => i === 0).length;

  const hasDeliveryGap = hasSpend && activeDays > 0 && pauseDays > 0;

  const minDailyImpressions = Math.min(...impressions);
  const maxDailyImpressions = Math.max(...impressions);

  let dailyImpressionsCv: number | null = null;
  if (activeDays > 1) {
    const activeImpressions = impressions.filter(i => i > 0);
    const mean = activeImpressions.reduce((a, b) => a + b, 0) / activeImpressions.length;
    if (mean > 0) {
      const variance = activeImpressions.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / activeImpressions.length;
      dailyImpressionsCv = Math.sqrt(variance) / mean;
    }
  }

  return {
    pause_days_count: pauseDays,
    has_delivery_gap: hasDeliveryGap,
    active_days: activeDays,
    min_daily_impressions: minDailyImpressions,
    max_daily_impressions: maxDailyImpressions,
    daily_impressions_cv: dailyImpressionsCv,
  };
}

// ============================================================================
// PRECEDING DEVIATIONS
// ============================================================================

/**
 * Анализирует предшествующие отклонения метрик за 1-2 недели до аномалии
 */
function analyzePrecedingDeviations(
  features: FeatureSet,
  weeklyData: WeeklyData[]
): PrecedingDeviations {
  const result: PrecedingDeviations = {
    week_0: null,       // Неделя аномалии (текущая)
    week_minus_1: null,
    week_minus_2: null,
  };

  // Конфигурация метрик для анализа (берём из weeklyData напрямую, не из features.lag)
  const metricsConfig: Array<{
    name: MetricName;
    weeklyDataKey: keyof WeeklyData;
    baselineKey: keyof FeatureSet;
  }> = [
    { name: 'frequency', weeklyDataKey: 'frequency', baselineKey: 'baseline_frequency' },
    { name: 'ctr', weeklyDataKey: 'ctr', baselineKey: 'baseline_ctr' },
    { name: 'link_ctr', weeklyDataKey: 'link_ctr', baselineKey: 'baseline_link_ctr' },
    { name: 'cpm', weeklyDataKey: 'cpm', baselineKey: 'baseline_cpm' },
    { name: 'cpr', weeklyDataKey: 'cpr', baselineKey: 'baseline_cpr' },
    { name: 'spend', weeklyDataKey: 'spend', baselineKey: 'baseline_spend' },
    { name: 'results', weeklyDataKey: 'result_count', baselineKey: 'baseline_results' },
    // Facebook Ad Relevance Diagnostics (качество креатива)
    { name: 'quality_ranking', weeklyDataKey: 'quality_rank_score', baselineKey: 'baseline_quality' },
    { name: 'engagement_ranking', weeklyDataKey: 'engagement_rank_score', baselineKey: 'baseline_engagement' },
    { name: 'conversion_ranking', weeklyDataKey: 'conversion_rank_score', baselineKey: 'baseline_conversion' },
  ];

  // Конфигурация метрик для week 0 (текущая неделя — без лагов)
  const week0Metrics: Array<{
    name: MetricName;
    currentKey: keyof FeatureSet;
    baselineKey: keyof FeatureSet;
  }> = [
    { name: 'frequency', currentKey: 'frequency', baselineKey: 'baseline_frequency' },
    { name: 'ctr', currentKey: 'ctr', baselineKey: 'baseline_ctr' },
    { name: 'link_ctr', currentKey: 'link_ctr', baselineKey: 'baseline_link_ctr' },
    { name: 'cpm', currentKey: 'cpm', baselineKey: 'baseline_cpm' },
    { name: 'cpr', currentKey: 'cpr', baselineKey: 'baseline_cpr' },
    { name: 'spend', currentKey: 'spend', baselineKey: 'baseline_spend' },
    { name: 'results', currentKey: 'result_count', baselineKey: 'baseline_results' },
    { name: 'quality_ranking', currentKey: 'quality_score', baselineKey: 'baseline_quality' },
    { name: 'engagement_ranking', currentKey: 'engagement_score', baselineKey: 'baseline_engagement' },
    { name: 'conversion_ranking', currentKey: 'conversion_score', baselineKey: 'baseline_conversion' },
  ];

  // Анализ недели 0 (текущая неделя аномалии)
  if (weeklyData[0]) {
    const deviations: MetricDeviation[] = [];

    for (const metric of week0Metrics) {
      const value = features[metric.currentKey] as number | null;
      const baseline = features[metric.baselineKey] as number | null;

      if (value !== null && baseline !== null && baseline > 0) {
        const deltaPct = ((value - baseline) / baseline) * 100;
        const threshold = DEVIATION_THRESHOLDS[metric.name] * 100;
        const isSignificant = Math.abs(deltaPct) >= threshold;
        const direction = getDeviationDirection(metric.name, deltaPct);

        // Записываем ВСЕ метрики (не только значимые) для объединённой таблицы
        deviations.push({
          metric: metric.name,
          value,
          baseline,
          delta_pct: deltaPct,
          is_significant: isSignificant,
          direction,
        });
      }
    }

    // Всегда создаём week_0 если есть данные (rankings показываем всегда)
    result.week_0 = {
      week_start: weeklyData[0].week_start_date,
      week_end: getWeekEndDate(weeklyData[0].week_start_date),
      deviations,
      quality_ranking: weeklyData[0].quality_rank_score,
      engagement_ranking: weeklyData[0].engagement_rank_score,
      conversion_ranking: weeklyData[0].conversion_rank_score,
    };
  }

  // Анализ недели -1 (берём значения напрямую из weeklyData, не из features)
  if (weeklyData[1]) {
    const deviations: MetricDeviation[] = [];

    for (const metric of metricsConfig) {
      // Берём значение напрямую из weeklyData[1], а не из features.lag
      const value = weeklyData[1][metric.weeklyDataKey] as number | null;
      const baseline = features[metric.baselineKey] as number | null;

      if (value !== null && baseline !== null && baseline > 0) {
        const deltaPct = ((value - baseline) / baseline) * 100;
        const threshold = DEVIATION_THRESHOLDS[metric.name] * 100;
        const isSignificant = Math.abs(deltaPct) >= threshold;
        const direction = getDeviationDirection(metric.name, deltaPct);

        // Записываем ВСЕ метрики (не только значимые) для объединённой таблицы
        deviations.push({
          metric: metric.name,
          value,
          baseline,
          delta_pct: deltaPct,
          is_significant: isSignificant,
          direction,
        });
      }
    }

    // Всегда создаём week_minus_1 если есть данные
    result.week_minus_1 = {
      week_start: weeklyData[1].week_start_date,
      week_end: getWeekEndDate(weeklyData[1].week_start_date),
      deviations,
      quality_ranking: weeklyData[1].quality_rank_score,
      engagement_ranking: weeklyData[1].engagement_rank_score,
      conversion_ranking: weeklyData[1].conversion_rank_score,
    };
  }

  // Анализ недели -2 (берём значения напрямую из weeklyData, не из features)
  if (weeklyData[2]) {
    const deviations: MetricDeviation[] = [];

    for (const metric of metricsConfig) {
      // Берём значение напрямую из weeklyData[2], а не из features.lag
      const value = weeklyData[2][metric.weeklyDataKey] as number | null;
      const baseline = features[metric.baselineKey] as number | null;

      if (value !== null && baseline !== null && baseline > 0) {
        const deltaPct = ((value - baseline) / baseline) * 100;
        const threshold = DEVIATION_THRESHOLDS[metric.name] * 100;
        const isSignificant = Math.abs(deltaPct) >= threshold;
        const direction = getDeviationDirection(metric.name, deltaPct);

        // Записываем ВСЕ метрики (не только значимые) для объединённой таблицы
        deviations.push({
          metric: metric.name,
          value,
          baseline,
          delta_pct: deltaPct,
          is_significant: isSignificant,
          direction,
        });
      }
    }

    // Всегда создаём week_minus_2 если есть данные
    result.week_minus_2 = {
      week_start: weeklyData[2].week_start_date,
      week_end: getWeekEndDate(weeklyData[2].week_start_date),
      deviations,
      quality_ranking: weeklyData[2].quality_rank_score,
      engagement_ranking: weeklyData[2].engagement_rank_score,
      conversion_ranking: weeklyData[2].conversion_rank_score,
    };
  }

  return result;
}

/**
 * Детектирует аномалии CPR для одного ad на одну неделю
 *
 * Фокус только на CPR spike с анализом предшествующих отклонений:
 * - Для каждого роста CPR анализируем что происходило за 1-2 недели до
 * - Отслеживаем отклонения в frequency, CTR, link_ctr, CPM, spend
 * - Анализируем паузы в доставке (Iteration 4)
 */
// Значимые бизнес-результаты для CPR анализа
// Игнорируем 'other', 'video_view', 'click', 'engagement' — это не конверсии
const VALID_RESULT_FAMILIES = new Set(['messages', 'leadgen_form', 'purchase', 'registration']);

function detectAnomalies(
  features: FeatureSet,
  primaryFamily: string,
  config: AnomalyConfig,
  weeklyData: WeeklyData[],
  pauseAnalysis?: PauseAnalysis
): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // Не детектируем аномалии для незначимых result families (video_view, other, click)
  if (!VALID_RESULT_FAMILIES.has(primaryFamily)) {
    return anomalies;
  }

  // Не детектируем аномалии если нет данных или мало результатов
  if (!features.min_results_met || features.weeks_with_data < 4) {
    return anomalies;
  }

  // CPR Spike - единственный тип аномалии
  if (features.cpr && features.baseline_cpr && features.cpr_delta_pct !== null) {
    const threshold = (config.cpr_spike_threshold - 1) * 100; // 20%

    if (features.cpr_delta_pct >= threshold) {
      // Анализируем что происходило за 1-2 недели до аномалии
      const precedingDeviations = analyzePrecedingDeviations(features, weeklyData);

      // Формируем likely_triggers из текущей недели (для совместимости)
      const likelyTriggers: Anomaly['likely_triggers'] = [];

      if (features.freq_delta_pct !== null && features.freq_delta_pct > 15) {
        likelyTriggers.push({
          metric: 'frequency',
          value: features.frequency,
          delta: `+${features.freq_delta_pct.toFixed(1)}%`,
        });
      }
      if (features.ctr_delta_pct !== null && features.ctr_delta_pct < -15) {
        likelyTriggers.push({
          metric: 'ctr',
          value: features.ctr,
          delta: `${features.ctr_delta_pct.toFixed(1)}%`,
        });
      }
      if (features.cpm_delta_pct !== null && features.cpm_delta_pct > 15) {
        likelyTriggers.push({
          metric: 'cpm',
          value: features.cpm,
          delta: `+${features.cpm_delta_pct.toFixed(1)}%`,
        });
      }

      // Confidence зависит от количества данных
      const confidence = Math.min(1, features.weeks_with_data / 8);

      // Score = нормализованная дельта с весом confidence
      const anomalyScore = Math.min(1, (features.cpr_delta_pct / 100) * confidence);

      anomalies.push({
        anomaly_type: 'cpr_spike',
        current_value: features.cpr,
        baseline_value: features.baseline_cpr,
        delta_pct: features.cpr_delta_pct,
        anomaly_score: anomalyScore,
        confidence,
        likely_triggers: likelyTriggers,
        preceding_deviations: precedingDeviations,
        // Pause detection (Iteration 4)
        pause_days_count: pauseAnalysis?.pause_days_count ?? 0,
        has_delivery_gap: pauseAnalysis?.has_delivery_gap ?? false,
      });
    }
  }

  return anomalies;
}

// ============================================================================
// MAIN PIPELINE
// ============================================================================

/**
 * Вычисляет features и детектирует аномалии для всех ads в аккаунте
 */
export async function processAdAccount(adAccountId: string): Promise<{
  adsProcessed: number;
  anomaliesDetected: number;
}> {
  log.info({ adAccountId }, 'Processing ad account for anomalies');

  const config = await loadConfig();

  // BATCH LOAD: Загружаем ВСЕ данные одним запросом каждый
  const [dailyInsightsMap, adsMap, adsetsMap, weeklyResultsMap, insightsCache, resultsCache] = await Promise.all([
    loadAllDailyInsights(adAccountId),
    loadAllAds(adAccountId),
    loadAllAdsets(adAccountId),
    loadAllWeeklyResults(adAccountId),
    loadAllInsightsForCompute(adAccountId),
    loadAllResultsForCompute(adAccountId),
  ]);

  log.info({
    adAccountId,
    adsCount: adsMap.size,
    adsetsCount: adsetsMap.size,
    weeklyResultsAds: weeklyResultsMap.size,
    insightsCacheAds: insightsCache.size,
    resultsCacheAds: resultsCache.size
  }, 'Batch data loaded');

  // Получаем все уникальные пары (ad_id, week_start_date) с пагинацией
  // Supabase PostgREST имеет серверный лимит 1000 строк, поэтому используем пагинацию
  const PAGE_SIZE = 1000;
  let allInsights: { fb_ad_id: string; week_start_date: string }[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: page, error } = await supabase
      .from('meta_insights_weekly')
      .select('fb_ad_id, week_start_date')
      .eq('ad_account_id', adAccountId)
      .gt('spend', 0)
      .order('week_start_date', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      log.error({ error, adAccountId, offset }, 'Failed to fetch insights page');
      throw error;
    }

    if (page && page.length > 0) {
      allInsights = allInsights.concat(page);
      offset += PAGE_SIZE;
      hasMore = page.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  const insights = allInsights;
  log.info({ adAccountId, insightsCount: insights.length }, 'Starting anomaly processing');

  let adsProcessed = 0;
  let anomaliesDetected = 0;

  // BATCH UPSERT: Накапливаем записи и сохраняем пачками
  const BATCH_SIZE = 500;
  const featuresBatch: any[] = [];
  const anomaliesBatch: any[] = [];

  // Функция для flush батчей
  const flushFeatures = async () => {
    if (featuresBatch.length === 0) return;
    const { error } = await supabase
      .from('ad_weekly_features')
      .upsert(featuresBatch, { onConflict: 'ad_account_id,fb_ad_id,week_start_date' });
    if (error) {
      log.error({ error, batchSize: featuresBatch.length }, 'Failed to batch upsert features');
    }
    featuresBatch.length = 0;
  };

  const flushAnomalies = async () => {
    if (anomaliesBatch.length === 0) return;
    const { error } = await supabase
      .from('ad_weekly_anomalies')
      .upsert(anomaliesBatch, { onConflict: 'ad_account_id,fb_ad_id,week_start_date,result_family,anomaly_type' });
    if (error) {
      log.error({ error, batchSize: anomaliesBatch.length }, 'Failed to batch upsert anomalies');
    }
    anomaliesBatch.length = 0;
  };

  for (const insight of insights || []) {
    try {
      // Логируем первые 5 записей для диагностики
      if (adsProcessed < 5) {
        log.info({ adAccountId, processed: adsProcessed, fbAdId: insight.fb_ad_id }, 'Processing insight');
      }

      // Определяем primary family из кэша (БЕЗ запросов к БД!)
      const primaryFamily = determinePrimaryFamilyFromCache(
        adsMap,
        adsetsMap,
        weeklyResultsMap,
        insight.fb_ad_id
      );

      // Вычисляем features из кэша (БЕЗ запросов к БД!)
      const result = computeFeaturesFromCache(
        insightsCache,
        resultsCache,
        insight.fb_ad_id,
        insight.week_start_date,
        primaryFamily,
        config
      );

      if (!result) continue;

      const { features, weeklyData } = result;

      // Анализируем паузы из предзагруженного кэша (без запроса к БД)
      const pauseAnalysis = analyzePauseFromCache(
        dailyInsightsMap,
        insight.fb_ad_id,
        insight.week_start_date
      );

      // Добавляем features в batch (вместо await upsert)
      featuresBatch.push({
        ad_account_id: adAccountId,
        fb_ad_id: insight.fb_ad_id,
        week_start_date: insight.week_start_date,
        primary_family: primaryFamily,
        ...features,
        // Pause detection fields
        active_days: pauseAnalysis.active_days,
        min_daily_impressions: pauseAnalysis.min_daily_impressions,
        max_daily_impressions: pauseAnalysis.max_daily_impressions,
        daily_impressions_cv: pauseAnalysis.daily_impressions_cv,
        created_at: new Date().toISOString(),
      });

      // Детектируем аномалии с анализом предшествующих отклонений и пауз
      const anomalies = detectAnomalies(features, primaryFamily, config, weeklyData, pauseAnalysis);

      // Добавляем аномалии в batch
      for (const anomaly of anomalies) {
        anomaliesBatch.push({
          ad_account_id: adAccountId,
          fb_ad_id: insight.fb_ad_id,
          week_start_date: insight.week_start_date,
          result_family: primaryFamily,
          anomaly_type: anomaly.anomaly_type,
          current_value: anomaly.current_value,
          baseline_value: anomaly.baseline_value,
          delta_pct: anomaly.delta_pct,
          anomaly_score: anomaly.anomaly_score,
          confidence: anomaly.confidence,
          likely_triggers: anomaly.likely_triggers,
          preceding_deviations: anomaly.preceding_deviations,
          pause_days_count: anomaly.pause_days_count,
          has_delivery_gap: anomaly.has_delivery_gap,
          status: 'new',
          created_at: new Date().toISOString(),
        });
        anomaliesDetected++;
      }

      adsProcessed++;

      // Flush features batch каждые BATCH_SIZE записей
      if (featuresBatch.length >= BATCH_SIZE) {
        await flushFeatures();
        log.info({ adAccountId, processed: adsProcessed, total: insights?.length ?? 0 }, 'Batch flushed');
      }
    } catch (err) {
      log.error({
        error: err,
        adAccountId,
        fbAdId: insight.fb_ad_id,
        weekStartDate: insight.week_start_date
      }, 'Failed to process ad week');
    }
  }

  // Финальный flush оставшихся записей
  await flushFeatures();
  await flushAnomalies();

  log.info({ adAccountId, adsProcessed, anomaliesDetected }, 'Ad account processed');

  return { adsProcessed, anomaliesDetected };
}

/**
 * Получает список аномалий для аккаунта
 */
export async function getAnomalies(
  adAccountId: string,
  options: {
    status?: string;
    anomalyType?: string;
    minScore?: number;
    limit?: number;
    offset?: number;
  } = {}
): Promise<any[]> {
  // Сначала получаем аномалии без JOIN (Supabase требует FK для JOIN)
  let query = supabase
    .from('ad_weekly_anomalies')
    .select('*')
    .eq('ad_account_id', adAccountId)
    .order('anomaly_score', { ascending: false });

  if (options.status) {
    query = query.eq('status', options.status);
  }
  if (options.anomalyType) {
    query = query.eq('anomaly_type', options.anomalyType);
  }
  if (options.minScore) {
    query = query.gte('anomaly_score', options.minScore);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }
  if (options.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
  }

  const { data: anomalies, error } = await query;

  if (error) {
    log.error({ error, adAccountId }, 'Failed to fetch anomalies');
    throw error;
  }

  if (!anomalies || anomalies.length === 0) {
    return [];
  }

  // Обогащаем данными из meta_ads и meta_adsets
  const fbAdIds = [...new Set(anomalies.map(a => a.fb_ad_id))];

  const { data: ads } = await supabase
    .from('meta_ads')
    .select('fb_ad_id, name, fb_adset_id')
    .eq('ad_account_id', adAccountId)
    .in('fb_ad_id', fbAdIds);

  const adsMap = new Map((ads || []).map(ad => [ad.fb_ad_id, ad]));

  // Получаем adsets для имён
  const adsetIds = [...new Set((ads || []).map(a => a.fb_adset_id).filter(Boolean))];

  let adsetsMap = new Map<string, string>();
  if (adsetIds.length > 0) {
    const { data: adsets } = await supabase
      .from('meta_adsets')
      .select('fb_adset_id, name')
      .eq('ad_account_id', adAccountId)
      .in('fb_adset_id', adsetIds);

    adsetsMap = new Map((adsets || []).map(as => [as.fb_adset_id, as.name]));
  }

  // Обогащаем аномалии
  return anomalies.map(anomaly => {
    const ad = adsMap.get(anomaly.fb_ad_id);
    return {
      ...anomaly,
      ad_name: ad?.name || anomaly.fb_ad_id,
      adset_name: ad?.fb_adset_id ? adsetsMap.get(ad.fb_adset_id) : null,
    };
  });
}

/**
 * Обновляет статус аномалии
 */
export async function updateAnomalyStatus(
  anomalyId: string,
  status: 'acknowledged' | 'resolved' | 'false_positive',
  userId?: string,
  notes?: string
): Promise<void> {
  const { error } = await supabase
    .from('ad_weekly_anomalies')
    .update({
      status,
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: userId,
      notes,
    })
    .eq('id', anomalyId);

  if (error) {
    log.error({ error, anomalyId }, 'Failed to update anomaly status');
    throw error;
  }
}

/**
 * Получает summary аномалий для аккаунта
 */
export async function getAnomalySummary(adAccountId: string): Promise<{
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  avgScore: number;
}> {
  const { data, error } = await supabase
    .from('ad_weekly_anomalies')
    .select('anomaly_type, status, anomaly_score')
    .eq('ad_account_id', adAccountId);

  if (error) {
    log.error({ error, adAccountId }, 'Failed to fetch anomaly summary');
    throw error;
  }

  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let totalScore = 0;

  for (const anomaly of data || []) {
    byType[anomaly.anomaly_type] = (byType[anomaly.anomaly_type] || 0) + 1;
    byStatus[anomaly.status] = (byStatus[anomaly.status] || 0) + 1;
    totalScore += anomaly.anomaly_score || 0;
  }

  return {
    total: data?.length || 0,
    byType,
    byStatus,
    avgScore: data?.length ? totalScore / data.length : 0,
  };
}

/**
 * Обновляет preceding_deviations для всех аномалий, у которых он NULL
 * Используется для заполнения данных у старых аномалий
 */
export async function updateMissingPrecedingDeviations(adAccountId: string): Promise<{
  totalAnomalies: number;
  updated: number;
  skipped: number;
}> {
  log.info({ adAccountId }, 'Starting update of missing preceding_deviations');

  // 1. Получаем ВСЕ аномалии (не только с NULL preceding_deviations)
  // чтобы пересчитать данные с новыми метриками (CPR и др.)
  const PAGE_SIZE = 1000;
  let allAnomalies: any[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: page, error } = await supabase
      .from('ad_weekly_anomalies')
      .select('id, fb_ad_id, week_start_date')
      .eq('ad_account_id', adAccountId)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      log.error({ error, adAccountId }, 'Failed to fetch anomalies for update');
      throw error;
    }

    if (page && page.length > 0) {
      allAnomalies = allAnomalies.concat(page);
      offset += PAGE_SIZE;
      hasMore = page.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  log.info({ adAccountId, totalAnomalies: allAnomalies.length }, 'Fetched anomalies for update');

  if (allAnomalies.length === 0) {
    return { totalAnomalies: 0, updated: 0, skipped: 0 };
  }

  // 2. Получаем features для этих аномалий
  const anomalyKeys = allAnomalies.map(a => ({
    fb_ad_id: a.fb_ad_id,
    week_start_date: a.week_start_date
  }));

  // Создаем кэш features по ключу "fb_ad_id:week_start_date"
  const featuresMap = new Map<string, any>();

  // Загружаем features пачками
  const uniqueFbAdIds = [...new Set(anomalyKeys.map(k => k.fb_ad_id))];

  for (let i = 0; i < uniqueFbAdIds.length; i += 100) {
    const batch = uniqueFbAdIds.slice(i, i + 100);
    const { data: features, error } = await supabase
      .from('ad_weekly_features')
      .select('*')
      .eq('ad_account_id', adAccountId)
      .in('fb_ad_id', batch);

    if (error) {
      log.error({ error }, 'Failed to fetch features batch');
      continue;
    }

    for (const f of features || []) {
      const key = `${f.fb_ad_id}:${f.week_start_date}`;
      featuresMap.set(key, f);
    }
  }

  log.info({ adAccountId, featuresCount: featuresMap.size }, 'Loaded features for anomalies');

  // 3. Вычисляем preceding_deviations для каждой аномалии
  let updated = 0;
  let skipped = 0;
  const updateBatch: { id: string; preceding_deviations: PrecedingDeviations }[] = [];

  for (const anomaly of allAnomalies) {
    const key = `${anomaly.fb_ad_id}:${anomaly.week_start_date}`;
    const features = featuresMap.get(key);

    if (!features) {
      skipped++;
      continue;
    }

    // Реконструируем FeatureSet из record
    const featureSet: FeatureSet = {
      spend: features.spend ?? 0,
      frequency: features.frequency ?? 0,
      ctr: features.ctr ?? 0,
      cpc: features.cpc ?? 0,
      cpm: features.cpm ?? 0,
      reach: features.reach ?? 0,
      link_ctr: features.link_ctr ?? 0,
      result_count: features.result_count ?? 0,
      cpr: features.cpr,
      baseline_cpr: features.baseline_cpr,
      baseline_frequency: features.baseline_frequency,
      baseline_ctr: features.baseline_ctr,
      baseline_cpc: features.baseline_cpc,
      baseline_cpm: features.baseline_cpm,
      baseline_spend: features.baseline_spend,
      baseline_link_ctr: features.baseline_link_ctr,
      cpr_delta_pct: features.cpr_delta_pct,
      freq_delta_pct: features.freq_delta_pct,
      ctr_delta_pct: features.ctr_delta_pct,
      cpc_delta_pct: features.cpc_delta_pct,
      cpm_delta_pct: features.cpm_delta_pct,
      spend_delta_pct: features.spend_delta_pct,
      link_ctr_delta_pct: features.link_ctr_delta_pct,
      cpr_lag1: features.cpr_lag1,
      cpr_lag2: features.cpr_lag2,
      freq_lag1: features.freq_lag1,
      freq_lag2: features.freq_lag2,
      ctr_lag1: features.ctr_lag1,
      ctr_lag2: features.ctr_lag2,
      cpm_lag1: features.cpm_lag1,
      cpm_lag2: features.cpm_lag2,
      spend_lag1: features.spend_lag1,
      spend_lag2: features.spend_lag2,
      link_ctr_lag1: features.link_ctr_lag1,
      link_ctr_lag2: features.link_ctr_lag2,
      results_lag1: features.results_lag1,
      results_lag2: features.results_lag2,
      baseline_results: features.baseline_results,
      results_delta_pct: features.results_delta_pct,
      freq_slope: features.freq_slope,
      ctr_slope: features.ctr_slope,
      reach_growth_rate: features.reach_growth_rate,
      spend_change_pct: features.spend_change_pct,
      weeks_with_data: features.weeks_with_data ?? 0,
      min_results_met: features.min_results_met ?? false,
      quality_score: features.quality_score,
      engagement_score: features.engagement_score,
      conversion_score: features.conversion_score,
      relevance_health: features.relevance_health,
      quality_drop: features.quality_drop,
      engagement_drop: features.engagement_drop,
      conversion_drop: features.conversion_drop,
      relevance_drop: features.relevance_drop,
      baseline_quality: features.baseline_quality,
      baseline_engagement: features.baseline_engagement,
      baseline_conversion: features.baseline_conversion,
      quality_rank_lag1: features.quality_rank_lag1,
      quality_rank_lag2: features.quality_rank_lag2,
      engagement_rank_lag1: features.engagement_rank_lag1,
      engagement_rank_lag2: features.engagement_rank_lag2,
      conversion_rank_lag1: features.conversion_rank_lag1,
      conversion_rank_lag2: features.conversion_rank_lag2,
    };

    // Реконструируем WeeklyData для rankings
    // week_start_date - это week 0, вычисляем week -1 и week -2
    const weekStart = new Date(anomaly.week_start_date);
    const week1Start = new Date(weekStart);
    week1Start.setDate(week1Start.getDate() - 7);
    const week2Start = new Date(weekStart);
    week2Start.setDate(week2Start.getDate() - 14);

    // Ищем features для week -1 и week -2 напрямую в featuresMap
    const week1Key = `${anomaly.fb_ad_id}:${week1Start.toISOString().split('T')[0]}`;
    const week2Key = `${anomaly.fb_ad_id}:${week2Start.toISOString().split('T')[0]}`;
    const features1 = featuresMap.get(week1Key);
    const features2 = featuresMap.get(week2Key);

    // Если baselines отсутствуют - рассчитываем на лету из features недель 1-8
    let baseline_cpm = featureSet.baseline_cpm;
    let baseline_spend = featureSet.baseline_spend;
    let baseline_link_ctr = featureSet.baseline_link_ctr;
    let baseline_results = featureSet.baseline_results;

    if (baseline_cpm == null || baseline_spend == null || baseline_results == null) {
      const baselineWeekFeatures: (typeof features | undefined)[] = [];
      for (let i = 1; i <= 8; i++) {
        const weekDate = new Date(weekStart);
        weekDate.setDate(weekDate.getDate() - (i * 7));
        const weekKey = `${anomaly.fb_ad_id}:${weekDate.toISOString().split('T')[0]}`;
        baselineWeekFeatures.push(featuresMap.get(weekKey));
      }

      const baselineCpms = baselineWeekFeatures.filter(f => f?.cpm != null && f.cpm > 0).map(f => f!.cpm);
      const baselineSpends = baselineWeekFeatures.filter(f => f?.spend != null && f.spend > 0).map(f => f!.spend);
      const baselineLinkCtrs = baselineWeekFeatures.filter(f => f?.link_ctr != null && f.link_ctr > 0).map(f => f!.link_ctr);
      const baselineResultsCounts = baselineWeekFeatures.filter(f => f?.result_count != null && f.result_count > 0).map(f => f!.result_count);

      if (baseline_cpm == null && baselineCpms.length > 0) {
        baseline_cpm = median(baselineCpms);
      }
      if (baseline_spend == null && baselineSpends.length > 0) {
        baseline_spend = median(baselineSpends);
      }
      if (baseline_link_ctr == null && baselineLinkCtrs.length > 0) {
        baseline_link_ctr = median(baselineLinkCtrs);
      }
      if (baseline_results == null && baselineResultsCounts.length > 0) {
        baseline_results = median(baselineResultsCounts);
      }

      // Обновляем featureSet с вычисленными baselines
      featureSet.baseline_cpm = baseline_cpm ?? null;
      featureSet.baseline_spend = baseline_spend ?? null;
      featureSet.baseline_link_ctr = baseline_link_ctr ?? null;
      featureSet.baseline_results = baseline_results ?? null;
    }

    const weeklyData: WeeklyData[] = [
      {
        week_start_date: anomaly.week_start_date,
        spend: features.spend ?? 0,
        frequency: features.frequency ?? 0,
        ctr: features.ctr ?? 0,
        cpc: features.cpc ?? 0,
        cpm: features.cpm ?? 0,
        reach: features.reach ?? 0,
        link_ctr: features.link_ctr ?? 0,
        result_count: features.result_count ?? 0,
        cpr: features.cpr,
        quality_rank_score: features.quality_score,
        engagement_rank_score: features.engagement_score,
        conversion_rank_score: features.conversion_score,
      },
      // Week -1: используем features1 напрямую если есть, иначе lag values
      {
        week_start_date: week1Start.toISOString().split('T')[0],
        spend: features1?.spend ?? features.spend_lag1 ?? 0,
        frequency: features1?.frequency ?? features.freq_lag1 ?? 0,
        ctr: features1?.ctr ?? features.ctr_lag1 ?? 0,
        cpc: features1?.cpc ?? 0,
        cpm: features1?.cpm ?? features.cpm_lag1 ?? 0,
        reach: features1?.reach ?? 0,
        link_ctr: features1?.link_ctr ?? features.link_ctr_lag1 ?? 0,
        result_count: features1?.result_count ?? features.results_lag1 ?? 0,
        cpr: features1?.cpr ?? features.cpr_lag1,
        quality_rank_score: features1?.quality_score ?? features.quality_rank_lag1,
        engagement_rank_score: features1?.engagement_score ?? features.engagement_rank_lag1,
        conversion_rank_score: features1?.conversion_score ?? features.conversion_rank_lag1,
      },
      // Week -2: используем features2 напрямую если есть, иначе lag values
      {
        week_start_date: week2Start.toISOString().split('T')[0],
        spend: features2?.spend ?? features.spend_lag2 ?? 0,
        frequency: features2?.frequency ?? features.freq_lag2 ?? 0,
        ctr: features2?.ctr ?? features.ctr_lag2 ?? 0,
        cpc: features2?.cpc ?? 0,
        cpm: features2?.cpm ?? features.cpm_lag2 ?? 0,
        reach: features2?.reach ?? 0,
        link_ctr: features2?.link_ctr ?? features.link_ctr_lag2 ?? 0,
        result_count: features2?.result_count ?? features.results_lag2 ?? 0,
        cpr: features2?.cpr ?? features.cpr_lag2,
        quality_rank_score: features2?.quality_score ?? features.quality_rank_lag2,
        engagement_rank_score: features2?.engagement_score ?? features.engagement_rank_lag2,
        conversion_rank_score: features2?.conversion_score ?? features.conversion_rank_lag2,
      },
    ];

    // Вычисляем preceding_deviations
    const precedingDeviations = analyzePrecedingDeviations(featureSet, weeklyData);

    updateBatch.push({
      id: anomaly.id,
      preceding_deviations: precedingDeviations,
    });

    // Batch update каждые 100 записей
    if (updateBatch.length >= 100) {
      for (const item of updateBatch) {
        const { error } = await supabase
          .from('ad_weekly_anomalies')
          .update({ preceding_deviations: item.preceding_deviations })
          .eq('id', item.id);

        if (!error) updated++;
      }
      updateBatch.length = 0;
      log.info({ adAccountId, updated }, 'Batch update progress');
    }
  }

  // Финальный flush
  for (const item of updateBatch) {
    const { error } = await supabase
      .from('ad_weekly_anomalies')
      .update({ preceding_deviations: item.preceding_deviations })
      .eq('id', item.id);

    if (!error) updated++;
  }

  log.info({ adAccountId, totalAnomalies: allAnomalies.length, updated, skipped },
    'Completed updating preceding_deviations');

  return {
    totalAnomalies: allAnomalies.length,
    updated,
    skipped,
  };
}
