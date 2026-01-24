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

// Telegram для отправки ошибок в группу
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8584683514:AAHMPrOyu4v_CT-Tf-k2exgEop-YQPRi3WM';
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '-5079020326';

// Типы ошибок
export type ErrorType =
  | 'facebook'
  | 'tiktok'
  | 'amocrm'
  | 'bitrix24'
  | 'evolution'
  | 'waba'
  | 'chatbot_service'
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
 * Отправка ошибки в Telegram группу
 */
async function sendErrorToTelegram(params: {
  error_type: string;
  error_code?: string;
  action?: string;
  endpoint?: string;
  severity: string;
  explanation: string;
  solution: string;
  username?: string;
  user_account_id?: string;
}): Promise<void> {
  try {
    // Эмодзи по severity
    const severityEmoji = params.severity === 'critical' ? '🔴' : params.severity === 'warning' ? '🟡' : '🔵';

    // Эмодзи по типу ошибки
    const typeEmojis: Record<string, string> = {
      facebook: '📘',
      amocrm: '🔷',
      bitrix24: '🟦',
      evolution: '💬',
      creative_generation: '🎨',
      scoring: '📊',
      webhook: '🔗',
      cron: '⏰',
      api: '🌐',
      frontend: '🖥️',
    };
    const typeEmoji = typeEmojis[params.error_type] || '❗';

    const message = `${severityEmoji} <b>Ошибка: ${params.error_type}</b> ${typeEmoji}

${params.username ? `👤 Пользователь: ${params.username}` : ''}${params.user_account_id ? `\n🆔 ID: <code>${params.user_account_id}</code>` : ''}
${params.action ? `📍 Действие: ${params.action}` : ''}
${params.endpoint ? `🔗 Endpoint: ${params.endpoint}` : ''}
${params.error_code ? `📟 Код: ${params.error_code}` : ''}

💡 <b>Расшифровка:</b>
${params.explanation}

🔧 <b>Решение:</b>
${params.solution}`;

    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_ADMIN_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      log.warn({ status: response.status, body }, 'Failed to send error to Telegram');
    }
  } catch (err) {
    log.warn({ error: String(err) }, 'Error sending to Telegram');
  }
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
    // Получаем username пользователя если есть user_account_id
    let username: string | undefined;
    if (user_account_id) {
      const { data: userData } = await supabase
        .from('user_accounts')
        .select('username')
        .eq('id', user_account_id)
        .single();
      username = userData?.username;
    }

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

    // Отправляем в Telegram группу
    sendErrorToTelegram({
      error_type,
      error_code,
      action,
      endpoint,
      severity,
      explanation,
      solution,
      username,
      user_account_id,
    }).catch(() => {}); // fire-and-forget

    // Для critical ошибок создаём admin notification
    if (severity === 'critical' && insertedError?.id) {
      try {
        await supabase
          .from('admin_notifications')
          .insert({
            type: 'error',
            title: `Критическая ошибка: ${error_type}`,
            message: explanation,
            metadata: { errorId: insertedError.id, user_account_id },
          });
      } catch {
        // ignore notification errors
      }
    }

    log.info({
      errorId: insertedError?.id,
      type: error_type,
      severity,
      user_account_id,
      telegramSent: true
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
