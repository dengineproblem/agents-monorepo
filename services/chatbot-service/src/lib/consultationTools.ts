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
  timezone?: string;                  // таймзона для фильтрации слотов (по умолчанию Asia/Yekaterinburg)
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
  // Получаем текущую дату в нужной таймзоне для описания функций
  const now = new Date();
  const timezone = settings.timezone || 'Europe/Moscow';
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  });
  const todayFormatted = formatter.format(now);
  const todayISO = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD

  return [
    {
      type: 'function',
      function: {
        name: 'get_nearest_slots',
        description: `Получить ближайшие 10 свободных слотов для записи на консультацию. ВАЖНО: Сегодня ${todayFormatted} (${todayISO}). Используй когда клиент хочет записаться и не указывает конкретную дату.`,
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_slots_for_date',
        description: `Получить ВСЕ свободные слоты на конкретную дату. ВАЖНО: Сегодня ${todayFormatted} (${todayISO}). Используй когда клиент называет конкретный день (завтра, 6 января, в понедельник и т.д.).`,
        parameters: {
          type: 'object',
          properties: {
            date: {
              type: 'string',
              description: 'Дата в формате YYYY-MM-DD'
            }
          },
          required: ['date']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'book_consultation',
        description: `Записать клиента на консультацию. ВАЖНО: Сегодня ${todayFormatted} (${todayISO}). Используй consultant_id из списка в системном промпте. Бери date и start_time ТОЛЬКО из результата get_nearest_slots или get_slots_for_date! НЕ выдумывай даты. Длительность: ${settings.default_duration_minutes} минут.`,
        parameters: {
          type: 'object',
          properties: {
            consultant_id: {
              type: 'string',
              description: 'ID консультанта из системного промпта (6 символов). НЕ выдумывай — бери из списка "Доступные консультанты и их ID"!'
            },
            date: {
              type: 'string',
              description: 'Дата слота в формате YYYY-MM-DD из результата get_nearest_slots или get_slots_for_date'
            },
            start_time: {
              type: 'string',
              description: 'Время слота в формате HH:MM из результата get_nearest_slots или get_slots_for_date'
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
    },
    {
      type: 'function',
      function: {
        name: 'get_consultant_info',
        description: 'Получить информацию о консультанте: имя, специализация, описание. Используй когда клиент спрашивает кто будет проводить консультацию.',
        parameters: {
          type: 'object',
          properties: {
            consultant_id: {
              type: 'string',
              description: 'UUID консультанта из списка слотов'
            }
          },
          required: ['consultant_id']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_consultant_schedule',
        description: 'Получить расписание работы консультанта по дням недели. Используй когда клиент хочет узнать в какие дни работает консультант.',
        parameters: {
          type: 'object',
          properties: {
            consultant_id: {
              type: 'string',
              description: 'UUID консультанта'
            }
          },
          required: ['consultant_id']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_consultation_history',
        description: 'Получить историю всех консультаций клиента включая прошедшие, отменённые и завершённые. Используй чтобы понять взаимодействие клиента с компанией.',
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
 * Информация о консультанте для промпта
 */
interface ConsultantInfo {
  id: string;
  name: string;
  short_id: string;  // первые 6 символов UUID консультанта
}

/**
 * Загрузить информацию о консультантах
 */
export async function loadConsultantsInfo(consultantIds?: string[]): Promise<ConsultantInfo[]> {
  try {
    const url = new URL(`${CRM_BACKEND_URL}/consultants`);
    if (consultantIds?.length) {
      url.searchParams.set('ids', consultantIds.join(','));
    }
    url.searchParams.set('active_only', 'true');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      baseLog.warn({ status: response.status }, '[loadConsultantsInfo] Failed to load consultants');
      return [];
    }

    const data = await response.json() as { consultants?: any[] } | any[];
    const consultants = Array.isArray(data) ? data : (data.consultants || []);

    return consultants.map((c: any) => ({
      id: c.id,
      name: c.name,
      short_id: c.id.substring(0, 6)
    }));
  } catch (error) {
    baseLog.error(error, '[loadConsultantsInfo] Error loading consultants');
    return [];
  }
}

/**
 * Получить промпт-инструкцию для AI о работе с консультациями
 */
export async function getConsultationPromptAddition(
  settings: ConsultationIntegrationSettings,
  consultants?: ConsultantInfo[]
): Promise<string> {
  // Загружаем консультантов если не переданы
  const consultantsList = consultants || await loadConsultantsInfo(settings.consultant_ids);

  // Формируем список консультантов с их ID
  let consultantsSection = '';
  if (consultantsList.length > 0) {
    const consultantsText = consultantsList.map(c =>
      `- ${c.name}: consultant_id = "${c.short_id}"`
    ).join('\n');
    consultantsSection = `

## Доступные консультанты и их ID

ВАЖНО: При записи на консультацию используй ТОЛЬКО эти consultant_id:
${consultantsText}

Когда клиент выбирает слот, бери consultant_id из этого списка!`;
  }

  return `

## Запись на консультацию

У тебя есть возможность записывать клиентов на консультацию.
${consultantsSection}

ВАЖНО: Названия функций — это ВНУТРЕННИЕ инструменты. НИКОГДА не пиши клиенту названия функций! Клиент не должен знать о существовании этих функций. Просто выполняй их молча и показывай результат человеческим языком.

### Как получать слоты

У тебя есть ДВЕ функции для получения слотов:

1. **get_nearest_slots** (без параметров) — используй когда:
   - Клиент просто хочет записаться без указания конкретной даты
   - "Хочу записаться", "Когда можно прийти?", "Есть свободные слоты?"
   - Возвращает 10 ближайших свободных слотов

2. **get_slots_for_date** (параметр: date) — используй когда:
   - Клиент называет конкретный день: "завтра", "в понедельник", "6 января"
   - "Какие есть слоты на завтра?", "Что свободно в пятницу?"
   - Возвращает ВСЕ слоты на указанную дату

ВАЖНО: Если клиент не доволен предложенными ближайшими слотами (например, хочет вечером, а ты показал утренние) — спроси на какой день ему удобно и используй get_slots_for_date чтобы показать ВСЕ слоты на этот день.

### Правила работы

1. Если клиент хочет записаться — сначала покажи доступные слоты (get_nearest_slots)
2. Если клиент хочет другое время/день — используй get_slots_for_date
3. Предложи клиенту выбрать удобное время из списка
4. ВАЖНО — Имя клиента для записи:
   - Посмотри "Имя из WhatsApp" в информации о клиенте выше
   - Если это настоящее имя — используй его для записи
   - Если это мусор или не указано — спроси как обращаться и сохрани через update_lead_info
   - При записи передавай имя в client_name
5. Для записи используй consultant_id из списка выше + date + start_time из слота
6. Если клиент хочет отменить или перенести — используй соответствующие функции

### КРИТИЧЕСКИ ВАЖНО — Контекст разговора

ЗАПОМИНАЙ КОНТЕКСТ! Если клиент уже сказал дату и потом уточняет время:
- Клиент: "на завтра" → ты показал утренние слоты
- Клиент: "вечером хочу" → СРАЗУ покажи вечерние слоты НА ЗАВТРА, НЕ переспрашивай "на какой день"!

Если клиент уточняет время суток (утро/день/вечер) после того как уже назвал дату — используй ТУ ЖЕ дату!

### КРИТИЧЕСКИ ВАЖНО — Проверка слотов

ЗАПРЕЩЕНО говорить "нет слотов" или "всё занято" БЕЗ вызова функции!
Когда клиент называет конкретную дату ("7 января", "в среду") — ты ОБЯЗАН вызвать get_slots_for_date!

Алгоритм:
1. Клиент называет дату → ВЫЗОВИ get_slots_for_date
2. Функция вернула слоты → покажи их
3. Функция вернула пустой список → ТОГДА скажи что на эту дату нет свободного времени

Если ты не вызвал функцию — ты НЕ ЗНАЕШЬ есть ли слоты! НЕ ВЫДУМЫВАЙ!

### Как показывать слоты клиенту

Функция возвращает МНОГО слотов (10-20). НИКОГДА не показывай все!

Выбирай 3-5 лучших слотов:
1. Если есть слоты в разное время суток — выбери по одному из каждого периода:
   - Утро (09:00-12:00)
   - День (12:00-15:00)
   - Вечер (15:00-18:00)
2. Если все слоты только в одном периоде — выбери 3-5 с интервалом

ВАЖНО: Показанные клиенту слоты — это НЕ единственные доступные! Это примеры для начала.
Если клиент называет другое время ("давай в 11:00"):
1. Посмотри в полный список слотов который ты получил от функции
2. Если 11:00 там есть — записывай на него
3. Если 11:00 нет в списке — скажи что это время занято и предложи ближайшие

НЕ ограничивай клиента только теми слотами которые ты показал! Клиент может выбрать ЛЮБОЙ свободный слот.

Параметры:
- Длительность консультации: ${settings.default_duration_minutes} минут`;
}

/**
 * Обработчик: Получить ближайшие 10 слотов
 */
export async function handleGetNearestSlots(
  lead: LeadInfo,
  settings: ConsultationIntegrationSettings,
  ctxLog?: ContextLogger
): Promise<string> {
  const log = ctxLog || createContextLogger(baseLog, { leadId: lead.id }, ['consultation']);

  log.info({
    consultantIds: settings.consultant_ids?.length || 'all'
  }, '[handleGetNearestSlots] Fetching nearest slots', ['consultation']);

  try {
    const durationMinutes = settings.default_duration_minutes || 60;

    const params = new URLSearchParams({
      duration_minutes: String(durationMinutes),
      limit: '10',
      days_ahead: '7'
    });

    if (settings.consultant_ids?.length) {
      params.append('consultant_ids', settings.consultant_ids.join(','));
    }

    if (settings.timezone) {
      params.append('timezone', settings.timezone);
    }

    const url = `${CRM_BACKEND_URL}/consultations/available-slots?${params}`;

    const response = await fetchWithRetry(
      url,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      log,
      'handleGetNearestSlots'
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      log.error({
        status: response.status,
        statusText: response.statusText,
        errorBody: errorBody.substring(0, 200)
      }, '[handleGetNearestSlots] API returned error status', {}, ['api', 'consultation']);
      return 'К сожалению, не удалось получить доступные слоты. Попробуйте позже.';
    }

    let data: any;
    try {
      data = await response.json();
    } catch (parseError) {
      log.error(parseError, '[handleGetNearestSlots] Failed to parse JSON response', {}, ['api', 'consultation']);
      return 'Произошла ошибка при обработке данных. Попробуйте позже.';
    }

    if (!data || typeof data !== 'object') {
      log.warn({ dataType: typeof data }, '[handleGetNearestSlots] Invalid response format', ['api', 'consultation']);
      return 'Получен некорректный ответ от сервера. Попробуйте позже.';
    }

    if (!data.slots?.length) {
      log.info({ slotsCount: 0 }, '[handleGetNearestSlots] No slots available', ['consultation']);
      return 'К сожалению, сейчас нет доступных слотов для записи.';
    }

    log.info({
      slotsCount: data.slots.length
    }, '[handleGetNearestSlots] Slots found successfully', ['consultation']);

    const slotsText = data.slots.map((slot: any, idx: number) => {
      return `[Слот ${idx + 1}]
Консультант: ${slot.consultant_name}
Время: ${slot.formatted}
date: ${slot.date}
start_time: ${slot.start_time}`;
    }).join('\n\n');

    return `Ближайшие свободные слоты:\n\n${slotsText}\n\nДля записи используй consultant_id из списка консультантов + date и start_time из выбранного слота.`;
  } catch (error: any) {
    const errorType = classifyError(error);
    log.error(error, '[handleGetNearestSlots] Error fetching slots', {
      errorType: errorType.type,
      isRetryable: errorType.isRetryable
    }, ['api', 'consultation']);
    return 'Произошла ошибка при получении слотов. Попробуйте позже.';
  }
}

/**
 * Валидация формата даты YYYY-MM-DD
 */
function isValidDateFormat(dateStr: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;

  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

/**
 * Проверка что дата не в прошлом
 */
function isDateNotInPast(dateStr: string, timezone: string = 'Europe/Moscow'): boolean {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
  return dateStr >= today;
}

/**
 * Обработчик: Получить ВСЕ слоты на конкретную дату
 */
export async function handleGetSlotsForDate(
  args: { date: string },
  lead: LeadInfo,
  settings: ConsultationIntegrationSettings,
  ctxLog?: ContextLogger
): Promise<string> {
  const log = ctxLog || createContextLogger(baseLog, { leadId: lead.id }, ['consultation']);

  // Валидация: дата обязательна
  if (!args.date) {
    log.warn({}, '[handleGetSlotsForDate] Missing date parameter', ['consultation', 'validation']);
    return 'Не указана дата. Укажи дату в формате YYYY-MM-DD.';
  }

  // Валидация: формат даты
  if (!isValidDateFormat(args.date)) {
    log.warn({
      providedDate: args.date
    }, '[handleGetSlotsForDate] Invalid date format', ['consultation', 'validation']);
    return `Неверный формат даты "${args.date}". Используй формат YYYY-MM-DD (например, 2025-01-06).`;
  }

  // Валидация: дата не в прошлом
  const timezone = settings.timezone || 'Europe/Moscow';
  if (!isDateNotInPast(args.date, timezone)) {
    log.warn({
      providedDate: args.date,
      timezone
    }, '[handleGetSlotsForDate] Date is in the past', ['consultation', 'validation']);
    return `Дата ${args.date} уже прошла. Выбери сегодняшний день или будущую дату.`;
  }

  log.info({
    date: args.date,
    consultantIds: settings.consultant_ids?.length || 'all',
    timezone
  }, '[handleGetSlotsForDate] Fetching slots for date', ['consultation']);

  try {
    const durationMinutes = settings.default_duration_minutes || 60;

    const params = new URLSearchParams({
      duration_minutes: String(durationMinutes),
      date: args.date,
      limit: '100' // Большой лимит — вернутся ВСЕ слоты на этот день
    });

    if (settings.consultant_ids?.length) {
      params.append('consultant_ids', settings.consultant_ids.join(','));
    }

    if (settings.timezone) {
      params.append('timezone', settings.timezone);
    }

    const url = `${CRM_BACKEND_URL}/consultations/available-slots?${params}`;

    const response = await fetchWithRetry(
      url,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      log,
      'handleGetSlotsForDate'
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      log.error({
        status: response.status,
        statusText: response.statusText,
        errorBody: errorBody.substring(0, 200)
      }, '[handleGetSlotsForDate] API returned error status', {}, ['api', 'consultation']);
      return 'К сожалению, не удалось получить слоты на эту дату. Попробуйте позже.';
    }

    let data: any;
    try {
      data = await response.json();
    } catch (parseError) {
      log.error(parseError, '[handleGetSlotsForDate] Failed to parse JSON response', {}, ['api', 'consultation']);
      return 'Произошла ошибка при обработке данных. Попробуйте позже.';
    }

    if (!data || typeof data !== 'object') {
      log.warn({ dataType: typeof data }, '[handleGetSlotsForDate] Invalid response format', ['api', 'consultation']);
      return 'Получен некорректный ответ от сервера. Попробуйте позже.';
    }

    if (!data.slots?.length) {
      log.info({ date: args.date, slotsCount: 0 }, '[handleGetSlotsForDate] No slots available', ['consultation']);
      return `На ${args.date} нет свободных слотов. Попробуй другую дату.`;
    }

    log.info({
      date: args.date,
      slotsCount: data.slots.length
    }, '[handleGetSlotsForDate] Slots found successfully', ['consultation']);

    const slotsText = data.slots.map((slot: any, idx: number) => {
      return `[Слот ${idx + 1}]
Консультант: ${slot.consultant_name}
Время: ${slot.formatted}
date: ${slot.date}
start_time: ${slot.start_time}`;
    }).join('\n\n');

    return `Все свободные слоты на ${args.date}:\n\n${slotsText}\n\nДля записи используй consultant_id из списка консультантов + date и start_time из выбранного слота.`;
  } catch (error: any) {
    const errorType = classifyError(error);
    log.error(error, '[handleGetSlotsForDate] Error fetching slots', {
      errorType: errorType.type,
      isRetryable: errorType.isRetryable
    }, ['api', 'consultation']);
    return 'Произошла ошибка при получении слотов. Попробуйте позже.';
  }
}

// Тестовый lead ID для UI тестирования
const TEST_LEAD_ID = '00000000-0000-0000-0000-000000000000';

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

  const isTestMode = lead.id === TEST_LEAD_ID;

  log.info({
    consultantId: args.consultant_id,
    date: args.date,
    time: args.start_time,
    clientName: args.client_name || lead.contact_name,
    duration: settings.default_duration_minutes,
    testMode: isTestMode
  }, '[handleBookConsultation] Booking consultation', ['consultation']);

  try {
    const url = `${CRM_BACKEND_URL}/consultations/book-from-bot`;
    const requestBody: Record<string, any> = {
      dialog_analysis_id: lead.id,
      consultant_id: args.consultant_id,
      date: args.date,
      start_time: args.start_time,
      duration_minutes: settings.default_duration_minutes,
      client_name: args.client_name || lead.contact_name,
      auto_summarize: settings.auto_summarize_dialog
    };

    // В тестовом режиме передаём телефон напрямую
    if (isTestMode) {
      requestBody.client_phone = lead.contact_phone;
    }

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
 * Обработчик: Получить информацию о консультанте
 */
export async function handleGetConsultantInfo(
  args: { consultant_id: string },
  lead: LeadInfo,
  ctxLog?: ContextLogger
): Promise<string> {
  const log = ctxLog || createContextLogger(baseLog, { leadId: lead.id }, ['consultation']);

  if (!args.consultant_id) {
    log.warn({}, '[handleGetConsultantInfo] Missing consultant_id', ['consultation', 'validation']);
    return 'Не указан ID консультанта.';
  }

  log.info({
    consultantId: maskUuid(args.consultant_id)
  }, '[handleGetConsultantInfo] Fetching consultant info', ['consultation']);

  try {
    const url = `${CRM_BACKEND_URL}/consultants/${args.consultant_id}`;

    const response = await fetchWithRetry(
      url,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      log,
      'handleGetConsultantInfo'
    );

    if (!response.ok) {
      if (response.status === 404) {
        log.warn({ consultantId: maskUuid(args.consultant_id) }, '[handleGetConsultantInfo] Consultant not found', ['consultation']);
        return 'Консультант не найден.';
      }
      log.error({
        status: response.status,
        statusText: response.statusText
      }, '[handleGetConsultantInfo] API returned error status', {}, ['api', 'consultation']);
      return 'Не удалось получить информацию о консультанте.';
    }

    let data: any;
    try {
      data = await response.json();
    } catch (parseError) {
      log.error(parseError, '[handleGetConsultantInfo] Failed to parse JSON response', {}, ['api', 'consultation']);
      return 'Произошла ошибка при обработке данных.';
    }

    log.info({
      consultantId: maskUuid(args.consultant_id),
      hasName: !!data.name,
      hasSpecialization: !!data.specialization
    }, '[handleGetConsultantInfo] Consultant info fetched successfully', ['consultation']);

    // Формируем ответ
    const parts: string[] = [];
    if (data.name) {
      parts.push(`Консультант: ${data.name}`);
    }
    if (data.specialization) {
      parts.push(`Специализация: ${data.specialization}`);
    }
    if (data.description) {
      parts.push(`Описание: ${data.description}`);
    }

    if (parts.length === 0) {
      return 'Информация о консультанте недоступна.';
    }

    return parts.join('\n');
  } catch (error: any) {
    const errorType = classifyError(error);
    log.error(error, '[handleGetConsultantInfo] Error fetching consultant info', {
      errorType: errorType.type,
      isRetryable: errorType.isRetryable
    }, ['api', 'consultation']);
    return 'Произошла ошибка при получении информации о консультанте.';
  }
}

/**
 * Обработчик: Получить расписание консультанта
 */
export async function handleGetConsultantSchedule(
  args: { consultant_id: string },
  lead: LeadInfo,
  ctxLog?: ContextLogger
): Promise<string> {
  const log = ctxLog || createContextLogger(baseLog, { leadId: lead.id }, ['consultation']);

  if (!args.consultant_id) {
    log.warn({}, '[handleGetConsultantSchedule] Missing consultant_id', ['consultation', 'validation']);
    return 'Не указан ID консультанта.';
  }

  log.info({
    consultantId: maskUuid(args.consultant_id)
  }, '[handleGetConsultantSchedule] Fetching consultant schedule', ['consultation']);

  try {
    const url = `${CRM_BACKEND_URL}/consultants/${args.consultant_id}/schedules`;

    const response = await fetchWithRetry(
      url,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      log,
      'handleGetConsultantSchedule'
    );

    if (!response.ok) {
      if (response.status === 404) {
        log.warn({ consultantId: maskUuid(args.consultant_id) }, '[handleGetConsultantSchedule] Consultant not found', ['consultation']);
        return 'Консультант не найден.';
      }
      log.error({
        status: response.status,
        statusText: response.statusText
      }, '[handleGetConsultantSchedule] API returned error status', {}, ['api', 'consultation']);
      return 'Не удалось получить расписание консультанта.';
    }

    let data: any;
    try {
      data = await response.json();
    } catch (parseError) {
      log.error(parseError, '[handleGetConsultantSchedule] Failed to parse JSON response', {}, ['api', 'consultation']);
      return 'Произошла ошибка при обработке данных.';
    }

    // data может быть массивом расписаний или объектом с schedules
    const schedules = Array.isArray(data) ? data : data.schedules || [];

    if (schedules.length === 0) {
      log.info({ consultantId: maskUuid(args.consultant_id) }, '[handleGetConsultantSchedule] No schedules found', ['consultation']);
      return 'Расписание консультанта не настроено.';
    }

    log.info({
      consultantId: maskUuid(args.consultant_id),
      schedulesCount: schedules.length
    }, '[handleGetConsultantSchedule] Schedule fetched successfully', ['consultation']);

    // Название дней недели
    const dayNames: Record<number, string> = {
      0: 'Воскресенье',
      1: 'Понедельник',
      2: 'Вторник',
      3: 'Среда',
      4: 'Четверг',
      5: 'Пятница',
      6: 'Суббота'
    };

    // Группируем по дням и формируем ответ
    const scheduleText = schedules
      .filter((s: any) => s.is_active !== false)
      .map((s: any) => {
        const dayName = dayNames[s.day_of_week] || `День ${s.day_of_week}`;
        return `${dayName}: ${s.start_time} - ${s.end_time}`;
      })
      .join('\n');

    if (!scheduleText) {
      return 'Расписание консультанта не настроено.';
    }

    return `Расписание работы консультанта:\n\n${scheduleText}`;
  } catch (error: any) {
    const errorType = classifyError(error);
    log.error(error, '[handleGetConsultantSchedule] Error fetching schedule', {
      errorType: errorType.type,
      isRetryable: errorType.isRetryable
    }, ['api', 'consultation']);
    return 'Произошла ошибка при получении расписания.';
  }
}

/**
 * Обработчик: Получить историю консультаций клиента
 */
export async function handleGetConsultationHistory(
  lead: LeadInfo,
  ctxLog?: ContextLogger
): Promise<string> {
  const log = ctxLog || createContextLogger(baseLog, { leadId: lead.id }, ['consultation']);

  log.info({
    leadId: maskUuid(lead.id),
    phone: maskPhone(lead.contact_phone)
  }, '[handleGetConsultationHistory] Fetching consultation history', ['consultation']);

  try {
    // Запрашиваем все консультации включая завершённые и отменённые
    const url = `${CRM_BACKEND_URL}/consultations/by-lead/${lead.id}?include_all=true`;

    const response = await fetchWithRetry(
      url,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      log,
      'handleGetConsultationHistory'
    );

    if (!response.ok) {
      log.error({
        status: response.status,
        statusText: response.statusText
      }, '[handleGetConsultationHistory] API returned error status', {}, ['api', 'consultation']);
      return 'Не удалось получить историю консультаций.';
    }

    let data: any;
    try {
      data = await response.json();
    } catch (parseError) {
      log.error(parseError, '[handleGetConsultationHistory] Failed to parse JSON response', {}, ['api', 'consultation']);
      return 'Произошла ошибка при обработке данных.';
    }

    const consultations = data.consultations || [];

    if (consultations.length === 0) {
      log.info({ leadId: maskUuid(lead.id) }, '[handleGetConsultationHistory] No consultation history', ['consultation']);
      return 'У клиента нет истории консультаций.';
    }

    log.info({
      leadId: maskUuid(lead.id),
      count: consultations.length
    }, '[handleGetConsultationHistory] History fetched successfully', ['consultation']);

    // Группируем по статусу для удобства
    const statusLabels: Record<string, string> = {
      'scheduled': 'Запланирована',
      'confirmed': 'Подтверждена',
      'completed': 'Проведена',
      'cancelled': 'Отменена',
      'no_show': 'Клиент не пришёл',
      'rescheduled': 'Перенесена'
    };

    const historyText = consultations.map((c: any, idx: number) => {
      const status = statusLabels[c.status] || c.status;
      const date = c.formatted || `${c.date} ${c.start_time}`;
      return `${idx + 1}. ${date} — ${status}`;
    }).join('\n');

    return `История консультаций клиента:\n\n${historyText}`;
  } catch (error: any) {
    const errorType = classifyError(error);
    log.error(error, '[handleGetConsultationHistory] Error fetching history', {
      errorType: errorType.type,
      isRetryable: errorType.isRetryable
    }, ['api', 'consultation']);
    return 'Произошла ошибка при получении истории консультаций.';
  }
}

/**
 * Проверить, является ли функция consultation tool
 */
export function isConsultationTool(functionName: string): boolean {
  const consultationTools = [
    'get_nearest_slots',
    'get_slots_for_date',
    'book_consultation',
    'cancel_consultation',
    'reschedule_consultation',
    'get_my_consultations',
    'get_consultant_info',
    'get_consultant_schedule',
    'get_consultation_history'
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
    case 'get_nearest_slots':
      return handleGetNearestSlots(lead, settings, ctxLog);

    case 'get_slots_for_date':
      return handleGetSlotsForDate(args, lead, settings, ctxLog);

    case 'book_consultation':
      return handleBookConsultation(args, lead, settings, ctxLog);

    case 'cancel_consultation':
      return handleCancelConsultation(args, lead, ctxLog);

    case 'reschedule_consultation':
      return handleRescheduleConsultation(args, lead, settings, ctxLog);

    case 'get_my_consultations':
      return handleGetMyConsultations(lead, ctxLog);

    case 'get_consultant_info':
      return handleGetConsultantInfo(args, lead, ctxLog);

    case 'get_consultant_schedule':
      return handleGetConsultantSchedule(args, lead, ctxLog);

    case 'get_consultation_history':
      return handleGetConsultationHistory(lead, ctxLog);

    default:
      return 'Неизвестная функция консультаций.';
  }
}
