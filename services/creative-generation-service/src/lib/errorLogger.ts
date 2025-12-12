/**
 * Error Logger for creative-generation-service
 *
 * HTTP клиент для логирования ошибок в agent-service
 * Все ошибки отправляются на POST /admin/errors/log
 *
 * @module lib/errorLogger
 */

const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || 'http://agent-service:8082';

export type ErrorType =
  | 'facebook'
  | 'amocrm'
  | 'evolution'
  | 'creative_generation'
  | 'scoring'
  | 'webhook'
  | 'cron'
  | 'api';

export type ErrorSeverity = 'critical' | 'warning' | 'info';

export interface LogErrorParams {
  user_account_id?: string;
  error_type: ErrorType;
  error_code?: string;
  raw_error: string;
  stack_trace?: string;
  action?: string;
  endpoint?: string;
  request_data?: any;
  severity?: ErrorSeverity;
}

/**
 * Логирование ошибки в централизованную систему
 *
 * @example
 * import { logErrorToAdmin } from '../lib/errorLogger';
 *
 * catch (error: any) {
 *   app.log.error('[Generate Creative] Error:', error);
 *
 *   logErrorToAdmin({
 *     user_account_id: body.user_id,
 *     error_type: 'creative_generation',
 *     raw_error: error.message,
 *     action: 'generate_creative_image',
 *     endpoint: '/generate-creative',
 *     severity: 'warning'
 *   }).catch(() => {}); // fire-and-forget
 * }
 */
export async function logErrorToAdmin(params: LogErrorParams): Promise<void> {
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
      signal: AbortSignal.timeout(10000), // 10 секунд timeout
    });

    if (!response.ok) {
      console.warn(`[errorLogger] Failed to log error: ${response.status}`);
    }
  } catch (err: any) {
    // Ignore - не блокируем основной flow
    console.warn(`[errorLogger] Failed to send error log: ${err.message}`);
  }
}

/**
 * Логирование ошибки генерации изображения
 */
export async function logImageGenerationError(
  userId: string,
  error: Error,
  action: string
): Promise<void> {
  await logErrorToAdmin({
    user_account_id: userId,
    error_type: 'creative_generation',
    raw_error: error.message || String(error),
    stack_trace: error.stack,
    action,
    severity: 'warning',
  });
}

/**
 * Логирование ошибки генерации карусели
 */
export async function logCarouselGenerationError(
  userId: string,
  error: Error,
  action: string
): Promise<void> {
  await logErrorToAdmin({
    user_account_id: userId,
    error_type: 'creative_generation',
    raw_error: error.message || String(error),
    stack_trace: error.stack,
    action,
    severity: 'warning',
  });
}

/**
 * Логирование ошибки генерации текста
 */
export async function logTextGenerationError(
  userId: string,
  error: Error,
  action: string
): Promise<void> {
  await logErrorToAdmin({
    user_account_id: userId,
    error_type: 'creative_generation',
    raw_error: error.message || String(error),
    stack_trace: error.stack,
    action,
    severity: 'warning',
  });
}
