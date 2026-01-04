/**
 * Хелпер для работы с мультиаккаунтностью в agent-brain.
 *
 * СТРОГОЕ ПРАВИЛО (см. MULTI_ACCOUNT_GUIDE.md):
 * Логика ветвления определяется ТОЛЬКО значением multi_account_enabled,
 * а НЕ наличием accountId в параметрах запроса.
 *
 * ПРАВИЛЬНО:
 *   if (await shouldFilterByAccountId(supabase, userAccountId, adAccountId)) {
 *     query = query.eq('ad_account_id', adAccountId);
 *   }
 *
 * НЕПРАВИЛЬНО:
 *   if (adAccountId) {
 *     query = query.eq('ad_account_id', adAccountId);  // НЕ проверяем флаг!
 *   }
 */

import { supabase } from './supabaseClient.js';

// Кэш для multi_account_enabled (TTL 5 минут)
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 минут

/**
 * Проверяет, включён ли режим мультиаккаунтности для пользователя.
 * Результат кэшируется на 5 минут для снижения нагрузки на БД.
 *
 * @param {string} userAccountId - ID пользователя из user_accounts
 * @returns {Promise<boolean>} true если multi_account_enabled = true
 */
export async function isMultiAccountEnabled(userAccountId) {
  const now = Date.now();
  const cached = cache.get(userAccountId);

  if (cached && cached.expires > now) {
    return cached.value;
  }

  try {
    const { data, error } = await supabase
      .from('user_accounts')
      .select('multi_account_enabled')
      .eq('id', userAccountId)
      .single();

    if (error) {
      console.error('[multiAccountHelper] Error fetching multi_account_enabled:', error);
      return false;
    }

    const enabled = !!data?.multi_account_enabled;
    cache.set(userAccountId, { value: enabled, expires: now + CACHE_TTL_MS });
    return enabled;
  } catch (e) {
    console.error('[multiAccountHelper] Exception:', e);
    return false;
  }
}

/**
 * Проверяет, нужно ли применять фильтрацию по ad_account_id.
 * Сначала проверяет флаг multi_account_enabled, потом наличие accountId.
 *
 * @param {string} userAccountId - ID пользователя из user_accounts
 * @param {string|null|undefined} accountId - UUID из ad_accounts.id (может быть undefined)
 * @returns {Promise<boolean>} true если нужно фильтровать по account_id
 */
export async function shouldFilterByAccountId(userAccountId, accountId) {
  if (!accountId) return false;
  const multiAccountEnabled = await isMultiAccountEnabled(userAccountId);
  return multiAccountEnabled;
}

/**
 * Очищает кэш multi_account_enabled для пользователя.
 * Вызывать при изменении флага multi_account_enabled.
 * @param {string} userAccountId
 */
export function clearMultiAccountCache(userAccountId) {
  cache.delete(userAccountId);
}

/**
 * Очищает весь кэш multi_account_enabled.
 */
export function clearAllMultiAccountCache() {
  cache.clear();
}
