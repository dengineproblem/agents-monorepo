/**
 * Supabase Retry Utilities
 * Обёртка для Supabase запросов с retry логикой
 */

import { withRetry } from './retryUtils.js';
import { logger } from '../../lib/logger.js';

// Supabase-специфичные retryable коды ошибок
const SUPABASE_RETRYABLE_CODES = [
  'PGRST301',   // Connection error
  '57014',       // Query canceled (timeout)
  '08006',       // Connection failure
  '08001',       // Unable to establish connection
  '08004',       // Rejected connection
  '40001',       // Serialization failure
  '40P01'        // Deadlock detected
];

/**
 * Проверяет, является ли Supabase ошибка retryable
 * @param {Object} error - Supabase error object
 * @returns {boolean}
 */
export function isSupabaseRetryable(error) {
  if (!error) return false;

  // Check Supabase error codes
  if (error.code && SUPABASE_RETRYABLE_CODES.includes(error.code)) {
    return true;
  }

  // Check error message patterns
  const message = (error.message || '').toLowerCase();
  const retryablePatterns = [
    'timeout',
    'connection',
    'econnreset',
    'socket hang up',
    'network',
    'rate limit',
    'too many',
    'temporarily',
    'unavailable',
    'failed to fetch'
  ];

  return retryablePatterns.some(pattern => message.includes(pattern));
}

/**
 * Выполняет Supabase запрос с retry
 * Supabase не выбрасывает исключения — ошибки возвращаются в result.error
 *
 * @param {Function} queryFn - Функция, возвращающая Supabase query
 * @param {Object} options
 * @param {number} options.maxRetries - Максимум попыток (default: 2)
 * @param {number} options.timeoutMs - Таймаут на попытку (default: 10000)
 * @param {string} options.operationName - Имя операции для логов
 * @returns {Promise<Object>} Supabase result { data, error }
 *
 * @example
 * const { data, error } = await supabaseWithRetry(
 *   () => supabase.from('leads').select('*').eq('id', leadId),
 *   { operationName: 'getLeadById' }
 * );
 */
export async function supabaseWithRetry(queryFn, options = {}) {
  const {
    maxRetries = 2,
    timeoutMs = 10000,
    operationName = 'supabase_query'
  } = options;

  try {
    const result = await withRetry(
      async () => {
        const queryResult = await queryFn();

        // Supabase возвращает ошибки в result.error, не выбрасывает
        if (queryResult.error) {
          if (isSupabaseRetryable(queryResult.error)) {
            // Выбрасываем чтобы withRetry обработал
            const retryError = new Error(queryResult.error.message);
            retryError.code = queryResult.error.code;
            retryError.isSupabaseError = true;
            throw retryError;
          }
          // Не retryable — возвращаем как есть
          return queryResult;
        }

        return queryResult;
      },
      {
        maxRetries,
        timeoutMs,
        operationName,
        baseDelayMs: 500,    // Быстрее для Supabase
        maxDelayMs: 3000,
        shouldRetry: (error) => error.isSupabaseError || isSupabaseRetryable(error)
      }
    );

    return result;
  } catch (error) {
    // Если все retry исчерпаны, возвращаем в формате Supabase
    logger.error({ error: error.message, operationName }, 'Supabase retry exhausted');
    return {
      data: null,
      error: {
        message: error.message,
        code: error.code || 'RETRY_EXHAUSTED'
      }
    };
  }
}

/**
 * Выполняет критическую WRITE операцию с retry и проверкой результата
 * Для операций типа UPDATE, INSERT, DELETE
 *
 * @param {Function} writeFn - Функция записи
 * @param {Function} verifyFn - Функция проверки результата (опционально)
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function supabaseWriteWithRetry(writeFn, verifyFn = null, options = {}) {
  const {
    maxRetries = 2,
    operationName = 'supabase_write'
  } = options;

  const result = await supabaseWithRetry(writeFn, {
    maxRetries,
    operationName,
    timeoutMs: 15000  // Больший таймаут для WRITE
  });

  if (result.error) {
    return result;
  }

  // Опциональная post-check верификация
  if (verifyFn) {
    try {
      const verified = await verifyFn(result.data);
      if (!verified) {
        logger.warn({ operationName }, 'Write verification failed');
        return {
          data: result.data,
          error: {
            message: 'Write verification failed',
            code: 'VERIFY_FAILED'
          }
        };
      }
    } catch (verifyError) {
      logger.error({ error: verifyError.message, operationName }, 'Write verification error');
      // Операция выполнена, но верификация не удалась
      return {
        data: result.data,
        error: {
          message: `Write succeeded but verification failed: ${verifyError.message}`,
          code: 'VERIFY_ERROR'
        }
      };
    }
  }

  return result;
}

/**
 * Batch операция с retry для каждого элемента
 *
 * @param {Array} items - Элементы для обработки
 * @param {Function} processFn - Функция обработки (item) => Promise
 * @param {Object} options
 * @returns {Promise<{ successes: Array, failures: Array }>}
 */
export async function batchWithRetry(items, processFn, options = {}) {
  const {
    concurrency = 3,
    continueOnError = true,
    operationName = 'batch_operation'
  } = options;

  const successes = [];
  const failures = [];

  // Process in batches
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);

    const results = await Promise.allSettled(
      batch.map(async (item, idx) => {
        try {
          const result = await supabaseWithRetry(
            () => processFn(item),
            { ...options, operationName: `${operationName}_${i + idx}` }
          );

          if (result.error) {
            throw new Error(result.error.message);
          }

          return { item, result: result.data };
        } catch (error) {
          throw { item, error };
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        successes.push(result.value);
      } else {
        failures.push(result.reason);
        if (!continueOnError) {
          logger.error({ operationName, failures: failures.length }, 'Batch aborted on error');
          return { successes, failures };
        }
      }
    }
  }

  logger.info({
    operationName,
    total: items.length,
    successes: successes.length,
    failures: failures.length
  }, 'Batch operation completed');

  return { successes, failures };
}

export default {
  isSupabaseRetryable,
  supabaseWithRetry,
  supabaseWriteWithRetry,
  batchWithRetry
};
