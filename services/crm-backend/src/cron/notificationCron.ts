import { processPendingNotifications } from '../lib/consultationNotifications.js';
import { logger } from '../lib/logger.js';

const INTERVAL_MS = 60 * 1000; // Check every minute

/**
 * Start cron job for processing pending consultation notifications
 */
export function startNotificationCron(): void {
  logger.info('Starting consultation notification cron job');

  // Process immediately on startup
  processPendingNotifications().catch(err => {
    logger.error({ error: err.message }, 'Error in initial notification processing');
  });

  // Then run every minute
  setInterval(async () => {
    try {
      await processPendingNotifications();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error in notification cron');
    }
  }, INTERVAL_MS);
}
