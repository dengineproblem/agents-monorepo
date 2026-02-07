import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

import axios from 'axios';
import OpenAI from 'openai';
import {
  ASSISTANT_NAME,
  DATA_DIR,
  TELEGRAM_BOT_TOKEN,
  ANTHROPIC_API_KEY,
  OPENAI_API_KEY,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  POLL_INTERVAL,
  TRIGGER_PATTERN,
  TIMEZONE,
} from './config.js';
// import {
//   runContainerAgent,
// } from './container-runner.js';
import {
  getAllChats,
  getMessagesSince,
  getNewMessages,
  initDatabase,
  storeChatMetadata,
  storeMessage,
  updateChatName,
} from './db.js';
// import { startSchedulerLoop } from './task-scheduler.js'; // отключен пока
import { NewMessage, Session } from './types.js';
import { loadJson, saveJson } from './utils.js';
import { logger } from './logger.js';
import { tools, executeTool } from './tools.js';

// Web Search tool — встроенный в Anthropic API, обрабатывается server-side
const webSearchTool: Anthropic.Messages.WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 5,
  user_location: {
    type: 'approximate',
    country: 'KZ',
    timezone: 'Asia/Almaty',
  },
};

let bot: TelegramBot;
let anthropic: Anthropic;
let openai: OpenAI | null = null;
let lastTimestamp = '';
let sessions: Session = {};
let lastAgentTimestamp: Record<string, string> = {};

// Кэш telegram_id → userAccountId (UUID)
const userAccountCache = new Map<number, string>();

/**
 * Резолв telegram_id → userAccountId через Supabase REST API
 */
async function resolveUserAccountId(telegramId: number): Promise<string | null> {
  // Проверяем кэш
  const cached = userAccountCache.get(telegramId);
  if (cached) return cached;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    logger.warn('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured — cannot resolve userAccountId');
    return null;
  }

  try {
    const response = await axios.get(
      `${SUPABASE_URL}/rest/v1/user_accounts?telegram_id=eq.${telegramId}&select=id`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (response.data && response.data.length > 0) {
      const userId = response.data[0].id;
      userAccountCache.set(telegramId, userId);
      logger.info({ telegramId, userAccountId: userId }, 'Resolved userAccountId');
      return userId;
    }

    logger.warn({ telegramId }, 'User not found in user_accounts');
    return null;
  } catch (error: any) {
    logger.error({ error: error.message, telegramId }, 'Failed to resolve userAccountId');
    return null;
  }
}

/**
 * Транскрибация голосового сообщения через OpenAI Whisper
 */
async function transcribeVoice(fileId: string): Promise<string | null> {
  if (!openai) {
    logger.warn('OpenAI not configured — cannot transcribe voice');
    return null;
  }

  try {
    // Получить URL файла от Telegram
    const fileLink = await bot.getFileLink(fileId);

    // Скачать файл
    const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    // Создать File объект для OpenAI
    const file = new File([buffer], 'voice.ogg', { type: 'audio/ogg' });

    // Транскрибация через Whisper
    const transcription = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      language: 'ru',
    });

    logger.info({ textLength: transcription.text.length }, 'Voice transcribed');
    return transcription.text;
  } catch (error: any) {
    logger.error({ error: error.message }, 'Voice transcription failed');
    return null;
  }
}

