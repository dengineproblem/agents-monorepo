import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { supabase } from '../lib/supabase.js';
import { resolveCreativeAndDirection } from '../lib/creativeResolver.js';
import { resolveChannelFromDirection } from '../lib/capiSettingsResolver.js';
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
const CHATBOT_REQUEST_TIMEOUT_MS = 10000;
const CHATBOT_RETRY_DELAYS_MS = [1000, 2000, 3000];

// Forwarding to ad-analytics
const AD_ANALYTICS_WEBHOOK_URL = process.env.AD_ANALYTICS_WEBHOOK_URL || '';

const PROCESSED_WABA_MESSAGES = new Map<string, number>();
const WABA_MESSAGE_ID_TTL_MS = 10 * 60 * 1000;

type BotMessageType = 'text' | 'audio' | 'image' | 'document' | 'file';

function normalizeCtwaClid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeWabaMessageType(type: WabaMessage['type']): BotMessageType {
  switch (type) {
    case 'audio':
      return 'audio';
    case 'image':
      return 'image';
    case 'document':
      return 'document';
    case 'text':
    case 'button':
    case 'interactive':
      return 'text';
    default:
      return 'file';
  }
}

function getMessagePreviewForLogs(message: WabaMessage): string {
  const text = normalizeText(extractMessageText(message));
  if (text) {
    return text.slice(0, 80);
  }

  switch (message.type) {
    case 'audio':
      return '[audio]';
    case 'image':
      return '[image]';
    case 'document':
      return '[document]';
    case 'video':
      return '[video]';
    case 'sticker':
      return '[sticker]';
    default:
      return `[${message.type}]`;
  }
}

