/**
 * TikTok Settings Helper
 *
 * Конвертация настроек таргетинга для TikTok Marketing API
 * Аналог settingsHelpers.ts для Facebook
 */

import { supabase } from './supabase.js';

const TIKTOK_MIN_DAILY_BUDGET = 2500;

// ============================================================
// LOCATION MAPPINGS
// ============================================================

/**
 * Маппинг стран на TikTok location_ids
 * TikTok использует числовые ID вместо ISO кодов
 */
export const COUNTRY_LOCATION_IDS: Record<string, string> = {
  // Проверенные TikTok location_ids (из TikTok API /tool/region/)
  'KZ': '1522867', // Казахстан
  // TODO: остальные страны верифицировать через TikTok API /tool/region/
};

/**
 * Маппинг городов Казахстана на TikTok location_ids
 */
export const KZ_CITY_LOCATION_IDS: Record<string, string> = {
  // Проверенные TikTok location_ids (из VideoUpload.tsx legacy + TikTok API)
  'Алматы': '94600135',
  'Almaty': '94600135',
  'алматы': '94600135',

  'Астана': '1526273',
  'Astana': '1526273',
  'астана': '1526273',
  'Нур-Султан': '1526273',

  'Шымкент': '94600024',
  'Shymkent': '94600024',
  'шымкент': '94600024',

  'Караганда': '609655',
  'Karaganda': '609655',
  'караганда': '609655',

  'Актобе': '610611',
  'Aktobe': '610611',
  'актобе': '610611',

  'Атырау': '610529',
  'Atyrau': '610529',
  'атырау': '610529',

  'Павлодар': '94600073',
  'Pavlodar': '94600073',
  'павлодар': '94600073',

  'Семей': '1519422',
  'Semey': '1519422',
  'семей': '1519422',

  'Усть-Каменогорск': '1520316',
  'Ust-Kamenogorsk': '1520316',

  'Тараз': '1516905',
  'Taraz': '1516905',
  'тараз': '1516905',

  'Костанай': '94600118',
  'Kostanay': '94600118',
  'костанай': '94600118',

  'Кызылорда': '94600065',
  'Kyzylorda': '94600065',

  'Актау': '610612',
  'Aktau': '610612',
  'актау': '610612',
};

// ============================================================
// AGE GROUP MAPPINGS
// ============================================================

/**
 * TikTok использует специфические age_groups
 */
export const TIKTOK_AGE_GROUPS = [
  'AGE_13_17',
  'AGE_18_24',
  'AGE_25_34',
  'AGE_35_44',
  'AGE_45_54',
  'AGE_55_100'
];

/**
 * Конвертировать возрастной диапазон в TikTok age_groups
 */
export function convertAgeToTikTokGroups(ageMin: number, ageMax: number): string[] {
  const groups: string[] = [];

  if (ageMin <= 17 && ageMax >= 13) groups.push('AGE_13_17');
  if (ageMin <= 24 && ageMax >= 18) groups.push('AGE_18_24');
  if (ageMin <= 34 && ageMax >= 25) groups.push('AGE_25_34');
  if (ageMin <= 44 && ageMax >= 35) groups.push('AGE_35_44');
  if (ageMin <= 54 && ageMax >= 45) groups.push('AGE_45_54');
  if (ageMax >= 55) groups.push('AGE_55_100');

  return groups.length > 0 ? groups : TIKTOK_AGE_GROUPS; // Все группы если не указано
}

// ============================================================
// OBJECTIVE MAPPINGS
// ============================================================

export type TikTokObjective = 'TRAFFIC' | 'CONVERSIONS' | 'REACH' | 'VIDEO_VIEWS' | 'LEAD_GENERATION' | 'APP_PROMOTION';
export type TikTokOptimizationGoal = 'CLICK' | 'CONVERT' | 'REACH' | 'VIDEO_VIEW' | 'LEAD_GENERATION';
export type TikTokBillingEvent = 'CPC' | 'CPM' | 'OCPM' | 'CPA';

/**
 * Маппинг objectives
 */
export const OBJECTIVE_MAPPING: Record<string, {
  objective_type: TikTokObjective;
  optimization_goal: TikTokOptimizationGoal;
  billing_event: TikTokBillingEvent;
  promotion_type: string;
}> = {
  'traffic': {
    objective_type: 'TRAFFIC',
    optimization_goal: 'CLICK',
    billing_event: 'CPC',
    promotion_type: 'WEBSITE'
  },
  'conversions': {
    objective_type: 'CONVERSIONS',
    optimization_goal: 'CONVERT',
    billing_event: 'OCPM',
    promotion_type: 'WEBSITE'
  },
  'reach': {
    objective_type: 'REACH',
    optimization_goal: 'REACH',
    billing_event: 'CPM',
    promotion_type: 'WEBSITE'
  },
  'video_views': {
    objective_type: 'VIDEO_VIEWS',
    optimization_goal: 'VIDEO_VIEW',
    billing_event: 'CPM',
    promotion_type: 'WEBSITE'
  },
  'lead_generation': {
    objective_type: 'LEAD_GENERATION',
    optimization_goal: 'LEAD_GENERATION',
    billing_event: 'OCPM',
    promotion_type: 'LEAD_GENERATION'
  }
};

/**
 * Получить TikTok objective config
 */
