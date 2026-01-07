/**
 * CAPI Tools - функции для управления Meta Conversions API из AI-бота
 *
 * Эти функции позволяют боту:
 * - Вручную отправлять CAPI события (Lead, Qualified, Schedule)
 * - Проверять статус отправленных CAPI событий
 *
 * Features:
 * - Дедупликация событий через флаги capi_*_sent
 * - Структурированное логирование
 */

import OpenAI from 'openai';
import { createLogger } from './logger.js';
import { ContextLogger, createContextLogger, maskUuid, maskPhone, logDbOperation } from './logUtils.js';
import { supabase } from './supabase.js';
import {
  sendCapiEvent,
  updateDialogCapiFlags,
  getDirectionPixelInfo,
  CAPI_EVENTS,
  type CapiEventLevel
} from './metaCapiClient.js';

const baseLog = createLogger({ module: 'capiTools' });

// Названия уровней CAPI событий для логов
const LEVEL_NAMES: Record<number, string> = {
  1: 'Interest',
  2: 'Qualified',
  3: 'Scheduled'
};

const CAPI_CHANNEL = 'whatsapp_baileys';

// Имена CAPI tools
const CAPI_TOOL_NAMES = ['send_capi_event', 'get_capi_status'] as const;

/**
 * Получить OpenAI tool definitions для CAPI
 */
