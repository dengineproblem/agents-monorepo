import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'supabaseClient' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

// Проверка при старте
if (!SUPABASE_URL || !SUPABASE_KEY) {
  log.error({ 
    msg: 'supabase_config_missing',
    hasUrl: !!SUPABASE_URL,
    hasKey: !!SUPABASE_KEY
  }, 'SUPABASE_URL or SUPABASE_SERVICE_ROLE not set');
  process.exit(1);
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Wrapper для Supabase запросов с централизованной обработкой ошибок
 * 
 * @param tableName - Имя таблицы для логирования
 * @param operation - Async функция, выполняющая запрос к Supabase
 * @param metadata - Дополнительные поля для логирования
 * @returns Результат запроса (result.data)
 */
export async function supabaseQuery<T = any>(
  tableName: string, 
  operation: () => Promise<{ data: T | null; error: any }>, 
  metadata: Record<string, unknown> = {}
): Promise<T | null> {
  try {
    const result = await operation();
    
    if (result.error) {
      log.error({
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
  } catch (err: any) {
    // Сетевые ошибки или другие исключения
    if (err.message && err.message.startsWith('Supabase')) {
      throw err; // Уже обработали выше
    }
    
    log.error({
      msg: 'supabase_unavailable',
      table: tableName,
      error: String(err?.message || err),
      ...metadata
    }, 'Supabase connection failed');
    throw err;
  }
}







