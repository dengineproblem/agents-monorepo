/**
 * Logging Utilities для CRM Backend
 *
 * Включает:
 * 1. Correlation ID - уникальный ID для трассировки запросов
 * 2. Структурированные теги - категоризация логов
 * 3. Маскирование чувствительных данных
 * 4. Метрики производительности
 * 5. Классификация ошибок
 */

import { randomUUID } from 'crypto';
import { FastifyRequest, FastifyReply } from 'fastify';

// ============ ТИПЫ ============

/** Категории логов для структурированного поиска */
export type LogTag =
  | 'db'           // Операции с базой данных
  | 'api'          // HTTP запросы/ответы
  | 'validation'   // Валидация данных
  | 'auth'         // Аутентификация
  | 'bot'          // Операции с ботами
  | 'function'     // Функции бота
  | 'instance';    // WhatsApp инстансы

/** Типы ошибок для классификации */
export type ErrorType =
  | 'db_error'           // Ошибка базы данных
  | 'validation_error'   // Ошибка валидации
  | 'not_found_error'    // Ресурс не найден
  | 'auth_error'         // Ошибка авторизации
  | 'internal_error';    // Внутренняя ошибка

/** Контекст запроса для propagation */
export interface RequestContext {
  correlationId: string;
  method: string;
  path: string;
  userId?: string;
  botId?: string;
  instanceId?: string;
}

// ============ CORRELATION ID ============

/** Генерация уникального correlation ID */
export function generateCorrelationId(): string {
  return `req_${randomUUID().replace(/-/g, '').substring(0, 12)}`;
}

/** Короткий ID для логов (первые 8 символов) */
export function shortCorrelationId(correlationId: string): string {
  return correlationId.replace('req_', '').substring(0, 8);
}

// ============ МАСКИРОВАНИЕ ДАННЫХ ============

/** Маскировать UUID: 550e8400-e29b-41d4-a716-446655440000 -> 550e...0000 */
export function maskUuid(uuid: string | undefined): string {
  if (!uuid) return '[empty]';
  if (uuid.length < 12) return uuid;
  return `${uuid.substring(0, 4)}...${uuid.substring(uuid.length - 4)}`;
}

/** Маскировать номер телефона: +79991234567 -> +7***4567 */
export function maskPhone(phone: string | undefined): string {
  if (!phone) return '[empty]';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 6) return '***';

  const prefix = cleaned.startsWith('7') || cleaned.startsWith('8') ? '+7' : '+';
  const lastFour = cleaned.slice(-4);
  return `${prefix}***${lastFour}`;
}

/** Маскировать API ключ: sk-1234...5678 */
export function maskApiKey(key: string | undefined | null): string {
  if (!key) return '[not set]';
  if (key.length < 12) return '***';
  return `${key.substring(0, 6)}...${key.substring(key.length - 4)}`;
}

// ============ КЛАССИФИКАЦИЯ ОШИБОК ============

/** Определить тип ошибки */
export function classifyError(error: any): { type: ErrorType; isRetryable: boolean } {
  const message = (error?.message || '').toLowerCase();
  const code = error?.code || '';

  // Ресурс не найден
  if (code === 'PGRST116' || message.includes('not found')) {
    return { type: 'not_found_error', isRetryable: false };
  }

  // Ошибки базы данных
  if (code?.toString().startsWith('PGRST') || message.includes('database') || message.includes('supabase')) {
    return { type: 'db_error', isRetryable: true };
  }

  // Ошибки валидации
  if (message.includes('validation') || message.includes('invalid') || code === 400) {
    return { type: 'validation_error', isRetryable: false };
  }

  // Ошибки авторизации
  if (message.includes('auth') || message.includes('unauthorized') || code === 401 || code === 403) {
    return { type: 'auth_error', isRetryable: false };
  }

  return { type: 'internal_error', isRetryable: false };
}

/** Создать структурированный объект ошибки для логов */
export function createErrorLog(
  error: any,
  ctx?: RequestContext,
  additionalData?: Record<string, any>
): Record<string, any> {
  const { type, isRetryable } = classifyError(error);

  const errorLog: Record<string, any> = {
    errorType: type,
    errorMessage: error?.message || String(error),
    errorCode: error?.code || undefined,
    isRetryable,
    ...additionalData
  };

  // Добавить стек только в development
  if (process.env.NODE_ENV !== 'production') {
    errorLog.stack = error?.stack?.split('\n').slice(0, 5).join('\n');
  }

  // Добавить контекст если есть
  if (ctx) {
    errorLog.cid = shortCorrelationId(ctx.correlationId);
    if (ctx.userId) errorLog.userId = maskUuid(ctx.userId);
    if (ctx.botId) errorLog.botId = maskUuid(ctx.botId);
  }

  return errorLog;
}

// ============ FASTIFY HELPERS ============

/** Создать контекст запроса из Fastify request */
export function createRequestContext(request: FastifyRequest): RequestContext {
  return {
    correlationId: generateCorrelationId(),
    method: request.method,
    path: request.url.split('?')[0],
    userId: (request.query as any)?.userId
  };
}

/** Расширить контекст запроса */
export function extendContext(
  ctx: RequestContext,
  additions: Partial<Omit<RequestContext, 'correlationId' | 'method' | 'path'>>
): RequestContext {
  return { ...ctx, ...additions };
}

/** Подготовить данные для лога с контекстом */
export function prepareLogData(
  ctx: RequestContext,
  data: Record<string, any>,
  tags?: LogTag[]
): Record<string, any> {
  return {
    cid: shortCorrelationId(ctx.correlationId),
    method: ctx.method,
    path: ctx.path,
    tags: tags || [],
    ...data
  };
}

// ============ TIMING ============

/** Получить время выполнения с начала запроса */
export function getElapsedMs(startTime: number): number {
  return Date.now() - startTime;
}

/** Создать объект с метриками времени */
export function createTimingData(startTime: number, additionalData?: Record<string, any>): Record<string, any> {
  return {
    elapsedMs: getElapsedMs(startTime),
    ...additionalData
  };
}
