/**
 * Telegram Webhook
 *
 * Обрабатывает входящие сообщения от пользователей в Telegram
 * - Сохраняет сообщения в admin_user_chats
 * - Отправляет уведомление в группу техподдержки
 *
 * @module routes/telegramWebhook
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { notifyAdminGroup, APP_BASE_URL } from '../lib/notificationService.js';

const log = createLogger({ module: 'telegramWebhook' });

const TELEGRAM_BOT_TOKEN = '7263071246:AAFC4r0v5NzTNoZjO-wYPf2_-PAg7SwNXBc';
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// =====================================================
// Типы Telegram API
// =====================================================

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  date: number;
  text?: string;
  chat: {
    id: number;
    type: string;
  };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

// =====================================================
// Routes
// =====================================================

export default async function telegramWebhook(app: FastifyInstance) {

  /**
   * POST /telegram/webhook
   * Обрабатывает входящие сообщения от Telegram
   */
  app.post('/telegram/webhook', async (req, res) => {
    try {
      const update = req.body as TelegramUpdate;

      // Игнорируем если нет сообщения или текста
      if (!update.message?.text || !update.message?.from?.id) {
        return res.send({ ok: true });
      }

      const message = update.message;
      const telegramId = String(message.from!.id);
      const messageText = message.text!;
      const telegramMessageId = message.message_id;

      log.info({
        telegramId,
        messageText: messageText.substring(0, 100),
        messageId: telegramMessageId
      }, 'Received message from Telegram');

      // Ищем пользователя по telegram_id
      const { data: user, error: userError } = await supabase
        .from('user_accounts')
        .select('id, username')
        .eq('telegram_id', telegramId)
        .single();

      if (userError || !user) {
        // Игнорируем сообщения от неизвестных пользователей
        log.debug({ telegramId }, 'Message from unknown user, ignoring');
        return res.send({ ok: true });
      }

      // Сохраняем сообщение в БД
      const { error: insertError } = await supabase
        .from('admin_user_chats')
        .insert({
          user_account_id: user.id,
          direction: 'from_user',
          message: messageText,
          telegram_message_id: telegramMessageId,
          delivered: true
        });

      if (insertError) {
        log.error({ error: insertError.message, userId: user.id }, 'Failed to save user message');
      } else {
        log.info({ userId: user.id, username: user.username }, 'User message saved');
      }

      // Уведомляем админов в группу
      const adminNotification = `<b>Новое сообщение от ${user.username || 'пользователя'}</b>

${escapeHtml(messageText)}

<a href="${APP_BASE_URL}/admin/onboarding">Ответить в админке</a>`;

      notifyAdminGroup(adminNotification).catch(err => {
        log.error({ error: String(err) }, 'Failed to notify admin group');
      });

      return res.send({ ok: true });
    } catch (err) {
      log.error({ error: String(err) }, 'Error processing telegram webhook');
      return res.send({ ok: true }); // Всегда отвечаем 200 чтобы Telegram не повторял
    }
  });

  /**
   * GET /telegram/webhook
   * Проверка работоспособности endpoint
   */
  app.get('/telegram/webhook', async (_req, res) => {
    return res.send({ ok: true, message: 'Telegram webhook is active' });
  });

  /**
   * POST /telegram/setup-webhook
   * Настраивает webhook в Telegram API (вызывать один раз при деплое)
   */
  app.post('/telegram/setup-webhook', async (req, res) => {
    try {
      const { webhook_url } = req.body as { webhook_url?: string };

      const url = webhook_url || 'https://api.performanteaiagency.com/telegram/webhook';

      log.info({ webhookUrl: url }, 'Setting up Telegram webhook');

      const response = await fetch(`${TELEGRAM_API_URL}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          allowed_updates: ['message']
        })
      });

      const result = await response.json();

      if (result.ok) {
        log.info({ result }, 'Telegram webhook set successfully');
        return res.send({ success: true, result });
      } else {
        log.error({ result }, 'Failed to set Telegram webhook');
        return res.status(400).send({ success: false, error: result.description });
      }
    } catch (err) {
      log.error({ error: String(err) }, 'Error setting up Telegram webhook');
      return res.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  /**
   * GET /telegram/webhook-info
   * Получает информацию о текущем webhook
   */
  app.get('/telegram/webhook-info', async (_req, res) => {
    try {
      const response = await fetch(`${TELEGRAM_API_URL}/getWebhookInfo`);
      const result = await response.json();

      return res.send(result);
    } catch (err) {
      log.error({ error: String(err) }, 'Error getting webhook info');
      return res.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  /**
   * DELETE /telegram/webhook
   * Удаляет текущий webhook
   */
  app.delete('/telegram/webhook', async (_req, res) => {
    try {
      const response = await fetch(`${TELEGRAM_API_URL}/deleteWebhook`);
      const result = await response.json();

      if (result.ok) {
        log.info('Telegram webhook deleted');
        return res.send({ success: true });
      } else {
        return res.status(400).send({ success: false, error: result.description });
      }
    } catch (err) {
      log.error({ error: String(err) }, 'Error deleting webhook');
      return res.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
}

// =====================================================
// Вспомогательные функции
// =====================================================

/**
 * Экранирует HTML символы для Telegram
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
