/**
 * AI Bot Engine - обработка сообщений с использованием настроек из конструктора
 * Использует таблицу ai_bot_configurations для получения настроек бота
 */

import { FastifyInstance } from 'fastify';
import { supabase } from './supabase.js';
import { redis } from './redis.js';
import OpenAI from 'openai';
import { sendWhatsAppMessage as sendMessage } from './evolutionApi.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'aiBotEngine' });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Типы для настроек бота из конструктора
export interface AIBotConfig {
  id: string;
  user_account_id: string;
  name: string;
  is_active: boolean;
  system_prompt: string;
  temperature: number;
  model: string;

  // История
  history_token_limit: number;
  history_message_limit: number | null;
  history_time_limit_hours: number | null;

  // Буфер
  message_buffer_seconds: number;

  // Оператор
  operator_pause_enabled: boolean;
  operator_pause_ignore_first_message: boolean;
  operator_auto_resume_hours: number;
  operator_auto_resume_minutes: number;
  operator_pause_exceptions: string[];

  // Фразы
  stop_phrases: string[];
  resume_phrases: string[];

  // Сообщения
  split_messages: boolean;
  split_max_length: number;
  clean_markdown: boolean;

  // Расписание
  schedule_enabled: boolean;
  schedule_hours_start: number;
  schedule_hours_end: number;
  schedule_days: number[];
  timezone: string;
  pass_current_datetime: boolean;

  // Голос/изображения/документы
  voice_recognition_enabled: boolean;
  voice_default_response: string;
  image_recognition_enabled: boolean;
  image_default_response: string;
  document_recognition_enabled: boolean;
  document_default_response: string;

  // Файлы
  file_handling_mode: 'ignore' | 'respond';
  file_default_response: string;

  // Прочее
  start_message: string;
  error_message: string;
  custom_openai_api_key: string | null;
}

export interface LeadInfo {
  id: string;
  user_account_id: string;
  instance_name: string;
  contact_phone: string;
  contact_name?: string;
  funnel_stage: string;
  interest_level?: string;
  business_type?: string;
  assigned_to_human?: boolean;
  bot_paused?: boolean;
  bot_paused_until?: string;
  messages?: any[];
}

/**
 * Получить конфигурацию бота для инстанса WhatsApp
 */
