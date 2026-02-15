/**
 * Bitrix24 Webhooks Handler
 *
 * Processes incoming webhooks from Bitrix24 for lead/deal status updates
 *
 * Bitrix24 webhook events:
 * - ONCRMLEADADD - New lead created
 * - ONCRMLEADUPDATE - Lead updated
 * - ONCRMLEADDELETE - Lead deleted
 * - ONCRMDEALADD - New deal created
 * - ONCRMDEALUPDATE - Deal updated
 * - ONCRMDEALDELETE - Deal deleted
 * - ONCRMCONTACTADD - New contact created
 * - ONCRMCONTACTUPDATE - Contact updated
 *
 * @module routes/bitrix24Webhooks
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { getValidBitrix24Token } from '../lib/bitrix24Tokens.js';
import { getLead, getDeal, getContact } from '../adapters/bitrix24.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import {
  getDirectionCapiSettings,
  evaluateBitrixCapiLevelsWithDiagnostics,
  normalizeContactPhoneForCapi,
  sendCrmCapiLevels,
  summarizeDirectionCapiSettings
} from '../lib/crmCapi.js';

/**
 * Bitrix24 webhook payload structure
 */
interface Bitrix24WebhookPayload {
  event: string;
  data: {
    FIELDS: {
      ID: string;
    };
  };
  ts: string;
  auth: {
    domain: string;
    client_endpoint: string;
    server_endpoint: string;
    member_id: string;
    application_token: string;
  };
}

export default async function bitrix24WebhooksRoutes(app: FastifyInstance) {
  /**
   * POST /webhooks/bitrix24
   * External URL: /api/webhooks/bitrix24?user_id={uuid}
   *
   * Receives webhook events from Bitrix24
   *
   * Query params:
   *   - user_id: User account UUID (passed when registering webhook)
   *
   * Body: Bitrix24 webhook payload
   */
  app.post('/webhooks/bitrix24', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { user_id: userAccountId, account_id: accountId } = request.query as {
        user_id?: string;
        account_id?: string;  // For multi-account mode
      };

      if (!userAccountId) {
        app.log.warn('Bitrix24 webhook received without user_id');
        return reply.code(400).send({ error: 'Missing user_id parameter' });
      }

      const payload = request.body as Bitrix24WebhookPayload;

      if (!payload || !payload.event) {
        app.log.warn({ payload }, 'Invalid Bitrix24 webhook payload');
        return reply.code(400).send({ error: 'Invalid payload' });
      }

      const { event, data, auth } = payload;
      const entityId = data?.FIELDS?.ID;

      if (!entityId) {
        app.log.warn({
          userAccountId,
          event,
          payloadKeys: Object.keys(payload),
          hasData: !!data,
          sampleKey: Object.keys(payload).find(k => k.includes('FIELDS'))
        }, 'Bitrix24 webhook: entityId is missing from payload');
      }

      app.log.info({
        userAccountId,
        accountId,
        event,
        entityId,
        domain: auth?.domain,
        memberId: auth?.member_id
      }, 'Received Bitrix24 webhook');

      // Process webhook asynchronously to respond quickly
      setImmediate(async () => {
        try {
          await processWebhook(app, userAccountId, event, entityId, payload, accountId);
        } catch (error: any) {
          app.log.error({ error, event, entityId }, 'Error processing Bitrix24 webhook');

          logErrorToAdmin({
            user_account_id: userAccountId,
            error_type: 'bitrix24',
            raw_error: error.message || String(error),
            stack_trace: error.stack,
            action: 'bitrix24_webhook_process',
            endpoint: '/webhooks/bitrix24',
            severity: 'warning',
            request_data: { event, entityId }
          }).catch(() => {});
        }
      });

      // Always respond with 200 to acknowledge receipt
      return reply.send({ status: 'ok' });

    } catch (error: any) {
      app.log.error({ error }, 'Error handling Bitrix24 webhook');

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });
}

/**
 * Process webhook event
 */
