/**
 * BURNOUT ANALYZER SERVICE
 *
 * Анализ lead→lag зависимостей для предсказания выгорания:
 * - Какие метрики предсказывают рост CPR через 1-2 недели
 * - Квантильный анализ триггеров
 * - Простой predict с top drivers
 */

import { supabase } from '../lib/supabaseClient.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'burnoutAnalyzer' });

// Типы
interface FeatureRow {
  fb_ad_id: string;
  week_start_date: string;
  primary_family: string;
  spend: number;
  frequency: number;
  ctr: number;
  cpc: number;
  cpm: number;
  reach: number;
  cpr: number | null;
  baseline_cpr: number | null;
  freq_delta_pct: number | null;
  ctr_delta_pct: number | null;
  cpc_delta_pct: number | null;
  freq_slope: number | null;
  ctr_slope: number | null;
  reach_growth_rate: number | null;
  spend_change_pct: number | null;
  weeks_with_data: number;
  min_results_met: boolean;
}

interface LeadLagRow {
  // Lead indicators (неделя t)
  freq_t: number;
  freq_delta_t: number | null;
  ctr_t: number;
  ctr_delta_t: number | null;
  cpc_t: number;
  cpc_delta_t: number | null;
  cpm_t: number;
  reach_growth_t: number | null;
  spend_change_t: number | null;
  freq_slope_t: number | null;
  ctr_slope_t: number | null;

  // Lag (target): был ли CPR spike через 1 или 2 недели
  cpr_spike_t1: boolean;  // через 1 неделю
  cpr_spike_t2: boolean;  // через 2 недели
  cpr_delta_t1: number | null;  // % изменения CPR через 1 неделю
  cpr_delta_t2: number | null;  // % изменения CPR через 2 недели
}

interface QuantileAnalysis {
  metric: string;
  quantile: string;
  range: { min: number; max: number };
  sampleSize: number;
  avgCprGrowth1w: number;  // средний рост CPR через 1 неделю
  avgCprGrowth2w: number;  // средний рост CPR через 2 недели
  spikeRate1w: number;     // % случаев со spike через 1 неделю
  spikeRate2w: number;     // % случаев со spike через 2 недели
}

interface TriggerInsight {
  metric: string;
  direction: 'increase' | 'decrease';
  threshold: number;
  predictivePower: number;  // 0-1, насколько хорошо предсказывает
  avgLeadTime: number;      // среднее время до spike (недель)
  recommendation: string;
}

interface PredictionResult {
  fbAdId: string;
  weekStartDate: string;
  riskScore: number;  // 0-1
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  topDrivers: {
    metric: string;
    value: number;
    contribution: number;
    warning: string;
  }[];
  predictedCprChange1w: number;  // % ожидаемого изменения CPR
  predictedCprChange2w: number;
  confidence: number;
}

// Константы
const CPR_SPIKE_THRESHOLD = 20;  // 20% рост = spike
const MIN_DATA_POINTS = 50;  // минимум данных для анализа

// ============================================================================
// DATA PREPARATION
// ============================================================================

/**
 * Строит датасет lead→lag для анализа зависимостей
 */
