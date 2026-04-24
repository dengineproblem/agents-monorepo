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
    optimization_goal_override?: string;
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
            optimization_goal_override: a.optimization_goal_override,
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

// === Existing AdSets Mode (добавление креативов в живые адсеты) ===

export interface ActiveAdsetInfo {
  fb_adset_id: string;
  name: string;
  daily_budget: number | null; // в центах (FB возвращает строкой — мы парсим в number)
  optimization_goal: string | null;
  ads_count: number; // сколько ads уже учтено в direction_adsets (0 если адсета нет в БД)
}

export interface ActiveAdsetsResponse {
  success: boolean;
  adsets: ActiveAdsetInfo[];
  error?: string;
}

/**
 * Возвращает live-список активных адсетов кампании направления (effective_status=ACTIVE).
 * Обогащается ads_count из direction_adsets (0 если запись отсутствует).
 */
export async function getDirectionActiveAdsets(
  directionId: string,
  accountId?: string | null
): Promise<ActiveAdsetsResponse> {
  try {
    const params = new URLSearchParams();
    if (accountId) params.set('account_id', accountId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(
      `${API_BASE_URL}/campaign-builder/direction/${directionId}/active-adsets${qs}`,
      { method: 'GET' }
    );
    const data = await response.json();
    if (!response.ok) {
      return { success: false, adsets: [], error: data?.error || 'Failed to fetch active adsets' };
    }
    return data;
  } catch (error: any) {
    console.error('Failed to fetch active adsets:', error);
    return { success: false, adsets: [], error: error.message || 'Failed to fetch active adsets' };
  }
}

export interface LaunchExistingRequest {
  user_account_id: string;
  account_id?: string | null;
  direction_id: string;
  creative_ids: string[];
  target_adset_ids: string[];
}

export interface LaunchExistingResponse {
  success: boolean;
  message?: string;
  direction_id?: string;
  direction_name?: string;
  campaign_id?: string;
  adsets_used?: number;
  total_ads?: number;
  failed_count?: number;
  results?: Array<{
    fb_adset_id: string;
    adset_name: string | null;
    ads_created: number;
    ads: Array<{ ad_id: string; user_creative_id: string }>;
  }>;
  error?: string;
}

/**
 * Добавляет выбранные креативы как новые Ads в уже существующие активные адсеты.
 * Настройки самих адсетов (бюджет/таргетинг) НЕ меняются.
 */
export async function manualLaunchExisting(
  request: LaunchExistingRequest
): Promise<LaunchExistingResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/campaign-builder/manual-launch-existing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_account_id: request.user_account_id,
        account_id: request.account_id ?? null,
        direction_id: request.direction_id,
        creative_ids: request.creative_ids,
        target_adset_ids: request.target_adset_ids,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (data && typeof data === 'object' && data.error) {
        return { success: false, ...data };
      }
      throw new Error(data.error || 'Failed to launch ads in existing adsets');
    }
    return data;
  } catch (error: any) {
    console.error('Manual launch existing error:', error);
    return { success: false, error: error.message || 'Ошибка запуска рекламы в существующих адсетах' };
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