export async function getBotConfigForInstance(instanceName: string): Promise<AIBotConfig | null> {
  log.info({ instanceName }, '[getBotConfigForInstance] Starting bot config lookup');

  try {
    // Сначала получаем инстанс с привязанным ботом
    log.debug({ instanceName }, '[getBotConfigForInstance] Querying whatsapp_instances');
    const { data: instance, error: instanceError } = await supabase
      .from('whatsapp_instances')
      .select('ai_bot_id, user_account_id')
      .eq('instance_name', instanceName)
      .maybeSingle();

    if (instanceError) {
      log.error({ instanceName, error: instanceError.message, code: instanceError.code }, '[getBotConfigForInstance] DB error fetching instance');
      return null;
    }

    if (!instance) {
      log.warn({ instanceName }, '[getBotConfigForInstance] Instance not found in database');
      return null;
    }

    log.debug({
      instanceName,
      userAccountId: instance.user_account_id,
      aiBotId: instance.ai_bot_id
    }, '[getBotConfigForInstance] Instance found');

    // Если бот привязан - используем его
    if (instance.ai_bot_id) {
      log.debug({ botId: instance.ai_bot_id }, '[getBotConfigForInstance] Fetching linked bot config');
      const { data: bot, error: botError } = await supabase
        .from('ai_bot_configurations')
        .select('*')
        .eq('id', instance.ai_bot_id)
        .eq('is_active', true)
        .maybeSingle();

      if (botError) {
        log.error({ error: botError.message, code: botError.code, botId: instance.ai_bot_id }, '[getBotConfigForInstance] DB error fetching bot config');
        return null;
      }

      if (bot) {
        log.info({
          botId: bot.id,
          botName: bot.name,
          model: bot.model,
          temperature: bot.temperature,
          isActive: bot.is_active
        }, '[getBotConfigForInstance] Using linked bot');
        return bot;
      } else {
        log.warn({ botId: instance.ai_bot_id }, '[getBotConfigForInstance] Linked bot not found or inactive');
      }
    }

    // Если бот не привязан - ищем активного бота пользователя
    log.debug({ userAccountId: instance.user_account_id }, '[getBotConfigForInstance] No linked bot, searching for default active bot');
    const { data: defaultBot, error: defaultError } = await supabase
      .from('ai_bot_configurations')
      .select('*')
      .eq('user_account_id', instance.user_account_id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (defaultError) {
      log.error({ error: defaultError.message, code: defaultError.code }, '[getBotConfigForInstance] DB error fetching default bot');
      return null;
    }

    if (defaultBot) {
      log.info({
        botId: defaultBot.id,
        botName: defaultBot.name,
        model: defaultBot.model,
        temperature: defaultBot.temperature
      }, '[getBotConfigForInstance] Using default active bot');
      return defaultBot;
    }

    log.warn({ instanceName, userAccountId: instance.user_account_id }, '[getBotConfigForInstance] No active bot found for user');
    return null;
  } catch (error: any) {
    log.error({
      error: error.message,
      stack: error.stack,
      instanceName
    }, '[getBotConfigForInstance] Unexpected error');
    return null;
  }
}

/**
 * Проверить, должен ли бот отвечать с учётом настроек из конструктора
 */
export function shouldBotRespondWithConfig(
  lead: LeadInfo,
  botConfig: AIBotConfig,
  messageText?: string
): { shouldRespond: boolean; reason?: string } {
  log.info({
    leadId: lead.id,
    phone: lead.contact_phone,
    botId: botConfig.id,
    botName: botConfig.name,
    messageLength: messageText?.length || 0
  }, '[shouldBotRespondWithConfig] Checking if bot should respond');

  // 1. Бот не активен
  if (!botConfig.is_active) {
    log.debug({ botId: botConfig.id }, '[shouldBotRespondWithConfig] Bot is inactive');
    return { shouldRespond: false, reason: 'bot_inactive' };
  }

  // 2. Менеджер взял в работу
  if (lead.assigned_to_human) {
    log.debug({ leadId: lead.id }, '[shouldBotRespondWithConfig] Lead assigned to human');
    return { shouldRespond: false, reason: 'assigned_to_human' };
  }

  // 3. Бот на паузе
  if (lead.bot_paused) {
    log.debug({ leadId: lead.id, botPaused: true }, '[shouldBotRespondWithConfig] Bot is paused for this lead');
    // Проверить resume_phrases - если сообщение содержит фразу возобновления, снять паузу
    if (messageText && botConfig.resume_phrases?.length > 0) {
      const lowerMessage = messageText.toLowerCase();
      log.debug({
        resumePhrases: botConfig.resume_phrases,
        messagePreview: lowerMessage.substring(0, 100)
      }, '[shouldBotRespondWithConfig] Checking resume phrases');

      const shouldResume = botConfig.resume_phrases.some(phrase =>
        lowerMessage.includes(phrase.toLowerCase())
      );
      if (shouldResume) {
        log.info({ leadId: lead.id }, '[shouldBotRespondWithConfig] Resume phrase detected, will unpause');
        // Пауза будет снята в processIncomingMessage
        return { shouldRespond: true, reason: 'resume_phrase_detected' };
      }
    }
    return { shouldRespond: false, reason: 'bot_paused' };
  }

  // 4. Пауза с таймаутом
  if (lead.bot_paused_until) {
    const pausedUntil = new Date(lead.bot_paused_until);
    const now = new Date();
    log.debug({
      leadId: lead.id,
      pausedUntil: pausedUntil.toISOString(),
      now: now.toISOString(),
      isPaused: pausedUntil > now
    }, '[shouldBotRespondWithConfig] Checking temporary pause');

    if (pausedUntil > now) {
      return { shouldRespond: false, reason: 'bot_paused_temporarily' };
    }
  }

  // 5. Проверить stop_phrases - если сообщение содержит стоп-фразу, поставить на паузу
  if (messageText && botConfig.stop_phrases?.length > 0) {
    const lowerMessage = messageText.toLowerCase();
    log.debug({
      stopPhrases: botConfig.stop_phrases,
      messagePreview: lowerMessage.substring(0, 100)
    }, '[shouldBotRespondWithConfig] Checking stop phrases');

    const matchedPhrase = botConfig.stop_phrases.find(phrase =>
      lowerMessage.includes(phrase.toLowerCase())
    );
    if (matchedPhrase) {
      log.info({ leadId: lead.id, matchedPhrase }, '[shouldBotRespondWithConfig] Stop phrase detected');
      return { shouldRespond: false, reason: 'stop_phrase_detected' };
    }
  }

  // 6. Этапы воронки где бот молчит
  const silentStages = ['consultation_completed', 'deal_closed', 'deal_lost'];
  if (silentStages.includes(lead.funnel_stage)) {
    log.debug({ leadId: lead.id, funnelStage: lead.funnel_stage }, '[shouldBotRespondWithConfig] Lead in silent funnel stage');
    return { shouldRespond: false, reason: 'silent_stage' };
  }

  // 7. Проверка расписания
  if (botConfig.schedule_enabled) {
    log.debug({
      scheduleEnabled: true,
      hoursStart: botConfig.schedule_hours_start,
      hoursEnd: botConfig.schedule_hours_end,
      days: botConfig.schedule_days,
      timezone: botConfig.timezone
    }, '[shouldBotRespondWithConfig] Checking schedule');

    if (!isWithinSchedule(botConfig)) {
      log.debug({ botId: botConfig.id }, '[shouldBotRespondWithConfig] Outside of schedule');
      return { shouldRespond: false, reason: 'outside_schedule' };
    }
  }

  log.info({ leadId: lead.id, botId: botConfig.id }, '[shouldBotRespondWithConfig] Bot should respond');
  return { shouldRespond: true };
}

/**
 * Проверка расписания работы бота
 */
function isWithinSchedule(config: AIBotConfig): boolean {
  const now = new Date();
  const timezone = config.timezone || 'Asia/Yekaterinburg';

  log.debug({
    botId: config.id,
    timezone,
    nowUTC: now.toISOString()
  }, '[isWithinSchedule] Checking schedule');

  // Получить время в часовом поясе бота
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    hour: 'numeric',
    weekday: 'short'
  };

  const formatter = new Intl.DateTimeFormat('ru-RU', options);
  const parts = formatter.formatToParts(now);

  const hourPart = parts.find(p => p.type === 'hour');
  const dayPart = parts.find(p => p.type === 'weekday');

  const hour = hourPart ? parseInt(hourPart.value) : now.getHours();

  // Преобразовать день недели
  const dayMap: Record<string, number> = {
    'пн': 1, 'вт': 2, 'ср': 3, 'чт': 4, 'пт': 5, 'сб': 6, 'вс': 7
  };
  const dayValue = dayPart ? dayMap[dayPart.value.toLowerCase()] || now.getDay() : now.getDay();
  const day = dayValue === 0 ? 7 : dayValue; // Воскресенье = 7

  log.debug({
    localHour: hour,
    localDay: day,
    dayName: dayPart?.value,
    allowedDays: config.schedule_days,
    hoursStart: config.schedule_hours_start,
    hoursEnd: config.schedule_hours_end
  }, '[isWithinSchedule] Parsed local time');

  // Проверка дня недели
  if (!config.schedule_days.includes(day)) {
    log.debug({ day, allowedDays: config.schedule_days }, '[isWithinSchedule] Day not in schedule');
    return false;
  }

  // Проверка времени
  if (hour < config.schedule_hours_start || hour >= config.schedule_hours_end) {
    log.debug({
      hour,
      hoursStart: config.schedule_hours_start,
      hoursEnd: config.schedule_hours_end
    }, '[isWithinSchedule] Hour outside schedule');
    return false;
  }

  log.debug({ hour, day }, '[isWithinSchedule] Within schedule');
  return true;
}

