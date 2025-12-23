/**
 * YEARLY ANALYZER SERVICE
 *
 * Iteration 2: Годовые анализы для Ad Insights
 * - Yearly Audit (Pareto, waste, stability)
 * - Creative Lifecycle (время жизни креативов до burnout)
 * - Waste Finder (где утекал бюджет)
 * - Response Curve (эффективность spend)
 * - Goal Drift (смена целей во времени)
 */

import { supabase } from '../lib/supabaseClient.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'yearlyAnalyzer' });

// ============================================================================
// TYPES
// ============================================================================

interface ParetoItem {
  ad_id: string;
  name: string;
  spend: number;
  results: number;
  cpr: number;
  pct_spend?: number;
  pct_results?: number;
}

interface WeekPerformance {
  week: string;
  cpr: number;
  spend: number;
  results: number;
}

interface YearlyAuditResult {
  period: { start: string; end: string };
  totals: {
    spend: number;
    results: number;
    avgCpr: number;
    medianCpr: number;
    weeks: number;
  };
  pareto: {
    top10PctAds: ParetoItem[];
    top10PctContribution: number; // % результатов от top 10% ads
    bottom50PctSpend: number; // сколько потратили 50% худших ads
  };
  bestWeeks: WeekPerformance[];
  worstWeeks: WeekPerformance[];
  waste: {
    zeroResultSpend: number;
    zeroResultWeeks: number;
    zeroResultAds: string[];
  };
  stability: {
    anomalyFreeWeeksPct: number;
    totalSpikes: number;
    avgSpikePct: number;
  };
  rankings: {
    avgQualityScore: number;
    avgEngagementScore: number;
    avgConversionScore: number;
    belowAverageWeeks: number;
  };
}

interface CreativeLifecycleItem {
  creativeFingerprint: string;
  adId: string;
  name: string;
  firstWeek: string;
  deathWeek: string | null;
  lifetimeWeeks: number | null;
  isAlive: boolean;
  totalSpend: number;
  totalResults: number;
  avgCpr: number;
  cprVolatility: number;
}

interface CreativeLifecycleReport {
  period: { start: string; end: string };
  summary: {
    totalCreatives: number;
    aliveCreatives: number;
    deadCreatives: number;
    avgLifetimeWeeks: number;
    medianLifetimeWeeks: number;
  };
  creatives: CreativeLifecycleItem[];
  deathCauses: Record<string, number>; // причина смерти → количество
}

interface WasteItem {
  week: string;
  adId: string;
  name: string;
  spend: number;
  results: number;
  reason: string;
}

interface WasteFinderResult {
  period: { start: string; end: string };
  summary: {
    totalWaste: number;
    wastePctOfSpend: number;
    wasteByReason: Record<string, number>;
  };
  details: WasteItem[];
}

// ============================================================================
// HELPERS
// ============================================================================

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function coefficientOfVariation(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  if (mean === 0) return 0;
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
  return Math.sqrt(variance) / mean;
}

// ============================================================================
// YEARLY AUDIT
// ============================================================================

/**
 * Выполняет годовой аудит для ad account
 */
