/**
 * LLM Qualification Agent
 *
 * Анализирует WhatsApp-переписки и определяет уровень конверсии лида.
 * Отправляет события в Meta CAPI при достижении уровней:
 *
 * 1. INTEREST (CompleteRegistration) - клиент отправил 3+ входящих сообщений
 * 2. QUALIFIED (AddToCart/Subscribe) - клиент ответил на все квалификационные вопросы
 * 3. SCHEDULED (Purchase) - клиент записался на ключевой этап
 */

import OpenAI from 'openai';
import { createLogger } from './logger.js';
import { supabase } from './supabase.js';
import {
  sendCapiEventAtomic,
  getDirectionPixelInfo,
  CAPI_EVENTS,
  type CapiEventLevel,
} from './metaCapiClient.js';
import { getContactMessages, isEvolutionDbAvailable } from './evolutionDb.js';

const log = createLogger({ module: 'qualificationAgent' });

const INTEREST_MSG_THRESHOLD = Number.isFinite(Number(process.env.CAPI_INTEREST_MSG_THRESHOLD))
  ? Number(process.env.CAPI_INTEREST_MSG_THRESHOLD)
  : 3;
const QUALIFIED_CONFIDENCE_THRESHOLD = Number.isFinite(Number(process.env.CAPI_QUALIFIED_CONFIDENCE_THRESHOLD))
  ? Number(process.env.CAPI_QUALIFIED_CONFIDENCE_THRESHOLD)
  : 0.7;
const QUALIFICATION_MODEL = process.env.CAPI_QUAL_MODEL || 'wa-qualifier-v1';
const CAPI_CHANNEL = 'whatsapp_baileys';

// OpenAI timeout configuration
const OPENAI_TIMEOUT_MS = 30000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: OPENAI_TIMEOUT_MS,
});

// Result from LLM qualification analysis
export interface QualificationResult {
  is_interested: boolean;     // Level 1: 3+ inbound messages
  is_qualified: boolean;      // Level 2: Passed qualification
  is_scheduled: boolean;      // Level 3: Booked appointment
  confidence?: number;        // Confidence 0..1 for qualification decision
  qualification_details: {
    answered_questions: number;
    matching_criteria: number;
    missing_info: string[];
  };
  reasoning: string;
}

// CRM field config from direction CAPI settings
interface CapiFieldConfig {
  field_id: string | number;
  field_name: string;
  field_type: string;
  enum_id?: string | number | null;
  enum_value?: string | null;
  entity_type?: string;
}

