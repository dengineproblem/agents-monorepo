import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { resolveCreativeAndDirection } from '../lib/creativeResolver.js';
import axios from 'axios';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://evolution-api:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const CHATBOT_SERVICE_URL = process.env.CHATBOT_SERVICE_URL || 'http://chatbot-service:8083';

export default async function evolutionWebhooks(app: FastifyInstance) {

  /**
   * Evolution API webhook endpoint
   * Receives WhatsApp message events from Evolution API
   */
  app.post('/webhooks/evolution', async (request, reply) => {
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

  // ИСПРАВЛЕНО: Извлекаем метаданные Facebook из contextInfo.externalAdReply
  // В Evolution API webhook contextInfo приходит как отдельное поле в data
  const contextInfo = data.contextInfo ||  // ✅ Сначала проверяем data.contextInfo (Evolution API webhook)
                      message.message?.contextInfo ||  // Для совместимости
                      message.message?.extendedTextMessage?.contextInfo;
  
  // 🔍 DEBUG: Логируем структуру contextInfo
  app.log.info({
    hasDataContextInfo: !!data.contextInfo,
    hasMessageContextInfo: !!message.message?.contextInfo,
    contextInfoKeys: contextInfo ? Object.keys(contextInfo) : null,
    hasExternalAdReply: !!contextInfo?.externalAdReply,
    externalAdReplyKeys: contextInfo?.externalAdReply ? Object.keys(contextInfo.externalAdReply) : null,
    rawSourceId: contextInfo?.externalAdReply?.sourceId
  }, '🔍 DEBUG: contextInfo structure');
  
  // Извлекаем метаданные Facebook из externalAdReply
  const externalAdReply = contextInfo?.externalAdReply;
  const sourceId = externalAdReply?.sourceId; // Ad ID из Facebook (например: "120236271994930134")
  const sourceType = externalAdReply?.sourceType; // "ad" для рекламных сообщений
  const sourceUrl = externalAdReply?.sourceUrl; // Ссылка на рекламу (Instagram/Facebook)
  const mediaUrl = externalAdReply?.mediaUrl; // Медиа из рекламы

  // Старый способ (для совместимости, если вдруг придёт в другом формате)
  const legacySourceId = contextInfo?.stanzaId || contextInfo?.referredProductId;

  // Используем sourceId из externalAdReply, если есть, иначе пробуем старый способ
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
    instanceName: instance,
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

// resolveCreativeAndDirection is now imported from ../lib/creativeResolver.js

/**
 * Process lead from Facebook ad
 */
async function processAdLead(params: {
  userAccountId: string;
  whatsappPhoneNumberId?: string;
  instancePhone: string;
  instanceName: string;
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
    instanceName,
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

  // НОВОЕ: Создать/обновить запись в dialog_analysis для чат-бота
  await upsertDialogAnalysis({
    userAccountId,
    instanceName,
    contactPhone: clientPhone,
    messageText,
    timestamp
  }, app);

  // НОВОЕ: Проверить, должен ли бот ответить
  await tryBotResponse(clientPhone, instanceName, messageText, app);
}

/**
 * Создать или обновить запись в dialog_analysis
 */
async function upsertDialogAnalysis(params: {
  userAccountId: string;
  instanceName: string;
  contactPhone: string;
  messageText: string;
  timestamp: Date;
}, app: FastifyInstance) {
  const { userAccountId, instanceName, contactPhone, messageText, timestamp } = params;

  // Проверить существование записи
  const { data: existing } = await supabase
    .from('dialog_analysis')
    .select('id')
    .eq('contact_phone', contactPhone)
    .eq('instance_name', instanceName)
    .maybeSingle();

  if (existing) {
    // Обновить существующую запись
    await supabase
      .from('dialog_analysis')
      .update({
        last_message: messageText,
        analyzed_at: timestamp.toISOString()
      })
      .eq('id', existing.id);
  } else {
    // Создать новую запись
    await supabase
      .from('dialog_analysis')
      .insert({
        user_account_id: userAccountId,
        instance_name: instanceName,
        contact_phone: contactPhone,
        last_message: messageText,
        funnel_stage: 'new_lead',
        interest_level: 'unknown',
        analyzed_at: timestamp.toISOString()
      });
  }
}

/**
 * Попытаться ответить через бота (вызов chatbot-service)
 */
async function tryBotResponse(
  contactPhone: string,
  instanceName: string,
  messageText: string,
  app: FastifyInstance
) {
  try {
    // Вызвать chatbot-service для обработки сообщения
    await axios.post(`${CHATBOT_SERVICE_URL}/process-message`, {
      contactPhone,
      instanceName,
      messageText
    }, {
      timeout: 5000,
      validateStatus: () => true // Не бросать ошибку на любой статус
    });
    
    app.log.debug({ contactPhone, instanceName }, 'Sent message to chatbot-service');
  } catch (error: any) {
    app.log.error({ 
      error: error.message, 
      contactPhone, 
      instanceName 
    }, 'Error calling chatbot-service');
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
