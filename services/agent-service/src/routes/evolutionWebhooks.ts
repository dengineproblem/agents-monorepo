import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { resolveCreativeAndDirection } from '../lib/creativeResolver.js';
import { matchMessageToDirection } from '../lib/textMatcher.js';
import { sendTelegramNotification, formatManualMatchMessage } from '../lib/telegramNotifier.js';
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
  const remoteJidAlt = message.key.remoteJidAlt;  // Альтернативный JID (для лидов с рекламы)
  const messageText = message.message?.conversation ||
                      message.message?.extendedTextMessage?.text || '';

  // ИСПРАВЛЕНО: Извлекаем метаданные Facebook из contextInfo.externalAdReply
  // В реальных вебхуках Evolution API contextInfo приходит на верхнем уровне data
  const contextInfo = data.contextInfo ||  // ✅ Top-level contextInfo (REAL ad messages)
                      message.message?.contextInfo ||  // Fallback: Standard messages
                      message.message?.extendedTextMessage?.contextInfo;  // Fallback: Extended text
  
  // Извлекаем метаданные Facebook из externalAdReply
  const externalAdReply = contextInfo?.externalAdReply;
  const sourceId = externalAdReply?.sourceId; // Ad ID из Facebook (например: "120236271994930134")
  const sourceType = externalAdReply?.sourceType; // "ad" для рекламных сообщений
  const sourceUrl = externalAdReply?.sourceUrl; // Ссылка на рекламу (Instagram/Facebook)
  const mediaUrl = externalAdReply?.mediaUrl; // Медиа из рекламы

  // ✅ ИСПОЛЬЗУЕМ ТОЛЬКО sourceId из externalAdReply (реальный Facebook Ad ID)
  // ❌ НЕ используем stanzaId - это просто message ID, а не Ad ID!
  const finalSourceId = sourceId;

  // Log message structure for debugging
  app.log.info({
    instance,
    remoteJid,
    remoteJidAlt,
    sourceId: finalSourceId || null,
    sourceType: sourceType || null,
    sourceUrl: sourceUrl || null,
    hasExternalAdReply: !!externalAdReply,
    keyKeys: message.key ? Object.keys(message.key) : [],
    messageText: messageText.substring(0, 50)
  }, 'Incoming message structure');

  // ✅ Проверка: сообщения с реальными данными рекламы обрабатываем напрямую
  // Сообщения без externalAdReply пробуем сопоставить через client_question
  if (!finalSourceId || !externalAdReply) {
    // Пропускаем групповые чаты
    if (remoteJid.endsWith('@g.us')) {
      app.log.debug({ instance, remoteJid }, 'Ignoring group chat message');
      return;
    }

    // Пробуем умный матчинг по client_question
    await handleSmartMatching(event, instance, remoteJid, remoteJidAlt, messageText, message, app);
    return;
  }

  // ✅ Дополнительная проверка sourceType (опционально, но надежнее)
  if (sourceType && sourceType !== 'ad') {
    app.log.debug({
      instance,
      remoteJid,
      sourceType,
      messageText: messageText.substring(0, 30)
    }, 'Ignoring message: sourceType is not "ad"');
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

  // ✅ ИСПРАВЛЕНО: Для лидов с рекламы используем remoteJidAlt (настоящий номер)
  // Если remoteJid заканчивается на @lid - это Lead ID, настоящий номер в remoteJidAlt
  let clientPhone: string;
  
  if (remoteJid.endsWith('@lid')) {
    // Лид из рекламы: используем remoteJidAlt (настоящий номер клиента)
    clientPhone = (remoteJidAlt || remoteJid)
      .replace('@s.whatsapp.net', '')  // Обычный контакт (новый формат)
      .replace('@c.us', '')            // Обычный контакт (старый формат)
      .replace('@lid', '');            // На случай если remoteJidAlt тоже @lid
    
    app.log.info({
      remoteJid,
      remoteJidAlt,
      clientPhone,
      isAdLead: true
    }, 'Using remoteJidAlt for ad lead phone number');
  } else {
    // Обычное сообщение: используем remoteJid
    clientPhone = remoteJid
      .replace('@s.whatsapp.net', '')  // Обычный контакт (новый формат)
      .replace('@c.us', '')            // Обычный контакт (старый формат)
      .replace('@g.us', '');           // Групповой чат
  }

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

/**
 * Умный матчинг для сообщений без FB метаданных
 * Сравнивает текст сообщения с client_question направлений пользователя
 */
async function handleSmartMatching(
  event: any,
  instance: string,
  remoteJid: string,
  remoteJidAlt: string | undefined,
  messageText: string,
  message: any,
  app: FastifyInstance
) {
  // Найти инстанс в БД
  const { data: instanceData, error: instanceError } = await supabase
    .from('whatsapp_instances')
    .select('id, user_account_id, phone_number')
    .eq('instance_name', instance)
    .single();

  if (instanceError || !instanceData) {
    app.log.debug({ instance }, 'Instance not found, ignoring message');
    return;
  }

  // Пробуем найти направление по совпадению с client_question
  const matchResult = await matchMessageToDirection(
    messageText,
    instanceData.user_account_id,
    0.7 // Порог 70%
  );

  if (!matchResult.matched) {
    app.log.debug({
      instance,
      remoteJid,
      similarity: matchResult.similarity,
      messageText: messageText.substring(0, 50)
    }, 'No match found via client_question, ignoring message');
    return;
  }

  app.log.info({
    instance,
    remoteJid,
    similarity: matchResult.similarity,
    directionId: matchResult.directionId,
    directionName: matchResult.directionName
  }, 'Smart matching: found direction via client_question');

  // Определяем номер телефона клиента
  let clientPhone: string;
  if (remoteJid.endsWith('@lid')) {
    clientPhone = (remoteJidAlt || remoteJid)
      .replace('@s.whatsapp.net', '')
      .replace('@c.us', '')
      .replace('@lid', '');
  } else {
    clientPhone = remoteJid
      .replace('@s.whatsapp.net', '')
      .replace('@c.us', '');
  }

  // Найти whatsapp_phone_number_id
  const { data: whatsappNumber } = await supabase
    .from('whatsapp_phone_numbers')
    .select('id')
    .eq('phone_number', instanceData.phone_number)
    .eq('user_account_id', instanceData.user_account_id)
    .single();

  const timestamp = new Date(message.messageTimestamp * 1000 || Date.now());

  // Создать лида БЕЗ креатива, но С направлением
  await createLeadWithoutCreative({
    userAccountId: instanceData.user_account_id,
    whatsappPhoneNumberId: whatsappNumber?.id,
    instancePhone: instanceData.phone_number,
    instanceName: instance,
    clientPhone,
    directionId: matchResult.directionId!,
    directionName: matchResult.directionName!,
    similarity: matchResult.similarity,
    messageText,
    timestamp
  }, app);

  // Отправить уведомление в Telegram о необходимости ручного сопоставления
  await notifyManualMatchRequired(instanceData.user_account_id, clientPhone, matchResult, app);
}

/**
 * Создать лида без креатива (требует ручного сопоставления)
 */
async function createLeadWithoutCreative(params: {
  userAccountId: string;
  whatsappPhoneNumberId?: string;
  instancePhone: string;
  instanceName: string;
  clientPhone: string;
  directionId: string;
  directionName: string;
  similarity: number;
  messageText: string;
  timestamp: Date;
}, app: FastifyInstance) {
  const {
    userAccountId,
    whatsappPhoneNumberId,
    instancePhone,
    instanceName,
    clientPhone,
    directionId,
    similarity,
    messageText,
    timestamp
  } = params;

  // Проверить, существует ли уже лид
  const { data: existingLead } = await supabase
    .from('leads')
    .select('id')
    .eq('chat_id', clientPhone)
    .maybeSingle();

  if (existingLead) {
    // Обновить существующий лид только если у него нет creative_id
    const { error } = await supabase
      .from('leads')
      .update({
        direction_id: directionId,
        whatsapp_phone_number_id: whatsappPhoneNumberId,
        user_account_id: userAccountId,
        needs_manual_match: true,
        updated_at: timestamp
      })
      .eq('id', existingLead.id)
      .is('creative_id', null);

    if (error) {
      app.log.error({ error, leadId: existingLead.id }, 'Failed to update lead for manual match');
    } else {
      app.log.info({ leadId: existingLead.id, similarity }, 'Updated existing lead (needs manual match)');
    }
  } else {
    // Создать новый лид
    const { data: newLead, error } = await supabase
      .from('leads')
      .insert({
        user_account_id: userAccountId,
        business_id: instancePhone,
        chat_id: clientPhone,
        conversion_source: 'Evolution_API_SmartMatch',
        direction_id: directionId,
        whatsapp_phone_number_id: whatsappPhoneNumberId,
        funnel_stage: 'new_lead',
        status: 'active',
        needs_manual_match: true,
        created_at: timestamp,
        updated_at: timestamp
      })
      .select()
      .single();

    if (error) {
      app.log.error({ error, clientPhone }, 'Failed to create lead from smart match');
    } else {
      app.log.info({ leadId: newLead?.id, similarity }, 'Created new lead from smart match (needs manual creative)');
    }
  }

  // Создать запись в dialog_analysis для чат-бота
  await upsertDialogAnalysis({
    userAccountId,
    instanceName,
    contactPhone: clientPhone,
    messageText,
    timestamp
  }, app);
}

/**
 * Уведомить пользователя в Telegram о необходимости ручного сопоставления креатива
 */
async function notifyManualMatchRequired(
  userAccountId: string,
  clientPhone: string,
  matchResult: { similarity: number; directionName: string | null },
  app: FastifyInstance
) {
  // Получить telegram_id пользователя
  const { data: user } = await supabase
    .from('user_accounts')
    .select('telegram_id')
    .eq('id', userAccountId)
    .single();

  if (!user?.telegram_id) {
    app.log.debug({ userAccountId }, 'User has no telegram_id, skipping notification');
    return;
  }

  const message = formatManualMatchMessage({
    phone: clientPhone,
    direction: matchResult.directionName || 'Неизвестно',
    similarity: Math.round(matchResult.similarity * 100)
  });

  const sent = await sendTelegramNotification(user.telegram_id, message);

  if (sent) {
    app.log.info({ userAccountId, clientPhone }, 'Sent manual match notification to Telegram');
  }
}