// Проверка конфигурации
if (!TELEGRAM_BOT_TOKEN) {
  logger.error('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

if (!ANTHROPIC_API_KEY) {
  logger.error('ANTHROPIC_API_KEY is required');
  process.exit(1);
}

function loadState(): void {
  const statePath = path.join(DATA_DIR, 'router_state.json');
  const state = loadJson<{
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
  }>(statePath, {});
  lastTimestamp = state.last_timestamp || '';
  lastAgentTimestamp = state.last_agent_timestamp || {};
  sessions = loadJson(path.join(DATA_DIR, 'sessions.json'), {});
  logger.info('State loaded');
}

function saveState(): void {
  saveJson(path.join(DATA_DIR, 'router_state.json'), {
    last_timestamp: lastTimestamp,
    last_agent_timestamp: lastAgentTimestamp,
  });
  saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
}

/**
 * Обработка входящего сообщения от Telegram
 */
async function handleMessage(msg: TelegramBot.Message): Promise<void> {
  try {
    const chatId = msg.chat.id.toString();
    let messageText = msg.text || '';
    const messageId = msg.message_id.toString();
    const timestamp = new Date(msg.date * 1000).toISOString();
    const senderName = msg.from?.username || msg.from?.first_name || 'Unknown';

    // Голосовые сообщения и видеосообщения (кружочки) → транскрибация
    const voiceFileId = msg.voice?.file_id || msg.video_note?.file_id;
    if (voiceFileId && !messageText) {
      logger.info({ chatId, fileId: voiceFileId }, 'Voice message received, transcribing...');
      const transcribed = await transcribeVoice(voiceFileId);
      if (transcribed) {
        messageText = transcribed;
        logger.info({ chatId, text: transcribed.substring(0, 80) }, 'Voice transcribed');
      } else {
        await bot.sendMessage(chatId, 'Не удалось распознать голосовое сообщение.');
        return;
      }
    }

    // Фотографии → получить URL для использования как референс
    let photoUrl: string | null = null;
    if (msg.photo && msg.photo.length > 0) {
      // Берём самое большое фото (последний элемент массива)
      const largestPhoto = msg.photo[msg.photo.length - 1];
      try {
        photoUrl = await bot.getFileLink(largestPhoto.file_id);
        logger.info({ chatId, photoUrl }, 'Photo received as reference');
        // Добавить информацию о фото в текст сообщения
        const photoCaption = msg.caption || '';
        messageText = photoCaption
          ? `${photoCaption}\n\n[Пользователь приложил референс-изображение: ${photoUrl}]`
          : `[Пользователь отправил референс-изображение: ${photoUrl}]`;
      } catch (err: any) {
        logger.error({ error: err.message }, 'Failed to get photo link');
      }
    }

    logger.info({
      chatId,
      messageId,
      text: messageText.substring(0, 50),
      sender: senderName,
    }, 'Received message');

    // Сохранить метаданные чата
    const chatName = msg.chat.title || msg.chat.username || msg.chat.first_name || chatId;
    storeChatMetadata(chatId, chatName);

    // Сохранить сообщение в БД
    storeMessage({
      id: messageId,
      chat_id: chatId,
      sender: senderName,
      text: messageText,
      timestamp,
      is_from_me: false,
    });

    // В личных чатах — отвечаем на всё, в группах — только по триггеру /bot или @Claude
    const isPrivateChat = msg.chat.type === 'private';
    const isTrigger = TRIGGER_PATTERN.test(messageText);

    if (!isPrivateChat && !isTrigger) {
      logger.debug({ chatId, messageText }, 'Message not triggered (group chat)');
      return;
    }

    // Удалить триггер из сообщения (если есть)
    const cleanedMessage = isTrigger
      ? messageText.replace(TRIGGER_PATTERN, '').trim()
      : messageText.trim();

    logger.info({ chatId, cleanedMessage }, 'Processing agent request');

    // Резолв telegram_id → userAccountId
    const telegramId = msg.from?.id;
    let userAccountId: string | null = null;
    if (telegramId) {
      userAccountId = await resolveUserAccountId(telegramId);
    }

    if (!userAccountId) {
      await bot.sendMessage(chatId, 'Ваш Telegram аккаунт не привязан к системе. Обратитесь к администратору.');
      return;
    }

    // Показать "печатает..."
    await bot.sendChatAction(chatId, 'typing');

    // Системный промпт с userAccountId
    const baseSystemPrompt = fs.readFileSync(path.join(DATA_DIR, '..', 'groups', 'main', 'CLAUDE.md'), 'utf-8');
    const systemPrompt = `userAccountId пользователя: ${userAccountId}\n\nВсегда используй этот userAccountId при вызове tools.\n\n${baseSystemPrompt}`;

    // История сообщений для multi-turn разговора с tools
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: cleanedMessage,
      },
    ];

    let agentResponse = '';
    let continueLoop = true;
    let turnCount = 0;
    const MAX_TURNS = 10; // Защита от бесконечного цикла

    // Цикл Tool Use: запрос → tool_use → выполнение → результат → финальный ответ
    while (continueLoop && turnCount < MAX_TURNS) {
      turnCount++;

      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: systemPrompt,
        tools: [...tools, webSearchTool],
        messages,
      });

      logger.info({
        chatId,
        turnCount,
        stopReason: response.stop_reason,
        contentBlocks: response.content.length,
      }, 'Claude response received');

      // Добавить ответ Claude в историю
      messages.push({
        role: 'assistant',
        content: response.content,
      });

      // Проверить, нужно ли выполнить tools
      if (response.stop_reason === 'tool_use') {
        await bot.sendChatAction(chatId, 'typing');

        // Собираем только custom tool_use блоки (НЕ server_tool_use — web search обрабатывается server-side)
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            logger.info({ toolName: block.name, toolId: block.id }, 'Executing tool');

            // Всегда инжектим userAccountId в tool input
            const toolInput = { ...(block.input as Record<string, any>), userAccountId };
            const result = await executeTool(block.name, toolInput);

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
          // server_tool_use и web_search_tool_result пропускаем — они уже в response.content
        }

        if (toolResults.length > 0) {
          // Добавить результаты tools в историю
          messages.push({
            role: 'user',
            content: toolResults,
          });
        }

        // Продолжить цикл - отправить результаты обратно в Claude
        continue;
      }

      // pause_turn — web search может вернуть для долгих запросов
      if (response.stop_reason === 'pause_turn') {
        await bot.sendChatAction(chatId, 'typing');
        continue;
      }

      // Если stop_reason === 'end_turn' - это финальный ответ
      if (response.stop_reason === 'end_turn') {
        // Собрать текстовый ответ + citations от web search
        const citations: Array<{ url: string; title: string }> = [];

        for (const block of response.content) {
          if (block.type === 'text') {
            agentResponse += block.text;
            // Собрать citations из web search результатов
            if ('citations' in block && Array.isArray((block as any).citations)) {
              for (const cite of (block as any).citations) {
                if (cite.type === 'web_search_result_location' && cite.url && cite.title) {
                  citations.push({ url: cite.url, title: cite.title });
                }
              }
            }
          }
        }

        // Добавить уникальные источники в конец ответа
        if (citations.length > 0) {
          const uniqueCitations = [...new Map(citations.map(c => [c.url, c])).values()];
          agentResponse += '\n\n📎 Источники:\n';
          for (const cite of uniqueCitations.slice(0, 5)) {
            agentResponse += `• ${cite.title}: ${cite.url}\n`;
          }
        }

        continueLoop = false;
      } else {
        // Неожиданная причина остановки
        logger.warn({ stopReason: response.stop_reason }, 'Unexpected stop reason');
        continueLoop = false;
      }
    }

    if (!agentResponse || !agentResponse.trim()) {
      logger.warn({ chatId, turnCount }, 'Agent returned empty response');
      await bot.sendMessage(chatId, 'Извините, произошла ошибка при обработке запроса.');
      return;
    }

    // Отправить ответ (с fallback если Markdown невалидный для Telegram)
    try {
      await bot.sendMessage(chatId, agentResponse, {
        parse_mode: 'Markdown',
        reply_to_message_id: msg.message_id,
      });
    } catch (sendError: any) {
      if (sendError.message?.includes("can't parse entities")) {
        logger.warn('Markdown parse failed, sending without formatting');
        await bot.sendMessage(chatId, agentResponse, {
          reply_to_message_id: msg.message_id,
        });
      } else {
        throw sendError;
      }
    }

    // Сохранить ответ бота в БД
    storeMessage({
      id: `${messageId}-response`,
      chat_id: chatId,
      sender: ASSISTANT_NAME,
      text: agentResponse,
      timestamp: new Date().toISOString(),
      is_from_me: true,
    });

    logger.info({ chatId, responseLength: agentResponse.length, turns: turnCount }, 'Response sent');
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Error handling message');
    try {
      await bot.sendMessage(msg.chat.id, 'Произошла ошибка при обработке вашего запроса.');
    } catch (sendError) {
      logger.error({ error: sendError }, 'Failed to send error message');
    }
  }
}

