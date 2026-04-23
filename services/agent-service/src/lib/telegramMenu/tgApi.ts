/**
 * Тонкие обёртки над Telegram Bot API (без зависимости от node-telegram-bot-api / grammY).
 * Используются menu-модулем для редактирования сообщений и ответа на callback_query.
 */

import { createLogger } from '../logger.js';

const log = createLogger({ module: 'telegramMenuApi' });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

async function call(method: string, payload: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${TELEGRAM_API_URL}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json: any = await res.json();
  if (!json.ok) {
    const err: any = new Error(json.description || `Telegram ${method} failed`);
    err.code = json.error_code;
    err.description = json.description;
    throw err;
  }
  return json.result;
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  options: { parse_mode?: 'Markdown' | 'HTML'; reply_markup?: InlineKeyboardMarkup } = {},
): Promise<{ message_id: number }> {
  return call('sendMessage', { chat_id: chatId, text, ...options });
}

export async function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  options: { parse_mode?: 'Markdown' | 'HTML'; reply_markup?: InlineKeyboardMarkup } = {},
): Promise<any> {
  return call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...options,
  });
}

export async function editMessageReplyMarkup(
  chatId: number | string,
  messageId: number,
  reply_markup: InlineKeyboardMarkup,
): Promise<any> {
  return call('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup,
  });
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  options: { text?: string; show_alert?: boolean } = {},
): Promise<any> {
  return call('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...options,
  });
}

/**
 * Безопасное редактирование с fallback: если Markdown-ошибка или сообщение слишком длинное —
 * пробуем без parse_mode или отправляем новым сообщением.
 */
export async function safeEditOrSend(
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  try {
    await editMessageText(chatId, messageId, text, { parse_mode: 'Markdown' });
  } catch (e: any) {
    const errMsg = e?.description || e?.message || '';
    log.warn({ error: errMsg, chatId, textLen: text.length }, 'safeEditOrSend: edit failed, fallback');

    if (errMsg.includes("can't parse entities") || /parse/i.test(errMsg)) {
      try {
        await editMessageText(chatId, messageId, text);
      } catch {
        try { await sendMessage(chatId, text); } catch { /* last resort */ }
      }
    } else if (/message is too long/i.test(errMsg) || /MESSAGE_TOO_LONG/i.test(errMsg)) {
      try {
        await sendMessage(chatId, text, { parse_mode: 'Markdown' });
      } catch {
        try { await sendMessage(chatId, text); } catch { /* last resort */ }
      }
    } else if (/message is not modified/i.test(errMsg)) {
      // игнор
    } else {
      try {
        await sendMessage(chatId, text, { parse_mode: 'Markdown' });
      } catch {
        try { await sendMessage(chatId, text); } catch { /* last resort */ }
      }
    }
  }
}