/**
 * Склейка сообщений через Redis с настраиваемой задержкой
 */
export async function collectMessagesWithConfig(
  phone: string,
  instanceName: string,
  newMessage: string,
  botConfig: AIBotConfig,
  app: FastifyInstance
): Promise<void> {
  const bufferSeconds = botConfig.message_buffer_seconds || 7;
  const key = `pending_messages:${instanceName}:${phone}`;
  const timerId = `timer:${key}`;

  log.info({
    phone,
    instanceName,
    bufferSeconds,
    messageLength: newMessage.length,
    messagePreview: newMessage.substring(0, 100)
  }, '[collectMessagesWithConfig] Adding message to buffer');

  // Добавить сообщение в очередь
  const listLength = await redis.rpush(key, newMessage);
  await redis.expire(key, bufferSeconds + 5);

  log.debug({
    phone,
    key,
    listLength,
    expireSeconds: bufferSeconds + 5
  }, '[collectMessagesWithConfig] Message added to Redis list');

  // Проверить, есть ли уже таймер
  const exists = await redis.exists(timerId);

  if (!exists) {
    log.debug({
      phone,
      timerId,
      bufferSeconds
    }, '[collectMessagesWithConfig] Creating new timer, will process in N seconds');

    await redis.set(timerId, '1', 'EX', bufferSeconds);

    // Через N секунд обработать все сообщения
    setTimeout(async () => {
      log.info({ phone, instanceName, timerId }, '[collectMessagesWithConfig] Timer fired, processing buffered messages');

      try {
        const messages = await redis.lrange(key, 0, -1);
        await redis.del(key, timerId);

        log.debug({
          phone,
          messageCount: messages.length,
          messagesPreview: messages.map(m => m.substring(0, 50))
        }, '[collectMessagesWithConfig] Retrieved messages from buffer');

        if (messages.length > 0) {
          const combined = messages.join('\n');
          log.info({
            phone,
            instanceName,
            combinedLength: combined.length,
            messageCount: messages.length
          }, '[collectMessagesWithConfig] Sending combined message to processAIBotResponse');

          await processAIBotResponse(phone, instanceName, combined, botConfig, app);
        } else {
          log.warn({ phone, key }, '[collectMessagesWithConfig] No messages in buffer after timer');
        }
      } catch (error: any) {
        log.error({
          error: error.message,
          stack: error.stack,
          phone,
          instanceName
        }, '[collectMessagesWithConfig] Error processing collected messages');
      }
    }, bufferSeconds * 1000);
  } else {
    log.debug({
      phone,
      timerId
    }, '[collectMessagesWithConfig] Timer already exists, message added to existing buffer');
  }
}

/**
 * Основная функция генерации и отправки ответа бота
 */
