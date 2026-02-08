// API для ручного запуска рекламы
// Документация: см. BACKEND_MANUAL_LAUNCH_SPEC.md
import { API_BASE_URL } from '@/config/api';

export interface ManualLaunchRequest {
  user_account_id: string;
  account_id?: string; // UUID рекламного аккаунта для мультиаккаунтности, undefined для legacy
  direction_id: string;
  creative_ids: string[];
  platform?: 'facebook' | 'tiktok';
  daily_budget_cents?: number;
  daily_budget?: number;
  objective?: 'traffic' | 'conversions' | 'lead_generation' | 'reach' | 'video_views';
  start_mode?: 'now' | 'midnight_almaty';
  targeting?: {
    geo_locations?: {
      countries?: string[];
      cities?: Array<{ key: string }>;
    };
    age_min?: number;
    age_max?: number;
    genders?: number[];
  };
}

export interface ManualLaunchResponse {
  success: boolean;
  message?: string;
  direction_id?: string;
  direction_name?: string;
  campaign_id?: string;
  adset_id?: string;
  adset_name?: string;
  adgroup_id?: string;
  tiktok_adgroup_id?: string;
  mode?: 'use_existing' | 'create_new';
  ads_created?: number;
  ads?: Array<{
    ad_id: string;
    name: string;
  }>;
  error?: string;
  error_hint?: string;
  error_details?: string;
}

/**
 * Запуск рекламы с выбранными креативами в рамках направления
 */
// === Multi Ad Set Launch ===

export interface MultiAdSetLaunchRequest {
  user_account_id: string;
  account_id?: string;
  direction_id: string;
  platform?: 'facebook' | 'tiktok';
  start_mode?: 'now' | 'midnight_almaty';
  objective?: string;
  adsets: Array<{
    creative_ids: string[];
    daily_budget_cents?: number;
    daily_budget?: number;
  }>;
}

export interface AdSetResult {
  success: boolean;
  adset_id?: string;
  adset_name?: string;
  ads_created?: number;
  ads?: Array<{ ad_id: string; name: string }>;
  error?: string;
}

export interface MultiAdSetLaunchResponse {
  success: boolean;
  message?: string;
  direction_id?: string;
  direction_name?: string;
  campaign_id?: string;
  total_adsets: number;
  total_ads: number;
  success_count: number;
  failed_count: number;
  adsets: AdSetResult[];
  error?: string;
}

/**
 * Запуск рекламы с несколькими Ad Sets
 */
export async function manualLaunchMultiAdSets(
  request: MultiAdSetLaunchRequest
): Promise<MultiAdSetLaunchResponse> {
  try {
    const isTikTok = request.platform === 'tiktok';
    const endpoint = isTikTok
      ? '/tiktok-campaign-builder/manual-launch-multi'
      : '/campaign-builder/manual-launch-multi';

    const payload = isTikTok
      ? {
          user_account_id: request.user_account_id,
          account_id: request.account_id ?? null,
          direction_id: request.direction_id,
          objective: request.objective,
          adsets: request.adsets.map(a => ({
            creative_ids: a.creative_ids,
            daily_budget: a.daily_budget,
          })),
        }
      : {
          user_account_id: request.user_account_id,
          account_id: request.account_id ?? null,
          direction_id: request.direction_id,
          start_mode: request.start_mode,
          adsets: request.adsets.map(a => ({
            creative_ids: a.creative_ids,
            daily_budget_cents: a.daily_budget_cents,
          })),
        };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      if (data && typeof data === 'object' && data.error) {
        return { success: false, total_adsets: 0, total_ads: 0, success_count: 0, failed_count: 0, adsets: [], ...data };
      }
      throw new Error(data.error || 'Failed to launch ads');
    }

    return data;
  } catch (error: any) {
    console.error('Manual launch multi error:', error);
    return {
      success: false,
      error: error.message || 'Ошибка запуска рекламы',
      total_adsets: 0,
      total_ads: 0,
      success_count: 0,
      failed_count: 0,
      adsets: [],
    };
  }
}

/**
 * Запуск рекламы с выбранными креативами в рамках направления (одиночный адсет)
 */
export async function manualLaunchAds(
  request: ManualLaunchRequest
): Promise<ManualLaunchResponse> {
  try {
    const isTikTok = request.platform === 'tiktok';
    const endpoint = isTikTok
      ? '/tiktok-campaign-builder/manual-launch'
      : '/campaign-builder/manual-launch';
    const payload = isTikTok
      ? {
          user_account_id: request.user_account_id,
          account_id: request.account_id ?? null,
          direction_id: request.direction_id,
          creative_ids: request.creative_ids,
          daily_budget: request.daily_budget,
          objective: request.objective,
        }
      : {
          user_account_id: request.user_account_id,
          account_id: request.account_id ?? null,
          direction_id: request.direction_id,
          creative_ids: request.creative_ids,
          daily_budget_cents: request.daily_budget_cents,
          start_mode: request.start_mode,
          targeting: request.targeting,
        };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      // Возвращаем структурированный ответ ошибки от бэкенда (с error_hint и т.д.)
      if (data && typeof data === 'object' && data.error) {
        return { success: false, ...data };
      }
      throw new Error(data.error || 'Failed to launch ads');
    }

    return data;
  } catch (error: any) {
    console.error('Manual launch error:', error);
    return {
      success: false,
      error: error.message || 'Ошибка запуска рекламы',
    };
  }
}
