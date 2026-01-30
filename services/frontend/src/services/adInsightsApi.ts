/**
 * Ad Insights API Client
 *
 * Клиент для работы с API аналитики рекламы
 */

import { API_BASE_URL } from '@/config/api';
import type {
  AnomaliesResponse,
  AnomalySeverity,
  AnomalyType,
  BurnoutPrediction,
  BurnoutPredictionsResponse,
  DecayRecoveryAnalysis,
  DecayRecoveryResponse,
  LagDependencyStat,
  RecoveryPrediction,
  RecoveryPredictionsResponse,
  SyncResponse,
  TrackingHealthResponse,
  YearlyAudit,
  AdInsightsDashboardStats,
  // Patterns types
  PatternsQueryParams,
  SeasonalityResponse,
  MetricsResponse,
  PatternsSummaryResponse,
} from '@/types/adInsights';

/**
 * Получить userId из localStorage
 */
function getUserId(): string | null {
  const user = localStorage.getItem('user');
  if (!user) return null;
  try {
    return JSON.parse(user).id;
  } catch {
    return null;
  }
}

/**
 * Базовый fetch с userId header
 */
async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const userId = getUserId();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (userId) {
    headers['x-user-id'] = userId;
  }

  return fetch(url, { ...options, headers });
}

export const adInsightsApi = {
  // ============================================================================
  // SYNC
  // ============================================================================

  /**
   * Запуск полной синхронизации для аккаунта
   */
  async sync(
    accountId: string,
    options?: { weeks?: number; includeCampaigns?: boolean; includeAdsets?: boolean }
  ): Promise<SyncResponse> {
    try {
      const params = new URLSearchParams();
      if (options?.weeks) params.set('weeks', String(options.weeks));
      if (options?.includeCampaigns) params.set('includeCampaigns', 'true');
      if (options?.includeAdsets) params.set('includeAdsets', 'true');

      const url = `${API_BASE_URL}/admin/ad-insights/${accountId}/sync?${params}`;
      const res = await fetchWithAuth(url, { method: 'POST', body: '{}' });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        return { success: false, accountId, error: error.error || `HTTP ${res.status}` };
      }

      return await res.json();
    } catch (error) {
      console.error('[adInsightsApi.sync] Error:', error);
      return { success: false, accountId, error: 'Network error' };
    }
  },

  // ============================================================================
  // ANOMALIES
  // ============================================================================

  /**
   * Получить список аномалий
   */
  async getAnomalies(
    accountId: string,
    options?: { severity?: AnomalySeverity; type?: AnomalyType; limit?: number; acknowledged?: boolean }
  ): Promise<AnomaliesResponse> {
    try {
      const params = new URLSearchParams();
      if (options?.severity) params.set('severity', options.severity);
      if (options?.type) params.set('type', options.type);
      if (options?.limit) params.set('limit', String(options.limit));
      if (options?.acknowledged !== undefined) params.set('acknowledged', String(options.acknowledged));

      const url = `${API_BASE_URL}/admin/ad-insights/${accountId}/anomalies?${params}`;
      const res = await fetchWithAuth(url);

      if (!res.ok) {
        console.error('[adInsightsApi.getAnomalies] HTTP error:', res.status);
        return { anomalies: [], total: 0 };
      }

      return await res.json();
    } catch (error) {
      console.error('[adInsightsApi.getAnomalies] Error:', error);
      return { anomalies: [], total: 0 };
    }
  },

  /**
   * Подтвердить (скрыть) аномалию
   */
  async acknowledgeAnomaly(accountId: string, anomalyId: string): Promise<boolean> {
    try {
      const url = `${API_BASE_URL}/admin/ad-insights/${accountId}/anomalies/${anomalyId}/acknowledge`;
      const res = await fetchWithAuth(url, { method: 'POST' });
      return res.ok;
    } catch (error) {
      console.error('[adInsightsApi.acknowledgeAnomaly] Error:', error);
      return false;
    }
  },

  // ============================================================================
  // BURNOUT / DECAY
  // ============================================================================

  /**
   * Получить прогнозы выгорания
   */
  async getBurnoutPredictions(
    accountId: string,
    options?: { minScore?: number; level?: string }
  ): Promise<BurnoutPredictionsResponse> {
    try {
      const params = new URLSearchParams();
      if (options?.minScore) params.set('minScore', String(options.minScore));
      if (options?.level) params.set('level', options.level);

      const url = `${API_BASE_URL}/admin/ad-insights/${accountId}/burnout/predictions?${params}`;
      const res = await fetchWithAuth(url);

      if (!res.ok) {
        console.error('[adInsightsApi.getBurnoutPredictions] HTTP error:', res.status);
        return { predictions: [], total: 0 };
      }

      return await res.json();
    } catch (error) {
      console.error('[adInsightsApi.getBurnoutPredictions] Error:', error);
      return { predictions: [], total: 0 };
    }
  },

  /**
   * Получить прогноз выгорания для конкретного ad
   */
  async getBurnoutPrediction(accountId: string, adId: string): Promise<BurnoutPrediction | null> {
    try {
      const url = `${API_BASE_URL}/admin/ad-insights/${accountId}/burnout/predict/${adId}`;
      const res = await fetchWithAuth(url);

      if (!res.ok) return null;
      return await res.json();
    } catch (error) {
      console.error('[adInsightsApi.getBurnoutPrediction] Error:', error);
      return null;
    }
  },

  /**
   * Получить lag dependency stats
   */
  async getLagStats(accountId: string): Promise<LagDependencyStat[]> {
    try {
      const url = `${API_BASE_URL}/admin/ad-insights/${accountId}/burnout/lag-stats`;
      const res = await fetchWithAuth(url);

      if (!res.ok) return [];
      const data = await res.json();
      return data.stats || [];
    } catch (error) {
      console.error('[adInsightsApi.getLagStats] Error:', error);
      return [];
    }
  },

  // ============================================================================
  // RECOVERY
  // ============================================================================

  /**
   * Получить прогнозы восстановления
   */
  async getRecoveryPredictions(accountId: string): Promise<RecoveryPredictionsResponse> {
    try {
      const url = `${API_BASE_URL}/admin/ad-insights/${accountId}/recovery/predictions`;
      const res = await fetchWithAuth(url);

      if (!res.ok) {
        console.error('[adInsightsApi.getRecoveryPredictions] HTTP error:', res.status);
        return { predictions: [], total: 0 };
      }

      return await res.json();
    } catch (error) {
      console.error('[adInsightsApi.getRecoveryPredictions] Error:', error);
      return { predictions: [], total: 0 };
    }
  },

  /**
   * Получить прогноз восстановления для конкретного ad
   */
  async getRecoveryPrediction(accountId: string, adId: string): Promise<RecoveryPrediction | null> {
    try {
      const url = `${API_BASE_URL}/admin/ad-insights/${accountId}/recovery/predict/${adId}`;
      const res = await fetchWithAuth(url);

      if (!res.ok) return null;
      return await res.json();
    } catch (error) {
      console.error('[adInsightsApi.getRecoveryPrediction] Error:', error);
      return null;
    }
  },

  /**
   * Получить комбинированный decay + recovery анализ
   * Трансформирует API ответ в формат DecayRecoveryAnalysis[]
   */
  async getDecayRecoveryAnalysis(accountId: string): Promise<DecayRecoveryResponse> {
    try {
      const url = `${API_BASE_URL}/admin/ad-insights/${accountId}/decay-recovery`;
      const res = await fetchWithAuth(url);

      if (!res.ok) {
        console.error('[adInsightsApi.getDecayRecoveryAnalysis] HTTP error:', res.status);
        return { analysis: [] };
      }

      const data = await res.json();

      // Трансформируем API ответ в DecayRecoveryAnalysis[]
      const analysisMap = new Map<string, DecayRecoveryAnalysis>();

      // Обрабатываем decay (highRiskAds)
      for (const item of data.decay?.highRiskAds || []) {
        const status = item.riskLevel === 'critical' ? 'burned_out' as const :
                       item.riskLevel === 'high' ? 'degraded' as const : 'healthy' as const;

        analysisMap.set(item.fbAdId, {
          fb_ad_id: item.fbAdId,
          ad_name: item.adName,
          status,
          decay: {
            score: item.riskScore || 0,
            level: item.riskLevel || 'low',
          },
          recovery: null,
          recommendation: item.riskLevel === 'critical'
            ? 'Рекомендуется отключить объявление'
            : item.riskLevel === 'high'
            ? 'Рекомендуется оптимизировать креатив'
            : 'Мониторинг',
        });
      }

      // Обрабатываем recovery (likelyRecoveryAds)
      for (const item of data.recovery?.likelyRecoveryAds || []) {
        const existing = analysisMap.get(item.fbAdId);
        const recoveryData = {
          score: item.recoveryScore || 0,
          level: item.recoveryLevel || 'unlikely',
        };

        if (existing) {
          existing.recovery = recoveryData;
          existing.status = item.currentStatus || existing.status;
          if (item.recoveryLevel === 'likely' || item.recoveryLevel === 'very_likely') {
            existing.recommendation = 'Высокий потенциал восстановления';
          }
        } else {
          analysisMap.set(item.fbAdId, {
            fb_ad_id: item.fbAdId,
            ad_name: item.adName,
            status: (item.currentStatus as 'healthy' | 'degraded' | 'burned_out') || 'degraded',
            decay: null,
            recovery: recoveryData,
            recommendation: item.recoveryLevel === 'likely'
              ? 'Высокий потенциал восстановления'
              : 'Возможно восстановление',
          });
        }
      }

      return { analysis: Array.from(analysisMap.values()) };
    } catch (error) {
      console.error('[adInsightsApi.getDecayRecoveryAnalysis] Error:', error);
      return { analysis: [] };
    }
  },

  // ============================================================================
  // YEARLY AUDIT
  // ============================================================================

  /**
   * Получить годовой аудит
   * Трансформирует API ответ в формат YearlyAudit
   */
  async getYearlyAudit(accountId: string, year?: number): Promise<YearlyAudit | null> {
    try {
      const params = new URLSearchParams();
      if (year) params.set('year', String(year));

      const url = `${API_BASE_URL}/admin/ad-insights/${accountId}/yearly/audit?${params}`;
      const res = await fetchWithAuth(url);

      if (!res.ok) return null;

      const data = await res.json();

      // Трансформируем API ответ в формат YearlyAudit
      const totalAds = data.pareto?.top10PctAds?.length || 0;
      const top20Count = Math.max(1, Math.ceil(totalAds * 2)); // top10 * 2 ≈ top20
      const top10PctAds = data.pareto?.top10PctAds || [];
      const totalResults = data.totals?.results || 0;
      const totalSpend = data.totals?.spend || 0;

      // Считаем top20 contribution (примерно top10 * 1.2)
      const top20ResultsShare = Math.min(100, (data.pareto?.top10PctContribution || 0) * 1.2);
      const top20Results = Math.round((top20ResultsShare / 100) * totalResults);

      return {
        year: year || new Date().getFullYear(),
        pareto: {
          top20pct_ads: top20Count,
          top20pct_results: top20Results,
          top20pct_results_share: top20ResultsShare / 100, // как дробь 0-1
          bottom80pct_ads: Math.max(0, totalAds * 10 - top20Count), // примерно
          bottom80pct_results: totalResults - top20Results,
        },
        bestWeeks: (data.bestWeeks || []).map((w: { week: string; cpr: number; spend: number; results: number }) => ({
          week: w.week,
          results: w.results,
          cpr: w.cpr,
          spend: w.spend,
        })),
        worstWeeks: (data.worstWeeks || []).map((w: { week: string; cpr: number; spend: number; results: number }) => ({
          week: w.week,
          results: w.results,
          cpr: w.cpr,
          spend: w.spend,
        })),
        waste: {
          zeroResultsSpend: data.waste?.zeroResultSpend || 0,
          highCprSpend: 0, // API не возвращает это поле отдельно
          totalWaste: data.waste?.zeroResultSpend || 0,
          wastePercentage: totalSpend > 0 ? ((data.waste?.zeroResultSpend || 0) / totalSpend) * 100 : 0,
        },
        stability: {
          avgWeeklyVariation: (100 - (data.stability?.anomalyFreeWeeksPct || 0)) / 100, // инвертируем
          maxDrawdown: (data.stability?.avgSpikePct || 0) / 100,
          consistentWeeks: Math.round((data.stability?.anomalyFreeWeeksPct || 0) / 100 * (data.totals?.weeks || 0)),
        },
      };
    } catch (error) {
      console.error('[adInsightsApi.getYearlyAudit] Error:', error);
      return null;
    }
  },

  // ============================================================================
  // TRACKING HEALTH
  // ============================================================================

  /**
   * Получить анализ tracking health
   */
  async getTrackingHealth(accountId: string): Promise<TrackingHealthResponse | null> {
    try {
      const url = `${API_BASE_URL}/admin/ad-insights/${accountId}/tracking-health`;
      const res = await fetchWithAuth(url);

      if (!res.ok) return null;
      return await res.json();
    } catch (error) {
      console.error('[adInsightsApi.getTrackingHealth] Error:', error);
      return null;
    }
  },

  // ============================================================================
  // DASHBOARD STATS
  // ============================================================================

  /**
   * Получить статистику для dashboard
   */
  async getDashboardStats(accountId: string): Promise<AdInsightsDashboardStats | null> {
    try {
      // Параллельно загружаем данные для формирования статистики
      const [anomalies, burnout, recovery, tracking] = await Promise.all([
        this.getAnomalies(accountId, { acknowledged: false, limit: 100 }),
        this.getBurnoutPredictions(accountId, { minScore: 0.5 }),
        this.getRecoveryPredictions(accountId),
        this.getTrackingHealth(accountId),
      ]);

      const criticalAnomalies = anomalies.anomalies.filter(
        (a) => a.severity === 'critical'
      ).length;

      return {
        totalAds: 0, // Заполняется из sync info
        activeAnomalies: anomalies.total,
        criticalAnomalies,
        highBurnoutAds: burnout.predictions.filter((p) => p.burnout_level === 'high' || p.burnout_level === 'critical').length,
        recoveryPotentialAds: recovery.predictions.filter((p) => p.recovery_level === 'likely' || p.recovery_level === 'very_likely').length,
        trackingHealthScore: tracking?.overallHealth ?? 100,
      };
    } catch (error) {
      console.error('[adInsightsApi.getDashboardStats] Error:', error);
      return null;
    }
  },

  // ============================================================================
  // PATTERNS ANALYSIS (Cross-Account)
  // ============================================================================

  /**
   * Получить сезонность аномалий по месяцам/неделям
   * Cross-account анализ всех аномалий
   */
  async getSeasonality(params?: PatternsQueryParams): Promise<SeasonalityResponse> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.granularity) queryParams.set('granularity', params.granularity);
      if (params?.result_family) queryParams.set('result_family', params.result_family);
      if (params?.optimization_goal) queryParams.set('optimization_goal', params.optimization_goal);
      if (params?.from) queryParams.set('from', params.from);
      if (params?.to) queryParams.set('to', params.to);
      if (params?.min_eligible) queryParams.set('min_eligible', String(params.min_eligible));

      const url = `${API_BASE_URL}/admin/ad-insights/patterns/seasonality?${queryParams}`;
      const res = await fetchWithAuth(url);

      if (!res.ok) {
        console.error('[adInsightsApi.getSeasonality] HTTP error:', res.status);
        return {
          success: false,
          buckets: [],
          summary: { total_eligible: 0, total_anomalies: 0, avg_rate: 0, rate_stddev: 0 },
        };
      }

      return await res.json();
    } catch (error) {
      console.error('[adInsightsApi.getSeasonality] Error:', error);
      return {
        success: false,
        buckets: [],
        summary: { total_eligible: 0, total_anomalies: 0, avg_rate: 0, rate_stddev: 0 },
      };
    }
  },

  /**
   * Получить статистику метрик-виновников по неделям
   * Анализ preceding_deviations для week_0, week_-1, week_-2
   */
  async getPatternsMetrics(params?: PatternsQueryParams): Promise<MetricsResponse> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.result_family) queryParams.set('result_family', params.result_family);
      if (params?.optimization_goal) queryParams.set('optimization_goal', params.optimization_goal);

      const url = `${API_BASE_URL}/admin/ad-insights/patterns/metrics?${queryParams}`;
      const res = await fetchWithAuth(url);

      if (!res.ok) {
        console.error('[adInsightsApi.getPatternsMetrics] HTTP error:', res.status);
        return {
          success: false,
          total_anomalies: 0,
          week_0: [],
          week_minus_1: [],
          week_minus_2: [],
        };
      }

      return await res.json();
    } catch (error) {
      console.error('[adInsightsApi.getPatternsMetrics] Error:', error);
      return {
        success: false,
        total_anomalies: 0,
        week_0: [],
        week_minus_1: [],
        week_minus_2: [],
      };
    }
  },

  /**
   * Получить общую сводку паттернов
   * Включает top month, top precursors, family breakdown
   */
  async getPatternsSummary(): Promise<PatternsSummaryResponse> {
    try {
      const url = `${API_BASE_URL}/admin/ad-insights/patterns/summary`;
      const res = await fetchWithAuth(url);

      if (!res.ok) {
        console.error('[adInsightsApi.getPatternsSummary] HTTP error:', res.status);
        return {
          success: false,
          total_anomalies: 0,
          total_eligible_weeks: 0,
          overall_anomaly_rate: 0,
          top_month: { bucket: '-', anomaly_count: 0, anomaly_rate: 0 },
          top_precursors: [],
          family_breakdown: [],
          period: { from: null, to: null },
        };
      }

      return await res.json();
    } catch (error) {
      console.error('[adInsightsApi.getPatternsSummary] Error:', error);
      return {
        success: false,
        total_anomalies: 0,
        total_eligible_weeks: 0,
        overall_anomaly_rate: 0,
        top_month: { bucket: '-', anomaly_count: 0, anomaly_rate: 0 },
        top_precursors: [],
        family_breakdown: [],
        period: { from: null, to: null },
      };
    }
  },
};