export async function runYearlyAudit(
  adAccountId: string,
  resultFamily: string,
  periodStart?: string,
  periodEnd?: string
): Promise<YearlyAuditResult> {
  log.info({ adAccountId, resultFamily, periodStart, periodEnd }, 'Running yearly audit');

  // Определяем период (по умолчанию последние 12 месяцев)
  const end = periodEnd || new Date().toISOString().split('T')[0];
  const start = periodStart || (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 12);
    return d.toISOString().split('T')[0];
  })();

  // 1. Получаем все weekly results для этого family
  const { data: results, error } = await supabase
    .from('meta_weekly_results')
    .select(`
      fb_ad_id,
      week_start_date,
      spend,
      result_count,
      cpr
    `)
    .eq('ad_account_id', adAccountId)
    .eq('result_family', resultFamily)
    .gte('week_start_date', start)
    .lte('week_start_date', end)
    .order('week_start_date', { ascending: true });

  if (error) {
    log.error({ error, adAccountId }, 'Failed to fetch results for yearly audit');
    throw error;
  }

  if (!results || results.length === 0) {
    throw new Error(`No data found for family ${resultFamily} in period ${start} - ${end}`);
  }

  // 2. Получаем названия ads
  const adIds = [...new Set(results.map(r => r.fb_ad_id))];
  const { data: ads } = await supabase
    .from('meta_ads')
    .select('fb_ad_id, name')
    .eq('ad_account_id', adAccountId)
    .in('fb_ad_id', adIds);

  const adNames = new Map((ads || []).map(a => [a.fb_ad_id, a.name]));

  // 3. Агрегируем по ads
  const adStats = new Map<string, { spend: number; results: number; cprs: number[] }>();
  const weekStats = new Map<string, { spend: number; results: number }>();

  for (const row of results) {
    // По ad
    if (!adStats.has(row.fb_ad_id)) {
      adStats.set(row.fb_ad_id, { spend: 0, results: 0, cprs: [] });
    }
    const ad = adStats.get(row.fb_ad_id)!;
    ad.spend += parseFloat(row.spend) || 0;
    ad.results += row.result_count || 0;
    if (row.cpr) ad.cprs.push(parseFloat(row.cpr));

    // По неделям
    if (!weekStats.has(row.week_start_date)) {
      weekStats.set(row.week_start_date, { spend: 0, results: 0 });
    }
    const week = weekStats.get(row.week_start_date)!;
    week.spend += parseFloat(row.spend) || 0;
    week.results += row.result_count || 0;
  }

  // 4. Считаем totals
  const totalSpend = [...adStats.values()].reduce((s, a) => s + a.spend, 0);
  const totalResults = [...adStats.values()].reduce((s, a) => s + a.results, 0);
  const allCprs = results.filter(r => r.cpr).map(r => parseFloat(r.cpr));
  const avgCpr = totalResults > 0 ? totalSpend / totalResults : 0;
  const medianCpr = median(allCprs);

  // 5. Pareto analysis (80/20)
  const sortedBySpend = [...adStats.entries()]
    .map(([adId, stats]) => ({
      ad_id: adId,
      name: adNames.get(adId) || adId,
      spend: stats.spend,
      results: stats.results,
      cpr: stats.results > 0 ? stats.spend / stats.results : 0,
    }))
    .sort((a, b) => b.results - a.results);

  // Top 10% ads
  const top10Count = Math.max(1, Math.ceil(sortedBySpend.length * 0.1));
  const top10Ads = sortedBySpend.slice(0, top10Count).map(ad => ({
    ...ad,
    pct_spend: totalSpend > 0 ? (ad.spend / totalSpend) * 100 : 0,
    pct_results: totalResults > 0 ? (ad.results / totalResults) * 100 : 0,
  }));
  const top10Contribution = top10Ads.reduce((s, a) => s + (a.pct_results || 0), 0);

  // Bottom 50% spend
  const sortedBySpendAsc = [...sortedBySpend].sort((a, b) => a.spend - b.spend);
  const bottom50Count = Math.floor(sortedBySpendAsc.length / 2);
  const bottom50Spend = sortedBySpendAsc.slice(0, bottom50Count).reduce((s, a) => s + a.spend, 0);

  // 6. Best/Worst weeks
  const weekPerformance: WeekPerformance[] = [...weekStats.entries()]
    .map(([week, stats]) => ({
      week,
      spend: stats.spend,
      results: stats.results,
      cpr: stats.results > 0 ? stats.spend / stats.results : Infinity,
    }))
    .filter(w => w.results > 0 && w.cpr !== Infinity)
    .sort((a, b) => a.cpr - b.cpr);

  const bestWeeks = weekPerformance.slice(0, 5);
  const worstWeeks = weekPerformance.slice(-5).reverse();

  // 7. Waste analysis
  const zeroResultRows = results.filter(r => (r.result_count || 0) === 0 && (parseFloat(r.spend) || 0) > 0);
  const zeroResultSpend = zeroResultRows.reduce((s, r) => s + (parseFloat(r.spend) || 0), 0);
  const zeroResultWeeks = new Set(zeroResultRows.map(r => r.week_start_date)).size;
  const zeroResultAds = [...new Set(zeroResultRows.map(r => r.fb_ad_id))];

  // 8. Stability (аномалии)
  const { data: anomalies } = await supabase
    .from('ad_weekly_anomalies')
    .select('week_start_date, anomaly_type, spike_pct')
    .eq('ad_account_id', adAccountId)
    .eq('result_family', resultFamily)
    .gte('week_start_date', start)
    .lte('week_start_date', end);

  const allWeeks = [...weekStats.keys()];
  const anomalyWeeks = new Set((anomalies || []).map(a => a.week_start_date));
  const anomalyFreeWeeks = allWeeks.filter(w => !anomalyWeeks.has(w)).length;
  const anomalyFreeWeeksPct = allWeeks.length > 0 ? (anomalyFreeWeeks / allWeeks.length) * 100 : 100;
  const totalSpikes = (anomalies || []).filter(a => a.anomaly_type === 'cpr_spike').length;
  const spikePcts = (anomalies || []).filter(a => a.spike_pct).map(a => a.spike_pct);
  const avgSpikePct = spikePcts.length > 0 ? spikePcts.reduce((a, b) => a + b, 0) / spikePcts.length : 0;

  // 9. Rankings (из insights)
  const { data: insights } = await supabase
    .from('meta_insights_weekly')
    .select('quality_rank_score, engagement_rank_score, conversion_rank_score')
    .eq('ad_account_id', adAccountId)
    .gte('week_start_date', start)
    .lte('week_start_date', end)
    .not('quality_rank_score', 'is', null);

  const qualityScores = (insights || []).map(i => i.quality_rank_score).filter(s => s !== null);
  const engagementScores = (insights || []).map(i => i.engagement_rank_score).filter(s => s !== null);
  const conversionScores = (insights || []).map(i => i.conversion_rank_score).filter(s => s !== null);

  const avgQualityScore = qualityScores.length > 0 ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length : 0;
  const avgEngagementScore = engagementScores.length > 0 ? engagementScores.reduce((a, b) => a + b, 0) / engagementScores.length : 0;
  const avgConversionScore = conversionScores.length > 0 ? conversionScores.reduce((a, b) => a + b, 0) / conversionScores.length : 0;
  const belowAverageWeeks = qualityScores.filter(s => s < 0).length;

  const auditResult: YearlyAuditResult = {
    period: { start, end },
    totals: {
      spend: totalSpend,
      results: totalResults,
      avgCpr,
      medianCpr,
      weeks: allWeeks.length,
    },
    pareto: {
      top10PctAds: top10Ads,
      top10PctContribution: top10Contribution,
      bottom50PctSpend: bottom50Spend,
    },
    bestWeeks,
    worstWeeks,
    waste: {
      zeroResultSpend,
      zeroResultWeeks,
      zeroResultAds,
    },
    stability: {
      anomalyFreeWeeksPct,
      totalSpikes,
      avgSpikePct,
    },
    rankings: {
      avgQualityScore,
      avgEngagementScore,
      avgConversionScore,
      belowAverageWeeks,
    },
  };

  // Кэшируем результат
  await cacheYearlyAudit(adAccountId, resultFamily, start, end, auditResult);

  log.info({ adAccountId, resultFamily, start, end }, 'Yearly audit completed');
  return auditResult;
}

