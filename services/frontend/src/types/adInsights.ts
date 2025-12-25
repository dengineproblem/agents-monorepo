/**
 * Ad Insights Types
 *
 * Типы для сервиса аналитики рекламы с детекцией аномалий
 */

// ============================================================================
// ANOMALIES
// ============================================================================

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';

// Основной тип аномалии - только CPR spike
// Старые типы оставлены для совместимости с историческими данными
export type AnomalyType =
  | 'cpr_spike'     // Рост стоимости результата
  | 'ctr_drop'      // (legacy) Падение CTR
  | 'ctr_crash'     // (legacy) Обвал CTR
  | 'freq_high'     // (legacy) Высокая частота
  | 'frequency_spike'
  | 'frequency_critical'
  | 'reach_drop'
  | 'spend_anomaly';

// ============================================================================
// PRECEDING DEVIATIONS (предшествующие отклонения)
// ============================================================================

export type DeviationDirection = 'bad' | 'good' | 'neutral';
export type MetricName = 'frequency' | 'ctr' | 'link_ctr' | 'cpm' | 'spend' | 'results' | 'quality_ranking' | 'engagement_ranking' | 'conversion_ranking';

/**
 * Отклонение одной метрики от baseline
 */
export interface MetricDeviation {
  metric: MetricName;
  value: number;
  baseline: number;
  delta_pct: number;
  is_significant: boolean;
  direction: DeviationDirection;
}

/**
 * Отклонения за одну неделю
 */
export interface WeekDeviations {
  week_start: string;
  week_end: string;
  deviations: MetricDeviation[];
  // Raw ranking values (без порогов, просто для отображения)
  quality_ranking: number | null;
  engagement_ranking: number | null;
  conversion_ranking: number | null;
}

/**
 * Отклонения метрик для текущей недели и предшествующих 1-2 недель
 */
export interface PrecedingDeviations {
  week_0: WeekDeviations | null;       // Неделя аномалии (текущая)
  week_minus_1: WeekDeviations | null; // За 1 неделю до
  week_minus_2: WeekDeviations | null; // За 2 недели до
}

// ============================================================================
// DAILY BREAKDOWN (детализация по дням)
// ============================================================================

export type DailyMetricName = 'frequency' | 'ctr' | 'link_ctr' | 'cpm' | 'cpr' | 'spend' | 'results';

/**
 * Метрики за один день
 */
export interface DailyMetrics {
  impressions: number;
  spend: number;
  frequency: number | null;
  ctr: number | null;
  link_ctr: number | null;
  cpm: number | null;
  cpr: number | null;
  results: number;
}

/**
 * Отклонение метрики от среднего за неделю
 */
export interface DailyDeviation {
  metric: DailyMetricName;
  value: number;
  week_avg: number;
  delta_pct: number;
  is_significant: boolean;
  direction: DeviationDirection;
}

/**
 * Данные за один день
 */
export interface DayBreakdown {
  date: string;
  metrics: DailyMetrics;
  deviations: DailyDeviation[];
}

/**
 * Полная детализация аномалии по дням недели
 */
export interface DailyBreakdownResult {
  days: DayBreakdown[];
  summary: {
    worst_day: string | null;
    best_day: string | null;
    active_days: number;
    pause_days: number;
  };
}

export interface Anomaly {
  id: string;
  ad_account_id: string;
  fb_ad_id: string;
  fb_adset_id?: string;
  fb_campaign_id?: string;
  week_start_date: string;
  result_family?: string;
  anomaly_type: AnomalyType;
  severity?: AnomalySeverity;
  // API fields
  current_value: number;
  baseline_value: number;
  delta_pct: number;
  anomaly_score: number;
  confidence: number;
  likely_triggers?: Array<{ metric: string; value: number; delta: string }>;
  preceding_deviations?: PrecedingDeviations | null;
  // Daily breakdown (детализация по дням)
  daily_breakdown?: DailyBreakdownResult | null;
  // Pause detection (Iteration 4)
  pause_days_count?: number;
  has_delivery_gap?: boolean;
  status: 'new' | 'acknowledged' | 'resolved';
  acknowledged_at?: string;
  acknowledged_by?: string;
  notes?: string;
  created_at: string;
  // Joined fields
  ad_name?: string;
  adset_name?: string;
  campaign_name?: string;
}

