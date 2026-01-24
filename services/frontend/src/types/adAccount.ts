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

  // Аватар Facebook страницы
  page_picture_url: string | null;

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
  autopilot_tiktok: boolean;
  optimization: boolean;
  plan_daily_budget_cents: number | null;
  default_cpl_target_cents: number | null;

  // Brain settings (новый функционал)
  brain_mode: 'autopilot' | 'report' | 'semi_auto';
  brain_schedule_hour: number;
  brain_timezone: string;

  // Status
  connection_status: 'pending' | 'connected' | 'error';
  last_error: string | null;

  created_at: string;
  updated_at: string;
}

// Сокращённый тип для списка аккаунтов (используется в AppContext)
export interface AdAccountSummary {
  id: string;
  name: string;
  username: string | null;
  is_active: boolean;
  tarif: string | null;
  tarif_expires: string | null;
  connection_status: 'pending' | 'connected' | 'error';
  // Facebook данные для проверки подключения (маппятся из fb_*)
  ad_account_id: string | null;   // из fb_ad_account_id
  access_token: string | null;    // из fb_access_token
  page_id: string | null;         // из fb_page_id (для Lead Forms)
  fb_page_id: string | null;      // из fb_page_id (для аватара)
}

export interface CreateAdAccountPayload {
  userAccountId: string;
  name: string;
  username?: string;

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
  tiktok_access_token?: string;

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
  autopilot_tiktok?: boolean;
  optimization?: boolean;
  plan_daily_budget_cents?: number | null;
  default_cpl_target_cents?: number | null;

  // Brain settings
  brain_mode?: 'autopilot' | 'report' | 'semi_auto';
  brain_schedule_hour?: number;
  brain_timezone?: string;
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

// Brain режимы
export const BRAIN_MODE_LABELS: Record<string, string> = {
  report: 'Только отчёты',
  semi_auto: 'Полуавтоматический',
  autopilot: 'Автопилот',
};

export const BRAIN_MODE_DESCRIPTIONS: Record<string, string> = {
  report: 'Brain анализирует и отправляет отчёты, но не вносит изменения',
  semi_auto: 'Brain формирует предложения, вы одобряете их в интерфейсе',
  autopilot: 'Brain автоматически выполняет оптимизацию',
};

export const BRAIN_TIMEZONES = [
  { value: 'Asia/Almaty', label: 'Алматы (UTC+5)' },
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { value: 'Asia/Tbilisi', label: 'Тбилиси (UTC+4)' },
  { value: 'Asia/Dubai', label: 'Дубай (UTC+4)' },
  { value: 'Europe/Kiev', label: 'Киев (UTC+2)' },
  { value: 'Europe/Istanbul', label: 'Стамбул (UTC+3)' },
  { value: 'Asia/Baku', label: 'Баку (UTC+4)' },
  { value: 'Asia/Yerevan', label: 'Ереван (UTC+4)' },
];
