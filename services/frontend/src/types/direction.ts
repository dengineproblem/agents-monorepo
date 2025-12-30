// Типы данных для направлений бизнеса

export type DirectionObjective = 'whatsapp' | 'instagram_traffic' | 'site_leads' | 'lead_forms' | 'app_installs';

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
  objective: DirectionObjective;
  fb_campaign_id: string | null;
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
  created_at: string;
  updated_at: string;
}

export interface CreateDirectionPayload {
  userAccountId: string;
  accountId?: string | null; // UUID из ad_accounts.id для мультиаккаунтности
  name: string;
  objective: DirectionObjective;
  daily_budget_cents: number;
  target_cpl_cents: number;
  whatsapp_phone_number?: string;
  default_settings?: {
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
    // App Installs специфичные
    app_id?: string;
    app_store_url_ios?: string;
    app_store_url_android?: string;
  };
  // CAPI settings (direction-level)
  capi_enabled?: boolean;
  capi_source?: CapiSource | null;
  capi_crm_type?: CapiCrmType | null;
  capi_interest_fields?: CapiFieldConfig[];
  capi_qualified_fields?: CapiFieldConfig[];
  capi_scheduled_fields?: CapiFieldConfig[];
}

export interface UpdateDirectionPayload {
  name?: string;
  daily_budget_cents?: number;
  target_cpl_cents?: number;
  is_active?: boolean;
  whatsapp_phone_number?: string | null;
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
  // App Installs специфичные
  app_id: string | null;
  app_store_url_ios: string | null;
  app_store_url_android: string | null;
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
  app_id?: string;
  app_store_url_ios?: string;
  app_store_url_android?: string;
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
  app_id?: string;
  app_store_url_ios?: string;
  app_store_url_android?: string;
}

// Маппинг objective в читаемые названия
export const OBJECTIVE_LABELS: Record<DirectionObjective, string> = {
  whatsapp: 'WhatsApp',
  instagram_traffic: 'Instagram Traffic',
  site_leads: 'Site Leads',
  lead_forms: 'Lead Forms',
  app_installs: 'App Installs',
};

export const OBJECTIVE_DESCRIPTIONS: Record<DirectionObjective, string> = {
  whatsapp: 'WhatsApp (переписки)',
  instagram_traffic: 'Instagram Traffic (переходы)',
  site_leads: 'Site Leads (заявки на сайте)',
  lead_forms: 'Lead Forms (лидформы Facebook)',
  app_installs: 'App Installs (установки приложений)',
};

