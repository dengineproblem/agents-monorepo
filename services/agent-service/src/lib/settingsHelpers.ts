/**
 * Shared module for campaign settings and WhatsApp number resolution
 * Унифицированная система получения настроек направлений и WhatsApp номеров
 */

import { supabase } from './supabase.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'settingsHelpers' });

export type CampaignObjective = 'whatsapp' | 'instagram_traffic' | 'site_leads' | 'lead_forms' | 'app_installs';

/**
 * Получить настройки таргетинга для направления
 *
 * @param directionId - ID направления (account_directions.id)
 * @returns Настройки из default_ad_settings или выбрасывает ошибку
 * @throws Error если настройки не найдены
 */
export async function getDirectionSettings(directionId: string) {
  const { data, error } = await supabase
    .from('default_ad_settings')
    .select('*')
    .eq('direction_id', directionId)
    .maybeSingle();

  if (error) {
    log.error({ err: error, directionId }, 'Error fetching direction settings');
    throw new Error(`Failed to fetch settings for direction ${directionId}: ${error.message}`);
  }

  if (!data) {
    log.error({ directionId }, 'Settings not configured for direction');
    throw new Error(
      `Targeting settings not configured for this direction. ` +
      `Please configure targeting in direction settings (direction_id: ${directionId})`
    );
  }

  log.info({ directionId, hasSettings: true }, 'Direction settings loaded');
  return data;
}

/**
 * Построить таргетинг для Facebook API из настроек направления
 *
 * @param settings - Настройки из default_ad_settings
 * @param objective - Цель кампании (для логирования)
 * @returns Объект targeting для Facebook API
 */
export function buildTargeting(settings: any, objective: CampaignObjective) {
  if (!settings) {
    throw new Error('Settings object is required to build targeting');
  }

  // Для Advantage+ Audience age_min/age_max игнорируются - хардкодим стандартные
  const targeting: any = {
    age_min: 18,
    age_max: 65,
  };

  // Пол
  if (settings.gender && settings.gender !== 'all') {
    targeting.genders = settings.gender === 'male' ? [1] : [2];
  }

  // Гео-локации (читаем из поля cities в БД)
  if (settings.cities && Array.isArray(settings.cities) && settings.cities.length > 0) {
    const countries: string[] = [];
    const cities: string[] = [];

    for (const item of settings.cities) {
      if (typeof item === 'string' && item.length === 2 && item === item.toUpperCase()) {
        // 2 заглавные буквы = код страны (RU, KZ, BY, US)
        countries.push(item);
      } else {
        // Все остальное = ID города
        cities.push(String(item));
      }
    }

    targeting.geo_locations = {};

    if (countries.length > 0) {
      targeting.geo_locations.countries = countries;
    }

    if (cities.length > 0) {
      targeting.geo_locations.cities = cities.map((cityId: string) => ({
        key: cityId,
      }));
    }

    // Если ничего не распознано - ошибка валидации
    if (countries.length === 0 && cities.length === 0) {
      log.error({ cities: settings.cities }, 'Invalid cities format in settings');
      throw new Error(
        'Invalid cities format in settings. Cities should be either 2-letter country codes (RU, KZ) ' +
        'or city IDs (2643743, 1289662)'
      );
    }
  } else {
    // Если cities не указаны - ошибка валидации
    log.error({ settings }, 'No cities configured in settings');
    throw new Error('No cities/countries configured in targeting settings. Please add at least one location.');
  }

  // Facebook требует targeting_automation для всех типов кампаний (постепенный rollout с конца 2024)
  // advantage_audience: 1 = включено (Advantage+ Audience)
  targeting.targeting_automation = {
    advantage_audience: 1
  };

  log.info({
    objective,
    countries: targeting.geo_locations?.countries?.length || 0,
    cities: targeting.geo_locations?.cities?.length || 0
  }, 'Targeting built successfully');

  return targeting;
}

