/**
 * Модуль для работы с дефолтными настройками рекламы
 * Получает предустановленные параметры из Supabase для автозаполнения при создании кампаний
 */

import { supabase } from './supabase.js';
import { buildTargeting } from './settingsHelpers.js';

export type CampaignGoal = 'whatsapp' | 'whatsapp_conversions' | 'instagram_traffic' | 'site_leads' | 'lead_forms';

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

  // Lead Forms
  lead_form_id?: string;

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
 * @deprecated Use buildTargeting() from settingsHelpers.ts instead
 * This function is kept for backward compatibility and now uses the new implementation internally
 */
export function convertToFacebookTargeting(settings: DefaultAdSettings) {
  return buildTargeting(settings, settings.campaign_goal);
}

/**
 * Получить дефолтные настройки с фолбеком
 * Если нет в БД - возвращает стандартные значения
 *
 * @deprecated This function uses old logic (user_id + campaign_goal) from before migration 010.
 * New code should use getDirectionSettings(direction_id) from settingsHelpers.ts instead.
 * This function is kept only for backward compatibility with legacy workflows.
 *
 * WARNING: This will return fallback settings with RU targeting if no settings found,
 * which may cause errors for users with Russia restrictions.
 */
export async function getDefaultAdSettingsWithFallback(
  userId: string,
  campaignGoal: CampaignGoal
): Promise<DefaultAdSettings> {
  console.warn(
    '[DEPRECATED] getDefaultAdSettingsWithFallback() uses old user_id logic. ' +
    'Consider migrating to getDirectionSettings(direction_id) from settingsHelpers.ts'
  );

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
      ? 'utm_source=facebook&utm_campaign={{campaign.name}}&utm_medium={{ad.id}}'
      : undefined,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}
