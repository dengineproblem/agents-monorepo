/**
 * Error Logger Utility
 *
 * Централизованное логирование ошибок в таблицу error_logs
 * с автоматической LLM расшифровкой через GPT-4o-mini
 *
 * @module lib/errorLogger
 */

import { supabase } from './supabase.js';
import { createLogger } from './logger.js';
import OpenAI from 'openai';

const log = createLogger({ module: 'errorLogger' });

// Типы ошибок
export type ErrorType =
  | 'facebook'
  | 'amocrm'
  | 'evolution'
  | 'creative_generation'
  | 'scoring'
  | 'webhook'
  | 'cron'
  | 'api'
  | 'frontend';

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

// OpenAI для LLM расшифровки
let openai: OpenAI | null = null;

function getOpenAI(): OpenAI | null {
  if (!openai && process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

/**
 * Генерация LLM объяснения для ошибки
 */
async function generateErrorExplanation(error: {
  error_type: string;
  error_code?: string;
  raw_error: string;
  action?: string;
  endpoint?: string;
}): Promise<{ explanation: string; solution: string }> {
  const client = getOpenAI();
  if (!client) {
    return {
      explanation: 'Ошибка в системе',
      solution: 'Обратитесь к разработчику для анализа',
    };
  }

  try {
    const prompt = `Ты помощник для анализа технических ошибок. Проанализируй ошибку и дай:
1. Краткое объяснение на русском языке (что произошло, простыми словами)
2. Рекомендуемое решение

Контекст ошибки:
- Тип: ${error.error_type}
- Код: ${error.error_code || 'не указан'}
- Действие: ${error.action || 'не указано'}
- Endpoint: ${error.endpoint || 'не указан'}

Текст ошибки:
${error.raw_error.substring(0, 1000)}

Ответь в формате JSON:
{
  "explanation": "краткое объяснение на русском",
  "solution": "рекомендуемое решение"
}`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (content) {
      const result = JSON.parse(content);
      return {
        explanation: result.explanation || 'Не удалось проанализировать ошибку',
        solution: result.solution || 'Обратитесь к разработчику',
      };
    }
  } catch (err) {
    log.warn({ error: String(err) }, 'Error generating LLM explanation, using default');
  }

  return {
    explanation: 'Ошибка в системе',
    solution: 'Обратитесь к разработчику для анализа',
  };
}

/**
 * Логирование ошибки в таблицу error_logs
 *
 * Использование:
 * ```typescript
 * import { logErrorToAdmin } from '../lib/errorLogger.js';
 *
 * catch (error: any) {
 *   log.error({ ... }, 'Error message');
 *
 *   logErrorToAdmin({
 *     user_account_id: userAccountId,
 *     error_type: 'facebook',
 *     raw_error: error.message,
 *     stack_trace: error.stack,
 *     action: 'autolaunch_v2',
 *     endpoint: '/auto-launch-v2',
 *     severity: 'warning'
 *   }).catch(() => {}); // fire-and-forget
 * }
 * ```
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
    // Генерируем LLM объяснение
    const { explanation, solution } = await generateErrorExplanation({
      error_type,
      error_code,
      raw_error,
      action,
      endpoint,
    });

    // Вставляем в error_logs
    const { data: insertedError, error: insertError } = await supabase
      .from('error_logs')
      .insert({
        user_account_id: user_account_id || null,
        error_type,
        error_code: error_code || null,
        raw_error,
        stack_trace: stack_trace || null,
        action: action || null,
        endpoint: endpoint || null,
        request_data: request_data || null,
        llm_explanation: explanation,
        llm_solution: solution,
        severity,
        is_resolved: false,
      })
      .select('id')
      .single();

    if (insertError) {
      log.error({ error: insertError.message }, 'Failed to insert error log');
      return;
    }

    // Для critical ошибок создаём admin notification
    if (severity === 'critical' && insertedError?.id) {
      await supabase
        .from('admin_notifications')
        .insert({
          type: 'error',
          title: `Критическая ошибка: ${error_type}`,
          message: explanation,
          metadata: { errorId: insertedError.id, user_account_id },
        })
        .catch(() => {}); // ignore
    }

    log.info({
      errorId: insertedError?.id,
      type: error_type,
      severity,
      user_account_id
    }, 'Error logged to admin');

  } catch (err) {
    // Не падаем если логирование не удалось
    log.error({ error: String(err) }, 'Failed to log error to admin');
  }
}

/**
 * Быстрое логирование без LLM (для высоконагруженных мест)
 */
export async function logErrorToAdminFast(params: LogErrorParams): Promise<void> {
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
    await supabase
      .from('error_logs')
      .insert({
        user_account_id: user_account_id || null,
        error_type,
        error_code: error_code || null,
        raw_error,
        stack_trace: stack_trace || null,
        action: action || null,
        endpoint: endpoint || null,
        request_data: request_data || null,
        llm_explanation: null, // LLM расшифровка будет добавлена позже или вручную
        llm_solution: null,
        severity,
        is_resolved: false,
      });
  } catch (err) {
    log.error({ error: String(err) }, 'Failed to log error (fast mode)');
  }
}
