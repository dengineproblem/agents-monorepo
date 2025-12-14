/**
 * Account Scope Helper for Supabase Queries
 * Унифицирует применение фильтра по account_id
 */

/**
 * Применяет фильтр по account_id к Supabase query
 * Избавляет от дублирования: if (dbAccountId) { query = query.eq(...) }
 *
 * @param {Object} query - Supabase query builder
 * @param {Object} toolContext - Контекст из resolveContext
 * @param {string} [columnName='account_id'] - Имя колонки для фильтрации
 * @returns {Object} Modified query
 *
 * @example
 * let query = supabase.from('leads').select('*').eq('user_account_id', userAccountId);
 * query = applyAccountScope(query, toolContext);
 * const { data } = await query;
 */
export function applyAccountScope(query, toolContext, columnName = 'account_id') {
  const { accountId, mode } = toolContext || {};

  // В multi-account режиме добавляем фильтр по account_id
  if (mode === 'multi' && accountId) {
    return query.eq(columnName, accountId);
  }

  // В legacy режиме возвращаем query без изменений
  return query;
}

/**
 * Проверяет, нужно ли применять фильтр по аккаунту
 *
 * @param {Object} toolContext
 * @returns {boolean}
 */
export function shouldFilterByAccount(toolContext) {
  const { accountId, mode } = toolContext || {};
  return mode === 'multi' && !!accountId;
}

/**
 * Возвращает условие для raw SQL запросов
 *
 * @param {Object} toolContext
 * @param {string} [columnName='account_id']
 * @returns {string} SQL condition или пустая строка
 *
 * @example
 * const accountFilter = getAccountFilter(toolContext);
 * const sql = `SELECT * FROM leads WHERE user_account_id = $1 ${accountFilter}`;
 */
export function getAccountFilter(toolContext, columnName = 'account_id') {
  const { accountId, mode } = toolContext || {};

  if (mode === 'multi' && accountId) {
    return `AND ${columnName} = '${accountId}'`;
  }

  return '';
}

/**
 * Возвращает объект фильтра для использования с .match()
 *
 * @param {Object} toolContext
 * @returns {Object} Filter object
 *
 * @example
 * const filter = getAccountMatch(toolContext);
 * const { data } = await supabase.from('leads').select('*').match(filter);
 */
export function getAccountMatch(toolContext) {
  const { accountId, mode, userAccountId } = toolContext || {};

  const match = {};

  if (userAccountId) {
    match.user_account_id = userAccountId;
  }

  if (mode === 'multi' && accountId) {
    match.account_id = accountId;
  }

  return match;
}

/**
 * Добавляет account_id к объекту данных перед INSERT/UPDATE
 *
 * @param {Object} data - Данные для сохранения
 * @param {Object} toolContext
 * @returns {Object} Data с добавленным account_id
 *
 * @example
 * const insertData = withAccountId({ name: 'Test', phone: '+7...' }, toolContext);
 * await supabase.from('leads').insert(insertData);
 */
export function withAccountId(data, toolContext) {
  const { accountId, mode } = toolContext || {};

  if (mode === 'multi' && accountId) {
    return { ...data, account_id: accountId };
  }

  return data;
}