async function processWebhook(
  app: FastifyInstance,
  userAccountId: string,
  event: string,
  entityId: string,
  payload: Bitrix24WebhookPayload,
  accountId?: string  // For multi-account mode
): Promise<void> {
  // Get valid token for API calls
  let accessToken: string;
  let domain: string;

  try {
    // Pass accountId for multi-account mode token lookup
    const tokenData = await getValidBitrix24Token(userAccountId, accountId || null);
    accessToken = tokenData.accessToken;
    domain = tokenData.domain;
  } catch (error: any) {
    app.log.error({ error, userAccountId, accountId }, 'Failed to get Bitrix24 token for webhook processing');
    return;
  }

  switch (event) {
    case 'ONCRMLEADADD':
    case 'ONCRMLEADUPDATE':
      await handleLeadEvent(app, userAccountId, entityId, domain, accessToken, event);
      break;

    case 'ONCRMDEALADD':
    case 'ONCRMDEALUPDATE':
      await handleDealEvent(app, userAccountId, entityId, domain, accessToken, event);
      break;

    case 'ONCRMLEADDELETE':
      await handleLeadDelete(app, userAccountId, entityId);
      break;

    case 'ONCRMDEALDELETE':
      await handleDealDelete(app, userAccountId, entityId);
      break;

    case 'ONCRMCONTACTADD':
    case 'ONCRMCONTACTUPDATE':
      await handleContactEvent(app, userAccountId, entityId, domain, accessToken, event);
      break;

    default:
      app.log.debug({ event, entityId }, 'Unhandled Bitrix24 webhook event');
  }

  // Log webhook to history
  await logWebhookToHistory(userAccountId, entityId, event, payload);
}

/**
 * Handle lead add/update event
 */
async function handleLeadEvent(
  app: FastifyInstance,
  userAccountId: string,
  leadId: string,
  domain: string,
  accessToken: string,
  event: string
): Promise<void> {
  // Fetch full lead data from Bitrix24
  const bitrixLead = await getLead(domain, accessToken, leadId);

  if (!bitrixLead) {
    app.log.warn({ leadId }, 'Lead not found in Bitrix24');
    return;
  }

  // Get qualification config
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('bitrix24_qualification_fields')
    .eq('id', userAccountId)
    .single();

  const qualificationFields = userAccount?.bitrix24_qualification_fields || [];
  const isQualified = checkQualification(bitrixLead, qualificationFields);

  // Find local lead by bitrix24_lead_id
  const { data: localLead } = await supabase
    .from('leads')
    .select('id, current_status_id, is_qualified, direction_id, chat_id, phone')
    .eq('user_account_id', userAccountId)
    .eq('bitrix24_lead_id', parseInt(leadId, 10))
    .single();

  if (localLead) {
    // Update existing lead
    const previousStatusId = localLead.current_status_id;

    const { error: updateError } = await supabase
      .from('leads')
      .update({
        current_status_id: bitrixLead.STATUS_ID,
        is_qualified: isQualified,
        bitrix24_entity_type: 'lead'
      })
      .eq('id', localLead.id);

    if (updateError) {
      app.log.error({ error: updateError, leadId }, 'Failed to update lead from webhook');
      return;
    }

    // Log status change if status actually changed
    if (previousStatusId !== bitrixLead.STATUS_ID) {
      await supabase.from('bitrix24_status_history').insert({
        user_account_id: userAccountId,
        lead_id: localLead.id,
        bitrix24_lead_id: parseInt(leadId, 10),
        entity_type: 'lead',
        from_status_id: previousStatusId,
        to_status_id: bitrixLead.STATUS_ID,
        webhook_data: bitrixLead
      });
    }

    app.log.info({
      userAccountId,
      leadId,
      statusId: bitrixLead.STATUS_ID,
      isQualified,
      event
    }, 'Lead updated from Bitrix24 webhook');

    try {
      await syncDirectionCrmCapiForBitrixEntity({
        app,
        userAccountId,
        localLead,
        entity: bitrixLead,
        entityType: 'lead'
      });
    } catch (crmCapiError: any) {
      app.log.error({
        error: crmCapiError.message,
        leadId: localLead.id,
        bitrixLeadId: leadId
      }, 'CRM CAPI sync failed in handleLeadEvent');
    }
  } else {
    app.log.info({ userAccountId, leadId }, 'No local lead found for Bitrix24 lead (bitrix24_lead_id not linked)');
  }
}

/**
 * Handle deal add/update event
 */