function markAndCheckDuplicateMessageId(messageId: string): boolean {
  const now = Date.now();

  for (const [id, ts] of PROCESSED_WABA_MESSAGES.entries()) {
    if (now - ts > WABA_MESSAGE_ID_TTL_MS) {
      PROCESSED_WABA_MESSAGES.delete(id);
    }
  }

  if (PROCESSED_WABA_MESSAGES.has(messageId)) {
    return true;
  }

  PROCESSED_WABA_MESSAGES.set(messageId, now);
  return false;
}

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
      const body = request.body as WabaWebhookPayload;

      // Signature verification: try per-number secret from DB, fallback to global env
      const signature = request.headers['x-hub-signature-256'] as string | undefined;
      const rawBody = (request as any).rawBody as Buffer | undefined;

      if (rawBody && signature) {
        // Try to extract phone_number_id from payload for per-number secret lookup
        let appSecret = WABA_APP_SECRET;
        const firstPhoneNumberId = body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

        if (firstPhoneNumberId) {
          const { data: numberRecord } = await supabase
            .from('whatsapp_phone_numbers')
            .select('waba_app_secret')
            .eq('waba_phone_id', firstPhoneNumberId)
            .eq('connection_type', 'waba')
            .eq('is_active', true)
            .maybeSingle();

          if (numberRecord?.waba_app_secret) {
            appSecret = numberRecord.waba_app_secret;
          }
        }

        if (appSecret) {
          if (!verifyWabaSignature(rawBody, signature, appSecret)) {
            app.log.warn({
              hasSignature: true,
              rawBodyLength: rawBody.length,
              phoneNumberId: firstPhoneNumberId || 'unknown',
              secretSource: appSecret !== WABA_APP_SECRET ? 'db' : 'env'
            }, 'WABA webhook signature verification failed');
            return reply.status(403).send('Invalid signature');
          }
        }
      }

      // Forward to ad-analytics (fire and forget)
      if (AD_ANALYTICS_WEBHOOK_URL) {
        forwardToAdAnalytics(body, request.headers, app).catch(() => {});
      }

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
    if (!message.id) {
      app.log.warn({
        from: message.from,
        type: message.type
      }, 'WABA: Message without id, skipping');
      continue;
    }

    if (markAndCheckDuplicateMessageId(message.id)) {
      app.log.debug({
        messageId: message.id,
        from: message.from,
        type: message.type
      }, 'WABA: Duplicate webhook message skipped');
      continue;
    }

    const hasReferral = hasAdReferral(message);
    const clientPhone = normalizeWabaPhone(message.from);
    const messageText = normalizeText(extractMessageText(message));
    const messageType = normalizeWabaMessageType(message.type);
    const timestampRaw = parseInt(message.timestamp, 10);
    const timestamp = Number.isFinite(timestampRaw) && timestampRaw > 0
      ? new Date(timestampRaw * 1000)
      : new Date();

    app.log.info({
      messageId: message.id,
      from: message.from,
      clientPhone,
      type: message.type,
      normalizedType: messageType,
      hasReferral,
      textLen: messageText.length,
      textPreview: getMessagePreviewForLogs(message),
      phoneNumberId,
      displayPhoneNumber
    }, 'WABA: Incoming message received');

    if (hasReferral) {
      const referral = message.referral!;
      const normalizedCtwaClid = normalizeCtwaClid(referral.ctwa_clid);
      const normalizedSourceType = (referral.source_type || '').toLowerCase();
      const skipBotForAdLead = !messageText && messageType !== 'audio';

      if (normalizedSourceType && normalizedSourceType !== 'ad' && normalizedSourceType !== 'advertisement') {
        app.log.debug({
          messageId: message.id,
          from: message.from,
          sourceId: referral.source_id,
          sourceType: referral.source_type
        }, 'WABA: Referral source_type is not ad, skipping');
        continue;
      }

      if (!normalizedCtwaClid) {
        app.log.debug({
          messageId: message.id,
          from: message.from,
          sourceId: referral.source_id,
          referralKeys: Object.keys(referral)
        }, 'WABA: Ad referral without ctwa_clid');
      }

      if (skipBotForAdLead) {
        app.log.debug({
          messageId: message.id,
          sourceId: referral.source_id,
          clientPhone,
          type: message.type
        }, 'WABA: Ad lead with empty non-audio content, bot call will be skipped');
      }

      await processWabaAdLead({
        phoneNumberId,
        displayPhoneNumber,
        clientPhone,
        contactName,
        sourceId: referral.source_id,
        sourceUrl: referral.source_url,
        ctwaClid: normalizedCtwaClid,
        messageText: skipBotForAdLead ? getMessagePreviewForLogs(message) : messageText,
        messageType,
        timestamp,
        rawMessage: message,
        skipBotCall: skipBotForAdLead,
        skipBotReason: skipBotForAdLead ? 'empty_non_audio' : undefined
      }, app);
      continue;
    }

    if (!messageText && messageType !== 'audio') {
      app.log.debug({
        messageId: message.id,
        from: message.from,
        clientPhone,
        type: message.type,
        normalizedType: messageType
      }, 'WABA: Empty non-audio message skipped for bot');
      await processWabaRegularInbound({
        phoneNumberId,
        displayPhoneNumber,
        clientPhone,
        contactName,
        messageText: getMessagePreviewForLogs(message),
        messageType,
        timestamp
      }, app, {
        shouldCallBot: false,
        reason: 'empty_non_audio'
      });
      continue;
    }

    await processWabaRegularInbound({
      phoneNumberId,
      displayPhoneNumber,
      clientPhone,
      contactName,
      messageText,
      messageType,
      timestamp
    }, app);
  }
}

// ============================================
// Ad Lead Processor
// ============================================

interface WabaRegularInboundParams {
  phoneNumberId: string;
  displayPhoneNumber: string;
  clientPhone: string;
  contactName?: string;
  messageText: string;
  messageType: BotMessageType;
  timestamp: Date;
}

interface WabaLeadParams {
  phoneNumberId: string;
  displayPhoneNumber: string;
  clientPhone: string;
  contactName?: string;
  sourceId: string;
  sourceUrl?: string;
  ctwaClid: string | null;
  messageText: string;
  messageType: BotMessageType;
  timestamp: Date;
  rawMessage: any;
  skipBotCall?: boolean;
  skipBotReason?: string;
}