// Direction CAPI settings
interface DirectionCapiSettings {
  capi_enabled: boolean;
  capi_source: 'whatsapp' | 'crm' | null;
  capi_crm_type: 'amocrm' | 'bitrix24' | null;
  capi_interest_fields: CapiFieldConfig[];
  capi_qualified_fields: CapiFieldConfig[];
  capi_scheduled_fields: CapiFieldConfig[];
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
  lead_id?: string;
  direction_id?: string;
  // CAPI flags
  capi_interest_sent?: boolean;
  capi_qualified_sent?: boolean;
  capi_scheduled_sent?: boolean;
  // Direction CAPI settings (loaded from direction)
  direction_capi_settings?: DirectionCapiSettings;
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
 * Validate JSONB CAPI field config
 * Ensures the data has the expected structure
 */
function validateCapiFields(fields: unknown): CapiFieldConfig[] {
  if (!fields || !Array.isArray(fields)) {
    return [];
  }

  return fields.filter((f): f is CapiFieldConfig => {
    if (!f || typeof f !== 'object') return false;
    // field_id and field_name are required
    return (
      (typeof f.field_id === 'string' || typeof f.field_id === 'number') &&
      typeof f.field_name === 'string'
    );
  });
}

/**
 * Get direction CAPI settings
 * With JSONB validation for field configs
 */
async function getDirectionCapiSettings(
  directionId: string
): Promise<DirectionCapiSettings | null> {
  try {
    const { data: direction, error } = await supabase
      .from('account_directions')
      .select(`
        capi_enabled,
        capi_source,
        capi_crm_type,
        capi_interest_fields,
        capi_qualified_fields,
        capi_scheduled_fields
      `)
      .eq('id', directionId)
      .single();

    if (error) {
      log.warn({
        error: error.message,
        directionId,
      }, 'Error fetching direction CAPI settings');
      return null;
    }

    if (!direction) return null;

    // Validate JSONB fields to prevent runtime errors
    const interestFields = validateCapiFields(direction.capi_interest_fields);
    const qualifiedFields = validateCapiFields(direction.capi_qualified_fields);
    const scheduledFields = validateCapiFields(direction.capi_scheduled_fields);

    return {
      capi_enabled: direction.capi_enabled || false,
      capi_source: direction.capi_source || null,
      capi_crm_type: direction.capi_crm_type || null,
      capi_interest_fields: interestFields,
      capi_qualified_fields: qualifiedFields,
      capi_scheduled_fields: scheduledFields,
    };
  } catch (error) {
    log.error({
      error: error instanceof Error ? error.message : String(error),
      directionId,
    }, 'Error getting direction CAPI settings');
    return null;
  }
}

/**
 * CRM qualification status from leads table
 */
interface CrmQualificationStatus {
  hasIntegration: boolean;      // Has CRM configured in direction
  isInterested: boolean;        // From CRM field matching (if configured)
  isQualified: boolean;         // From leads.is_qualified (set by CRM sync)
  isScheduled: boolean;         // From leads.is_scheduled (set by CRM sync)
  source: 'amocrm' | 'bitrix24' | null;
}

/**
 * Get CRM qualification status for a lead
 * Uses direction-level CAPI settings for field matching
 */
async function getCrmQualificationStatus(
  contactPhone: string,
  userAccountId: string,
  capiSettings?: DirectionCapiSettings
): Promise<CrmQualificationStatus> {
  const defaultResult: CrmQualificationStatus = {
    hasIntegration: false,
    isInterested: false,
    isQualified: false,
    isScheduled: false,
    source: null,
  };

  // If no CAPI settings or source is not CRM, return default
  if (!capiSettings || capiSettings.capi_source !== 'crm' || !capiSettings.capi_crm_type) {
    return defaultResult;
  }

  try {
    // Find lead by phone
    const { data: lead, error } = await supabase
      .from('leads')
      .select('is_qualified, is_scheduled, amocrm_lead_id, bitrix24_lead_id, bitrix24_deal_id')
      .eq('chat_id', contactPhone)
      .eq('user_account_id', userAccountId)
      .maybeSingle();

    // Check for DB error
    if (error) {
      log.error({
        error: error.message,
        contactPhone,
        userAccountId,
      }, 'Error fetching lead for CRM qualification status');
      return defaultResult;
    }

    if (!lead) return defaultResult;

    // Determine source from lead data
    let detectedSource: 'amocrm' | 'bitrix24' | null = null;
    if (lead.amocrm_lead_id) {
      detectedSource = 'amocrm';
    } else if (lead.bitrix24_lead_id || lead.bitrix24_deal_id) {
      detectedSource = 'bitrix24';
    }

    // Use the source configured in direction, or detected from lead
    const source = capiSettings.capi_crm_type || detectedSource;

    return {
      hasIntegration: true,
      // For interest - we check if interest fields are configured (will be evaluated by CRM sync)
      isInterested: capiSettings.capi_interest_fields.length > 0,
      isQualified: lead.is_qualified || false,
      isScheduled: lead.is_scheduled || false,
      source,
    };
  } catch (error) {
    log.error({
      error: error instanceof Error ? error.message : String(error),
      contactPhone,
      userAccountId,
    }, 'Error getting CRM qualification status');
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
  dialog: DialogData,
  correlationId?: string
): Promise<QualificationResult | null> {
  const analysisStartTime = Date.now();

  log.info({
    correlationId,
    dialogId: dialog.id,
    contactPhone: dialog.contact_phone,
    messageCount: dialog.messages?.length || 0,
    incomingCount: dialog.incoming_count,
    action: 'qualification_start',
  }, 'Starting qualification analysis');

  // Get qualification prompt (prompt2)
  const promptStartTime = Date.now();
  const qualificationPrompt = await getQualificationPrompt(
    dialog.user_account_id,
    dialog.account_id
  );
  const promptDurationMs = Date.now() - promptStartTime;

  if (!qualificationPrompt) {
    log.warn({
      correlationId,
      dialogId: dialog.id,
      userAccountId: dialog.user_account_id,
      promptDurationMs,
    }, 'No qualification prompt (prompt2) found, using default');
  } else {
    log.debug({
      correlationId,
      dialogId: dialog.id,
      promptDurationMs,
      action: 'qualification_prompt_loaded',
    }, 'Qualification prompt loaded');
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
  "is_interested": boolean,      // true если клиент отправил ${INTEREST_MSG_THRESHOLD}+ сообщения
  "is_qualified": boolean,       // true если ответил на все квалификационные вопросы правильно
  "is_scheduled": boolean,       // true если записался на консультацию/встречу
  "confidence": number,          // уверенность 0..1 для is_qualified
  "qualification_details": {
    "answered_questions": number,  // сколько вопросов ответил
    "matching_criteria": number,   // сколько критериев совпало
    "missing_info": string[]       // какой информации не хватает
  },
  "reasoning": string              // краткое обоснование решения (1-2 предложения)
}

ВАЖНО: Возвращай ТОЛЬКО JSON, без дополнительного текста.`;

    const openaiStartTime = Date.now();

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

    const openaiDurationMs = Date.now() - openaiStartTime;
    const totalDurationMs = Date.now() - analysisStartTime;

    const content = response.choices[0]?.message?.content;

    if (!content) {
      log.error({
        correlationId,
        dialogId: dialog.id,
        openaiDurationMs,
        totalDurationMs,
        action: 'qualification_empty_response',
      }, 'OpenAI returned empty response');
      return null;
    }

    const result = JSON.parse(content) as QualificationResult;

    log.info({
      correlationId,
      dialogId: dialog.id,
      isInterested: result.is_interested,
      isQualified: result.is_qualified,
      isScheduled: result.is_scheduled,
      confidence: result.confidence,
      reasoning: result.reasoning,
      openaiDurationMs,
      totalDurationMs,
      tokensUsed: response.usage?.total_tokens,
      action: 'qualification_complete',
    }, 'Qualification analysis complete');

    return result;
  } catch (error) {
    const totalDurationMs = Date.now() - analysisStartTime;

    log.error({
      correlationId,
      error: error instanceof Error ? error.message : String(error),
      dialogId: dialog.id,
      totalDurationMs,
      action: 'qualification_error',
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
1. ИНТЕРЕС (is_interested): клиент отправил ${INTEREST_MSG_THRESHOLD} или более сообщений
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
 * Now uses direction-level CAPI settings to determine behavior
 */
export async function processDialogForCapi(
  dialog: DialogData,
  correlationId?: string
): Promise<void> {
  log.info({
    correlationId,
    dialogId: dialog.id,
    contactPhone: dialog.contact_phone,
    directionId: dialog.direction_id,
    alreadySentInterest: dialog.capi_interest_sent,
    alreadySentQualified: dialog.capi_qualified_sent,
    alreadySentScheduled: dialog.capi_scheduled_sent,
    action: 'process_dialog_for_capi_start',
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

  // Get direction CAPI settings
  let capiSettings: DirectionCapiSettings | null = null;
  if (dialog.direction_id) {
    capiSettings = await getDirectionCapiSettings(dialog.direction_id);
  }

  // If CAPI not enabled for this direction, skip
  if (!capiSettings?.capi_enabled) {
    log.debug({
      dialogId: dialog.id,
      directionId: dialog.direction_id,
    }, 'CAPI not enabled for direction, skipping');
    return;
  }

  log.info({
    dialogId: dialog.id,
    capiSource: capiSettings.capi_source,
    capiCrmType: capiSettings.capi_crm_type,
  }, 'Direction CAPI settings');

  let result: QualificationResult;
  let interestSource: string | null = null;
  let qualifiedSource: string | null = null;
  let scheduledSource: string | null = null;

  if (capiSettings.capi_source === 'crm') {
    // CRM mode: use CRM field matching
    const crmStatus = await getCrmQualificationStatus(
      dialog.contact_phone,
      dialog.user_account_id,
      capiSettings
    );

    log.info({
      dialogId: dialog.id,
      crmStatus,
    }, 'CRM qualification status');

    result = {
      is_interested: crmStatus.isInterested,
      is_qualified: crmStatus.isQualified,
      is_scheduled: crmStatus.isScheduled,
      confidence: crmStatus.isQualified ? 1 : 0,
      qualification_details: {
        answered_questions: 0,
        matching_criteria: 0,
        missing_info: [],
      },
      reasoning: 'CRM field matching',
    };

    if (crmStatus.isInterested) interestSource = crmStatus.source;
    if (crmStatus.isQualified) qualifiedSource = crmStatus.source;
    if (crmStatus.isScheduled) scheduledSource = crmStatus.source;
  } else {
    // WhatsApp mode: use LLM analysis
    const llmResult = await analyzeQualification(dialog, correlationId);

    if (!llmResult) {
      log.warn({ correlationId, dialogId: dialog.id }, 'LLM qualification analysis failed');
    }

    const interestByCount = dialog.incoming_count >= INTEREST_MSG_THRESHOLD;
    const confidence = typeof llmResult?.confidence === 'number' ? llmResult.confidence : 0;
    const qualifiedByLlm = !!llmResult?.is_qualified && confidence >= QUALIFIED_CONFIDENCE_THRESHOLD;

    result = {
      is_interested: interestByCount,
      is_qualified: qualifiedByLlm,
      is_scheduled: !!llmResult?.is_scheduled,
      confidence,
      qualification_details: llmResult?.qualification_details || {
        answered_questions: 0,
        matching_criteria: 0,
        missing_info: [],
      },
      reasoning: llmResult?.reasoning || 'LLM analysis failed',
    };

    if (result.is_interested) interestSource = 'whatsapp';
    if (result.is_qualified) qualifiedSource = 'whatsapp';
    if (result.is_scheduled) scheduledSource = 'whatsapp';
  }

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
  // Level 3: Schedule
  if (result.is_scheduled && !dialog.capi_scheduled_sent) {
    log.info({
      correlationId,
      dialogId: dialog.id,
      source: scheduledSource,
      action: 'capi_send_scheduled_start',
    }, 'Sending CAPI Schedule event');
    await sendCapiEventForLevel(dialog, 3, pixelId, accessToken, result, correlationId);
  }

  // Level 2: Qualified
  if (result.is_qualified && !dialog.capi_qualified_sent) {
    log.info({
      correlationId,
      dialogId: dialog.id,
      source: qualifiedSource,
      action: 'capi_send_qualified_start',
    }, 'Sending CAPI Qualified event');
    await sendCapiEventForLevel(dialog, 2, pixelId, accessToken, result, correlationId);
  }

  // Level 1: Interested
  if (result.is_interested && !dialog.capi_interest_sent) {
    log.info({
      correlationId,
      dialogId: dialog.id,
      source: interestSource,
      action: 'capi_send_interest_start',
    }, 'Sending CAPI Interest event');
    await sendCapiEventForLevel(dialog, 1, pixelId, accessToken, result, correlationId);
  }
}

/**
 * Send CAPI event for a specific level
 * Uses atomic send to prevent race conditions
 */
async function sendCapiEventForLevel(
  dialog: DialogData,
  level: CapiEventLevel,
  pixelId: string,
  accessToken: string,
  result?: QualificationResult,
  correlationId?: string
): Promise<void> {
  const eventName = {
    1: CAPI_EVENTS.INTEREST,
    2: CAPI_EVENTS.QUALIFIED,
    3: CAPI_EVENTS.SCHEDULED,
  }[level];

  const baseCustomData = {
    channel: CAPI_CHANNEL,
  };

  const customData = level === 1 ? {
    ...baseCustomData,
    stage: 'interest',
    rule: `${INTEREST_MSG_THRESHOLD}_inbound_msgs`,
    msg_count: dialog.incoming_count,
  } : level === 2 ? {
    ...baseCustomData,
    stage: 'qualified',
    qual_model: QUALIFICATION_MODEL,
    confidence: result?.confidence ?? null,
  } : {
    ...baseCustomData,
    stage: 'scheduled',
    outcome: 'booked',
  };

  log.info({
    correlationId,
    dialogId: dialog.id,
    level,
    eventName,
    pixelId,
    action: 'capi_event_atomic_start',
  }, 'Sending CAPI event (atomic)');

  // Use atomic send to prevent duplicate events
  const response = await sendCapiEventAtomic({
    pixelId,
    accessToken,
    eventName,
    eventLevel: level,
    phone: dialog.contact_phone,
    ctwaClid: dialog.ctwa_clid,
    dialogAnalysisId: dialog.id,
    leadId: dialog.lead_id ? String(dialog.lead_id) : undefined,
    userAccountId: dialog.user_account_id,
    directionId: dialog.direction_id,
    customData,
    correlationId,
  });

  if (response.success) {
    log.info({
      correlationId,
      dialogId: dialog.id,
      level,
      eventId: response.eventId,
      action: 'capi_event_atomic_success',
    }, 'CAPI event sent successfully');
  } else {
    // Could be already sent (dedup) or actual error
    log.info({
      correlationId,
      dialogId: dialog.id,
      level,
      error: response.error,
      action: 'capi_event_atomic_skipped',
    }, 'CAPI event not sent');
  }
}

/**
 * Get dialog data for CAPI processing
 * Includes direction_id from dialog_analysis (migration 129) or leads table as fallback
 */
export async function getDialogForCapi(
  instanceName: string,
  contactPhone: string
): Promise<DialogData | null> {
  try {
    // Include direction_id from dialog_analysis (added in migration 129)
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
        direction_id,
        capi_interest_sent,
        capi_qualified_sent,
        capi_scheduled_sent
      `)
      .eq('instance_name', instanceName)
      .eq('contact_phone', contactPhone)
      .single();

    if (error) {
      log.warn({
        instanceName,
        contactPhone,
        error: error.message,
      }, 'Error fetching dialog for CAPI');
      return null;
    }

    if (!dialog) {
      log.debug({ instanceName, contactPhone }, 'Dialog not found for CAPI');
      return null;
    }

    // If direction_id is not in dialog_analysis, try to get it from leads table
    let directionId = dialog.direction_id;
    let ctwaClid = dialog.ctwa_clid;
    let leadId: string | undefined;

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, direction_id, ctwa_clid')
      .eq('chat_id', contactPhone)
      .eq('user_account_id', dialog.user_account_id)
      .maybeSingle();

    if (leadError) {
      log.warn({
        contactPhone,
        error: leadError.message,
      }, 'Error fetching lead for CAPI enrichment');
    }

    if (lead) {
      leadId = String(lead.id);
      if (!directionId && lead.direction_id) {
        directionId = lead.direction_id;
        log.debug({ contactPhone, directionId }, 'Using direction_id from leads table');
      }
      if (!ctwaClid && lead.ctwa_clid) {
        ctwaClid = lead.ctwa_clid;
      }
    }

    // Warn if direction_id is still missing
    if (!directionId) {
      log.warn({
        dialogId: dialog.id,
        instanceName,
        contactPhone,
      }, 'No direction_id found for dialog - CAPI will be skipped');
    }

    // If messages is empty, try to fetch from Evolution PostgreSQL
    // This enables CAPI for users without AI bot
    let messages = dialog.messages || [];

    if (messages.length === 0 && isEvolutionDbAvailable()) {
      log.info({
        dialogId: dialog.id,
        instanceName,
        contactPhone,
      }, 'Messages empty in dialog_analysis, fetching from Evolution DB');

      try {
        messages = await getContactMessages(instanceName, contactPhone);
        log.info({
          dialogId: dialog.id,
          instanceName,
          contactPhone,
          messageCount: messages.length,
        }, 'Fetched messages from Evolution DB');
      } catch (error) {
        log.error({
          error: error instanceof Error ? error.message : String(error),
          instanceName,
          contactPhone,
        }, 'Failed to fetch messages from Evolution DB, proceeding with empty messages');
        messages = [];
      }
    }

    return {
      ...dialog,
      lead_id: leadId,
      direction_id: directionId || undefined,
      ctwa_clid: ctwaClid || undefined,
      messages,
    } as DialogData;
  } catch (error) {
    log.error({
      error: error instanceof Error ? error.message : String(error),
      instanceName,
      contactPhone,
    }, 'Error getting dialog for CAPI');
    return null;
  }
}