async function processAIBotResponse(
  phone: string,
  instanceName: string,
  messageText: string,
  botConfig: AIBotConfig,
  app: FastifyInstance
): Promise<void> {
  const startTime = Date.now();

  log.info({
    phone,
    instanceName,
    botId: botConfig.id,
    botName: botConfig.name,
    messageLength: messageText.length,
    messagePreview: messageText.substring(0, 150)
  }, '[processAIBotResponse] Starting to process message');

  try {
    // Получить информацию о лиде
    log.debug({ phone, instanceName }, '[processAIBotResponse] Fetching lead from database');
    const { data: lead, error: leadError } = await supabase
      .from('dialog_analysis')
      .select('*')
      .eq('contact_phone', phone)
      .eq('instance_name', instanceName)
      .maybeSingle();

    if (leadError) {
      log.error({
        error: leadError.message,
        code: leadError.code,
        phone,
        instanceName
      }, '[processAIBotResponse] Error fetching lead');
      return;
    }

    if (!lead) {
      log.warn({ phone, instanceName }, '[processAIBotResponse] Lead not found');
      return;
    }

    log.debug({
      leadId: lead.id,
      contactName: lead.contact_name,
      funnelStage: lead.funnel_stage,
      interestLevel: lead.interest_level,
      botPaused: lead.bot_paused,
      assignedToHuman: lead.assigned_to_human
    }, '[processAIBotResponse] Lead found');

    // Проверить условия ответа
    const { shouldRespond, reason } = shouldBotRespondWithConfig(lead, botConfig, messageText);
    if (!shouldRespond) {
      // Если обнаружена стоп-фраза, поставить бота на паузу
      if (reason === 'stop_phrase_detected') {
        log.info({ leadId: lead.id }, '[processAIBotResponse] Pausing bot due to stop phrase');
        await supabase
          .from('dialog_analysis')
          .update({ bot_paused: true })
          .eq('id', lead.id);
      }
      log.info({
        phone,
        leadId: lead.id,
        reason,
        elapsed: Date.now() - startTime
      }, '[processAIBotResponse] Bot should not respond, exiting');
      return;
    }

    // Если обнаружена фраза возобновления, снять паузу
    if (reason === 'resume_phrase_detected') {
      log.info({ leadId: lead.id }, '[processAIBotResponse] Resuming bot due to resume phrase');
      await supabase
        .from('dialog_analysis')
        .update({ bot_paused: false, bot_paused_until: null })
        .eq('id', lead.id);
    }

    // Создать клиент OpenAI (свой ключ или дефолтный)
    const apiKey = botConfig.custom_openai_api_key || OPENAI_API_KEY;
    if (!apiKey) {
      log.error({ botId: botConfig.id }, '[processAIBotResponse] No OpenAI API key configured');
      return;
    }

    log.debug({
      hasCustomKey: !!botConfig.custom_openai_api_key,
      model: botConfig.model,
      temperature: botConfig.temperature
    }, '[processAIBotResponse] Initializing OpenAI client');

    const openai = new OpenAI({ apiKey });

    // Генерировать ответ
    log.info({ leadId: lead.id, botId: botConfig.id }, '[processAIBotResponse] Calling generateAIResponse');
    const aiStartTime = Date.now();
    const response = await generateAIResponse(lead, messageText, botConfig, openai);
    const aiElapsed = Date.now() - aiStartTime;

    log.info({
      leadId: lead.id,
      hasText: !!response.text,
      textLength: response.text?.length || 0,
      hasFunctionCall: !!response.functionCall,
      moveToStage: response.moveToStage,
      needsHuman: response.needsHuman,
      aiElapsedMs: aiElapsed
    }, '[processAIBotResponse] AI response generated');

    if (!response.text) {
      log.warn({ phone, leadId: lead.id }, '[processAIBotResponse] No response text generated');
      return;
    }

    // Очистить markdown если нужно
    let finalText = response.text;
    if (botConfig.clean_markdown) {
      const beforeLength = finalText.length;
      finalText = cleanMarkdown(finalText);
      log.debug({
        beforeLength,
        afterLength: finalText.length,
        cleaned: beforeLength - finalText.length
      }, '[processAIBotResponse] Markdown cleaned');
    }

    // Разбить на части если нужно
    let chunks: string[];
    if (botConfig.split_messages) {
      chunks = splitMessage(finalText, botConfig.split_max_length);
      log.debug({
        splitEnabled: true,
        maxLength: botConfig.split_max_length,
        chunksCount: chunks.length,
        chunkLengths: chunks.map(c => c.length)
      }, '[processAIBotResponse] Message split into chunks');
    } else {
      chunks = [finalText];
    }

    // Отправить сообщения
    log.info({
      phone,
      instanceName,
      chunksCount: chunks.length,
      totalLength: finalText.length
    }, '[processAIBotResponse] Sending messages via Evolution API');

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      log.debug({
        chunkIndex: i + 1,
        totalChunks: chunks.length,
        chunkLength: chunk.length,
        chunkPreview: chunk.substring(0, 100)
      }, '[processAIBotResponse] Sending chunk');

      await sendMessage({
        instanceName,
        phone,
        message: chunk
      });

      if (chunks.length > 1 && i < chunks.length - 1) {
        log.debug({ delayMs: 2000 }, '[processAIBotResponse] Waiting between chunks');
        await delay(2000); // 2 сек между частями
      }
    }

    // Обновить этап воронки если нужно
    if (response.moveToStage) {
      log.info({
        leadId: lead.id,
        oldStage: lead.funnel_stage,
        newStage: response.moveToStage
      }, '[processAIBotResponse] Moving lead to new funnel stage');

      await supabase
        .from('dialog_analysis')
        .update({ funnel_stage: response.moveToStage })
        .eq('id', lead.id);
    }

    // Если нужен менеджер
    if (response.needsHuman) {
      log.info({ leadId: lead.id }, '[processAIBotResponse] Transferring lead to human');

      await supabase
        .from('dialog_analysis')
        .update({ assigned_to_human: true, bot_paused: true })
        .eq('id', lead.id);
    }

    // Выполнить функцию если указана
    if (response.functionCall) {
      log.info({
        leadId: lead.id,
        functionName: response.functionCall.name,
        arguments: response.functionCall.arguments
      }, '[processAIBotResponse] Executing function call');

      await handleFunctionCall(response.functionCall, lead, botConfig, app);
    }

    // Обновить время последнего сообщения
    await supabase
      .from('dialog_analysis')
      .update({ last_bot_message_at: new Date().toISOString() })
      .eq('id', lead.id);

    const totalElapsed = Date.now() - startTime;
    log.info({
      phone,
      leadId: lead.id,
      responseLength: finalText.length,
      chunksCount: chunks.length,
      aiElapsedMs: aiElapsed,
      totalElapsedMs: totalElapsed
    }, '[processAIBotResponse] Bot response sent successfully');

  } catch (error: any) {
    log.error({
      error: error.message,
      stack: error.stack,
      phone,
      instanceName,
      botId: botConfig.id,
      elapsed: Date.now() - startTime
    }, '[processAIBotResponse] Error processing message');

    // Отправить сообщение об ошибке если настроено
    if (botConfig.error_message) {
      log.debug({
        errorMessage: botConfig.error_message.substring(0, 100)
      }, '[processAIBotResponse] Sending error message to user');

      try {
        await sendMessage({
          instanceName,
          phone,
          message: botConfig.error_message
        });
      } catch (e) {
        log.error({
          error: (e as any).message
        }, '[processAIBotResponse] Failed to send error message');
      }
    }
  }
}

/**
 * Загрузить историю сообщений из базы данных
 * Сообщения хранятся в JSONB поле 'messages' таблицы dialog_analysis
 */
