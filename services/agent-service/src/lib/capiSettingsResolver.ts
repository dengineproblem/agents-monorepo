import { supabase } from './supabase.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'capiSettingsResolver' });

// ========================================
// TYPES
// ========================================

export type CapiChannel = 'whatsapp' | 'lead_forms' | 'site';

export interface CapiSettingsRecord {
  id: string;
  user_account_id: string;
  account_id: string | null;
  channel: CapiChannel;
  pixel_id: string;
  capi_access_token: string | null;
  capi_source: 'whatsapp' | 'crm';
  capi_crm_type: 'amocrm' | 'bitrix24' | null;
  capi_interest_fields: unknown[];
  capi_qualified_fields: unknown[];
  capi_scheduled_fields: unknown[];
  ai_l2_description: string | null;
  ai_l3_description: string | null;
  ai_generated_prompt: string | null;
  is_active: boolean;
}

export interface ResolvedCapiSettings {
  /** ID записи capi_settings */
  settingsId: string;
  /** Канал: whatsapp, lead_forms, site */
  channel: CapiChannel;
  /** Pixel/Dataset ID */
  pixelId: string;
  /** Pixel-specific access token (может быть null → resolve из account) */
  accessToken: string | null;
  /** Источник: whatsapp (AI) или crm */
  source: 'whatsapp' | 'crm';
  /** Тип CRM (если source=crm) */
  crmType: 'amocrm' | 'bitrix24' | null;
  /** CRM поля L1 */
  interestFields: unknown[];
  /** CRM поля L2 */
  qualifiedFields: unknown[];
  /** CRM поля L3 */
  scheduledFields: unknown[];
  /** AI промпт (если source=whatsapp) */
  aiPrompt: string | null;
  /** Из legacy: resolve из direction? */
  isLegacy: boolean;
}

// ========================================
// CHANNEL RESOLUTION
// ========================================

/**
 * Определяет CAPI channel по objective и conversion_channel направления
 */
export function resolveChannelFromDirection(
  objective: string | null | undefined,
  conversionChannel: string | null | undefined
): CapiChannel | null {
  if (objective === 'conversions' || objective === 'whatsapp_conversions') {
    if (conversionChannel === 'whatsapp' || objective === 'whatsapp_conversions') return 'whatsapp';
    if (conversionChannel === 'lead_form') return 'lead_forms';
    if (conversionChannel === 'site') return 'site';
    // Default для conversions без channel
    return 'whatsapp';
  }
  if (objective === 'lead_forms') return 'lead_forms';
  return null;
}

// ========================================
// MAIN RESOLVER
// ========================================

/**
 * Резолвит CAPI настройки для направления.
 * 1. Определяет channel по objective/conversion_channel
 * 2. Ищет в capi_settings
 * 3. Fallback на legacy account_directions.capi_* (transition period)
 */
