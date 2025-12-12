/**
 * Error Logger for agent-brain
 *
 * HTTP клиент для логирования ошибок в agent-service
 * Все ошибки отправляются на POST /admin/errors/log
 *
 * @module lib/errorLogger
 */

import fetch from 'node-fetch';

const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || 'http://agent-service:8082';

/**
 * @typedef {'facebook' | 'amocrm' | 'evolution' | 'creative_generation' | 'scoring' | 'webhook' | 'cron' | 'api'} ErrorType
 * @typedef {'critical' | 'warning' | 'info'} ErrorSeverity
 */

/**
 * @typedef {Object} LogErrorParams
 * @property {string} [user_account_id] - UUID пользователя
 * @property {ErrorType} error_type - Тип ошибки
 * @property {string} [error_code] - Код ошибки (например FB error code)
 * @property {string} raw_error - Текст ошибки
 * @property {string} [stack_trace] - Stack trace
 * @property {string} [action] - Действие которое выполнялось
 * @property {string} [endpoint] - Endpoint API
 * @property {Object} [request_data] - Данные запроса
 * @property {ErrorSeverity} [severity='warning'] - Уровень важности
 */

/**
 * Логирование ошибки в централизованную систему
 *
 * @param {LogErrorParams} params
 * @returns {Promise<void>}
 *
 * @example
 * import { logErrorToAdmin } from './lib/errorLogger.js';
 *
 * try {
 *   // some code
 * } catch (error) {
 *   fastify.log.error({ error }, 'Scoring failed');
 *
 *   logErrorToAdmin({
 *     user_account_id: userAccountId,
 *     error_type: 'scoring',
 *     raw_error: String(error),
 *     stack_trace: error.stack,
 *     action: 'runScoringAgent',
 *     severity: 'critical'
 *   }).catch(() => {}); // fire-and-forget
 * }
 */
export async function logErrorToAdmin(params) {
  const {
    user_account_id,
    error_type,
    error_code,
    raw_error,
    stack_trace,
    action,
    endpoint,
    request_data,
    severity = 'warning',
  } = params;

  try {
    const response = await fetch(`${AGENT_SERVICE_URL}/admin/errors/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_account_id,
        error_type,
        error_code,
        raw_error,
        stack_trace,
        action,
        endpoint,
        request_data,
        severity,
      }),
      // Timeout 10 секунд чтобы не блокировать основной flow
      timeout: 10000,
    });

    if (!response.ok) {
      console.warn(`[errorLogger] Failed to log error: ${response.status}`);
    }
  } catch (err) {
    // Ignore - не блокируем основной flow
    console.warn(`[errorLogger] Failed to send error log: ${err.message}`);
  }
}

/**
 * Логирование Facebook ошибки с извлечением кодов
 *
 * @param {string} userAccountId
 * @param {Error & { fb?: { code?: number, error_subcode?: number } }} error
 * @param {string} action
 * @returns {Promise<void>}
 */
export async function logFacebookError(userAccountId, error, action) {
  const fbCode = error.fb?.code;
  const fbSubcode = error.fb?.error_subcode;

  await logErrorToAdmin({
    user_account_id: userAccountId,
    error_type: 'facebook',
    error_code: fbCode ? `${fbCode}:${fbSubcode || 0}` : undefined,
    raw_error: error.message || String(error),
    stack_trace: error.stack,
    action,
    severity: fbCode === 190 ? 'critical' : 'warning', // Token expired = critical
  });
}

/**
 * Логирование ошибки scoring агента
 *
 * @param {string} userAccountId
 * @param {Error} error
 * @param {Object} [context]
 * @returns {Promise<void>}
 */
export async function logScoringError(userAccountId, error, context = {}) {
  await logErrorToAdmin({
    user_account_id: userAccountId,
    error_type: 'scoring',
    raw_error: error.message || String(error),
    stack_trace: error.stack,
    action: 'runScoringAgent',
    request_data: context,
    severity: 'critical',
  });
}

/**
 * Логирование ошибки анализа креативов
 *
 * @param {string} userAccountId
 * @param {Error} error
 * @param {string} action
 * @returns {Promise<void>}
 */
export async function logCreativeAnalysisError(userAccountId, error, action) {
  await logErrorToAdmin({
    user_account_id: userAccountId,
    error_type: 'api',
    raw_error: error.message || String(error),
    stack_trace: error.stack,
    action,
    severity: 'warning',
  });
}