async function loadMessageHistory(
  leadId: string,
  config: AIBotConfig
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  log.debug({
    leadId,
    historyTokenLimit: config.history_token_limit,
    historyMessageLimit: config.history_message_limit,
    historyTimeLimitHours: config.history_time_limit_hours
  }, '[loadMessageHistory] Starting to load message history');

  try {
    // Получить messages из dialog_analysis
    log.debug({ leadId }, '[loadMessageHistory] Fetching messages from dialog_analysis');
    const { data: lead, error } = await supabase
      .from('dialog_analysis')
      .select('messages')
      .eq('id', leadId)
      .single();

    if (error) {
      log.warn({
        leadId,
        error: error.message,
        code: error.code
      }, '[loadMessageHistory] Error fetching messages from database');
      return [];
    }

    if (!lead?.messages) {
      log.debug({ leadId }, '[loadMessageHistory] No message history found in database');
      return [];
    }

    // messages - это JSONB массив [{sender, content, timestamp}, ...]
    const rawMessages = Array.isArray(lead.messages) ? lead.messages : [];
    log.debug({
      leadId,
      rawMessageCount: rawMessages.length
    }, '[loadMessageHistory] Raw messages loaded from JSONB');

    // Фильтровать по времени если задано
    const now = new Date();
    let filteredMessages = rawMessages;

    if (config.history_time_limit_hours) {
      const cutoff = new Date(now.getTime() - config.history_time_limit_hours * 60 * 60 * 1000);
      const beforeCount = filteredMessages.length;
      filteredMessages = rawMessages.filter((msg: any) => {
        const msgTime = new Date(msg.timestamp || msg.created_at || 0);
        return msgTime >= cutoff;
      });
      log.debug({
        leadId,
        timeLimitHours: config.history_time_limit_hours,
        cutoffTime: cutoff.toISOString(),
        beforeCount,
        afterCount: filteredMessages.length,
        filtered: beforeCount - filteredMessages.length
      }, '[loadMessageHistory] Applied time filter');
    }

    // Ограничить количество сообщений (берём последние N)
    if (config.history_message_limit && filteredMessages.length > config.history_message_limit) {
      const beforeCount = filteredMessages.length;
      filteredMessages = filteredMessages.slice(-config.history_message_limit);
      log.debug({
        leadId,
        messageLimit: config.history_message_limit,
        beforeCount,
        afterCount: filteredMessages.length
      }, '[loadMessageHistory] Applied message limit');
    }

    // Преобразовать в формат OpenAI с учётом токен-лимита
    let totalTokens = 0;
    const tokenLimit = config.history_token_limit || 10000;

    // Идём с конца (новые сообщения важнее) и добавляем пока не превысим лимит
    const reversedMessages = [...filteredMessages].reverse();
    const history: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    let skippedDueToTokens = 0;

    for (const msg of reversedMessages) {
      const content = msg.content || msg.text || '';
      const estimatedTokens = Math.ceil(content.length / 4);

      if (totalTokens + estimatedTokens > tokenLimit) {
        skippedDueToTokens++;
        continue;
      }

      // Определить роль: bot/assistant = assistant, остальное = user
      const sender = (msg.sender || msg.from || 'user').toLowerCase();
      const role = (sender === 'bot' || sender === 'assistant') ? 'assistant' : 'user';

      history.unshift({
        role,
        content
      });

      totalTokens += estimatedTokens;
    }

    log.info({
      leadId,
      rawMessages: rawMessages.length,
      afterFilters: filteredMessages.length,
      finalCount: history.length,
      estimatedTokens: totalTokens,
      tokenLimit,
      skippedDueToTokens
    }, '[loadMessageHistory] Message history loaded successfully');

    return history;
  } catch (error: any) {
    log.error({
      error: error.message,
      stack: error.stack,
      leadId
    }, '[loadMessageHistory] Unexpected error loading message history');
    return [];
  }
}

/**
 * Генерация ответа через OpenAI
 */