/**
 * Кэширует результат yearly audit
 */
async function cacheYearlyAudit(
  adAccountId: string,
  resultFamily: string,
  periodStart: string,
  periodEnd: string,
  result: YearlyAuditResult
) {
  const { error } = await supabase
    .from('yearly_audit_cache')
    .upsert({
      ad_account_id: adAccountId,
      result_family: resultFamily,
      period_start: periodStart,
      period_end: periodEnd,
      top_ads_by_spend: result.pareto.top10PctAds,
      top_ads_by_results: result.pareto.top10PctAds,
      top_ads_by_efficiency: result.pareto.top10PctAds.sort((a, b) => a.cpr - b.cpr).slice(0, 10),
      pareto_top10_pct: result.pareto.top10PctContribution,
      worst_cpr_weeks: result.worstWeeks,
      best_cpr_weeks: result.bestWeeks,
      zero_result_spend: result.waste.zeroResultSpend,
      zero_result_weeks: result.waste.zeroResultWeeks,
      anomaly_free_weeks_pct: result.stability.anomalyFreeWeeksPct,
      total_spikes: result.stability.totalSpikes,
      avg_spike_pct: result.stability.avgSpikePct,
      total_spend: result.totals.spend,
      total_results: result.totals.results,
      avg_cpr: result.totals.avgCpr,
      median_cpr: result.totals.medianCpr,
      computed_at: new Date().toISOString(),
    }, {
      onConflict: 'ad_account_id,result_family,period_start,period_end',
    });

  if (error) {
    log.error({ error }, 'Failed to cache yearly audit');
  }
}

