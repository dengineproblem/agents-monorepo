/**
 * Модуль для работы с дефолтными настройками рекламы
 * Получает предустановленные параметры из Supabase для автозаполнения при создании кампаний
 */

import { supabase } from './supabase.js';

export type CampaignGoal = 'whatsapp' | 'instagram_traffic' | 'site_leads';

export interface DefaultAdSettings {
  id: string;
  user_id: string;
  campaign_goal: CampaignGoal;
  
  // Таргетинг
  cities?: string[]; // Может содержать коды стран (RU, KZ) или ID городов (2420877) - автоопределение
  geo_locations?: any; // Опционально: готовый Facebook geo_locations JSON (если передан - используется напрямую)
  age_min: number;
  age_max: number;
  gender: 'all' | 'male' | 'female';
  
  // Общие
  description: string;
  
  // WhatsApp
  client_question?: string;
  
  // Instagram Traffic
  instagram_url?: string;
  
  // Site Leads
  site_url?: string;
  pixel_id?: string;
  utm_tag?: string;
  
  created_at: string;
  updated_at: string;
}

/**
 * Получить дефолтные настройки для пользователя по типу цели
 */
export async function getDefaultAdSettings(
  userId: string,
  campaignGoal: CampaignGoal
): Promise<DefaultAdSettings | null> {
  const { data, error } = await supabase
    .from('default_ad_settings')
    .select('*')
    .eq('user_id', userId)
    .eq('campaign_goal', campaignGoal)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Запись не найдена - это нормально
      return null;
    }
    throw new Error(`Failed to get default ad settings: ${error.message}`);
  }

  return data as DefaultAdSettings;
}

/**
 * Получить все дефолтные настройки пользователя
 */
export async function getAllDefaultAdSettings(userId: string): Promise<DefaultAdSettings[]> {
  const { data, error } = await supabase
    .from('default_ad_settings')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to get all default ad settings: ${error.message}`);
  }

  return (data as DefaultAdSettings[]) || [];
}

/**
 * Создать или обновить дефолтные настройки
 */
export async function upsertDefaultAdSettings(
  settings: Omit<DefaultAdSettings, 'id' | 'created_at' | 'updated_at'>
): Promise<DefaultAdSettings> {
  const { data, error } = await supabase
    .from('default_ad_settings')
    .upsert(settings, {
      onConflict: 'user_id,campaign_goal'
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to upsert default ad settings: ${error.message}`);
  }

  return data as DefaultAdSettings;
}

/**
 * Преобразовать настройки в формат для Facebook API таргетинга
 */
export function convertToFacebookTargeting(settings: DefaultAdSettings) {
  const targeting: any = {
    age_min: settings.age_min,
    age_max: settings.age_max,
  };

  // Пол
  if (settings.gender === 'male') {
    targeting.genders = [1]; // Male
  } else if (settings.gender === 'female') {
    targeting.genders = [2]; // Female
  }
  // Если 'all' - не указываем genders

  // Гео таргетинг - умная логика
  if (settings.geo_locations && Object.keys(settings.geo_locations).length > 0) {
    // Если есть готовый geo_locations (новый формат) - используем напрямую
    targeting.geo_locations = settings.geo_locations;
  } else if (settings.cities && settings.cities.length > 0) {
    // Автоопределение: страны или города?
    const countries: string[] = [];
    const cities: string[] = [];
    
    for (const item of settings.cities) {
      if (item.length === 2 && /^[A-Z]{2}$/.test(item)) {
        // 2 заглавные буквы = код страны (RU, KZ, BY, US)
        countries.push(item);
      } else {
        // Все остальное = ID города
        cities.push(item);
      }
    }
    
    targeting.geo_locations = {};
    
    if (countries.length > 0) {
      targeting.geo_locations.countries = countries;
    }
    
    if (cities.length > 0) {
      targeting.geo_locations.cities = cities.map(cityId => ({
        key: cityId
      }));
    }
    
    // Если ничего не распознано - по умолчанию Россия
    if (countries.length === 0 && cities.length === 0) {
      targeting.geo_locations.countries = ['RU'];
    }
  } else {
    // Default: таргетинг на Россию
    targeting.geo_locations = {
      countries: ['RU']
    };
  }

  return targeting;
}

/**
 * Получить дефолтные настройки с фолбеком
 * Если нет в БД - возвращает стандартные значения
 */
export async function getDefaultAdSettingsWithFallback(
  userId: string,
  campaignGoal: CampaignGoal
): Promise<DefaultAdSettings> {
  const settings = await getDefaultAdSettings(userId, campaignGoal);

  if (settings) {
    return settings;
  }

  // Фолбек - стандартные настройки
  return {
    id: 'fallback',
    user_id: userId,
    campaign_goal: campaignGoal,
    cities: ['RU'], // По умолчанию - Россия (автоопределится как страна)
    age_min: 18,
    age_max: 65,
    gender: 'all',
    description: 'Напишите нам, чтобы узнать подробности',
    client_question: campaignGoal === 'whatsapp' 
      ? 'Здравствуйте! Хочу узнать об этом подробнее.' 
      : undefined,
    utm_tag: campaignGoal === 'site_leads'
      ? 'utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.name}}'
      : undefined,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}