/**
 * Получить WhatsApp номер с 4-tier fallback
 *
 * Priority 1: Номер привязанный к направлению (direction.whatsapp_phone_number_id)
 * Priority 2: Номер из Facebook Page через Graph API (ОСНОВНОЙ ИСТОЧНИК)
 * Priority 3: Дефолтный номер из нашей таблицы (is_default = true)
 * Priority 4: Legacy поле user_accounts.whatsapp_phone_number
 *
 * @param direction - Объект направления из account_directions
 * @param userAccountId - ID пользователя
 * @param supabaseClient - Supabase client instance
 * @param accessToken - Facebook access token (опционально, для Priority 2)
 * @param pageId - Facebook page ID (опционально, для Priority 2)
 * @returns WhatsApp номер в формате +7XXXXXXXXXX
 * @throws Error если номер не найден ни в одном источнике
 */
export async function getWhatsAppPhoneNumber(
  direction: any,
  userAccountId: string,
  supabaseClient: typeof supabase,
  accessToken?: string,
  pageId?: string
) {
  let whatsapp_phone_number: string | null = null;

  // Priority 1: Номер из направления
  if (direction.whatsapp_phone_number_id) {
    const { data: phoneNumber } = await supabaseClient
      .from('whatsapp_phone_numbers')
      .select('phone_number')
      .eq('id', direction.whatsapp_phone_number_id)
      .eq('is_active', true)
      .single();

    whatsapp_phone_number = phoneNumber?.phone_number || null;

    if (whatsapp_phone_number) {
      log.info({
        directionId: direction.id,
        phone_number: whatsapp_phone_number,
        source: 'direction'
      }, 'Using WhatsApp number from direction');
      return whatsapp_phone_number;
    }
  }

  // Получаем user_account для Priority 2, 3, 4
  const { data: userAccount } = await supabaseClient
    .from('user_accounts')
    .select('whatsapp_phone_number, access_token, page_id')
    .eq('id', userAccountId)
    .single();

  // Priority 2: Получить номер из Facebook Page через Graph API (ОСНОВНОЙ ИСТОЧНИК)
  const finalAccessToken = accessToken || userAccount?.access_token;
  const finalPageId = pageId || userAccount?.page_id;

  if (finalAccessToken && finalPageId) {
    try {
      log.info({
        directionId: direction.id,
        pageId: finalPageId
      }, 'Attempting to fetch WhatsApp number from Facebook Page');

      const response = await fetch(
        `https://graph.facebook.com/v20.0/${finalPageId}?fields=whatsapp_number&access_token=${finalAccessToken}`
      );

      if (response.ok) {
        const pageData = await response.json();
        whatsapp_phone_number = pageData?.whatsapp_number || null;

        if (whatsapp_phone_number) {
          log.info({
            directionId: direction.id,
            phone_number: whatsapp_phone_number,
            source: 'facebook_page_api'
          }, 'Using WhatsApp number from Facebook Page (Priority 2)');
          return whatsapp_phone_number;
        }
      } else {
        log.warn({
          directionId: direction.id,
          status: response.status
        }, 'Failed to fetch WhatsApp number from Facebook Page');
      }
    } catch (error: any) {
      log.warn({
        directionId: direction.id,
        error: error.message
      }, 'Error fetching WhatsApp number from Facebook Page');
    }
  }

  // Priority 3: Дефолтный номер из нашей таблицы
  const { data: defaultNumber } = await supabaseClient
    .from('whatsapp_phone_numbers')
    .select('phone_number')
    .eq('user_account_id', userAccountId)
    .eq('is_default', true)
    .eq('is_active', true)
    .single();

  whatsapp_phone_number = defaultNumber?.phone_number || null;

  if (whatsapp_phone_number) {
    log.info({
      directionId: direction.id,
      phone_number: whatsapp_phone_number,
      source: 'internal_default'
    }, 'Using default WhatsApp number from internal table (Priority 3)');
    return whatsapp_phone_number;
  }

  // Priority 4: Legacy поле из user_accounts (обратная совместимость)
  whatsapp_phone_number = userAccount?.whatsapp_phone_number || null;

  if (whatsapp_phone_number) {
    log.info({
      directionId: direction.id,
      phone_number: whatsapp_phone_number,
      source: 'user_accounts_legacy'
    }, 'Using legacy WhatsApp number (Priority 4)');
    return whatsapp_phone_number;
  }

  // Номер не найден ни в одном источнике - возвращаем null
  // Facebook сам использует дефолтный номер со страницы
  log.info({
    directionId: direction.id,
    userAccountId
  }, 'WhatsApp number not found in database - Facebook will use page default');

  return null;
}
