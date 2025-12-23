/**
 * ANOMALY DETECTOR SERVICE
 *
 * Детекция аномалий CPR (Cost Per Result):
 * - CPR spike: резкий рост стоимости результата
 * - CTR drop: падение CTR
 * - Frequency high: высокая частота показов
 *
 * Вычисление features и baselines для анализа зависимостей
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
  result_count: number;
  cpr: number | null;
  baseline_cpr: number | null;
  baseline_frequency: number | null;
  baseline_ctr: number | null;
  baseline_cpc: number | null;
  cpr_delta_pct: number | null;
  freq_delta_pct: number | null;
  ctr_delta_pct: number | null;
  cpc_delta_pct: number | null;
  cpr_lag1: number | null;
  cpr_lag2: number | null;
  freq_lag1: number | null;
  freq_lag2: number | null;
  ctr_lag1: number | null;
  ctr_lag2: number | null;
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
}

interface Anomaly {
  anomaly_type: string;
  current_value: number;
  baseline_value: number;
  delta_pct: number;
  anomaly_score: number;
  confidence: number;
  likely_triggers: { metric: string; value: number; delta: string }[];
}

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

/**
 * Вычисляет features для одного ad на одну неделю
 */
async function computeFeatures(
  adAccountId: string,
  fbAdId: string,
  weekStartDate: string,
  primaryFamily: string,
  config: AnomalyConfig
): Promise<FeatureSet | null> {
  // Получаем данные за последние 12 недель (текущая + 11 предыдущих)
  const { data: insights, error } = await supabase
    .from('meta_insights_weekly')
    .select('week_start_date, spend, frequency, ctr, cpc, cpm, reach, quality_rank_score, engagement_rank_score, conversion_rank_score')
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

  const baseline_cpr = median(baselineCprs);
  const baseline_frequency = median(baselineFreqs);
  const baseline_ctr = median(baselineCtrs);
  const baseline_cpc = median(baselineCpcs);

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

  // Лаги
  const cpr_lag1 = weeklyData[1]?.cpr || null;
  const cpr_lag2 = weeklyData[2]?.cpr || null;
  const freq_lag1 = weeklyData[1]?.frequency || null;
  const freq_lag2 = weeklyData[2]?.frequency || null;
  const ctr_lag1 = weeklyData[1]?.ctr || null;
  const ctr_lag2 = weeklyData[2]?.ctr || null;

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

  return {
    spend: current.spend,
    frequency: current.frequency,
    ctr: current.ctr,
    cpc: current.cpc,
    cpm: current.cpm,
    reach: current.reach,
    result_count: current.result_count,
    cpr: current.cpr,
    baseline_cpr,
    baseline_frequency,
    baseline_ctr,
    baseline_cpc,
    cpr_delta_pct,
    freq_delta_pct,
    ctr_delta_pct,
    cpc_delta_pct,
    cpr_lag1,
    cpr_lag2,
    freq_lag1,
    freq_lag2,
    ctr_lag1,
    ctr_lag2,
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
  };
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
 * Детектирует аномалии для одного ad на одну неделю
 */
function detectAnomalies(
  features: FeatureSet,
  primaryFamily: string,
  config: AnomalyConfig
): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // Не детектируем аномалии если нет данных или мало результатов
  if (!features.min_results_met || features.weeks_with_data < 4) {
    return anomalies;
  }

  // 1. CPR Spike
  if (features.cpr && features.baseline_cpr && features.cpr_delta_pct !== null) {
    const threshold = (config.cpr_spike_threshold - 1) * 100; // 20%

    if (features.cpr_delta_pct >= threshold) {
      const likelyTriggers: Anomaly['likely_triggers'] = [];

      // Проверяем что могло вызвать рост CPR
      if (features.freq_delta_pct !== null && features.freq_delta_pct > 20) {
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
      if (features.cpc_delta_pct !== null && features.cpc_delta_pct > 15) {
        likelyTriggers.push({
          metric: 'cpc',
          value: features.cpc,
          delta: `+${features.cpc_delta_pct.toFixed(1)}%`,
        });
      }
      if (features.reach_growth_rate !== null && features.reach_growth_rate < -20) {
        likelyTriggers.push({
          metric: 'reach',
          value: features.reach,
          delta: `${features.reach_growth_rate.toFixed(1)}%`,
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
      });
    }
  }

  // 2. CTR Drop
  if (features.ctr && features.baseline_ctr && features.ctr_delta_pct !== null) {
    const threshold = (1 - config.ctr_drop_threshold) * 100; // 20%

    if (features.ctr_delta_pct <= -threshold) {
      const confidence = Math.min(1, features.weeks_with_data / 8);
      const anomalyScore = Math.min(1, Math.abs(features.ctr_delta_pct) / 100 * confidence);

      anomalies.push({
        anomaly_type: 'ctr_drop',
        current_value: features.ctr,
        baseline_value: features.baseline_ctr,
        delta_pct: features.ctr_delta_pct,
        anomaly_score: anomalyScore,
        confidence,
        likely_triggers: [
          {
            metric: 'frequency',
            value: features.frequency,
            delta: features.freq_delta_pct ? `${features.freq_delta_pct > 0 ? '+' : ''}${features.freq_delta_pct.toFixed(1)}%` : 'N/A',
          },
        ],
      });
    }
  }

  // 3. Frequency High
  if (features.frequency && features.baseline_frequency && features.freq_delta_pct !== null) {
    const threshold = (config.freq_high_threshold - 1) * 100; // 50%

    if (features.freq_delta_pct >= threshold) {
      const confidence = Math.min(1, features.weeks_with_data / 8);
      const anomalyScore = Math.min(1, features.freq_delta_pct / 100 * confidence);

      anomalies.push({
        anomaly_type: 'freq_high',
        current_value: features.frequency,
        baseline_value: features.baseline_frequency,
        delta_pct: features.freq_delta_pct,
        anomaly_score: anomalyScore,
        confidence,
        likely_triggers: [],
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

  // Получаем все уникальные пары (ad_id, week_start_date)
  const { data: insights, error } = await supabase
    .from('meta_insights_weekly')
    .select('fb_ad_id, week_start_date')
    .eq('ad_account_id', adAccountId)
    .gt('spend', 0)
    .order('week_start_date', { ascending: false });

  if (error) {
    log.error({ error, adAccountId }, 'Failed to fetch insights');
    throw error;
  }

  let adsProcessed = 0;
  let anomaliesDetected = 0;

  for (const insight of insights || []) {
    try {
      // Определяем primary family
      const primaryFamily = await determinePrimaryFamily(
        adAccountId,
        insight.fb_ad_id,
        insight.week_start_date
      );

      // Вычисляем features
      const features = await computeFeatures(
        adAccountId,
        insight.fb_ad_id,
        insight.week_start_date,
        primaryFamily,
        config
      );

      if (!features) continue;

      // Сохраняем features
      await supabase
        .from('ad_weekly_features')
        .upsert({
          ad_account_id: adAccountId,
          fb_ad_id: insight.fb_ad_id,
          week_start_date: insight.week_start_date,
          primary_family: primaryFamily,
          ...features,
          created_at: new Date().toISOString(),
        }, {
          onConflict: 'ad_account_id,fb_ad_id,week_start_date'
        });

      // Детектируем аномалии
      const anomalies = detectAnomalies(features, primaryFamily, config);

      // Сохраняем аномалии
      for (const anomaly of anomalies) {
        await supabase
          .from('ad_weekly_anomalies')
          .upsert({
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
            status: 'new',
            created_at: new Date().toISOString(),
          }, {
            onConflict: 'ad_account_id,fb_ad_id,week_start_date,result_family,anomaly_type'
          });

        anomaliesDetected++;
      }

      adsProcessed++;
    } catch (err) {
      log.error({
        error: err,
        adAccountId,
        fbAdId: insight.fb_ad_id,
        weekStartDate: insight.week_start_date
      }, 'Failed to process ad week');
    }
  }

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
