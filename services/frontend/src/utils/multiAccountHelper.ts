/**
 * Хелпер для работы с мультиаккаунтностью.
 *
 * СТРОГОЕ ПРАВИЛО (см. MULTI_ACCOUNT_GUIDE.md):
 * Логика ветвления определяется ТОЛЬКО значением multi_account_enabled,
 * а НЕ наличием accountId в параметрах.
 *
 * ПРАВИЛЬНО:
 *   if (isMultiAccountEnabled()) {
 *     // Используем ad_accounts, требуем account_id
 *   } else {
 *     // Legacy режим: account_id ИГНОРИРУЕТСЯ
 *   }
 *
 * НЕПРАВИЛЬНО:
 *   if (accountId) {
 *     // НЕ проверяем наличие accountId для определения режима!
 *   }
 */

/**
 * Проверяет, включён ли режим мультиаккаунтности для текущего пользователя.
 * Значение берётся из localStorage, куда оно записывается при загрузке аккаунтов в AppContext.
 */
export const isMultiAccountEnabled = (): boolean => {
  return localStorage.getItem('multiAccountEnabled') === 'true';
};

/**
 * Возвращает accountId ТОЛЬКО если включён режим мультиаккаунтности.
 * В legacy режиме возвращает undefined, чтобы фильтрация по account_id не применялась.
 *
 * @param accountId - UUID из ad_accounts.id (может быть передан даже в legacy режиме)
 * @returns accountId в multi-account режиме, undefined в legacy режиме
 */
export const getEffectiveAccountId = (accountId?: string | null): string | undefined => {
  if (isMultiAccountEnabled() && accountId) {
    return accountId;
  }
  return undefined;
};

/**
 * Проверяет, нужно ли применять фильтрацию по account_id.
 *
 * @param accountId - UUID из ad_accounts.id
 * @returns true если нужно фильтровать (multi-account режим И есть accountId)
 */
export const shouldFilterByAccountId = (accountId?: string | null): boolean => {
  return isMultiAccountEnabled() && !!accountId;
};
