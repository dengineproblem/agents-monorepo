// Типы данных для направлений бизнеса

export type DirectionObjective = 'whatsapp' | 'conversions' | 'instagram_traffic' | 'site_leads' | 'lead_forms' | 'app_installs';
export type ConversionChannel = 'whatsapp' | 'lead_form' | 'site';
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
  pipeline_id?: string | number | null;
  status_id?: string | number | null;
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
  advantage_audience_enabled?: boolean;
  custom_audience_id?: string | null;
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
  capi_access_token?: string | null;
  capi_event_level?: number | null; // 1=Интерес, 2=Квалификация, 3=Запись
  // Conversions channel (whatsapp, lead_form, site)
  conversion_channel?: ConversionChannel | null;
  // CTA кнопка (null = дефолт по objective)
  cta_type?: string | null;
  // Conversions optimization level
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
  whatsapp_connection_type?: 'evolution' | 'waba';
  whatsapp_waba_phone_id?: string;
  tiktok_objective?: TikTokObjective;
  tiktok_daily_budget?: number;
  tiktok_target_cpl_kzt?: number;
  tiktok_target_cpl?: number;
  tiktok_adgroup_mode?: 'use_existing' | 'create_new';
  tiktok_instant_page_id?: string;
  default_settings?: DirectionDefaultSettingsInput;
  facebook_default_settings?: DirectionDefaultSettingsInput;
  tiktok_default_settings?: DirectionDefaultSettingsInput;
  // Conversions channel
  conversion_channel?: ConversionChannel;
  // CTA кнопка
  cta_type?: string;
  // CAPI settings (direction-level)
  capi_enabled?: boolean;
  capi_source?: CapiSource | null;
  capi_crm_type?: CapiCrmType | null;
  capi_interest_fields?: CapiFieldConfig[];
  capi_qualified_fields?: CapiFieldConfig[];
  capi_scheduled_fields?: CapiFieldConfig[];
  capi_access_token?: string | null;
  capi_event_level?: number | null;
  // Conversions optimization level
  optimization_level?: OptimizationLevel;
  // Instagram account usage
  use_instagram?: boolean;
  // Audience controls
  advantage_audience_enabled?: boolean;
  custom_audience_id?: string | null;
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
  // App Installs специфичные
  app_id?: string;
  app_store_url?: string;
  is_skadnetwork_attribution?: boolean;
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
  capi_access_token?: string | null;
  capi_event_level?: number | null;
  // CTA кнопка
  cta_type?: string;
  // Conversions optimization level
  optimization_level?: OptimizationLevel;
  // Audience controls
  advantage_audience_enabled?: boolean;
  custom_audience_id?: string | null;
}

// CTA опции для site_leads / conversions(site)
export const CTA_OPTIONS_SITE: { value: string; label: string }[] = [
  { value: 'SIGN_UP', label: 'Зарегистрироваться' },
  { value: 'LEARN_MORE', label: 'Подробнее' },
  { value: 'SUBSCRIBE', label: 'Подписаться' },
  { value: 'GET_OFFER', label: 'Получить предложение' },
  { value: 'GET_QUOTE', label: 'Получить расчёт' },
  { value: 'CONTACT_US', label: 'Связаться с нами' },
  { value: 'APPLY_NOW', label: 'Подать заявку' },
  { value: 'BOOK_NOW', label: 'Забронировать' },
  { value: 'DOWNLOAD', label: 'Скачать' },
  { value: 'SHOP_NOW', label: 'В магазин' },
  { value: 'ORDER_NOW', label: 'Заказать' },
];

// CTA опции для lead_forms / conversions(lead_form)
export const CTA_OPTIONS_LEAD_FORM: { value: string; label: string }[] = [
  { value: 'LEARN_MORE', label: 'Подробнее' },
  { value: 'SIGN_UP', label: 'Зарегистрироваться' },
  { value: 'SUBSCRIBE', label: 'Подписаться' },
  { value: 'GET_OFFER', label: 'Получить предложение' },
  { value: 'GET_QUOTE', label: 'Получить расчёт' },
  { value: 'APPLY_NOW', label: 'Подать заявку' },
  { value: 'DOWNLOAD', label: 'Скачать' },
];

// Маппинг CTA value → русский лейбл (для отображения)
export const CTA_LABELS: Record<string, string> = {
  SIGN_UP: 'Зарегистрироваться',
  LEARN_MORE: 'Подробнее',
  SUBSCRIBE: 'Подписаться',
  GET_OFFER: 'Получить предложение',
  GET_QUOTE: 'Получить расчёт',
  CONTACT_US: 'Связаться с нами',
  APPLY_NOW: 'Подать заявку',
  BOOK_NOW: 'Забронировать',
  DOWNLOAD: 'Скачать',
  SHOP_NOW: 'В магазин',
  ORDER_NOW: 'Заказать',
};

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
  app_store_url: string | null;
  is_skadnetwork_attribution: boolean | null;
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
  app_store_url?: string;
  is_skadnetwork_attribution?: boolean;
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
  app_store_url?: string;
  is_skadnetwork_attribution?: boolean;
}

// Маппинг objective в читаемые названия
export const OBJECTIVE_LABELS: Record<DirectionObjective, string> = {
  whatsapp: 'WhatsApp',
  conversions: 'Конверсии (CAPI)',
  instagram_traffic: 'Instagram Traffic',
  site_leads: 'Site Leads',
  lead_forms: 'Lead Forms',
  app_installs: 'App Installs',
};

export const OBJECTIVE_DESCRIPTIONS: Record<DirectionObjective, string> = {
  whatsapp: 'WhatsApp (переписки)',
  conversions: 'Конверсии (CAPI-оптимизация)',
  instagram_traffic: 'Instagram Traffic (переходы)',
  site_leads: 'Site Leads (заявки на сайте)',
  lead_forms: 'Lead Forms (лидформы Facebook)',
  app_installs: 'App Installs (установки приложения)',
};

export const CONVERSION_CHANNEL_LABELS: Record<ConversionChannel, string> = {
  whatsapp: 'WhatsApp',
  lead_form: 'Lead Form',
  site: 'Сайт',
};

export const CONVERSION_CHANNEL_DESCRIPTIONS: Record<ConversionChannel, string> = {
  whatsapp: 'WhatsApp (оптимизация по диалогам или CRM)',
  lead_form: 'Лидформы Facebook (оптимизация по CRM)',
  site: 'Конверсии сайта (оптимизация по CRM)',
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
  conversion_channel?: ConversionChannel | null;
  platform?: DirectionPlatformValue;
  tiktok_objective?: TikTokObjective | null;
}) => {
  if (direction.platform === 'tiktok') {
    return TIKTOK_OBJECTIVE_LABELS[direction.tiktok_objective || 'traffic'];
  }
  if (direction.objective === 'conversions' && direction.conversion_channel) {
    return `${OBJECTIVE_LABELS.conversions} / ${CONVERSION_CHANNEL_LABELS[direction.conversion_channel]}`;
  }
  return OBJECTIVE_LABELS[direction.objective];
};
