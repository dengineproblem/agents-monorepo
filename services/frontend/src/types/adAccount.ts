// Типы данных для рекламных аккаунтов (мультиаккаунтность)

export interface CustomAudience {
  id: string;
  name: string;
}

export interface AdAccount {
  id: string;
  user_account_id: string;
  name: string;
  username: string | null;
  is_default: boolean;
  is_active: boolean;

  // Tariff
  tarif: string | null;
  tarif_expires: string | null;
  tarif_renewal_cost: number | null;

  // Facebook credentials
  fb_ad_account_id: string | null;
  fb_page_id: string | null;
  fb_instagram_id: string | null;
  fb_instagram_username: string | null;
  fb_access_token: string | null;
  fb_business_id: string | null;
  ig_seed_audience_id: string | null;

  // TikTok credentials
  tiktok_account_id: string | null;
  tiktok_business_id: string | null;
  tiktok_access_token: string | null;

  // Prompts
  prompt1: string | null;
  prompt2: string | null;
  prompt3: string | null;
  prompt4: string | null;

  // Telegram
  telegram_id: string | null;
  telegram_id_2: string | null;
  telegram_id_3: string | null;
  telegram_id_4: string | null;

  // API Keys
  openai_api_key: string | null;
  gemini_api_key: string | null;

  // AmoCRM
  amocrm_subdomain: string | null;
  amocrm_access_token: string | null;
  amocrm_refresh_token: string | null;
  amocrm_token_expires_at: string | null;
  amocrm_client_id: string | null;
  amocrm_client_secret: string | null;

  // Custom audiences
  custom_audiences: CustomAudience[];

  // Autopilot settings
  autopilot: boolean;
  optimization: boolean;
  plan_daily_budget_cents: number | null;
  default_cpl_target_cents: number | null;

  // Status
  connection_status: 'pending' | 'connected' | 'error';
  last_error: string | null;

  created_at: string;
  updated_at: string;
}

// Сокращённый тип для списка аккаунтов
export interface AdAccountSummary {
  id: string;
  name: string;
  username: string | null;
  is_default: boolean;
  is_active: boolean;
  tarif: string | null;
  tarif_expires: string | null;
  connection_status: 'pending' | 'connected' | 'error';
  // Facebook данные для проверки подключения
  ad_account_id: string | null;
  access_token: string | null;
}

export interface CreateAdAccountPayload {
  userAccountId: string;
  name: string;
  username?: string;
  is_default?: boolean;

  // Facebook (user fills)
  fb_ad_account_id?: string;
  fb_page_id?: string;
  fb_instagram_id?: string;
  fb_instagram_username?: string;
  fb_business_id?: string;
  ig_seed_audience_id?: string;

  // TikTok (filled by OAuth)
  tiktok_account_id?: string;
  tiktok_business_id?: string;

  // Prompts
  prompt1?: string;
  prompt2?: string;
  prompt3?: string;
  prompt4?: string;

  // Telegram
  telegram_id?: string;
  telegram_id_2?: string;
  telegram_id_3?: string;
  telegram_id_4?: string;

  // API Keys
  openai_api_key?: string;
  gemini_api_key?: string;

  // Tariff
  tarif?: string;
  tarif_expires?: string;
  tarif_renewal_cost?: number;

  // Autopilot
  autopilot?: boolean;
  optimization?: boolean;
  plan_daily_budget_cents?: number;
  default_cpl_target_cents?: number;
}

export interface UpdateAdAccountPayload {
  name?: string;
  username?: string;
  is_default?: boolean;
  is_active?: boolean;

  // Facebook
  fb_ad_account_id?: string | null;
  fb_page_id?: string | null;
  fb_instagram_id?: string | null;
  fb_instagram_username?: string | null;
  fb_business_id?: string | null;
  ig_seed_audience_id?: string | null;

  // TikTok
  tiktok_account_id?: string | null;
  tiktok_business_id?: string | null;

  // Prompts
  prompt1?: string | null;
  prompt2?: string | null;
  prompt3?: string | null;
  prompt4?: string | null;

  // Telegram
  telegram_id?: string | null;
  telegram_id_2?: string | null;
  telegram_id_3?: string | null;
  telegram_id_4?: string | null;

  // API Keys
  openai_api_key?: string | null;
  gemini_api_key?: string | null;

  // Custom audiences
  custom_audiences?: CustomAudience[];

  // Tariff
  tarif?: string | null;
  tarif_expires?: string | null;
  tarif_renewal_cost?: number | null;

  // Status
  connection_status?: 'pending' | 'connected' | 'error';
  last_error?: string | null;

  // Autopilot
  autopilot?: boolean;
  optimization?: boolean;
  plan_daily_budget_cents?: number | null;
  default_cpl_target_cents?: number | null;
}

export interface AdAccountsResponse {
  multi_account_enabled: boolean;
  ad_accounts: AdAccount[];
}

// Статусы подключения
export const CONNECTION_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает настройки',
  connected: 'Подключён',
  error: 'Ошибка',
};

export const CONNECTION_STATUS_COLORS: Record<string, string> = {
  pending: 'text-yellow-500',
  connected: 'text-green-500',
  error: 'text-red-500',
};
