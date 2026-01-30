import { config } from '../config.js';
import type {
  SendMessageParams,
  TelegramApiResponse,
  WebhookInfo
} from '../types/telegram.js';

const TELEGRAM_API_URL = `https://api.telegram.org/bot${config.telegram.botToken}`;

/**
 * Отправка сообщения в Telegram
 */
export async function sendMessage(
  chatId: number,
  text: string,
  options?: Partial<Omit<SendMessageParams, 'chat_id' | 'text'>>
): Promise<void> {
  try {
    const params: SendMessageParams = {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...options
    };

    const response = await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const error: TelegramApiResponse = await response.json();
      throw new Error(`Telegram API error: ${error.description || 'Unknown error'}`);
    }
  } catch (error: any) {
    console.error('Failed to send Telegram message:', error);
    throw error;
  }
}

/**
 * Установка webhook
 */
export async function setWebhook(url: string): Promise<void> {
  const response = await fetch(`${TELEGRAM_API_URL}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      allowed_updates: ['message']
    })
  });

  const result: TelegramApiResponse = await response.json();

  if (!result.ok) {
    throw new Error(`Failed to set webhook: ${result.description}`);
  }
}

/**
 * Получение информации о webhook
 */
export async function getWebhookInfo(): Promise<WebhookInfo> {
  const response = await fetch(`${TELEGRAM_API_URL}/getWebhookInfo`);
  const result: TelegramApiResponse<WebhookInfo> = await response.json();

  if (!result.ok || !result.result) {
    throw new Error('Failed to get webhook info');
  }

  return result.result;
}

/**
 * Удаление webhook
 */
export async function deleteWebhook(): Promise<void> {
  const response = await fetch(`${TELEGRAM_API_URL}/deleteWebhook`, {
    method: 'POST'
  });

  const result: TelegramApiResponse = await response.json();

  if (!result.ok) {
    throw new Error(`Failed to delete webhook: ${result.description}`);
  }
}
