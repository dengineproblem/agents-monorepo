import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { supabase } from '../lib/supabase.js';
import { resolveCreativeAndDirection } from '../lib/creativeResolver.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import {
  WabaWebhookPayload,
  WabaValue,
  WabaMessage,
  verifyWabaSignature,
  normalizeWabaPhone,
  extractMessageText,
  hasAdReferral
} from '../lib/wabaHelpers.js';

// ============================================
// Configuration
// ============================================

const WABA_VERIFY_TOKEN = process.env.WABA_VERIFY_TOKEN || 'waba_verify_token';
const WABA_APP_SECRET = process.env.WABA_APP_SECRET || '';
const WABA_ENABLED = process.env.WABA_WEBHOOK_ENABLED === 'true';
const CAPI_INTEREST_THRESHOLD = parseInt(process.env.CAPI_INTEREST_THRESHOLD || '3', 10);
const CHATBOT_SERVICE_URL = process.env.CHATBOT_SERVICE_URL || 'http://chatbot-service:8083';

// ============================================
// Main Export
// ============================================

export default async function wabaWebhooks(app: FastifyInstance) {

  // ============================================
  // GET: Webhook Verification (hub.verify_token)
  // ============================================
  app.get('/webhooks/waba', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as {
      'hub.mode'?: string;
      'hub.verify_token'?: string;
      'hub.challenge'?: string;
    };

    app.log.info({
      mode: query['hub.mode'],
      hasToken: !!query['hub.verify_token'],
      hasChallenge: !!query['hub.challenge']
    }, 'WABA webhook verification request');

    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === WABA_VERIFY_TOKEN) {
      app.log.info({ challenge: query['hub.challenge'] }, 'WABA webhook verified successfully');
      return reply.send(query['hub.challenge']);
    }

    app.log.warn({ query }, 'WABA webhook verification failed');
    return reply.status(403).send('Forbidden');
  });

  // ============================================
  // POST: Message Processing
  // ============================================
  app.post('/webhooks/waba', {
    config: {
      // Get raw body for signature verification
      rawBody: true
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Always return 200 to prevent Meta retries
    const respondSuccess = () => reply.send({ success: true });

    if (!WABA_ENABLED) {
      app.log.debug('WABA webhook disabled');
      return respondSuccess();
    }

    try {
      // Signature verification (skip in dev if no secret configured)
      if (WABA_APP_SECRET) {
        const signature = request.headers['x-hub-signature-256'] as string | undefined;
        const rawBody = (request as any).rawBody as Buffer | undefined;

        if (!rawBody) {
          app.log.warn('WABA webhook: rawBody not available, skipping signature check');
          // Continue without signature verification if rawBody is not available
        } else if (!verifyWabaSignature(rawBody, signature, WABA_APP_SECRET)) {
          app.log.warn({
            hasSignature: !!signature,
            rawBodyLength: rawBody?.length
          }, 'WABA webhook signature verification failed');
          return reply.status(403).send('Invalid signature');
        }
      }

      const body = request.body as WabaWebhookPayload;

      // Validate payload structure
      if (body.object !== 'whatsapp_business_account') {
        app.log.debug({ object: body.object }, 'Ignoring non-WABA webhook');
        return respondSuccess();
      }

      app.log.info({
        entriesCount: body.entry?.length || 0,
        object: body.object
      }, 'WABA webhook received');

      // Process entries
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === 'messages') {
            await handleWabaMessages(change.value, app);
          }
          // Ignore statuses, contacts, etc.
        }
      }

      return respondSuccess();

    } catch (error: any) {
      app.log.error({
        error: error.message,
        stack: error.stack
      }, 'WABA webhook error');

      await logErrorToAdmin({
        error_type: 'waba',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'waba_webhook',
        endpoint: '/webhooks/waba',
        severity: 'critical'
      }).catch(() => {});

      // Always return 200 to prevent Meta retries
      return respondSuccess();
    }
  });
}

