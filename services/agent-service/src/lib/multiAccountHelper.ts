/**
 * Хелпер для работы с мультиаккаунтностью на бэкенде.
 *
 * СТРОГОЕ ПРАВИЛО (см. MULTI_ACCOUNT_GUIDE.md):
 * Логика ветвления определяется ТОЛЬКО значением multi_account_enabled,
 * а НЕ наличием accountId в параметрах запроса.
 *
 * ПРАВИЛЬНО:
 *   const multiAccountEnabled = await isMultiAccountEnabled(supabase, userAccountId);
 *   if (multiAccountEnabled && accountId) {
 *     query = query.eq('account_id', accountId);
 *   }
 *
 * НЕПРАВИЛЬНО:
 *   if (accountId) {
 *     query = query.eq('account_id', accountId);  // НЕ проверяем флаг!
 *   }
 */

import { SupabaseClient } from '@supabase/supabase-js';

// Кэш для multi_account_enabled (TTL 5 минут)
const cache = new Map<string, { value: boolean; expires: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 минут

/**
 * Проверяет, включён ли режим мультиаккаунтности для пользователя.
 * Результат кэшируется на 5 минут для снижения нагрузки на БД.
 *
 * @param supabase - клиент Supabase
 * @param userAccountId - ID пользователя из user_accounts
 * @returns true если multi_account_enabled = true
 */
export async function isMultiAccountEnabled(
  supabase: SupabaseClient,
  userAccountId: string
): Promise<boolean> {
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
 * Проверяет, нужно ли применять фильтрацию по account_id.
 * Сначала проверяет флаг multi_account_enabled, потом наличие accountId.
 *
 * @param supabase - клиент Supabase
 * @param userAccountId - ID пользователя из user_accounts
 * @param accountId - UUID из ad_accounts.id (может быть undefined)
 * @returns true если нужно фильтровать по account_id
 */
export async function shouldFilterByAccountId(
  supabase: SupabaseClient,
  userAccountId: string,
  accountId?: string | null
): Promise<boolean> {
  if (!accountId) return false;
  const multiAccountEnabled = await isMultiAccountEnabled(supabase, userAccountId);
  return multiAccountEnabled;
}

/**
 * Очищает кэш multi_account_enabled для пользователя.
 * Вызывать при изменении флага multi_account_enabled.
 */
export function clearMultiAccountCache(userAccountId: string): void {
  cache.delete(userAccountId);
}

/**
 * Очищает весь кэш multi_account_enabled.
 */
export function clearAllMultiAccountCache(): void {
  cache.clear();
}
