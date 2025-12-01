// API для ручного запуска рекламы
// Документация: см. BACKEND_MANUAL_LAUNCH_SPEC.md
import { API_BASE_URL } from '@/config/api';

export interface ManualLaunchRequest {
  user_account_id: string;
  account_id?: string; // UUID рекламного аккаунта для мультиаккаунтности, undefined для legacy
  direction_id: string;
  creative_ids: string[];
  daily_budget_cents?: number;
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
  ads_created?: number;
  ads?: Array<{
    ad_id: string;
    name: string;
  }>;
  error?: string;
  error_details?: string;
}

/**
 * Запуск рекламы с выбранными креативами в рамках направления
 */
export async function manualLaunchAds(
  request: ManualLaunchRequest
): Promise<ManualLaunchResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/campaign-builder/manual-launch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    const data = await response.json();

    if (!response.ok) {
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