export interface AnomaliesResponse {
  anomalies: Anomaly[];
  total: number;
}

// ============================================================================
// BURNOUT / DECAY PREDICTIONS
// ============================================================================

export type BurnoutLevel = 'low' | 'medium' | 'high' | 'critical';

export interface BurnoutSignal {
  metric: string;
  value: number;
  contribution: number;
  signal: string;
}

export interface BurnoutPrediction {
  id?: string;
  fb_ad_id: string;
  week_start_date: string;
  burnout_score: number;
  burnout_level: BurnoutLevel;
  predicted_cpr_change_1w: number;
  predicted_cpr_change_2w: number;
  top_signals: BurnoutSignal[];
  confidence: number;
  // Joined fields
  ad_name?: string;
  adset_name?: string;
  campaign_name?: string;
}

export interface BurnoutPredictionsResponse {
  predictions: BurnoutPrediction[];
  total: number;
}

// ============================================================================
// RECOVERY PREDICTIONS
// ============================================================================

export type RecoveryLevel = 'unlikely' | 'possible' | 'likely' | 'very_likely';
export type AdStatus = 'healthy' | 'degraded' | 'burned_out';

export interface RecoveryPrediction {
  fb_ad_id: string;
  week_start_date: string;
  recovery_score: number;
  recovery_level: RecoveryLevel;
  current_status: AdStatus;
  predicted_cpr_change_1w: number;
  predicted_cpr_change_2w: number;
  top_signals: BurnoutSignal[];
  confidence: number;
  // Joined fields
  ad_name?: string;
}

export interface RecoveryPredictionsResponse {
  predictions: RecoveryPrediction[];
  total: number;
}

// ============================================================================
// DECAY + RECOVERY COMBINED
// ============================================================================

export interface DecayRecoveryAnalysis {
  fb_ad_id: string;
  ad_name?: string;
  status: AdStatus;
  decay: {
    score: number;
    level: BurnoutLevel;
  } | null;
  recovery: {
    score: number;
    level: RecoveryLevel;
  } | null;
  recommendation: string;
}

export interface DecayRecoveryResponse {
  analysis: DecayRecoveryAnalysis[];
}

// ============================================================================
// WEEKLY INSIGHTS
// ============================================================================

export interface WeeklyInsight {
  id: string;
  ad_account_id: string;
  fb_ad_id: string;
  fb_adset_id?: string;
  fb_campaign_id?: string;
  week_start_date: string;
  impressions: number;
  clicks: number;
  spend: number;
  results: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cpr: number;
  frequency: number;
  reach: number;
  quality_ranking?: string;
  engagement_ranking?: string;
  conversion_ranking?: string;
  quality_rank_score?: number;
  engagement_rank_score?: number;
  conversion_rank_score?: number;
}

// ============================================================================
// YEARLY AUDIT
// ============================================================================

export interface ParetoAnalysis {
  top20pct_ads: number;
  top20pct_results: number;
  top20pct_results_share: number;
  bottom80pct_ads: number;
  bottom80pct_results: number;
}

export interface WeekSummary {
  week: string;
  results: number;
  cpr: number;
  spend?: number;
}

export interface WasteAnalysis {
  zeroResultsSpend: number;
  highCprSpend: number;
  totalWaste: number;
  wastePercentage: number;
}

export interface StabilityAnalysis {
  avgWeeklyVariation: number;
  maxDrawdown: number;
  consistentWeeks: number;
}

export interface YearlyAudit {
  year: number;
  pareto: ParetoAnalysis;
  bestWeeks: WeekSummary[];
  worstWeeks: WeekSummary[];
  waste: WasteAnalysis;
  stability: StabilityAnalysis;
}

// ============================================================================
// TRACKING HEALTH
// ============================================================================

export type TrackingIssueType = 'clicks_no_results' | 'results_dropped' | 'high_volatility';
export type TrackingStatus = 'healthy' | 'warning' | 'critical';

export interface TrackingIssue {
  fb_ad_id: string;
  ad_name?: string;
  issue_type: TrackingIssueType;
  severity: AnomalySeverity;
  details: {
    clicks?: number;
    results?: number;
    weeks_affected?: number;
    drop_percentage?: number;
    volatility?: number;
  };
}