// ============================================================================
// CREATIVE LIFECYCLE
// ============================================================================

/**
 * Анализирует жизненный цикл креативов
 */
export async function analyzeCreativeLifecycle(
  adAccountId: string,
  resultFamily: string,
  periodStart?: string,
  periodEnd?: string
): Promise<CreativeLifecycleReport> {
  log.info({ adAccountId, resultFamily }, 'Analyzing creative lifecycle');

  const end = periodEnd || new Date().toISOString().split('T')[0];
  const start = periodStart || (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 12);
    return d.toISOString().split('T')[0];
  })();

  // 1. Получаем все weekly results
  const { data: results, error } = await supabase
    .from('meta_weekly_results')
    .select('fb_ad_id, week_start_date, spend, result_count, cpr')
    .eq('ad_account_id', adAccountId)
    .eq('result_family', resultFamily)
    .gte('week_start_date', start)
    .lte('week_start_date', end)
    .order('week_start_date', { ascending: true });

  if (error) {
    log.error({ error }, 'Failed to fetch results for creative lifecycle');
    throw error;
  }

  // 2. Получаем anomalies для определения "смерти"
  const { data: anomalies } = await supabase
    .from('ad_weekly_anomalies')
    .select('fb_ad_id, week_start_date, anomaly_type')
    .eq('ad_account_id', adAccountId)
    .eq('result_family', resultFamily)
    .gte('week_start_date', start)
    .lte('week_start_date', end)
    .order('week_start_date', { ascending: true });

  // 3. Получаем названия ads и creative fingerprints
  const adIds = [...new Set((results || []).map(r => r.fb_ad_id))];
  const { data: ads } = await supabase
    .from('meta_ads')
    .select('fb_ad_id, name, fb_creative_id')
    .eq('ad_account_id', adAccountId)
    .in('fb_ad_id', adIds);

  const adInfo = new Map((ads || []).map(a => [a.fb_ad_id, { name: a.name, creativeId: a.fb_creative_id }]));

  // 4. Группируем по ads
  const adLifecycle = new Map<string, {
    weeks: string[];
    cprs: number[];
    spend: number;
    results: number;
    firstAnomaly: string | null;
  }>();

  for (const row of results || []) {
    if (!adLifecycle.has(row.fb_ad_id)) {
      adLifecycle.set(row.fb_ad_id, {
        weeks: [],
        cprs: [],
        spend: 0,
        results: 0,
        firstAnomaly: null,
      });
    }
    const ad = adLifecycle.get(row.fb_ad_id)!;
    ad.weeks.push(row.week_start_date);
    if (row.cpr) ad.cprs.push(parseFloat(row.cpr));
    ad.spend += parseFloat(row.spend) || 0;
    ad.results += row.result_count || 0;
  }

  // Добавляем первую аномалию
  for (const anomaly of anomalies || []) {
    const ad = adLifecycle.get(anomaly.fb_ad_id);
    if (ad && !ad.firstAnomaly) {
      ad.firstAnomaly = anomaly.week_start_date;
    }
  }

  // 5. Формируем lifecycle items
  const creatives: CreativeLifecycleItem[] = [];
  const deathCauses: Record<string, number> = {};

  for (const [adId, data] of adLifecycle) {
    const info = adInfo.get(adId);
    const creativeFingerprint = info?.creativeId || adId;
    const firstWeek = data.weeks[0];
    const deathWeek = data.firstAnomaly;
    const isAlive = !deathWeek;

    let lifetimeWeeks: number | null = null;
    if (deathWeek && firstWeek) {
      const firstDate = new Date(firstWeek);
      const deathDate = new Date(deathWeek);
      lifetimeWeeks = Math.floor((deathDate.getTime() - firstDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
    }

    const avgCpr = data.results > 0 ? data.spend / data.results : 0;
    const cprVolatility = coefficientOfVariation(data.cprs);

    creatives.push({
      creativeFingerprint,
      adId,
      name: info?.name || adId,
      firstWeek,
      deathWeek,
      lifetimeWeeks,
      isAlive,
      totalSpend: data.spend,
      totalResults: data.results,
      avgCpr,
      cprVolatility,
    });

    // Причина смерти
    if (!isAlive) {
      const cause = cprVolatility > 0.5 ? 'high_volatility' : 'cpr_spike';
      deathCauses[cause] = (deathCauses[cause] || 0) + 1;
    }
  }

  // 6. Summary stats
  const deadCreatives = creatives.filter(c => !c.isAlive);
  const lifetimes = deadCreatives.map(c => c.lifetimeWeeks).filter(l => l !== null) as number[];

  const report: CreativeLifecycleReport = {
    period: { start, end },
    summary: {
      totalCreatives: creatives.length,
      aliveCreatives: creatives.filter(c => c.isAlive).length,
      deadCreatives: deadCreatives.length,
      avgLifetimeWeeks: lifetimes.length > 0 ? lifetimes.reduce((a, b) => a + b, 0) / lifetimes.length : 0,
      medianLifetimeWeeks: median(lifetimes),
    },
    creatives: creatives.sort((a, b) => b.totalSpend - a.totalSpend),
    deathCauses,
  };

  log.info({ adAccountId, resultFamily, creativesCount: creatives.length }, 'Creative lifecycle analysis completed');
  return report;
}

// ============================================================================
// WASTE FINDER
// ============================================================================

/**
 * Находит "waste" - бюджет потраченный неэффективно
 */
export async function findWaste(
  adAccountId: string,
  resultFamily: string,
  periodStart?: string,
  periodEnd?: string
): Promise<WasteFinderResult> {
  log.info({ adAccountId, resultFamily }, 'Finding waste');

  const end = periodEnd || new Date().toISOString().split('T')[0];
  const start = periodStart || (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 12);
    return d.toISOString().split('T')[0];
  })();

  // 1. Получаем weekly results
  const { data: results, error } = await supabase
    .from('meta_weekly_results')
    .select('fb_ad_id, week_start_date, spend, result_count, cpr')
    .eq('ad_account_id', adAccountId)
    .eq('result_family', resultFamily)
    .gte('week_start_date', start)
    .lte('week_start_date', end);

  if (error) throw error;

  // 2. Получаем baseline CPR (медиана)
  const cprs = (results || []).filter(r => r.cpr).map(r => parseFloat(r.cpr));
  const medianCpr = median(cprs);
  const highCprThreshold = medianCpr * 2; // 2x медианы = высокий CPR

  // 3. Получаем названия ads
  const adIds = [...new Set((results || []).map(r => r.fb_ad_id))];
  const { data: ads } = await supabase
    .from('meta_ads')
    .select('fb_ad_id, name')
    .eq('ad_account_id', adAccountId)
    .in('fb_ad_id', adIds);

  const adNames = new Map((ads || []).map(a => [a.fb_ad_id, a.name]));

  // 4. Находим waste
  const wasteDetails: WasteItem[] = [];
  const wasteByReason: Record<string, number> = {
    zero_results: 0,
    high_cpr: 0,
    low_volume: 0,
  };

  const totalSpend = (results || []).reduce((s, r) => s + (parseFloat(r.spend) || 0), 0);

  for (const row of results || []) {
    const spend = parseFloat(row.spend) || 0;
    const resultCount = row.result_count || 0;
    const cpr = parseFloat(row.cpr) || 0;

    let reason = '';

    // Zero results with spend
    if (spend > 0 && resultCount === 0) {
      reason = 'zero_results';
      wasteByReason.zero_results += spend;
    }
    // Very high CPR (2x median)
    else if (cpr > highCprThreshold && spend > 0) {
      const wastedPart = spend - (resultCount * medianCpr); // разница с "нормальной" ценой
      if (wastedPart > 0) {
        reason = 'high_cpr';
        wasteByReason.high_cpr += wastedPart;
      }
    }
    // Low volume (< 5 results but significant spend)
    else if (resultCount > 0 && resultCount < 5 && spend > medianCpr * 10) {
      reason = 'low_volume';
      wasteByReason.low_volume += spend * 0.5; // считаем 50% как waste
    }

    if (reason) {
      wasteDetails.push({
        week: row.week_start_date,
        adId: row.fb_ad_id,
        name: adNames.get(row.fb_ad_id) || row.fb_ad_id,
        spend,
        results: resultCount,
        reason,
      });
    }
  }

  const totalWaste = Object.values(wasteByReason).reduce((a, b) => a + b, 0);

  const wasteResult: WasteFinderResult = {
    period: { start, end },
    summary: {
      totalWaste,
      wastePctOfSpend: totalSpend > 0 ? (totalWaste / totalSpend) * 100 : 0,
      wasteByReason,
    },
    details: wasteDetails.sort((a, b) => b.spend - a.spend).slice(0, 100),
  };

  log.info({
    adAccountId,
    resultFamily,
    totalWaste,
    wastePct: wasteResult.summary.wastePctOfSpend
  }, 'Waste finder completed');

  return wasteResult;
}

