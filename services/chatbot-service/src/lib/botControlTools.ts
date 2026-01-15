/**
 * Bot Control Tools - функции для управления поведением бота из AI-бота
 *
 * Эти функции позволяют боту:
 * - Ставить себя на паузу с передачей менеджеру
 * - Генерировать AI-резюме диалога для передачи
 *
 * Features:
 * - Отмена отложенных follow-ups при паузе
 * - AI-powered саммаризация
 * - Структурированное логирование
 */

import OpenAI from 'openai';
import { createLogger } from './logger.js';
import { ContextLogger, createContextLogger, maskUuid, logDbOperation, logOpenAiCallWithCost } from './logUtils.js';
import { supabase } from './supabase.js';
import { cancelPendingFollowUps } from './delayedFollowUps.js';

const baseLog = createLogger({ module: 'botControlTools' });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Модель для саммаризации диалога
const SUMMARIZE_MODEL = 'gpt-4o-mini';

// Имена Bot Control tools
const BOT_CONTROL_TOOL_NAMES = ['pause_bot', 'get_dialog_summary'] as const;

/**
 * Информация о лиде для Bot Control tools
 */
interface LeadInfo {
  id: string;
  contact_phone?: string;
  contact_name?: string;
  messages?: any[];
  funnel_stage?: string;
  interest_level?: string;
}

/**
 * Ленивая инициализация OpenAI клиента
 */
let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured');
    }
    openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
  }
  return openaiClient;
}

/**
 * Получить OpenAI tool definitions для Bot Control
 */
export function getBotControlToolDefinitions(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'pause_bot',
        description: 'Поставить бота на паузу и передать разговор менеджеру. Используй когда клиент просит связаться с человеком, когда вопрос слишком сложный, или когда нужна помощь специалиста.',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Причина паузы для менеджера (например: "клиент просит поговорить с человеком", "сложный технический вопрос")'
            },
            duration_minutes: {
              type: 'integer',
              description: 'Длительность паузы в минутах. 0 = бессрочно до ручного возобновления. По умолчанию 0.'
            },
            assign_to_human: {
              type: 'boolean',
              description: 'Передать диалог оператору/менеджеру. По умолчанию true.'
            }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_dialog_summary',
        description: 'Получить AI-резюме диалога для передачи менеджеру или для понимания контекста. Полезно перед передачей клиента менеджеру.',
        parameters: {
          type: 'object',
          properties: {
            max_length: {
              type: 'integer',
              description: 'Максимальная длина резюме в символах. По умолчанию 500.'
            }
          }
        }
      }
    }
  ];
}

/**
 * Проверить, является ли функция Bot Control tool
 */
export function isBotControlTool(functionName: string): boolean {
  return BOT_CONTROL_TOOL_NAMES.includes(functionName as typeof BOT_CONTROL_TOOL_NAMES[number]);
}

/**
 * Обработчик: Поставить бота на паузу
 */
