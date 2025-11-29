import { createLogger } from './logger.js';

const log = createLogger({ module: 'telegramNotifier' });

const TELEGRAM_BOT_TOKEN = '7263071246:AAFC4r0v5NzTNoZjO-wYPf2_-PAg7SwNXBc';
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

interface TelegramResponse {
  ok: boolean;
  description?: string;
}

/**
 * Отправляет сообщение в Telegram
 */
export async function sendTelegramNotification(
  chatId: string | number,
  message: string
): Promise<boolean> {
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

    log.info({ msg: 'telegram_sent', chatId }, 'Telegram notification sent');
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