// ============================================================================
// RESPONSE CURVE
// ============================================================================

interface ResponseCurveResult {
  level: 'account' | 'campaign' | 'adset';
  entityId: string | null;
  buckets: Array<{
    minSpend: number;
    maxSpend: number;
    weeks: number;
    totalSpend: number;
    totalResults: number;
    avgCpr: number;
    marginalCpr: number;
  }>;
  sweetSpot: { min: number; max: number };
  saturationThreshold: number;
}

/**
 * Анализирует response curve (эффективность spend)
 */
export async function analyzeResponseCurve(
  adAccountId: string,
  resultFamily: string,
  level: 'account' | 'campaign' | 'adset' = 'account',
  entityId?: string,
  periodStart?: string,
  periodEnd?: string
): Promise<ResponseCurveResult> {
  log.info({ adAccountId, resultFamily, level, entityId }, 'Analyzing response curve');

  const end = periodEnd || new Date().toISOString().split('T')[0];
  const start = periodStart || (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 12);
    return d.toISOString().split('T')[0];
  })();

  // Собираем weekly spend/results
  let weeklyData: Array<{ week: string; spend: number; results: number }> = [];

  if (level === 'account') {
    const { data } = await supabase
      .from('meta_weekly_results')
      .select('week_start_date, spend, result_count')
      .eq('ad_account_id', adAccountId)
      .eq('result_family', resultFamily)
      .gte('week_start_date', start)
      .lte('week_start_date', end);

    // Агрегируем по неделям
    const weekMap = new Map<string, { spend: number; results: number }>();
    for (const row of data || []) {
      const key = row.week_start_date;
      if (!weekMap.has(key)) weekMap.set(key, { spend: 0, results: 0 });
      const w = weekMap.get(key)!;
      w.spend += parseFloat(row.spend) || 0;
      w.results += row.result_count || 0;
    }
    weeklyData = [...weekMap.entries()].map(([week, data]) => ({ week, ...data }));
  } else if (level === 'campaign' && entityId) {
    const { data } = await supabase
      .from('meta_insights_weekly_campaign')
      .select('week_start_date, spend, actions_json')
      .eq('ad_account_id', adAccountId)
      .eq('fb_campaign_id', entityId)
      .gte('week_start_date', start)
      .lte('week_start_date', end);

    weeklyData = (data || []).map(row => ({
      week: row.week_start_date,
      spend: parseFloat(row.spend) || 0,
      results: Array.isArray(row.actions_json)
        ? row.actions_json.reduce((s: number, a: any) => s + (parseInt(a.value) || 0), 0)
        : 0,
    }));
  }

  // Сортируем по spend и создаём buckets
  const sortedBySpend = weeklyData.sort((a, b) => a.spend - b.spend);
  const bucketCount = 5;
  const bucketSize = Math.ceil(sortedBySpend.length / bucketCount);

  const buckets: ResponseCurveResult['buckets'] = [];
  for (let i = 0; i < bucketCount; i++) {
    const slice = sortedBySpend.slice(i * bucketSize, (i + 1) * bucketSize);
    if (slice.length === 0) continue;

    const totalSpend = slice.reduce((s, w) => s + w.spend, 0);
    const totalResults = slice.reduce((s, w) => s + w.results, 0);
    const avgCpr = totalResults > 0 ? totalSpend / totalResults : 0;

    // Marginal CPR (сравнение с предыдущим bucket)
    let marginalCpr = avgCpr;
    if (buckets.length > 0) {
      const prevBucket = buckets[buckets.length - 1];
      const deltaSpend = totalSpend - prevBucket.totalSpend;
      const deltaResults = totalResults - prevBucket.totalResults;
      marginalCpr = deltaResults > 0 ? deltaSpend / deltaResults : avgCpr * 2;
    }

    buckets.push({
      minSpend: Math.min(...slice.map(w => w.spend)),
      maxSpend: Math.max(...slice.map(w => w.spend)),
      weeks: slice.length,
      totalSpend,
      totalResults,
      avgCpr,
      marginalCpr,
    });
  }

  // Находим sweet spot (bucket с лучшим CPR)
  const bestBucket = buckets.reduce((best, b) => b.avgCpr < best.avgCpr ? b : best, buckets[0]);
  const sweetSpot = { min: bestBucket?.minSpend || 0, max: bestBucket?.maxSpend || 0 };

  // Saturation threshold (где marginal CPR резко растёт)
  let saturationThreshold = Infinity;
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i].marginalCpr > buckets[i - 1].avgCpr * 1.5) {
      saturationThreshold = buckets[i].minSpend;
      break;
    }
  }

  const result: ResponseCurveResult = {
    level,
    entityId: entityId || null,
    buckets,
    sweetSpot,
    saturationThreshold: saturationThreshold === Infinity ? buckets[buckets.length - 1]?.maxSpend || 0 : saturationThreshold,
  };

  // Кэшируем
  await supabase.from('response_curve_data').upsert({
    ad_account_id: adAccountId,
    level,
    entity_id: entityId || null,
    result_family: resultFamily,
    period_start: start,
    period_end: end,
    spend_buckets: buckets,
    sweet_spot_min: sweetSpot.min,
    sweet_spot_max: sweetSpot.max,
    saturation_threshold: result.saturationThreshold,
    computed_at: new Date().toISOString(),
  }, {
    onConflict: 'ad_account_id,level,entity_id,result_family,period_start,period_end',
  });

  log.info({ adAccountId, resultFamily, level }, 'Response curve analysis completed');
  return result;
}

