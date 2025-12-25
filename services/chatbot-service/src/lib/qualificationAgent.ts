/**
 * LLM Qualification Agent
 *
 * Анализирует WhatsApp-переписки и определяет уровень конверсии лида.
 * Отправляет события в Meta CAPI при достижении уровней:
 *
 * 1. INTEREST (Lead) - клиент отправил 2+ сообщения
 * 2. QUALIFIED (CompleteRegistration) - клиент ответил на все квалификационные вопросы
 * 3. SCHEDULED (Schedule) - клиент записался на консультацию/встречу
 */

import OpenAI from 'openai';
import { createLogger } from './logger.js';
import { supabase } from './supabase.js';
import {
  sendCapiEvent,
  updateDialogCapiFlags,
  getDirectionPixelInfo,
  CAPI_EVENTS,
  type CapiEventLevel,
} from './metaCapiClient.js';

const log = createLogger({ module: 'qualificationAgent' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Result from LLM qualification analysis
export interface QualificationResult {
  is_interested: boolean;     // Level 1: 2+ messages
  is_qualified: boolean;      // Level 2: Passed qualification
  is_scheduled: boolean;      // Level 3: Booked appointment
  qualification_details: {
    answered_questions: number;
    matching_criteria: number;
    missing_info: string[];
  };
  reasoning: string;
}

// Dialog data for analysis
interface DialogData {
  id: string;
  user_account_id: string;
  account_id?: string;
  instance_name: string;
  contact_phone: string;
  incoming_count: number;
  outgoing_count: number;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
  }>;
  funnel_stage?: string;
  ctwa_clid?: string;
  direction_id?: string;
  // CAPI flags
  capi_interest_sent?: boolean;
  capi_qualified_sent?: boolean;
  capi_scheduled_sent?: boolean;
}

/**
 * Get prompt2 (qualification criteria) for a user account
 */
async function getQualificationPrompt(
  userAccountId: string,
  accountId?: string
): Promise<string | null> {
  try {
    // Try ad_accounts first (multi-account mode)
    if (accountId) {
      const { data: adAccount } = await supabase
        .from('ad_accounts')
        .select('prompt2')
        .eq('id', accountId)
        .single();

      if (adAccount?.prompt2) {
        return adAccount.prompt2;
      }
    }

    // Fallback to user_accounts
    const { data: userAccount } = await supabase
      .from('user_accounts')
      .select('prompt2')
      .eq('id', userAccountId)
      .single();

    return userAccount?.prompt2 || null;
  } catch (error) {
    log.error({ error, userAccountId, accountId }, 'Error getting qualification prompt');
    return null;
  }
}

/**
 * CRM qualification status from leads table
 */
interface CrmQualificationStatus {
  hasIntegration: boolean;      // Has AMO CRM or Bitrix24 connected
  isQualified: boolean;         // From leads.is_qualified (set by CRM sync)
  isScheduled: boolean;         // From leads.is_scheduled (set by CRM sync)
  source: 'amocrm' | 'bitrix24' | null;
}

/**
 * Get CRM qualification status for a lead
 * Checks leads table for is_qualified flag set by AMO/Bitrix sync
 */
async function getCrmQualificationStatus(
  contactPhone: string,
  userAccountId: string
): Promise<CrmQualificationStatus> {
  const defaultResult: CrmQualificationStatus = {
    hasIntegration: false,
    isQualified: false,
    isScheduled: false,
    source: null,
  };

  try {
    // Check if user has AMO or Bitrix integration
    const { data: userAccount } = await supabase
      .from('user_accounts')
      .select(`
        amocrm_access_token,
        bitrix24_access_token,
        amocrm_qualification_fields,
        amocrm_scheduled_fields,
        bitrix24_qualification_fields,
        bitrix24_scheduled_fields
      `)
      .eq('id', userAccountId)
      .single();

    if (!userAccount) return defaultResult;

    const hasAmocrm = !!userAccount.amocrm_access_token;
    const hasBitrix = !!userAccount.bitrix24_access_token;

    if (!hasAmocrm && !hasBitrix) return defaultResult;

    // Find lead by phone
    const { data: lead } = await supabase
      .from('leads')
      .select('is_qualified, is_scheduled, amocrm_lead_id, bitrix24_lead_id, bitrix24_deal_id')
      .eq('chat_id', contactPhone)
      .eq('user_account_id', userAccountId)
      .maybeSingle();

    if (!lead) return defaultResult;

    // Determine source
    let source: 'amocrm' | 'bitrix24' | null = null;
    if (lead.amocrm_lead_id) {
      source = 'amocrm';
    } else if (lead.bitrix24_lead_id || lead.bitrix24_deal_id) {
      source = 'bitrix24';
    }

    return {
      hasIntegration: hasAmocrm || hasBitrix,
      isQualified: lead.is_qualified || false,
      isScheduled: lead.is_scheduled || false,
      source,
    };
  } catch (error) {
    log.error({ error, contactPhone, userAccountId }, 'Error getting CRM qualification status');
    return defaultResult;
  }
}

/**
 * Format dialog messages for LLM analysis
 */
function formatMessagesForAnalysis(
  messages: DialogData['messages']
): string {
  if (!messages || messages.length === 0) {
    return '(Нет сообщений)';
  }

  return messages
    .map((msg, index) => {
      const role = msg.role === 'user' ? 'КЛИЕНТ' : 'МЕНЕДЖЕР/БОТ';
      return `[${index + 1}] ${role}: ${msg.content}`;
    })
    .join('\n');
}

/**
 * Analyze dialog and determine qualification level
 */
export async function analyzeQualification(
  dialog: DialogData
): Promise<QualificationResult | null> {
  log.info({
    dialogId: dialog.id,
    contactPhone: dialog.contact_phone,
    messageCount: dialog.messages?.length || 0,
    incomingCount: dialog.incoming_count,
  }, 'Starting qualification analysis');

  // Get qualification prompt (prompt2)
  const qualificationPrompt = await getQualificationPrompt(
    dialog.user_account_id,
    dialog.account_id
  );

  if (!qualificationPrompt) {
    log.warn({
      dialogId: dialog.id,
      userAccountId: dialog.user_account_id,
    }, 'No qualification prompt (prompt2) found, using default');
  }

  try {
    const systemPrompt = qualificationPrompt || getDefaultQualificationPrompt();

    const userPrompt = `Проанализируй следующую WhatsApp-переписку и определи уровень конверсии:

ИСТОРИЯ ПЕРЕПИСКИ:
${formatMessagesForAnalysis(dialog.messages)}

СТАТИСТИКА:
- Сообщений от клиента: ${dialog.incoming_count}
- Сообщений от менеджера/бота: ${dialog.outgoing_count}
- Текущий этап воронки: ${dialog.funnel_stage || 'new_lead'}

Верни JSON с результатом анализа:
{
  "is_interested": boolean,      // true если клиент отправил 2+ сообщения
  "is_qualified": boolean,       // true если ответил на все квалификационные вопросы правильно
  "is_scheduled": boolean,       // true если записался на консультацию/встречу
  "qualification_details": {
    "answered_questions": number,  // сколько вопросов ответил
    "matching_criteria": number,   // сколько критериев совпало
    "missing_info": string[]       // какой информации не хватает
  },
  "reasoning": string              // краткое обоснование решения (1-2 предложения)
}

ВАЖНО: Возвращай ТОЛЬКО JSON, без дополнительного текста.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      log.error({ dialogId: dialog.id }, 'OpenAI returned empty response');
      return null;
    }

    const result = JSON.parse(content) as QualificationResult;

    log.info({
      dialogId: dialog.id,
      isInterested: result.is_interested,
      isQualified: result.is_qualified,
      isScheduled: result.is_scheduled,
      reasoning: result.reasoning,
    }, 'Qualification analysis complete');

    return result;
  } catch (error) {
    log.error({
      error: error instanceof Error ? error.message : String(error),
      dialogId: dialog.id,
    }, 'Error in qualification analysis');
    return null;
  }
}

/**
 * Default qualification prompt if prompt2 is not set
 */
function getDefaultQualificationPrompt(): string {
  return `Ты — AI-агент для квалификации лидов в WhatsApp.

Твоя задача — анализировать переписку и определять:
1. ИНТЕРЕС (is_interested): клиент отправил 2 или более сообщений
2. КВАЛИФИКАЦИЯ (is_qualified): клиент ответил на ключевые вопросы и подходит как потенциальный клиент
3. ЗАПИСЬ (is_scheduled): клиент согласился на встречу, консультацию или услугу

ПРИЗНАКИ КВАЛИФИЦИРОВАННОГО ЛИДА:
- Ответил на вопрос о своей проблеме/потребности
- Указал, когда хочет получить услугу (сроки)
- Готов обсуждать детали/цены
- Не отказался явно

ПРИЗНАКИ ЗАПИСИ:
- Согласился на конкретное время/дату
- Подтвердил бронирование
- Запросил адрес/детали встречи
- Сказал "приду", "запишите", "да, давайте"

ВАЖНО:
- Будь консервативен в определении is_qualified — только если есть явные признаки
- is_scheduled только при явном подтверждении записи`;
}

/**
 * Process dialog and send CAPI events if needed
 */
export async function processDialogForCapi(
  dialog: DialogData
): Promise<void> {
  log.info({
    dialogId: dialog.id,
    contactPhone: dialog.contact_phone,
    alreadySentInterest: dialog.capi_interest_sent,
    alreadySentQualified: dialog.capi_qualified_sent,
    alreadySentScheduled: dialog.capi_scheduled_sent,
  }, 'Processing dialog for CAPI');

  // Quick check: if all events already sent, skip
  if (
    dialog.capi_interest_sent &&
    dialog.capi_qualified_sent &&
    dialog.capi_scheduled_sent
  ) {
    log.debug({ dialogId: dialog.id }, 'All CAPI events already sent, skipping');
    return;
  }

  // Check CRM status first (from leads table synced with AMO/Bitrix)
  const crmStatus = await getCrmQualificationStatus(
    dialog.contact_phone,
    dialog.user_account_id
  );

  log.info({
    dialogId: dialog.id,
    crmStatus,
  }, 'CRM qualification status');

  // Analyze qualification via LLM
  const llmResult = await analyzeQualification(dialog);

  if (!llmResult) {
    log.warn({ dialogId: dialog.id }, 'LLM qualification analysis failed');
  }

  // Merge CRM and LLM results
  // CRM takes priority for qualified and scheduled if available
  const result: QualificationResult = {
    is_interested: llmResult?.is_interested || (dialog.incoming_count >= 2),
    is_qualified: crmStatus.hasIntegration && crmStatus.source
      ? crmStatus.isQualified
      : (llmResult?.is_qualified || false),
    is_scheduled: crmStatus.hasIntegration && crmStatus.source
      ? crmStatus.isScheduled
      : (llmResult?.is_scheduled || false),
    qualification_details: llmResult?.qualification_details || {
      answered_questions: 0,
      matching_criteria: 0,
      missing_info: [],
    },
    reasoning: llmResult?.reasoning || 'LLM analysis failed',
  };

  // Determine sources
  const qualifiedSource = crmStatus.hasIntegration && crmStatus.source && crmStatus.isQualified
    ? crmStatus.source
    : (llmResult?.is_qualified ? 'whatsapp' : null);

  const scheduledSource = crmStatus.hasIntegration && crmStatus.source && crmStatus.isScheduled
    ? crmStatus.source
    : (llmResult?.is_scheduled ? 'whatsapp' : null);

  // Save qualification result to dialog_analysis
  await supabase
    .from('dialog_analysis')
    .update({
      qualification_result: result,
      capi_qualified_source: qualifiedSource,
      capi_scheduled_source: scheduledSource,
    })
    .eq('id', dialog.id);

  // Get pixel info for CAPI
  let pixelId: string | null = null;
  let accessToken: string | null = null;

  if (dialog.direction_id) {
    const pixelInfo = await getDirectionPixelInfo(dialog.direction_id);
    pixelId = pixelInfo.pixelId;
    accessToken = pixelInfo.accessToken;
  }

  // If no pixel configured, skip CAPI
  if (!pixelId || !accessToken) {
    log.debug({
      dialogId: dialog.id,
      directionId: dialog.direction_id,
    }, 'No pixel configured for direction, skipping CAPI');
    return;
  }

  // Send CAPI events based on levels (highest first)
  // Level 3: Scheduled
  if (result.is_scheduled && !dialog.capi_scheduled_sent) {
    log.info({
      dialogId: dialog.id,
      source: scheduledSource,
    }, 'Sending CAPI Schedule event');
    await sendCapiEventForLevel(dialog, 3, pixelId, accessToken);
  }

  // Level 2: Qualified
  if (result.is_qualified && !dialog.capi_qualified_sent) {
    log.info({
      dialogId: dialog.id,
      source: qualifiedSource,
    }, 'Sending CAPI Qualified event');
    await sendCapiEventForLevel(dialog, 2, pixelId, accessToken);
  }

  // Level 1: Interested (2+ messages)
  if (result.is_interested && !dialog.capi_interest_sent) {
    await sendCapiEventForLevel(dialog, 1, pixelId, accessToken);
  }
}

/**
 * Send CAPI event for a specific level
 */
async function sendCapiEventForLevel(
  dialog: DialogData,
  level: CapiEventLevel,
  pixelId: string,
  accessToken: string
): Promise<void> {
  const eventName = {
    1: CAPI_EVENTS.INTEREST,
    2: CAPI_EVENTS.QUALIFIED,
    3: CAPI_EVENTS.SCHEDULED,
  }[level];

  log.info({
    dialogId: dialog.id,
    level,
    eventName,
    pixelId,
  }, 'Sending CAPI event');

  const response = await sendCapiEvent({
    pixelId,
    accessToken,
    eventName,
    eventLevel: level,
    phone: dialog.contact_phone,
    ctwaClid: dialog.ctwa_clid,
    dialogAnalysisId: dialog.id,
    userAccountId: dialog.user_account_id,
    directionId: dialog.direction_id,
  });

  if (response.success && response.eventId) {
    // Update dialog flags
    await updateDialogCapiFlags(dialog.id, level, response.eventId);

    log.info({
      dialogId: dialog.id,
      level,
      eventId: response.eventId,
    }, 'CAPI event sent and flags updated');
  } else {
    log.warn({
      dialogId: dialog.id,
      level,
      error: response.error,
    }, 'Failed to send CAPI event');
  }
}

/**
 * Get dialog data for CAPI processing
 */
export async function getDialogForCapi(
  instanceName: string,
  contactPhone: string
): Promise<DialogData | null> {
  try {
    const { data: dialog, error } = await supabase
      .from('dialog_analysis')
      .select(`
        id,
        user_account_id,
        account_id,
        instance_name,
        contact_phone,
        incoming_count,
        outgoing_count,
        messages,
        funnel_stage,
        ctwa_clid,
        capi_interest_sent,
        capi_qualified_sent,
        capi_scheduled_sent
      `)
      .eq('instance_name', instanceName)
      .eq('contact_phone', contactPhone)
      .single();

    if (error || !dialog) {
      log.warn({ instanceName, contactPhone, error }, 'Dialog not found');
      return null;
    }

    // Get direction_id and ctwa_clid from leads table
    const { data: lead } = await supabase
      .from('leads')
      .select('direction_id, ctwa_clid')
      .eq('chat_id', contactPhone)
      .eq('user_account_id', dialog.user_account_id)
      .maybeSingle();

    return {
      ...dialog,
      direction_id: lead?.direction_id || undefined,
      ctwa_clid: dialog.ctwa_clid || lead?.ctwa_clid || undefined,
      messages: dialog.messages || [],
    } as DialogData;
  } catch (error) {
    log.error({ error, instanceName, contactPhone }, 'Error getting dialog for CAPI');
    return null;
  }
}
