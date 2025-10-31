import { createClient } from '@supabase/supabase-js';
import { logger } from './logger.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

// Проверка при старте
if (!SUPABASE_URL || !SUPABASE_KEY) {
  logger.error({ 
    msg: 'supabase_config_missing',
    hasUrl: !!SUPABASE_URL,
    hasKey: !!SUPABASE_KEY
  }, 'SUPABASE_URL or SUPABASE_SERVICE_ROLE not set');
  process.exit(1);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Wrapper для Supabase запросов с централизованной обработкой ошибок
 * 
 * @param {string} tableName - Имя таблицы для логирования
 * @param {Function} operation - Async функция, выполняющая запрос к Supabase
 * @param {Object} metadata - Дополнительные поля для логирования
 * @returns {Promise<any>} - Результат запроса (result.data)
 */
export async function supabaseQuery(tableName, operation, metadata = {}) {
  try {
    const result = await operation();
    
    if (result.error) {
      logger.error({
        msg: 'supabase_query_error',
        table: tableName,
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
        hint: result.error.hint,
        ...metadata
      }, 'Supabase query failed');
      throw new Error(`Supabase ${tableName}: ${result.error.message}`);
    }
    
    return result.data;
  } catch (err) {
    // Сетевые ошибки или другие исключения
    if (err.message && err.message.startsWith('Supabase')) {
      throw err; // Уже обработали выше
    }
    
    logger.error({
      msg: 'supabase_unavailable',
      table: tableName,
      error: String(err?.message || err),
      ...metadata
    }, 'Supabase connection failed');
    throw err;
  }
}

