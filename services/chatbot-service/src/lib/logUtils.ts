/**
 * Logging Utilities - расширенные утилиты для логирования
 *
 * Включает:
 * 1. Correlation ID - уникальный ID для трассировки запросов
 * 2. Структурированные теги - категоризация логов
 * 3. Маскирование чувствительных данных
 * 4. Метрики производительности
 * 5. Контекст запроса
 * 6. Классификация ошибок
 */

import { randomUUID } from 'crypto';
import { Logger } from 'pino';

// ============ ТИПЫ ============

/** Категории логов для структурированного поиска */
export type LogTag =
  | 'db'           // Операции с базой данных
  | 'api'          // HTTP запросы/ответы
  | 'openai'       // Вызовы OpenAI API
  | 'webhook'      // Исходящие вебхуки
  | 'redis'        // Операции Redis
  | 'processing'   // Бизнес-логика обработки
  | 'message'      // Обработка сообщений
  | 'schedule'     // Расписание/таймеры
  | 'config'       // Конфигурация бота
  | 'validation'   // Валидация данных
  | 'auth'         // Аутентификация
  | 'consultation'; // Интеграция консультаций

/** Типы ошибок для классификации */
export type ErrorType =
  | 'db_error'           // Ошибка базы данных
  | 'api_error'          // Ошибка внешнего API
  | 'openai_error'       // Ошибка OpenAI
  | 'webhook_error'      // Ошибка вебхука
  | 'validation_error'   // Ошибка валидации
  | 'auth_error'         // Ошибка авторизации
  | 'timeout_error'      // Таймаут
  | 'network_error'      // Сетевая ошибка
  | 'config_error'       // Ошибка конфигурации
  | 'internal_error';    // Внутренняя ошибка

/** Контекст запроса для propagation */
export interface RequestContext {
  correlationId: string;
  userAccountId?: string;
  botId?: string;
  botName?: string;
  instanceName?: string;
  phone?: string;
  leadId?: string;
}

/** Метрики времени выполнения */
export interface TimingMetrics {
  startTime: number;
  checkpoints: Map<string, number>;
}

// ============ CORRELATION ID ============

/** Генерация уникального correlation ID */
export function generateCorrelationId(): string {
  return `req_${randomUUID().replace(/-/g, '').substring(0, 16)}`;
}

/** Короткий ID для логов (первые 8 символов) */
export function shortCorrelationId(correlationId: string): string {
  return correlationId.replace('req_', '').substring(0, 8);
}

// ============ МАСКИРОВАНИЕ ДАННЫХ ============

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

/** Маскировать email: user@example.com -> u***@example.com */
export function maskEmail(email: string | undefined): string {
  if (!email) return '[empty]';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const [user, domain] = parts;
  return `${user.charAt(0)}***@${domain}`;
}

/** Маскировать UUID: 550e8400-e29b-41d4-a716-446655440000 -> 550e...0000 */
export function maskUuid(uuid: string | undefined): string {
  if (!uuid) return '[empty]';
  if (uuid.length < 12) return uuid;
  return `${uuid.substring(0, 4)}...${uuid.substring(uuid.length - 4)}`;
}

/** Безопасно обрезать текст для логов */
export function truncateText(text: string | undefined, maxLength: number = 100): string {
  if (!text) return '[empty]';
  if (text.length <= maxLength) return text;
  return `${text.substring(0, maxLength)}...[+${text.length - maxLength}]`;
}

// ============ МЕТРИКИ ПРОИЗВОДИТЕЛЬНОСТИ ============

/** Создать новый объект метрик времени */
export function createTimingMetrics(): TimingMetrics {
  return {
    startTime: Date.now(),
    checkpoints: new Map()
  };
}

/** Добавить checkpoint */
export function addCheckpoint(metrics: TimingMetrics, name: string): void {
  metrics.checkpoints.set(name, Date.now());
}

/** Получить время с начала */
export function getElapsed(metrics: TimingMetrics): number {
  return Date.now() - metrics.startTime;
}

/** Получить время между checkpoints */
export function getCheckpointDuration(
  metrics: TimingMetrics,
  fromCheckpoint: string,
  toCheckpoint?: string
): number {
  const from = metrics.checkpoints.get(fromCheckpoint) || metrics.startTime;
  const to = toCheckpoint
    ? (metrics.checkpoints.get(toCheckpoint) || Date.now())
    : Date.now();
  return to - from;
}