async function processWabaRegularInbound(
  params: WabaRegularInboundParams,
  app: FastifyInstance,
  options?: { shouldCallBot?: boolean; reason?: string }
) {
  const {
    phoneNumberId,
    displayPhoneNumber,
    clientPhone,
    contactName,
    messageText,
    messageType,
    timestamp
  } = params;

  const shouldCallBot = options?.shouldCallBot !== false;

  const whatsappNumber = await findWhatsAppNumber(phoneNumberId, app);
  if (!whatsappNumber) {
    app.log.warn({
      phoneNumberId,
      displayPhoneNumber,
      clientPhone
    }, 'WABA: Regular inbound - WhatsApp number not found');
    return;
  }

  const instanceName = resolveInstanceName(whatsappNumber, phoneNumberId);

  await ensureWabaLogicalInstance(whatsappNumber, instanceName, app);

  await upsertDialogAnalysis({
    userAccountId: whatsappNumber.user_account_id,
    accountId: whatsappNumber.account_id,
    instanceName,
    contactPhone: clientPhone,
    contactName,
    messageText,
    timestamp
  }, app);

  if (!shouldCallBot) {
    app.log.debug({
      instanceName,
      clientPhone,
      messageType,
      reason: options?.reason || 'skip'
    }, 'WABA: Skipping chatbot call for regular inbound');
    return;
  }

  const hasBot = await hasBotForInstance(instanceName, app);
  if (!hasBot) {
    app.log.debug({
      instanceName,
      clientPhone
    }, 'WABA: No bot configured, skipping chatbot call');
    return;
  }

  await tryBotResponse(clientPhone, instanceName, messageText, messageType, app);
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
    messageType,
    timestamp,
    skipBotCall,
    skipBotReason
  } = params;

  // 1. Find WhatsApp number strictly by waba_phone_id
  let whatsappNumber = await findWhatsAppNumber(phoneNumberId, app);

  if (!whatsappNumber) {
    app.log.warn({
      phoneNumberId,
      displayPhoneNumber
    }, 'WABA: WhatsApp number not found in database');
    return;
  }

  const userAccountId = whatsappNumber.user_account_id;
  const accountId = whatsappNumber.account_id;
  const instanceName = resolveInstanceName(whatsappNumber, phoneNumberId);

  await ensureWabaLogicalInstance(whatsappNumber, instanceName, app);

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

  // 4. Reset CAPI counter only for directions with whatsapp source
  const capiSource = await getDirectionCapiSource(directionId || null);
  const shouldTrackWhatsappCapi = capiSource === 'whatsapp';

  if (shouldTrackWhatsappCapi) {
    await supabase
      .from('dialog_analysis')
      .update({ capi_msg_count: 0, capi_interest_sent: false })
      .eq('instance_name', instanceName)
      .eq('contact_phone', clientPhone);
  } else {
    app.log.debug({
      instanceName,
      clientPhone,
      directionId,
      capiSource
    }, 'WABA: Skip CAPI counter reset for CRM-sourced direction');
  }

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

  if (skipBotCall) {
    app.log.debug({
      instanceName,
      clientPhone,
      messageType,
      reason: skipBotReason || 'skip'
    }, 'WABA: Skipping chatbot call for ad lead');
    return;
  }

  const hasBot = await hasBotForInstance(instanceName, app);
  if (!hasBot) {
    app.log.debug({
      instanceName,
      clientPhone
    }, 'WABA: No bot configured for ad lead, skipping chatbot call');
    return;
  }

  await tryBotResponse(clientPhone, instanceName, messageText, messageType, app);
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
  connection_type: string | null;
  connection_status: string | null;
  waba_app_secret: string | null;
}

function resolveInstanceName(record: WhatsAppNumberRecord, phoneNumberId: string): string {
  const normalized = normalizeText(record.instance_name);
  if (normalized) {
    return normalized;
  }
  return `waba_${phoneNumberId}`;
}