// ============================================
// Message Handler
// ============================================

async function handleWabaMessages(value: WabaValue, app: FastifyInstance) {
  const { metadata, messages, contacts } = value;

  if (!messages || messages.length === 0) {
    return;
  }

  const phoneNumberId = metadata.phone_number_id;
  const displayPhoneNumber = normalizeWabaPhone(metadata.display_phone_number);

  // Get contact name from contacts array
  const contactName = contacts?.[0]?.profile?.name;

  for (const message of messages) {
    // Only process messages with ad referral
    if (!hasAdReferral(message)) {
      app.log.debug({
        from: message.from,
        type: message.type,
        hasReferral: !!message.referral
      }, 'WABA: No ad referral, skipping');
      continue;
    }

    const referral = message.referral!;

    app.log.info({
      from: message.from,
      sourceId: referral.source_id,
      ctwaClid: referral.ctwa_clid,
      sourceUrl: referral.source_url,
      phoneNumberId,
      displayPhoneNumber
    }, 'WABA: Processing ad lead');

    await processWabaAdLead({
      phoneNumberId,
      displayPhoneNumber,
      clientPhone: normalizeWabaPhone(message.from),
      contactName,
      sourceId: referral.source_id,
      sourceUrl: referral.source_url,
      ctwaClid: referral.ctwa_clid || null,
      messageText: extractMessageText(message),
      messageType: message.type,
      timestamp: new Date(parseInt(message.timestamp) * 1000),
      rawMessage: message
    }, app);
  }
}

// ============================================
// Ad Lead Processor
// ============================================

interface WabaLeadParams {
  phoneNumberId: string;
  displayPhoneNumber: string;
  clientPhone: string;
  contactName?: string;
  sourceId: string;
  sourceUrl?: string;
  ctwaClid: string | null;
  messageText: string;
  messageType: string;
  timestamp: Date;
  rawMessage: any;
}