async function handlePauseBot(
  args: {
    reason?: string;
    duration_minutes?: number;
    assign_to_human?: boolean;
  },
  lead: LeadInfo,
  ctxLog?: ContextLogger
): Promise<string> {
  const startTime = Date.now();
  const log = ctxLog || createContextLogger(baseLog, { leadId: lead.id }, ['processing']);

  const reason = args.reason || 'Бот поставлен на паузу';
  const durationMinutes = args.duration_minutes ?? 0;
  const assignToHuman = args.assign_to_human ?? true;

  log.debug({
    leadId: maskUuid(lead.id),
    reason,
    durationMinutes,
    durationForever: durationMinutes === 0,
    assignToHuman
  }, '[handlePauseBot] >>> Starting bot pause', ['processing']);

  try {
    // Формируем данные для обновления
    const updateData: Record<string, any> = {
      bot_paused: true,
      bot_paused_reason: reason,
      bot_paused_at: new Date().toISOString()
    };

    // Устанавливаем время окончания паузы если указана длительность
    if (durationMinutes > 0) {
      const pauseUntil = new Date();
      pauseUntil.setMinutes(pauseUntil.getMinutes() + durationMinutes);
      updateData.bot_paused_until = pauseUntil.toISOString();

      log.debug({
        durationMinutes,
        pauseUntil: updateData.bot_paused_until
      }, '[handlePauseBot] Timed pause configured', ['processing']);
    } else {
      updateData.bot_paused_until = null;
      log.debug({}, '[handlePauseBot] Indefinite pause configured', ['processing']);
    }

    // Передаём оператору если указано
    if (assignToHuman) {
      updateData.assigned_to_human = true;
    }

    // Обновляем в базе
    const dbStartTime = Date.now();
    const { error } = await supabase
      .from('dialog_analysis')
      .update(updateData)
      .eq('id', lead.id);
    const dbLatencyMs = Date.now() - dbStartTime;

    if (error) {
      log.error(new Error(error.message || 'Database error'), '[handlePauseBot] Failed to pause bot in database', {
        leadId: maskUuid(lead.id),
        dbLatencyMs
      }, ['processing', 'db']);
      return 'Не удалось поставить бота на паузу.';
    }

    logDbOperation(log, 'update', 'dialog_analysis', {
      leadId: maskUuid(lead.id),
      fields: ['bot_paused', 'bot_paused_reason', 'bot_paused_at', 'bot_paused_until', 'assigned_to_human'],
      dbLatencyMs
    }, true);

    // Отменяем отложенные follow-ups
    let cancelledFollowUps = 0;
    try {
      const cancelStartTime = Date.now();
      cancelledFollowUps = await cancelPendingFollowUps(lead.id);
      const cancelLatencyMs = Date.now() - cancelStartTime;

      if (cancelledFollowUps > 0) {
        log.info({
          cancelledCount: cancelledFollowUps,
          cancelLatencyMs
        }, '[handlePauseBot] Cancelled pending follow-ups', ['processing', 'schedule']);
      } else {
        log.debug({
          cancelLatencyMs
        }, '[handlePauseBot] No pending follow-ups to cancel', ['processing', 'schedule']);
      }
    } catch (e) {
      log.warn({
        error: (e as any)?.message
      }, '[handlePauseBot] Failed to cancel follow-ups (non-fatal)', ['processing']);
    }

    log.info({
      leadId: maskUuid(lead.id),
      durationMinutes,
      durationForever: durationMinutes === 0,
      assignToHuman,
      pauseUntil: updateData.bot_paused_until,
      cancelledFollowUps,
      dbLatencyMs,
      elapsedMs: Date.now() - startTime
    }, '[handlePauseBot] <<< Bot paused successfully', ['processing']);

    // Формируем ответ
    let response = 'Бот поставлен на паузу.';
    if (assignToHuman) {
      response += ' Диалог передан менеджеру.';
    }
    if (durationMinutes > 0) {
      response += ` Пауза на ${durationMinutes} минут.`;
    } else {
      response += ' Пауза бессрочная (до ручного возобновления).';
    }

    return response;
  } catch (error: any) {
    log.error(error, '[handlePauseBot] Error pausing bot', {
      leadId: maskUuid(lead.id),
      reason,
      durationMinutes,
      elapsedMs: Date.now() - startTime
    }, ['processing']);
    return 'Произошла ошибка при постановке на паузу.';
  }
}

/**
 * Получить историю сообщений из лида
 */
function getDialogHistoryFromLead(lead: LeadInfo): string {
  const messages = lead.messages;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return '';
  }

  // Берём последние 20 сообщений
  const recentMessages = messages.slice(-20);

  return recentMessages
    .map((m: any) => {
      const role = m.sender === 'bot' || m.role === 'assistant' ? 'Бот' : 'Клиент';
      const content = m.content || m.text || '';
      return `${role}: ${content}`;
    })
    .join('\n');
}

/**
 * Обработчик: Получить AI-резюме диалога
 */
