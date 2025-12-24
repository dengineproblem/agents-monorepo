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
