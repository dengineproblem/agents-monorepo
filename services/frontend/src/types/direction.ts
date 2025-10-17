// Типы данных для направлений бизнеса

export type DirectionObjective = 'whatsapp' | 'instagram_traffic' | 'site_leads';

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
  created_at: string;
  updated_at: string;
}

export interface CreateDirectionPayload {
  userAccountId: string;
  name: string;
  objective: DirectionObjective;
  daily_budget_cents: number;
  target_cpl_cents: number;
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
  };
}

export interface UpdateDirectionPayload {
  name?: string;
  daily_budget_cents?: number;
  target_cpl_cents?: number;
  is_active?: boolean;
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
}

// Маппинг objective в читаемые названия
export const OBJECTIVE_LABELS: Record<DirectionObjective, string> = {
  whatsapp: 'WhatsApp',
  instagram_traffic: 'Instagram Traffic',
  site_leads: 'Site Leads',
};

export const OBJECTIVE_DESCRIPTIONS: Record<DirectionObjective, string> = {
  whatsapp: 'WhatsApp (переписки)',
  instagram_traffic: 'Instagram Traffic (переходы)',
  site_leads: 'Site Leads (заявки на сайте)',
};

