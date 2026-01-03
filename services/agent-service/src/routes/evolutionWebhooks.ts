import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { resolveCreativeAndDirection } from '../lib/creativeResolver.js';
import { matchMessageToDirection } from '../lib/textMatcher.js';
import { sendTelegramNotification, formatManualMatchMessage } from '../lib/telegramNotifier.js';
import { getLastMessageTime } from '../lib/evolutionDb.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import { transcribeWhatsAppVoice, WhatsAppAudioMessage } from '../lib/whatsappVoiceHandler.js';
import axios from 'axios';

// Период "тишины" в днях - если последнее сообщение было раньше, считаем текущее "первым"
const SMART_MATCH_SILENCE_DAYS = 7;

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

      logErrorToAdmin({
        error_type: 'evolution',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'evolution_webhook',
        endpoint: '/webhooks/evolution',
        severity: 'critical'
      }).catch(() => {});

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

  // Извлекаем pushName (имя контакта из WhatsApp)
  const pushName = message.pushName || data.pushName;

  // Определяем тип сообщения и извлекаем текст
  let messageText = message.message?.conversation ||
                    message.message?.extendedTextMessage?.text || '';
  let messageType: 'text' | 'audio' | 'image' | 'video' | 'document' = 'text';
  const audioMessage = message.message?.audioMessage as WhatsAppAudioMessage | undefined;

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

  // ✅ НОВОЕ: Извлекаем ctwa_clid (Click-to-WhatsApp Click ID) для Meta CAPI
  // ctwa_clid используется для атрибуции конверсий в Meta Conversions API
  // Может приходить в разных местах в зависимости от версии Evolution API
  const referral = contextInfo?.referral || data.referral;
  const ctwaClid = referral?.ctwaClid ||  // Стандартное место
                   contextInfo?.ctwaClid ||  // Альтернативное место
                   externalAdReply?.ctwaClid ||  // В externalAdReply
                   data.ctwaClid;  // На верхнем уровне data

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
    ctwaClid: ctwaClid || null,  // ✅ НОВОЕ: логируем ctwa_clid для CAPI
    hasExternalAdReply: !!externalAdReply,
    hasReferral: !!referral,
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

    // Обработка голосовых сообщений через Whisper транскрипцию
    if (audioMessage) {
      messageType = 'audio';
      app.log.info({
        instance,
        remoteJid,
        duration: audioMessage.seconds,
        isPtt: audioMessage.ptt
      }, 'Processing voice message');

      // Транскрибируем голосовое через Whisper
      const transcriptionResult = await transcribeWhatsAppVoice(
        instance,
        {
          remoteJid: message.key.remoteJid,
          fromMe: message.key.fromMe || false,
          id: message.key.id
        },
        audioMessage,
        app
      );

      if (transcriptionResult.success && transcriptionResult.text) {
        messageText = transcriptionResult.text;
        app.log.info({
          instance,
          remoteJid,
          transcribedLength: messageText.length
        }, 'Voice message transcribed successfully');
      } else {
        app.log.warn({
          instance,
          remoteJid,
          error: transcriptionResult.error,
          errorCode: transcriptionResult.errorCode
        }, 'Voice transcription failed');
        // Продолжаем обработку даже если транскрипция не удалась
        // messageText останется пустым, и бот отправит voice_default_response
      }
    }

    // Пропускаем нетекстовые сообщения (картинки, видео и т.д.) КРОМЕ голосовых
    if (messageType !== 'audio' && (!messageText || messageText.trim().length === 0)) {
      app.log.debug({ instance, remoteJid }, 'Empty/non-text message, skipping');
      return;
    }

    // Для текстовых сообщений пробуем умный матчинг по client_question
    if (messageType === 'text' && messageText.trim().length > 0) {
      await handleSmartMatching(event, instance, remoteJid, remoteJidAlt, messageText, pushName, message, app);
    }

    // ✅ Вызываем бота для обычных сообщений (не из рекламы)
    // Важно: используем remoteJid (реальный номер), а не remoteJidAlt (LID)
    const clientPhone = remoteJid
      .replace('@s.whatsapp.net', '')
      .replace('@c.us', '');

    // ✅ НОВОЕ: Сохраняем pushName в dialog_analysis для обычных сообщений
    // Это нужно чтобы бот знал имя клиента из WhatsApp
    if (pushName) {
      const { data: instanceData } = await supabase
        .from('whatsapp_instances')
        .select('user_account_id, account_id')
        .eq('instance_name', instance)
        .single();

      if (instanceData) {
        await upsertDialogAnalysis({
          userAccountId: instanceData.user_account_id,
          accountId: instanceData.account_id || null,
          instanceName: instance,
          contactPhone: clientPhone,
          contactName: pushName,
          messageText,
          timestamp: new Date(message.messageTimestamp * 1000 || Date.now())
        }, app);
      }
    }

    await tryBotResponse(clientPhone, instance, messageText, messageType, app);

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
    .select('id, user_account_id, account_id, phone_number')
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
      instanceData.account_id || null,  // UUID для мультиаккаунтности
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
    accountId: instanceData.account_id || null,  // UUID для мультиаккаунтности
    whatsappPhoneNumberId: finalWhatsappPhoneNumberId,
    instancePhone: instanceData.phone_number,
    instanceName: instance,
    clientPhone,
    contactName: pushName,  // ✅ НОВОЕ: имя из WhatsApp (pushName)
    sourceId: finalSourceId,
    creativeId,      // Pass resolved value
    directionId,     // Pass resolved value
    creativeUrl: sourceUrl || mediaUrl,
    ctwaClid: ctwaClid || null,  // ✅ НОВОЕ: передаём ctwa_clid для CAPI
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
  accountId?: string | null;   // UUID для мультиаккаунтности
  whatsappPhoneNumberId?: string;
  instancePhone: string;
  instanceName: string;
  clientPhone: string;
  contactName?: string;  // ✅ НОВОЕ: имя контакта из WhatsApp (pushName)
  sourceId: string;
  creativeId: string | null;
  directionId: string | null;
  creativeUrl?: string;
  ctwaClid?: string | null;  // ✅ НОВОЕ: Click-to-WhatsApp Click ID для CAPI
  messageText: string;
  timestamp: Date;
  rawData: any;
}, app: FastifyInstance) {
  const {
    userAccountId,
    accountId,
    whatsappPhoneNumberId,
    instancePhone,
    instanceName,
    clientPhone,
    contactName,  // ✅ НОВОЕ: имя из WhatsApp
    sourceId,
    creativeId,
    directionId,
    creativeUrl,
    ctwaClid,  // ✅ НОВОЕ
    messageText,
    timestamp,
    rawData
  } = params;

  app.log.info({ userAccountId, clientPhone, sourceId, creativeId, directionId, ctwaClid }, 'Processing ad lead');

  // 3. Проверить, существует ли уже лид
  const { data: existingLead } = await supabase
    .from('leads')
    .select('id, sale_amount, ctwa_clid')  // ✅ НОВОЕ: получаем ctwa_clid для сохранения
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
        account_id: accountId || null,  // UUID для мультиаккаунтности
        ctwa_clid: ctwaClid || existingLead.ctwa_clid,  // ✅ НОВОЕ: сохраняем ctwa_clid (не перезаписываем если уже есть)
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
        account_id: accountId || null,  // UUID для мультиаккаунтности
        business_id: instancePhone, // Instance phone number (our business number)
        chat_id: clientPhone,
        source_id: sourceId,
        conversion_source: 'Evolution_API',
        creative_url: creativeUrl,
        creative_id: creativeId,
        direction_id: directionId,
        whatsapp_phone_number_id: whatsappPhoneNumberId,
        ctwa_clid: ctwaClid || null,  // ✅ НОВОЕ: сохраняем ctwa_clid для CAPI
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
    accountId,
    instanceName,
    contactPhone: clientPhone,
    contactName,  // ✅ НОВОЕ: имя из WhatsApp (pushName)
    messageText,
    ctwaClid: ctwaClid || null,  // ✅ НОВОЕ: передаём ctwa_clid для CAPI
    timestamp
  }, app);

  // НОВОЕ: Проверить, должен ли бот ответить
  await tryBotResponse(clientPhone, instanceName, messageText, 'text', app);
}