async function findWhatsAppNumber(
  phoneNumberId: string,
  app: FastifyInstance
): Promise<WhatsAppNumberRecord | null> {
  // Strict mode: resolve WABA channel only by phone_number_id (waba_phone_id).
  const { data: byWabaId } = await supabase
    .from('whatsapp_phone_numbers')
    .select('id, user_account_id, account_id, phone_number, instance_name, waba_phone_id, connection_type, connection_status, waba_app_secret')
    .eq('waba_phone_id', phoneNumberId)
    .eq('connection_type', 'waba')
    .eq('is_active', true)
    .maybeSingle();

  if (byWabaId) {
    app.log.debug({ phoneNumberId }, 'WABA: Found by waba_phone_id');
    return byWabaId;
  }

  return null;
}

async function ensureWabaLogicalInstance(
  whatsappNumber: WhatsAppNumberRecord,
  instanceName: string,
  app: FastifyInstance
): Promise<void> {
  const nowIso = new Date().toISOString();
  const needsPhoneNumberSync =
    whatsappNumber.instance_name !== instanceName ||
    whatsappNumber.connection_status !== 'connected';

  try {
    if (needsPhoneNumberSync) {
      const { error: updatePhoneError } = await supabase
        .from('whatsapp_phone_numbers')
        .update({
          instance_name: instanceName,
          connection_status: 'connected',
          updated_at: nowIso
        })
        .eq('id', whatsappNumber.id);

      if (updatePhoneError) {
        app.log.warn({
          whatsappNumberId: whatsappNumber.id,
          instanceName,
          error: updatePhoneError.message
        }, 'WABA: Failed to sync instance_name in whatsapp_phone_numbers');
      } else {
        app.log.debug({
          whatsappNumberId: whatsappNumber.id,
          instanceName,
          needsPhoneNumberSync
        }, 'WABA: Synced whatsapp_phone_numbers state');
      }
    }

    const { error: upsertError } = await supabase
      .from('whatsapp_instances')
      .upsert({
        user_account_id: whatsappNumber.user_account_id,
        account_id: whatsappNumber.account_id,
        instance_name: instanceName,
        phone_number: whatsappNumber.phone_number,
        status: 'connected',
        last_connected_at: nowIso,
        updated_at: nowIso
      }, { onConflict: 'instance_name' });

    if (upsertError) {
      app.log.warn({
        instanceName,
        phone: whatsappNumber.phone_number,
        error: upsertError.message
      }, 'WABA: Failed to upsert logical instance');
    }
  } catch (error: any) {
    app.log.warn({
      instanceName,
      error: error.message
    }, 'WABA: Failed to ensure logical instance (non-fatal)');
  }
}

async function getLeadAttribution(contactPhone: string, userAccountId: string): Promise<{
  isFromAd: boolean;
  directionId: string | null;
}> {
  const { data: lead } = await supabase
    .from('leads')
    .select('source_id, direction_id')
    .eq('chat_id', contactPhone)
    .eq('user_account_id', userAccountId)
    .maybeSingle();

  return {
    isFromAd: !!lead?.source_id,
    directionId: lead?.direction_id || null
  };
}