export function getCapiToolDefinitions(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'send_capi_event',
        description: 'Отправить событие конверсии в Meta CAPI. Используй когда клиент явно проявил интерес (level 1, 3+ входящих сообщений), прошёл квалификацию (level 2), или записался на ключевой этап (level 3). Каждый уровень можно отправить только один раз.',
        parameters: {
          type: 'object',
          properties: {
            level: {
              type: 'integer',
              enum: [1, 2, 3],
              description: '1 = Interest/Lead (3+ входящих сообщений), 2 = Qualified/CompleteRegistration (прошёл квалификацию), 3 = Schedule (записался)'
            },
            reason: {
              type: 'string',
              description: 'Причина отправки события (для логирования)'
            }
          },
          required: ['level']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_capi_status',
        description: 'Получить статус отправленных CAPI событий для клиента. Используй чтобы понять какие конверсии уже зафиксированы и какие ещё можно отправить.',
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
 * Проверить, является ли функция CAPI tool
 */
export function isCapiTool(functionName: string): boolean {
  return CAPI_TOOL_NAMES.includes(functionName as typeof CAPI_TOOL_NAMES[number]);
}

/**
 * Получить данные лида для CAPI операций
 */
async function getLeadDataForCapi(leadId: string) {
  const { data, error } = await supabase
    .from('dialog_analysis')
    .select(`
      id,
      contact_phone,
      contact_name,
      user_account_id,
      direction_id,
      capi_interest_sent,
      capi_qualified_sent,
      capi_scheduled_sent
    `)
    .eq('id', leadId)
    .single();

  if (error || !data) {
    return null;
  }

  let leadRecordId: string | undefined;
  const { data: leadRecord, error: leadError } = await supabase
    .from('leads')
    .select('id')
    .eq('chat_id', data.contact_phone)
    .eq('user_account_id', data.user_account_id)
    .maybeSingle();

  if (!leadError && leadRecord?.id) {
    leadRecordId = String(leadRecord.id);
  }

  return {
    ...data,
    lead_id: leadRecordId,
  };
}

/**
 * Обработчик: Отправить CAPI событие
 */
async function handleSendCapiEvent(
  args: { level: number; reason?: string },
  leadId: string,
  ctxLog?: ContextLogger
): Promise<string> {
  const startTime = Date.now();
  const log = ctxLog || createContextLogger(baseLog, { leadId }, ['api']);

  const level = args.level as CapiEventLevel;

  log.debug({
    leadId: maskUuid(leadId),
    level,
    levelName: LEVEL_NAMES[level] || 'unknown',
    reason: args.reason
  }, '[handleSendCapiEvent] >>> Starting CAPI event processing', ['api']);

  // Валидация уровня
  if (![1, 2, 3].includes(level)) {
    log.warn({
      level,
      validLevels: [1, 2, 3],
      elapsedMs: Date.now() - startTime
    }, '[handleSendCapiEvent] Invalid event level', ['api', 'validation']);
    return 'Неверный уровень события. Допустимые значения: 1 (Interest), 2 (Qualified), 3 (Schedule).';
  }

  // Получаем данные лида
  const dbStartTime = Date.now();
  const lead = await getLeadDataForCapi(leadId);
  const dbLatencyMs = Date.now() - dbStartTime;

  if (!lead) {
    log.error({
      leadId: maskUuid(leadId),
      dbLatencyMs,
      elapsedMs: Date.now() - startTime
    }, '[handleSendCapiEvent] Lead not found in database', {}, ['api', 'db']);
    return 'Не удалось найти данные клиента.';
  }

  logDbOperation(log, 'select', 'dialog_analysis', {
    leadId: maskUuid(leadId),
    dbLatencyMs,
    hasPhone: !!lead.contact_phone,
    hasDirection: !!lead.direction_id
  }, true);

  // Проверка дедупликации
  const alreadySent = {
    interest: lead.capi_interest_sent,
    qualified: lead.capi_qualified_sent,
    scheduled: lead.capi_scheduled_sent
  };

  log.debug({
    phone: maskPhone(lead.contact_phone),
    hasDirection: !!lead.direction_id,
    alreadySent,
    requestedLevel: level
  }, '[handleSendCapiEvent] Lead data loaded, checking deduplication', ['api']);

  if (level === 1 && lead.capi_interest_sent) {
    log.info({
      level,
      levelName: LEVEL_NAMES[level],
      elapsedMs: Date.now() - startTime
    }, '[handleSendCapiEvent] Interest event already sent - skipping', ['api']);
    return 'Событие Interest (уровень 1) уже было отправлено для этого клиента.';
  }
  if (level === 2 && lead.capi_qualified_sent) {
    log.info({
      level,
      levelName: LEVEL_NAMES[level],
      elapsedMs: Date.now() - startTime
    }, '[handleSendCapiEvent] Qualified event already sent - skipping', ['api']);
    return 'Событие Qualified (уровень 2) уже было отправлено для этого клиента.';
  }
  if (level === 3 && lead.capi_scheduled_sent) {
    log.info({
      level,
      levelName: LEVEL_NAMES[level],
      elapsedMs: Date.now() - startTime
    }, '[handleSendCapiEvent] Schedule event already sent - skipping', ['api']);
    return 'Событие Schedule (уровень 3) уже было отправлено для этого клиента.';
  }

  // Получаем pixel info через direction
  if (!lead.direction_id) {
    log.warn({
      leadId: maskUuid(leadId),
      elapsedMs: Date.now() - startTime
    }, '[handleSendCapiEvent] No direction_id for lead - cannot send CAPI', ['api']);
    return 'Не удалось определить направление для отправки CAPI события.';
  }

  const pixelStartTime = Date.now();
  const { pixelId, accessToken } = await getDirectionPixelInfo(lead.direction_id);
  const pixelLatencyMs = Date.now() - pixelStartTime;

  log.debug({
    directionId: maskUuid(lead.direction_id),
    hasPixel: !!pixelId,
    hasToken: !!accessToken,
    pixelLatencyMs
  }, '[handleSendCapiEvent] Pixel info loaded', ['api', 'db']);

  if (!pixelId || !accessToken) {
    log.warn({
      hasPixel: !!pixelId,
      hasToken: !!accessToken,
      directionId: maskUuid(lead.direction_id),
      elapsedMs: Date.now() - startTime
    }, '[handleSendCapiEvent] Missing pixel or access token - CAPI not configured', ['api']);
    return 'CAPI не настроен для этого направления (отсутствует пиксель или токен).';
  }

  // Определяем имя события
  const eventName = level === 1 ? CAPI_EVENTS.INTEREST :
                    level === 2 ? CAPI_EVENTS.QUALIFIED :
                    CAPI_EVENTS.SCHEDULED;

  log.info({
    level,
    eventName,
    leadId: maskUuid(leadId),
    phone: maskPhone(lead.contact_phone)
  }, '[handleSendCapiEvent] Sending CAPI event to Meta', ['api']);

  // Отправляем событие
  const capiStartTime = Date.now();
  const result = await sendCapiEvent({
    pixelId,
    accessToken,
    eventName,
    eventLevel: level,
    phone: lead.contact_phone,
    dialogAnalysisId: lead.id,
    leadId: lead.lead_id ? String(lead.lead_id) : undefined,
    userAccountId: lead.user_account_id || '',
    directionId: lead.direction_id,
    customData: {
      channel: CAPI_CHANNEL,
      ...(level === 1 ? { stage: 'interest' } : level === 2 ? { stage: 'qualified' } : { stage: 'scheduled' }),
      ...(args.reason ? { reason: args.reason } : {}),
    }
  });
  const capiLatencyMs = Date.now() - capiStartTime;

  if (!result.success) {
    log.error({
      level,
      levelName: LEVEL_NAMES[level],
      eventName,
      error: result.error,
      capiLatencyMs,
      elapsedMs: Date.now() - startTime
    }, '[handleSendCapiEvent] Failed to send CAPI event to Meta', {}, ['api']);
    return `Не удалось отправить CAPI событие: ${result.error}`;
  }

  // Обновляем флаги в dialog_analysis
  if (result.eventId) {
    const flagStartTime = Date.now();
    await updateDialogCapiFlags(lead.id, level, result.eventId);
    log.debug({
      eventId: result.eventId,
      level,
      flagUpdateMs: Date.now() - flagStartTime
    }, '[handleSendCapiEvent] CAPI flags updated in database', ['api', 'db']);
  }

  log.info({
    level,
    levelName: LEVEL_NAMES[level],
    eventName,
    eventId: result.eventId,
    capiLatencyMs,
    totalElapsedMs: Date.now() - startTime
  }, '[handleSendCapiEvent] <<< CAPI event sent successfully', ['api']);

  return `Событие ${LEVEL_NAMES[level]} успешно отправлено в Meta CAPI.`;
}

/**
 * Обработчик: Получить статус CAPI событий
 */
async function handleGetCapiStatus(
  leadId: string,
  ctxLog?: ContextLogger
): Promise<string> {
  const startTime = Date.now();
  const log = ctxLog || createContextLogger(baseLog, { leadId }, ['api']);

  log.debug({
    leadId: maskUuid(leadId)
  }, '[handleGetCapiStatus] >>> Getting CAPI status', ['api']);

  try {
    // Получаем актуальные данные из БД
    const dbStartTime = Date.now();
    const { data, error } = await supabase
      .from('dialog_analysis')
      .select(`
        capi_interest_sent,
        capi_interest_sent_at,
        capi_qualified_sent,
        capi_qualified_sent_at,
        capi_scheduled_sent,
        capi_scheduled_sent_at
      `)
      .eq('id', leadId)
      .single();
    const dbLatencyMs = Date.now() - dbStartTime;

    if (error || !data) {
      log.error({
        leadId: maskUuid(leadId),
        error: error?.message || 'No data returned',
        dbLatencyMs,
        elapsedMs: Date.now() - startTime
      }, '[handleGetCapiStatus] Failed to get CAPI status from DB', {}, ['api', 'db']);
      return 'Не удалось получить статус CAPI событий.';
    }

    logDbOperation(log, 'select', 'dialog_analysis', {
      leadId: maskUuid(leadId),
      dbLatencyMs
    }, true);

    const formatDate = (dateStr: string | null) => {
      if (!dateStr) return null;
      const date = new Date(dateStr);
      return date.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    };

    const status = [];
    const sentCount = [data.capi_interest_sent, data.capi_qualified_sent, data.capi_scheduled_sent]
      .filter(Boolean).length;

    // Level 1 - Interest
    if (data.capi_interest_sent) {
      status.push(`✅ Interest (уровень 1): отправлено ${formatDate(data.capi_interest_sent_at)}`);
    } else {
      status.push('⬜ Interest (уровень 1): не отправлено');
    }

    // Level 2 - Qualified
    if (data.capi_qualified_sent) {
      status.push(`✅ Qualified (уровень 2): отправлено ${formatDate(data.capi_qualified_sent_at)}`);
    } else {
      status.push('⬜ Qualified (уровень 2): не отправлено');
    }

    // Level 3 - Schedule
    if (data.capi_scheduled_sent) {
      status.push(`✅ Schedule (уровень 3): отправлено ${formatDate(data.capi_scheduled_sent_at)}`);
    } else {
      status.push('⬜ Schedule (уровень 3): не отправлено');
    }

    log.info({
      leadId: maskUuid(leadId),
      interestSent: !!data.capi_interest_sent,
      qualifiedSent: !!data.capi_qualified_sent,
      scheduledSent: !!data.capi_scheduled_sent,
      sentCount,
      dbLatencyMs,
      elapsedMs: Date.now() - startTime
    }, '[handleGetCapiStatus] <<< CAPI status retrieved successfully', ['api']);

    return `Статус CAPI событий для клиента:\n\n${status.join('\n')}`;
  } catch (error: any) {
    log.error(error, '[handleGetCapiStatus] Error getting CAPI status', {
      leadId: maskUuid(leadId),
      elapsedMs: Date.now() - startTime
    }, ['api']);
    return 'Произошла ошибка при получении статуса CAPI.';
  }
}

/**
 * Обработать вызов CAPI tool
 */
export async function handleCapiTool(
  functionName: string,
  args: any,
  leadId: string,
  ctxLog?: ContextLogger
): Promise<string> {
  const log = ctxLog || createContextLogger(baseLog, { leadId }, ['api']);

  log.debug({
    functionName,
    leadId: maskUuid(leadId),
    argsKeys: Object.keys(args || {})
  }, '[handleCapiTool] Routing CAPI tool call', ['api']);

  switch (functionName) {
    case 'send_capi_event':
      return handleSendCapiEvent(args, leadId, ctxLog);

    case 'get_capi_status':
      return handleGetCapiStatus(leadId, ctxLog);

    default:
      log.warn({
        functionName,
        leadId: maskUuid(leadId)
      }, '[handleCapiTool] Unknown CAPI function requested', ['api']);
      return 'Неизвестная CAPI функция.';
  }
}
