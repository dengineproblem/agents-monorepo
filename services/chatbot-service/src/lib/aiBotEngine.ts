/**
 * AI Bot Engine - обработка сообщений с использованием настроек из конструктора
 * Использует таблицу ai_bot_configurations для получения настроек бота
 *
 * Features:
 * - Correlation ID для трассировки запросов через все этапы
 * - Маскирование чувствительных данных (телефоны, API ключи, UUID)
 * - Структурированные теги для фильтрации логов
 * - Метрики производительности с checkpoints
 * - Классификация ошибок с retry hints
 * - Rate limiting для защиты от спама
 * - Duplicate detection для предотвращения повторной обработки
 * - Retry логика для transient errors
 * - Подсчёт стоимости API вызовов
 * - Сохранение ответов бота в историю
 */

// Using 'any' for FastifyInstance to avoid type conflicts with custom pino logger
type FastifyApp = any;
import { supabase } from './supabase.js';
import { redis } from './redis.js';
import OpenAI from 'openai';
import { sendWhatsAppMessage as sendMessage, sendPresence } from './evolutionApi.js';
import { createLogger } from './logger.js';
import {
  createContextLogger,
  ContextLogger,
  RequestContext,
  maskPhone,
  maskApiKey,
  maskUuid,
  truncateText,
  logDbOperation,
  logWebhookCall,
  logIncomingMessage,
  logOutgoingMessage,
  LogTag,
  // Новые утилиты
  withRetry,
  DEFAULT_RETRY_CONFIG,
  checkRateLimit,
  RateLimitConfig,
  logOpenAiCall,
  logOpenAiCallWithCost,
  validateMessage,
  isDuplicateMessage,
  logStageTransition,
  logProcessingSummary,
  ProcessingStage,
  safeJsonParse,
  LIMITS
} from './logUtils.js';
import {
  ConsultationIntegrationSettings,
  getConsultationToolDefinitions,
  getConsultationPromptAddition,
  isConsultationTool,
  handleConsultationTool
} from './consultationTools.js';
import {
  getCapiToolDefinitions,
  isCapiTool,
  handleCapiTool
} from './capiTools.js';
import {
  getLeadManagementToolDefinitions,
  isLeadManagementTool,
  handleLeadManagementTool
} from './leadManagementTools.js';
import {
  getBotControlToolDefinitions,
  isBotControlTool,
  handleBotControlTool
} from './botControlTools.js';
import {
  cancelPendingFollowUps,
  scheduleFirstFollowUp
} from './delayedFollowUps.js';

const baseLog = createLogger({ module: 'aiBotEngine' });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Rate limit конфигурация: 20 сообщений в минуту на телефон
const MESSAGE_RATE_LIMIT: RateLimitConfig = {
  maxTokens: 20,
  refillRate: 0.333, // ~20 в минуту
  tokensPerRequest: 1
};

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

  // Интеграция с консультациями
  consultation_integration_enabled?: boolean;
  consultation_settings?: ConsultationIntegrationSettings;

  // Отложенные сообщения (follow-up)
  delayed_schedule_enabled?: boolean;
  delayed_schedule_hours_start?: number;
  delayed_schedule_hours_end?: number;
  delayed_messages?: Array<{
    hours: number;
    minutes: number;
    prompt: string;
    repeatCount?: number;
    offHoursBehavior?: string;
    offHoursTime?: string;
  }>;
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
export async function getBotConfigForInstance(
  instanceName: string,
  ctxLog?: ContextLogger
): Promise<AIBotConfig | null> {
  // Используем переданный логгер или создаём новый
  const log = ctxLog || createContextLogger(baseLog, { instanceName }, ['config', 'db']);

  log.info({ instance: instanceName }, '[getBotConfigForInstance] Starting bot config lookup', ['config']);

  try {
    // Сначала получаем инстанс с привязанным ботом
    log.debug({ instance: instanceName }, '[getBotConfigForInstance] Querying whatsapp_instances', ['db']);
    const { data: instance, error: instanceError } = await supabase
      .from('whatsapp_instances')
      .select('ai_bot_id, user_account_id')
      .eq('instance_name', instanceName)
      .maybeSingle();

    if (instanceError) {
      log.error(instanceError, '[getBotConfigForInstance] DB error fetching instance', {
        instance: instanceName
      }, ['db']);
      return null;
    }

    if (!instance) {
      log.warn({ instance: instanceName }, '[getBotConfigForInstance] Instance not found in database', ['db']);
      return null;
    }

    logDbOperation(log, 'select', 'whatsapp_instances', {
      userId: maskUuid(instance.user_account_id),
      hasBotId: !!instance.ai_bot_id
    }, true);

    // Если бот привязан - используем его
    if (instance.ai_bot_id) {
      log.debug({ botId: maskUuid(instance.ai_bot_id) }, '[getBotConfigForInstance] Fetching linked bot config', ['db']);
      const { data: bot, error: botError } = await supabase
        .from('ai_bot_configurations')
        .select('*')
        .eq('id', instance.ai_bot_id)
        .eq('is_active', true)
        .maybeSingle();

      if (botError) {
        log.error(botError, '[getBotConfigForInstance] DB error fetching bot config', {
          botId: maskUuid(instance.ai_bot_id)
        }, ['db']);
        return null;
      }

      if (bot) {
        log.info({
          botId: maskUuid(bot.id),
          botName: bot.name,
          model: bot.model,
          temp: bot.temperature
        }, '[getBotConfigForInstance] Using linked bot', ['config']);
        return bot;
      } else {
        log.warn({ botId: maskUuid(instance.ai_bot_id) }, '[getBotConfigForInstance] Linked bot not found or inactive', ['config']);
      }
    }

    // Если бот не привязан - ищем активного бота пользователя
    log.debug({ userId: maskUuid(instance.user_account_id) }, '[getBotConfigForInstance] No linked bot, searching for default', ['db']);
    const { data: defaultBot, error: defaultError } = await supabase
      .from('ai_bot_configurations')
      .select('*')
      .eq('user_account_id', instance.user_account_id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (defaultError) {
      log.error(defaultError, '[getBotConfigForInstance] DB error fetching default bot', {}, ['db']);
      return null;
    }

    if (defaultBot) {
      log.info({
        botId: maskUuid(defaultBot.id),
        botName: defaultBot.name,
        model: defaultBot.model
      }, '[getBotConfigForInstance] Using default active bot', ['config']);
      return defaultBot;
    }

    log.warn({
      instance: instanceName,
      userId: maskUuid(instance.user_account_id)
    }, '[getBotConfigForInstance] No active bot found for user', ['config']);
    return null;
  } catch (error: any) {
    log.error(error, '[getBotConfigForInstance] Unexpected error', { instance: instanceName });
    return null;
  }
}

/**
 * Проверить, должен ли бот отвечать с учётом настроек из конструктора
 */
export function shouldBotRespondWithConfig(
  lead: LeadInfo,
  botConfig: AIBotConfig,
  messageText?: string,
  ctxLog?: ContextLogger
): { shouldRespond: boolean; reason?: string } {
  const log = ctxLog || createContextLogger(baseLog, {
    leadId: lead.id,
    botId: botConfig.id
  }, ['processing']);

  log.info({
    leadId: maskUuid(lead.id),
    phone: maskPhone(lead.contact_phone),
    botName: botConfig.name,
    msgLen: messageText?.length || 0
  }, '[shouldBotRespondWithConfig] Checking if bot should respond');

  // 1. Бот не активен
  if (!botConfig.is_active) {
    log.debug({ reason: 'bot_inactive' }, '[shouldBotRespondWithConfig] Bot is inactive');
    return { shouldRespond: false, reason: 'bot_inactive' };
  }

  // 2. Менеджер взял в работу
  if (lead.assigned_to_human) {
    log.debug({ reason: 'assigned_to_human' }, '[shouldBotRespondWithConfig] Lead assigned to human');
    return { shouldRespond: false, reason: 'assigned_to_human' };
  }

  // 3. Бот на паузе
  if (lead.bot_paused) {
    log.debug({ botPaused: true }, '[shouldBotRespondWithConfig] Bot is paused for this lead');
    // Проверить resume_phrases - если сообщение содержит фразу возобновления, снять паузу
    if (messageText && botConfig.resume_phrases?.length > 0) {
      const lowerMessage = messageText.toLowerCase();
      log.debug({
        resumePhrasesCount: botConfig.resume_phrases.length,
        msgPreview: truncateText(lowerMessage, 60)
      }, '[shouldBotRespondWithConfig] Checking resume phrases');

      const shouldResume = botConfig.resume_phrases.some(phrase =>
        lowerMessage.includes(phrase.toLowerCase())
      );
      if (shouldResume) {
        log.info({ reason: 'resume_phrase_detected' }, '[shouldBotRespondWithConfig] Resume phrase detected, will unpause');
        return { shouldRespond: true, reason: 'resume_phrase_detected' };
      }
    }
    return { shouldRespond: false, reason: 'bot_paused' };
  }

  // 4. Пауза с таймаутом
  if (lead.bot_paused_until) {
    const pausedUntil = new Date(lead.bot_paused_until);
    const now = new Date();
    const isPaused = pausedUntil > now;
    log.debug({
      pausedUntil: pausedUntil.toISOString(),
      isPaused
    }, '[shouldBotRespondWithConfig] Checking temporary pause');

    if (isPaused) {
      return { shouldRespond: false, reason: 'bot_paused_temporarily' };
    }
  }

  // 5. Проверить stop_phrases - если сообщение содержит стоп-фразу, поставить на паузу
  if (messageText && botConfig.stop_phrases?.length > 0) {
    const lowerMessage = messageText.toLowerCase();
    log.debug({
      stopPhrasesCount: botConfig.stop_phrases.length,
      msgPreview: truncateText(lowerMessage, 60)
    }, '[shouldBotRespondWithConfig] Checking stop phrases');

    const matchedPhrase = botConfig.stop_phrases.find(phrase =>
      lowerMessage.includes(phrase.toLowerCase())
    );
    if (matchedPhrase) {
      log.info({ matchedPhrase, reason: 'stop_phrase_detected' }, '[shouldBotRespondWithConfig] Stop phrase detected');
      return { shouldRespond: false, reason: 'stop_phrase_detected' };
    }
  }

  // 6. Этапы воронки где бот молчит
  const silentStages = ['consultation_completed', 'deal_closed', 'deal_lost'];
  if (silentStages.includes(lead.funnel_stage)) {
    log.debug({ funnelStage: lead.funnel_stage, reason: 'silent_stage' }, '[shouldBotRespondWithConfig] Lead in silent funnel stage');
    return { shouldRespond: false, reason: 'silent_stage' };
  }

  // 7. Проверка расписания
  if (botConfig.schedule_enabled) {
    log.debug({
      scheduleEnabled: true,
      hours: `${botConfig.schedule_hours_start}-${botConfig.schedule_hours_end}`,
      days: botConfig.schedule_days,
      tz: botConfig.timezone
    }, '[shouldBotRespondWithConfig] Checking schedule', ['schedule']);

    if (!isWithinSchedule(botConfig, log)) {
      log.debug({ reason: 'outside_schedule' }, '[shouldBotRespondWithConfig] Outside of schedule', ['schedule']);
      return { shouldRespond: false, reason: 'outside_schedule' };
    }
  }

  log.info({ shouldRespond: true }, '[shouldBotRespondWithConfig] Bot should respond');
  return { shouldRespond: true };
}

/**
 * Проверка расписания работы бота
 */
function isWithinSchedule(config: AIBotConfig, ctxLog?: ContextLogger): boolean {
  const log = ctxLog || createContextLogger(baseLog, { botId: config.id }, ['schedule']);
  const now = new Date();
  const timezone = config.timezone || 'Asia/Yekaterinburg';

  log.debug({
    tz: timezone,
    nowUTC: now.toISOString()
  }, '[isWithinSchedule] Checking schedule', ['schedule']);

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
    hours: `${config.schedule_hours_start}-${config.schedule_hours_end}`
  }, '[isWithinSchedule] Parsed local time', ['schedule']);

  // Проверка дня недели
  if (!config.schedule_days.includes(day)) {
    log.debug({ day, reason: 'day_not_allowed' }, '[isWithinSchedule] Day not in schedule', ['schedule']);
    return false;
  }

  // Проверка времени
  if (hour < config.schedule_hours_start || hour >= config.schedule_hours_end) {
    log.debug({
      hour,
      reason: 'hour_outside'
    }, '[isWithinSchedule] Hour outside schedule', ['schedule']);
    return false;
  }

  log.debug({ hour, day, inSchedule: true }, '[isWithinSchedule] Within schedule', ['schedule']);
  return true;
}

