/**
 * Lead Management Tools - функции для управления данными лида из AI-бота
 *
 * Эти функции позволяют боту:
 * - Обновлять контактную информацию клиента
 * - Устанавливать этап воронки
 * - Устанавливать уровень интереса (hot/warm/cold)
 *
 * Features:
 * - Валидация входных данных
 * - Структурированное логирование
 */

import OpenAI from 'openai';
import { createLogger } from './logger.js';
import { ContextLogger, createContextLogger, maskUuid, logDbOperation } from './logUtils.js';
import { supabase } from './supabase.js';

const baseLog = createLogger({ module: 'leadManagementTools' });

// Человекочитаемые названия этапов воронки
const STAGE_NAMES: Record<string, string> = {
  'new_lead': 'Новый лид',
  'contacted': 'Контакт установлен',
  'qualified': 'Квалифицирован',
  'consultation_scheduled': 'Консультация назначена',
  'consultation_completed': 'Консультация проведена',
  'deal_closed': 'Сделка закрыта',
  'deal_lost': 'Сделка потеряна'
};

// Человекочитаемые названия уровней интереса
const INTEREST_NAMES: Record<string, string> = {
  'hot': 'Горячий (hot)',
  'warm': 'Тёплый (warm)',
  'cold': 'Холодный (cold)'
};

// Имена Lead Management tools
const LEAD_MANAGEMENT_TOOL_NAMES = ['update_lead_info', 'set_funnel_stage', 'set_lead_interest'] as const;

// Допустимые этапы воронки
const VALID_FUNNEL_STAGES = [
  'new_lead',
  'contacted',
  'qualified',
  'consultation_scheduled',
  'consultation_completed',
  'deal_closed',
  'deal_lost'
] as const;

// Допустимые уровни интереса
const VALID_INTEREST_LEVELS = ['hot', 'warm', 'cold'] as const;

/**
 * Информация о лиде для Lead Management tools
 */
interface LeadInfo {
  id: string;
  contact_phone?: string;
  contact_name?: string;
  business_name?: string;
  funnel_stage?: string;
  interest_level?: string;
}

/**
 * Получить OpenAI tool definitions для Lead Management
 */
export function getLeadManagementToolDefinitions(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'update_lead_info',
        description: 'Обновить информацию о клиенте когда он сообщает важные данные. ВАЖНО: Используй эту функцию СРАЗУ когда клиент называет своё имя — это сохранит его в карточку клиента для будущих обращений и уведомлений.',
        parameters: {
          type: 'object',
          properties: {
            contact_name: {
              type: 'string',
              description: 'Имя клиента. Сохрани сразу когда клиент представляется или отвечает на вопрос "как к вам обращаться"'
            },
            company_name: {
              type: 'string',
              description: 'Название компании клиента'
            },
            business_type: {
              type: 'string',
              description: 'Тип/сфера бизнеса'
            },
            budget_range: {
              type: 'string',
              description: 'Примерный бюджет клиента'
            },
            notes: {
              type: 'string',
              description: 'Дополнительные заметки о клиенте'
            }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_funnel_stage',
        description: 'Установить этап воронки для клиента. Используй когда клиент переходит на новый этап: квалифицирован, записан на консультацию, провёл консультацию, закрыл сделку.',
        parameters: {
          type: 'object',
          properties: {
            stage: {
              type: 'string',
              enum: ['new_lead', 'contacted', 'qualified', 'consultation_scheduled', 'consultation_completed', 'deal_closed', 'deal_lost'],
              description: 'Этап воронки'
            },
            reason: {
              type: 'string',
              description: 'Причина изменения этапа (для логирования)'
            }
          },
          required: ['stage']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_lead_interest',
        description: 'Установить уровень интереса клиента. Hot = готов купить/записаться сейчас, Warm = заинтересован но думает, Cold = слабый интерес или просто спрашивает.',
        parameters: {
          type: 'object',
          properties: {
            interest: {
              type: 'string',
              enum: ['hot', 'warm', 'cold'],
              description: 'Уровень интереса: hot (горячий), warm (тёплый), cold (холодный)'
            },
            reason: {
              type: 'string',
              description: 'Причина установки уровня (для логирования)'
            }
          },
          required: ['interest']
        }
      }
    }
  ];
}