async function buildLeadLagDataset(adAccountId: string): Promise<LeadLagRow[]> {
  // Получаем все features отсортированные по ad и дате
  const { data: features, error } = await supabase
    .from('ad_weekly_features')
    .select('*')
    .eq('ad_account_id', adAccountId)
    .eq('min_results_met', true)
    .order('fb_ad_id')
    .order('week_start_date');

  if (error) {
    log.error({ error, adAccountId }, 'Failed to fetch features for lead-lag');
    throw error;
  }

  if (!features || features.length < MIN_DATA_POINTS) {
    log.warn({ adAccountId, count: features?.length }, 'Not enough data for lead-lag analysis');
    return [];
  }

  // Группируем по ad
  const adGroups = new Map<string, FeatureRow[]>();
  for (const f of features) {
    const existing = adGroups.get(f.fb_ad_id) || [];
    existing.push(f as FeatureRow);
    adGroups.set(f.fb_ad_id, existing);
  }

  const dataset: LeadLagRow[] = [];

  // Для каждого ad строим пары (t, t+1) и (t, t+2)
  for (const [adId, weeks] of adGroups) {
    // Сортируем по дате
    weeks.sort((a, b) => new Date(a.week_start_date).getTime() - new Date(b.week_start_date).getTime());

    for (let i = 0; i < weeks.length - 2; i++) {
      const t = weeks[i];
      const t1 = weeks[i + 1];
      const t2 = weeks[i + 2];

      // Проверяем что недели последовательные (разница 7 дней)
      const diff1 = (new Date(t1.week_start_date).getTime() - new Date(t.week_start_date).getTime()) / (7 * 24 * 60 * 60 * 1000);
      const diff2 = (new Date(t2.week_start_date).getTime() - new Date(t.week_start_date).getTime()) / (14 * 24 * 60 * 60 * 1000);

      if (Math.abs(diff1 - 1) > 0.1 || Math.abs(diff2 - 1) > 0.1) {
        continue; // Пропускаем если недели не последовательные
      }

      // CPR spike detection
      const cpr_delta_t1 = t.cpr && t1.cpr ? ((t1.cpr - t.cpr) / t.cpr) * 100 : null;
      const cpr_delta_t2 = t.cpr && t2.cpr ? ((t2.cpr - t.cpr) / t.cpr) * 100 : null;

      dataset.push({
        freq_t: t.frequency,
        freq_delta_t: t.freq_delta_pct,
        ctr_t: t.ctr,
        ctr_delta_t: t.ctr_delta_pct,
        cpc_t: t.cpc,
        cpc_delta_t: t.cpc_delta_pct,
        cpm_t: t.cpm,
        reach_growth_t: t.reach_growth_rate,
        spend_change_t: t.spend_change_pct,
        freq_slope_t: t.freq_slope,
        ctr_slope_t: t.ctr_slope,
        cpr_spike_t1: cpr_delta_t1 !== null && cpr_delta_t1 >= CPR_SPIKE_THRESHOLD,
        cpr_spike_t2: cpr_delta_t2 !== null && cpr_delta_t2 >= CPR_SPIKE_THRESHOLD,
        cpr_delta_t1,
        cpr_delta_t2,
      });
    }
  }

  log.info({ adAccountId, datasetSize: dataset.length }, 'Lead-lag dataset built');
  return dataset;
}

// ============================================================================
// QUANTILE ANALYSIS
// ============================================================================

/**
 * Вычисляет квантили для массива чисел
 */