/**
 * Создать или обновить запись в dialog_analysis
 */
async function upsertDialogAnalysis(params: {
  userAccountId: string;
  accountId?: string | null;  // UUID для мультиаккаунтности
  instanceName: string;
  contactPhone: string;
  contactName?: string;  // ✅ НОВОЕ: имя контакта из WhatsApp (pushName)
  messageText: string;
  ctwaClid?: string | null;  // ✅ НОВОЕ: Click-to-WhatsApp Click ID для CAPI
  timestamp: Date;
}, app: FastifyInstance) {
  const { userAccountId, accountId, instanceName, contactPhone, contactName, messageText, ctwaClid, timestamp } = params;

  // Проверить существование записи
  const { data: existing } = await supabase
    .from('dialog_analysis')
    .select('id, ctwa_clid, contact_name')  // ✅ НОВОЕ: получаем contact_name для проверки
    .eq('contact_phone', contactPhone)
    .eq('instance_name', instanceName)
    .maybeSingle();

  if (existing) {
    // Обновить существующую запись
    // НЕ перезаписываем contact_name если оно уже есть (клиент мог сам назвать имя)
    const updateData: Record<string, any> = {
      last_message: messageText,
      ctwa_clid: ctwaClid || existing.ctwa_clid,
      analyzed_at: timestamp.toISOString()
    };

    // Обновляем имя только если его нет и пришло новое
    if (!existing.contact_name && contactName) {
      updateData.contact_name = contactName;
    }

    await supabase
      .from('dialog_analysis')
      .update(updateData)
      .eq('id', existing.id);
  } else {
    // Создать новую запись
    await supabase
      .from('dialog_analysis')
      .insert({
        user_account_id: userAccountId,
        account_id: accountId || null,  // UUID для мультиаккаунтности
        instance_name: instanceName,
        contact_phone: contactPhone,
        contact_name: contactName || null,  // ✅ НОВОЕ: сохраняем имя из WhatsApp
        last_message: messageText,
        ctwa_clid: ctwaClid || null,  // ✅ НОВОЕ: сохраняем ctwa_clid для CAPI
        funnel_stage: 'new_lead',
        interest_level: 'unknown',
        analyzed_at: timestamp.toISOString()
      });
  }
}