/** Получить все метрики времени */
export function getTimingReport(metrics: TimingMetrics): Record<string, number> {
  const report: Record<string, number> = {
    totalElapsedMs: getElapsed(metrics)
  };

  const checkpointNames = Array.from(metrics.checkpoints.keys());
  let prevTime = metrics.startTime;

  for (const name of checkpointNames) {
    const time = metrics.checkpoints.get(name)!;
    report[`${name}Ms`] = time - prevTime;
    prevTime = time;
  }

  return report;
}

// ============ КОНТЕКСТ ЗАПРОСА ============

/** Создать новый контекст запроса */
export function createRequestContext(partial?: Partial<RequestContext>): RequestContext {
  return {
    correlationId: partial?.correlationId || generateCorrelationId(),
    userAccountId: partial?.userAccountId,
    botId: partial?.botId,
    botName: partial?.botName,
    instanceName: partial?.instanceName,
    phone: partial?.phone,
    leadId: partial?.leadId
  };
}

/** Расширить контекст запроса */
export function extendContext(
  ctx: RequestContext,
  additions: Partial<Omit<RequestContext, 'correlationId'>>
): RequestContext {
  return { ...ctx, ...additions };
}

/** Получить маскированный контекст для логов */
export function getSafeContext(ctx: RequestContext): Record<string, string> {
  const safe: Record<string, string> = {
    cid: shortCorrelationId(ctx.correlationId)
  };

  if (ctx.userAccountId) safe.userId = maskUuid(ctx.userAccountId);
  if (ctx.botId) safe.botId = maskUuid(ctx.botId);
  if (ctx.botName) safe.botName = ctx.botName;
  if (ctx.instanceName) safe.instance = ctx.instanceName;
  if (ctx.phone) safe.phone = maskPhone(ctx.phone);
  if (ctx.leadId) safe.leadId = maskUuid(ctx.leadId);

  return safe;
}

// ============ КЛАССИФИКАЦИЯ ОШИБОК ============

/** Определить тип ошибки по сообщению и коду */
export function classifyError(error: any): { type: ErrorType; isRetryable: boolean } {
  const message = (error?.message || '').toLowerCase();
  const code = error?.code || error?.status || '';

  // Ошибки базы данных
  if (code?.toString().startsWith('PGRST') || message.includes('database') || message.includes('supabase')) {
    return { type: 'db_error', isRetryable: true };
  }

  // Ошибки OpenAI
  if (message.includes('openai') || message.includes('rate_limit') || code === 429) {
    return { type: 'openai_error', isRetryable: code === 429 || message.includes('rate') };
  }

  // Таймауты
  if (message.includes('timeout') || message.includes('timed out') || code === 'ETIMEDOUT') {
    return { type: 'timeout_error', isRetryable: true };
  }

  // Сетевые ошибки
  if (message.includes('network') || message.includes('econnrefused') || code === 'ECONNREFUSED') {
    return { type: 'network_error', isRetryable: true };
  }

  // Ошибки валидации
  if (message.includes('validation') || message.includes('invalid') || code === 400) {
    return { type: 'validation_error', isRetryable: false };
  }

  // Ошибки авторизации
  if (message.includes('auth') || message.includes('unauthorized') || code === 401 || code === 403) {
    return { type: 'auth_error', isRetryable: false };
  }

  // Ошибки вебхука
  if (message.includes('webhook') || message.includes('callback')) {
    return { type: 'webhook_error', isRetryable: true };
  }

  // API ошибки (общие)
  if (code >= 500 || message.includes('server error')) {
    return { type: 'api_error', isRetryable: true };
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
    errorCode: error?.code || error?.status || undefined,
    isRetryable,
    ...additionalData
  };

  // Добавить стек только для internal_error и в development
  if (type === 'internal_error' || process.env.NODE_ENV !== 'production') {
    errorLog.stack = error?.stack?.split('\n').slice(0, 5).join('\n');
  }

  // Добавить контекст если есть
  if (ctx) {
    errorLog.context = getSafeContext(ctx);
  }

  return errorLog;
}

// ============ ОБЁРТКА ЛОГГЕРА ============

/** Расширенный логгер с контекстом */
export class ContextLogger {
  private logger: Logger;
  private ctx: RequestContext;
  private metrics: TimingMetrics;
  private defaultTags: LogTag[];

