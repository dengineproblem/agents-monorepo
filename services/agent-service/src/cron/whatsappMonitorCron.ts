import { FastifyInstance } from 'fastify';

/**
 * WhatsApp monitor cron - DISABLED
 *
 * Проверка статуса инстансов отключена из-за ложных срабатываний.
 * Статус инстансов обновляется через вебхуки от Evolution API (connection.update).
 */
export function startWhatsAppMonitorCron(app: FastifyInstance) {
  app.log.info('📱 WhatsApp monitor cron is disabled (status updates via webhooks only)');
}
