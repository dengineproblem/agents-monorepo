/**
 * TelegramCtxAdapter
 *
 * Минимальный grammY-совместимый ctx из telegramChatId + botToken.
 * Используется когда сообщение приходит через webhook (agent-service), а handleTelegramMessage
 * ожидает grammY-style контекст с ctx.reply / ctx.api.editMessageText.
 *
 * Поддерживает только то, что нужно TelegramStreamer и sendApprovalButtons:
 *   - ctx.chat.id
 *   - ctx.reply(text, options) → { message_id }
 *   - ctx.api.editMessageText(chatId, messageId, text, options)
 *   - ctx.api.sendChatAction(chatId, action)
 *
 * Кликать inline-кнопки можно — их рендеринг работает (sendApprovalButtons передаёт reply_markup),
 * но обработка callback_query — в отдельном webhook-роуте agent-service. Текстовая альтернатива
 * "да"/"нет" обрабатывается handleTextApproval автоматически.
 */

import { logger } from '../lib/logger.js';

const TELEGRAM_API = 'https://api.telegram.org';

class TelegramApi {
  constructor(botToken) {
    this.botToken = botToken;
    this.baseUrl = `${TELEGRAM_API}/bot${botToken}`;
  }

  async _call(method, payload) {
    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!json.ok) {
      const err = new Error(json.description || `Telegram ${method} failed`);
      err.code = json.error_code;
      throw err;
    }
    return json.result;
  }

  async sendMessage(chatId, text, options = {}) {
    return this._call('sendMessage', {
      chat_id: chatId,
      text,
      ...options
    });
  }

  // grammY positional signature: editMessageText(chatId, messageId, text, options)
  async editMessageText(chatId, messageId, text, options = {}) {
    return this._call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...options
    });
  }

  async sendChatAction(chatId, action) {
    return this._call('sendChatAction', {
      chat_id: chatId,
      action
    });
  }

  async answerCallbackQuery(callbackQueryId, options = {}) {
    return this._call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...options
    });
  }
}

export class TelegramCtxAdapter {
  /**
   * @param {Object} params
   * @param {string|number} params.telegramChatId - Telegram chat ID
   * @param {string} params.botToken - Bot token (from BOT_FATHER)
   * @param {Object} [params.from] - Optional Telegram user object
   * @param {string|number} [params.messageId] - ID of incoming message (for replies)
   */
  constructor({ telegramChatId, botToken, from = null, messageId = null }) {
    if (!botToken) {
      throw new Error('TelegramCtxAdapter: botToken is required');
    }
    if (!telegramChatId) {
      throw new Error('TelegramCtxAdapter: telegramChatId is required');
    }

    this._chatId = Number(telegramChatId);
    this.api = new TelegramApi(botToken);
    this.chat = { id: this._chatId };
    this.from = from;
    this.message = messageId ? { message_id: Number(messageId) } : null;
  }

  /**
   * grammY-style ctx.reply — отправляет в текущий чат
   * @param {string} text
   * @param {Object} [options] - parse_mode, reply_markup, etc.
   * @returns {Promise<{message_id: number}>}
   */
  async reply(text, options = {}) {
    try {
      return await this.api.sendMessage(this._chatId, text, options);
    } catch (error) {
      logger.warn({ error: error.message, chatId: this._chatId }, 'TelegramCtxAdapter.reply failed');
      throw error;
    }
  }

  /**
   * grammY-style ctx.editMessageText — редактирует сообщение из callback_query
   * (для legacy AI чата без callback handling вызывается редко, но оставляем для approvalHandler)
   */
  async editMessageText(text, options = {}) {
    if (!this.message?.message_id) {
      throw new Error('TelegramCtxAdapter.editMessageText: no message_id in context');
    }
    return this.api.editMessageText(this._chatId, this.message.message_id, text, options);
  }

  /**
   * grammY-style ctx.answerCallbackQuery — ответ на callback_query
   * (no-op если callback не пришёл — для совместимости)
   */
  async answerCallbackQuery(options = {}) {
    if (!this.callbackQueryId) {
      logger.debug({ chatId: this._chatId }, 'answerCallbackQuery called without callback_query — no-op');
      return null;
    }
    return this.api.answerCallbackQuery(this.callbackQueryId, options);
  }
}

export default TelegramCtxAdapter;