/**
 * Склейка сообщений через Redis с настраиваемой задержкой
 * Сохраняет correlation ID для передачи в processAIBotResponse
 */
export async function collectMessagesWithConfig(
  phone: string,
  instanceName: string,
  newMessage: string,
  botConfig: AIBotConfig,
  app: FastifyApp,
  ctx?: RequestContext
): Promise<void> {
  const ctxLog = createContextLogger(baseLog, ctx || { phone, instanceName }, ['redis', 'processing']);

  const bufferSeconds = botConfig.message_buffer_seconds || 7;
  const key = `pending_messages:${instanceName}:${phone}`;
  const timerId = `timer:${key}`;
  const ctxKey = `ctx:${key}`;

  ctxLog.info({
    bufferSec: bufferSeconds,
    msgLen: newMessage.length,
    msgPreview: truncateText(newMessage, 80)
  }, '[collectMessagesWithConfig] Adding message to buffer', ['redis']);

  // Добавить сообщение в очередь
  const listLength = await redis.rpush(key, newMessage);
  await redis.expire(key, bufferSeconds + 5);

  // Сохраняем контекст (correlation ID) в Redis для передачи в timer callback
  if (ctx) {
    await redis.set(ctxKey, JSON.stringify(ctx), 'EX', bufferSeconds + 5);
  }

  ctxLog.debug({
    redisKey: key,
    listLen: listLength,
    expireSec: bufferSeconds + 5
  }, '[collectMessagesWithConfig] Message added to Redis list', ['redis']);

  // Проверить, есть ли уже таймер
  const exists = await redis.exists(timerId);

  if (!exists) {
    ctxLog.debug({
      timerId,
      bufferSec: bufferSeconds
    }, '[collectMessagesWithConfig] Creating new timer', ['redis']);

    await redis.set(timerId, '1', 'EX', bufferSeconds);

    // Через N секунд обработать все сообщения
    setTimeout(async () => {
      // Восстанавливаем контекст из Redis
      let savedCtx: RequestContext | undefined;
      try {
        const ctxData = await redis.get(ctxKey);
        if (ctxData) {
          savedCtx = JSON.parse(ctxData);
        }
      } catch {
        // Ignore parse errors
      }

      const timerLog = createContextLogger(baseLog, savedCtx || { phone, instanceName }, ['redis', 'processing']);
      timerLog.info({}, '[collectMessagesWithConfig] Timer fired, processing buffered messages', ['redis']);

      try {
        const messages = await redis.lrange(key, 0, -1);
        await redis.del(key, timerId, ctxKey);

        timerLog.debug({
          msgCount: messages.length,
          msgPreviews: messages.map(m => truncateText(m, 40))
        }, '[collectMessagesWithConfig] Retrieved messages from buffer', ['redis']);

        if (messages.length > 0) {
          const combined = messages.join('\n');
          timerLog.info({
            combinedLen: combined.length,
            msgCount: messages.length
          }, '[collectMessagesWithConfig] Sending combined message to processAIBotResponse');

          await processAIBotResponse(phone, instanceName, combined, botConfig, app, savedCtx);
        } else {
          timerLog.warn({ redisKey: key }, '[collectMessagesWithConfig] No messages in buffer after timer', ['redis']);
        }
      } catch (error: any) {
        timerLog.error(error, '[collectMessagesWithConfig] Error processing collected messages', {
          phone: maskPhone(phone)
        });
      }
    }, bufferSeconds * 1000);
  } else {
    ctxLog.debug({
      timerId,
      action: 'added_to_existing'
    }, '[collectMessagesWithConfig] Timer already exists, message added to existing buffer', ['redis']);
  }
}

/**
 * Основная функция генерации и отправки ответа бота
 * Принимает RequestContext для сохранения correlation ID между этапами
 */