export async function resolveCapiSettingsForDirection(
  directionId: string
): Promise<ResolvedCapiSettings | null> {
  if (!directionId) return null;

  // 1. Загружаем direction для определения channel и account info
  const { data: direction, error: dirError } = await supabase
    .from('account_directions')
    .select(`
      id,
      user_account_id,
      account_id,
      objective,
      conversion_channel,
      capi_enabled,
      capi_source,
      capi_crm_type,
      capi_interest_fields,
      capi_qualified_fields,
      capi_scheduled_fields,
      capi_access_token
    `)
    .eq('id', directionId)
    .maybeSingle();

  if (dirError || !direction) {
    log.warn({ directionId, error: dirError?.message }, 'Direction not found for CAPI resolution');
    return null;
  }

  const channel = resolveChannelFromDirection(direction.objective, direction.conversion_channel);
  if (!channel) {
    log.debug({
      directionId,
      objective: direction.objective,
      conversionChannel: direction.conversion_channel,
    }, 'Could not resolve CAPI channel for direction');
    return null;
  }

  // 2. Ищем в capi_settings (новая таблица)
  let settingsQuery = supabase
    .from('capi_settings')
    .select('*')
    .eq('user_account_id', direction.user_account_id)
    .eq('channel', channel)
    .eq('is_active', true);

  if (direction.account_id) {
    settingsQuery = settingsQuery.eq('account_id', direction.account_id);
  } else {
    settingsQuery = settingsQuery.is('account_id', null);
  }

  const { data: capiSettings, error: settingsError } = await settingsQuery.maybeSingle();

  if (settingsError) {
    log.warn({
      directionId,
      channel,
      error: settingsError.message,
    }, 'Error querying capi_settings table, falling back to legacy');
  }

  if (capiSettings && !settingsError) {
    log.info({
      directionId,
      settingsId: capiSettings.id,
      channel,
      source: capiSettings.capi_source,
      pixelId: capiSettings.pixel_id,
    }, 'Resolved CAPI settings from capi_settings table');

    return {
      settingsId: capiSettings.id,
      channel,
      pixelId: capiSettings.pixel_id,
      accessToken: capiSettings.capi_access_token,
      source: capiSettings.capi_source,
      crmType: capiSettings.capi_crm_type,
      interestFields: capiSettings.capi_interest_fields || [],
      qualifiedFields: capiSettings.capi_qualified_fields || [],
      scheduledFields: capiSettings.capi_scheduled_fields || [],
      aiPrompt: capiSettings.ai_generated_prompt,
      isLegacy: false,
    };
  }

  // 3. Fallback: legacy из account_directions (transition period)
  if (direction.capi_enabled) {
    log.info({
      directionId,
      channel,
      capiSource: direction.capi_source,
    }, 'Using legacy CAPI from account_directions (migration pending)');

    // Для legacy нужен pixel_id из default_ad_settings
    const { data: defaultSettings } = await supabase
      .from('default_ad_settings')
      .select('pixel_id')
      .eq('direction_id', directionId)
      .maybeSingle();

    if (!defaultSettings?.pixel_id) {
      log.warn({ directionId }, 'Legacy CAPI enabled but no pixel_id in default_ad_settings');
      return null;
    }

    return {
      settingsId: direction.id, // use direction id as fallback
      channel,
      pixelId: defaultSettings.pixel_id,
      accessToken: direction.capi_access_token || null,
      source: direction.capi_source === 'crm' ? 'crm' : 'whatsapp',
      crmType: direction.capi_crm_type || null,
      interestFields: direction.capi_interest_fields || [],
      qualifiedFields: direction.capi_qualified_fields || [],
      scheduledFields: direction.capi_scheduled_fields || [],
      aiPrompt: null,
      isLegacy: true,
    };
  }

  log.debug({ directionId, channel }, 'No CAPI settings found for direction');
  return null;
}

/**
 * Проверяет есть ли CAPI настройки для данного channel + account
 */
export async function hasCapiSettingsForChannel(
  userAccountId: string,
  accountId: string | null,
  channel: CapiChannel
): Promise<boolean> {
  let query = supabase
    .from('capi_settings')
    .select('id')
    .eq('user_account_id', userAccountId)
    .eq('channel', channel)
    .eq('is_active', true);

  if (accountId) {
    query = query.eq('account_id', accountId);
  } else {
    query = query.is('account_id', null);
  }

  const { data } = await query.maybeSingle();
  return !!data;
}

/**
 * Получить CAPI settings напрямую по channel + account (без direction)
 */
export async function getCapiSettingsByChannel(
  userAccountId: string,
  accountId: string | null,
  channel: CapiChannel
): Promise<CapiSettingsRecord | null> {
  let query = supabase
    .from('capi_settings')
    .select('*')
    .eq('user_account_id', userAccountId)
    .eq('channel', channel)
    .eq('is_active', true);

  if (accountId) {
    query = query.eq('account_id', accountId);
  } else {
    query = query.is('account_id', null);
  }

  const { data } = await query.maybeSingle();
  return data as CapiSettingsRecord | null;
}
