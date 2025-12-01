import { supabase } from './supabase';

/**
 * Тип учётных данных для работы с рекламными платформами
 */
export interface AdCredentials {
  // Facebook
  fbAccessToken: string | null;
  fbAdAccountId: string | null;
  fbPageId: string | null;
  fbInstagramId: string | null;
  fbInstagramUsername: string | null;
  fbBusinessId: string | null;
  igSeedAudienceId: string | null;
  whatsappPhoneNumber: string | null;

  // TikTok
  tiktokAccountId: string | null;
  tiktokBusinessId: string | null;
  tiktokAccessToken: string | null;

  // Prompts
  prompt1: string | null;
  prompt2: string | null;
  prompt3: string | null;
  prompt4: string | null;

  // Telegram
  telegramId: string | null;
  telegramId2: string | null;
  telegramId3: string | null;
  telegramId4: string | null;

  // API Keys
  openaiApiKey: string | null;
  geminiApiKey: string | null;

  // AmoCRM
  amocrmSubdomain: string | null;
  amocrmAccessToken: string | null;
  amocrmRefreshToken: string | null;
  amocrmTokenExpiresAt: string | null;
  amocrmClientId: string | null;
  amocrmClientSecret: string | null;

  // Custom audiences
  customAudiences: Array<{ id: string; name: string }>;

  // Tariff
  tarif: string | null;
  tarifExpires: string | null;

  // Settings
  defaultAdsetMode: 'api_create' | 'use_existing';

  // Meta
  isMultiAccountMode: boolean;
  adAccountId: string | null;
  adAccountName: string | null;
}

/**
 * Получает учётные данные для пользователя.
 * Автоматически определяет режим работы (legacy или multi-account).
 *
 * @param userAccountId - ID пользователя из user_accounts
 * @param accountId - UUID FK из ad_accounts.id (обязательно для multi-account режима)
 * @returns Учётные данные для работы с рекламными платформами
 */
