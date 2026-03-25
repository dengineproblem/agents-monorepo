import { createLogger } from './logger.js';
import { supabase } from './supabase.js';

const log = createLogger({ module: 'telegramNotifier' });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Отдельный бот для управления закрытым каналом комьюнити (инвайты, кик)
const COMMUNITY_BOT_TOKEN = process.env.COMMUNITY_BOT_TOKEN || TELEGRAM_BOT_TOKEN;
const COMMUNITY_BOT_API_URL = `https://api.telegram.org/bot${COMMUNITY_BOT_TOKEN}`;

interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: {
    message_id: number;
  };
}

type MediaType = 'photo' | 'document' | 'voice' | 'audio';

interface SendMediaOptions {
  caption?: string;
  filename?: string;
  contentType?: string;
}

export type MessageSource = 'admin' | 'bot' | 'onboarding' | 'broadcast' | 'external';

interface SendOptions {
  /** ID пользователя в системе (если известен) */
  userAccountId?: string;
  /** Источник сообщения */
  source?: MessageSource;
  /** Не сохранять в историю чата */
  skipLog?: boolean;
}

/**
 * Ищет user_account_id по telegram chat_id
 */
async function findUserAccountByTelegramId(telegramId: string): Promise<string | null> {
  const { data } = await supabase
    .from('user_accounts')
    .select('id')
    .eq('telegram_id', telegramId)
    .limit(1)
    .single();

  return data?.id || null;
}

/**
 * Сохраняет исходящее сообщение в историю чата
 * Поддерживает как user_account_id, так и telegram_id (для онбординга)
 */
async function logOutgoingMessage(params: {
  userAccountId?: string;
  telegramId?: string;
  message: string;
  source: MessageSource;
  telegramMessageId?: number;
}): Promise<void> {
  try {
    await supabase.from('admin_user_chats').insert({
      user_account_id: params.userAccountId || null,
      telegram_id: params.telegramId || null,
      direction: 'to_user',
      message: params.message,
      source: params.source,
      telegram_message_id: params.telegramMessageId,
      delivered: true
    });
  } catch (err) {
    log.error({ err, userAccountId: params.userAccountId, telegramId: params.telegramId }, 'Failed to log outgoing message');
  }
}

/**
 * Отправляет сообщение в Telegram и сохраняет в историю чата
 */
export async function sendTelegramNotification(
  chatId: string | number,
  message: string,
  options: SendOptions = {}
): Promise<boolean> {
  const { userAccountId, source = 'bot', skipLog = false } = options;

  try {
    const response = await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });

    const result: TelegramResponse = await response.json();

    if (!result.ok) {
      log.error({
        msg: 'telegram_send_failed',
        chatId,
        description: result.description
      }, 'Failed to send Telegram message');
      return false;
    }

    log.info({ msg: 'telegram_sent', chatId, source }, 'Telegram notification sent');

    // Логируем в историю чата (если не отключено)
    if (!skipLog) {
      let accountId = userAccountId;

      // Если userAccountId не передан, пробуем найти по telegram_id
      if (!accountId) {
        accountId = await findUserAccountByTelegramId(String(chatId)) || undefined;
      }

      // Логируем: либо по user_account_id, либо по telegram_id (для онбординга)
      await logOutgoingMessage({
        userAccountId: accountId,
        telegramId: !accountId ? String(chatId) : undefined, // telegram_id только если нет user_account_id
        message,
        source,
        telegramMessageId: result.result?.message_id
      });
    }

    return true;
  } catch (error: any) {
    log.error({
      msg: 'telegram_error',
      chatId,
      error: error.message
    }, 'Telegram API error');
    return false;
  }
}

/**
 * Отправляет сообщение от community-бота (для флоу инвайтов/кика)
 */
export async function sendCommunityNotification(
  chatId: string | number,
  message: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${COMMUNITY_BOT_API_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    const result: TelegramResponse = await response.json();

    if (!result.ok) {
      log.error({ msg: 'community_bot_send_failed', chatId, description: result.description }, 'Failed to send community bot message');
      return false;
    }

    return true;
  } catch (error: any) {
    log.error({ msg: 'community_bot_error', chatId, error: error.message }, 'Community bot API error');
    return false;
  }
}

/**
 * Отправляет сообщение с inline-кнопкой от community-бота
 */
export async function sendCommunityMessageWithButton(
  chatId: string | number,
  message: string,
  buttonText: string,
  callbackData: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${COMMUNITY_BOT_API_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: buttonText, callback_data: callbackData }]],
        },
      }),
    });

    const result: TelegramResponse = await response.json();

    if (!result.ok) {
      log.error({ msg: 'community_bot_button_send_failed', chatId, description: result.description }, 'Failed to send community bot message with button');
      return false;
    }

    return true;
  } catch (error: any) {
    log.error({ msg: 'community_bot_button_error', chatId, error: error.message }, 'Community bot button message error');
    return false;
  }
}

/**
 * Создаёт одноразовую инвайт-ссылку в Telegram канал/группу
 */