async function generateAIResponse(
  lead: LeadInfo,
  messageText: string,
  config: AIBotConfig,
  openai: OpenAI
): Promise<{
  text: string;
  moveToStage?: string;
  needsHuman?: boolean;
  functionCall?: { name: string; arguments: any };
}> {
  const startTime = Date.now();

  log.info({
    leadId: lead.id,
    botId: config.id,
    model: config.model,
    temperature: config.temperature,
    messageLength: messageText.length
  }, '[generateAIResponse] Starting AI response generation');

  // Получить функции бота
  log.debug({ botId: config.id }, '[generateAIResponse] Fetching bot functions');
  const { data: functions, error: functionsError } = await supabase
    .from('ai_bot_functions')
    .select('*')
    .eq('bot_id', config.id)
    .eq('is_active', true);

  if (functionsError) {
    log.warn({
      error: functionsError.message,
      botId: config.id
    }, '[generateAIResponse] Error fetching bot functions');
  }

  log.debug({
    functionCount: functions?.length || 0,
    functionNames: functions?.map(f => f.name) || []
  }, '[generateAIResponse] Bot functions loaded');

  // Построить системный промпт
  let systemPrompt = config.system_prompt || 'Ты — AI-ассистент.';
  log.debug({
    systemPromptLength: systemPrompt.length,
    systemPromptPreview: systemPrompt.substring(0, 200)
  }, '[generateAIResponse] Base system prompt');

  // Добавить текущую дату/время если включено
  if (config.pass_current_datetime) {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('ru-RU', {
      timeZone: config.timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    const formattedDate = formatter.format(now);
    systemPrompt += `\n\nТекущая дата и время: ${formattedDate}`;
    log.debug({
      timezone: config.timezone,
      formattedDate
    }, '[generateAIResponse] Added datetime to prompt');
  }

  // Добавить информацию о клиенте
  const clientInfo = `
Информация о клиенте:
- Имя: ${lead.contact_name || 'неизвестно'}
- Телефон: ${lead.contact_phone}
- Тип бизнеса: ${lead.business_type || 'неизвестно'}
- Уровень интереса: ${lead.interest_level || 'неизвестно'}
- Этап воронки: ${lead.funnel_stage}`;

  log.debug({
    clientName: lead.contact_name,
    clientPhone: lead.contact_phone,
    businessType: lead.business_type,
    interestLevel: lead.interest_level,
    funnelStage: lead.funnel_stage
  }, '[generateAIResponse] Client info added to prompt');

  // Подготовить tools для OpenAI
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];

  if (functions && functions.length > 0) {
    for (const func of functions) {
      tools.push({
        type: 'function',
        function: {
          name: func.name,
          description: func.description,
          parameters: func.parameters || { type: 'object', properties: {} }
        }
      });
    }
    log.debug({
      toolsCount: tools.length,
      toolNames: tools.map(t => t.function.name)
    }, '[generateAIResponse] Prepared OpenAI tools');
  }

  // Маппинг моделей
  const modelMap: Record<string, string> = {
    'gpt-5.2': 'gpt-4o',
    'gpt-5.1': 'gpt-4o',
    'gpt-5': 'gpt-4o',
    'gpt-5-mini': 'gpt-4o-mini',
    'gpt-5-nano': 'gpt-4o-mini',
    'gpt-4.1': 'gpt-4o',
    'gpt-4.1-mini': 'gpt-4o-mini',
    'gpt-4.1-nano': 'gpt-4o-mini',
    'gpt-4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4o-mini',
    'gpt-o3': 'gpt-4o'
  };

  const model = modelMap[config.model] || 'gpt-4o-mini';
  log.debug({
    configModel: config.model,
    mappedModel: model
  }, '[generateAIResponse] Model mapping');

  try {
    // Загрузить историю сообщений
    log.debug({ leadId: lead.id }, '[generateAIResponse] Loading message history');
    const history = await loadMessageHistory(lead.id, config);

    // Собрать массив сообщений: system + history + текущее
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt + clientInfo },
      ...history,
      { role: 'user', content: messageText }
    ];

    log.debug({
      totalMessages: messages.length,
      systemPromptLength: (systemPrompt + clientInfo).length,
      historyLength: history.length,
      userMessageLength: messageText.length
    }, '[generateAIResponse] Messages array prepared');

    const completionParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages,
      temperature: config.temperature,
      max_tokens: 1000
    };

    if (tools.length > 0) {
      completionParams.tools = tools;
      completionParams.tool_choice = 'auto';
    }

    log.info({
      model,
      temperature: config.temperature,
      maxTokens: 1000,
      messagesCount: messages.length,
      toolsCount: tools.length
    }, '[generateAIResponse] Calling OpenAI API');

    const apiStartTime = Date.now();
    const completion = await openai.chat.completions.create(completionParams);
    const apiElapsed = Date.now() - apiStartTime;

    const choice = completion.choices[0];

    log.info({
      apiElapsedMs: apiElapsed,
      finishReason: choice.finish_reason,
      hasContent: !!choice.message.content,
      contentLength: choice.message.content?.length || 0,
      hasToolCalls: !!choice.message.tool_calls?.length,
      toolCallsCount: choice.message.tool_calls?.length || 0,
      promptTokens: completion.usage?.prompt_tokens,
      completionTokens: completion.usage?.completion_tokens,
      totalTokens: completion.usage?.total_tokens
    }, '[generateAIResponse] OpenAI API response received');

    // Проверить вызов функции
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      const toolCall = choice.message.tool_calls[0];
      log.info({
        functionName: toolCall.function.name,
        argumentsRaw: toolCall.function.arguments,
        contentWithCall: choice.message.content?.substring(0, 100)
      }, '[generateAIResponse] Function call detected');

      const totalElapsed = Date.now() - startTime;
      log.info({ totalElapsedMs: totalElapsed }, '[generateAIResponse] Completed with function call');

      return {
        text: choice.message.content || '',
        functionCall: {
          name: toolCall.function.name,
          arguments: JSON.parse(toolCall.function.arguments || '{}')
        }
      };
    }

    const totalElapsed = Date.now() - startTime;
    log.info({
      responseLength: choice.message.content?.length || 0,
      responsePreview: choice.message.content?.substring(0, 150),
      totalElapsedMs: totalElapsed
    }, '[generateAIResponse] Completed with text response');

    return {
      text: choice.message.content || ''
    };

  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    log.error({
      error: error.message,
      stack: error.stack,
      errorCode: error.code,
      errorStatus: error.status,
      leadId: lead.id,
      model,
      elapsedMs: elapsed
    }, '[generateAIResponse] Error calling OpenAI');
    return { text: '' };
  }
}

/**
 * Обработка вызова функции бота
 */