/**
 * Инициализация бота
 */
async function initBot(): Promise<void> {
  logger.info('Initializing Telegram Claude Bot...');

  // Создать директории
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, '..', 'groups', 'main'), { recursive: true });

  // Инициализация БД
  initDatabase();

  // Загрузить состояние
  loadState();

  // Создать клиент Anthropic
  anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  // Создать клиент OpenAI (для Whisper транскрибации голосовых)
  if (OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    logger.info('OpenAI client initialized (voice transcription enabled)');
  } else {
    logger.warn('OPENAI_API_KEY not set — voice messages will not be transcribed');
  }

  // Создать бота
  bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

  // Обработка сообщений
  bot.on('message', handleMessage);

  // Обработка ошибок polling
  bot.on('polling_error', (error) => {
    logger.error({ error: error.message }, 'Polling error');
  });

  // Запустить планировщик задач (пока отключен для Telegram)
  // startSchedulerLoop();

  const me = await bot.getMe();
  logger.info({
    botName: me.username,
    assistantName: ASSISTANT_NAME,
  }, 'Bot started successfully');

  console.log(`🤖 Telegram Claude Bot started`);
  console.log(`📱 Bot username: @${me.username}`);
  console.log(`🔑 Trigger pattern: /bot или @${ASSISTANT_NAME}`);
}

// Обработка завершения
process.on('SIGINT', () => {
  logger.info('Shutting down...');
  saveState();
  if (bot) bot.stopPolling({});
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  saveState();
  if (bot) bot.stopPolling({});
  process.exit(0);
});

// Запуск
initBot().catch((error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Failed to start bot');
  process.exit(1);
});