async function getDirectionCapiSource(directionId: string | null | undefined): Promise<'whatsapp' | 'crm' | null> {
  if (!directionId) return null;

  const { data: direction } = await supabase
    .from('account_directions')
    .select('capi_source, capi_enabled, user_account_id, account_id, objective, conversion_channel')
    .eq('id', directionId)
    .maybeSingle();

  if (!direction) return null;

  // Legacy path: check account_directions.capi_source
  if (direction.capi_enabled) {
    const source = direction.capi_source;
    if (source === 'crm' || source === 'whatsapp') {
      return source;
    }
  }

  // New table path: check capi_settings
  if (direction.user_account_id) {
    const channel = resolveChannelFromDirection(direction.objective, direction.conversion_channel);
    if (channel) {
      let query = supabase
        .from('capi_settings')
        .select('capi_source')
        .eq('user_account_id', direction.user_account_id)
        .eq('channel', channel)
        .eq('is_active', true);

      if (direction.account_id) {
        query = query.eq('account_id', direction.account_id);
      } else {
        query = query.is('account_id', null);
      }

      const { data: settings } = await query.maybeSingle();
      if (settings?.capi_source === 'crm' || settings?.capi_source === 'whatsapp') {
        return settings.capi_source;
      }
    }
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

  const leadAttribution = await getLeadAttribution(contactPhone, userAccountId);
  const isFromAd = leadAttribution.isFromAd;
  const effectiveDirectionId = directionId || existing?.direction_id || leadAttribution.directionId || null;
  const capiSource = isFromAd ? await getDirectionCapiSource(effectiveDirectionId) : null;
  const isWhatsappCapiTrackingEnabled = capiSource === 'whatsapp';

  if (existing) {
    // Update existing record
    const finalCtwaClid = ctwaClid || existing.ctwa_clid;
    const finalDirectionId = effectiveDirectionId;
    const newCapiMsgCount = (isFromAd && isWhatsappCapiTrackingEnabled)
      ? (existing.capi_msg_count || 0) + 1
      : (existing.capi_msg_count || 0);
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
      isWhatsappCapiTrackingEnabled &&
      newCapiMsgCount >= CAPI_INTEREST_THRESHOLD &&
      !existing.capi_interest_sent &&
      finalDirectionId
    ) {
      app.log.info({
        contactPhone,
        capiMsgCount: newCapiMsgCount,
        threshold: CAPI_INTEREST_THRESHOLD,
        directionId: finalDirectionId,
        capiSource: capiSource || null
      }, 'WABA: CAPI threshold reached, sending Level 1 event');

      await sendCapiInterestEvent(instanceName, contactPhone, app);
    } else if (isFromAd && !isWhatsappCapiTrackingEnabled) {
      app.log.debug({
        contactPhone,
        directionId: finalDirectionId,
        capiSource: capiSource || null
      }, 'WABA: Skipping WhatsApp CAPI counter because capi_source=crm');
    }

  } else {
    // Create new record
    const initialCapiMsgCount = (isFromAd && isWhatsappCapiTrackingEnabled) ? 1 : 0;

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
        direction_id: effectiveDirectionId,
        capi_msg_count: initialCapiMsgCount,
        incoming_count: 1,
        funnel_stage: 'new_lead',
        analyzed_at: timestamp.toISOString()
      });
  }
}

async function hasBotForInstance(instanceName: string, app: FastifyInstance): Promise<boolean> {
  const { data: instanceData, error: instanceError } = await supabase
    .from('whatsapp_instances')
    .select('user_account_id, ai_bot_id')
    .eq('instance_name', instanceName)
    .maybeSingle();

  let effectiveUserAccountId: string | null = instanceData?.user_account_id || null;

  if (instanceError || !instanceData) {
    app.log.debug({
      instanceName,
      hasInstanceData: !!instanceData,
      error: instanceError?.message || null
    }, 'WABA: hasBotForInstance instance lookup failed, trying whatsapp_phone_numbers fallback');

    const { data: phoneRecord } = await supabase
      .from('whatsapp_phone_numbers')
      .select('user_account_id')
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .maybeSingle();

    effectiveUserAccountId = phoneRecord?.user_account_id || null;
    if (!effectiveUserAccountId) {
      return false;
    }
  }

  if (instanceData?.ai_bot_id) {
    const { data: linkedBot } = await supabase
      .from('ai_bot_configurations')
      .select('id')
      .eq('id', instanceData.ai_bot_id)
      .eq('is_active', true)
      .maybeSingle();

    if (linkedBot) {
      return true;
    }
  }

  if (!effectiveUserAccountId) {
    return false;
  }

  const { data: fallbackBot } = await supabase
    .from('ai_bot_configurations')
    .select('id')
    .eq('user_account_id', effectiveUserAccountId)
    .eq('is_active', true)
    .maybeSingle();

  return !!fallbackBot;
}