export async function getCredentials(
  userAccountId: string,
  accountId?: string
): Promise<AdCredentials> {
  // 1. Получаем данные пользователя
  const { data: user, error: userError } = await supabase
    .from('user_accounts')
    .select(`
      multi_account_enabled,
      default_adset_mode,
      access_token,
      ad_account_id,
      page_id,
      instagram_id,
      instagram_username,
      business_id,
      ig_seed_audience_id,
      whatsapp_phone_number,
      tiktok_account_id,
      tiktok_business_id,
      tiktok_access_token,
      prompt1, prompt2, prompt3, prompt4,
      telegram_id, telegram_id_2, telegram_id_3, telegram_id_4,
      openai_api_key, gemini_api_key,
      amocrm_subdomain, amocrm_access_token, amocrm_refresh_token,
      amocrm_token_expires_at, amocrm_client_id, amocrm_client_secret,
      custom_audiences,
      tarif, tarif_expires
    `)
    .eq('id', userAccountId)
    .single();

  if (userError || !user) {
    throw new Error(`User not found: ${userAccountId}`);
  }

  // 2. Проверяем режим работы СТРОГО по флагу
  if (user.multi_account_enabled) {
    // Multi-account режим - ТРЕБУЕМ account_id (UUID FK к ad_accounts.id)
    if (!accountId) {
      throw new Error('account_id is required when multi_account_enabled is true');
    }
    // Multi-account режим - читаем из ad_accounts
    const { data: adAccount, error: adError } = await supabase
      .from('ad_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_account_id', userAccountId) // Проверяем принадлежность
      .single();

    if (adError || !adAccount) {
      throw new Error(`Ad account not found: ${accountId}`);
    }

    // После миграции 065 названия полей в ad_accounts совпадают с user_accounts
    return {
      fbAccessToken: adAccount.access_token,
      fbAdAccountId: adAccount.ad_account_id,
      fbPageId: adAccount.page_id,
      fbInstagramId: adAccount.instagram_id,
      fbInstagramUsername: adAccount.instagram_username,
      fbBusinessId: adAccount.business_id,
      igSeedAudienceId: adAccount.ig_seed_audience_id,
      whatsappPhoneNumber: adAccount.whatsapp_phone_number || null,

      tiktokAccountId: adAccount.tiktok_account_id,
      tiktokBusinessId: adAccount.tiktok_business_id,
      tiktokAccessToken: adAccount.tiktok_access_token,

      prompt1: adAccount.prompt1,
      prompt2: adAccount.prompt2,
      prompt3: adAccount.prompt3,
      prompt4: adAccount.prompt4,

      telegramId: adAccount.telegram_id,
      telegramId2: adAccount.telegram_id_2,
      telegramId3: adAccount.telegram_id_3,
      telegramId4: adAccount.telegram_id_4,

      openaiApiKey: adAccount.openai_api_key,
      geminiApiKey: adAccount.gemini_api_key,

      amocrmSubdomain: adAccount.amocrm_subdomain,
      amocrmAccessToken: adAccount.amocrm_access_token,
      amocrmRefreshToken: adAccount.amocrm_refresh_token,
      amocrmTokenExpiresAt: adAccount.amocrm_token_expires_at,
      amocrmClientId: adAccount.amocrm_client_id,
      amocrmClientSecret: adAccount.amocrm_client_secret,

      customAudiences: adAccount.custom_audiences || [],

      tarif: adAccount.tarif,
      tarifExpires: adAccount.tarif_expires,

      defaultAdsetMode: user.default_adset_mode || 'api_create',

      isMultiAccountMode: true,
      adAccountId: adAccount.id,
      adAccountName: adAccount.name,
    };
  }

  // 3. Legacy режим - читаем из user_accounts
  return {
    fbAccessToken: user.access_token,
    fbAdAccountId: user.ad_account_id,
    fbPageId: user.page_id,
    fbInstagramId: user.instagram_id,
    fbInstagramUsername: user.instagram_username,
    fbBusinessId: user.business_id,
    igSeedAudienceId: user.ig_seed_audience_id,
    whatsappPhoneNumber: user.whatsapp_phone_number,

    tiktokAccountId: user.tiktok_account_id,
    tiktokBusinessId: user.tiktok_business_id,
    tiktokAccessToken: user.tiktok_access_token,

    prompt1: user.prompt1,
    prompt2: user.prompt2,
    prompt3: user.prompt3,
    prompt4: user.prompt4,

    telegramId: user.telegram_id,
    telegramId2: user.telegram_id_2,
    telegramId3: user.telegram_id_3,
    telegramId4: user.telegram_id_4,

    openaiApiKey: user.openai_api_key,
    geminiApiKey: user.gemini_api_key,

    amocrmSubdomain: user.amocrm_subdomain,
    amocrmAccessToken: user.amocrm_access_token,
    amocrmRefreshToken: user.amocrm_refresh_token,
    amocrmTokenExpiresAt: user.amocrm_token_expires_at,
    amocrmClientId: user.amocrm_client_id,
    amocrmClientSecret: user.amocrm_client_secret,

    customAudiences: user.custom_audiences || [],

    tarif: user.tarif,
    tarifExpires: user.tarif_expires,

    defaultAdsetMode: user.default_adset_mode || 'api_create',

    isMultiAccountMode: false,
    adAccountId: null,
    adAccountName: null,
  };
}

/**
 * Получает дефолтный рекламный аккаунт пользователя (для multi-account режима)
 */
export async function getDefaultAdAccount(userAccountId: string): Promise<string | null> {
  const { data: user } = await supabase
    .from('user_accounts')
    .select('multi_account_enabled')
    .eq('id', userAccountId)
    .single();

  if (!user?.multi_account_enabled) {
    return null;
  }

  const { data: adAccount } = await supabase
    .from('ad_accounts')
    .select('id')
    .eq('user_account_id', userAccountId)
    .eq('is_default', true)
    .single();

  return adAccount?.id || null;
}

/**
 * Получает список всех рекламных аккаунтов пользователя
 */
export async function getAdAccounts(userAccountId: string) {
  const { data: user } = await supabase
    .from('user_accounts')
    .select('multi_account_enabled')
    .eq('id', userAccountId)
    .single();

  if (!user?.multi_account_enabled) {
    return [];
  }

  const { data: adAccounts } = await supabase
    .from('ad_accounts')
    .select('id, name, username, is_default, is_active, tarif, tarif_expires, connection_status')
    .eq('user_account_id', userAccountId)
    .order('created_at', { ascending: true });

  return adAccounts || [];
}

/**
 * Проверяет, включен ли режим мультиаккаунтности для пользователя
 */
export async function isMultiAccountEnabled(userAccountId: string): Promise<boolean> {
  const { data: user } = await supabase
    .from('user_accounts')
    .select('multi_account_enabled')
    .eq('id', userAccountId)
    .single();

  return user?.multi_account_enabled === true;
}
