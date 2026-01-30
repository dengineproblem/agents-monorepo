/**
 * Budget Forecast API Client
 *
 * API клиент для прогнозирования бюджета рекламы
 */

import { API_BASE_URL } from '@/config/api';
import { getCachedData, setCachedData } from '@/utils/apiCache';
import type { CampaignForecastResponse, AdForecast } from '@/types/budgetForecast';

const CACHE_TTL_MINUTES = 10;

/**
 * Получить user ID из localStorage
 */
function getUserId(): string | null {
  try {
    const user = localStorage.getItem('user');
    if (!user) return null;
    return JSON.parse(user).id;
  } catch {
    return null;
  }
}

/**
 * Получить текущий ad_account_id
 */
function getCurrentAccountId(): string | null {
  try {
    // Сначала пробуем multi-account mode
    const multiAccountData = localStorage.getItem('multiAccountData');
    if (multiAccountData) {
      const data = JSON.parse(multiAccountData);
      const activeAccount = data.adAccounts?.find((a: { is_active: boolean }) => a.is_active);
      if (activeAccount) return activeAccount.id;
    }

    // Fallback на legacy mode
    const user = localStorage.getItem('user');
    if (user) {
      const userData = JSON.parse(user);
      return userData.ad_account_id || null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Выполнить fetch с авторизацией
 */
async function fetchWithAuth(url: string): Promise<Response> {
  const userId = getUserId();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (userId) {
    headers['x-user-id'] = userId;
  }

  return fetch(url, { headers });
}

export const budgetForecastApi = {
  /**
   * Получить прогноз для кампании
   */
  async getCampaignForecast(
    campaignId: string,
    accountId?: string
  ): Promise<CampaignForecastResponse | null> {
    const effectiveAccountId = accountId || getCurrentAccountId();
    const cacheKey = `budget_forecast_campaign_${campaignId}_${effectiveAccountId}`;

    // Проверяем кэш
    const cached = getCachedData<CampaignForecastResponse>(cacheKey);
    if (cached) {
      console.log('[BudgetForecastApi] Returning cached campaign forecast');
      return cached;
    }

    try {
      const params = effectiveAccountId ? `?accountId=${effectiveAccountId}` : '';
      const url = `${API_BASE_URL}/budget-forecast/campaign/${campaignId}${params}`;

      console.log('[BudgetForecastApi] Fetching campaign forecast:', url);
      const res = await fetchWithAuth(url);

      if (!res.ok) {
        console.error('[BudgetForecastApi] Error:', res.status, await res.text());
        return null;
      }

      const data = await res.json();

      // Сохраняем в кэш
      setCachedData(cacheKey, data, CACHE_TTL_MINUTES);

      return data;
    } catch (error) {
      console.error('[BudgetForecastApi.getCampaignForecast] Error:', error);
      return null;
    }
  },

  /**
   * Получить прогноз для объявления
   */
  async getAdForecast(
    adId: string,
    accountId?: string
  ): Promise<AdForecast | null> {
    const effectiveAccountId = accountId || getCurrentAccountId();
    const cacheKey = `budget_forecast_ad_${adId}_${effectiveAccountId}`;

    // Проверяем кэш
    const cached = getCachedData<AdForecast>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const params = effectiveAccountId ? `?accountId=${effectiveAccountId}` : '';
      const url = `${API_BASE_URL}/budget-forecast/ad/${adId}${params}`;

      const res = await fetchWithAuth(url);

      if (!res.ok) {
        console.error('[BudgetForecastApi] Error:', res.status);
        return null;
      }

      const data = await res.json();

      // Сохраняем в кэш
      setCachedData(cacheKey, data, CACHE_TTL_MINUTES);

      return data;
    } catch (error) {
      console.error('[BudgetForecastApi.getAdForecast] Error:', error);
      return null;
    }
  },

  /**
   * Инвалидировать кэш для кампании
   */
  invalidateCampaignCache(campaignId: string): void {
    const accountId = getCurrentAccountId();
    const cacheKey = `budget_forecast_campaign_${campaignId}_${accountId}`;
    localStorage.removeItem(cacheKey);
  },
};
