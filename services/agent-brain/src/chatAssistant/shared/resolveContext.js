/**
 * Context Resolver for Chat Assistant
 * Единая точка резолва контекста аккаунта для multi-account и legacy режимов
 */

import { supabase } from '../../lib/supabaseClient.js';
import { logger } from '../../lib/logger.js';

/**
 * Синхронная версия — принимает уже загруженные данные
 * Почти чистая функция, возвращает нормализованный контекст
 *
 * @param {Object} params
 * @param {Object} params.userAccount - Данные пользователя из user_accounts
 * @param {string} params.adAccountId - UUID рекламного аккаунта (опционально)
 * @param {Object} params.adAccountData - Данные из ad_accounts (опционально)
 * @returns {Object} Resolved context
 */
export function resolveContext({ userAccount, adAccountId, adAccountData }) {
  const multi = !!userAccount?.multi_account_enabled;

  // Валидация для multi-account режима
  if (multi && !adAccountId) {
    return {
      ok: false,
      error: {
        code: 'ACCOUNT_REQUIRED',
        message: 'Выберите рекламный аккаунт для продолжения работы'
      }
    };
  }

  // Legacy режим без ad_account_id
  if (!multi && !userAccount?.ad_account_id) {
    return {
      ok: false,
      error: {
        code: 'NO_AD_ACCOUNT',
        message: 'Рекламный аккаунт не настроен'
      }
    };
  }

  return {
    ok: true,
    mode: multi ? 'multi' : 'legacy',

    // UUID для database queries (null в legacy режиме)
    accountId: multi ? adAccountId : null,

    // Facebook Ad Account ID для API вызовов
    fbAdAccountId: multi
      ? adAccountData?.ad_account_id
      : userAccount?.ad_account_id,

    // User Account ID
    userAccountId: userAccount.id,

    // Access Token (приоритет: ad_accounts → user_accounts)
    accessToken: multi
      ? (adAccountData?.access_token || userAccount?.access_token)
      : userAccount?.access_token,

    // Готовый scope для query builder
    queryScope: multi ? { account_id: adAccountId } : {}
  };
}

/**
 * Асинхронная версия с загрузкой данных из БД
 * Используется в entry point (index.js)
 *
 * @param {Object} params
 * @param {string} params.userAccountId - UUID пользователя
 * @param {string} params.adAccountId - UUID рекламного аккаунта (опционально)
 * @returns {Promise<Object>} Resolved context
 */
export async function resolveContextAsync({ userAccountId, adAccountId }) {
  // 1. Загружаем данные пользователя
  const { data: userAccount, error: userError } = await supabase
    .from('user_accounts')
    .select('id, multi_account_enabled, ad_account_id, access_token')
    .eq('id', userAccountId)
    .single();

  if (userError || !userAccount) {
    logger.warn({ userAccountId, error: userError?.message }, 'User account not found');
    return {
      ok: false,
      error: {
        code: 'USER_NOT_FOUND',
        message: 'Пользователь не найден'
      }
    };
  }

  // 2. Если multi-account, загружаем данные рекламного аккаунта
  let adAccountData = null;

  if (userAccount.multi_account_enabled) {
    if (adAccountId) {
      // Конкретный аккаунт запрошен
      const { data } = await supabase
        .from('ad_accounts')
        .select('id, ad_account_id, access_token, name')
        .eq('id', adAccountId)
        .eq('user_account_id', userAccountId)
        .single();
      adAccountData = data;
    } else {
      // Пытаемся найти default аккаунт
      const { data } = await supabase
        .from('ad_accounts')
        .select('id, ad_account_id, access_token, name')
        .eq('user_account_id', userAccountId)
        .or('is_default.eq.true,is_active.eq.true')
        .order('is_default', { ascending: false })
        .limit(1)
        .single();

      if (data) {
        adAccountData = data;
        // Обновляем adAccountId для возврата
        adAccountId = data.id;
      }
    }
  }

  // 3. Резолвим контекст
  const context = resolveContext({ userAccount, adAccountId, adAccountData });

  // Логируем результат
  if (context.ok) {
    logger.info({
      userAccountId,
      mode: context.mode,
      accountId: context.accountId,
      fbAdAccountId: context.fbAdAccountId
    }, 'Context resolved');
  }

  return context;
}

/**
 * Быстрая проверка режима пользователя без загрузки ad_accounts
 *
 * @param {string} userAccountId
 * @returns {Promise<'multi'|'legacy'|null>}
 */
export async function getUserMode(userAccountId) {
  const { data } = await supabase
    .from('user_accounts')
    .select('multi_account_enabled')
    .eq('id', userAccountId)
    .single();

  if (!data) return null;
  return data.multi_account_enabled ? 'multi' : 'legacy';
}