export function getTikTokObjectiveConfig(objective: string) {
  const config = OBJECTIVE_MAPPING[objective.toLowerCase()];
  if (!config) {
    // Дефолт - traffic
    return OBJECTIVE_MAPPING['traffic'];
  }
  return config;
}

// ============================================================
// TARGETING CONVERSION
// ============================================================

export interface TikTokTargeting {
  location_ids: (string | number)[];
  age_groups?: string[];
  gender?: 'GENDER_MALE' | 'GENDER_FEMALE' | 'GENDER_UNLIMITED';
  languages?: string[];
}

/**
 * Конвертировать настройки из Supabase в TikTok targeting
 */
export function convertToTikTokTargeting(settings: any): TikTokTargeting {
  const targeting: TikTokTargeting = {
    location_ids: []
  };

  // 1. Конвертируем geo_locations
  if (settings.cities && Array.isArray(settings.cities)) {
    for (const city of settings.cities) {
      // Если это код страны (2 буквы)
      if (typeof city === 'string' && city.length === 2 && city === city.toUpperCase()) {
        const locationId = COUNTRY_LOCATION_IDS[city];
        if (locationId) {
          targeting.location_ids.push(locationId);
        }
      }
      // Если это название города Казахстана
      else if (typeof city === 'string') {
        const locationId = KZ_CITY_LOCATION_IDS[city];
        if (locationId) {
          targeting.location_ids.push(locationId);
        }
      }
      // Если это уже числовой ID
      else if (typeof city === 'number') {
        targeting.location_ids.push(city);
      }
    }
  }

  // Дефолт - Казахстан
  if (targeting.location_ids.length === 0) {
    targeting.location_ids = [COUNTRY_LOCATION_IDS['KZ']];
  }

  // 2. Конвертируем возраст
  const ageMin = settings.age_min || 18;
  const ageMax = settings.age_max || 65;
  targeting.age_groups = convertAgeToTikTokGroups(ageMin, ageMax);

  // 3. Конвертируем пол
  if (settings.gender === 'male') {
    targeting.gender = 'GENDER_MALE';
  } else if (settings.gender === 'female') {
    targeting.gender = 'GENDER_FEMALE';
  } else {
    targeting.gender = 'GENDER_UNLIMITED';
  }

  // 4. Языки (опционально)
  if (settings.languages && Array.isArray(settings.languages)) {
    targeting.languages = settings.languages;
  }

  return targeting;
}

// ============================================================
// SETTINGS HELPERS
// ============================================================

/**
 * Получить настройки направления для TikTok
 */
export async function getTikTokDirectionSettings(
  directionId: string,
  userAccountId: string
): Promise<{
  targeting: TikTokTargeting;
  daily_budget: number;
  objective_config: ReturnType<typeof getTikTokObjectiveConfig>;
  pixel_id?: string;
  identity_id?: string;
} | null> {
  // Получаем direction
  const { data: direction, error: dirError } = await supabase
    .from('account_directions')
    .select('*, default_ad_settings(*)')
    .eq('id', directionId)
    .eq('user_account_id', userAccountId)
    .single();

  if (dirError || !direction) {
    return null;
  }

  // Получаем настройки
  const settings = direction.default_ad_settings?.[0] || {};

  // Конвертируем targeting
  const targeting = convertToTikTokTargeting(settings);

  // Получаем objective config
  const objective = direction.tiktok_objective || direction.objective || 'traffic';
  const objective_config = getTikTokObjectiveConfig(objective);

  const daily_budget = direction.tiktok_daily_budget ?? TIKTOK_MIN_DAILY_BUDGET;

  return {
    targeting,
    daily_budget,
    objective_config,
    pixel_id: settings.tiktok_pixel_id,
    identity_id: direction.tiktok_identity_id
  };
}

/**
 * Получить TikTok credentials из user_accounts или ad_accounts
 */
export async function getTikTokCredentials(
  userAccountId: string,
  accountId?: string
): Promise<{
  accessToken: string;
  advertiserId: string;
  identityId?: string;
} | null> {
  // Проверяем multi-account режим
  const { data: user } = await supabase
    .from('user_accounts')
    .select('multi_account_enabled, tiktok_access_token, tiktok_business_id, tiktok_account_id')
    .eq('id', userAccountId)
    .single();

  if (!user) return null;

  if (user.multi_account_enabled && accountId) {
    // Multi-account режим
    const { data: adAccount } = await supabase
      .from('ad_accounts')
      .select('tiktok_access_token, tiktok_business_id, tiktok_account_id')
      .eq('id', accountId)
      .eq('user_account_id', userAccountId)
      .single();

    if (!adAccount?.tiktok_access_token || !adAccount?.tiktok_business_id) {
      return null;
    }

    return {
      accessToken: adAccount.tiktok_access_token,
      advertiserId: adAccount.tiktok_business_id,
      identityId: adAccount.tiktok_account_id
    };
  }

  // Legacy режим
  if (!user.tiktok_access_token || !user.tiktok_business_id) {
    return null;
  }

  return {
    accessToken: user.tiktok_access_token,
    advertiserId: user.tiktok_business_id,
    identityId: user.tiktok_account_id
  };
}

export default {
  convertToTikTokTargeting,
  getTikTokObjectiveConfig,
  getTikTokDirectionSettings,
  getTikTokCredentials,
  convertAgeToTikTokGroups,
  COUNTRY_LOCATION_IDS,
  KZ_CITY_LOCATION_IDS,
  TIKTOK_AGE_GROUPS,
  OBJECTIVE_MAPPING
};