async function handleDealEvent(
  app: FastifyInstance,
  userAccountId: string,
  dealId: string,
  domain: string,
  accessToken: string,
  event: string
): Promise<void> {
  // Fetch full deal data from Bitrix24
  const bitrixDeal = await getDeal(domain, accessToken, dealId);

  if (!bitrixDeal) {
    app.log.warn({ userAccountId, dealId, domain }, 'Deal not found in Bitrix24');
    return;
  }

  app.log.info({
    dealId,
    stageId: bitrixDeal.STAGE_ID,
    categoryId: bitrixDeal.CATEGORY_ID,
    title: bitrixDeal.TITLE
  }, 'Bitrix24 deal fetched successfully');

  // Get qualification config
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('bitrix24_qualification_fields')
    .eq('id', userAccountId)
    .single();

  const qualificationFields = userAccount?.bitrix24_qualification_fields || [];
  const isQualified = checkQualification(bitrixDeal, qualificationFields);

  // Find local lead by bitrix24_deal_id
  const parsedDealId = parseInt(dealId, 10);
  const { data: localLead, error: leadLookupError } = await supabase
    .from('leads')
    .select('id, current_status_id, current_pipeline_id, is_qualified, direction_id, chat_id, phone')
    .eq('user_account_id', userAccountId)
    .eq('bitrix24_deal_id', parsedDealId)
    .single();

  app.log.info({
    userAccountId,
    dealId,
    parsedDealId,
    found: !!localLead,
    leadId: localLead?.id || null,
    lookupError: leadLookupError?.code || null,
    stageId: bitrixDeal.STAGE_ID,
    categoryId: bitrixDeal.CATEGORY_ID
  }, 'Bitrix24 deal webhook: lead lookup result');

  if (localLead) {
    // Update existing lead
    const previousStatusId = localLead.current_status_id;
    const previousCategoryId = localLead.current_pipeline_id;

    const { error: updateError } = await supabase
      .from('leads')
      .update({
        current_status_id: bitrixDeal.STAGE_ID,
        current_pipeline_id: parseInt(bitrixDeal.CATEGORY_ID || '0', 10),
        is_qualified: isQualified,
        bitrix24_entity_type: 'deal'
      })
      .eq('id', localLead.id);

    if (updateError) {
      app.log.error({ error: updateError, dealId }, 'Failed to update lead from deal webhook');
      return;
    }

    // Log status change if status actually changed
    if (previousStatusId !== bitrixDeal.STAGE_ID || previousCategoryId !== parseInt(bitrixDeal.CATEGORY_ID || '0', 10)) {
      await supabase.from('bitrix24_status_history').insert({
        user_account_id: userAccountId,
        lead_id: localLead.id,
        bitrix24_deal_id: parseInt(dealId, 10),
        entity_type: 'deal',
        from_status_id: previousStatusId,
        to_status_id: bitrixDeal.STAGE_ID,
        from_category_id: previousCategoryId,
        to_category_id: parseInt(bitrixDeal.CATEGORY_ID || '0', 10),
        webhook_data: bitrixDeal
      });
    }

    // Check if deal is closed/won and create sale record
    if (bitrixDeal.STAGE_SEMANTIC_ID === 'S' && bitrixDeal.CLOSED === 'Y') {
      await createSaleFromDeal(app, userAccountId, localLead.id, bitrixDeal, dealId);
    }

    app.log.info({
      userAccountId,
      dealId,
      stageId: bitrixDeal.STAGE_ID,
      categoryId: bitrixDeal.CATEGORY_ID,
      isQualified,
      event
    }, 'Lead updated from Bitrix24 deal webhook');

    try {
      await syncDirectionCrmCapiForBitrixEntity({
        app,
        userAccountId,
        localLead,
        entity: bitrixDeal,
        entityType: 'deal'
      });
    } catch (crmCapiError: any) {
      app.log.error({
        error: crmCapiError.message,
        leadId: localLead.id,
        bitrixDealId: dealId
      }, 'CRM CAPI sync failed in handleDealEvent');
    }
  } else {
    app.log.info({ userAccountId, dealId }, 'No local lead found for Bitrix24 deal (bitrix24_deal_id not linked)');
  }
}

/**
 * Handle lead delete event
 */
