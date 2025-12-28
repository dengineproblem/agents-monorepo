/**
 * Consultation Tools - функции для интеграции AI-бота с системой консультаций
 *
 * Эти функции позволяют боту:
 * - Показывать свободные слоты
 * - Записывать клиентов на консультации
 * - Отменять и переносить записи
 * - Показывать текущие записи клиента
 *
 * Features:
 * - Retry logic с exponential backoff для HTTP запросов
 * - Таймауты для защиты от зависших запросов
 * - Валидация ответов API
 * - Структурированное логирование с тегами
 */

import OpenAI from 'openai';
import { createLogger } from './logger.js';
import { ContextLogger, createContextLogger, maskPhone, maskUuid, classifyError } from './logUtils.js';

const baseLog = createLogger({ module: 'consultationTools' });

// URL CRM Backend
const CRM_BACKEND_URL = process.env.CRM_BACKEND_URL || 'http://localhost:8084';

// Конфигурация HTTP запросов
const HTTP_CONFIG = {
  timeoutMs: 10000,        // 10 секунд таймаут
  maxRetries: 2,           // 2 попытки (всего 3 запроса)
  baseDelayMs: 500,        // начальная задержка 500мс
  backoffMultiplier: 2     // множитель для exponential backoff
};

/**
 * Обёртка для fetch с таймаутом и retry логикой
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  log: ContextLogger,
  operationName: string
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= HTTP_CONFIG.maxRetries; attempt++) {
    try {
      // Создаём AbortController для таймаута
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HTTP_CONFIG.timeoutMs);

      const startTime = Date.now();

      log.debug({
        attempt: attempt + 1,
        maxAttempts: HTTP_CONFIG.maxRetries + 1,
        url: url.split('?')[0],  // URL без query params для безопасности
        method: options.method || 'GET'
      }, `[${operationName}] HTTP request attempt ${attempt + 1}`, ['api', 'consultation']);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const latencyMs = Date.now() - startTime;

      log.debug({
        status: response.status,
        latencyMs,
        attempt: attempt + 1
      }, `[${operationName}] HTTP response received`, ['api', 'consultation']);

      return response;

    } catch (error: any) {
      lastError = error;

      const errorType = classifyError(error);

      // Не ретраим если это не retryable ошибка
      if (!errorType.isRetryable) {
        log.warn({
          errorType: errorType.type,
          message: error.message,
          isRetryable: false
        }, `[${operationName}] Non-retryable error, giving up`, ['api', 'consultation']);
        throw error;
      }

      // Если это последняя попытка - бросаем ошибку
      if (attempt >= HTTP_CONFIG.maxRetries) {
        log.error(error, `[${operationName}] All retry attempts exhausted`, {
          attempts: attempt + 1,
          errorType: errorType.type
        }, ['api', 'consultation']);
        throw error;
      }

      // Вычисляем задержку с exponential backoff
      const delayMs = HTTP_CONFIG.baseDelayMs * Math.pow(HTTP_CONFIG.backoffMultiplier, attempt);

      log.warn({
        attempt: attempt + 1,
        nextAttemptIn: delayMs,
        errorType: errorType.type,
        message: error.message
      }, `[${operationName}] Request failed, retrying after ${delayMs}ms`, ['api', 'consultation']);

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError || new Error('Unknown error in fetchWithRetry');
}

/**
 * Настройки интеграции с консультациями
 */
export interface ConsultationIntegrationSettings {
  consultant_ids: string[];           // пустой = все консультанты
  slots_to_show: number;              // кол-во слотов (по умолчанию 5)
  default_duration_minutes: number;   // длительность (по умолчанию 60)
  days_ahead_limit: number;           // дней вперёд (по умолчанию 14)
  auto_summarize_dialog: boolean;     // саммаризация диалога
  collect_client_name: boolean;       // спрашивать имя
}

/**
 * Информация о лиде для функций консультаций
 */
interface LeadInfo {
  id: string;
  contact_phone: string;
  contact_name?: string;
}

/**
 * Получить OpenAI tool definitions для консультаций
 */