  constructor(
    logger: Logger,
    ctx: RequestContext,
    defaultTags: LogTag[] = []
  ) {
    this.logger = logger;
    this.ctx = ctx;
    this.metrics = createTimingMetrics();
    this.defaultTags = defaultTags;
  }

  /** Получить контекст */
  get context(): RequestContext {
    return this.ctx;
  }

  /** Обновить контекст */
  updateContext(additions: Partial<Omit<RequestContext, 'correlationId'>>): void {
    this.ctx = extendContext(this.ctx, additions);
  }

  /** Добавить checkpoint */
  checkpoint(name: string): void {
    addCheckpoint(this.metrics, name);
  }

  /** Получить метрики времени */
  getTimings(): Record<string, number> {
    return getTimingReport(this.metrics);
  }

  /** Подготовить данные для лога */
  private prepareLogData(
    data: Record<string, any>,
    tags?: LogTag[]
  ): Record<string, any> {
    return {
      ...getSafeContext(this.ctx),
      tags: [...this.defaultTags, ...(tags || [])],
      elapsedMs: getElapsed(this.metrics),
      ...data
    };
  }

  /** Debug log */
  debug(
    data: Record<string, any>,
    message: string,
    tags?: LogTag[]
  ): void {
    this.logger.debug(this.prepareLogData(data, tags), message);
  }

  /** Info log */
  info(
    data: Record<string, any>,
    message: string,
    tags?: LogTag[]
  ): void {
    this.logger.info(this.prepareLogData(data, tags), message);
  }

  /** Warn log */
  warn(
    data: Record<string, any>,
    message: string,
    tags?: LogTag[]
  ): void {
    this.logger.warn(this.prepareLogData(data, tags), message);
  }

  /** Error log с классификацией */
  error(
    error: any,
    message: string,
    additionalData?: Record<string, any>,
    tags?: LogTag[]
  ): void {
    const errorData = createErrorLog(error, this.ctx, additionalData);
    this.logger.error(
      this.prepareLogData(errorData, [...(tags || []), 'processing']),
      message
    );
  }

  /** Создать child logger с тем же контекстом */
  child(bindings: Record<string, any>): ContextLogger {
    return new ContextLogger(
      this.logger.child(bindings),
      this.ctx,
      this.defaultTags
    );
  }
}

/** Создать ContextLogger из обычного логгера */
export function createContextLogger(
  logger: Logger,
  initialContext?: Partial<RequestContext>,
  defaultTags?: LogTag[]
): ContextLogger {
  return new ContextLogger(
    logger,
    createRequestContext(initialContext),
    defaultTags
  );
}

// ============ УТИЛИТЫ ДЛЯ ЛОГИРОВАНИЯ СПЕЦИФИЧНЫХ СОБЫТИЙ ============

/** Лог для DB операции */
export function logDbOperation(
  ctxLogger: ContextLogger,
  operation: 'select' | 'insert' | 'update' | 'delete',
  table: string,
  data: Record<string, any>,
  success: boolean
): void {
  const method = success ? 'info' : 'warn';
  ctxLogger[method](
    {
      dbOperation: operation,
      dbTable: table,
      ...data
    },
    `[DB:${table}] ${operation.toUpperCase()} ${success ? 'completed' : 'failed'}`,
    ['db']
  );
}

/** Лог для OpenAI вызова */
export function logOpenAiCall(
  ctxLogger: ContextLogger,
  data: {
    model: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    latencyMs: number;
    success: boolean;
    errorMessage?: string;
  }
): void {
  if (data.success) {
    ctxLogger.info(
      {
        aiModel: data.model,
        aiPromptTokens: data.promptTokens,
        aiCompletionTokens: data.completionTokens,
        aiTotalTokens: data.totalTokens,
        aiLatencyMs: data.latencyMs
      },
      `[OpenAI] API call completed (${data.model})`,
      ['openai', 'api']
    );
  } else {
    ctxLogger.warn(
      {
        aiModel: data.model,
        aiLatencyMs: data.latencyMs,
        aiError: data.errorMessage
      },
      `[OpenAI] API call failed (${data.model})`,
      ['openai', 'api']
    );
  }
}

