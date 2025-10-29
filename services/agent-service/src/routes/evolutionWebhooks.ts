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

      app.log.info({ event: event.event, instance: event.instance }, 'Evolution webhook received');

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
          app.log.warn({ event: event.event }, 'Unknown Evolution event type');
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

  if (!data.messages || data.messages.length === 0) {
    app.log.warn('No messages in webhook payload');
    return;
  }

  const message = data.messages[0];
  const remoteJid = message.key.remoteJid;
  const messageText = message.message?.conversation ||
                      message.message?.extendedTextMessage?.text || '';

  // Извлекаем метаданные Facebook (если есть)
  const contextInfo = message.message?.extendedTextMessage?.contextInfo;
  const sourceId = contextInfo?.stanzaId || contextInfo?.referredProductId; // Ad ID
  const creativeUrl = contextInfo?.participant;

  app.log.info({
    instance,
    remoteJid,
    hasSourceId: !!sourceId,
    sourceId,
    messageText: messageText.substring(0, 50)
  }, 'Processing incoming WhatsApp message');

  // 1. Найти instance в базе
  const { data: instanceData, error: instanceError } = await supabase
    .from('whatsapp_instances')
    .select('id, user_account_id, phone_number')
    .eq('instance_name', instance)
    .single();

  if (instanceError || !instanceData) {
    app.log.error({ instance, error: instanceError }, 'Instance not found in database');
    return;
  }

  // 2. Найти whatsapp_phone_number_id
  const { data: whatsappNumber } = await supabase
    .from('whatsapp_phone_numbers')
    .select('id')
    .eq('phone_number', instanceData.phone_number)
    .eq('user_account_id', instanceData.user_account_id)
    .single();

  // 3. Сохранить сообщение в таблицу messages_ai_target
  const clientPhone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '');

  const { data: savedMessage, error: messageError } = await supabase
    .from('messages_ai_target')
    .insert({
      chat_id: clientPhone,
      message_text: messageText,
      message_type: 'text',
      direction: 'incoming',
      timestamp: Math.floor((message.messageTimestamp || Date.now()) / 1000),
      whatsapp_message_id: message.key.id,
      source_id: sourceId,
      instance_id: instanceData.id,
      raw_data: message
    })
    .select()
    .single();

  if (messageError) {
    app.log.error({ error: messageError }, 'Failed to save message');
  }

  // 4. Если есть source_id, обработать как лид от рекламы
  if (sourceId) {
    await processAdLead({
      userAccountId: instanceData.user_account_id,
      whatsappPhoneNumberId: whatsappNumber?.id,
      clientPhone,
      sourceId,
      creativeUrl,
      messageText,
      timestamp: new Date(message.messageTimestamp * 1000 || Date.now()),
      rawData: message,
      messageId: savedMessage?.id
    }, app);
  }
}

/**
 * Process lead from Facebook ad
 */
async function processAdLead(params: {
  userAccountId: string;
  whatsappPhoneNumberId?: string;
  clientPhone: string;
  sourceId: string;
  creativeUrl?: string;
  messageText: string;
  timestamp: Date;
  rawData: any;
  messageId?: number;
}, app: FastifyInstance) {
  const {
    userAccountId,
    whatsappPhoneNumberId,
    clientPhone,
    sourceId,
    creativeUrl,
    messageText,
    timestamp,
    rawData,
    messageId
  } = params;

  app.log.info({ userAccountId, clientPhone, sourceId }, 'Processing ad lead');

  // 1. Попытка найти creative по source_id (Ad ID)
  // Сначала проверяем в creative_tests
  const { data: creativeTest } = await supabase
    .from('creative_tests')
    .select(`
      user_creative_id,
      user_creatives!inner(id, direction_id)
    `)
    .eq('ad_id', sourceId)
    .eq('user_id', userAccountId)
    .maybeSingle();

  let creativeId = (creativeTest as any)?.user_creative_id;
  let directionId = (creativeTest as any)?.user_creatives?.direction_id;

  // 2. Альтернатива: найти по creative_url (Instagram post URL)
  if (!creativeId && creativeUrl) {
    const { data: creativeByUrl } = await supabase
      .from('user_creatives')
      .select('id, direction_id')
      .eq('user_id', userAccountId)
      .ilike('title', `%${creativeUrl}%`)
      .maybeSingle();

    if (creativeByUrl) {
      creativeId = creativeByUrl.id;
      directionId = creativeByUrl.direction_id;
    }
  }

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

      // Обновить message с lead_id
      if (messageId) {
        await supabase
          .from('messages_ai_target')
          .update({
            lead_id: existingLead.id,
            creative_id: creativeId,
            direction_id: directionId
          })
          .eq('id', messageId);
      }
    }
  } else {
    // Создать новый лид
    const { data: newLead, error } = await supabase
      .from('leads')
      .insert({
        user_account_id: userAccountId,
        business_id: whatsappPhoneNumberId ? null : params.clientPhone, // legacy fallback
        chat_id: clientPhone,
        source_id: sourceId,
        conversion_source: 'FB_Ads',
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

      // Обновить message с lead_id
      if (messageId && newLead) {
        await supabase
          .from('messages_ai_target')
          .update({
            lead_id: newLead.id,
            creative_id: creativeId,
            direction_id: directionId
          })
          .eq('id', messageId);
      }
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