// ============================================================================
// GOAL DRIFT
// ============================================================================

interface GoalDriftResult {
  periods: Array<{
    period: string;
    spendByObjective: Record<string, number>;
    cprByGoal: Record<string, number>;
    totalSpend: number;
  }>;
  trends: {
    growingGoals: string[];
    decliningGoals: string[];
    stableGoals: string[];
  };
}

/**
 * Анализирует drift целей во времени
 */
export async function analyzeGoalDrift(
  adAccountId: string,
  periodType: 'month' | 'quarter' = 'month'
): Promise<GoalDriftResult> {
  log.info({ adAccountId, periodType }, 'Analyzing goal drift');

  // Получаем campaign insights за 12 месяцев
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 12);

  const { data: insights, error } = await supabase
    .from('meta_insights_weekly_campaign')
    .select('fb_campaign_id, week_start_date, spend, actions_json')
    .eq('ad_account_id', adAccountId)
    .gte('week_start_date', startDate.toISOString().split('T')[0])
    .lte('week_start_date', endDate.toISOString().split('T')[0]);

  if (error) throw error;

  // Получаем objectives из campaigns
  const campaignIds = [...new Set((insights || []).map(i => i.fb_campaign_id))];
  const { data: campaigns } = await supabase
    .from('meta_campaigns')
    .select('fb_campaign_id, objective')
    .eq('ad_account_id', adAccountId)
    .in('fb_campaign_id', campaignIds);

  const campaignObjectives = new Map((campaigns || []).map(c => [c.fb_campaign_id, c.objective]));

  // Группируем по периодам
  const periodData = new Map<string, { spendByObjective: Record<string, number>; totalSpend: number }>();

  for (const row of insights || []) {
    const date = new Date(row.week_start_date);
    let periodKey: string;

    if (periodType === 'month') {
      periodKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    } else {
      const quarter = Math.floor(date.getMonth() / 3) + 1;
      periodKey = `${date.getFullYear()}-Q${quarter}`;
    }

    if (!periodData.has(periodKey)) {
      periodData.set(periodKey, { spendByObjective: {}, totalSpend: 0 });
    }

    const period = periodData.get(periodKey)!;
    const spend = parseFloat(row.spend) || 0;
    const objective = campaignObjectives.get(row.fb_campaign_id) || 'UNKNOWN';

    period.spendByObjective[objective] = (period.spendByObjective[objective] || 0) + spend;
    period.totalSpend += spend;
  }

  // Формируем результат
  const periods = [...periodData.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, data]) => ({
      period,
      spendByObjective: data.spendByObjective,
      cprByGoal: {}, // TODO: вычислить CPR по целям
      totalSpend: data.totalSpend,
    }));

  // Анализируем тренды
  const allObjectives = new Set<string>();
  periods.forEach(p => Object.keys(p.spendByObjective).forEach(o => allObjectives.add(o)));

  const trends: GoalDriftResult['trends'] = {
    growingGoals: [],
    decliningGoals: [],
    stableGoals: [],
  };

  for (const objective of allObjectives) {
    const shares = periods.map(p => {
      const total = p.totalSpend || 1;
      return (p.spendByObjective[objective] || 0) / total;
    });

    if (shares.length < 2) continue;

    const firstHalf = shares.slice(0, Math.floor(shares.length / 2));
    const secondHalf = shares.slice(Math.floor(shares.length / 2));

    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    if (avgSecond > avgFirst * 1.2) {
      trends.growingGoals.push(objective);
    } else if (avgSecond < avgFirst * 0.8) {
      trends.decliningGoals.push(objective);
    } else {
      trends.stableGoals.push(objective);
    }
  }

  // Кэшируем
  for (const period of periods) {
    await supabase.from('goal_drift_data').upsert({
      ad_account_id: adAccountId,
      period_type: periodType,
      period_value: period.period,
      spend_by_objective: period.spendByObjective,
      total_spend: period.totalSpend,
      computed_at: new Date().toISOString(),
    }, {
      onConflict: 'ad_account_id,period_type,period_value',
    });
  }

  log.info({ adAccountId, periodType, periodsCount: periods.length }, 'Goal drift analysis completed');
  return { periods, trends };
}
