/**
 * Support Bot Telegram Webhook
 *
 * Обрабатывает входящие сообщения от Support бота (техподдержка)
 * - Сохраняет сообщения в admin_user_chats с source='support'
 * - Уведомляет админов о новых сообщениях
 *
 * @module routes/supportBotWebhook
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { notifyAdminGroup, APP_BASE_URL } from '../lib/notificationService.js';

const log = createLogger({ module: 'supportBotWebhook' });

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

export default async function supportBotWebhook(app: FastifyInstance) {

  /**
   * POST /telegram/support-webhook
   * Обрабатывает входящие сообщения от Support бота
   */
  app.post('/telegram/support-webhook', async (req, res) => {
    try {
      const update = req.body as TelegramUpdate;

      // Игнорируем если нет сообщения или отправителя
      if (!update.message?.from?.id) {
        return res.send({ ok: true });
      }

      // Игнорируем сообщения из групп (только личные чаты)
      if (update.message.chat.type !== 'private') {
        log.debug({ chatType: update.message.chat.type }, 'Ignoring group message');
        return res.send({ ok: true });
      }

      const message = update.message;
      const telegramId = String(message.from!.id);
      const telegramMessageId = message.message_id;
      const messageText = message.text || '[Медиа]';

      log.info({
        telegramId,
        hasText: !!message.text,
        messageId: telegramMessageId
      }, 'Received message from Support bot');

      // Только текстовые сообщения
      if (!message.text) {
        log.debug({ telegramId }, 'Non-text message, ignoring');
        return res.send({ ok: true });
      }

      // Ищем пользователя по telegram_id
      const { data: users } = await supabase
        .from('user_accounts')
        .select('id, username')
        .eq('telegram_id', telegramId);

      const user = users?.[0];

      if (!user) {
        log.warn({ telegramId }, 'User not found for support message');
        // Все равно сохраняем сообщение по telegram_id
        await supabase.from('admin_user_chats').insert({
          user_account_id: null,
          telegram_id: telegramId,
          direction: 'from_user',
          message: messageText,
          source: 'support',
          telegram_message_id: telegramMessageId,
          delivered: true
        });
        return res.send({ ok: true });
      }

      // Сохраняем сообщение в БД
      const { error: insertError } = await supabase.from('admin_user_chats').insert({
        user_account_id: user.id,
        telegram_id: telegramId,
        direction: 'from_user',
        message: messageText,
        source: 'support',
        telegram_message_id: telegramMessageId,
        delivered: true
      });

      if (insertError) {
        log.error({ error: insertError.message, telegramId }, 'Failed to save support message');
      }

      // Уведомляем админов о новом сообщении
      try {
        const username = user.username || 'Unknown';
        const chatUrl = `${APP_BASE_URL}/admin/chats/${user.id}`;

        await notifyAdminGroup(
          `📩 <b>Новое сообщение техподдержки</b>\n\n` +
          `От: ${username} (@${telegramId})\n` +
          `Сообщение: ${messageText.substring(0, 200)}${messageText.length > 200 ? '...' : ''}\n\n` +
          `<a href="${chatUrl}">Открыть чат</a>`
        );
      } catch (notifyErr: any) {
        log.error({ error: String(notifyErr) }, 'Failed to notify admin group about support message');
      }

      log.info({ telegramId, userId: user.id, username: user.username }, 'Support message saved');

      return res.send({ ok: true });

    } catch (err: any) {
      log.error({ error: String(err) }, 'Error processing support bot webhook');
      return res.status(500).send({ error: 'Internal server error' });
    }
  });
}
