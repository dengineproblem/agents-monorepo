// Типы данных для направлений бизнеса

export type DirectionObjective = 'whatsapp' | 'whatsapp_conversions' | 'instagram_traffic' | 'site_leads' | 'lead_forms';
export type OptimizationLevel = 'level_1' | 'level_2' | 'level_3';
export type DirectionPlatform = 'facebook' | 'tiktok' | 'both';
export type DirectionPlatformValue = 'facebook' | 'tiktok' | null;
export type TikTokObjective = 'traffic' | 'conversions' | 'lead_generation';

// CAPI settings types
export type CapiSource = 'whatsapp' | 'crm';
export type CapiCrmType = 'amocrm' | 'bitrix24';

export interface CapiFieldConfig {
  field_id: string | number;
  field_name: string;
  field_type: string;
  enum_id?: string | number | null;
  enum_value?: string | null;
  entity_type?: string; // for Bitrix24
}

export interface Direction {
  id: string;
  user_account_id: string;
  name: string;
  platform?: DirectionPlatformValue;
  objective: DirectionObjective;
  fb_campaign_id: string | null;
  tiktok_campaign_id?: string | null;
  tiktok_objective?: TikTokObjective | null;
  tiktok_daily_budget?: number | null;
  tiktok_target_cpl_kzt?: number | null;
  tiktok_target_cpl?: number | null;
  tiktok_adgroup_mode?: 'use_existing' | 'create_new' | null;
  tiktok_identity_id?: string | null;
  tiktok_instant_page_id?: string | null;
  campaign_status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | null;
  daily_budget_cents: number;
  target_cpl_cents: number;
  is_active: boolean;
  whatsapp_phone_number?: string | null;
  // AmoCRM key stages (up to 3)
  key_stage_1_pipeline_id?: number | null;
  key_stage_1_status_id?: number | null;
  key_stage_2_pipeline_id?: number | null;
  key_stage_2_status_id?: number | null;
  key_stage_3_pipeline_id?: number | null;
  key_stage_3_status_id?: number | null;
  // CAPI settings (direction-level)
  capi_enabled?: boolean;
  capi_source?: CapiSource | null;
  capi_crm_type?: CapiCrmType | null;
  capi_interest_fields?: CapiFieldConfig[];
  capi_qualified_fields?: CapiFieldConfig[];
  capi_scheduled_fields?: CapiFieldConfig[];
  // WhatsApp-conversions optimization level
  optimization_level?: OptimizationLevel;
  // Instagram account usage
  use_instagram?: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateDirectionPayload {
  userAccountId: string;
  accountId?: string | null; // UUID из ad_accounts.id для мультиаккаунтности
  platform?: DirectionPlatform;
  name: string;
  objective?: DirectionObjective;
  daily_budget_cents?: number;
  target_cpl_cents?: number;
  whatsapp_phone_number?: string;
  tiktok_objective?: TikTokObjective;
  tiktok_daily_budget?: number;
  tiktok_target_cpl_kzt?: number;
  tiktok_target_cpl?: number;
  tiktok_adgroup_mode?: 'use_existing' | 'create_new';
  tiktok_instant_page_id?: string;
  default_settings?: DirectionDefaultSettingsInput;
  facebook_default_settings?: DirectionDefaultSettingsInput;
  tiktok_default_settings?: DirectionDefaultSettingsInput;
  // CAPI settings (direction-level)
  capi_enabled?: boolean;
  capi_source?: CapiSource | null;
  capi_crm_type?: CapiCrmType | null;
  capi_interest_fields?: CapiFieldConfig[];
  capi_qualified_fields?: CapiFieldConfig[];
  capi_scheduled_fields?: CapiFieldConfig[];
  // WhatsApp-conversions optimization level
  optimization_level?: OptimizationLevel;
  // Instagram account usage
  use_instagram?: boolean;
}

export interface DirectionDefaultSettingsInput {
  cities?: string[];
  age_min?: number;
  age_max?: number;
  gender?: 'all' | 'male' | 'female';
  description?: string;
  client_question?: string;
  instagram_url?: string;
  site_url?: string;
  pixel_id?: string;
  utm_tag?: string;
  // Lead Forms специфичные
  lead_form_id?: string;
}

export interface UpdateDirectionPayload {
  name?: string;
  daily_budget_cents?: number;
  target_cpl_cents?: number;
  is_active?: boolean;
  whatsapp_phone_number?: string | null;
  tiktok_objective?: TikTokObjective;
  tiktok_daily_budget?: number;
  tiktok_target_cpl_kzt?: number;
  tiktok_target_cpl?: number;
  tiktok_adgroup_mode?: 'use_existing' | 'create_new';
  // CAPI settings (direction-level)
  capi_enabled?: boolean;
  capi_source?: CapiSource | null;
  capi_crm_type?: CapiCrmType | null;
  capi_interest_fields?: CapiFieldConfig[];
  capi_qualified_fields?: CapiFieldConfig[];
  capi_scheduled_fields?: CapiFieldConfig[];
  // WhatsApp-conversions optimization level
  optimization_level?: OptimizationLevel;
}

// Дефолтные настройки рекламы для направления
export interface DefaultAdSettings {
  id: string;
  direction_id: string;
  user_id: string | null;
  campaign_goal: DirectionObjective;
  cities: string[] | null;
  age_min: number;
  age_max: number;
  gender: 'all' | 'male' | 'female';
  description: string;
  // WhatsApp специфичные
  client_question: string | null;
  // Instagram специфичные
  instagram_url: string | null;
  // Site Leads специфичные
  site_url: string | null;
  pixel_id: string | null;
  utm_tag: string | null;
  // Lead Forms специфичные
  lead_form_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDefaultSettingsInput {
  direction_id: string;
  campaign_goal: DirectionObjective;
  cities?: string[];
  age_min?: number;
  age_max?: number;
  gender?: 'all' | 'male' | 'female';
  description?: string;
  client_question?: string;
  instagram_url?: string;
  site_url?: string;
  pixel_id?: string;
  utm_tag?: string;
  lead_form_id?: string;
}

export interface UpdateDefaultSettingsInput {
  cities?: string[];
  age_min?: number;
  age_max?: number;
  gender?: 'all' | 'male' | 'female';
  description?: string;
  client_question?: string;
  instagram_url?: string;
  site_url?: string;
  pixel_id?: string;
  utm_tag?: string;
  lead_form_id?: string;
}

// Маппинг objective в читаемые названия
export const OBJECTIVE_LABELS: Record<DirectionObjective, string> = {
  whatsapp: 'WhatsApp',
  whatsapp_conversions: 'WhatsApp-конверсии',
  instagram_traffic: 'Instagram Traffic',
  site_leads: 'Site Leads',
  lead_forms: 'Lead Forms',
};

export const OBJECTIVE_DESCRIPTIONS: Record<DirectionObjective, string> = {
  whatsapp: 'WhatsApp (переписки)',
  whatsapp_conversions: 'WhatsApp-конверсии (оптимизация по CAPI)',
  instagram_traffic: 'Instagram Traffic (переходы)',
  site_leads: 'Site Leads (заявки на сайте)',
  lead_forms: 'Lead Forms (лидформы Facebook)',
};

export const TIKTOK_OBJECTIVE_LABELS: Record<TikTokObjective, string> = {
  traffic: 'Traffic',
  conversions: 'Website Conversions',
  lead_generation: 'Lead Form',
};

export const TIKTOK_OBJECTIVE_DESCRIPTIONS: Record<TikTokObjective, string> = {
  traffic: 'Traffic (клики)',
  conversions: 'Website Conversions (конверсии сайта)',
  lead_generation: 'Lead Form (лид-форма)',
};

export const getDirectionObjectiveLabel = (direction: {
  objective: DirectionObjective;
  platform?: DirectionPlatformValue;
  tiktok_objective?: TikTokObjective | null;
}) => {
  if (direction.platform === 'tiktok') {
    return TIKTOK_OBJECTIVE_LABELS[direction.tiktok_objective || 'traffic'];
  }
  return OBJECTIVE_LABELS[direction.objective];
};
