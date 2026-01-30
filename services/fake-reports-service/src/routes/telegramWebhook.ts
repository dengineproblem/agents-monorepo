import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { handleTelegramMessage } from '../lib/telegramHandler.js';
import { setWebhook, getWebhookInfo, deleteWebhook } from '../lib/telegramApi.js';
import type { TelegramUpdate } from '../types/telegram.js';

export default async function telegramWebhook(app: FastifyInstance) {

  /**
   * POST /telegram/webhook
   * Webhook для приема сообщений от Telegram
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
        req.log.debug({ chatType: update.message.chat.type }, 'Ignoring group message');
        return res.send({ ok: true });
      }

      const message = update.message;

      req.log.info({
        telegramId: message.from?.id,
        chatId: message.chat.id,
        hasText: !!message.text
      }, 'Received Telegram message');

      // Обрабатываем сообщение
      await handleTelegramMessage(message);

      return res.send({ ok: true });

    } catch (err: any) {
      req.log.error({ error: String(err) }, 'Error processing telegram webhook');
      // Всегда отвечаем 200 чтобы Telegram не повторял запрос
      return res.send({ ok: true });
    }
  });

  /**
   * GET /telegram/webhook
   * Проверка работоспособности webhook endpoint
   */
  app.get('/telegram/webhook', async (_req, res) => {
    return res.send({
      ok: true,
      message: 'Telegram webhook is active',
      service: 'fake-reports-service'
    });
  });

  /**
   * POST /telegram/setup-webhook
   * Настройка webhook в Telegram API
   */
  app.post('/telegram/setup-webhook', async (req, res) => {
    try {
      const { webhook_url } = req.body as { webhook_url?: string };

      const url = webhook_url || config.telegram.webhookUrl ||
        'https://api.performanteaiagency.com/fake-reports/telegram/webhook';

      req.log.info({ webhookUrl: url }, 'Setting up Telegram webhook');

      await setWebhook(url);

      return res.send({
        success: true,
        webhook_url: url,
        message: 'Webhook configured successfully'
      });

    } catch (err: any) {
      req.log.error({ error: String(err) }, 'Failed to setup webhook');
      return res.status(500).send({
        success: false,
        error: err.message
      });
    }
  });

  /**
   * GET /telegram/webhook-info
   * Получение информации о текущем webhook
   */
  app.get('/telegram/webhook-info', async (req, res) => {
    try {
      const info = await getWebhookInfo();
      return res.send({
        success: true,
        webhook_info: info
      });
    } catch (err: any) {
      req.log.error({ error: String(err) }, 'Failed to get webhook info');
      return res.status(500).send({
        success: false,
        error: err.message
      });
    }
  });

  /**
   * DELETE /telegram/webhook
   * Удаление webhook
   */
  app.delete('/telegram/webhook', async (req, res) => {
    try {
      await deleteWebhook();

      req.log.info('Telegram webhook deleted');

      return res.send({
        success: true,
        message: 'Webhook deleted successfully'
      });
    } catch (err: any) {
      req.log.error({ error: String(err) }, 'Failed to delete webhook');
      return res.status(500).send({
        success: false,
        error: err.message
      });
    }
  });
}