async function handleGetDialogSummary(
  args: { max_length?: number },
  lead: LeadInfo,
  ctxLog?: ContextLogger
): Promise<string> {
  const startTime = Date.now();
  const log = ctxLog || createContextLogger(baseLog, { leadId: lead.id }, ['processing']);

  const maxLength = args.max_length ?? 500;

  log.debug({
    leadId: maskUuid(lead.id),
    maxLength,
    hasMessages: !!(lead.messages && lead.messages.length > 0),
    messagesCount: lead.messages?.length || 0
  }, '[handleGetDialogSummary] >>> Starting dialog summary generation', ['openai']);

  try {
    // Получаем историю диалога
    const dialogHistory = getDialogHistoryFromLead(lead);

    if (!dialogHistory) {
      log.warn({
        leadId: maskUuid(lead.id),
        elapsedMs: Date.now() - startTime
      }, '[handleGetDialogSummary] No dialog history found - cannot generate summary', ['processing']);
      return 'История диалога пуста или недоступна.';
    }

    log.debug({
      historyLength: dialogHistory.length,
      maxLength,
      needsSummarization: dialogHistory.length > maxLength
    }, '[handleGetDialogSummary] Dialog history extracted', ['processing']);

    // Если диалог короткий, возвращаем как есть
    if (dialogHistory.length <= maxLength) {
      log.info({
        leadId: maskUuid(lead.id),
        action: 'returned_as_is',
        historyLength: dialogHistory.length,
        elapsedMs: Date.now() - startTime
      }, '[handleGetDialogSummary] <<< Dialog is short, returning as is', ['processing']);
      return dialogHistory;
    }

    // Генерируем саммари через OpenAI
    log.debug({
      model: SUMMARIZE_MODEL,
      historyLength: dialogHistory.length,
      maxLength
    }, '[handleGetDialogSummary] Calling OpenAI for summarization', ['openai']);

    const openai = getOpenAI();
    const openaiStartTime = Date.now();

    const response = await openai.chat.completions.create({
      model: SUMMARIZE_MODEL,
      messages: [
        {
          role: 'system',
          content: `Ты помощник, который создаёт краткие резюме диалогов для менеджеров.

Твоя задача: создать краткое резюме диалога между ботом и клиентом.

Формат резюме:
- Суть запроса клиента
- Ключевые моменты разговора
- Текущий статус/результат
- Важные детали (если есть): имя, компания, бюджет

Максимальная длина: ${maxLength} символов.
Пиши кратко, по делу, без воды.`
        },
        {
          role: 'user',
          content: `Создай краткое резюме этого диалога:\n\n${dialogHistory}`
        }
      ],
      temperature: 0.3,
      max_tokens: Math.ceil(maxLength / 2)
    });

    const openaiLatencyMs = Date.now() - openaiStartTime;
    const summary = response.choices[0]?.message?.content?.trim();

    if (!summary) {
      logOpenAiCallWithCost(log, {
        model: SUMMARIZE_MODEL,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        latencyMs: openaiLatencyMs,
        success: false,
        errorMessage: 'Empty summary returned'
      });
      log.warn({
        leadId: maskUuid(lead.id),
        openaiLatencyMs,
        elapsedMs: Date.now() - startTime
      }, '[handleGetDialogSummary] OpenAI returned empty summary', ['openai']);
      return 'Не удалось создать резюме диалога.';
    }

    // Логируем успешный OpenAI вызов с информацией о стоимости
    logOpenAiCallWithCost(log, {
      model: SUMMARIZE_MODEL,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
      latencyMs: openaiLatencyMs,
      success: true
    });

    // Обрезаем если превышает лимит
    const finalSummary = summary.length > maxLength
      ? summary.substring(0, maxLength - 3) + '...'
      : summary;

    log.info({
      leadId: maskUuid(lead.id),
      originalLength: dialogHistory.length,
      summaryLength: finalSummary.length,
      wasTruncated: summary.length > maxLength,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      openaiLatencyMs,
      elapsedMs: Date.now() - startTime
    }, '[handleGetDialogSummary] <<< Dialog summary generated successfully', ['openai']);

    return finalSummary;
  } catch (error: any) {
    log.error(error, '[handleGetDialogSummary] Error generating summary', {
      leadId: maskUuid(lead.id),
      maxLength,
      elapsedMs: Date.now() - startTime
    }, ['openai']);
    return 'Произошла ошибка при создании резюме.';
  }
}

/**
 * Обработать вызов Bot Control tool
 */
export async function handleBotControlTool(
  functionName: string,
  args: any,
  lead: LeadInfo,
  ctxLog?: ContextLogger
): Promise<string> {
  const log = ctxLog || createContextLogger(baseLog, { leadId: lead.id }, ['processing']);

  log.debug({
    functionName,
    leadId: maskUuid(lead.id),
    argsKeys: Object.keys(args || {}),
    hasMessages: !!(lead.messages && lead.messages.length > 0)
  }, '[handleBotControlTool] Routing Bot Control tool call', ['processing']);

  switch (functionName) {
    case 'pause_bot':
      return handlePauseBot(args, lead, ctxLog);

    case 'get_dialog_summary':
      return handleGetDialogSummary(args, lead, ctxLog);

    default:
      log.warn({
        functionName,
        leadId: maskUuid(lead.id)
      }, '[handleBotControlTool] Unknown Bot Control function requested', ['processing']);
      return 'Неизвестная функция управления ботом.';
  }
}
