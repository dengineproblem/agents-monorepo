/**
 * Telegram Webhook
 *
 * Обрабатывает входящие сообщения от пользователей в Telegram
 * - Онбординг новых пользователей через бота (15 вопросов)
 * - Сохраняет сообщения в admin_user_chats для существующих пользователей
 * - Отправляет уведомление в группу техподдержки
 *
 * @module routes/telegramWebhook
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { notifyAdminGroup, APP_BASE_URL } from '../lib/notificationService.js';
import { handleOnboardingMessage, type TelegramMessage as OnboardingMessage } from '../lib/telegramOnboarding/index.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import { uploadTelegramMediaToStorage } from '../lib/chatMediaHandler.js';

const log = createLogger({ module: 'telegramWebhook' });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const ENABLE_LEGACY_ONBOARDING = process.env.ENABLE_LEGACY_ONBOARDING === 'true';

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

export default async function telegramWebhook(app: FastifyInstance) {

  /**
   * POST /telegram/webhook
   * Обрабатывает входящие сообщения от Telegram
   *
   * Логика обработки:
   * 1. Логируем ВСЕ входящие сообщения в admin_user_chats
   * 2. Пробуем обработать как онбординг (новые пользователи, /start, активные сессии)
   * 3. Если онбординг не обработал - проверяем зарегистрированного пользователя
   * 4. Уведомляем админов
   */
  app.post('/telegram/webhook', async (req, res) => {
    try {
      const update = req.body as TelegramUpdate;

      // Игнорируем если нет сообщения или отправителя
      if (!update.message?.from?.id) {
        return res.send({ ok: true });
      }

      // Игнорируем сообщения из групп (только личные чаты)
      if (update.message.chat.type !== 'private') {
        log.debug({ chatType: update.message.chat.type, chatId: update.message.chat.id }, 'Ignoring group message');
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
      }, 'Received message from Telegram');

      // ===================================================
      // 0. Логируем ВСЕ входящие сообщения (до обработки)
      // ===================================================
      const { data: users } = await supabase
        .from('user_accounts')
        .select('id, username')
        .eq('telegram_id', telegramId);

      const user = users?.[0];

      let messageText = '';
      let chatData: any = {
        user_account_id: user?.id || null,
        telegram_id: !user ? telegramId : null,
        direction: 'from_user',
        source: 'bot',
        telegram_message_id: telegramMessageId,
        delivered: true
      };

      // VOICE MESSAGE
      if (message.voice) {
        log.info({ telegramId, duration: message.voice.duration }, 'Processing voice message');

        if (user) {
          const result = await uploadTelegramMediaToStorage(
            message.voice.file_id,
            user.id,
            'voice',
            TELEGRAM_BOT_TOKEN!
          );

          if (!result) {
            log.error({ telegramId, fileId: message.voice.file_id }, 'Failed to upload voice to storage');
            return res.send({ ok: true });
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
        } else {
          // Для незарегистрированных пользователей просто сохраняем текст
          chatData.message = '[Голосовое сообщение]';
          messageText = '[Голосовое сообщение]';
        }
      }
      // PHOTO MESSAGE
      else if (message.photo && message.photo.length > 0) {
        const largestPhoto = message.photo[message.photo.length - 1];
        log.info({ telegramId, photoCount: message.photo.length, size: `${largestPhoto.width}x${largestPhoto.height}` }, 'Processing photo message');

        if (user) {
          const result = await uploadTelegramMediaToStorage(
            largestPhoto.file_id,
            user.id,
            'photo',
            TELEGRAM_BOT_TOKEN!
          );

          if (!result) {
            log.error({ telegramId, fileId: largestPhoto.file_id }, 'Failed to upload photo to storage');
            return res.send({ ok: true });
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
        } else {
          // Для незарегистрированных пользователей
          chatData.message = message.caption || '[Фото]';
          messageText = chatData.message;
        }
      }
      // TEXT MESSAGE
      else if (message.text) {
        chatData.message = message.text;
        chatData.media_type = 'text';
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
        log.error({ error: insertError.message, telegramId }, 'Failed to save message');
      }

      // ===================================================
      // 1. Пробуем обработать как онбординг (если включён)
      // ===================================================
      // ВАЖНО: Легаси онбординг можно отключить через ENABLE_LEGACY_ONBOARDING=false
      // По умолчанию онбординг теперь обрабатывается через Moltbot (GPT 5.2)
      if (ENABLE_LEGACY_ONBOARDING && TELEGRAM_BOT_TOKEN) {
        const onboardingResult = await handleOnboardingMessage(message as OnboardingMessage);

        if (onboardingResult.handled) {
          log.debug({ telegramId }, 'Message handled by legacy onboarding');
          return res.send({ ok: true });
        }
      } else if (!ENABLE_LEGACY_ONBOARDING) {
        log.debug({ telegramId }, 'Legacy onboarding disabled (ENABLE_LEGACY_ONBOARDING=false)');
      }

      // ===================================================
      // 2. Онбординг не обработал - проверяем существующего пользователя
      // ===================================================

      // Если пользователь не найден - подсказываем /start
      if (!user) {
        log.debug({ telegramId }, 'Message from unknown user');
        sendStartHint(message.chat.id).catch(() => {});
        return res.send({ ok: true });
      }

      // Уведомляем админов в группу о новом сообщении
      try {
        const username = user.username || 'Unknown';
        const chatUrl = `${APP_BASE_URL}/admin/chats/${user.id}`;
        const truncatedMessage = messageText.substring(0, 200) + (messageText.length > 200 ? '...' : '');

        await notifyAdminGroup(
          `📩 <b>Новое сообщение от ${escapeHtml(username)}</b>\n\n` +
          `От: ${escapeHtml(username)} (@${telegramId})\n` +
          `Сообщение: ${escapeHtml(truncatedMessage)}\n\n` +
          `<a href="${chatUrl}">Открыть чат</a>`
        );
      } catch (notifyErr: any) {
        log.error({ error: String(notifyErr) }, 'Failed to notify admin group');
      }

      log.info({ telegramId, userId: user.id, username: user.username, mediaType: chatData.media_type }, 'Message saved');

      return res.send({ ok: true });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error processing telegram webhook');

      logErrorToAdmin({
        error_type: 'webhook',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'telegram_webhook',
        endpoint: '/telegram/webhook',
        severity: 'warning'
      }).catch(() => {});

      return res.send({ ok: true }); // Всегда отвечаем 200 чтобы Telegram не повторял
    }
  });

  /**
   * Отправляет подсказку неизвестному пользователю
   */
  async function sendStartHint(chatId: number): Promise<void> {
    try {
      await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: '👋 Привет! Для регистрации отправьте команду /start',
          parse_mode: 'HTML'
        })
      });
    } catch (error) {
      log.debug({ error: String(error) }, 'Failed to send start hint');
    }
  }

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
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error setting up Telegram webhook');

      logErrorToAdmin({
        error_type: 'webhook',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'telegram_setup_webhook',
        endpoint: '/telegram/setup-webhook',
        severity: 'warning'
      }).catch(() => {});

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
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error getting webhook info');

      logErrorToAdmin({
        error_type: 'webhook',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'telegram_get_webhook_info',
        endpoint: '/telegram/webhook-info',
        severity: 'info'
      }).catch(() => {});

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
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error deleting webhook');

      logErrorToAdmin({
        error_type: 'webhook',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'telegram_delete_webhook',
        endpoint: '/telegram/webhook',
        severity: 'info'
      }).catch(() => {});

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