async function processWabaAdLead(params: WabaLeadParams, app: FastifyInstance) {
  const {
    phoneNumberId,
    displayPhoneNumber,
    clientPhone,
    contactName,
    sourceId,
    sourceUrl,
    ctwaClid,
    messageText,
    timestamp
  } = params;

  // 1. Find WhatsApp number by waba_phone_id or phone_number (fallback)
  let whatsappNumber = await findWhatsAppNumber(phoneNumberId, displayPhoneNumber, app);

  if (!whatsappNumber) {
    app.log.warn({
      phoneNumberId,
      displayPhoneNumber
    }, 'WABA: WhatsApp number not found in database');
    return;
  }

  const userAccountId = whatsappNumber.user_account_id;
  const accountId = whatsappNumber.account_id;
  const instanceName = whatsappNumber.instance_name || `waba_${phoneNumberId}`;

  // 2. Resolve creative and direction
  const { creativeId, directionId, whatsappPhoneNumberId } =
    await resolveCreativeAndDirection(
      sourceId,
      sourceUrl || null,
      userAccountId,
      accountId || null,
      app as any
    );

  const finalWhatsappPhoneNumberId = whatsappPhoneNumberId || whatsappNumber.id;

  app.log.info({
    clientPhone,
    sourceId,
    creativeId,
    directionId,
    whatsappPhoneNumberId: finalWhatsappPhoneNumberId,
    ctwaClid
  }, 'WABA: Resolved lead data');

  // 3. Check existing lead
  const { data: existingLead } = await supabase
    .from('leads')
    .select('id, ctwa_clid')
    .eq('chat_id', clientPhone)
    .maybeSingle();

  if (existingLead) {
    // Update existing lead
    const { error } = await supabase
      .from('leads')
      .update({
        source_id: sourceId,
        creative_url: sourceUrl,
        creative_id: creativeId,
        direction_id: directionId,
        whatsapp_phone_number_id: finalWhatsappPhoneNumberId,
        user_account_id: userAccountId,
        account_id: accountId || null,
        ctwa_clid: ctwaClid || existingLead.ctwa_clid,
        updated_at: timestamp.toISOString()
      })
      .eq('id', existingLead.id);

    if (error) {
      app.log.error({ error, leadId: existingLead.id }, 'WABA: Failed to update lead');
    } else {
      app.log.info({ leadId: existingLead.id }, 'WABA: Updated existing lead');
    }
  } else {
    // Create new lead
    const { data: newLead, error } = await supabase
      .from('leads')
      .insert({
        user_account_id: userAccountId,
        account_id: accountId || null,
        business_id: displayPhoneNumber,
        chat_id: clientPhone,
        source_id: sourceId,
        conversion_source: 'WABA',  // <-- Different from Evolution_API
        creative_url: sourceUrl,
        creative_id: creativeId,
        direction_id: directionId,
        whatsapp_phone_number_id: finalWhatsappPhoneNumberId,
        ctwa_clid: ctwaClid,
        funnel_stage: 'new_lead',
        status: 'active',
        created_at: timestamp.toISOString(),
        updated_at: timestamp.toISOString()
      })
      .select('id')
      .single();

    if (error) {
      app.log.error({ error, clientPhone }, 'WABA: Failed to create lead');
    } else {
      app.log.info({ leadId: newLead?.id }, 'WABA: Created new lead from ad');
    }
  }

  // 4. Reset CAPI counter for new ad click
  await supabase
    .from('dialog_analysis')
    .update({ capi_msg_count: 0, capi_interest_sent: false })
    .eq('instance_name', instanceName)
    .eq('contact_phone', clientPhone);

  // 5. Upsert dialog_analysis for CAPI tracking
  await upsertDialogAnalysis({
    userAccountId,
    accountId,
    instanceName,
    contactPhone: clientPhone,
    contactName,
    messageText,
    ctwaClid,
    directionId,
    timestamp
  }, app);
}

// ============================================
// Helper: Find WhatsApp Number
// ============================================

interface WhatsAppNumberRecord {
  id: string;
  user_account_id: string;
  account_id: string | null;
  phone_number: string;
  instance_name: string | null;
  waba_phone_id: string | null;
}

async function findWhatsAppNumber(
  phoneNumberId: string,
  displayPhoneNumber: string,
  app: FastifyInstance
): Promise<WhatsAppNumberRecord | null> {
  // 1. Try by waba_phone_id first (exact match)
  const { data: byWabaId } = await supabase
    .from('whatsapp_phone_numbers')
    .select('id, user_account_id, account_id, phone_number, instance_name, waba_phone_id')
    .eq('waba_phone_id', phoneNumberId)
    .eq('is_active', true)
    .maybeSingle();

  if (byWabaId) {
    app.log.debug({ phoneNumberId }, 'WABA: Found by waba_phone_id');
    return byWabaId;
  }

  // 2. Fallback: by phone_number
  const { data: byPhone } = await supabase
    .from('whatsapp_phone_numbers')
    .select('id, user_account_id, account_id, phone_number, instance_name, waba_phone_id')
    .eq('phone_number', displayPhoneNumber)
    .eq('is_active', true)
    .maybeSingle();

  if (byPhone) {
    app.log.debug({ displayPhoneNumber }, 'WABA: Found by phone_number (fallback)');
    return byPhone;
  }

  return null;
}

// ============================================
// Helper: Upsert Dialog Analysis
// ============================================

