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
  DecayRecoveryResponse,
  LagDependencyStat,
  RecoveryPrediction,
  RecoveryPredictionsResponse,
  SyncResponse,
  TrackingHealthResponse,
  YearlyAudit,
  AdInsightsDashboardStats,
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
      const res = await fetchWithAuth(url, { method: 'POST' });

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
   */
  async getDecayRecoveryAnalysis(accountId: string): Promise<DecayRecoveryResponse> {
    try {
      const url = `${API_BASE_URL}/admin/ad-insights/${accountId}/decay-recovery`;
      const res = await fetchWithAuth(url);

      if (!res.ok) {
        console.error('[adInsightsApi.getDecayRecoveryAnalysis] HTTP error:', res.status);
        return { analysis: [] };
      }

      return await res.json();
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
   */
  async getYearlyAudit(accountId: string, year?: number): Promise<YearlyAudit | null> {
    try {
      const params = new URLSearchParams();
      if (year) params.set('year', String(year));

      const url = `${API_BASE_URL}/admin/ad-insights/${accountId}/yearly/audit?${params}`;
      const res = await fetchWithAuth(url);

      if (!res.ok) return null;
      return await res.json();
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
};