/**
 * Проверить, является ли функция Lead Management tool
 */
export function isLeadManagementTool(functionName: string): boolean {
  return LEAD_MANAGEMENT_TOOL_NAMES.includes(functionName as typeof LEAD_MANAGEMENT_TOOL_NAMES[number]);
}

/**
 * Обработчик: Обновить информацию о лиде
 */
async function handleUpdateLeadInfo(
  args: {
    contact_name?: string;
    company_name?: string;
    business_type?: string;
    budget_range?: string;
    notes?: string;
  },
  lead: LeadInfo,
  ctxLog?: ContextLogger
): Promise<string> {
  const startTime = Date.now();
  const log = ctxLog || createContextLogger(baseLog, { leadId: lead.id }, ['processing']);

  const fieldsProvided = Object.keys(args).filter(k => args[k as keyof typeof args]);

  log.debug({
    leadId: maskUuid(lead.id),
    fieldsProvided,
    fieldsCount: fieldsProvided.length
  }, '[handleUpdateLeadInfo] >>> Starting lead info update', ['processing']);

  // Проверяем что есть что обновлять
  const hasUpdates = Object.values(args).some(v => v !== undefined && v !== null && v !== '');
  if (!hasUpdates) {
    log.warn({
      leadId: maskUuid(lead.id),
      elapsedMs: Date.now() - startTime
    }, '[handleUpdateLeadInfo] No fields to update - all values empty', ['processing', 'validation']);
    return 'Нет данных для обновления.';
  }

  try {
    // Формируем объект обновления
    const updateData: Record<string, any> = {};

    if (args.contact_name?.trim()) {
      updateData.contact_name = args.contact_name.trim();
    }
    if (args.company_name?.trim()) {
      updateData.business_name = args.company_name.trim();
    }
    if (args.business_type?.trim()) {
      updateData.business_type = args.business_type.trim();
    }
    if (args.budget_range?.trim()) {
      updateData.budget_range = args.budget_range.trim();
    }
    if (args.notes?.trim()) {
      // Добавляем заметки к существующим
      log.debug({
        leadId: maskUuid(lead.id)
      }, '[handleUpdateLeadInfo] Fetching existing notes before appending', ['processing', 'db']);

      const notesStartTime = Date.now();
      const { data: currentLead } = await supabase
        .from('dialog_analysis')
        .select('notes')
        .eq('id', lead.id)
        .single();

      log.debug({
        hasExistingNotes: !!(currentLead?.notes),
        notesQueryMs: Date.now() - notesStartTime
      }, '[handleUpdateLeadInfo] Existing notes fetched', ['processing', 'db']);

      const existingNotes = currentLead?.notes || '';
      const newNote = `[${new Date().toISOString()}] ${args.notes.trim()}`;
      updateData.notes = existingNotes ? `${existingNotes}\n${newNote}` : newNote;
    }

    if (Object.keys(updateData).length === 0) {
      log.warn({
        leadId: maskUuid(lead.id),
        fieldsProvided,
        elapsedMs: Date.now() - startTime
      }, '[handleUpdateLeadInfo] No valid fields after validation - all trimmed to empty', ['processing', 'validation']);
      return 'Нет корректных данных для обновления.';
    }

    // Обновляем в базе
    const dbStartTime = Date.now();
    const { error } = await supabase
      .from('dialog_analysis')
      .update(updateData)
      .eq('id', lead.id);
    const dbLatencyMs = Date.now() - dbStartTime;

    if (error) {
      log.error({
        leadId: maskUuid(lead.id),
        error: error.message,
        dbLatencyMs,
        fieldsAttempted: Object.keys(updateData)
      }, '[handleUpdateLeadInfo] Failed to update lead in database', {}, ['processing', 'db']);
      return 'Не удалось обновить данные клиента.';
    }

    const updatedFields = Object.keys(updateData);

    logDbOperation(log, 'update', 'dialog_analysis', {
      leadId: maskUuid(lead.id),
      updatedFields,
      dbLatencyMs
    }, true);

    log.info({
      leadId: maskUuid(lead.id),
      updatedFields,
      fieldsCount: updatedFields.length,
      dbLatencyMs,
      elapsedMs: Date.now() - startTime
    }, '[handleUpdateLeadInfo] <<< Lead info updated successfully', ['processing', 'db']);

    return `Данные клиента обновлены: ${updatedFields.join(', ')}.`;
  } catch (error: any) {
    log.error(error, '[handleUpdateLeadInfo] Error updating lead info', {
      leadId: maskUuid(lead.id),
      fieldsProvided,
      elapsedMs: Date.now() - startTime
    }, ['processing']);
    return 'Произошла ошибка при обновлении данных.';
  }
}

