/**
 * Budget Forecast Types
 *
 * Типы для прогнозирования бюджета рекламы
 */

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
      delta_10: WeeklyForecast[];
      delta_20: WeeklyForecast[];
      delta_30: WeeklyForecast[];
      delta_50: WeeklyForecast[];
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

// Типы для UI
export type ScalingDelta = 'no_change' | 'delta_10' | 'delta_20' | 'delta_30' | 'delta_50';

export const DELTA_LABELS: Record<ScalingDelta, string> = {
  no_change: 'Без изменений',
  delta_10: '+10%',
  delta_20: '+20%',
  delta_30: '+30%',
  delta_50: '+50%',
};

export const DELTA_VALUES: Record<ScalingDelta, number> = {
  no_change: 0,
  delta_10: 0.1,
  delta_20: 0.2,
  delta_30: 0.3,
  delta_50: 0.5,
};