async function handleLeadDelete(
  app: FastifyInstance,
  userAccountId: string,
  leadId: string
): Promise<void> {
  // Just log the deletion, don't delete local lead
  app.log.info({ userAccountId, leadId }, 'Bitrix24 lead deleted');

  // Optionally mark local lead as deleted
  await supabase
    .from('leads')
    .update({ bitrix24_lead_id: null })
    .eq('user_account_id', userAccountId)
    .eq('bitrix24_lead_id', parseInt(leadId, 10));
}

/**
 * Handle deal delete event
 */
async function handleDealDelete(
  app: FastifyInstance,
  userAccountId: string,
  dealId: string
): Promise<void> {
  app.log.info({ userAccountId, dealId }, 'Bitrix24 deal deleted');

  await supabase
    .from('leads')
    .update({ bitrix24_deal_id: null })
    .eq('user_account_id', userAccountId)
    .eq('bitrix24_deal_id', parseInt(dealId, 10));
}

/**
 * Handle contact add/update event
 */
async function handleContactEvent(
  app: FastifyInstance,
  userAccountId: string,
  contactId: string,
  domain: string,
  accessToken: string,
  event: string
): Promise<void> {
  // For now, just log contact events
  // Could be extended to update local lead data based on contact updates
  app.log.debug({ userAccountId, contactId, event }, 'Contact event received');
}

/**
 * Create sale record from closed deal
 */
async function createSaleFromDeal(
  app: FastifyInstance,
  userAccountId: string,
  leadId: string,
  deal: any,
  dealId: string
): Promise<void> {
  // Check if sale already exists for this deal
  const { data: existingSale } = await supabase
    .from('sales')
    .select('id')
    .eq('bitrix24_deal_id', parseInt(dealId, 10))
    .single();

  if (existingSale) {
    app.log.debug({ dealId }, 'Sale already exists for deal');
    return;
  }

  // Create sale record
  const { error: saleError } = await supabase
    .from('sales')
    .insert({
      user_account_id: userAccountId,
      lead_id: leadId,
      amount: parseFloat(deal.OPPORTUNITY || '0'),
      currency: deal.CURRENCY_ID || 'RUB',
      bitrix24_deal_id: parseInt(dealId, 10),
      bitrix24_category_id: parseInt(deal.CATEGORY_ID || '0', 10),
      bitrix24_stage_id: deal.STAGE_ID,
      sale_date: deal.CLOSEDATE || new Date().toISOString()
    });

  if (saleError) {
    app.log.error({ error: saleError, dealId }, 'Failed to create sale from deal');
    return;
  }

  app.log.info({
    userAccountId,
    leadId,
    dealId,
    amount: deal.OPPORTUNITY
  }, 'Sale created from Bitrix24 deal');
}