/**
 * Обработчик: Установить этап воронки
 */
async function handleSetFunnelStage(
  args: { stage: string; reason?: string },
  lead: LeadInfo,
  ctxLog?: ContextLogger
): Promise<string> {
  const startTime = Date.now();
  const log = ctxLog || createContextLogger(baseLog, { leadId: lead.id }, ['processing']);

  log.debug({
    leadId: maskUuid(lead.id),
    currentStage: lead.funnel_stage,
    currentStageName: STAGE_NAMES[lead.funnel_stage || ''] || 'unknown',
    newStage: args.stage,
    newStageName: STAGE_NAMES[args.stage] || 'unknown',
    reason: args.reason
  }, '[handleSetFunnelStage] >>> Starting funnel stage update', ['processing']);

  // Валидация этапа
  if (!VALID_FUNNEL_STAGES.includes(args.stage as typeof VALID_FUNNEL_STAGES[number])) {
    log.warn({
      stage: args.stage,
      validStages: [...VALID_FUNNEL_STAGES],
      elapsedMs: Date.now() - startTime
    }, '[handleSetFunnelStage] Invalid funnel stage provided', ['processing', 'validation']);
    return `Неверный этап воронки. Допустимые значения: ${VALID_FUNNEL_STAGES.join(', ')}.`;
  }

  // Проверка что этап изменился
  if (lead.funnel_stage === args.stage) {
    log.info({
      stage: args.stage,
      stageName: STAGE_NAMES[args.stage],
      leadId: maskUuid(lead.id),
      elapsedMs: Date.now() - startTime
    }, '[handleSetFunnelStage] Stage unchanged - already at this stage', ['processing']);
    return `Клиент уже находится на этапе "${STAGE_NAMES[args.stage] || args.stage}".`;
  }

  try {
    const dbStartTime = Date.now();
    const { error } = await supabase
      .from('dialog_analysis')
      .update({
        funnel_stage: args.stage,
        funnel_stage_changed_at: new Date().toISOString()
      })
      .eq('id', lead.id);
    const dbLatencyMs = Date.now() - dbStartTime;

    if (error) {
      log.error({
        leadId: maskUuid(lead.id),
        error: error.message,
        oldStage: lead.funnel_stage,
        newStage: args.stage,
        dbLatencyMs
      }, '[handleSetFunnelStage] Failed to update funnel stage in database', {}, ['processing', 'db']);
      return 'Не удалось обновить этап воронки.';
    }

    logDbOperation(log, 'update', 'dialog_analysis', {
      leadId: maskUuid(lead.id),
      field: 'funnel_stage',
      dbLatencyMs
    }, true);

    log.info({
      leadId: maskUuid(lead.id),
      oldStage: lead.funnel_stage,
      oldStageName: STAGE_NAMES[lead.funnel_stage || ''] || 'none',
      newStage: args.stage,
      newStageName: STAGE_NAMES[args.stage],
      reason: args.reason,
      dbLatencyMs,
      elapsedMs: Date.now() - startTime
    }, '[handleSetFunnelStage] <<< Funnel stage updated successfully', ['processing', 'db']);

    return `Этап воронки изменён на "${STAGE_NAMES[args.stage] || args.stage}".`;
  } catch (error: any) {
    log.error(error, '[handleSetFunnelStage] Error setting funnel stage', {
      leadId: maskUuid(lead.id),
      oldStage: lead.funnel_stage,
      newStage: args.stage,
      elapsedMs: Date.now() - startTime
    }, ['processing']);
    return 'Произошла ошибка при изменении этапа воронки.';
  }
}

/**
 * Обработчик: Установить уровень интереса
 */