async function callChatbotProcessMessage(payload: {
  contactPhone: string;
  instanceName: string;
  messageText: string;
  messageType: BotMessageType;
  correlationId: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHATBOT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${CHATBOT_SERVICE_URL}/process-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': payload.correlationId
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const responseBody = await response.text().catch(() => '');

    return {
      ok: response.ok,
      status: response.status,
      body: responseBody
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function tryBotResponse(
  contactPhone: string,
  instanceName: string,
  messageText: string,
  messageType: BotMessageType,
  app: FastifyInstance
) {
  const correlationId = randomUUID();
  let lastError: Error | null = null;
  const attempts = CHATBOT_RETRY_DELAYS_MS.length + 1;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await callChatbotProcessMessage({
        contactPhone,
        instanceName,
        messageText,
        messageType,
        correlationId
      });

      if (result.ok) {
        app.log.info({
          correlationId,
          contactPhone,
          instanceName,
          messageType,
          attempt,
          responseStatus: result.status,
          responsePreview: result.body.slice(0, 200)
        }, 'WABA: Chatbot call succeeded');
        return;
      }

      lastError = new Error(`HTTP ${result.status}: ${result.body.slice(0, 400)}`);

      const isNonRetryableClientError =
        result.status >= 400 &&
        result.status < 500 &&
        result.status !== 408 &&
        result.status !== 429;

      if (isNonRetryableClientError) {
        app.log.warn({
          correlationId,
          contactPhone,
          instanceName,
          messageType,
          attempt,
          status: result.status,
          responsePreview: result.body.slice(0, 200)
        }, 'WABA: Non-retriable chatbot client error');
        break;
      }
    } catch (error: any) {
      const isAbort = error?.name === 'AbortError';
      const message = isAbort
        ? `Timeout after ${CHATBOT_REQUEST_TIMEOUT_MS}ms`
        : (error?.message || 'Unknown chatbot error');
      lastError = new Error(message);
    }

    if (attempt < attempts) {
      const delayMs = CHATBOT_RETRY_DELAYS_MS[attempt - 1] || 1000;
      app.log.warn({
        correlationId,
        contactPhone,
        instanceName,
        messageType,
        attempt,
        attempts,
        delayMs,
        error: lastError?.message
      }, 'WABA: Chatbot call failed, retrying');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  app.log.error({
    correlationId,
    contactPhone,
    instanceName,
    messageType,
    attempts,
    error: lastError?.message || 'Unknown error'
  }, 'WABA: Chatbot call failed after retries');

  await logErrorToAdmin({
    error_type: 'chatbot_service',
    raw_error: lastError?.message || 'Unknown error',
    action: 'waba_tryBotResponse',
    endpoint: '/process-message',
    request_data: {
      correlationId,
      contactPhone,
      instanceName,
      messageType,
      messageText: messageText.slice(0, 200)
    },
    severity: 'critical'
  }).catch(() => {});
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

    const responseData = await response.json().catch(() => null) as { success?: boolean; eventId?: string; error?: string } | null;
    const isSuccess = response.ok && responseData?.success === true;

    if (isSuccess) {
      await supabase
        .from('dialog_analysis')
        .update({ capi_interest_sent: true })
        .eq('instance_name', instanceName)
        .eq('contact_phone', contactPhone);

      app.log.info({
        correlationId,
        instanceName,
        contactPhone,
        eventId: responseData?.eventId
      }, 'WABA: CAPI Interest event sent');
    } else {
      app.log.warn({
        correlationId,
        status: response.status,
        error: responseData?.error || 'CAPI response success=false or invalid payload',
        instanceName,
        contactPhone
      }, 'WABA: CAPI Interest event not confirmed');
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

// ============================================
// Helper: Forward to Ad Analytics
// ============================================

async function forwardToAdAnalytics(
  body: WabaWebhookPayload,
  headers: Record<string, unknown>,
  app: FastifyInstance
): Promise<void> {
  if (!AD_ANALYTICS_WEBHOOK_URL) return;

  try {
    const response = await fetch(AD_ANALYTICS_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': headers['x-hub-signature-256'] as string || '',
        'X-Forwarded-From': 'agents-monorepo'
      },
      body: JSON.stringify(body)
    });

    if (response.ok) {
      app.log.debug('WABA: Forwarded to ad-analytics');
    } else {
      app.log.warn({ status: response.status }, 'WABA: Forward to ad-analytics failed');
    }
  } catch (error: any) {
    app.log.warn({ error: error.message }, 'WABA: Forward to ad-analytics error');
  }
}