export function getConsultationToolDefinitions(
  settings: ConsultationIntegrationSettings
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'get_available_consultation_slots',
        description: `Получить список свободных слотов для записи на консультацию. Используй эту функцию когда клиент хочет записаться на консультацию или узнать доступное время. Показывает до ${settings.slots_to_show} ближайших слотов.`,
        parameters: {
          type: 'object',
          properties: {
            date: {
              type: 'string',
              description: 'Конкретная дата в формате YYYY-MM-DD. Если клиент спрашивает про конкретную дату - укажи её. Если не уточняет - оставь пустым для показа ближайших слотов.'
            }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'book_consultation',
        description: `Записать клиента на консультацию. Используй после того как клиент выбрал конкретное время из предложенных слотов. Длительность консультации: ${settings.default_duration_minutes} минут.`,
        parameters: {
          type: 'object',
          properties: {
            consultant_id: {
              type: 'string',
              description: 'UUID консультанта из списка слотов'
            },
            date: {
              type: 'string',
              description: 'Дата в формате YYYY-MM-DD'
            },
            start_time: {
              type: 'string',
              description: 'Время начала в формате HH:MM'
            },
            client_name: {
              type: 'string',
              description: 'Имя клиента (если известно)'
            }
          },
          required: ['consultant_id', 'date', 'start_time']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'cancel_consultation',
        description: 'Отменить запись на консультацию. Используй когда клиент хочет отменить свою запись.',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Причина отмены (опционально)'
            }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'reschedule_consultation',
        description: 'Перенести консультацию на другое время. Используй когда клиент хочет изменить время своей записи.',
        parameters: {
          type: 'object',
          properties: {
            new_date: {
              type: 'string',
              description: 'Новая дата в формате YYYY-MM-DD'
            },
            new_start_time: {
              type: 'string',
              description: 'Новое время начала в формате HH:MM'
            }
          },
          required: ['new_date', 'new_start_time']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_my_consultations',
        description: 'Показать текущие записи клиента на консультации. Используй когда клиент спрашивает о своих записях или хочет узнать когда у него консультация.',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    }
  ];
}

/**
 * Получить промпт-инструкцию для AI о работе с консультациями
 */
export function getConsultationPromptAddition(settings: ConsultationIntegrationSettings): string {
  return `

## Запись на консультацию

У тебя есть возможность записывать клиентов на консультацию.

Доступные функции:
- get_available_consultation_slots — показать свободные слоты для записи
- book_consultation — записать клиента на выбранное время
- cancel_consultation — отменить запись
- reschedule_consultation — перенести запись на другое время
- get_my_consultations — показать текущие записи клиента

Правила работы:
1. Если клиент хочет записаться — сначала покажи доступные слоты
2. Предложи клиенту выбрать удобное время из списка
3. После выбора времени — уточни имя клиента (если не знаешь)
4. Запиши клиента и подтверди запись
5. Если клиент хочет отменить или перенести — используй соответствующие функции

Параметры:
- Длительность консультации: ${settings.default_duration_minutes} минут
- Показывать слотов: ${settings.slots_to_show}
- Дней вперёд: ${settings.days_ahead_limit}`;
}

/**
 * Обработчик: Получить доступные слоты
 */
export async function handleGetAvailableSlots(
  args: { date?: string },
  lead: LeadInfo,
  settings: ConsultationIntegrationSettings,
  ctxLog?: ContextLogger
): Promise<string> {
  const log = ctxLog || createContextLogger(baseLog, { leadId: lead.id }, ['consultation']);

  log.info({
    date: args.date,
    consultantIds: settings.consultant_ids?.length || 'all',
    slotsToShow: settings.slots_to_show,
    daysAhead: settings.days_ahead_limit
  }, '[handleGetAvailableSlots] Fetching available slots', ['consultation']);

  try {
    const params = new URLSearchParams({
      duration_minutes: String(settings.default_duration_minutes),
      limit: String(settings.slots_to_show),
      days_ahead: String(settings.days_ahead_limit)
    });

    if (args.date) {
      params.append('date', args.date);
    }

    if (settings.consultant_ids?.length) {
      params.append('consultant_ids', settings.consultant_ids.join(','));
    }

    const url = `${CRM_BACKEND_URL}/consultations/available-slots?${params}`;

    const response = await fetchWithRetry(
      url,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      log,
      'handleGetAvailableSlots'
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      log.error({
        status: response.status,
        statusText: response.statusText,
        errorBody: errorBody.substring(0, 200)
      }, '[handleGetAvailableSlots] API returned error status', {}, ['api', 'consultation']);
      return 'К сожалению, не удалось получить доступные слоты. Попробуйте позже.';
    }

    let data: any;
    try {
      data = await response.json();
    } catch (parseError) {
      log.error(parseError, '[handleGetAvailableSlots] Failed to parse JSON response', {}, ['api', 'consultation']);
      return 'Произошла ошибка при обработке данных. Попробуйте позже.';
    }

    // Валидация ответа
    if (!data || typeof data !== 'object') {
      log.warn({ dataType: typeof data }, '[handleGetAvailableSlots] Invalid response format', ['api', 'consultation']);
      return 'Получен некорректный ответ от сервера. Попробуйте позже.';
    }

    if (!data.slots?.length) {
      log.info({
        hasSlots: !!data.slots,
        slotsCount: data.slots?.length || 0
      }, '[handleGetAvailableSlots] No slots available', ['consultation']);
      return 'К сожалению, сейчас нет доступных слотов для записи. Попробуйте выбрать другую дату.';
    }

    log.info({
      slotsCount: data.slots.length,
      firstSlot: data.slots[0]?.formatted
    }, '[handleGetAvailableSlots] Slots found successfully', ['consultation']);

    // Формируем текстовый ответ со слотами
    const slotsText = data.slots.map((slot: any, idx: number) => {
      return `${idx + 1}. ${slot.formatted} [ID: ${slot.consultant_id}, дата: ${slot.date}, время: ${slot.start_time}]`;
    }).join('\n');

    return `Доступные слоты для записи:\n\n${slotsText}\n\nКакое время вам подходит?`;
  } catch (error: any) {
    const errorType = classifyError(error);
    log.error(error, '[handleGetAvailableSlots] Error fetching slots', {
      errorType: errorType.type,
      isRetryable: errorType.isRetryable
    }, ['api', 'consultation']);
    return 'Произошла ошибка при получении доступных слотов. Попробуйте позже.';
  }
}

/**
 * Обработчик: Записать на консультацию
 */
export async function handleBookConsultation(
  args: { consultant_id: string; date: string; start_time: string; client_name?: string },
  lead: LeadInfo,
  settings: ConsultationIntegrationSettings,
  ctxLog?: ContextLogger
): Promise<string> {
  const log = ctxLog || createContextLogger(baseLog, { leadId: lead.id }, ['consultation']);

  // Валидация обязательных параметров
  if (!args.consultant_id || !args.date || !args.start_time) {
    log.warn({
      hasConsultantId: !!args.consultant_id,
      hasDate: !!args.date,
      hasStartTime: !!args.start_time
    }, '[handleBookConsultation] Missing required parameters', ['consultation', 'validation']);
    return 'Не указаны обязательные параметры для записи. Пожалуйста, выберите слот из списка.';
  }

  log.info({
    consultantId: maskUuid(args.consultant_id),
    date: args.date,
    time: args.start_time,
    clientName: args.client_name || lead.contact_name,
    duration: settings.default_duration_minutes
  }, '[handleBookConsultation] Booking consultation', ['consultation']);

  try {
    const url = `${CRM_BACKEND_URL}/consultations/book-from-bot`;
    const requestBody = {
      dialog_analysis_id: lead.id,
      consultant_id: args.consultant_id,
      date: args.date,
      start_time: args.start_time,
      duration_minutes: settings.default_duration_minutes,
      client_name: args.client_name || lead.contact_name,
      auto_summarize: settings.auto_summarize_dialog
    };

    const response = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      },
      log,
      'handleBookConsultation'
    );

    let data: any;
    try {
      data = await response.json();
    } catch (parseError) {
      log.error(parseError, '[handleBookConsultation] Failed to parse JSON response', {}, ['api', 'consultation']);
      return 'Произошла ошибка при обработке ответа сервера. Попробуйте позже.';
    }

    if (!response.ok) {
      log.warn({
        status: response.status,
        message: data.message,
        code: data.code
      }, '[handleBookConsultation] Booking failed', ['api', 'consultation']);
      return data.message || 'Не удалось записать на это время. Пожалуйста, выберите другой слот.';
    }

    log.info({
      consultationId: data.consultation?.id ? maskUuid(data.consultation.id) : null,
      confirmed: !!data.confirmation_message
    }, '[handleBookConsultation] Consultation booked successfully', ['consultation']);

    return data.confirmation_message || 'Вы успешно записаны на консультацию!';
  } catch (error: any) {
    const errorType = classifyError(error);
    log.error(error, '[handleBookConsultation] Error booking consultation', {
      errorType: errorType.type,
      isRetryable: errorType.isRetryable
    }, ['api', 'consultation']);
    return 'Произошла ошибка при записи. Попробуйте позже.';
  }
}

