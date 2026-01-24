import { createLogger } from './logger.js';
import { supabase } from './supabase.js';

const log = createLogger({ module: 'telegramNotifier' });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: {
    message_id: number;
  };
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
