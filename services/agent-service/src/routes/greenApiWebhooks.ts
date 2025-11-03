import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { normalizePhoneNumber } from '../lib/phoneNormalization.js';

/**
 * GreenAPI Webhook Handler
 *
 * Receives WhatsApp message events from GreenAPI and creates leads
 * when messages contain Facebook ad metadata (sourceId).
 *
 * Endpoint: POST /api/webhooks/greenapi
 */
export default async function greenApiWebhooks(app: FastifyInstance) {

  /**
   * Main webhook endpoint for GreenAPI events
   */
  app.post('/webhooks/greenapi', async (request, reply) => {
    try {
      const event = request.body as any;

      // Log full webhook body for debugging
      app.log.info({
        fullBody: JSON.stringify(event, null, 2),
      }, 'GreenAPI webhook FULL BODY');

      app.log.info({
        typeWebhook: event.typeWebhook,
        instanceId: event.instanceData?.idInstance,
        hasMessageData: !!event.messageData,
      }, 'GreenAPI webhook received');

      // Handle different GreenAPI webhook types
      switch (event.typeWebhook) {
        case 'incomingMessageReceived':
          await handleIncomingMessage(event, app);
          break;

        case 'quotaExceeded':
          app.log.warn({ instanceId: event.instanceData?.idInstance }, 'GreenAPI quota exceeded');
          break;

        default:
          app.log.info({
            type: event.typeWebhook,
            fullEvent: JSON.stringify(event, null, 2)
          }, 'Unhandled GreenAPI event type - logging full event');
      }

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error({ error: error.message, stack: error.stack }, 'Error processing GreenAPI webhook');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}

/**
 * Process incoming WhatsApp message from GreenAPI
 */
async function handleIncomingMessage(event: any, app: FastifyInstance) {
  const { instanceData, messageData, senderData } = event;

  // Validate required fields
  if (!instanceData?.wid || !senderData?.chatId) {
    app.log.warn({ event }, 'Missing required fields in GreenAPI webhook');
    return;
  }

  // Extract phone numbers
  const instancePhone = normalizePhoneNumber(instanceData.wid); // Business phone (e.g., "79991234567")
  const clientPhone = normalizePhoneNumber(senderData.chatId);   // Client phone (e.g., "79991234567")

  app.log.info({
    instancePhone,
    clientPhone,
    typeMessage: messageData?.typeMessage,
  }, 'Processing GreenAPI message');

  // Ignore outgoing messages
  if (messageData?.typeMessage === 'outgoing') {
    app.log.info({ clientPhone }, 'Ignoring outgoing message');
    return;
  }

  // Check if lead already exists
  const { data: existingLead } = await supabase
    .from('leads')
    .select('id')
    .eq('chat_id', clientPhone)
    .maybeSingle();

  if (existingLead) {
    app.log.info({ leadId: existingLead.id, clientPhone }, 'Lead already exists, ignoring');
    return;
  }

  // Extract Facebook ad metadata
  const adMetadata = extractFacebookAdMetadata(messageData);

  app.log.info({
    clientPhone,
    hasSourceId: !!adMetadata.sourceId,
    sourceId: adMetadata.sourceId,
    sourceType: adMetadata.sourceType,
    sourceUrl: adMetadata.sourceUrl,
  }, 'Extracted ad metadata');

  if (!adMetadata.sourceId) {
    app.log.info({ clientPhone, messageData }, 'No Facebook ad metadata found, ignoring');
    return;
  }

  app.log.info({
    clientPhone,
    sourceId: adMetadata.sourceId,
    sourceUrl: adMetadata.sourceUrl,
  }, 'Facebook ad metadata found, creating lead');

  // Find WhatsApp phone number and user account
  // We need this to get user_account_id for querying creative_tests
  const whatsappNumberData = await findWhatsAppNumber(instancePhone, app);

  if (!whatsappNumberData) {
    app.log.error({ 
      instancePhone, 
      clientPhone,
      message: 'WhatsApp phone number not found in database'
    }, 'WhatsApp phone number not found in database');
    return;
  }

  // Resolve creative_id, direction_id AND whatsapp_phone_number_id from Facebook Ad ID
  const { creativeId, directionId, whatsappPhoneNumberId } = await resolveCreativeAndDirection(
    adMetadata.sourceId,
    adMetadata.sourceUrl,
    whatsappNumberData.userAccountId,
    app
  );

  // Use WhatsApp phone number from direction if available, otherwise fallback to instance phone
  const finalWhatsappPhoneNumberId = whatsappPhoneNumberId || whatsappNumberData.id;

  app.log.info({
    clientPhone,
    sourceId: adMetadata.sourceId,
    creativeId,
    directionId,
    whatsappPhoneNumberId: finalWhatsappPhoneNumberId,
    usedDirectionWhatsApp: !!whatsappPhoneNumberId,
  }, 'Resolved lead data from ad metadata');

  // Create new lead
  const { data: newLead, error } = await supabase
    .from('leads')
    .insert({
      user_account_id: whatsappNumberData.userAccountId,
      business_id: finalWhatsappPhoneNumberId ? instancePhone : clientPhone, // legacy fallback
      whatsapp_phone_number_id: finalWhatsappPhoneNumberId, // Use WhatsApp from direction!
      chat_id: clientPhone,
      source_id: adMetadata.sourceId,
      creative_id: creativeId,
      direction_id: directionId,
      conversion_source: adMetadata.conversionSource || 'GreenAPI',
      creative_url: adMetadata.sourceUrl,
      funnel_stage: 'new_lead',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    app.log.error({ error: error.message, clientPhone }, 'Failed to create lead');
    return;
  }

  app.log.info({
    leadId: newLead.id,
    clientPhone,
    sourceId: adMetadata.sourceId,
    creativeId,
    directionId,
    whatsappPhoneNumberId: finalWhatsappPhoneNumberId,
  }, 'Successfully created lead from GreenAPI webhook');
}

/**
 * Extract Facebook ad metadata from GreenAPI message data
 */
function extractFacebookAdMetadata(messageData: any): {
  sourceId: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  conversionSource: string | null;
} {
  if (!messageData) {
    return {
      sourceId: null,
      sourceType: null,
      sourceUrl: null,
      conversionSource: null,
    };
  }

  // Check BOTH extendedTextMessageData and extendedTextMessage
  // (GreenAPI uses different field names in different contexts)
  const extendedData = messageData.extendedTextMessageData || messageData.extendedTextMessage;
  
  if (extendedData) {
    // Check if this message has ad metadata
    // We extract if sourceId exists (some ads may not have sourceType='ad')
    if (extendedData.sourceId) {
      return {
        sourceId: extendedData.sourceId || null,
        sourceType: extendedData.sourceType || null,
        sourceUrl: extendedData.sourceUrl || null,
        conversionSource: extendedData.conversionSource || null,
      };
    }
  }

  // Check other message types (imageMessage, videoMessage, etc.)
  const messageTypes = [
    'textMessageData',
    'textMessage',
    'imageMessageData',
    'imageMessage',
    'videoMessageData',
    'videoMessage',
    'documentMessageData',
    'documentMessage',
  ];

  for (const type of messageTypes) {
    const msgData = messageData[type];
    // Extract if sourceId exists (removed strict sourceType === 'ad' check)
    if (msgData?.sourceId) {
      return {
        sourceId: msgData.sourceId || null,
        sourceType: msgData.sourceType || null,
        sourceUrl: msgData.sourceUrl || null,
        conversionSource: msgData.conversionSource || null,
      };
    }
  }

  return {
    sourceId: null,
    sourceType: null,
    sourceUrl: null,
    conversionSource: null,
  };
}

/**
 * Find WhatsApp phone number in database by business phone
 */
async function findWhatsAppNumber(
  instancePhone: string,
  app: FastifyInstance
): Promise<{ id: string; userAccountId: string } | null> {
  // Try with + prefix first (international format)
  const { data, error } = await supabase
    .from('whatsapp_phone_numbers')
    .select('id, user_account_id')
    .eq('phone_number', `+${instancePhone}`)
    .maybeSingle();

  if (error) {
    app.log.error({ error: error.message, instancePhone }, 'Error querying whatsapp_phone_numbers');
    return null;
  }

  if (data) {
    return {
      id: data.id,
      userAccountId: data.user_account_id,
    };
  }

  // Try without + prefix as fallback
  const { data: dataWithoutPlus } = await supabase
    .from('whatsapp_phone_numbers')
    .select('id, user_account_id')
    .eq('phone_number', instancePhone)
    .maybeSingle();

  if (dataWithoutPlus) {
    return {
      id: dataWithoutPlus.id,
      userAccountId: dataWithoutPlus.user_account_id,
    };
  }

  return null;
}

/**
 * Resolve creative_id, direction_id, and whatsapp_phone_number_id from Facebook Ad ID
 *
 * Strategy:
 * 1. PRIMARY: Lookup in creative_tests by ad_id
 * 2. FALLBACK: Lookup in user_creatives by creative URL matching
 * 3. Get whatsapp_phone_number_id from direction (if available)
 */
async function resolveCreativeAndDirection(
  sourceId: string,
  sourceUrl: string | null,
  userAccountId: string,
  app: FastifyInstance
): Promise<{ 
  creativeId: string | null; 
  directionId: string | null;
  whatsappPhoneNumberId: string | null;
}> {

  // PRIMARY LOOKUP: Find in creative_tests by ad_id
  const { data: creativeTest, error: testError } = await supabase
    .from('creative_tests')
    .select(`
      user_creative_id,
      user_creatives!inner(
        id, 
        direction_id,
        account_directions!inner(whatsapp_phone_number_id)
      )
    `)
    .eq('ad_id', sourceId)
    .eq('user_id', userAccountId)
    .maybeSingle();

  if (testError) {
    app.log.error({ error: testError.message, sourceId }, 'Error looking up creative_tests');
  }

  if (creativeTest) {
    const creatives = creativeTest.user_creatives as any;
    const directionId = creatives?.direction_id || null;
    const whatsappPhoneNumberId = creatives?.account_directions?.whatsapp_phone_number_id || null;

    app.log.debug({
      sourceId,
      creativeId: creativeTest.user_creative_id,
      directionId,
      whatsappPhoneNumberId,
    }, 'Found creative via creative_tests.ad_id');

    return {
      creativeId: creativeTest.user_creative_id,
      directionId,
      whatsappPhoneNumberId,
    };
  }

  // FALLBACK LOOKUP: Find by creative URL matching
  if (sourceUrl) {
    const { data: creativeByUrl, error: urlError } = await supabase
      .from('user_creatives')
      .select(`
        id, 
        direction_id,
        account_directions!inner(whatsapp_phone_number_id)
      `)
      .eq('user_id', userAccountId)
      .ilike('title', `%${sourceUrl}%`)
      .maybeSingle();

    if (urlError) {
      app.log.error({ error: urlError.message, sourceUrl }, 'Error looking up user_creatives by URL');
    }

    if (creativeByUrl) {
      const whatsappPhoneNumberId = (creativeByUrl as any)?.account_directions?.whatsapp_phone_number_id || null;

      app.log.debug({
        sourceUrl,
        creativeId: creativeByUrl.id,
        directionId: creativeByUrl.direction_id,
        whatsappPhoneNumberId,
      }, 'Found creative via URL matching');

      return {
        creativeId: creativeByUrl.id,
        directionId: creativeByUrl.direction_id,
        whatsappPhoneNumberId,
      };
    }
  }

  app.log.warn({ sourceId, sourceUrl }, 'Could not resolve creative_id and direction_id');

  return {
    creativeId: null,
    directionId: null,
    whatsappPhoneNumberId: null,
  };
}