async function syncDirectionCrmCapiForBitrixEntity(params: {
  app: FastifyInstance;
  userAccountId: string;
  localLead: any;
  entity: any;
  entityType: 'lead' | 'deal';
}): Promise<void> {
  const { app, userAccountId, localLead, entity, entityType } = params;

  if (!localLead?.direction_id) {
    app.log.warn({
      userAccountId,
      leadId: localLead?.id || null,
      entityType
    }, 'CRM CAPI: skip Bitrix sync (lead has no direction_id)');
    return;
  }

  const capiSettings = await getDirectionCapiSettings(localLead.direction_id);
  if (!capiSettings) {
    app.log.warn({
      userAccountId,
      leadId: localLead.id,
      directionId: localLead.direction_id,
      entityType
    }, 'CRM CAPI: skip Bitrix sync (direction settings not found)');
    return;
  }

  if (!capiSettings.capiEnabled || capiSettings.capiSource !== 'crm' || capiSettings.capiCrmType !== 'bitrix24') {
    app.log.debug({
      userAccountId,
      leadId: localLead.id,
      directionId: localLead.direction_id,
      settings: summarizeDirectionCapiSettings(capiSettings)
    }, 'CRM CAPI: skip Bitrix sync (source/type/enable mismatch)');
    return;
  }

  // Filter CAPI field configs to only match configs for the current entity type.
  // E.g. when processing a deal webhook, skip configs meant for leads and vice versa.
  const filterByEntityType = (fields: typeof capiSettings.interestFields) =>
    fields.filter((config) => {
      const configEntityType = String(config.entity_type || '').trim().toLowerCase();
      // If config has no entity_type, allow it (backward compat)
      if (!configEntityType) return true;
      return configEntityType === entityType;
    });

  const filteredSettings = {
    ...capiSettings,
    interestFields: filterByEntityType(capiSettings.interestFields),
    qualifiedFields: filterByEntityType(capiSettings.qualifiedFields),
    scheduledFields: filterByEntityType(capiSettings.scheduledFields),
  };

  const evaluation = evaluateBitrixCapiLevelsWithDiagnostics(entity, filteredSettings);
  const matches = evaluation.levels;
  const hasAnyMatch = matches.interest || matches.qualified || matches.scheduled;

  const evaluationLogPayload = {
    userAccountId,
    leadId: localLead.id,
    directionId: localLead.direction_id,
    entityType,
    bitrixEntityId: entity?.ID || null,
    bitrixEntityStatus: entity?.STATUS_ID || entity?.STAGE_ID || null,
    matches,
    diagnostics: evaluation.diagnostics,
    settings: summarizeDirectionCapiSettings(capiSettings)
  };

  if (hasAnyMatch) {
    app.log.info(evaluationLogPayload, 'CRM CAPI: Bitrix level evaluation matched');
  } else {
    app.log.debug(evaluationLogPayload, 'CRM CAPI: Bitrix level evaluation without matches');
  }

  const { error: updateError } = await supabase
    .from('leads')
    .update({
      is_qualified: matches.qualified,
      is_scheduled: matches.scheduled,
      updated_at: new Date().toISOString()
    })
    .eq('id', localLead.id);

  if (updateError) {
    app.log.error({
      error: updateError.message,
      leadId: localLead.id,
      directionId: localLead.direction_id
    }, 'CRM CAPI: failed updating leads flags from Bitrix fields');
  }

  const contactPhone = normalizeContactPhoneForCapi(localLead.chat_id || localLead.phone);
  if (!contactPhone) {
    app.log.warn({
      leadId: localLead.id,
      directionId: localLead.direction_id
    }, 'CRM CAPI: no contact phone for Bitrix event');
    return;
  }

  await sendCrmCapiLevels({
    userAccountId,
    directionId: localLead.direction_id,
    contactPhone,
    crmType: 'bitrix24',
    levels: matches
  }, app);
}

/**
 * Log webhook to history table
 */
async function logWebhookToHistory(
  userAccountId: string,
  entityId: string,
  event: string,
  payload: Bitrix24WebhookPayload
): Promise<void> {
  // Determine entity type
  const isLead = event.includes('LEAD');
  const isDeal = event.includes('DEAL');

  await supabase.from('bitrix24_sync_log').insert({
    user_account_id: userAccountId,
    bitrix24_lead_id: isLead ? parseInt(entityId, 10) : null,
    bitrix24_deal_id: isDeal ? parseInt(entityId, 10) : null,
    sync_type: 'status_update',
    sync_status: 'success',
    request_json: payload,
    response_json: { event, processed: true }
  });
}

/**
 * Check if entity is qualified based on configured fields
 */
function checkQualification(entity: any, qualificationFields: any[]): boolean {
  if (!qualificationFields || qualificationFields.length === 0) {
    return false;
  }

  for (const fieldConfig of qualificationFields) {
    const fieldName = fieldConfig.field_name;
    const fieldValue = entity[fieldName];

    if (fieldValue === undefined || fieldValue === null) {
      continue;
    }

    // Boolean field
    if (fieldConfig.field_type === 'boolean') {
      if (fieldValue === '1' || fieldValue === 'Y' || fieldValue === true) {
        return true;
      }
    }

    // Enumeration field
    if (fieldConfig.field_type === 'enumeration' && fieldConfig.enum_id) {
      const values = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
      if (values.includes(fieldConfig.enum_id) || values.includes(parseInt(fieldConfig.enum_id, 10))) {
        return true;
      }
    }

    // String field with specific value
    if (fieldConfig.field_type === 'string' && fieldConfig.enum_value) {
      if (String(fieldValue).toLowerCase() === String(fieldConfig.enum_value).toLowerCase()) {
        return true;
      }
    }
  }

  return false;
}