async function handleSetLeadInterest(
  args: { interest: string; reason?: string },
  lead: LeadInfo,
  ctxLog?: ContextLogger
): Promise<string> {
  const startTime = Date.now();
  const log = ctxLog || createContextLogger(baseLog, { leadId: lead.id }, ['processing']);

  log.debug({
    leadId: maskUuid(lead.id),
    currentInterest: lead.interest_level,
    currentInterestName: INTEREST_NAMES[lead.interest_level || ''] || 'none',
    newInterest: args.interest,
    newInterestName: INTEREST_NAMES[args.interest] || 'unknown',
    reason: args.reason
  }, '[handleSetLeadInterest] >>> Starting interest level update', ['processing']);

  // Валидация уровня интереса
  if (!VALID_INTEREST_LEVELS.includes(args.interest as typeof VALID_INTEREST_LEVELS[number])) {
    log.warn({
      interest: args.interest,
      validInterests: [...VALID_INTEREST_LEVELS],
      elapsedMs: Date.now() - startTime
    }, '[handleSetLeadInterest] Invalid interest level provided', ['processing', 'validation']);
    return `Неверный уровень интереса. Допустимые значения: ${VALID_INTEREST_LEVELS.join(', ')}.`;
  }

  // Проверка что уровень изменился
  if (lead.interest_level === args.interest) {
    log.info({
      interest: args.interest,
      interestName: INTEREST_NAMES[args.interest],
      leadId: maskUuid(lead.id),
      elapsedMs: Date.now() - startTime
    }, '[handleSetLeadInterest] Interest unchanged - already at this level', ['processing']);
    return `Уровень интереса уже установлен как "${INTEREST_NAMES[args.interest] || args.interest}".`;
  }

  try {
    const dbStartTime = Date.now();
    const { error } = await supabase
      .from('dialog_analysis')
      .update({
        interest_level: args.interest
      })
      .eq('id', lead.id);
    const dbLatencyMs = Date.now() - dbStartTime;

    if (error) {
      log.error({
        leadId: maskUuid(lead.id),
        error: error.message,
        oldInterest: lead.interest_level,
        newInterest: args.interest,
        dbLatencyMs
      }, '[handleSetLeadInterest] Failed to update interest level in database', {}, ['processing', 'db']);
      return 'Не удалось обновить уровень интереса.';
    }

    logDbOperation(log, 'update', 'dialog_analysis', {
      leadId: maskUuid(lead.id),
      field: 'interest_level',
      dbLatencyMs
    }, true);

    log.info({
      leadId: maskUuid(lead.id),
      oldInterest: lead.interest_level,
      oldInterestName: INTEREST_NAMES[lead.interest_level || ''] || 'none',
      newInterest: args.interest,
      newInterestName: INTEREST_NAMES[args.interest],
      reason: args.reason,
      dbLatencyMs,
      elapsedMs: Date.now() - startTime
    }, '[handleSetLeadInterest] <<< Interest level updated successfully', ['processing', 'db']);

    return `Уровень интереса изменён на "${INTEREST_NAMES[args.interest] || args.interest}".`;
  } catch (error: any) {
    log.error(error, '[handleSetLeadInterest] Error setting interest level', {
      leadId: maskUuid(lead.id),
      oldInterest: lead.interest_level,
      newInterest: args.interest,
      elapsedMs: Date.now() - startTime
    }, ['processing']);
    return 'Произошла ошибка при изменении уровня интереса.';
  }
}

/**
 * Обработать вызов Lead Management tool
 */
export async function handleLeadManagementTool(
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
    currentStage: lead.funnel_stage,
    currentInterest: lead.interest_level
  }, '[handleLeadManagementTool] Routing Lead Management tool call', ['processing']);

  switch (functionName) {
    case 'update_lead_info':
      return handleUpdateLeadInfo(args, lead, ctxLog);

    case 'set_funnel_stage':
      return handleSetFunnelStage(args, lead, ctxLog);

    case 'set_lead_interest':
      return handleSetLeadInterest(args, lead, ctxLog);

    default:
      log.warn({
        functionName,
        leadId: maskUuid(lead.id)
      }, '[handleLeadManagementTool] Unknown Lead Management function requested', ['processing']);
      return 'Неизвестная функция управления лидами.';
  }
}