/**
 * Обработчик: Отменить консультацию
 */
export async function handleCancelConsultation(
  args: { reason?: string },
  lead: LeadInfo,
  ctxLog?: ContextLogger
): Promise<string> {
  const log = ctxLog || createContextLogger(baseLog, { leadId: lead.id }, ['consultation']);

  log.info({
    leadId: maskUuid(lead.id),
    reason: args.reason || 'not specified',
    phone: maskPhone(lead.contact_phone)
  }, '[handleCancelConsultation] Cancelling consultation', ['consultation']);

  try {
    const url = `${CRM_BACKEND_URL}/consultations/cancel-from-bot`;
    const requestBody = {
      dialog_analysis_id: lead.id,
      reason: args.reason
    };

    const response = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      },
      log,
      'handleCancelConsultation'
    );

    let data: any;
    try {
      data = await response.json();
    } catch (parseError) {
      log.error(parseError, '[handleCancelConsultation] Failed to parse JSON response', {}, ['api', 'consultation']);
      return 'Произошла ошибка при обработке ответа сервера. Попробуйте позже.';
    }

    if (!response.ok) {
      log.warn({
        status: response.status,
        message: data.message,
        code: data.code
      }, '[handleCancelConsultation] Cancel failed', ['api', 'consultation']);
      return data.message || 'Не удалось отменить запись.';
    }

    log.info({
      cancelled: true,
      message: data.message
    }, '[handleCancelConsultation] Consultation cancelled successfully', ['consultation']);

    return data.message || 'Ваша запись отменена.';
  } catch (error: any) {
    const errorType = classifyError(error);
    log.error(error, '[handleCancelConsultation] Error cancelling consultation', {
      errorType: errorType.type,
      isRetryable: errorType.isRetryable
    }, ['api', 'consultation']);
    return 'Произошла ошибка при отмене записи. Попробуйте позже.';
  }
}

