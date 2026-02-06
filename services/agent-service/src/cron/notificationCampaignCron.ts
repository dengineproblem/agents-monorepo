/**
 * Notification Campaign CRON
 *
 * Каждую минуту проверяет due-кампании из notification_campaigns
 * и выполняет их рассылку.
 *
 * @module cron/notificationCampaignCron
 */

import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { createLogger } from '../lib/logger.js';
import { processDueNotificationCampaigns } from '../routes/adminNotifications.js';

const logger = createLogger({ module: 'notificationCampaignCron' });

export function startNotificationCampaignCron(app: FastifyInstance): void {
  app.log.info('Notification campaign cron started (runs every minute)');

  cron.schedule('* * * * *', async () => {
    try {
      await processDueNotificationCampaigns();
    } catch (err) {
      logger.error({ error: String(err) }, 'Unexpected error in notification campaign cron');
    }
  });
}

export async function runNotificationCampaignCronManually(): Promise<void> {
  await processDueNotificationCampaigns();
}