export interface TrackingHealthResponse {
  overallHealth: number;
  status: TrackingStatus;
  issues: TrackingIssue[];
  recommendations: string[];
}

// ============================================================================
// LAG DEPENDENCY STATS
// ============================================================================

export interface LagDependencyStat {
  id: string;
  ad_account_id: string;
  lead_metric: string;
  lag_metric: string;
  optimal_lag: number;
  correlation: number;
  sample_size: number;
  prediction_type: 'decay' | 'recovery';
}

// ============================================================================
// SYNC
// ============================================================================

export interface SyncResponse {
  success: boolean;
  accountId: string;
  weeksProcessed?: number;
  adsProcessed?: number;
  error?: string;
}

// ============================================================================
// DASHBOARD STATS
// ============================================================================

export interface AdInsightsDashboardStats {
  totalAds: number;
  activeAnomalies: number;
  criticalAnomalies: number;
  highBurnoutAds: number;
  recoveryPotentialAds: number;
  trackingHealthScore: number;
  lastSyncDate?: string;
}

// ============================================================================
// PATTERNS ANALYSIS (Cross-Account)
// ============================================================================

/**
 * Query params для patterns endpoints
 */
export interface PatternsQueryParams {
  granularity?: 'month' | 'week';
  result_family?: string;
  optimization_goal?: string;
  from?: string;
  to?: string;
  min_eligible?: number;
}

/**
 * Bucket сезонности (месяц или неделя)
 */
export interface SeasonalityBucket {
  bucket: string;              // "2024-01" или "2024-W12"
  eligible_count: number;      // Всего eligible ad-weeks
  anomaly_count: number;       // Аномалий
  anomaly_rate: number;        // rate = anomalies / eligible (в %)
  avg_delta_pct: number | null;// Средний delta_pct аномалий
  is_elevated: boolean;        // rate > avg + 1σ
}

/**
 * Summary сезонности
 */
export interface SeasonalitySummary {
  total_eligible: number;
  total_anomalies: number;
  avg_rate: number;            // Средний rate (в %)
  rate_stddev: number;         // Стандартное отклонение rate
}

/**
 * Ответ endpoint /patterns/seasonality
 */
export interface SeasonalityResponse {
  success: boolean;
  buckets: SeasonalityBucket[];
  summary: SeasonalitySummary;
}

/**
 * Статистика по одной метрике
 */
export interface PatternMetricStats {
  metric: string;              // frequency, ctr, cpm, etc.
  occurrences: number;         // Сколько раз метрика была в deviations
  significant_count: number;   // Сколько раз is_significant = true
  significant_pct: number;     // % от total_anomalies
  avg_delta_pct: number;       // Средний delta от baseline
  direction_breakdown: {
    bad: number;               // Ухудшение (рост freq, падение ctr)
    good: number;              // Улучшение
    neutral: number;           // Нейтрально
  };
}

/**
 * Ответ endpoint /patterns/metrics
 */
export interface MetricsResponse {
  success: boolean;
  total_anomalies: number;
  week_0: PatternMetricStats[];
  week_minus_1: PatternMetricStats[];
  week_minus_2: PatternMetricStats[];
}

/**
 * Топ предвестник
 */
export interface TopPrecursor {
  metric: string;
  week_offset: string;         // week_minus_1 или week_minus_2
  significant_pct: number;     // % аномалий где эта метрика significant
  avg_delta_pct: number;
  direction: string;           // преобладающее направление
}

/**
 * Breakdown по result_family
 */
export interface FamilyBreakdownItem {
  result_family: string;
  eligible_count: number;
  anomaly_count: number;
  anomaly_rate: number;
}

/**
 * Breakdown по ad account
 */
export interface AccountBreakdownItem {
  account_id: string;
  fb_account_id: string;
  account_name: string;
  anomaly_count: number;
  pct_of_total: number;
}

/**
 * Ответ endpoint /patterns/summary
 */
export interface PatternsSummaryResponse {
  success: boolean;
  total_anomalies: number;
  total_eligible_weeks: number;
  overall_anomaly_rate: number;
  top_month: {
    bucket: string;
    anomaly_count: number;
    anomaly_rate: number;
  };
  top_precursors: TopPrecursor[];
  family_breakdown: FamilyBreakdownItem[];
  account_breakdown: AccountBreakdownItem[];
  period: {
    from: string | null;
    to: string | null;
  };
}