function quantiles(values: number[], probs: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return probs.map(p => {
    const idx = p * (sorted.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sorted[lower];
    return sorted[lower] * (upper - idx) + sorted[upper] * (idx - lower);
  });
}

/**
 * Квантильный анализ: как метрика влияет на будущий CPR
 */
async function analyzeMetricQuantiles(
  dataset: LeadLagRow[],
  metricName: keyof LeadLagRow,
  numQuantiles: number = 4
): Promise<QuantileAnalysis[]> {
  // Фильтруем null значения
  const validRows = dataset.filter(r => r[metricName] !== null && r[metricName] !== undefined);

  if (validRows.length < MIN_DATA_POINTS) {
    return [];
  }

  const values = validRows.map(r => r[metricName] as number);
  const probs = Array.from({ length: numQuantiles + 1 }, (_, i) => i / numQuantiles);
  const boundaries = quantiles(values, probs);

  const results: QuantileAnalysis[] = [];

  for (let q = 0; q < numQuantiles; q++) {
    const min = boundaries[q];
    const max = boundaries[q + 1];

    const quantileRows = validRows.filter(r => {
      const v = r[metricName] as number;
      if (q === 0) return v >= min && v <= max;
      return v > min && v <= max;
    });

    if (quantileRows.length === 0) continue;

    // Считаем средний рост CPR и spike rate
    const cprDeltas1w = quantileRows
      .map(r => r.cpr_delta_t1)
      .filter((v): v is number => v !== null);

    const cprDeltas2w = quantileRows
      .map(r => r.cpr_delta_t2)
      .filter((v): v is number => v !== null);

    const spikeCount1w = quantileRows.filter(r => r.cpr_spike_t1).length;
    const spikeCount2w = quantileRows.filter(r => r.cpr_spike_t2).length;

    results.push({
      metric: String(metricName),
      quantile: `Q${q + 1}`,
      range: { min, max },
      sampleSize: quantileRows.length,
      avgCprGrowth1w: cprDeltas1w.length > 0
        ? cprDeltas1w.reduce((a, b) => a + b, 0) / cprDeltas1w.length
        : 0,
      avgCprGrowth2w: cprDeltas2w.length > 0
        ? cprDeltas2w.reduce((a, b) => a + b, 0) / cprDeltas2w.length
        : 0,
      spikeRate1w: spikeCount1w / quantileRows.length,
      spikeRate2w: spikeCount2w / quantileRows.length,
    });
  }

  return results;
}

/**
 * Полный квантильный анализ всех метрик
 */
export async function runQuantileAnalysis(adAccountId: string): Promise<{
  metrics: Map<string, QuantileAnalysis[]>;
  insights: TriggerInsight[];
}> {
  log.info({ adAccountId }, 'Running quantile analysis');

  const dataset = await buildLeadLagDataset(adAccountId);

  if (dataset.length < MIN_DATA_POINTS) {
    return { metrics: new Map(), insights: [] };
  }

  const metricsToAnalyze: (keyof LeadLagRow)[] = [
    'freq_t',
    'freq_delta_t',
    'ctr_t',
    'ctr_delta_t',
    'cpc_t',
    'cpc_delta_t',
    'reach_growth_t',
    'spend_change_t',
    'freq_slope_t',
    'ctr_slope_t',
  ];

  const results = new Map<string, QuantileAnalysis[]>();
  const insights: TriggerInsight[] = [];

  for (const metric of metricsToAnalyze) {
    const analysis = await analyzeMetricQuantiles(dataset, metric);
    results.set(String(metric), analysis);

    // Генерируем insights из анализа
    if (analysis.length >= 2) {
      const q1 = analysis[0];
      const q4 = analysis[analysis.length - 1];

      // Проверяем монотонность: растёт ли spike rate с ростом метрики
      const spikeRateDiff = q4.spikeRate2w - q1.spikeRate2w;

      if (Math.abs(spikeRateDiff) > 0.1) {
        const direction = spikeRateDiff > 0 ? 'increase' : 'decrease';
        const threshold = direction === 'increase' ? q4.range.min : q1.range.max;

        insights.push({
          metric: String(metric),
          direction,
          threshold,
          predictivePower: Math.abs(spikeRateDiff),
          avgLeadTime: 1.5,  // средний лаг
          recommendation: generateRecommendation(String(metric), direction, threshold),
        });
      }
    }
  }

  // Сортируем insights по predictive power
  insights.sort((a, b) => b.predictivePower - a.predictivePower);

  log.info({
    adAccountId,
    datasetSize: dataset.length,
    insightsCount: insights.length
  }, 'Quantile analysis completed');

  return { metrics: results, insights };
}

/**
 * Генерирует рекомендацию на основе анализа
 */
function generateRecommendation(metric: string, direction: string, threshold: number): string {
  const recommendations: Record<string, Record<string, string>> = {
    freq_t: {
      increase: `Частота показов > ${threshold.toFixed(1)} сигнализирует о приближающемся выгорании. Рассмотрите расширение аудитории или ротацию креативов.`,
      decrease: `Низкая частота показов может указывать на недостаточный охват. Проверьте настройки таргетинга.`,
    },
    freq_delta_t: {
      increase: `Рост частоты > ${threshold.toFixed(0)}% за неделю — ранний сигнал выгорания. Начните готовить новые креативы.`,
      decrease: `Снижение частоты может быть связано с расширением аудитории.`,
    },
    ctr_t: {
      increase: `Высокий CTR обычно коррелирует со стабильным CPR.`,
      decrease: `CTR < ${(threshold * 100).toFixed(2)}% может указывать на потерю интереса аудитории.`,
    },
    ctr_delta_t: {
      increase: `Рост CTR — позитивный сигнал.`,
      decrease: `Падение CTR > ${Math.abs(threshold).toFixed(0)}% — предвестник роста CPR. Обновите креативы.`,
    },
    cpc_delta_t: {
      increase: `Рост CPC > ${threshold.toFixed(0)}% указывает на усиление конкуренции или снижение релевантности.`,
      decrease: `Снижение CPC — позитивный сигнал.`,
    },
    reach_growth_t: {
      increase: `Рост охвата обычно замедляет выгорание.`,
      decrease: `Замедление роста охвата < ${threshold.toFixed(0)}% — аудитория "выработана".`,
    },
    spend_change_t: {
      increase: `Резкое увеличение бюджета > ${threshold.toFixed(0)}% может ускорить выгорание.`,
      decrease: `Снижение бюджета может замедлить выгорание.`,
    },
  };

  return recommendations[metric]?.[direction] || `Порог ${metric}: ${threshold.toFixed(2)}`;
}

// ============================================================================
// SIMPLE PREDICTOR
// ============================================================================

/**
 * Веса для простого линейного предиктора (эмпирические)
 */
const PREDICTOR_WEIGHTS: Record<string, number> = {
  freq_delta_t: 0.25,      // рост частоты — сильный предиктор
  ctr_delta_t: -0.20,      // падение CTR — предиктор (отрицательный вес)
  cpc_delta_t: 0.15,       // рост CPC
  freq_slope_t: 0.20,      // тренд частоты
  ctr_slope_t: -0.10,      // тренд CTR
  reach_growth_t: -0.10,   // замедление охвата
  spend_change_t: 0.05,    // изменение бюджета (слабый эффект)
};

/**
 * Простой predict для одного ad
 */
export async function predictBurnout(
  adAccountId: string,
  fbAdId: string,
  weekStartDate: string
): Promise<PredictionResult | null> {
  // Получаем features
  const { data: features, error } = await supabase
    .from('ad_weekly_features')
    .select('*')
    .eq('ad_account_id', adAccountId)
    .eq('fb_ad_id', fbAdId)
    .eq('week_start_date', weekStartDate)
    .single();

  if (error || !features) {
    return null;
  }

  if (!features.min_results_met || features.weeks_with_data < 4) {
    return null;
  }

  // Вычисляем risk score
  let riskScore = 0;
  const drivers: PredictionResult['topDrivers'] = [];

  for (const [metric, weight] of Object.entries(PREDICTOR_WEIGHTS)) {
    const value = features[metric as keyof typeof features] as number | null;

    if (value === null || value === undefined) continue;

    // Нормализуем значение (делим на 100 для процентов)
    const normalizedValue = value / 100;
    const contribution = normalizedValue * weight;
    riskScore += contribution;

    // Определяем warning
    let warning = '';
    if (metric === 'freq_delta_t' && value > 20) {
      warning = `Частота выросла на ${value.toFixed(0)}%`;
    } else if (metric === 'ctr_delta_t' && value < -15) {
      warning = `CTR упал на ${Math.abs(value).toFixed(0)}%`;
    } else if (metric === 'cpc_delta_t' && value > 15) {
      warning = `CPC вырос на ${value.toFixed(0)}%`;
    } else if (metric === 'freq_slope_t' && value > 0.1) {
      warning = `Частота растёт последние 4 недели`;
    } else if (metric === 'reach_growth_t' && value < -20) {
      warning = `Охват замедлился на ${Math.abs(value).toFixed(0)}%`;
    }

    if (warning) {
      drivers.push({
        metric,
        value,
        contribution: Math.abs(contribution),
        warning,
      });
    }
  }

  // Нормализуем risk score в 0-1
  riskScore = Math.max(0, Math.min(1, (riskScore + 0.5) / 1)); // sigmoid-like

  // Сортируем drivers по contribution
  drivers.sort((a, b) => b.contribution - a.contribution);

  // Определяем risk level
  let riskLevel: PredictionResult['riskLevel'] = 'low';
  if (riskScore >= 0.7) riskLevel = 'critical';
  else if (riskScore >= 0.5) riskLevel = 'high';
  else if (riskScore >= 0.3) riskLevel = 'medium';

  // Предсказываем изменение CPR
  const predictedCprChange1w = riskScore * 30;  // до 30% роста
  const predictedCprChange2w = riskScore * 50;  // до 50% роста

  // Confidence зависит от количества данных
  const confidence = Math.min(1, features.weeks_with_data / 8);

  return {
    fbAdId,
    weekStartDate,
    riskScore,
    riskLevel,
    topDrivers: drivers.slice(0, 5),
    predictedCprChange1w,
    predictedCprChange2w,
    confidence,
  };
}

/**
 * Predict для всех активных ads в аккаунте (последняя неделя)
 */
export async function predictAllAds(adAccountId: string): Promise<PredictionResult[]> {
  log.info({ adAccountId }, 'Predicting burnout for all ads');

  // Получаем последнюю неделю для каждого ad
  const { data: latestWeeks, error } = await supabase
    .from('ad_weekly_features')
    .select('fb_ad_id, week_start_date')
    .eq('ad_account_id', adAccountId)
    .eq('min_results_met', true)
    .order('week_start_date', { ascending: false });

  if (error) {
    log.error({ error, adAccountId }, 'Failed to fetch latest weeks');
    throw error;
  }

  // Группируем и берём последнюю неделю для каждого ad
  const latestByAd = new Map<string, string>();
  for (const row of latestWeeks || []) {
    if (!latestByAd.has(row.fb_ad_id)) {
      latestByAd.set(row.fb_ad_id, row.week_start_date);
    }
  }

  const predictions: PredictionResult[] = [];

  for (const [fbAdId, weekStartDate] of latestByAd) {
    const prediction = await predictBurnout(adAccountId, fbAdId, weekStartDate);
    if (prediction) {
      predictions.push(prediction);
    }
  }

  // Сортируем по risk score
  predictions.sort((a, b) => b.riskScore - a.riskScore);

  log.info({
    adAccountId,
    predictionsCount: predictions.length,
    highRisk: predictions.filter(p => p.riskLevel === 'high' || p.riskLevel === 'critical').length
  }, 'Burnout predictions completed');

  return predictions;
}

// ============================================================================
// CORRELATION ANALYSIS
// ============================================================================

/**
 * Вычисляет корреляции между метриками и будущим CPR
 */
export async function computeCorrelations(adAccountId: string): Promise<{
  correlations: { metric: string; corr1w: number; corr2w: number }[];
}> {
  const dataset = await buildLeadLagDataset(adAccountId);

  if (dataset.length < MIN_DATA_POINTS) {
    return { correlations: [] };
  }

  const metrics: (keyof LeadLagRow)[] = [
    'freq_t',
    'freq_delta_t',
    'ctr_t',
    'ctr_delta_t',
    'cpc_t',
    'cpc_delta_t',
    'reach_growth_t',
    'spend_change_t',
  ];

  const correlations: { metric: string; corr1w: number; corr2w: number }[] = [];

  for (const metric of metrics) {
    const pairs1w = dataset
      .filter(r => r[metric] !== null && r.cpr_delta_t1 !== null)
      .map(r => [r[metric] as number, r.cpr_delta_t1 as number] as [number, number]);

    const pairs2w = dataset
      .filter(r => r[metric] !== null && r.cpr_delta_t2 !== null)
      .map(r => [r[metric] as number, r.cpr_delta_t2 as number] as [number, number]);

    correlations.push({
      metric: String(metric),
      corr1w: pairs1w.length > 10 ? pearsonCorrelation(pairs1w) : 0,
      corr2w: pairs2w.length > 10 ? pearsonCorrelation(pairs2w) : 0,
    });
  }

  // Сортируем по абсолютной корреляции
  correlations.sort((a, b) => Math.abs(b.corr2w) - Math.abs(a.corr2w));

  return { correlations };
}

/**
 * Вычисляет коэффициент корреляции Пирсона
 */
function pearsonCorrelation(pairs: [number, number][]): number {
  const n = pairs.length;
  if (n < 3) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

  for (const [x, y] of pairs) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    sumY2 += y * y;
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (denominator === 0) return 0;
  return numerator / denominator;
}