/** Лог для webhook вызова */
export function logWebhookCall(
  ctxLogger: ContextLogger,
  data: {
    url: string;
    method: string;
    statusCode?: number;
    latencyMs: number;
    success: boolean;
    errorMessage?: string;
  }
): void {
  // Маскируем URL (убираем query params и токены)
  const safeUrl = data.url.split('?')[0];

  if (data.success) {
    ctxLogger.info(
      {
        webhookUrl: safeUrl,
        webhookMethod: data.method,
        webhookStatus: data.statusCode,
        webhookLatencyMs: data.latencyMs
      },
      `[Webhook] Call completed (${data.statusCode})`,
      ['webhook', 'api']
    );
  } else {
    ctxLogger.warn(
      {
        webhookUrl: safeUrl,
        webhookMethod: data.method,
        webhookLatencyMs: data.latencyMs,
        webhookError: data.errorMessage
      },
      `[Webhook] Call failed`,
      ['webhook', 'api']
    );
  }
}

/** Лог для входящего сообщения */
export function logIncomingMessage(
  ctxLogger: ContextLogger,
  data: {
    messageType: string;
    messageLength: number;
    hasMedia: boolean;
  }
): void {
  ctxLogger.info(
    {
      msgType: data.messageType,
      msgLength: data.messageLength,
      msgHasMedia: data.hasMedia
    },
    `[Message] Incoming ${data.messageType} message`,
    ['message']
  );
}

/** Лог для исходящего сообщения */
export function logOutgoingMessage(
  ctxLogger: ContextLogger,
  data: {
    messageLength: number;
    chunksCount: number;
    latencyMs: number;
    success: boolean;
  }
): void {
  if (data.success) {
    ctxLogger.info(
      {
        msgLength: data.messageLength,
        msgChunks: data.chunksCount,
        msgLatencyMs: data.latencyMs
      },
      `[Message] Sent response (${data.chunksCount} chunks)`,
      ['message']
    );
  } else {
    ctxLogger.warn(
      {
        msgLength: data.messageLength,
        msgLatencyMs: data.latencyMs
      },
      `[Message] Failed to send response`,
      ['message']
    );
  }
}

// ============ RETRY ЛОГИКА ============

/** Конфигурация retry */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/** Дефолтная конфигурация retry */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2
};

/** Рассчитать задержку для retry с jitter */
export function calculateRetryDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  const delay = Math.min(
    config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt),
    config.maxDelayMs
  );
  // Добавляем jitter ±20%
  const jitter = delay * 0.2 * (Math.random() - 0.5) * 2;
  return Math.round(delay + jitter);
}

/** Выполнить функцию с retry */
export async function withRetry<T>(
  fn: () => Promise<T>,
  ctxLog: ContextLogger,
  operationName: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = calculateRetryDelay(attempt - 1, config);
        ctxLog.debug({
          attempt,
          maxRetries: config.maxRetries,
          delayMs: delay,
          operation: operationName
        }, `[Retry] Attempt ${attempt}/${config.maxRetries} after ${delay}ms delay`, ['processing']);

        await new Promise(resolve => setTimeout(resolve, delay));
      }

      return await fn();
    } catch (error: any) {
      lastError = error;
      const { isRetryable } = classifyError(error);

      ctxLog.warn({
        attempt,
        maxRetries: config.maxRetries,
        operation: operationName,
        errorMessage: error?.message,
        isRetryable
      }, `[Retry] Attempt ${attempt} failed for ${operationName}`, ['processing']);

      if (!isRetryable || attempt >= config.maxRetries) {
        break;
      }
    }
  }

  throw lastError;
}

// ============ RATE LIMITING ============

/** Состояние rate limiter для конкретного ключа */
interface RateLimitState {
  tokens: number;
  lastRefill: number;
}

/** In-memory rate limiter (для одного процесса) */
const rateLimitStates = new Map<string, RateLimitState>();

/** Конфигурация rate limiter */
export interface RateLimitConfig {
  maxTokens: number;      // Максимальное количество токенов
  refillRate: number;     // Токенов в секунду
  tokensPerRequest: number; // Токенов на запрос
}

/** Дефолтная конфигурация (10 сообщений в минуту) */
export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxTokens: 10,
  refillRate: 0.167, // ~10 в минуту
  tokensPerRequest: 1
};