async function handleFunctionCall(
  functionCall: { name: string; arguments: any },
  lead: LeadInfo,
  botConfig: AIBotConfig,
  app: FastifyInstance
): Promise<void> {
  const startTime = Date.now();

  log.info({
    functionName: functionCall.name,
    arguments: functionCall.arguments,
    leadId: lead.id,
    botId: botConfig.id
  }, '[handleFunctionCall] Starting function execution');

  try {
    // Получить конфигурацию функции
    log.debug({
      botId: botConfig.id,
      functionName: functionCall.name
    }, '[handleFunctionCall] Fetching function config from database');

    const { data: func, error: funcError } = await supabase
      .from('ai_bot_functions')
      .select('*')
      .eq('bot_id', botConfig.id)
      .eq('name', functionCall.name)
      .eq('is_active', true)
      .maybeSingle();

    if (funcError) {
      log.error({
        error: funcError.message,
        code: funcError.code,
        functionName: functionCall.name
      }, '[handleFunctionCall] Error fetching function config');
      return;
    }

    if (!func) {
      log.warn({
        functionName: functionCall.name,
        botId: botConfig.id
      }, '[handleFunctionCall] Function not found or inactive');
      return;
    }

    log.debug({
      functionId: func.id,
      functionName: func.name,
      handlerType: func.handler_type,
      handlerConfig: func.handler_config
    }, '[handleFunctionCall] Function config loaded');

    switch (func.handler_type) {
      case 'forward_to_manager':
        log.info({
          leadId: lead.id,
          phone: lead.contact_phone
        }, '[handleFunctionCall] Forwarding lead to manager');

        // Передать менеджеру
        const { error: forwardError } = await supabase
          .from('dialog_analysis')
          .update({ assigned_to_human: true, bot_paused: true })
          .eq('id', lead.id);

        if (forwardError) {
          log.error({
            error: forwardError.message,
            leadId: lead.id
          }, '[handleFunctionCall] Error updating lead for manager forward');
        } else {
          log.info({
            leadId: lead.id,
            elapsed: Date.now() - startTime
          }, '[handleFunctionCall] Successfully forwarded to manager');
        }
        break;

      case 'internal':
        log.debug({
          functionName: functionCall.name,
          arguments: functionCall.arguments
        }, '[handleFunctionCall] Processing internal function');

        // Внутренняя обработка
        if (functionCall.name === 'save_user_data') {
          log.info({
            leadId: lead.id,
            dataToSave: functionCall.arguments
          }, '[handleFunctionCall] Saving user data');

          const { error: saveError } = await supabase
            .from('dialog_analysis')
            .update(functionCall.arguments)
            .eq('id', lead.id);

          if (saveError) {
            log.error({
              error: saveError.message,
              leadId: lead.id
            }, '[handleFunctionCall] Error saving user data');
          } else {
            log.info({
              leadId: lead.id,
              savedFields: Object.keys(functionCall.arguments),
              elapsed: Date.now() - startTime
            }, '[handleFunctionCall] User data saved successfully');
          }
        } else {
          log.warn({
            functionName: functionCall.name
          }, '[handleFunctionCall] Unknown internal function');
        }
        break;

      case 'webhook':
        // Вызов внешнего webhook
        if (func.handler_config?.url) {
          const webhookUrl = func.handler_config.url;
          const webhookPayload = {
            function: functionCall.name,
            arguments: functionCall.arguments,
            lead: {
              id: lead.id,
              phone: lead.contact_phone,
              name: lead.contact_name
            }
          };

          log.info({
            webhookUrl,
            payloadSize: JSON.stringify(webhookPayload).length
          }, '[handleFunctionCall] Calling external webhook');

          try {
            const webhookStartTime = Date.now();
            const response = await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(webhookPayload)
            });

            const webhookElapsed = Date.now() - webhookStartTime;

            log.info({
              webhookUrl,
              status: response.status,
              statusText: response.statusText,
              webhookElapsedMs: webhookElapsed,
              totalElapsedMs: Date.now() - startTime
            }, '[handleFunctionCall] Webhook called successfully');
          } catch (e) {
            log.error({
              error: (e as any).message,
              webhookUrl,
              functionName: functionCall.name
            }, '[handleFunctionCall] Webhook call failed');
          }
        } else {
          log.warn({
            functionName: functionCall.name,
            handlerConfig: func.handler_config
          }, '[handleFunctionCall] Webhook URL not configured');
        }
        break;

      default:
        log.warn({
          handlerType: func.handler_type,
          functionName: functionCall.name
        }, '[handleFunctionCall] Unknown handler type');
    }

    log.info({
      functionName: functionCall.name,
      handlerType: func.handler_type,
      elapsed: Date.now() - startTime
    }, '[handleFunctionCall] Function execution completed');

  } catch (error: any) {
    log.error({
      error: error.message,
      stack: error.stack,
      functionName: functionCall.name,
      leadId: lead.id,
      elapsed: Date.now() - startTime
    }, '[handleFunctionCall] Unexpected error handling function call');
  }
}

/**
 * Очистка markdown разметки
 */