/**
 * Попытаться ответить через бота (вызов chatbot-service)
 * С retry логикой и логированием ошибок в БД
 */
async function tryBotResponse(
  contactPhone: string,
  instanceName: string,
  messageText: string,
  messageType: 'text' | 'audio' | 'image' | 'video' | 'document' = 'text',
  app: FastifyInstance
) {
  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(`${CHATBOT_SERVICE_URL}/process-message`, {
        contactPhone,
        instanceName,
        messageText,
        messageType  // ✅ Передаём тип сообщения для правильной обработки
      }, {
        timeout: 10000, // увеличено с 5 до 10 сек
      });

      if (response.status >= 200 && response.status < 300) {
        app.log.debug({ contactPhone, instanceName, attempt }, 'Sent message to chatbot-service');
        return;
      }

      lastError = new Error(`HTTP ${response.status}: ${JSON.stringify(response.data)}`);
    } catch (error: any) {
      lastError = error;

      if (attempt < MAX_RETRIES) {
        const delay = 1000 * attempt; // 1s, 2s, 3s
        app.log.warn({
          error: error.message,
          contactPhone,
          instanceName,
          attempt,
          maxRetries: MAX_RETRIES,
          nextRetryIn: delay
        }, 'Chatbot-service call failed, retrying...');

        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  // Все попытки исчерпаны - логируем критическую ошибку
  app.log.error({
    error: lastError?.message,
    contactPhone,
    instanceName,
    attempts: MAX_RETRIES
  }, 'All retry attempts failed for chatbot-service');

  // Логируем в БД для видимости в админке
  await logErrorToAdmin({
    error_type: 'chatbot_service',
    raw_error: lastError?.message || 'Unknown error after retries',
    action: 'tryBotResponse',
    endpoint: '/process-message',
    request_data: { contactPhone, instanceName, messageText: messageText.substring(0, 200) },
    severity: 'critical'
  }).catch(() => {});
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
  pushName: string | undefined,  // ✅ НОВОЕ: имя из WhatsApp
  message: any,
  app: FastifyInstance
) {
  const currentTimestamp = message.messageTimestamp || Math.floor(Date.now() / 1000);

  // Проверяем, было ли предыдущее сообщение от этого контакта за последние N дней
  const lastMessageTime = await getLastMessageTime(instance, remoteJid, currentTimestamp);

  if (lastMessageTime !== null) {
    const silenceThreshold = currentTimestamp - (SMART_MATCH_SILENCE_DAYS * 24 * 60 * 60);

    if (lastMessageTime > silenceThreshold) {
      // Есть недавнее сообщение — это не "первое" сообщение, пропускаем smart matching
      const daysSinceLastMessage = (currentTimestamp - lastMessageTime) / (24 * 60 * 60);
      app.log.debug({
        instance,
        remoteJid,
        lastMessageTime,
        daysSinceLastMessage: daysSinceLastMessage.toFixed(1),
        silenceDays: SMART_MATCH_SILENCE_DAYS
      }, 'Recent message exists, skipping smart matching');
      return;
    }

    app.log.info({
      instance,
      remoteJid,
      daysSinceLastMessage: ((currentTimestamp - lastMessageTime) / (24 * 60 * 60)).toFixed(1)
    }, 'No recent messages, treating as new lead for smart matching');
  }

  // Найти инстанс в БД
  const { data: instanceData, error: instanceError } = await supabase
    .from('whatsapp_instances')
    .select('id, user_account_id, account_id, phone_number')
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
    instanceData.account_id || null,  // UUID для мультиаккаунтности
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
  const { isNew } = await createLeadWithoutCreative({
    userAccountId: instanceData.user_account_id,
    accountId: instanceData.account_id || null,  // UUID для мультиаккаунтности
    whatsappPhoneNumberId: whatsappNumber?.id,
    instancePhone: instanceData.phone_number,
    instanceName: instance,
    clientPhone,
    contactName: pushName,  // ✅ НОВОЕ: имя из WhatsApp
    directionId: matchResult.directionId!,
    directionName: matchResult.directionName!,
    similarity: matchResult.similarity,
    messageText,
    timestamp
  }, app);

  // Отправить уведомление в Telegram только для НОВЫХ лидов
  if (isNew) {
    await notifyManualMatchRequired(instanceData.user_account_id, clientPhone, matchResult, app);
  }
}

/**
 * Создать лида без креатива (требует ручного сопоставления)
 * @returns { isNew: boolean } - true если создан новый лид, false если обновлён существующий
 */
async function createLeadWithoutCreative(params: {
  userAccountId: string;
  accountId?: string | null;  // UUID для мультиаккаунтности
  whatsappPhoneNumberId?: string;
  instancePhone: string;
  instanceName: string;
  clientPhone: string;
  contactName?: string;  // ✅ НОВОЕ: имя контакта из WhatsApp (pushName)
  directionId: string;
  directionName: string;
  similarity: number;
  messageText: string;
  timestamp: Date;
}, app: FastifyInstance): Promise<{ isNew: boolean }> {
  const {
    userAccountId,
    accountId,
    whatsappPhoneNumberId,
    instancePhone,
    instanceName,
    clientPhone,
    contactName,  // ✅ НОВОЕ: имя из WhatsApp
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
        account_id: accountId || null,  // UUID для мультиаккаунтности
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

    // Создать запись в dialog_analysis для чат-бота
    await upsertDialogAnalysis({
      userAccountId,
      accountId,
      instanceName,
      contactPhone: clientPhone,
      contactName,  // ✅ НОВОЕ: имя из WhatsApp
      messageText,
      timestamp
    }, app);

    return { isNew: false };
  }

  // Создать новый лид
  const { data: newLead, error } = await supabase
    .from('leads')
    .insert({
      user_account_id: userAccountId,
      account_id: accountId || null,  // UUID для мультиаккаунтности
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

  // Создать запись в dialog_analysis для чат-бота
  await upsertDialogAnalysis({
    userAccountId,
    accountId,
    instanceName,
    contactPhone: clientPhone,
    contactName,  // ✅ НОВОЕ: имя из WhatsApp
    messageText,
    timestamp
  }, app);

  return { isNew: true };
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
