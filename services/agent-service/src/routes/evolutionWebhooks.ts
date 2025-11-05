import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://evolution-api:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

export default async function evolutionWebhooks(app: FastifyInstance) {

  /**
   * Evolution API webhook endpoint
   * Receives WhatsApp message events from Evolution API
   */
  app.post('/api/webhooks/evolution', async (request, reply) => {
    try {
      const event = request.body as any;

      app.log.info({
        event: event.event,
        instance: event.instance,
        hasData: !!event.data,
        hasMessages: !!(event.data?.messages),
        messagesLength: event.data?.messages?.length || 0,
        dataKeys: event.data ? Object.keys(event.data) : []
      }, 'Evolution webhook received');

      switch (event.event) {
        case 'messages.upsert':
          await handleIncomingMessage(event, app);
          break;

        case 'connection.update':
          await handleConnectionUpdate(event, app);
          break;

        case 'qrcode.updated':
          await handleQRCodeUpdate(event, app);
          break;

        default:
          // Use debug level for common system events that we don't process
          const systemEvents = [
            'messages.update', 'messages.delete',
            'contacts.update', 'contacts.upsert',
            'chats.update', 'chats.upsert', 'chats.delete',
            'presence.update'
          ];

          if (systemEvents.includes(event.event)) {
            app.log.debug({ event: event.event }, 'System event (not processed)');
          } else {
            app.log.warn({ event: event.event }, 'Unknown Evolution event type');
          }
      }

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error({ error: error.message, stack: error.stack }, 'Error processing Evolution webhook');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}

/**
 * Handle incoming WhatsApp message
 */
async function handleIncomingMessage(event: any, app: FastifyInstance) {
  const { instance, data } = event;

  // Handle different payload formats: data.messages array or data itself
  let messages = data.messages || (data.key ? [data] : null);

  if (!messages || messages.length === 0) {
    app.log.debug({
      dataKeys: data ? Object.keys(data) : [],
      hasKey: !!data.key
    }, 'No messages in webhook payload');
    return;
  }

  const message = messages[0];

  // IMPORTANT: Ignore outgoing messages (fromMe === true)
  if (message.key?.fromMe === true) {
    app.log.debug({
      remoteJid: message.key.remoteJid,
      messageId: message.key.id
    }, 'Ignoring outgoing message');
    return;
  }

  const remoteJid = message.key.remoteJid;
  const messageText = message.message?.conversation ||
                      message.message?.extendedTextMessage?.text || '';

  // ИСПРАВЛЕНО: Извлекаем метаданные Facebook из message.key (а не из contextInfo)
  // В Evolution API информация о рекламе Facebook находится в key объекте
  const sourceId = message.key?.sourceId; // Ad ID из Facebook
  const sourceType = message.key?.sourceType; // "ad" для рекламных сообщений
  const sourceUrl = message.key?.sourceUrl; // Ссылка на рекламу
  const mediaUrl = message.key?.mediaUrl; // Медиа из рекламы

  // Старый способ (для совместимости, если вдруг придёт в другом формате)
  const contextInfo = message.message?.extendedTextMessage?.contextInfo;
  const legacySourceId = contextInfo?.stanzaId || contextInfo?.referredProductId;

  // Используем sourceId из key, если есть, иначе пробуем старый способ
  const finalSourceId = sourceId || legacySourceId;

  // Log message structure for debugging
  app.log.info({
    instance,
    remoteJid,
    sourceId: finalSourceId || null,
    sourceType: sourceType || null,
    sourceUrl: sourceUrl || null,
    keyKeys: message.key ? Object.keys(message.key) : [],
    messageText: messageText.substring(0, 50)
  }, 'Incoming message structure');

  // Only process messages with Facebook metadata (from ads)
  if (!finalSourceId) {
    app.log.debug({
      instance,
      remoteJid,
      messageText: messageText.substring(0, 30)
    }, 'Ignoring message without Facebook metadata (no source_id) - not from ad');
    return;
  }

  app.log.info({
    instance,
    remoteJid,
    sourceId: finalSourceId,
    sourceType,
    messageText: messageText.substring(0, 50)
  }, 'Processing lead from Facebook ad');

  // Find instance in database
  const { data: instanceData, error: instanceError } = await supabase
    .from('whatsapp_instances')
    .select('id, user_account_id, phone_number')
    .eq('instance_name', instance)
    .single();

  if (instanceError || !instanceData) {
    app.log.error({ instance, error: instanceError }, 'Instance not found in database');
    return;
  }

  // Find whatsapp_phone_number_id
  const { data: whatsappNumber } = await supabase
    .from('whatsapp_phone_numbers')
    .select('id')
    .eq('phone_number', instanceData.phone_number)
    .eq('user_account_id', instanceData.user_account_id)
    .single();

  const clientPhone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '');

  // Resolve creative, direction AND whatsapp_phone_number_id BEFORE processing lead
  const { creativeId, directionId, whatsappPhoneNumberId: directionWhatsappId } = 
    await resolveCreativeAndDirection(
      finalSourceId,
      sourceUrl || mediaUrl,
      instanceData.user_account_id,
      app
    );

  // Use WhatsApp from direction if available, otherwise fallback to instance
  const finalWhatsappPhoneNumberId = directionWhatsappId || whatsappNumber?.id;

  app.log.info({
    clientPhone,
    sourceId: finalSourceId,
    creativeId,
    directionId,
    whatsappPhoneNumberId: finalWhatsappPhoneNumberId,
    usedDirectionWhatsApp: !!directionWhatsappId,
  }, 'Resolved lead data from ad metadata');

  // Process as lead from Facebook ad
  await processAdLead({
    userAccountId: instanceData.user_account_id,
    whatsappPhoneNumberId: finalWhatsappPhoneNumberId,
    instancePhone: instanceData.phone_number,
    clientPhone,
    sourceId: finalSourceId,
    creativeId,      // Pass resolved value
    directionId,     // Pass resolved value
    creativeUrl: sourceUrl || mediaUrl,
    messageText,
    timestamp: new Date(message.messageTimestamp * 1000 || Date.now()),
    rawData: message
  }, app);
}

/**
 * Resolve creative_id, direction_id, and whatsapp_phone_number_id from Facebook Ad ID
 *
 * Strategy:
 * 1. PRIMARY: Lookup in ad_creative_mapping by ad_id
 * 2. FALLBACK: Lookup in user_creatives by creative URL matching
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

  // PRIMARY LOOKUP: Find in ad_creative_mapping by ad_id
  const { data: adMapping, error: mappingError } = await supabase
    .from('ad_creative_mapping')
    .select(`
      user_creative_id,
      direction_id,
      account_directions(whatsapp_phone_number_id)
    `)
    .eq('ad_id', sourceId)
    .eq('user_id', userAccountId)
    .maybeSingle();

  if (mappingError) {
    app.log.error({ error: mappingError.message, sourceId }, 'Error looking up ad_creative_mapping');
  }

  if (adMapping) {
    const whatsappPhoneNumberId = (adMapping as any)?.account_directions?.whatsapp_phone_number_id || null;

    app.log.debug({
      sourceId,
      creativeId: adMapping.user_creative_id,
      directionId: adMapping.direction_id,
      whatsappPhoneNumberId,
    }, 'Found creative via ad_creative_mapping');

    return {
      creativeId: adMapping.user_creative_id,
      directionId: adMapping.direction_id,
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
        account_directions(whatsapp_phone_number_id)
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

/**
 * Process lead from Facebook ad
 */
async function processAdLead(params: {
  userAccountId: string;
  whatsappPhoneNumberId?: string;
  instancePhone: string;
  clientPhone: string;
  sourceId: string;
  creativeId: string | null;   // NEW
  directionId: string | null;  // NEW
  creativeUrl?: string;
  messageText: string;
  timestamp: Date;
  rawData: any;
}, app: FastifyInstance) {
  const {
    userAccountId,
    whatsappPhoneNumberId,
    instancePhone,
    clientPhone,
    sourceId,
    creativeId,
    directionId,
    creativeUrl,
    messageText,
    timestamp,
    rawData
  } = params;

  app.log.info({ userAccountId, clientPhone, sourceId, creativeId, directionId }, 'Processing ad lead');

  // 3. Проверить, существует ли уже лид
  const { data: existingLead } = await supabase
    .from('leads')
    .select('id, sale_amount')
    .eq('chat_id', clientPhone)
    .maybeSingle();

  if (existingLead) {
    // Обновить существующий лид
    const { error } = await supabase
      .from('leads')
      .update({
        source_id: sourceId,
        creative_url: creativeUrl,
        creative_id: creativeId,
        direction_id: directionId,
        whatsapp_phone_number_id: whatsappPhoneNumberId,
        user_account_id: userAccountId,
        updated_at: timestamp
      })
      .eq('id', existingLead.id);

    if (error) {
      app.log.error({ error, leadId: existingLead.id }, 'Failed to update lead');
    } else {
      app.log.info({ leadId: existingLead.id }, 'Updated existing lead');
    }
  } else {
    // Создать новый лид
    const { data: newLead, error } = await supabase
      .from('leads')
      .insert({
        user_account_id: userAccountId,
        business_id: instancePhone, // Instance phone number (our business number)
        chat_id: clientPhone,
        source_id: sourceId,
        conversion_source: 'Evolution_API',
        creative_url: creativeUrl,
        creative_id: creativeId,
        direction_id: directionId,
        whatsapp_phone_number_id: whatsappPhoneNumberId,
        funnel_stage: 'new_lead',
        status: 'active',
        created_at: timestamp,
        updated_at: timestamp
      })
      .select()
      .single();

    if (error) {
      app.log.error({ error, clientPhone }, 'Failed to create lead');
    } else {
      app.log.info({ leadId: newLead?.id }, 'Created new lead from ad');
    }
  }
}

/**
 * Handle connection status update
 */
async function handleConnectionUpdate(event: any, app: FastifyInstance) {
  const { instance, data } = event;
  const status = data.state === 'open' ? 'connected' : 'disconnected';

  const { error } = await supabase
    .from('whatsapp_instances')
    .update({
      status,
      last_connected_at: status === 'connected' ? new Date().toISOString() : undefined,
      phone_number: data.phoneNumber || undefined, // Update phone number on connection
      updated_at: new Date().toISOString()
    })
    .eq('instance_name', instance);

  if (error) {
    app.log.error({ error, instance }, 'Failed to update connection status');
  } else {
    app.log.info({ instance, status }, 'Updated WhatsApp instance connection status');
  }

  // Также обновить whatsapp_phone_numbers для отображения на фронте
  const { error: phoneUpdateError } = await supabase
    .from('whatsapp_phone_numbers')
    .update({
      connection_status: status
    })
    .eq('instance_name', instance);

  if (phoneUpdateError) {
    app.log.error({ phoneUpdateError, instance }, 'Failed to update phone number connection status');
  } else {
    app.log.info({ instance, status }, 'Updated phone number connection status');
  }
}

/**
 * Handle QR code update
 */
async function handleQRCodeUpdate(event: any, app: FastifyInstance) {
  const { instance, data } = event;

  const { error } = await supabase
    .from('whatsapp_instances')
    .update({
      qr_code: data.qrcode?.base64 || data.qrcode?.code,
      status: 'connecting',
      updated_at: new Date().toISOString()
    })
    .eq('instance_name', instance);

  if (error) {
    app.log.error({ error, instance }, 'Failed to update QR code');
  } else {
    app.log.info({ instance }, 'Updated QR code for WhatsApp instance');
  }
}
