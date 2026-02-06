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
import { uploadTelegramMediaToStorage } from '../lib/chatMediaHandler.js';

const log = createLogger({ module: 'supportBotWebhook' });

const SUPPORT_BOT_TOKEN = process.env.SUPPORT_BOT_TELEGRAM_TOKEN;

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

interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  date: number;
  text?: string;
  voice?: TelegramVoice;
  photo?: TelegramPhotoSize[];
  caption?: string;
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

      log.info({
        telegramId,
        hasText: !!message.text,
        hasVoice: !!message.voice,
        hasPhoto: !!message.photo,
        messageId: telegramMessageId
      }, 'Received message from Support bot');

      // Ищем пользователя по telegram_id
      const { data: users } = await supabase
        .from('user_accounts')
        .select('id, username')
        .eq('telegram_id', telegramId);

      const user = users?.[0];

      if (!user) {
        log.warn({ telegramId }, 'User not found for support message - skipping');
        return res.send({ ok: true });
      }

      let messageText = '';
      let chatData: any = {
        user_account_id: user.id,
        telegram_id: telegramId,
        direction: 'from_user',
        source: 'support',
        telegram_message_id: telegramMessageId,
        delivered: true
      };

      // VOICE MESSAGE
      if (message.voice) {
        log.info({ telegramId, duration: message.voice.duration }, 'Processing voice message');

        const result = await uploadTelegramMediaToStorage(
          message.voice.file_id,
          user.id,
          'voice',
          SUPPORT_BOT_TOKEN!
        );

        if (!result) {
          log.error({ telegramId, fileId: message.voice.file_id }, 'Failed to upload voice to storage');
          return res.send({ ok: true }); // Не падаем
        }

        chatData = {
          ...chatData,
          message: null,
          media_type: 'voice',
          media_url: result.url,
          media_metadata: {
            duration: message.voice.duration,
            file_size: message.voice.file_size,
            original_telegram_file_id: message.voice.file_id
          }
        };

        messageText = `🎤 Голосовое сообщение (${message.voice.duration}с)`;
      }
      // PHOTO MESSAGE
      else if (message.photo && message.photo.length > 0) {
        // Берём наибольшее фото
        const largestPhoto = message.photo[message.photo.length - 1];
        log.info({ telegramId, photoCount: message.photo.length, size: `${largestPhoto.width}x${largestPhoto.height}` }, 'Processing photo message');

        const result = await uploadTelegramMediaToStorage(
          largestPhoto.file_id,
          user.id,
          'photo',
          SUPPORT_BOT_TOKEN!
        );

        if (!result) {
          log.error({ telegramId, fileId: largestPhoto.file_id }, 'Failed to upload photo to storage');
          return res.send({ ok: true }); // Не падаем
        }

        chatData = {
          ...chatData,
          message: message.caption || null,
          media_type: 'photo',
          media_url: result.url,
          media_metadata: {
            width: largestPhoto.width,
            height: largestPhoto.height,
            file_size: largestPhoto.file_size,
            original_telegram_file_id: largestPhoto.file_id
          }
        };

        messageText = '📷 Фото' + (message.caption ? `: ${message.caption}` : '');
      }
      // TEXT MESSAGE
      else if (message.text) {
        chatData = {
          ...chatData,
          message: message.text,
          media_type: 'text'
        };

        messageText = message.text;
      }
      // UNSUPPORTED MESSAGE TYPE
      else {
        log.debug({ telegramId }, 'Unsupported message type, ignoring');
        return res.send({ ok: true });
      }

      // Сохраняем сообщение в БД
      const { error: insertError } = await supabase.from('admin_user_chats').insert(chatData);

      if (insertError) {
        log.error({ error: insertError.message, telegramId }, 'Failed to save support message');
      }

      // Уведомляем админов о новом сообщении
      try {
        const username = user.username || 'Unknown';
        const chatUrl = `${APP_BASE_URL}/admin/chats?tab=moltbot`;

        await notifyAdminGroup(
          `📩 <b>Новое сообщение техподдержки</b>\n\n` +
          `От: ${username} (@${telegramId})\n` +
          `Сообщение: ${messageText.substring(0, 200)}${messageText.length > 200 ? '...' : ''}\n\n` +
          `<a href="${chatUrl}">Открыть чат</a>`
        );
      } catch (notifyErr: any) {
        log.error({ error: String(notifyErr) }, 'Failed to notify admin group about support message');
      }

      log.info({ telegramId, userId: user.id, username: user.username, mediaType: chatData.media_type }, 'Support message saved');

      return res.send({ ok: true });

    } catch (err: any) {
      log.error({ error: String(err) }, 'Error processing support bot webhook');
      return res.status(500).send({ error: 'Internal server error' });
    }
  });
}