async function upsertDialogAnalysis(params: {
  userAccountId: string;
  accountId?: string | null;
  instanceName: string;
  contactPhone: string;
  contactName?: string;
  messageText: string;
  ctwaClid?: string | null;
  directionId?: string | null;
  timestamp: Date;
}, app: FastifyInstance) {
  const {
    userAccountId, accountId, instanceName, contactPhone,
    contactName, messageText, ctwaClid, directionId, timestamp
  } = params;

  // Check existing record
  const { data: existing } = await supabase
    .from('dialog_analysis')
    .select('id, ctwa_clid, contact_name, capi_msg_count, capi_interest_sent, direction_id, incoming_count')
    .eq('contact_phone', contactPhone)
    .eq('instance_name', instanceName)
    .maybeSingle();

  // Check if this is an ad lead
  const { data: lead } = await supabase
    .from('leads')
    .select('source_id')
    .eq('chat_id', contactPhone)
    .eq('user_account_id', userAccountId)
    .not('source_id', 'is', null)
    .maybeSingle();

  const isFromAd = !!lead?.source_id;

  if (existing) {
    // Update existing record
    const finalCtwaClid = ctwaClid || existing.ctwa_clid;
    const finalDirectionId = directionId || existing.direction_id;
    const newCapiMsgCount = isFromAd ? (existing.capi_msg_count || 0) + 1 : (existing.capi_msg_count || 0);
    const newIncomingCount = (existing.incoming_count || 0) + 1;

    await supabase
      .from('dialog_analysis')
      .update({
        last_message: timestamp.toISOString(),
        ctwa_clid: finalCtwaClid,
        direction_id: finalDirectionId,
        capi_msg_count: newCapiMsgCount,
        incoming_count: newIncomingCount,
        analyzed_at: timestamp.toISOString(),
        ...((!existing.contact_name && contactName) ? { contact_name: contactName } : {})
      })
      .eq('id', existing.id);

    // Check CAPI threshold
    if (
      isFromAd &&
      newCapiMsgCount >= CAPI_INTEREST_THRESHOLD &&
      !existing.capi_interest_sent &&
      finalDirectionId
    ) {
      app.log.info({
        contactPhone,
        capiMsgCount: newCapiMsgCount,
        threshold: CAPI_INTEREST_THRESHOLD,
        directionId: finalDirectionId
      }, 'WABA: CAPI threshold reached, sending ViewContent');

      await sendCapiInterestEvent(instanceName, contactPhone, app);
    }

  } else {
    // Create new record
    const initialCapiMsgCount = isFromAd ? 1 : 0;

    await supabase
      .from('dialog_analysis')
      .insert({
        user_account_id: userAccountId,
        account_id: accountId || null,
        instance_name: instanceName,
        contact_phone: contactPhone,
        contact_name: contactName || null,
        first_message: timestamp.toISOString(),
        last_message: timestamp.toISOString(),
        ctwa_clid: ctwaClid || null,
        direction_id: directionId || null,
        capi_msg_count: initialCapiMsgCount,
        incoming_count: 1,
        funnel_stage: 'new_lead',
        analyzed_at: timestamp.toISOString()
      });
  }
}

// ============================================
// Helper: Send CAPI Interest Event
// ============================================

async function sendCapiInterestEvent(
  instanceName: string,
  contactPhone: string,
  app: FastifyInstance
): Promise<void> {
  const correlationId = randomUUID();

  try {
    const response = await fetch(`${CHATBOT_SERVICE_URL}/capi/interest-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId
      },
      body: JSON.stringify({ instanceName, contactPhone })
    });

    if (response.ok) {
      await supabase
        .from('dialog_analysis')
        .update({ capi_interest_sent: true })
        .eq('instance_name', instanceName)
        .eq('contact_phone', contactPhone);

      app.log.info({ correlationId, instanceName, contactPhone }, 'WABA: CAPI Interest event sent');
    } else {
      app.log.error({
        correlationId,
        status: response.status,
        instanceName,
        contactPhone
      }, 'WABA: CAPI Interest event failed');
    }
  } catch (error: any) {
    app.log.error({
      correlationId,
      error: error.message,
      instanceName,
      contactPhone
    }, 'WABA: CAPI Interest event error');
  }
}
