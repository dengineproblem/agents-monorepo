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
  try {
    // Сначала получаем инстанс с привязанным ботом
    const { data: instance, error: instanceError } = await supabase
      .from('whatsapp_instances')
      .select('ai_bot_id, user_account_id')
      .eq('instance_name', instanceName)
      .maybeSingle();

    if (instanceError || !instance) {
      log.warn({ instanceName }, 'Instance not found');
      return null;
    }

    // Если бот привязан - используем его
    if (instance.ai_bot_id) {
      const { data: bot, error: botError } = await supabase
        .from('ai_bot_configurations')
        .select('*')
        .eq('id', instance.ai_bot_id)
        .eq('is_active', true)
        .maybeSingle();

      if (botError) {
        log.error({ error: botError, botId: instance.ai_bot_id }, 'Error fetching bot config');
        return null;
      }

      if (bot) {
        log.debug({ botId: bot.id, botName: bot.name }, 'Using linked bot');
        return bot;
      }
    }

    // Если бот не привязан - ищем активного бота пользователя
    const { data: defaultBot, error: defaultError } = await supabase
      .from('ai_bot_configurations')
      .select('*')
      .eq('user_account_id', instance.user_account_id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (defaultError) {
      log.error({ error: defaultError }, 'Error fetching default bot');
      return null;
    }

    if (defaultBot) {
      log.debug({ botId: defaultBot.id, botName: defaultBot.name }, 'Using default active bot');
      return defaultBot;
    }

    log.warn({ instanceName, userAccountId: instance.user_account_id }, 'No active bot found');
    return null;
  } catch (error: any) {
    log.error({ error: error.message, instanceName }, 'Error in getBotConfigForInstance');
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
  // 1. Бот не активен
  if (!botConfig.is_active) {
    return { shouldRespond: false, reason: 'bot_inactive' };
  }

  // 2. Менеджер взял в работу
  if (lead.assigned_to_human) {
    return { shouldRespond: false, reason: 'assigned_to_human' };
  }

  // 3. Бот на паузе
  if (lead.bot_paused) {
    // Проверить resume_phrases - если сообщение содержит фразу возобновления, снять паузу
    if (messageText && botConfig.resume_phrases?.length > 0) {
      const lowerMessage = messageText.toLowerCase();
      const shouldResume = botConfig.resume_phrases.some(phrase =>
        lowerMessage.includes(phrase.toLowerCase())
      );
      if (shouldResume) {
        // Пауза будет снята в processIncomingMessage
        return { shouldRespond: true, reason: 'resume_phrase_detected' };
      }
    }
    return { shouldRespond: false, reason: 'bot_paused' };
  }

  // 4. Пауза с таймаутом
  if (lead.bot_paused_until) {
    const pausedUntil = new Date(lead.bot_paused_until);
    if (pausedUntil > new Date()) {
      return { shouldRespond: false, reason: 'bot_paused_temporarily' };
    }
  }

  // 5. Проверить stop_phrases - если сообщение содержит стоп-фразу, поставить на паузу
  if (messageText && botConfig.stop_phrases?.length > 0) {
    const lowerMessage = messageText.toLowerCase();
    const shouldStop = botConfig.stop_phrases.some(phrase =>
      lowerMessage.includes(phrase.toLowerCase())
    );
    if (shouldStop) {
      return { shouldRespond: false, reason: 'stop_phrase_detected' };
    }
  }

  // 6. Этапы воронки где бот молчит
  const silentStages = ['consultation_completed', 'deal_closed', 'deal_lost'];
  if (silentStages.includes(lead.funnel_stage)) {
    return { shouldRespond: false, reason: 'silent_stage' };
  }

  // 7. Проверка расписания
  if (botConfig.schedule_enabled) {
    if (!isWithinSchedule(botConfig)) {
      return { shouldRespond: false, reason: 'outside_schedule' };
    }
  }

  return { shouldRespond: true };
}

/**
 * Проверка расписания работы бота
 */
function isWithinSchedule(config: AIBotConfig): boolean {
  const now = new Date();

  // Получить время в часовом поясе бота
  const options: Intl.DateTimeFormatOptions = {
    timeZone: config.timezone || 'Asia/Yekaterinburg',
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

  // Проверка дня недели
  if (!config.schedule_days.includes(day)) {
    return false;
  }

  // Проверка времени
  if (hour < config.schedule_hours_start || hour >= config.schedule_hours_end) {
    return false;
  }

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

  // Добавить сообщение в очередь
  await redis.rpush(key, newMessage);
  await redis.expire(key, bufferSeconds + 5);

  // Проверить, есть ли уже таймер
  const timerId = `timer:${key}`;
  const exists = await redis.exists(timerId);

  if (!exists) {
    await redis.set(timerId, '1', 'EX', bufferSeconds);

    // Через N секунд обработать все сообщения
    setTimeout(async () => {
      try {
        const messages = await redis.lrange(key, 0, -1);
        await redis.del(key, timerId);

        if (messages.length > 0) {
          const combined = messages.join('\n');
          await processAIBotResponse(phone, instanceName, combined, botConfig, app);
        }
      } catch (error: any) {
        log.error({ error: error.message, phone, instanceName }, 'Error processing collected messages');
      }
    }, bufferSeconds * 1000);
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
  try {
    // Получить информацию о лиде
    const { data: lead } = await supabase
      .from('dialog_analysis')
      .select('*')
      .eq('contact_phone', phone)
      .eq('instance_name', instanceName)
      .maybeSingle();

    if (!lead) {
      log.warn({ phone, instanceName }, 'Lead not found');
      return;
    }

    // Проверить условия ответа
    const { shouldRespond, reason } = shouldBotRespondWithConfig(lead, botConfig, messageText);
    if (!shouldRespond) {
      // Если обнаружена стоп-фраза, поставить бота на паузу
      if (reason === 'stop_phrase_detected') {
        await supabase
          .from('dialog_analysis')
          .update({ bot_paused: true })
          .eq('id', lead.id);
        log.info({ leadId: lead.id }, 'Bot paused by stop phrase');
      }
      log.debug({ phone, leadId: lead.id, reason }, 'Bot should not respond');
      return;
    }

    // Если обнаружена фраза возобновления, снять паузу
    if (reason === 'resume_phrase_detected') {
      await supabase
        .from('dialog_analysis')
        .update({ bot_paused: false, bot_paused_until: null })
        .eq('id', lead.id);
      log.info({ leadId: lead.id }, 'Bot resumed by resume phrase');
    }

    // Создать клиент OpenAI (свой ключ или дефолтный)
    const apiKey = botConfig.custom_openai_api_key || OPENAI_API_KEY;
    if (!apiKey) {
      log.error({}, 'No OpenAI API key configured');
      return;
    }

    const openai = new OpenAI({ apiKey });

    // Генерировать ответ
    const response = await generateAIResponse(lead, messageText, botConfig, openai);

    if (!response.text) {
      log.debug({ phone }, 'No response generated');
      return;
    }

    // Очистить markdown если нужно
    let finalText = response.text;
    if (botConfig.clean_markdown) {
      finalText = cleanMarkdown(finalText);
    }

    // Разбить на части если нужно
    let chunks: string[];
    if (botConfig.split_messages) {
      chunks = splitMessage(finalText, botConfig.split_max_length);
    } else {
      chunks = [finalText];
    }

    // Отправить сообщения
    for (const chunk of chunks) {
      await sendMessage({
        instanceName,
        phone,
        message: chunk
      });

      if (chunks.length > 1) {
        await delay(2000); // 2 сек между частями
      }
    }

    // Обновить этап воронки если нужно
    if (response.moveToStage) {
      await supabase
        .from('dialog_analysis')
        .update({ funnel_stage: response.moveToStage })
        .eq('id', lead.id);

      log.info({ leadId: lead.id, newStage: response.moveToStage }, 'Moved to new funnel stage');
    }

    // Если нужен менеджер
    if (response.needsHuman) {
      await supabase
        .from('dialog_analysis')
        .update({ assigned_to_human: true, bot_paused: true })
        .eq('id', lead.id);

      log.info({ leadId: lead.id }, 'Lead transferred to human');
    }

    // Выполнить функцию если указана
    if (response.functionCall) {
      await handleFunctionCall(response.functionCall, lead, botConfig, app);
    }

    // Обновить время последнего сообщения
    await supabase
      .from('dialog_analysis')
      .update({ last_bot_message_at: new Date().toISOString() })
      .eq('id', lead.id);

    log.info({
      phone,
      leadId: lead.id,
      responseLength: finalText.length,
      chunks: chunks.length
    }, 'Bot response sent');

  } catch (error: any) {
    log.error({ error: error.message, phone, instanceName }, 'Error in processAIBotResponse');

    // Отправить сообщение об ошибке если настроено
    if (botConfig.error_message) {
      try {
        await sendMessage({
          instanceName,
          phone,
          message: botConfig.error_message
        });
      } catch (e) {
        log.error({ error: (e as any).message }, 'Failed to send error message');
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
  try {
    // Получить messages из dialog_analysis
    const { data: lead, error } = await supabase
      .from('dialog_analysis')
      .select('messages')
      .eq('id', leadId)
      .single();

    if (error || !lead?.messages) {
      log.debug({ leadId }, 'No message history found');
      return [];
    }

    // messages - это JSONB массив [{sender, content, timestamp}, ...]
    const rawMessages = Array.isArray(lead.messages) ? lead.messages : [];

    // Фильтровать по времени если задано
    const now = new Date();
    let filteredMessages = rawMessages;

    if (config.history_time_limit_hours) {
      const cutoff = new Date(now.getTime() - config.history_time_limit_hours * 60 * 60 * 1000);
      filteredMessages = rawMessages.filter((msg: any) => {
        const msgTime = new Date(msg.timestamp || msg.created_at || 0);
        return msgTime >= cutoff;
      });
    }

    // Ограничить количество сообщений (берём последние N)
    if (config.history_message_limit && filteredMessages.length > config.history_message_limit) {
      filteredMessages = filteredMessages.slice(-config.history_message_limit);
    }

    // Преобразовать в формат OpenAI с учётом токен-лимита
    let totalTokens = 0;
    const tokenLimit = config.history_token_limit || 10000;

    // Идём с конца (новые сообщения важнее) и добавляем пока не превысим лимит
    const reversedMessages = [...filteredMessages].reverse();
    const history: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    for (const msg of reversedMessages) {
      const content = msg.content || msg.text || '';
      const estimatedTokens = Math.ceil(content.length / 4);

      if (totalTokens + estimatedTokens > tokenLimit) {
        break;
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

    log.debug({ leadId, messageCount: history.length, estimatedTokens: totalTokens }, 'Loaded message history');
    return history;
  } catch (error: any) {
    log.error({ error: error.message, leadId }, 'Error loading message history');
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
  // Получить функции бота
  const { data: functions } = await supabase
    .from('ai_bot_functions')
    .select('*')
    .eq('bot_id', config.id)
    .eq('is_active', true);

  // Построить системный промпт
  let systemPrompt = config.system_prompt || 'Ты — AI-ассистент.';

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
    systemPrompt += `\n\nТекущая дата и время: ${formatter.format(now)}`;
  }

  // Добавить информацию о клиенте
  const clientInfo = `
Информация о клиенте:
- Имя: ${lead.contact_name || 'неизвестно'}
- Телефон: ${lead.contact_phone}
- Тип бизнеса: ${lead.business_type || 'неизвестно'}
- Уровень интереса: ${lead.interest_level || 'неизвестно'}
- Этап воронки: ${lead.funnel_stage}`;

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

  try {
    // Загрузить историю сообщений
    const history = await loadMessageHistory(lead.id, config);

    // Собрать массив сообщений: system + history + текущее
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt + clientInfo },
      ...history,
      { role: 'user', content: messageText }
    ];

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

    const completion = await openai.chat.completions.create(completionParams);

    const choice = completion.choices[0];

    // Проверить вызов функции
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      const toolCall = choice.message.tool_calls[0];
      return {
        text: choice.message.content || '',
        functionCall: {
          name: toolCall.function.name,
          arguments: JSON.parse(toolCall.function.arguments || '{}')
        }
      };
    }

    return {
      text: choice.message.content || ''
    };

  } catch (error: any) {
    log.error({ error: error.message }, 'Error calling OpenAI');
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
  try {
    // Получить конфигурацию функции
    const { data: func } = await supabase
      .from('ai_bot_functions')
      .select('*')
      .eq('bot_id', botConfig.id)
      .eq('name', functionCall.name)
      .eq('is_active', true)
      .maybeSingle();

    if (!func) {
      log.warn({ functionName: functionCall.name }, 'Function not found');
      return;
    }

    log.info({ functionName: functionCall.name, leadId: lead.id }, 'Executing bot function');

    switch (func.handler_type) {
      case 'forward_to_manager':
        // Передать менеджеру
        await supabase
          .from('dialog_analysis')
          .update({ assigned_to_human: true, bot_paused: true })
          .eq('id', lead.id);
        log.info({ leadId: lead.id }, 'Forwarded to manager');
        break;

      case 'internal':
        // Внутренняя обработка
        if (functionCall.name === 'save_user_data') {
          await supabase
            .from('dialog_analysis')
            .update(functionCall.arguments)
            .eq('id', lead.id);
          log.info({ leadId: lead.id, data: functionCall.arguments }, 'User data saved');
        }
        break;

      case 'webhook':
        // Вызов внешнего webhook
        if (func.handler_config?.url) {
          try {
            await fetch(func.handler_config.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                function: functionCall.name,
                arguments: functionCall.arguments,
                lead: {
                  id: lead.id,
                  phone: lead.contact_phone,
                  name: lead.contact_name
                }
              })
            });
            log.info({ functionName: functionCall.name, url: func.handler_config.url }, 'Webhook called');
          } catch (e) {
            log.error({ error: (e as any).message }, 'Webhook call failed');
          }
        }
        break;
    }
  } catch (error: any) {
    log.error({ error: error.message, functionName: functionCall.name }, 'Error handling function call');
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
  try {
    // Получить конфигурацию бота для этого инстанса
    const botConfig = await getBotConfigForInstance(instanceName);

    if (!botConfig) {
      return { processed: false, reason: 'no_bot_config' };
    }

    // Получить информацию о лиде
    const { data: lead } = await supabase
      .from('dialog_analysis')
      .select('*')
      .eq('contact_phone', phone)
      .eq('instance_name', instanceName)
      .maybeSingle();

    if (!lead) {
      return { processed: false, reason: 'lead_not_found' };
    }

    // Проверить, должен ли бот ответить
    const { shouldRespond, reason } = shouldBotRespondWithConfig(lead, botConfig);
    if (!shouldRespond) {
      return { processed: false, reason };
    }

    // Обработка разных типов сообщений
    let textToProcess = messageText;

    switch (messageType) {
      case 'audio':
        if (!botConfig.voice_recognition_enabled) {
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
          return { processed: false, reason: 'empty_audio_message' };
        }
        break;

      case 'image':
        if (!botConfig.image_recognition_enabled) {
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
          return { processed: false, reason: 'empty_image_message' };
        }
        break;

      case 'document':
        if (!botConfig.document_recognition_enabled) {
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
          return { processed: false, reason: 'empty_document_message' };
        }
        break;

      case 'file':
        if (botConfig.file_handling_mode === 'respond') {
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
        return { processed: false, reason: 'file_ignored' };

      case 'text':
      default:
        // Проверить что текст не пустой
        if (!messageText || messageText.trim() === '') {
          return { processed: false, reason: 'empty_message' };
        }
        break;
    }

    // Склеить сообщения с настраиваемым буфером
    await collectMessagesWithConfig(phone, instanceName, textToProcess, botConfig, app);

    return { processed: true };
  } catch (error: any) {
    log.error({ error: error.message, phone, instanceName }, 'Error in processIncomingMessage');
    return { processed: false, reason: 'error' };
  }
}
