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
export const COUNTRY_LOCATION_IDS: Record<string, number> = {
  // СНГ
  'KZ': 6251999, // Казахстан
  'RU': 6251994, // Россия
  'UA': 6256587, // Украина
  'BY': 6251991, // Беларусь
  'UZ': 6255147, // Узбекистан
  'AZ': 6252002, // Азербайджан
  'GE': 6254928, // Грузия
  'AM': 6252004, // Армения
  'KG': 6255012, // Кыргызстан
  'TJ': 6252005, // Таджикистан
  'TM': 6252007, // Туркменистан
  'MD': 6256596, // Молдова

  // Европа
  'DE': 6252005, // Германия
  'FR': 6252016, // Франция
  'GB': 6269131, // Великобритания
  'IT': 6252001, // Италия
  'ES': 6252009, // Испания
  'PL': 6252068, // Польша
  'NL': 6252070, // Нидерланды
  'BE': 6252071, // Бельгия
  'CZ': 6252072, // Чехия
  'AT': 6252073, // Австрия
  'CH': 6252074, // Швейцария
  'PT': 6252075, // Португалия

  // Азия
  'TR': 6252076, // Турция
  'AE': 6252077, // ОАЭ
  'SA': 6252078, // Саудовская Аравия
  'IN': 6252079, // Индия
  'ID': 6252080, // Индонезия
  'MY': 6252081, // Малайзия
  'SG': 6252082, // Сингапур
  'TH': 6252083, // Таиланд
  'VN': 6252084, // Вьетнам
  'PH': 6252085, // Филиппины
  'JP': 6252086, // Япония
  'KR': 6252087, // Южная Корея

  // Америка
  'US': 6252001, // США
  'CA': 6252002, // Канада
  'MX': 6252003, // Мексика
  'BR': 6252004, // Бразилия
  'AR': 6252005, // Аргентина
};

/**
 * Маппинг городов Казахстана на TikTok location_ids
 */
export const KZ_CITY_LOCATION_IDS: Record<string, number> = {
  // Алматы и область
  'Алматы': 6247480,
  'Almaty': 6247480,
  'алматы': 6247480,

  // Нур-Султан/Астана
  'Астана': 6247481,
  'Astana': 6247481,
  'астана': 6247481,
  'Нур-Султан': 6247481,

  // Шымкент
  'Шымкент': 6247482,
  'Shymkent': 6247482,
  'шымкент': 6247482,

  // Караганда
  'Караганда': 6247483,
  'Karaganda': 6247483,
  'караганда': 6247483,

  // Актобе
  'Актобе': 6247484,
  'Aktobe': 6247484,
  'актобе': 6247484,

  // Атырау
  'Атырау': 6247485,
  'Atyrau': 6247485,
  'атырау': 6247485,

  // Павлодар
  'Павлодар': 6247486,
  'Pavlodar': 6247486,
  'павлодар': 6247486,

  // Семей
  'Семей': 6247487,
  'Semey': 6247487,
  'семей': 6247487,

  // Усть-Каменогорск
  'Усть-Каменогорск': 6247488,
  'Ust-Kamenogorsk': 6247488,

  // Тараз
  'Тараз': 6247489,
  'Taraz': 6247489,
  'тараз': 6247489,

  // Костанай
  'Костанай': 6247490,
  'Kostanay': 6247490,
  'костанай': 6247490,

  // Петропавловск
  'Петропавловск': 6247491,
  'Petropavlovsk': 6247491,

  // Уральск
  'Уральск': 6247492,
  'Uralsk': 6247492,
  'уральск': 6247492,

  // Кызылорда
  'Кызылорда': 6247493,
  'Kyzylorda': 6247493,

  // Туркестан
  'Туркестан': 6247494,
  'Turkestan': 6247494,

  // Актау
  'Актау': 6247495,
  'Aktau': 6247495,
  'актау': 6247495,
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
}> = {
  'traffic': {
    objective_type: 'TRAFFIC',
    optimization_goal: 'CLICK',
    billing_event: 'CPC'
  },
  'conversions': {
    objective_type: 'CONVERSIONS',
    optimization_goal: 'CONVERT',
    billing_event: 'OCPM'
  },
  'reach': {
    objective_type: 'REACH',
    optimization_goal: 'REACH',
    billing_event: 'CPM'
  },
  'video_views': {
    objective_type: 'VIDEO_VIEWS',
    optimization_goal: 'VIDEO_VIEW',
    billing_event: 'CPM'
  },
  'lead_generation': {
    objective_type: 'LEAD_GENERATION',
    optimization_goal: 'LEAD_GENERATION',
    billing_event: 'OCPM'
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
  location_ids: number[];
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
