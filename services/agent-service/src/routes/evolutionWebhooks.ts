import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
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
const EVOLUTION_AD_SOURCE_FALLBACK_ENABLED =
  process.env.EVOLUTION_AD_SOURCE_FALLBACK_ENABLED !== 'false';


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
 * Normalize source_id value from Evolution payload
 */
function normalizeSourceId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function normalizeCtwaClid(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

  // Handle outgoing messages (fromMe === true) - check for operator intervention
  if (message.key?.fromMe === true) {
    await handleOperatorIntervention(event, message, app);
    return;
  }

  // Ignore reactions - they don't need bot response
  if (message.message?.reactionMessage) {
    app.log.debug({
      remoteJid: message.key.remoteJid,
      reaction: message.message.reactionMessage.text
    }, 'Ignoring reaction message');
    return;
  }

  // Ignore protocol messages (read receipts, message deletions, etc.)
  if (message.message?.protocolMessage) {
    app.log.debug({
      remoteJid: message.key.remoteJid,
      type: message.message.protocolMessage.type
    }, 'Ignoring protocol message');
    return;
  }

  const remoteJid = message.key.remoteJid;
  const remoteJidAlt = message.key.remoteJidAlt;  // Альтернативный JID (для лидов с рекламы)

  // Извлекаем pushName (имя контакта из WhatsApp)
  // AI сам решит - использовать это как имя или спросить клиента
  const pushName = (message.pushName || data.pushName)?.trim() || undefined;

  // Определяем тип сообщения и извлекаем текст
  let messageText = message.message?.conversation ||
                    message.message?.extendedTextMessage?.text || '';
  let messageType: 'text' | 'audio' | 'image' | 'video' | 'document' = 'text';
  const audioMessage = message.message?.audioMessage as WhatsAppAudioMessage | undefined;

  // Извлекаем ad metadata из нескольких вариантов payload.
  // Evolution/Baileys может передавать referral/context в разных полях.
  const contextInfo = data.contextInfo ||
                      data.message?.contextInfo ||
                      data.message?.extendedTextMessage?.contextInfo ||
                      message.message?.contextInfo ||
                      message.message?.extendedTextMessage?.contextInfo;

  const conversationContext = data.conversationContext || message.message?.conversationContext;
  const referral = contextInfo?.referral || data.referral || conversationContext?.referral;
  const referredProductPromotion = contextInfo?.referredProductPromotion ||
                                   contextInfo?.referencedProductPromotion ||
                                   data.referredProductPromotion ||
                                   data.referencedProductPromotion;
  const externalAdReply = contextInfo?.externalAdReply;

  const externalSourceId = normalizeSourceId(externalAdReply?.sourceId);
  const referralSourceId = normalizeSourceId(
    referral?.sourceId || referral?.source_id || data.sourceId || data.source_id
  );
  const sourceId = externalSourceId || referralSourceId;
  const keySourceId = normalizeSourceId(message.key?.sourceId); // Fallback формат Evolution patch
  const sourceType = externalAdReply?.sourceType || referral?.sourceType || referral?.source_type;
  const sourceUrl = externalAdReply?.sourceUrl || referral?.sourceUrl || referral?.source_url;
  const mediaUrl = externalAdReply?.mediaUrl ||
                   referral?.mediaUrl ||
                   referral?.imageUrl ||
                   referral?.videoUrl ||
                   referral?.image_url ||
                   referral?.video_url;

  // Click-to-WhatsApp Click ID может приходить в referral/conversationContext/contextInfo/externalAdReply.
  const ctwaCandidates = [
    { source: 'referral.ctwaClid', value: referral?.ctwaClid },
    { source: 'referral.ctwa_clid', value: referral?.ctwa_clid },
    { source: 'conversationContext.ctwaClid', value: conversationContext?.ctwaClid },
    { source: 'conversationContext.referralCtwaClid', value: conversationContext?.referralCtwaClid },
    { source: 'referredProductPromotion.ctwaClid', value: referredProductPromotion?.ctwaClid },
    { source: 'referredProductPromotion.ctwa_clid', value: referredProductPromotion?.ctwa_clid },
    { source: 'contextInfo.ctwaClid', value: contextInfo?.ctwaClid },
    { source: 'externalAdReply.ctwaClid', value: externalAdReply?.ctwaClid },
    { source: 'data.ctwaClid', value: data.ctwaClid },
    { source: 'data.ctwa_clid', value: data.ctwa_clid },
  ] as const;

  const resolvedCtwa = ctwaCandidates
    .map((candidate) => ({
      source: candidate.source,
      value: normalizeCtwaClid(candidate.value)
    }))
    .find((candidate) => !!candidate.value);

  const ctwaClid = resolvedCtwa?.value;
  const ctwaClidSource = resolvedCtwa?.source || 'none';

  // Приоритет: externalAdReply.sourceId -> fallback message.key.sourceId (под флагом)
  const fallbackSourceId = EVOLUTION_AD_SOURCE_FALLBACK_ENABLED && !sourceId
    ? keySourceId
    : undefined;
  const finalSourceId = sourceId || fallbackSourceId;
  const sourceIdOrigin = externalSourceId
    ? 'external'
    : (referralSourceId ? 'referral' : (fallbackSourceId ? 'key' : 'none'));

  // Log message structure for debugging
  app.log.info({
    instance,
    remoteJid,
    remoteJidAlt,
    sourceId: finalSourceId || null,
    keySourceId: keySourceId || null,
    sourceIdOrigin,
    evolutionAdFallbackEnabled: EVOLUTION_AD_SOURCE_FALLBACK_ENABLED,
    sourceType: sourceType || null,
    sourceUrl: sourceUrl || null,
    ctwaClid: ctwaClid || null,  // ✅ НОВОЕ: логируем ctwa_clid для CAPI
    ctwaClidSource,
    hasExternalAdReply: !!externalAdReply,
    hasReferral: !!referral,
    hasConversationContext: !!conversationContext,
    hasReferredProductPromotion: !!referredProductPromotion,
    externalSourceId: externalSourceId || null,
    referralSourceId: referralSourceId || null,
    keyKeys: message.key ? Object.keys(message.key) : [],
    messageText: messageText.substring(0, 50)
  }, 'Incoming message structure');

  const hasAdMetadata = !!finalSourceId;

  if (hasAdMetadata && ctwaClid) {
    app.log.debug({
      instance,
      remoteJid,
      sourceId: finalSourceId,
      sourceIdOrigin,
      ctwaClidSource,
      ctwaClidPrefix: ctwaClid.slice(0, 10)
    }, 'Resolved ad metadata with ctwa_clid');
  }

  if (hasAdMetadata && !ctwaClid) {
    app.log.debug({
      instance,
      remoteJid,
      sourceId: finalSourceId,
      sourceIdOrigin,
      ctwaClidSource,
      contextInfoKeys: contextInfo ? Object.keys(contextInfo) : [],
      referralKeys: referral ? Object.keys(referral) : [],
      conversationContextKeys: conversationContext ? Object.keys(conversationContext) : [],
      externalAdReplyKeys: externalAdReply ? Object.keys(externalAdReply) : []
    }, 'Ad message detected without ctwa_clid');
  }

  if (sourceIdOrigin === 'key') {
    app.log.info({
      instance,
      remoteJid,
      sourceId: finalSourceId,
      sourceIdOrigin,
      hasExternalAdReply: !!externalAdReply
    }, 'Evolution ad-id fallback applied from message.key.sourceId');
  }

  // Сообщения без ad-id обрабатываем как обычные входящие
  if (!hasAdMetadata) {
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

    // ✅ Вызываем бота для обычных сообщений (не из рекламы)
    // Важно: проверяем @lid и используем remoteJidAlt если это Lead ID
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

    // Для текстовых сообщений пробуем умный матчинг по client_question
    // handleSmartMatching возвращает instanceData если нашёл инстанс (и возможно создал dialog_analysis)
    let instanceData: { user_account_id: string; account_id: string | null } | null = null;
    if (messageType === 'text' && messageText.trim().length > 0) {
      instanceData = await handleSmartMatching(event, instance, remoteJid, remoteJidAlt, messageText, pushName, message, app);
    }

    // Сохраняем pushName в dialog_analysis (если ещё не сохранено через smart matching)
    // Для аудио сообщений и текстовых без match нужно отдельно сохранить
    if (pushName && !instanceData) {
      // Получаем instanceData если ещё не получили
      const { data: instData } = await supabase
        .from('whatsapp_instances')
        .select('user_account_id, account_id')
        .eq('instance_name', instance)
        .single();

      if (instData) {
        instanceData = { user_account_id: instData.user_account_id, account_id: instData.account_id };
      }
    }

    // Сохраняем pushName для всех сообщений (если есть instanceData)
    if (pushName && instanceData) {
      await upsertDialogAnalysis({
        userAccountId: instanceData.user_account_id,
        accountId: instanceData.account_id,
        instanceName: instance,
        contactPhone: clientPhone,
        contactName: pushName,
        messageText,
        timestamp: new Date(message.messageTimestamp * 1000 || Date.now())
      }, app);
    }

    // Валидация перед вызовом бота - не отправляем запрос с пустыми полями
    if (!clientPhone || !instance) {
      app.log.warn({ clientPhone, instance, remoteJid }, 'Missing clientPhone or instance, skipping bot response');
      return;
    }

    // Проверяем наличие бота перед вызовом - не делаем лишний запрос если бота нет
    const hasBot = await hasBotForInstance(instance);
    if (hasBot) {
      await tryBotResponse(clientPhone, instance, messageText, messageType, app);
    } else {
      app.log.debug({ instance, clientPhone }, 'No bot configured, skipping tryBotResponse');
    }

    return;
  }

  // ✅ Дополнительная проверка sourceType (опционально, но надежнее)
  const normalizedSourceType = typeof sourceType === 'string' ? sourceType.toLowerCase() : '';
  if (normalizedSourceType && normalizedSourceType !== 'ad' && normalizedSourceType !== 'advertisement') {
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

  // Сбрасываем CAPI-счётчик только для направлений с WhatsApp источником
  // Для capi_source='crm' WhatsApp события не должны менять CAPI-флаги
  const capiSource = await getDirectionCapiSource(directionId || null);
  const shouldTrackWhatsappCapi = capiSource !== 'crm';

  if (shouldTrackWhatsappCapi) {
    await supabase
      .from('dialog_analysis')
      .update({ capi_msg_count: 0, capi_interest_sent: false })
      .eq('instance_name', instanceName)
      .eq('contact_phone', clientPhone);

    app.log.debug({ instanceName, clientPhone }, 'Reset CAPI counter for new ad click');
  } else {
    app.log.debug({
      instanceName,
      clientPhone,
      directionId,
      capiSource
    }, 'Skip CAPI counter reset for CRM-sourced direction');
  }

  // НОВОЕ: Создать/обновить запись в dialog_analysis для чат-бота
  await upsertDialogAnalysis({
    userAccountId,
    accountId,
    instanceName,
    contactPhone: clientPhone,
    contactName,  // ✅ НОВОЕ: имя из WhatsApp (pushName)
    messageText,
    ctwaClid: ctwaClid || null,  // ✅ передаём ctwa_clid для CAPI
    directionId: directionId || null,  // ✅ НОВОЕ: передаём direction_id для CAPI
    timestamp
  }, app);

  // НОВОЕ: Проверить, должен ли бот ответить
  // Валидация перед вызовом бота - не отправляем запрос с пустыми полями
  if (!clientPhone || !instanceName) {
    app.log.warn({ clientPhone, instanceName }, 'Missing clientPhone or instanceName, skipping bot response');
    return;
  }

  // Проверяем наличие бота перед вызовом - не делаем лишний запрос если бота нет
  const hasBot = await hasBotForInstance(instanceName);
  if (hasBot) {
    await tryBotResponse(clientPhone, instanceName, messageText, 'text', app);
  } else {
    app.log.debug({ instanceName, clientPhone }, 'No bot configured for ad lead, skipping tryBotResponse');
  }
}

/**
 * Получить рекламную атрибуцию лида
 */
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

/**
 * Get capi_source for direction
 */
async function getDirectionCapiSource(directionId: string | null | undefined): Promise<'whatsapp' | 'crm' | null> {
  if (!directionId) return null;

  const { data: direction } = await supabase
    .from('account_directions')
    .select('capi_source')
    .eq('id', directionId)
    .maybeSingle();

  const source = direction?.capi_source;
  if (source === 'crm' || source === 'whatsapp') {
    return source;
  }

  return null;
}

/**
 * Отправить CAPI Interest (Level 1) событие через chatbot-service
 */
async function sendCapiInterestEvent(
  app: FastifyInstance,
  instanceName: string,
  contactPhone: string
): Promise<void> {
  const correlationId = randomUUID();
  const startTime = Date.now();

  app.log.info({
    correlationId,
    instanceName,
    contactPhone,
    action: 'capi_interest_start'
  }, 'Starting CAPI Interest event request');

  try {
    const chatbotUrl = process.env.CHATBOT_SERVICE_URL || 'http://chatbot-service:8083';

    const response = await fetch(`${chatbotUrl}/capi/interest-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId
      },
      body: JSON.stringify({ instanceName, contactPhone })
    });

    const durationMs = Date.now() - startTime;
    const responseData = await response.json().catch(() => null) as { success?: boolean; eventId?: string; error?: string } | null;
    const isSuccess = response.ok && responseData?.success === true;

    if (isSuccess) {
      // Пометить что отправили
      await supabase
        .from('dialog_analysis')
        .update({ capi_interest_sent: true })
        .eq('instance_name', instanceName)
        .eq('contact_phone', contactPhone);

      app.log.info({
        correlationId,
        instanceName,
        contactPhone,
        durationMs,
        eventId: responseData.eventId,
        action: 'capi_interest_success'
      }, 'CAPI Interest event sent successfully');
    } else {
      app.log.warn({
        correlationId,
        instanceName,
        contactPhone,
        status: response.status,
        error: responseData?.error || 'CAPI response success=false or invalid payload',
        durationMs,
        action: 'capi_interest_not_confirmed'
      }, 'CAPI Interest event was not confirmed by chatbot-service');
    }
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    app.log.error({
      correlationId,
      instanceName,
      contactPhone,
      error: error.message,
      stack: error.stack,
      durationMs,
      action: 'capi_interest_error'
    }, 'Failed to send CAPI Interest event');
  }
}

/**
 * Создать или обновить запись в dialog_analysis
 * С CAPI Interest (Level 1) логикой по счётчику сообщений
 */
async function upsertDialogAnalysis(params: {
  userAccountId: string;
  accountId?: string | null;  // UUID для мультиаккаунтности
  instanceName: string;
  contactPhone: string;
  contactName?: string;  // имя контакта из WhatsApp (pushName)
  messageText: string;
  ctwaClid?: string | null;  // Click-to-WhatsApp Click ID для CAPI
  directionId?: string | null;  // ✅ НОВОЕ: direction_id для CAPI
  timestamp: Date;
  isIncoming?: boolean;  // true если входящее сообщение от клиента (default: true)
}, app: FastifyInstance) {
  const {
    userAccountId, accountId, instanceName, contactPhone,
    contactName, messageText, ctwaClid, directionId, timestamp,
    isIncoming = true
  } = params;

  // DEBUG: Логируем входящие данные
  app.log.debug({
    contactPhone,
    instanceName,
    ctwaClid: ctwaClid || null,
    directionId: directionId || null,
    isIncoming
  }, 'upsertDialogAnalysis: incoming params');

  // Проверить существование записи
  const { data: existing } = await supabase
    .from('dialog_analysis')
    .select('id, ctwa_clid, contact_name, capi_msg_count, capi_interest_sent, direction_id, incoming_count')
    .eq('contact_phone', contactPhone)
    .eq('instance_name', instanceName)
    .maybeSingle();

  // Проверить рекламную атрибуцию лида и источник CAPI
  const leadAttribution = await getLeadAttribution(contactPhone, userAccountId);
  const isFromAd = leadAttribution.isFromAd;
  const effectiveDirectionId = directionId || existing?.direction_id || leadAttribution.directionId || null;
  const capiSource = isFromAd ? await getDirectionCapiSource(effectiveDirectionId) : null;
  const isWhatsappCapiTrackingEnabled = capiSource !== 'crm';

  if (existing) {
    // Обновить существующую запись
    const finalCtwaClid = ctwaClid || existing.ctwa_clid;
    // ✅ НОВОЕ: используем переданный direction_id или сохраняем существующий
    const finalDirectionId = effectiveDirectionId;

    // CAPI: Инкрементируем счётчик только для входящих сообщений от рекламных лидов
    // и только когда источник CAPI = whatsapp (или не задан)
    const newCapiMsgCount = (isIncoming && isFromAd && isWhatsappCapiTrackingEnabled)
      ? (existing.capi_msg_count || 0) + 1
      : (existing.capi_msg_count || 0);

    // ✅ НОВОЕ: также инкрементируем incoming_count для processDialogForCapi
    const newIncomingCount = isIncoming
      ? (existing.incoming_count || 0) + 1
      : (existing.incoming_count || 0);

    const updateData: Record<string, any> = {
      last_message: timestamp.toISOString(),
      ctwa_clid: finalCtwaClid,
      direction_id: finalDirectionId,  // ✅ НОВОЕ: обновляем direction_id
      capi_msg_count: newCapiMsgCount,
      incoming_count: newIncomingCount,  // ✅ НОВОЕ: обновляем incoming_count
      analyzed_at: timestamp.toISOString()
    };

    // Обновляем имя только если его нет и пришло новое
    if (!existing.contact_name && contactName) {
      updateData.contact_name = contactName;
    }

    const { error: updateError } = await supabase
      .from('dialog_analysis')
      .update(updateData)
      .eq('id', existing.id);

    if (updateError) {
      app.log.error({ error: updateError, existingId: existing.id }, 'Failed to update dialog_analysis');
    }

    // CAPI: Проверить порог для Level 1 (Interest)
    const INTEREST_THRESHOLD = parseInt(process.env.CAPI_INTEREST_THRESHOLD || '3', 10);

    // ✅ ИСПРАВЛЕНО: используем finalDirectionId (может быть передан явно)
    if (
      isFromAd &&                              // Рекламный лид
      isWhatsappCapiTrackingEnabled &&         // Только для capi_source=whatsapp
      newCapiMsgCount >= INTEREST_THRESHOLD && // Достиг порога
      !existing.capi_interest_sent &&          // Ещё не отправляли
      finalDirectionId                         // Есть direction для CAPI
    ) {
      app.log.info({
        contactPhone,
        capiMsgCount: newCapiMsgCount,
        incomingCount: newIncomingCount,
        threshold: INTEREST_THRESHOLD,
        directionId: finalDirectionId,
        capiSource: capiSource || null
      }, 'CAPI threshold reached, sending Level 1 event');

      await sendCapiInterestEvent(app, instanceName, contactPhone);
    } else if (isFromAd && !isWhatsappCapiTrackingEnabled) {
      app.log.debug({
        contactPhone,
        directionId: finalDirectionId,
        capiSource: capiSource || null
      }, 'Skipping WhatsApp CAPI counter: direction capi_source is crm');
    }

  } else {
    // Создать новую запись
    // CAPI: Начинаем счёт с 1 только если это входящее сообщение от рекламного лида
    const initialCapiMsgCount = (isIncoming && isFromAd && isWhatsappCapiTrackingEnabled) ? 1 : 0;
    // ✅ НОВОЕ: incoming_count для processDialogForCapi
    const initialIncomingCount = isIncoming ? 1 : 0;

    app.log.debug({
      contactPhone,
      ctwaClid: ctwaClid || null,
      directionId: effectiveDirectionId,
      isFromAd,
      capiSource: capiSource || null,
      isWhatsappCapiTrackingEnabled,
      initialCapiMsgCount,
      initialIncomingCount
    }, 'upsertDialogAnalysis: creating new record');

    const { error: insertError } = await supabase
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
        direction_id: effectiveDirectionId,  // ✅ НОВОЕ: direction_id для CAPI
        capi_msg_count: initialCapiMsgCount,
        incoming_count: initialIncomingCount,  // ✅ НОВОЕ: incoming_count
        funnel_stage: 'new_lead',
        analyzed_at: timestamp.toISOString()
      });

    if (insertError) {
      app.log.error({ error: insertError, contactPhone }, 'Failed to create dialog_analysis');
    }
  }
}

/**
 * Проверить, есть ли активный бот для инстанса
 * Возвращает true только если бот существует и активен
 *
 * ВАЖНО: Логика должна совпадать с getBotConfigForInstance в chatbot-service!
 * Проверяем ai_bot_configurations, а не устаревшие bot_instances/ai_bots
 */
async function hasBotForInstance(instanceName: string): Promise<boolean> {
  // Получаем инстанс с привязанным ai_bot_id
  const { data: instanceData, error: instanceError } = await supabase
    .from('whatsapp_instances')
    .select('user_account_id, ai_bot_id')
    .eq('instance_name', instanceName)
    .maybeSingle();

  if (instanceError || !instanceData) {
    return false;
  }

  // Если есть привязанный бот - проверяем его активность
  if (instanceData.ai_bot_id) {
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

  // Fallback: проверяем есть ли активный бот у пользователя в ai_bot_configurations
  const { data: fallbackBot } = await supabase
    .from('ai_bot_configurations')
    .select('id')
    .eq('user_account_id', instanceData.user_account_id)
    .eq('is_active', true)
    .maybeSingle();

  return !!fallbackBot;
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
 * @returns instanceData если нашли и обработали, null если не обработали
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
): Promise<{ user_account_id: string; account_id: string | null } | null> {
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
      return null;
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
    return null;
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
    }, 'No match found via client_question');
    // Возвращаем instanceData чтобы вызывающий код мог сохранить pushName
    return { user_account_id: instanceData.user_account_id, account_id: instanceData.account_id };
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

  // Уведомление о привязке креатива отключено (слишком частое, не несёт ценности)
  // if (isNew) {
  //   await notifyManualMatchRequired(instanceData.user_account_id, clientPhone, matchResult, app);
  // }

  // Вернуть instanceData - dialog_analysis уже создан в createLeadWithoutCreative
  return { user_account_id: instanceData.user_account_id, account_id: instanceData.account_id };
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
      directionId: directionId || null,  // ✅ НОВОЕ: direction_id для CAPI
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
    directionId: directionId || null,  // ✅ НОВОЕ: direction_id для CAPI
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

/**
 * Обработка исходящего сообщения - проверка на вмешательство оператора
 * Если оператор отправил сообщение (не бот), и включена пауза при вмешательстве,
 * ставим бота на паузу
 */
async function handleOperatorIntervention(
  event: any,
  message: any,
  app: FastifyInstance
) {
  const { instance } = event;
  const remoteJid = message.key?.remoteJid;

  if (!remoteJid) {
    app.log.debug({ instance }, 'No remoteJid in outgoing message');
    return;
  }

  // Пропускаем групповые чаты
  if (remoteJid.endsWith('@g.us')) {
    return;
  }

  // Извлекаем номер телефона
  const clientPhone = remoteJid
    .replace('@s.whatsapp.net', '')
    .replace('@c.us', '')
    .replace('@lid', '');

  // Находим dialog_analysis для этого чата
  const { data: lead, error: leadError } = await supabase
    .from('dialog_analysis')
    .select('id, instance_name, last_bot_message_at, bot_paused')
    .eq('contact_phone', clientPhone)
    .eq('instance_name', instance)
    .maybeSingle();

  if (leadError || !lead) {
    app.log.debug({ instance, clientPhone }, 'No dialog_analysis for outgoing message');
    return;
  }

  // Если бот уже на паузе - ничего не делаем
  if (lead.bot_paused) {
    app.log.debug({ instance, clientPhone, leadId: lead.id }, 'Bot already paused');
    return;
  }

  // Проверяем, это сообщение от бота или от оператора
  // Бот обновляет last_bot_message_at при отправке
  // Если last_bot_message_at было обновлено в последние 10 секунд - это бот
  const now = Date.now();
  const lastBotMessageAt = lead.last_bot_message_at
    ? new Date(lead.last_bot_message_at).getTime()
    : 0;
  const timeSinceLastBotMessage = now - lastBotMessageAt;

  // Если прошло меньше 10 секунд с последнего сообщения бота - это скорее всего бот
  if (timeSinceLastBotMessage < 10000) {
    app.log.debug({
      instance,
      clientPhone,
      timeSinceLastBotMessage,
      leadId: lead.id
    }, 'Outgoing message is likely from bot');
    return;
  }

  // Это сообщение от оператора! Получаем конфиг бота
  const botConfig = await getBotConfigForOperatorPause(instance);

  if (!botConfig) {
    app.log.debug({ instance }, 'No bot config for operator pause check');
    return;
  }

  if (!botConfig.operator_pause_enabled) {
    app.log.debug({
      instance,
      clientPhone,
      botId: botConfig.id
    }, 'Operator pause not enabled for this bot');
    return;
  }

  // Оператор вмешался и пауза включена - ставим бота на паузу
  app.log.info({
    instance,
    clientPhone,
    leadId: lead.id,
    botId: botConfig.id,
    operatorPauseHours: botConfig.operator_auto_resume_hours,
    operatorPauseMinutes: botConfig.operator_auto_resume_minutes
  }, 'Operator intervention detected, pausing bot');

  // Вычисляем время автоматического возобновления
  const pauseHours = botConfig.operator_auto_resume_hours || 0;
  const pauseMinutes = botConfig.operator_auto_resume_minutes || 0;
  const totalPauseMs = (pauseHours * 60 + pauseMinutes) * 60 * 1000;

  const updateData: Record<string, any> = { bot_paused: true };

  if (totalPauseMs > 0) {
    const pausedUntil = new Date(now + totalPauseMs);
    updateData.bot_paused_until = pausedUntil.toISOString();
    app.log.info({
      leadId: lead.id,
      pausedUntil: pausedUntil.toISOString()
    }, 'Bot paused with auto-resume time');
  }

  const { error: updateError } = await supabase
    .from('dialog_analysis')
    .update(updateData)
    .eq('id', lead.id);

  if (updateError) {
    app.log.error({
      error: updateError.message,
      leadId: lead.id
    }, 'Failed to pause bot after operator intervention');
  } else {
    app.log.info({
      leadId: lead.id,
      clientPhone,
      instance
    }, 'Bot paused due to operator intervention');
  }
}

/**
 * Получить конфиг бота для проверки operator_pause
 */
async function getBotConfigForOperatorPause(instanceName: string): Promise<{
  id: string;
  operator_pause_enabled: boolean;
  operator_auto_resume_hours: number;
  operator_auto_resume_minutes: number;
} | null> {
  // Получаем инстанс
  const { data: instanceData, error: instanceError } = await supabase
    .from('whatsapp_instances')
    .select('user_account_id')
    .eq('instance_name', instanceName)
    .single();

  if (instanceError || !instanceData) {
    return null;
  }

  // Ищем бота привязанного к инстансу через bot_instances или активного бота пользователя
  const { data: botInstance } = await supabase
    .from('bot_instances')
    .select(`
      ai_bots (
        id,
        config
      )
    `)
    .eq('instance_name', instanceName)
    .eq('is_active', true)
    .maybeSingle();

  if (botInstance?.ai_bots) {
    const bot = botInstance.ai_bots as any;
    const config = bot.config || {};
    return {
      id: bot.id,
      operator_pause_enabled: config.operator_pause_enabled ?? false,
      operator_auto_resume_hours: config.operator_auto_resume_hours ?? 0,
      operator_auto_resume_minutes: config.operator_auto_resume_minutes ?? 30
    };
  }

  // Fallback: ищем любого активного бота пользователя
  const { data: fallbackBot } = await supabase
    .from('ai_bots')
    .select('id, config')
    .eq('user_account_id', instanceData.user_account_id)
    .eq('is_active', true)
    .maybeSingle();

  if (fallbackBot) {
    const config = fallbackBot.config || {};
    return {
      id: fallbackBot.id,
      operator_pause_enabled: config.operator_pause_enabled ?? false,
      operator_auto_resume_hours: config.operator_auto_resume_hours ?? 0,
      operator_auto_resume_minutes: config.operator_auto_resume_minutes ?? 30
    };
  }

  return null;
}