/** Проверить rate limit */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT,
  ctxLog?: ContextLogger
): { allowed: boolean; remainingTokens: number; retryAfterMs?: number } {
  const now = Date.now();
  let state = rateLimitStates.get(key);

  if (!state) {
    state = { tokens: config.maxTokens, lastRefill: now };
    rateLimitStates.set(key, state);
  }

  // Пополнить токены
  const elapsed = (now - state.lastRefill) / 1000;
  const refill = elapsed * config.refillRate;
  state.tokens = Math.min(config.maxTokens, state.tokens + refill);
  state.lastRefill = now;

  // Проверить доступность
  if (state.tokens >= config.tokensPerRequest) {
    state.tokens -= config.tokensPerRequest;

    ctxLog?.debug({
      rateLimitKey: key,
      remainingTokens: Math.round(state.tokens * 100) / 100,
      maxTokens: config.maxTokens
    }, '[RateLimit] Request allowed', ['processing']);

    return { allowed: true, remainingTokens: state.tokens };
  }

  // Рассчитать время до следующего доступного токена
  const tokensNeeded = config.tokensPerRequest - state.tokens;
  const retryAfterMs = Math.ceil((tokensNeeded / config.refillRate) * 1000);

  ctxLog?.warn({
    rateLimitKey: key,
    remainingTokens: Math.round(state.tokens * 100) / 100,
    retryAfterMs
  }, '[RateLimit] Request throttled', ['processing']);

  return { allowed: false, remainingTokens: state.tokens, retryAfterMs };
}

/** Очистить rate limit state для ключа */
export function resetRateLimit(key: string): void {
  rateLimitStates.delete(key);
}

// ============ ПОДСЧЁТ СТОИМОСТИ ТОКЕНОВ ============

/** Цены за 1K токенов в центах (примерные на декабрь 2024) */
export const TOKEN_PRICES: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.25, output: 1.0 },
  'gpt-4o-mini': { input: 0.015, output: 0.06 },
  'gpt-4-turbo': { input: 1.0, output: 3.0 },
  'gpt-3.5-turbo': { input: 0.05, output: 0.15 }
};

/** Рассчитать стоимость API вызова */
export function calculateApiCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): { inputCostCents: number; outputCostCents: number; totalCostCents: number } {
  const prices = TOKEN_PRICES[model] || TOKEN_PRICES['gpt-4o-mini'];

  const inputCostCents = (promptTokens / 1000) * prices.input;
  const outputCostCents = (completionTokens / 1000) * prices.output;
  const totalCostCents = inputCostCents + outputCostCents;

  return {
    inputCostCents: Math.round(inputCostCents * 1000) / 1000,
    outputCostCents: Math.round(outputCostCents * 1000) / 1000,
    totalCostCents: Math.round(totalCostCents * 1000) / 1000
  };
}

/** Расширенный лог для OpenAI с стоимостью */
export function logOpenAiCallWithCost(
  ctxLogger: ContextLogger,
  data: {
    model: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    latencyMs: number;
    success: boolean;
    errorMessage?: string;
  }
): void {
  if (data.success && data.promptTokens && data.completionTokens) {
    const cost = calculateApiCost(data.model, data.promptTokens, data.completionTokens);

    ctxLogger.info(
      {
        aiModel: data.model,
        aiPromptTokens: data.promptTokens,
        aiCompletionTokens: data.completionTokens,
        aiTotalTokens: data.totalTokens,
        aiLatencyMs: data.latencyMs,
        aiInputCostCents: cost.inputCostCents,
        aiOutputCostCents: cost.outputCostCents,
        aiTotalCostCents: cost.totalCostCents
      },
      `[OpenAI] API call completed (${data.model}) - $${(cost.totalCostCents / 100).toFixed(4)}`,
      ['openai', 'api']
    );
  } else {
    logOpenAiCall(ctxLogger, data);
  }
}

// ============ ВАЛИДАЦИЯ И САНИТИЗАЦИЯ ============

/** Максимальные размеры */
export const LIMITS = {
  MAX_MESSAGE_LENGTH: 50000,      // Максимальная длина сообщения
  MAX_HISTORY_MESSAGES: 100,      // Максимум сообщений в истории
  MAX_SYSTEM_PROMPT_LENGTH: 10000 // Максимальная длина системного промпта
};