function cleanMarkdown(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/_/g, '')
    .replace(/`/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

/**
 * Разбиение длинного сообщения на части
 */
function splitMessage(text: string, maxLength: number = 500): string[] {
  if (text.length <= maxLength) return [text];

  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).length > maxLength) {
      if (current) chunks.push(current.trim());
      current = sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }

  if (current) chunks.push(current.trim());
  return chunks;
}

/**
 * Утилита для задержки
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Главная точка входа - обработка входящего сообщения
 */
export async function processIncomingMessage(
  phone: string,
  instanceName: string,
  messageText: string,
  messageType: 'text' | 'image' | 'audio' | 'document' | 'file',
  app: FastifyInstance
): Promise<{ processed: boolean; reason?: string }> {
  const startTime = Date.now();

  log.info({
    phone,
    instanceName,
    messageType,
    messageLength: messageText?.length || 0,
    messagePreview: messageText?.substring(0, 100) || '[empty]'
  }, '[processIncomingMessage] === NEW INCOMING MESSAGE ===');

  try {
    // Получить конфигурацию бота для этого инстанса
    log.debug({ instanceName }, '[processIncomingMessage] Fetching bot configuration');
    const botConfig = await getBotConfigForInstance(instanceName);

    if (!botConfig) {
      log.warn({
        instanceName,
        elapsed: Date.now() - startTime
      }, '[processIncomingMessage] No bot config found, message will not be processed');
      return { processed: false, reason: 'no_bot_config' };
    }

    log.info({
      botId: botConfig.id,
      botName: botConfig.name,
      model: botConfig.model,
      isActive: botConfig.is_active
    }, '[processIncomingMessage] Bot config loaded');

    // Получить информацию о лиде
    log.debug({ phone, instanceName }, '[processIncomingMessage] Fetching lead info');
    const { data: lead, error: leadError } = await supabase
      .from('dialog_analysis')
      .select('*')
      .eq('contact_phone', phone)
      .eq('instance_name', instanceName)
      .maybeSingle();

    if (leadError) {
      log.error({
        error: leadError.message,
        code: leadError.code,
        phone,
        instanceName
      }, '[processIncomingMessage] Error fetching lead');
      return { processed: false, reason: 'lead_fetch_error' };
    }

    if (!lead) {
      log.warn({
        phone,
        instanceName,
        elapsed: Date.now() - startTime
      }, '[processIncomingMessage] Lead not found in dialog_analysis');
      return { processed: false, reason: 'lead_not_found' };
    }

    log.debug({
      leadId: lead.id,
      contactName: lead.contact_name,
      funnelStage: lead.funnel_stage,
      botPaused: lead.bot_paused,
      assignedToHuman: lead.assigned_to_human
    }, '[processIncomingMessage] Lead info loaded');

    // Проверить, должен ли бот ответить
    log.debug({ leadId: lead.id }, '[processIncomingMessage] Checking if bot should respond');
    const { shouldRespond, reason } = shouldBotRespondWithConfig(lead, botConfig);
    if (!shouldRespond) {
      log.info({
        leadId: lead.id,
        reason,
        elapsed: Date.now() - startTime
      }, '[processIncomingMessage] Bot should not respond');
      return { processed: false, reason };
    }

    // Обработка разных типов сообщений
    let textToProcess = messageText;

    log.debug({
      messageType,
      hasText: !!messageText,
      textLength: messageText?.length || 0
    }, '[processIncomingMessage] Processing message by type');

    switch (messageType) {
      case 'audio':
        log.debug({
          voiceRecognitionEnabled: botConfig.voice_recognition_enabled
        }, '[processIncomingMessage] Processing audio message');

        if (!botConfig.voice_recognition_enabled) {
          log.info({
            leadId: lead.id,
            hasDefaultResponse: !!botConfig.voice_default_response
          }, '[processIncomingMessage] Voice recognition disabled, sending default response');

          // Распознавание выключено - отправить дефолтный ответ
          if (botConfig.voice_default_response) {
            await sendMessage({
              instanceName,
              phone,
              message: botConfig.voice_default_response
            });
          }
          return { processed: true, reason: 'voice_not_supported' };
        }
        // TODO: Добавить транскрипцию через Whisper
        // Пока что обрабатываем как текст (messageText может содержать транскрипцию от Evolution API)
        if (!messageText || messageText.trim() === '') {
          log.warn({ leadId: lead.id }, '[processIncomingMessage] Empty audio message (no transcription)');
          return { processed: false, reason: 'empty_audio_message' };
        }
        log.debug({
          transcriptionLength: messageText.length
        }, '[processIncomingMessage] Audio has transcription, processing as text');
        break;

      case 'image':
        log.debug({
          imageRecognitionEnabled: botConfig.image_recognition_enabled
        }, '[processIncomingMessage] Processing image message');

        if (!botConfig.image_recognition_enabled) {
          log.info({
            leadId: lead.id,
            hasDefaultResponse: !!botConfig.image_default_response
          }, '[processIncomingMessage] Image recognition disabled, sending default response');

          // Распознавание выключено - отправить дефолтный ответ
          if (botConfig.image_default_response) {
            await sendMessage({
              instanceName,
              phone,
              message: botConfig.image_default_response
            });
          }
          return { processed: true, reason: 'image_not_supported' };
        }
        // TODO: Добавить обработку изображений через Vision
        // Пока что если есть caption - обработаем его
        if (!messageText || messageText.trim() === '') {
          log.warn({ leadId: lead.id }, '[processIncomingMessage] Empty image message (no caption)');
          return { processed: false, reason: 'empty_image_message' };
        }
        log.debug({
          captionLength: messageText.length
        }, '[processIncomingMessage] Image has caption, processing as text');
        break;

      case 'document':
        log.debug({
          documentRecognitionEnabled: botConfig.document_recognition_enabled
        }, '[processIncomingMessage] Processing document message');

        if (!botConfig.document_recognition_enabled) {
          log.info({
            leadId: lead.id,
            hasDefaultResponse: !!botConfig.document_default_response
          }, '[processIncomingMessage] Document recognition disabled, sending default response');

          // Распознавание выключено - отправить дефолтный ответ
          if (botConfig.document_default_response) {
            await sendMessage({
              instanceName,
              phone,
              message: botConfig.document_default_response
            });
          }
          return { processed: true, reason: 'document_not_supported' };
        }
        // Пока что если есть caption - обработаем его
        if (!messageText || messageText.trim() === '') {
          log.warn({ leadId: lead.id }, '[processIncomingMessage] Empty document message (no caption)');
          return { processed: false, reason: 'empty_document_message' };
        }
        log.debug({
          captionLength: messageText.length
        }, '[processIncomingMessage] Document has caption, processing as text');
        break;

      case 'file':
        log.debug({
          fileHandlingMode: botConfig.file_handling_mode
        }, '[processIncomingMessage] Processing file message');

        if (botConfig.file_handling_mode === 'respond') {
          log.info({
            leadId: lead.id,
            hasDefaultResponse: !!botConfig.file_default_response
          }, '[processIncomingMessage] File handling mode is respond');

          if (botConfig.file_default_response) {
            await sendMessage({
              instanceName,
              phone,
              message: botConfig.file_default_response
            });
          }
          return { processed: true, reason: 'file_responded' };
        }
        // file_handling_mode === 'ignore'
        log.info({ leadId: lead.id }, '[processIncomingMessage] File ignored per config');
        return { processed: false, reason: 'file_ignored' };

      case 'text':
      default:
        // Проверить что текст не пустой
        if (!messageText || messageText.trim() === '') {
          log.warn({
            leadId: lead.id,
            messageType
          }, '[processIncomingMessage] Empty text message');
          return { processed: false, reason: 'empty_message' };
        }
        log.debug({
          textLength: messageText.length
        }, '[processIncomingMessage] Text message validated');
        break;
    }

    // Склеить сообщения с настраиваемым буфером
    log.info({
      phone,
      instanceName,
      textLength: textToProcess.length,
      bufferSeconds: botConfig.message_buffer_seconds
    }, '[processIncomingMessage] Adding to message buffer');

    await collectMessagesWithConfig(phone, instanceName, textToProcess, botConfig, app);

    const elapsed = Date.now() - startTime;
    log.info({
      phone,
      instanceName,
      leadId: lead.id,
      messageType,
      elapsedMs: elapsed
    }, '[processIncomingMessage] Message queued for processing successfully');

    return { processed: true };
  } catch (error: any) {
    log.error({
      error: error.message,
      stack: error.stack,
      phone,
      instanceName,
      messageType,
      elapsed: Date.now() - startTime
    }, '[processIncomingMessage] Unexpected error processing message');
    return { processed: false, reason: 'error' };
  }
}