export async function createChatInviteLink(channelId: string | number): Promise<string | null> {
  try {
    const response = await fetch(`${COMMUNITY_BOT_API_URL}/createChatInviteLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: channelId,
        member_limit: 1,
        name: `sub-${Date.now()}`,
      }),
    });

    const result = await response.json() as { ok: boolean; description?: string; result?: { invite_link: string } };

    if (!result.ok) {
      log.error({ channelId, description: result.description }, 'Failed to create invite link');
      return null;
    }

    return result.result?.invite_link || null;
  } catch (error: any) {
    log.error({ channelId, error: error.message }, 'createChatInviteLink error');
    return null;
  }
}

/**
 * Кикает пользователя из канала (ban → unban, чтобы убрать доступ без перманентного бана)
 */
export async function kickFromChannel(channelId: string | number, userId: string | number): Promise<boolean> {
  try {
    const banResponse = await fetch(`${COMMUNITY_BOT_API_URL}/banChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: channelId, user_id: userId }),
    });

    const banResult = await banResponse.json() as { ok: boolean; description?: string };

    if (!banResult.ok) {
      const desc = banResult.description || '';
      if (desc.includes('user is not a member') || desc.includes('PARTICIPANT_NOT_FOUND') || desc.includes('USER_NOT_PARTICIPANT')) {
        log.warn({ channelId, userId }, 'User already not in channel');
        return true;
      }
      log.error({ channelId, userId, description: desc }, 'Failed to ban chat member');
      return false;
    }

    // Unban чтобы снять перманентный бан (позволяет re-join по новому инвайту)
    await fetch(`${COMMUNITY_BOT_API_URL}/unbanChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: channelId, user_id: userId, only_if_banned: true }),
    });

    return true;
  } catch (error: any) {
    log.error({ channelId, userId, error: error.message }, 'kickFromChannel error');
    return false;
  }
}

// =====================================================
// Отправка медиа в Telegram
// =====================================================

/**
 * Отправляет фото в Telegram
 */
export async function sendTelegramPhoto(
  chatId: string | number,
  buffer: Buffer,
  options: SendMediaOptions = {},
  botToken?: string
): Promise<TelegramResponse> {
  const apiUrl = botToken ? `https://api.telegram.org/bot${botToken}` : TELEGRAM_API_URL;
  const formData = new FormData();
  formData.append('chat_id', String(chatId));
  formData.append('photo', new Blob([new Uint8Array(buffer)], { type: options.contentType || 'image/jpeg' }), options.filename || 'photo.jpg');
  if (options.caption) {
    formData.append('caption', options.caption);
    formData.append('parse_mode', 'HTML');
  }

  const response = await fetch(`${apiUrl}/sendPhoto`, { method: 'POST', body: formData });
  return response.json() as Promise<TelegramResponse>;
}

/**
 * Отправляет документ в Telegram
 */
export async function sendTelegramDocument(
  chatId: string | number,
  buffer: Buffer,
  options: SendMediaOptions = {},
  botToken?: string
): Promise<TelegramResponse> {
  const apiUrl = botToken ? `https://api.telegram.org/bot${botToken}` : TELEGRAM_API_URL;
  const formData = new FormData();
  formData.append('chat_id', String(chatId));
  formData.append('document', new Blob([new Uint8Array(buffer)], { type: options.contentType || 'application/octet-stream' }), options.filename || 'document');
  if (options.caption) {
    formData.append('caption', options.caption);
    formData.append('parse_mode', 'HTML');
  }

  const response = await fetch(`${apiUrl}/sendDocument`, { method: 'POST', body: formData });
  return response.json() as Promise<TelegramResponse>;
}

/**
 * Отправляет голосовое сообщение в Telegram
 */
export async function sendTelegramVoice(
  chatId: string | number,
  buffer: Buffer,
  options: SendMediaOptions = {},
  botToken?: string
): Promise<TelegramResponse> {
  const apiUrl = botToken ? `https://api.telegram.org/bot${botToken}` : TELEGRAM_API_URL;
  const formData = new FormData();
  formData.append('chat_id', String(chatId));
  formData.append('voice', new Blob([new Uint8Array(buffer)], { type: options.contentType || 'audio/ogg' }), options.filename || 'voice.ogg');
  if (options.caption) {
    formData.append('caption', options.caption);
    formData.append('parse_mode', 'HTML');
  }

  const response = await fetch(`${apiUrl}/sendVoice`, { method: 'POST', body: formData });
  return response.json() as Promise<TelegramResponse>;
}

/**
 * Универсальная функция отправки медиа в Telegram
 * Маршрутизирует на нужный метод в зависимости от типа
 */
export async function sendTelegramMedia(
  chatId: string | number,
  buffer: Buffer,
  mediaType: MediaType,
  options: SendMediaOptions = {},
  botToken?: string
): Promise<TelegramResponse> {
  switch (mediaType) {
    case 'photo':
      return sendTelegramPhoto(chatId, buffer, options, botToken);
    case 'voice':
      return sendTelegramVoice(chatId, buffer, options, botToken);
    case 'audio':
      // Аудио файлы отправляем как документы (sendAudio в Telegram для музыкальных файлов)
      return sendTelegramDocument(chatId, buffer, options, botToken);
    case 'document':
    default:
      return sendTelegramDocument(chatId, buffer, options, botToken);
  }
}

/**
 * Форматирует сообщение об отключении WhatsApp инстанса
 */
export function formatDisconnectMessage(instance: {
  phone_number?: string;
  instance_name: string;
}): string {
  const phone = instance.phone_number || instance.instance_name;
  const time = new Date().toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Almaty'
  });

  return `⚠️ <b>WhatsApp отключился!</b>

📱 Номер: ${phone}
⏰ Время: ${time}

🔗 <a href="https://app.performanteaiagency.com/profile#whatsapp">Переподключить</a>`;
}

/**
 * Форматирует сообщение о лиде, требующем ручного сопоставления
 */
export function formatManualMatchMessage(params: {
  phone: string;
  direction: string;
  similarity: number;
}): string {
  return `📩 <b>Новый лид требует привязки креатива</b>

📱 ${params.phone}
📂 Направление: ${params.direction}
🎯 Совпадение: ${params.similarity}%

🔗 <a href="https://app.performanteaiagency.com/roi-analytics#leads">Привязать креатив</a>`;
}
