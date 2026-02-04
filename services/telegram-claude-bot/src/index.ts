import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  TELEGRAM_BOT_TOKEN,
  ANTHROPIC_API_KEY,
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

let bot: TelegramBot;
let anthropic: Anthropic;
let lastTimestamp = '';
let sessions: Session = {};
let lastAgentTimestamp: Record<string, string> = {};

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
    const messageText = msg.text || '';
    const messageId = msg.message_id.toString();
    const timestamp = new Date(msg.date * 1000).toISOString();
    const senderName = msg.from?.username || msg.from?.first_name || 'Unknown';

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

    // Проверить, адресовано ли сообщение боту
    const isTrigger = TRIGGER_PATTERN.test(messageText);

    if (!isTrigger) {
      logger.debug({ chatId, messageText }, 'Message not triggered');
      return;
    }

    // Удалить триггер из сообщения
    const cleanedMessage = messageText.replace(TRIGGER_PATTERN, '').trim();

    logger.info({ chatId, cleanedMessage }, 'Processing agent request');

    // Показать "печатает..."
    await bot.sendChatAction(chatId, 'typing');

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
        model: 'claude-3-5-haiku-20241022', // Haiku 4.5
        max_tokens: 4096,
        system: fs.readFileSync(path.join(DATA_DIR, '..', 'groups', 'main', 'CLAUDE.md'), 'utf-8'),
        tools,
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

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            logger.info({ toolName: block.name, toolId: block.id }, 'Executing tool');

            const result = await executeTool(block.name, block.input as Record<string, any>);

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }

        // Добавить результаты tools в историю
        messages.push({
          role: 'user',
          content: toolResults,
        });

        // Продолжить цикл - отправить результаты обратно в Claude
        continue;
      }

      // Если stop_reason === 'end_turn' - это финальный ответ
      if (response.stop_reason === 'end_turn') {
        // Собрать текстовый ответ
        for (const block of response.content) {
          if (block.type === 'text') {
            agentResponse += block.text;
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

    // Отправить ответ
    await bot.sendMessage(chatId, agentResponse, {
      parse_mode: 'Markdown',
      reply_to_message_id: msg.message_id,
    });

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