/**
 * Обработчик: Перенести консультацию
 */
export async function handleRescheduleConsultation(
  args: { new_date: string; new_start_time: string },
  lead: LeadInfo,
  settings: ConsultationIntegrationSettings,
  ctxLog?: ContextLogger
): Promise<string> {
  const log = ctxLog || createContextLogger(baseLog, { leadId: lead.id }, ['consultation']);

  // Валидация обязательных параметров
  if (!args.new_date || !args.new_start_time) {
    log.warn({
      hasNewDate: !!args.new_date,
      hasNewTime: !!args.new_start_time
    }, '[handleRescheduleConsultation] Missing required parameters', ['consultation', 'validation']);
    return 'Не указаны новые дата и время для переноса. Пожалуйста, выберите слот из списка.';
  }

  log.info({
    leadId: maskUuid(lead.id),
    newDate: args.new_date,
    newTime: args.new_start_time,
    duration: settings.default_duration_minutes
  }, '[handleRescheduleConsultation] Rescheduling consultation', ['consultation']);

  try {
    const url = `${CRM_BACKEND_URL}/consultations/reschedule-from-bot`;
    const requestBody = {
      dialog_analysis_id: lead.id,
      new_date: args.new_date,
      new_start_time: args.new_start_time,
      duration_minutes: settings.default_duration_minutes
    };

    const response = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      },
      log,
      'handleRescheduleConsultation'
    );

    let data: any;
    try {
      data = await response.json();
    } catch (parseError) {
      log.error(parseError, '[handleRescheduleConsultation] Failed to parse JSON response', {}, ['api', 'consultation']);
      return 'Произошла ошибка при обработке ответа сервера. Попробуйте позже.';
    }

    if (!response.ok) {
      log.warn({
        status: response.status,
        message: data.message,
        code: data.code
      }, '[handleRescheduleConsultation] Reschedule failed', ['api', 'consultation']);
      return data.message || 'Не удалось перенести запись на это время. Выберите другой слот.';
    }

    log.info({
      rescheduled: true,
      newDate: args.new_date,
      newTime: args.new_start_time
    }, '[handleRescheduleConsultation] Consultation rescheduled successfully', ['consultation']);

    return data.message || 'Ваша консультация перенесена.';
  } catch (error: any) {
    const errorType = classifyError(error);
    log.error(error, '[handleRescheduleConsultation] Error rescheduling consultation', {
      errorType: errorType.type,
      isRetryable: errorType.isRetryable
    }, ['api', 'consultation']);
    return 'Произошла ошибка при переносе записи. Попробуйте позже.';
  }
}