/** Валидировать входящее сообщение */
export function validateMessage(
  message: string | undefined,
  ctxLog?: ContextLogger
): { valid: boolean; sanitized: string; warnings: string[] } {
  const warnings: string[] = [];

  if (!message) {
    return { valid: false, sanitized: '', warnings: ['Message is empty'] };
  }

  let sanitized = message;

  // Проверить длину
  if (sanitized.length > LIMITS.MAX_MESSAGE_LENGTH) {
    const originalLength = sanitized.length;
    sanitized = sanitized.substring(0, LIMITS.MAX_MESSAGE_LENGTH);
    warnings.push(`Message truncated from ${originalLength} to ${LIMITS.MAX_MESSAGE_LENGTH} chars`);

    ctxLog?.warn({
      originalLength,
      truncatedTo: LIMITS.MAX_MESSAGE_LENGTH
    }, '[Validation] Message truncated due to length limit', ['validation']);
  }

  // Удалить null bytes и другие проблемные символы
  const beforeSanitize = sanitized.length;
  sanitized = sanitized.replace(/\x00/g, '').replace(/\uFFFD/g, '');
  if (sanitized.length !== beforeSanitize) {
    warnings.push('Removed null bytes or replacement characters');
  }

  return { valid: true, sanitized, warnings };
}

// ============ DUPLICATE DETECTION ============

/** Хранилище для обнаружения дубликатов */
const recentMessages = new Map<string, { hash: string; timestamp: number }>();

/** Очистка старых записей (каждые 5 минут) */
const DUPLICATE_WINDOW_MS = 60000; // 1 минута

/** Создать хэш сообщения */
function hashMessage(phone: string, message: string): string {
  // Простой хэш для быстрого сравнения
  let hash = 0;
  const str = `${phone}:${message}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(16);
}

/** Проверить на дубликат сообщения */
export function isDuplicateMessage(
  phone: string,
  instanceName: string,
  message: string,
  ctxLog?: ContextLogger
): boolean {
  const now = Date.now();
  const key = `${instanceName}:${phone}`;
  const hash = hashMessage(phone, message);

  // Очистить старые записи
  for (const [k, v] of recentMessages.entries()) {
    if (now - v.timestamp > DUPLICATE_WINDOW_MS) {
      recentMessages.delete(k);
    }
  }

  const existing = recentMessages.get(key);
  if (existing && existing.hash === hash && (now - existing.timestamp) < DUPLICATE_WINDOW_MS) {
    ctxLog?.warn({
      phone: maskPhone(phone),
      instance: instanceName,
      timeSinceLastMs: now - existing.timestamp
    }, '[Duplicate] Duplicate message detected, skipping', ['validation', 'message']);
    return true;
  }

  recentMessages.set(key, { hash, timestamp: now });
  return false;
}

// ============ FLOW LOGGING ============

/** Типы этапов обработки сообщения */
export type ProcessingStage =
  | 'received'
  | 'validated'
  | 'config_loaded'
  | 'lead_loaded'
  | 'conditions_checked'
  | 'buffered'
  | 'history_loaded'
  | 'ai_called'
  | 'response_generated'
  | 'message_sent'
  | 'function_executed'
  | 'completed'
  | 'failed';

/** Лог перехода между этапами */
export function logStageTransition(
  ctxLog: ContextLogger,
  fromStage: ProcessingStage,
  toStage: ProcessingStage,
  data?: Record<string, any>
): void {
  ctxLog.info({
    fromStage,
    toStage,
    ...data
  }, `[Flow] ${fromStage} → ${toStage}`, ['processing']);

  ctxLog.checkpoint(toStage);
}

/** Создать summary лог в конце обработки */
export function logProcessingSummary(
  ctxLog: ContextLogger,
  data: {
    success: boolean;
    finalStage: ProcessingStage;
    responseLength?: number;
    tokensUsed?: number;
    costCents?: number;
    errorMessage?: string;
  }
): void {
  const timings = ctxLog.getTimings();

  if (data.success) {
    ctxLog.info({
      finalStage: data.finalStage,
      responseLen: data.responseLength,
      tokensUsed: data.tokensUsed,
      costCents: data.costCents,
      ...timings
    }, '[Flow] === PROCESSING COMPLETED SUCCESSFULLY ===', ['processing']);
  } else {
    ctxLog.error(new Error(data.errorMessage || 'Unknown error'),
      '[Flow] === PROCESSING FAILED ===',
      {
        finalStage: data.finalStage,
        ...timings
      },
      ['processing']
    );
  }
}

// ============ SAFE JSON PARSE ============

/** Безопасный JSON.parse с логированием */
export function safeJsonParse<T>(
  json: string,
  defaultValue: T,
  ctxLog?: ContextLogger,
  context?: string
): T {
  try {
    return JSON.parse(json) as T;
  } catch (error: any) {
    ctxLog?.warn({
      jsonPreview: truncateText(json, 100),
      context,
      errorMessage: error?.message
    }, '[JSON] Failed to parse JSON, using default', ['validation']);
    return defaultValue;
  }
}