async function processAIBotResponse(
  phone: string,
  instanceName: string,
  messageText: string,
  botConfig: AIBotConfig,
  app: FastifyApp,
  ctx?: RequestContext
): Promise<void> {
  const ctxLog = createContextLogger(baseLog, {
    ...ctx,
    phone,
    instanceName,
    botId: botConfig.id,
    botName: botConfig.name
  }, ['processing', 'openai']);

  ctxLog.info({
    msgLen: messageText.length,
    msgPreview: truncateText(messageText, 120)
  }, '[processAIBotResponse] Starting to process message');

  try {
    // Получить информацию о лиде
    ctxLog.checkpoint('fetch_lead');
    ctxLog.debug({ phone: maskPhone(phone) }, '[processAIBotResponse] Fetching lead from database', ['db']);

    const { data: lead, error: leadError } = await supabase
      .from('dialog_analysis')
      .select('*')
      .eq('contact_phone', phone)
      .eq('instance_name', instanceName)
      .maybeSingle();

    if (leadError) {
      ctxLog.error(leadError, '[processAIBotResponse] Error fetching lead', {
        phone: maskPhone(phone)
      }, ['db']);
      return;
    }

    if (!lead) {
      ctxLog.warn({ phone: maskPhone(phone) }, '[processAIBotResponse] Lead not found', ['db']);
      return;
    }

    ctxLog.updateContext({ leadId: lead.id });
    logDbOperation(ctxLog, 'select', 'dialog_analysis', {
      leadId: maskUuid(lead.id),
      funnelStage: lead.funnel_stage
    }, true);

    // Проверить условия ответа
    ctxLog.checkpoint('check_respond');
    const { shouldRespond, reason } = shouldBotRespondWithConfig(lead, botConfig, messageText, ctxLog);
    if (!shouldRespond) {
      // Если обнаружена стоп-фраза, поставить бота на паузу
      if (reason === 'stop_phrase_detected') {
        ctxLog.info({ action: 'pause_bot' }, '[processAIBotResponse] Pausing bot due to stop phrase', ['db']);
        await supabase
          .from('dialog_analysis')
          .update({ bot_paused: true })
          .eq('id', lead.id);
      }
      ctxLog.info({
        reason,
        ...ctxLog.getTimings()
      }, '[processAIBotResponse] Bot should not respond, exiting');
      return;
    }

    // Если обнаружена фраза возобновления, снять паузу
    if (reason === 'resume_phrase_detected') {
      ctxLog.info({ action: 'resume_bot' }, '[processAIBotResponse] Resuming bot due to resume phrase', ['db']);
      await supabase
        .from('dialog_analysis')
        .update({ bot_paused: false, bot_paused_until: null })
        .eq('id', lead.id);
    }

    // Создать клиент OpenAI (свой ключ или дефолтный)
    const apiKey = botConfig.custom_openai_api_key || OPENAI_API_KEY;
    if (!apiKey) {
      ctxLog.error(new Error('No API key'), '[processAIBotResponse] No OpenAI API key configured', {}, ['config']);
      return;
    }

    ctxLog.debug({
      hasCustomKey: !!botConfig.custom_openai_api_key,
      model: botConfig.model,
      temp: botConfig.temperature,
      apiKeyMasked: maskApiKey(apiKey)
    }, '[processAIBotResponse] Initializing OpenAI client', ['openai']);

    const openai = new OpenAI({ apiKey });

    // Генерировать ответ
    ctxLog.checkpoint('generate_ai');
    ctxLog.info({}, '[processAIBotResponse] Calling generateAIResponse', ['openai']);

    const aiStartTime = Date.now();
    const response = await generateAIResponse(lead, messageText, botConfig, openai, ctxLog);
    const aiElapsed = Date.now() - aiStartTime;

    logOpenAiCall(ctxLog, {
      model: botConfig.model,
      latencyMs: aiElapsed,
      success: !!response.text
    });

    ctxLog.info({
      hasText: !!response.text,
      textLen: response.text?.length || 0,
      hasFunc: !!response.functionCall,
      moveToStage: response.moveToStage,
      needsHuman: response.needsHuman
    }, '[processAIBotResponse] AI response generated', ['openai']);

    if (!response.text) {
      ctxLog.warn({}, '[processAIBotResponse] No response text generated', ['openai']);
      return;
    }

    // Очистить markdown если нужно
    let finalText = response.text;
    if (botConfig.clean_markdown) {
      const beforeLen = finalText.length;
      finalText = cleanMarkdown(finalText);
      ctxLog.debug({
        beforeLen,
        afterLen: finalText.length,
        removed: beforeLen - finalText.length
      }, '[processAIBotResponse] Markdown cleaned');
    }

    // Разбить на части если нужно
    let chunks: string[];
    if (botConfig.split_messages) {
      chunks = splitMessage(finalText, botConfig.split_max_length);
      ctxLog.debug({
        splitEnabled: true,
        maxLen: botConfig.split_max_length,
        chunksCount: chunks.length
      }, '[processAIBotResponse] Message split into chunks');
    } else {
      chunks = [finalText];
    }

    // Отправить сообщения
    ctxLog.checkpoint('send_message');
    ctxLog.info({
      chunksCount: chunks.length,
      totalLen: finalText.length
    }, '[processAIBotResponse] Sending messages via Evolution API', ['message']);

    const sendStartTime = Date.now();
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Отправить статус "печатает..." перед каждым сообщением (кроме первого)
      if (i > 0) {
        // Показать "печатает..." на 1.5-2.5 секунды
        const typingDelay = 1500 + Math.floor(Math.random() * 1000);

        ctxLog.info({
          chunkIdx: i + 1,
          totalChunks: chunks.length,
          typingDelay
        }, '[processAIBotResponse] Sending typing presence before chunk', ['message']);

        const presenceResult = await sendPresence(instanceName, phone, 'composing', typingDelay);

        ctxLog.info({
          presenceResult,
          typingDelay
        }, '[processAIBotResponse] Presence sent, waiting before sending message');

        await delay(typingDelay);
      }

      ctxLog.debug({
        chunkIdx: i + 1,
        totalChunks: chunks.length,
        chunkLen: chunk.length
      }, '[processAIBotResponse] Sending chunk', ['message']);

      await sendMessage({
        instanceName,
        phone,
        message: chunk
      });

      // Пауза после отправки сообщения для естественности
      if (chunks.length > 1 && i < chunks.length - 1) {
        await delay(300);
      }
    }

    logOutgoingMessage(ctxLog, {
      messageLength: finalText.length,
      chunksCount: chunks.length,
      latencyMs: Date.now() - sendStartTime,
      success: true
    });

    // === Сохранить сообщения в историю ===
    ctxLog.checkpoint('save_history');
    ctxLog.debug({}, '[processAIBotResponse] Saving messages to history', ['db']);

    try {
      // Получить текущую историю
      const { data: currentLead } = await supabase
        .from('dialog_analysis')
        .select('messages')
        .eq('id', lead.id)
        .single();

      const currentMessages = Array.isArray(currentLead?.messages) ? currentLead.messages : [];
      const now = new Date().toISOString();

      // Добавить входящее сообщение пользователя
      currentMessages.push({
        sender: 'user',
        content: messageText,
        timestamp: now
      });

      // Добавить ответ бота
      currentMessages.push({
        sender: 'bot',
        content: finalText,
        timestamp: now
      });

      // Ограничить историю по количеству (последние 100 сообщений)
      const trimmedMessages = currentMessages.slice(-LIMITS.MAX_HISTORY_MESSAGES);

      // Сохранить обновлённую историю
      const { error: historyError } = await supabase
        .from('dialog_analysis')
        .update({ messages: trimmedMessages })
        .eq('id', lead.id);

      if (historyError) {
        ctxLog.warn({
          errorCode: historyError.code
        }, '[processAIBotResponse] Failed to save message history (non-fatal)', ['db']);
      } else {
        ctxLog.debug({
          totalMessages: trimmedMessages.length,
          addedMessages: 2
        }, '[processAIBotResponse] Message history saved', ['db']);
      }
    } catch (histError) {
      ctxLog.warn({
        error: (histError as any)?.message
      }, '[processAIBotResponse] Error saving history (non-fatal)', ['db']);
    }

    // Обновить этап воронки если нужно
    if (response.moveToStage) {
      ctxLog.info({
        oldStage: lead.funnel_stage,
        newStage: response.moveToStage
      }, '[processAIBotResponse] Moving lead to new funnel stage', ['db']);

      await supabase
        .from('dialog_analysis')
        .update({ funnel_stage: response.moveToStage })
        .eq('id', lead.id);
    }

    // Если нужен менеджер
    if (response.needsHuman) {
      ctxLog.info({ action: 'transfer_human' }, '[processAIBotResponse] Transferring lead to human', ['db']);

      await supabase
        .from('dialog_analysis')
        .update({ assigned_to_human: true, bot_paused: true })
        .eq('id', lead.id);
    }

    // Выполнить функцию если указана
    if (response.functionCall) {
      ctxLog.info({
        funcName: response.functionCall.name
      }, '[processAIBotResponse] Executing function call');

      await handleFunctionCall(response.functionCall, lead, botConfig, app, ctxLog);
    }

    // Обновить время последнего сообщения
    await supabase
      .from('dialog_analysis')
      .update({ last_bot_message_at: new Date().toISOString() })
      .eq('id', lead.id);

    ctxLog.info({
      responseLen: finalText.length,
      chunksCount: chunks.length,
      historyUpdated: true,
      ...ctxLog.getTimings()
    }, '[processAIBotResponse] Bot response sent successfully');

    // === Планирование follow-up если функция включена ===
    try {
      const scheduled = await scheduleFirstFollowUp(
        {
          id: botConfig.id,
          is_active: botConfig.is_active,
          delayed_schedule_enabled: botConfig.delayed_schedule_enabled,
          delayed_schedule_hours_start: botConfig.delayed_schedule_hours_start,
          delayed_schedule_hours_end: botConfig.delayed_schedule_hours_end,
          delayed_messages: botConfig.delayed_messages || [],
          timezone: botConfig.timezone
        },
        lead.id,
        instanceName,
        phone
      );
      if (scheduled) {
        ctxLog.info({ leadId: maskUuid(lead.id) }, '[processAIBotResponse] Follow-up scheduled');
      }
    } catch (e) {
      ctxLog.warn({ error: (e as any)?.message }, '[processAIBotResponse] Failed to schedule follow-up (non-fatal)');
    }

  } catch (error: any) {
    ctxLog.error(error, '[processAIBotResponse] Error processing message', {
      phone: maskPhone(phone),
      ...ctxLog.getTimings()
    });

    // Отправить сообщение об ошибке если настроено
    if (botConfig.error_message) {
      ctxLog.debug({
        errorMsgLen: botConfig.error_message.length
      }, '[processAIBotResponse] Sending error message to user');

      try {
        await sendMessage({
          instanceName,
          phone,
          message: botConfig.error_message
        });
      } catch (e) {
        ctxLog.error(e, '[processAIBotResponse] Failed to send error message');
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
  config: AIBotConfig,
  ctxLog?: ContextLogger
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  const log = ctxLog || createContextLogger(baseLog, { leadId }, ['db']);

  log.debug({
    tokenLimit: config.history_token_limit,
    msgLimit: config.history_message_limit,
    timeLimitH: config.history_time_limit_hours
  }, '[loadMessageHistory] Starting to load message history', ['db']);

  try {
    // Получить messages из dialog_analysis
    const { data: lead, error } = await supabase
      .from('dialog_analysis')
      .select('messages')
      .eq('id', leadId)
      .single();

    if (error) {
      log.warn({
        errorCode: error.code
      }, '[loadMessageHistory] Error fetching messages from database', ['db']);
      return [];
    }

    if (!lead?.messages) {
      log.debug({}, '[loadMessageHistory] No message history found in database', ['db']);
      return [];
    }

    // messages - это JSONB массив [{sender, content, timestamp}, ...]
    const rawMessages = Array.isArray(lead.messages) ? lead.messages : [];
    log.debug({
      rawCount: rawMessages.length
    }, '[loadMessageHistory] Raw messages loaded from JSONB', ['db']);

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
        timeLimitH: config.history_time_limit_hours,
        beforeCount,
        afterCount: filteredMessages.length
      }, '[loadMessageHistory] Applied time filter');
    }

    // Ограничить количество сообщений (берём последние N)
    if (config.history_message_limit && filteredMessages.length > config.history_message_limit) {
      const beforeCount = filteredMessages.length;
      filteredMessages = filteredMessages.slice(-config.history_message_limit);
      log.debug({
        msgLimit: config.history_message_limit,
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
      rawCount: rawMessages.length,
      filteredCount: filteredMessages.length,
      finalCount: history.length,
      estTokens: totalTokens,
      tokenLimit,
      skipped: skippedDueToTokens
    }, '[loadMessageHistory] Message history loaded successfully');

    return history;
  } catch (error: any) {
    log.error(error, '[loadMessageHistory] Unexpected error loading message history');
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
  openai: OpenAI,
  ctxLog?: ContextLogger
): Promise<{
  text: string;
  moveToStage?: string;
  needsHuman?: boolean;
  functionCall?: { name: string; arguments: any };
}> {
  const log = ctxLog || createContextLogger(baseLog, {
    leadId: lead.id,
    botId: config.id
  }, ['openai']);

  log.checkpoint('start_generate');
  log.info({
    model: config.model,
    temp: config.temperature,
    msgLen: messageText.length
  }, '[generateAIResponse] Starting AI response generation', ['openai']);

  // Получить функции бота
  log.debug({}, '[generateAIResponse] Fetching bot functions', ['db']);
  const { data: functions, error: functionsError } = await supabase
    .from('ai_bot_functions')
    .select('*')
    .eq('bot_id', config.id)
    .eq('is_active', true);

  if (functionsError) {
    log.warn({
      errorCode: functionsError.code
    }, '[generateAIResponse] Error fetching bot functions', ['db']);
  }

  log.debug({
    funcCount: functions?.length || 0,
    funcNames: functions?.map(f => f.name) || []
  }, '[generateAIResponse] Bot functions loaded', ['db']);

  // Построить системный промпт
  let systemPrompt = config.system_prompt || 'Ты — AI-ассистент.';
  log.debug({
    promptLen: systemPrompt.length
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
    log.debug({ datetime: formattedDate }, '[generateAIResponse] Added datetime to prompt');
  }

  // Добавить информацию о клиенте (маскируем телефон)
  const clientInfo = `
Информация о клиенте:
- Имя: ${lead.contact_name || 'неизвестно'}
- Телефон: ${lead.contact_phone}
- Тип бизнеса: ${lead.business_type || 'неизвестно'}
- Уровень интереса: ${lead.interest_level || 'неизвестно'}
- Этап воронки: ${lead.funnel_stage}`;

  log.debug({
    clientName: lead.contact_name,
    businessType: lead.business_type,
    funnelStage: lead.funnel_stage
  }, '[generateAIResponse] Client info added to prompt');

  // Добавить инструкции для консультаций если интеграция включена
  if (config.consultation_integration_enabled && config.consultation_settings) {
    const consultationPrompt = await getConsultationPromptAddition(config.consultation_settings);
    systemPrompt += consultationPrompt;
    log.debug({
      consultationEnabled: true
    }, '[generateAIResponse] Added consultation integration prompt');
  }

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
    }, '[generateAIResponse] Prepared OpenAI tools', ['openai']);
  }

  // Добавить consultation tools если интеграция включена
  if (config.consultation_integration_enabled && config.consultation_settings) {
    const consultationTools = getConsultationToolDefinitions(config.consultation_settings);
    tools.push(...consultationTools);
    log.debug({
      consultationToolsCount: consultationTools.length,
      consultationToolNames: consultationTools.map(t => t.function.name)
    }, '[generateAIResponse] Added consultation tools', ['openai']);
  }

  // Добавить CAPI tools (всегда включены)
  const capiTools = getCapiToolDefinitions();
  tools.push(...capiTools);
  log.debug({
    capiToolsCount: capiTools.length,
    capiToolNames: capiTools.map(t => t.function.name)
  }, '[generateAIResponse] Added CAPI tools', ['openai']);

  // Добавить Lead Management tools (всегда включены)
  const leadManagementTools = getLeadManagementToolDefinitions();
  tools.push(...leadManagementTools);
  log.debug({
    leadToolsCount: leadManagementTools.length,
    leadToolNames: leadManagementTools.map(t => t.function.name)
  }, '[generateAIResponse] Added Lead Management tools', ['openai']);

  // Добавить Bot Control tools (всегда включены)
  const botControlTools = getBotControlToolDefinitions();
  tools.push(...botControlTools);
  log.debug({
    botControlToolsCount: botControlTools.length,
    botControlToolNames: botControlTools.map(t => t.function.name)
  }, '[generateAIResponse] Added Bot Control tools', ['openai']);

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
  }, '[generateAIResponse] Model mapping', ['openai']);

  try {
    // Загрузить историю сообщений
    log.checkpoint('load_history');
    const history = await loadMessageHistory(lead.id, config, log);

    // Собрать массив сообщений: system + history + текущее
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt + clientInfo },
      ...history,
      { role: 'user', content: messageText }
    ];

    log.debug({
      totalMsgs: messages.length,
      historyLen: history.length,
      userMsgLen: messageText.length
    }, '[generateAIResponse] Messages array prepared', ['openai']);

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

    log.checkpoint('api_call');
    log.info({
      model,
      temp: config.temperature,
      maxTokens: 1000,
      msgsCount: messages.length,
      toolsCount: tools.length
    }, '[generateAIResponse] Calling OpenAI API', ['openai', 'api']);

    const apiStartTime = Date.now();
    const completion = await openai.chat.completions.create(completionParams);
    const apiElapsed = Date.now() - apiStartTime;

    const choice = completion.choices[0];

    // Используем расширенный лог с подсчётом стоимости
    logOpenAiCallWithCost(log, {
      model,
      promptTokens: completion.usage?.prompt_tokens,
      completionTokens: completion.usage?.completion_tokens,
      totalTokens: completion.usage?.total_tokens,
      latencyMs: apiElapsed,
      success: true
    });

    log.info({
      finishReason: choice.finish_reason,
      hasContent: !!choice.message.content,
      contentLen: choice.message.content?.length || 0,
      hasToolCalls: !!choice.message.tool_calls?.length,
      promptTokens: completion.usage?.prompt_tokens,
      completionTokens: completion.usage?.completion_tokens
    }, '[generateAIResponse] OpenAI API response received', ['openai']);

    // Проверить вызов функции
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      const toolCall = choice.message.tool_calls[0];

      // Безопасный парсинг аргументов функции
      const functionArgs = safeJsonParse<Record<string, any>>(
        toolCall.function.arguments || '{}',
        {},
        log,
        `function_call:${toolCall.function.name}`
      );

      log.info({
        funcName: toolCall.function.name,
        argsPreview: truncateText(toolCall.function.arguments, 80),
        argsKeys: Object.keys(functionArgs)
      }, '[generateAIResponse] Function call detected', ['openai']);

      log.info({ ...log.getTimings() }, '[generateAIResponse] Completed with function call');

      return {
        text: choice.message.content || '',
        functionCall: {
          name: toolCall.function.name,
          arguments: functionArgs
        }
      };
    }

    log.info({
      responseLen: choice.message.content?.length || 0,
      responsePreview: truncateText(choice.message.content || '', 100),
      ...log.getTimings()
    }, '[generateAIResponse] Completed with text response', ['openai']);

    return {
      text: choice.message.content || ''
    };

  } catch (error: any) {
    logOpenAiCallWithCost(log, {
      model,
      latencyMs: 0,
      success: false,
      errorMessage: error.message
    });

    log.error(error, '[generateAIResponse] Error calling OpenAI', {
      model,
      errorCode: error.code,
      errorStatus: error.status,
      ...log.getTimings()
    }, ['openai', 'api']);

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
  app: FastifyApp,
  ctxLog?: ContextLogger
): Promise<void> {
  const log = ctxLog || createContextLogger(baseLog, {
    leadId: lead.id,
    botId: botConfig.id
  }, ['processing']);

  log.checkpoint('start_function');
  log.info({
    funcName: functionCall.name,
    argsKeys: Object.keys(functionCall.arguments || {})
  }, '[handleFunctionCall] Starting function execution');

  try {
    // Проверить, является ли это CAPI tool
    if (isCapiTool(functionCall.name)) {
      log.info({
        funcName: functionCall.name
      }, '[handleFunctionCall] Processing CAPI tool', ['api']);

      const result = await handleCapiTool(
        functionCall.name,
        functionCall.arguments,
        lead.id,
        log
      );

      log.info({
        funcName: functionCall.name,
        resultLen: result.length,
        ...log.getTimings()
      }, '[handleFunctionCall] CAPI tool completed', ['api']);

      return;
    }

    // Проверить, является ли это Lead Management tool
    if (isLeadManagementTool(functionCall.name)) {
      log.info({
        funcName: functionCall.name
      }, '[handleFunctionCall] Processing Lead Management tool', ['processing']);

      const result = await handleLeadManagementTool(
        functionCall.name,
        functionCall.arguments,
        {
          id: lead.id,
          contact_phone: lead.contact_phone,
          contact_name: lead.contact_name,
          funnel_stage: lead.funnel_stage,
          interest_level: lead.interest_level
        },
        log
      );

      log.info({
        funcName: functionCall.name,
        resultLen: result.length,
        ...log.getTimings()
      }, '[handleFunctionCall] Lead Management tool completed', ['processing']);

      return;
    }

    // Проверить, является ли это Bot Control tool
    if (isBotControlTool(functionCall.name)) {
      log.info({
        funcName: functionCall.name
      }, '[handleFunctionCall] Processing Bot Control tool', ['processing']);

      const result = await handleBotControlTool(
        functionCall.name,
        functionCall.arguments,
        {
          id: lead.id,
          contact_phone: lead.contact_phone,
          contact_name: lead.contact_name,
          messages: lead.messages,
          funnel_stage: lead.funnel_stage,
          interest_level: lead.interest_level
        },
        log
      );

      log.info({
        funcName: functionCall.name,
        resultLen: result.length,
        ...log.getTimings()
      }, '[handleFunctionCall] Bot Control tool completed', ['processing']);

      return;
    }

    // Проверить, является ли это consultation tool
    if (isConsultationTool(functionCall.name)) {
      if (!botConfig.consultation_integration_enabled || !botConfig.consultation_settings) {
        log.warn({
          funcName: functionCall.name
        }, '[handleFunctionCall] Consultation tool called but integration is disabled');
        return;
      }

      log.info({
        funcName: functionCall.name
      }, '[handleFunctionCall] Processing consultation tool', ['consultation']);

      const result = await handleConsultationTool(
        functionCall.name,
        functionCall.arguments,
        {
          id: lead.id,
          contact_phone: lead.contact_phone,
          contact_name: lead.contact_name
        },
        botConfig.consultation_settings,
        log
      );

      log.info({
        funcName: functionCall.name,
        resultLen: result.length,
        ...log.getTimings()
      }, '[handleFunctionCall] Consultation tool completed', ['consultation']);

      // Результат consultation tool уже содержит текст для ответа
      // AI использует этот результат для формирования ответа клиенту
      return;
    }

    // Получить конфигурацию функции
    log.debug({
      funcName: functionCall.name
    }, '[handleFunctionCall] Fetching function config from database', ['db']);

    const { data: func, error: funcError } = await supabase
      .from('ai_bot_functions')
      .select('*')
      .eq('bot_id', botConfig.id)
      .eq('name', functionCall.name)
      .eq('is_active', true)
      .maybeSingle();

    if (funcError) {
      log.error(funcError, '[handleFunctionCall] Error fetching function config', {
        funcName: functionCall.name
      }, ['db']);
      return;
    }

    if (!func) {
      log.warn({
        funcName: functionCall.name
      }, '[handleFunctionCall] Function not found or inactive', ['db']);
      return;
    }

    logDbOperation(log, 'select', 'ai_bot_functions', {
      funcId: maskUuid(func.id),
      handlerType: func.handler_type
    }, true);

    switch (func.handler_type) {
      case 'forward_to_manager':
        log.info({
          phone: maskPhone(lead.contact_phone),
          action: 'forward_to_manager'
        }, '[handleFunctionCall] Forwarding lead to manager', ['db']);

        const { error: forwardError } = await supabase
          .from('dialog_analysis')
          .update({ assigned_to_human: true, bot_paused: true })
          .eq('id', lead.id);

        if (forwardError) {
          log.error(forwardError, '[handleFunctionCall] Error updating lead for manager forward', {}, ['db']);
        } else {
          logDbOperation(log, 'update', 'dialog_analysis', { action: 'forward_to_manager' }, true);
          log.info({ ...log.getTimings() }, '[handleFunctionCall] Successfully forwarded to manager');
        }
        break;

      case 'internal':
        log.debug({
          funcName: functionCall.name,
          argsKeys: Object.keys(functionCall.arguments || {})
        }, '[handleFunctionCall] Processing internal function');

        // Внутренняя обработка
        if (functionCall.name === 'save_user_data') {
          log.info({
            fieldsToSave: Object.keys(functionCall.arguments || {})
          }, '[handleFunctionCall] Saving user data', ['db']);

          const { error: saveError } = await supabase
            .from('dialog_analysis')
            .update(functionCall.arguments)
            .eq('id', lead.id);

          if (saveError) {
            log.error(saveError, '[handleFunctionCall] Error saving user data', {}, ['db']);
          } else {
            logDbOperation(log, 'update', 'dialog_analysis', {
              savedFields: Object.keys(functionCall.arguments || {})
            }, true);
            log.info({ ...log.getTimings() }, '[handleFunctionCall] User data saved successfully');
          }
        } else {
          log.warn({
            funcName: functionCall.name
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
            payloadSize: JSON.stringify(webhookPayload).length
          }, '[handleFunctionCall] Calling external webhook', ['webhook', 'api']);

          try {
            const webhookStartTime = Date.now();
            const response = await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(webhookPayload)
            });

            const webhookElapsed = Date.now() - webhookStartTime;

            logWebhookCall(log, {
              url: webhookUrl,
              method: 'POST',
              statusCode: response.status,
              latencyMs: webhookElapsed,
              success: response.ok
            });

            log.info({ ...log.getTimings() }, '[handleFunctionCall] Webhook called successfully', ['webhook']);
          } catch (e) {
            logWebhookCall(log, {
              url: webhookUrl,
              method: 'POST',
              latencyMs: 0,
              success: false,
              errorMessage: (e as any).message
            });
            log.error(e, '[handleFunctionCall] Webhook call failed', {}, ['webhook', 'api']);
          }
        } else {
          log.warn({
            funcName: functionCall.name,
            reason: 'no_url'
          }, '[handleFunctionCall] Webhook URL not configured', ['webhook']);
        }
        break;

      default:
        log.warn({
          handlerType: func.handler_type,
          funcName: functionCall.name
        }, '[handleFunctionCall] Unknown handler type');
    }

    log.info({
      funcName: functionCall.name,
      handlerType: func.handler_type,
      ...log.getTimings()
    }, '[handleFunctionCall] Function execution completed');

  } catch (error: any) {
    log.error(error, '[handleFunctionCall] Unexpected error handling function call', {
      funcName: functionCall.name,
      ...log.getTimings()
    });
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
 * Тестирование бота - генерация ответа без WhatsApp
 * Используется для UI тестирования в конструкторе ботов
 * Поддерживает все настройки бота: буфер, расписание, разделение сообщений, consultation tools
 */
export async function testBotResponse(
  botId: string,
  messageText: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
): Promise<{
  success: boolean;
  response?: string;
  responses?: string[]; // Для split_messages - несколько сообщений
  error?: string;
  bufferApplied?: number; // Сколько секунд буфера применено
  scheduleBlocked?: boolean; // Заблокировано расписанием
  toolCalls?: string[]; // Какие tools были вызваны
}> {
  const ctxLog = createContextLogger(baseLog, { botId }, ['processing', 'openai']);

  ctxLog.info({
    msgLen: messageText.length,
    historyLen: conversationHistory.length
  }, '[testBotResponse] Starting test bot response');

  try {
    // Получить конфигурацию бота напрямую по ID
    const { data: botConfig, error: botError } = await supabase
      .from('ai_bot_configurations')
      .select('*')
      .eq('id', botId)
      .single();

    if (botError || !botConfig) {
      ctxLog.warn({ botId }, '[testBotResponse] Bot not found');
      return { success: false, error: 'Bot not found' };
    }

    ctxLog.info({
      botName: botConfig.name,
      model: botConfig.model,
      temp: botConfig.temperature,
      bufferSec: botConfig.message_buffer_seconds,
      scheduleEnabled: botConfig.schedule_enabled,
      splitMessages: botConfig.split_messages,
      consultationEnabled: botConfig.consultation_integration_enabled
    }, '[testBotResponse] Bot config loaded');

    // Проверить расписание работы бота
    if (botConfig.schedule_enabled) {
      const now = new Date();
      const timezone = botConfig.timezone || 'Asia/Yekaterinburg';

      // Получить текущее время в таймзоне бота
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
        weekday: 'short'
      });
      const parts = formatter.formatToParts(now);
      const currentHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
      const dayName = parts.find(p => p.type === 'weekday')?.value || '';

      // Преобразовать день недели в число (1=Пн, 7=Вс)
      const dayMap: Record<string, number> = { 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6, 'Sun': 7 };
      const currentDay = dayMap[dayName] || 1;

      const scheduleDays = botConfig.schedule_days || [1, 2, 3, 4, 5, 6, 7];
      const startHour = botConfig.schedule_hours_start ?? 9;
      const endHour = botConfig.schedule_hours_end ?? 21;

      const isDayAllowed = scheduleDays.includes(currentDay);
      const isHourAllowed = currentHour >= startHour && currentHour < endHour;

      if (!isDayAllowed || !isHourAllowed) {
        ctxLog.info({
          currentDay,
          currentHour,
          scheduleDays,
          startHour,
          endHour
        }, '[testBotResponse] Schedule blocked');

        return {
          success: true,
          response: `[Бот не работает по расписанию. Текущее время: ${currentHour}:00, день: ${currentDay}. Расписание: ${startHour}:00-${endHour}:00, дни: ${scheduleDays.join(', ')}]`,
          scheduleBlocked: true
        };
      }
    }

    // Применить буфер сообщений (эмуляция задержки)
    const bufferSeconds = botConfig.message_buffer_seconds || 0;
    if (bufferSeconds > 0) {
      ctxLog.info({ bufferSeconds }, '[testBotResponse] Applying message buffer delay');
      await delay(bufferSeconds * 1000);
    }

    // Создать клиент OpenAI
    const apiKey = botConfig.custom_openai_api_key || OPENAI_API_KEY;
    if (!apiKey) {
      return { success: false, error: 'No OpenAI API key configured' };
    }

    const openai = new OpenAI({ apiKey });

    // Построить системный промпт
    let systemPrompt = botConfig.system_prompt || 'Ты — AI-ассистент.';

    // Добавить текущую дату/время если включено
    if (botConfig.pass_current_datetime) {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('ru-RU', {
        timeZone: botConfig.timezone || 'Asia/Yekaterinburg',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      systemPrompt += `\n\nТекущая дата и время: ${formatter.format(now)}`;
    }

    // Добавить тестовую информацию о клиенте
    systemPrompt += `\n\nЭто тестовый режим. Телефон клиента: +7 999 000 0000 (тест).`;

    // Подготовить tools
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];

    // Подготовить consultation settings если включено
    let consultationSettings: ConsultationIntegrationSettings | null = null;
    if (botConfig.consultation_integration_enabled && botConfig.consultation_settings) {
      // consultation_settings хранится в snake_case в БД
      const dbSettings = botConfig.consultation_settings;
      consultationSettings = {
        consultant_ids: dbSettings.consultant_ids || [],
        slots_to_show: dbSettings.slots_to_show || 5,
        default_duration_minutes: dbSettings.default_duration_minutes || 60,
        days_ahead_limit: dbSettings.days_ahead_limit || 14,
        auto_summarize_dialog: dbSettings.auto_summarize_dialog ?? true,
        collect_client_name: dbSettings.collect_client_name ?? true,
        timezone: botConfig.timezone || 'Asia/Yekaterinburg'
      };

      // Добавить промпт для консультаций
      const consultationPrompt = await getConsultationPromptAddition(consultationSettings);
      systemPrompt += consultationPrompt;

      // Добавить tools для консультаций
      const consultationTools = getConsultationToolDefinitions(consultationSettings);
      tools.push(...consultationTools);

      ctxLog.info({
        consultationToolsCount: consultationTools.length,
        slotsToShow: consultationSettings.slots_to_show,
        daysAhead: consultationSettings.days_ahead_limit
      }, '[testBotResponse] Added consultation tools');
    }

    // Ограничить историю по количеству сообщений
    let limitedHistory = [...conversationHistory];
    if (botConfig.history_message_limit && limitedHistory.length > botConfig.history_message_limit) {
      limitedHistory = limitedHistory.slice(-botConfig.history_message_limit);
      ctxLog.debug({
        originalLen: conversationHistory.length,
        limitedLen: limitedHistory.length,
        limit: botConfig.history_message_limit
      }, '[testBotResponse] History limited by message count');
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

    const model = modelMap[botConfig.model] || 'gpt-4o-mini';

    // Собрать массив сообщений
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...limitedHistory.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      })),
      { role: 'user', content: messageText }
    ];

    // Параметры запроса
    const completionParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages,
      temperature: botConfig.temperature,
      max_tokens: 1000
    };

    // Добавить tools если есть
    if (tools.length > 0) {
      completionParams.tools = tools;
      completionParams.tool_choice = 'auto';
    }

    ctxLog.info({
      model,
      msgsCount: messages.length,
      temp: botConfig.temperature,
      toolsCount: tools.length
    }, '[testBotResponse] Calling OpenAI');

    let completion = await openai.chat.completions.create(completionParams);
    let choice = completion.choices[0];
    const toolCallsExecuted: string[] = [];

    // Обработка tool calls (до 3 итераций)
    let iterations = 0;
    const maxIterations = 3;

    while (choice.message.tool_calls && choice.message.tool_calls.length > 0 && iterations < maxIterations) {
      iterations++;
      ctxLog.info({
        iteration: iterations,
        toolCallsCount: choice.message.tool_calls.length,
        toolNames: choice.message.tool_calls.map(tc => tc.function.name)
      }, '[testBotResponse] Processing tool calls');

      // Добавить assistant message с tool_calls
      messages.push({
        role: 'assistant',
        content: choice.message.content || null,
        tool_calls: choice.message.tool_calls
      } as OpenAI.Chat.Completions.ChatCompletionMessageParam);

      // Обработать каждый tool call
      for (const toolCall of choice.message.tool_calls) {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments || '{}');
        toolCallsExecuted.push(functionName);

        ctxLog.info({
          functionName,
          args
        }, '[testBotResponse] Executing tool call');

        let toolResult = '';

        // Обработать consultation tools
        if (isConsultationTool(functionName) && consultationSettings) {
          // Создать тестовый lead для consultation tools
          const testLead = {
            id: '00000000-0000-0000-0000-000000000000', // Тестовый UUID
            contact_phone: '+79990000000',
            contact_name: 'Тестовый клиент'
          };

          toolResult = await handleConsultationTool(
            functionName,
            args,
            testLead,
            consultationSettings,
            ctxLog
          );
        } else {
          toolResult = `[Функция ${functionName} недоступна в тестовом режиме]`;
        }

        ctxLog.info({
          functionName,
          resultLen: toolResult.length
        }, '[testBotResponse] Tool call completed');

        // Добавить результат как tool message
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult
        } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
      }

      // Сделать следующий запрос к OpenAI с результатами tool calls
      ctxLog.info({
        iteration: iterations,
        msgsCount: messages.length
      }, '[testBotResponse] Calling OpenAI with tool results');

      completion = await openai.chat.completions.create({
        model,
        messages,
        temperature: botConfig.temperature,
        max_tokens: 1000,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined
      });

      choice = completion.choices[0];
    }

    let responseText = choice.message?.content || '';

    // Если после tool calls получили пустой ответ, делаем ещё один запрос без tools
    if (!responseText && toolCallsExecuted.length > 0) {
      ctxLog.warn({
        toolCallsExecuted,
        finishReason: choice.finish_reason,
        hasToolCalls: !!choice.message?.tool_calls?.length
      }, '[testBotResponse] Empty response after tool calls, retrying without tools');

      const retryCompletion = await openai.chat.completions.create({
        model,
        messages,
        temperature: botConfig.temperature,
        max_tokens: 1000
        // Без tools - просто текстовый ответ
      });

      responseText = retryCompletion.choices[0]?.message?.content || '';
      ctxLog.info({
        retryResponseLen: responseText.length
      }, '[testBotResponse] Retry response received');
    }

    // Очистить markdown если нужно
    if (botConfig.clean_markdown) {
      responseText = responseText
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/_/g, '')
        .replace(/`/g, '')
        .replace(/#{1,6}\s/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    }

    // Разбить на части если включено split_messages
    let responses: string[] = [responseText];
    const splitEnabled = botConfig.split_messages === true;
    const maxLength = botConfig.split_max_length || 500;

    ctxLog.info({
      splitEnabled,
      maxLength,
      responseLen: responseText.length,
      shouldSplit: splitEnabled && responseText.length > maxLength,
      toolCallsCount: toolCallsExecuted.length
    }, '[testBotResponse] Split check');

    if (splitEnabled && responseText.length > maxLength) {
      responses = splitMessage(responseText, maxLength);
      ctxLog.info({
        originalLen: responseText.length,
        chunksCount: responses.length,
        maxLen: maxLength
      }, '[testBotResponse] Response split into chunks');
    }

    ctxLog.info({
      responseLen: responseText.length,
      tokens: completion.usage?.total_tokens,
      chunksCount: responses.length,
      bufferApplied: bufferSeconds,
      toolCalls: toolCallsExecuted
    }, '[testBotResponse] Response generated');

    return {
      success: true,
      response: responses.join('\n\n---\n\n'), // Объединить с разделителем для UI
      responses, // Массив отдельных сообщений
      bufferApplied: bufferSeconds,
      toolCalls: toolCallsExecuted.length > 0 ? toolCallsExecuted : undefined
    };

  } catch (error: any) {
    ctxLog.error(error, '[testBotResponse] Error generating test response');
    return {
      success: false,
      error: error.message || 'Unknown error'
    };
  }
}

/**
 * Главная точка входа - обработка входящего сообщения
 * Создаёт correlation ID для всей цепочки обработки
 *
 * Включает:
 * - Rate limiting для защиты от спама
 * - Duplicate detection для предотвращения повторной обработки
 * - Валидацию и санитизацию сообщений
 * - Полную трассировку через все этапы
 */
export async function processIncomingMessage(
  phone: string,
  instanceName: string,
  messageText: string,
  messageType: 'text' | 'image' | 'audio' | 'document' | 'file',
  app: FastifyApp
): Promise<{ processed: boolean; reason?: string; correlationId?: string }> {
  // Создаём контекстный логгер с correlation ID
  const ctxLog = createContextLogger(baseLog, {
    phone,
    instanceName
  }, ['message', 'processing']);

  let currentStage: ProcessingStage = 'received';

  ctxLog.info({
    msgType: messageType,
    msgLength: messageText?.length || 0,
    msgPreview: truncateText(messageText, 80)
  }, '[processIncomingMessage] === NEW INCOMING MESSAGE ===');

  // Логируем входящее сообщение со структурой
  logIncomingMessage(ctxLog, {
    messageType,
    messageLength: messageText?.length || 0,
    hasMedia: ['image', 'audio', 'document', 'file'].includes(messageType)
  });

  try {
    // === ЭТАП 1: Rate Limiting ===
    const rateLimitKey = `msg:${instanceName}:${phone}`;
    const rateCheck = checkRateLimit(rateLimitKey, MESSAGE_RATE_LIMIT, ctxLog);

    if (!rateCheck.allowed) {
      ctxLog.warn({
        reason: 'rate_limited',
        retryAfterMs: rateCheck.retryAfterMs,
        remainingTokens: rateCheck.remainingTokens
      }, '[processIncomingMessage] Rate limit exceeded, dropping message', ['validation']);

      logProcessingSummary(ctxLog, {
        success: false,
        finalStage: 'received',
        errorMessage: 'Rate limit exceeded'
      });

      return { processed: false, reason: 'rate_limited', correlationId: ctxLog.context.correlationId };
    }

    // === ЭТАП 2: Duplicate Detection ===
    if (messageText && isDuplicateMessage(phone, instanceName, messageText, ctxLog)) {
      logProcessingSummary(ctxLog, {
        success: false,
        finalStage: 'received',
        errorMessage: 'Duplicate message'
      });

      return { processed: false, reason: 'duplicate_message', correlationId: ctxLog.context.correlationId };
    }

    // === ЭТАП 3: Validation ===
    logStageTransition(ctxLog, currentStage, 'validated');
    currentStage = 'validated';

    const validation = validateMessage(messageText, ctxLog);
    if (!validation.valid) {
      ctxLog.warn({
        warnings: validation.warnings,
        reason: 'invalid_message'
      }, '[processIncomingMessage] Message validation failed', ['validation']);

      logProcessingSummary(ctxLog, {
        success: false,
        finalStage: 'validated',
        errorMessage: 'Invalid message'
      });

      return { processed: false, reason: 'invalid_message', correlationId: ctxLog.context.correlationId };
    }

    // Используем санитизированный текст
    const sanitizedText = validation.sanitized;
    if (validation.warnings.length > 0) {
      ctxLog.debug({
        warnings: validation.warnings,
        originalLen: messageText?.length,
        sanitizedLen: sanitizedText.length
      }, '[processIncomingMessage] Message sanitized with warnings', ['validation']);
    }

    // === ЭТАП 4: Получить конфигурацию бота ===
    logStageTransition(ctxLog, currentStage, 'config_loaded');
    currentStage = 'config_loaded';

    ctxLog.debug({ instance: instanceName }, '[processIncomingMessage] Fetching bot configuration', ['config']);

    const botConfig = await withRetry(
      () => getBotConfigForInstance(instanceName, ctxLog),
      ctxLog,
      'getBotConfigForInstance',
      { ...DEFAULT_RETRY_CONFIG, maxRetries: 2 }
    ).catch(() => null);

    if (!botConfig) {
      ctxLog.warn({
        reason: 'no_bot_config',
        ...ctxLog.getTimings()
      }, '[processIncomingMessage] No bot config found, message will not be processed', ['config']);

      logProcessingSummary(ctxLog, {
        success: false,
        finalStage: currentStage,
        errorMessage: 'No bot config found'
      });

      return { processed: false, reason: 'no_bot_config', correlationId: ctxLog.context.correlationId };
    }

    // Обновляем контекст с данными бота
    ctxLog.updateContext({
      botId: botConfig.id,
      botName: botConfig.name,
      userAccountId: botConfig.user_account_id
    });

    ctxLog.info({
      botId: maskUuid(botConfig.id),
      botName: botConfig.name,
      model: botConfig.model,
      isActive: botConfig.is_active,
      bufferSec: botConfig.message_buffer_seconds,
      scheduleEnabled: botConfig.schedule_enabled
    }, '[processIncomingMessage] Bot config loaded', ['config']);

    // === ЭТАП 5: Получить информацию о лиде ===
    logStageTransition(ctxLog, currentStage, 'lead_loaded');
    currentStage = 'lead_loaded';

    ctxLog.debug({ phone: maskPhone(phone) }, '[processIncomingMessage] Fetching lead info', ['db']);

    let { data: lead, error: leadError } = await supabase
      .from('dialog_analysis')
      .select('*')
      .eq('contact_phone', phone)
      .eq('instance_name', instanceName)
      .maybeSingle();

    if (leadError) {
      ctxLog.error(leadError, '[processIncomingMessage] Error fetching lead', {
        phone: maskPhone(phone),
        instance: instanceName
      }, ['db']);

      logProcessingSummary(ctxLog, {
        success: false,
        finalStage: currentStage,
        errorMessage: 'Lead fetch error'
      });

      return { processed: false, reason: 'lead_fetch_error', correlationId: ctxLog.context.correlationId };
    }

    // Если лид не найден - создаём автоматически
    if (!lead) {
      ctxLog.info({
        phone: maskPhone(phone),
        instance: instanceName
      }, '[processIncomingMessage] Lead not found, creating new one', ['db']);

      const now = new Date().toISOString();
      const { data: newLead, error: createError } = await supabase
        .from('dialog_analysis')
        .insert({
          user_account_id: botConfig.user_account_id,
          instance_name: instanceName,
          contact_phone: phone,
          first_message: now,
          last_message: now,
          funnel_stage: 'new_lead',
          analyzed_at: now
        })
        .select()
        .single();

      if (createError || !newLead) {
        ctxLog.error(createError, '[processIncomingMessage] Failed to create lead', {
          phone: maskPhone(phone),
          instance: instanceName
        }, ['db']);

        logProcessingSummary(ctxLog, {
          success: false,
          finalStage: currentStage,
          errorMessage: 'Failed to create lead'
        });

        return { processed: false, reason: 'lead_create_error', correlationId: ctxLog.context.correlationId };
      }

      lead = newLead;
      ctxLog.info({ leadId: maskUuid(newLead.id) }, '[processIncomingMessage] New lead created', ['db']);
    }

    // Обновляем контекст с данными лида
    ctxLog.updateContext({ leadId: lead.id });

    logDbOperation(ctxLog, 'select', 'dialog_analysis', {
      leadId: maskUuid(lead.id),
      contactName: lead.contact_name,
      funnelStage: lead.funnel_stage,
      botPaused: lead.bot_paused,
      assignedToHuman: lead.assigned_to_human
    }, true);

    // === Отмена pending follow-ups при входящем сообщении ===
    try {
      const cancelledCount = await cancelPendingFollowUps(lead.id);
      if (cancelledCount > 0) {
        ctxLog.info({ cancelledCount, leadId: maskUuid(lead.id) }, '[processIncomingMessage] Cancelled pending follow-ups');
      }
    } catch (e) {
      ctxLog.warn({ error: (e as any)?.message }, '[processIncomingMessage] Failed to cancel follow-ups (non-fatal)');
    }

    // === ЭТАП 6: Проверить условия ответа ===
    logStageTransition(ctxLog, currentStage, 'conditions_checked');
    currentStage = 'conditions_checked';

    const { shouldRespond, reason } = shouldBotRespondWithConfig(lead, botConfig, sanitizedText, ctxLog);
    if (!shouldRespond) {
      ctxLog.info({
        reason,
        ...ctxLog.getTimings()
      }, '[processIncomingMessage] Bot should not respond');

      logProcessingSummary(ctxLog, {
        success: true, // Успешно обработали, но решили не отвечать
        finalStage: currentStage
      });

      return { processed: false, reason, correlationId: ctxLog.context.correlationId };
    }

    // Обработка разных типов сообщений
    // Используем sanitizedText вместо messageText
    let textToProcess = sanitizedText;

    ctxLog.debug({
      msgType: messageType,
      hasText: !!sanitizedText,
      textLength: sanitizedText?.length || 0
    }, '[processIncomingMessage] Processing message by type');

    switch (messageType) {
      case 'audio':
        ctxLog.debug({
          voiceEnabled: botConfig.voice_recognition_enabled
        }, '[processIncomingMessage] Processing audio message');

        if (!botConfig.voice_recognition_enabled) {
          ctxLog.info({
            hasDefault: !!botConfig.voice_default_response
          }, '[processIncomingMessage] Voice recognition disabled, sending default response');

          if (botConfig.voice_default_response) {
            await sendMessage({
              instanceName,
              phone,
              message: botConfig.voice_default_response
            });
          }
          return { processed: true, reason: 'voice_not_supported', correlationId: ctxLog.context.correlationId };
        }
        if (!messageText || messageText.trim() === '') {
          ctxLog.warn({}, '[processIncomingMessage] Empty audio message (no transcription)');
          return { processed: false, reason: 'empty_audio_message', correlationId: ctxLog.context.correlationId };
        }
        ctxLog.debug({ transcriptionLen: messageText.length }, '[processIncomingMessage] Audio has transcription');
        break;

      case 'image':
        ctxLog.debug({
          imageEnabled: botConfig.image_recognition_enabled
        }, '[processIncomingMessage] Processing image message');

        if (!botConfig.image_recognition_enabled) {
          ctxLog.info({
            hasDefault: !!botConfig.image_default_response
          }, '[processIncomingMessage] Image recognition disabled, sending default response');

          if (botConfig.image_default_response) {
            await sendMessage({
              instanceName,
              phone,
              message: botConfig.image_default_response
            });
          }
          return { processed: true, reason: 'image_not_supported', correlationId: ctxLog.context.correlationId };
        }
        if (!sanitizedText || sanitizedText.trim() === '') {
          ctxLog.warn({}, '[processIncomingMessage] Empty image message (no caption)');
          return { processed: false, reason: 'empty_image_message', correlationId: ctxLog.context.correlationId };
        }
        ctxLog.debug({ captionLen: sanitizedText.length }, '[processIncomingMessage] Image has caption');
        break;

      case 'document':
        ctxLog.debug({
          docEnabled: botConfig.document_recognition_enabled
        }, '[processIncomingMessage] Processing document message');

        if (!botConfig.document_recognition_enabled) {
          ctxLog.info({
            hasDefault: !!botConfig.document_default_response
          }, '[processIncomingMessage] Document recognition disabled, sending default response');

          if (botConfig.document_default_response) {
            await sendMessage({
              instanceName,
              phone,
              message: botConfig.document_default_response
            });
          }
          return { processed: true, reason: 'document_not_supported', correlationId: ctxLog.context.correlationId };
        }
        if (!sanitizedText || sanitizedText.trim() === '') {
          ctxLog.warn({}, '[processIncomingMessage] Empty document message (no caption)');
          return { processed: false, reason: 'empty_document_message', correlationId: ctxLog.context.correlationId };
        }
        ctxLog.debug({ captionLen: sanitizedText.length }, '[processIncomingMessage] Document has caption');
        break;

      case 'file':
        ctxLog.debug({
          fileMode: botConfig.file_handling_mode
        }, '[processIncomingMessage] Processing file message');

        if (botConfig.file_handling_mode === 'respond') {
          ctxLog.info({
            hasDefault: !!botConfig.file_default_response
          }, '[processIncomingMessage] File handling mode is respond');

          if (botConfig.file_default_response) {
            await sendMessage({
              instanceName,
              phone,
              message: botConfig.file_default_response
            });
          }
          return { processed: true, reason: 'file_responded', correlationId: ctxLog.context.correlationId };
        }
        ctxLog.info({}, '[processIncomingMessage] File ignored per config');
        return { processed: false, reason: 'file_ignored', correlationId: ctxLog.context.correlationId };

      case 'text':
      default:
        if (!sanitizedText || sanitizedText.trim() === '') {
          ctxLog.warn({ msgType: messageType }, '[processIncomingMessage] Empty text message');
          return { processed: false, reason: 'empty_message', correlationId: ctxLog.context.correlationId };
        }
        ctxLog.debug({ textLen: sanitizedText.length }, '[processIncomingMessage] Text message validated');
        break;
    }

    // === ЭТАП 7: Буферизация ===
    logStageTransition(ctxLog, currentStage, 'buffered');
    currentStage = 'buffered';

    ctxLog.info({
      textLen: textToProcess.length,
      bufferSec: botConfig.message_buffer_seconds
    }, '[processIncomingMessage] Adding to message buffer', ['redis']);

    await collectMessagesWithConfig(phone, instanceName, textToProcess, botConfig, app, ctxLog.context);

    logProcessingSummary(ctxLog, {
      success: true,
      finalStage: currentStage
    });

    ctxLog.info({
      msgType: messageType,
      ...ctxLog.getTimings()
    }, '[processIncomingMessage] Message queued for processing successfully');

    return { processed: true, correlationId: ctxLog.context.correlationId };
  } catch (error: any) {
    ctxLog.error(error, '[processIncomingMessage] Unexpected error processing message', {
      msgType: messageType,
      ...ctxLog.getTimings()
    });

    logProcessingSummary(ctxLog, {
      success: false,
      finalStage: currentStage,
      errorMessage: error?.message
    });

    return { processed: false, reason: 'error', correlationId: ctxLog.context.correlationId };
  }
}