/**
 * Обработчик: Получить записи клиента
 */
export async function handleGetMyConsultations(
  lead: LeadInfo,
  ctxLog?: ContextLogger
): Promise<string> {
  const log = ctxLog || createContextLogger(baseLog, { leadId: lead.id }, ['consultation']);

  log.info({
    leadId: maskUuid(lead.id),
    phone: maskPhone(lead.contact_phone)
  }, '[handleGetMyConsultations] Fetching client consultations', ['consultation']);

  try {
    const url = `${CRM_BACKEND_URL}/consultations/by-lead/${lead.id}`;

    const response = await fetchWithRetry(
      url,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      log,
      'handleGetMyConsultations'
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      log.error({
        status: response.status,
        statusText: response.statusText,
        errorBody: errorBody.substring(0, 200)
      }, '[handleGetMyConsultations] API returned error status', {}, ['api', 'consultation']);
      return 'Не удалось получить информацию о записях.';
    }

    let data: any;
    try {
      data = await response.json();
    } catch (parseError) {
      log.error(parseError, '[handleGetMyConsultations] Failed to parse JSON response', {}, ['api', 'consultation']);
      return 'Произошла ошибка при обработке данных. Попробуйте позже.';
    }

    // Валидация ответа
    if (!data || typeof data !== 'object') {
      log.warn({ dataType: typeof data }, '[handleGetMyConsultations] Invalid response format', ['api', 'consultation']);
      return 'Получен некорректный ответ от сервера. Попробуйте позже.';
    }

    if (!data.has_consultations) {
      log.info({
        hasConsultations: false,
        message: data.message
      }, '[handleGetMyConsultations] No consultations found', ['consultation']);
      return data.message || 'У вас пока нет записей на консультацию.';
    }

    // Проверяем что consultations это массив
    if (!Array.isArray(data.consultations)) {
      log.warn({
        consultationsType: typeof data.consultations
      }, '[handleGetMyConsultations] Consultations is not an array', ['api', 'consultation']);
      return 'Получен некорректный формат данных о записях.';
    }

    log.info({
      count: data.consultations.length,
      statuses: data.consultations.map((c: any) => c.status)
    }, '[handleGetMyConsultations] Consultations found', ['consultation']);

    const consultationsText = data.consultations.map((c: any, idx: number) => {
      return `${idx + 1}. ${c.formatted} (статус: ${c.status})`;
    }).join('\n');

    return `Ваши записи на консультацию:\n\n${consultationsText}`;
  } catch (error: any) {
    const errorType = classifyError(error);
    log.error(error, '[handleGetMyConsultations] Error fetching consultations', {
      errorType: errorType.type,
      isRetryable: errorType.isRetryable
    }, ['api', 'consultation']);
    return 'Произошла ошибка при получении записей. Попробуйте позже.';
  }
}

/**
 * Проверить, является ли функция consultation tool
 */
export function isConsultationTool(functionName: string): boolean {
  const consultationTools = [
    'get_available_consultation_slots',
    'book_consultation',
    'cancel_consultation',
    'reschedule_consultation',
    'get_my_consultations'
  ];
  return consultationTools.includes(functionName);
}

/**
 * Обработать вызов consultation tool
 */
export async function handleConsultationTool(
  functionName: string,
  args: any,
  lead: LeadInfo,
  settings: ConsultationIntegrationSettings,
  ctxLog?: ContextLogger
): Promise<string> {
  switch (functionName) {
    case 'get_available_consultation_slots':
      return handleGetAvailableSlots(args, lead, settings, ctxLog);

    case 'book_consultation':
      return handleBookConsultation(args, lead, settings, ctxLog);

    case 'cancel_consultation':
      return handleCancelConsultation(args, lead, ctxLog);

    case 'reschedule_consultation':
      return handleRescheduleConsultation(args, lead, settings, ctxLog);

    case 'get_my_consultations':
      return handleGetMyConsultations(lead, ctxLog);

    default:
      return 'Неизвестная функция консультаций.';
  }
}
