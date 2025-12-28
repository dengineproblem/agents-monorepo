import { processPendingNotifications, retryFailedNotifications, getNotificationStats } from '../lib/consultationNotifications.js';
import { logger } from '../lib/logger.js';

// Интервал проверки pending уведомлений (каждую минуту)
const PROCESS_INTERVAL_MS = 60 * 1000;

// Интервал retry failed уведомлений (каждые 5 минут)
const RETRY_INTERVAL_MS = 5 * 60 * 1000;

// Интервал логирования статистики (каждые 10 минут)
const STATS_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Start all notification cron jobs
 */
export function startNotificationCron(): void {
  logger.info('[NotificationCron] Starting notification cron jobs');

  // Обработка pending уведомлений
  startProcessingJob();

  // Retry failed уведомлений
  startRetryJob();

  // Логирование статистики
  startStatsJob();

  logger.info('[NotificationCron] All cron jobs started', {
    processInterval: `${PROCESS_INTERVAL_MS / 1000}s`,
    retryInterval: `${RETRY_INTERVAL_MS / 1000}s`,
    statsInterval: `${STATS_INTERVAL_MS / 1000}s`
  });
}

/**
 * Process pending notifications job
 */
function startProcessingJob(): void {
  // Запускаем сразу при старте
  runProcessing();

  // Затем по интервалу
  setInterval(runProcessing, PROCESS_INTERVAL_MS);
}

async function runProcessing(): Promise<void> {
  const startTime = Date.now();

  try {
    logger.debug('[NotificationCron] Starting pending notifications processing');

    const stats = await processPendingNotifications();

    const duration = Date.now() - startTime;

    if (stats.processed > 0) {
      logger.info('[NotificationCron] Processing completed', {
        ...stats,
        durationMs: duration
      });
    } else {
      logger.debug('[NotificationCron] No pending notifications');
    }
  } catch (error: any) {
    logger.error({
      error: error.message,
      stack: error.stack,
      durationMs: Date.now() - startTime
    }, '[NotificationCron] Processing failed');
  }
}

/**
 * Retry failed notifications job
 */
function startRetryJob(): void {
  // Первый запуск через 2 минуты после старта
  setTimeout(() => {
    runRetry();
    setInterval(runRetry, RETRY_INTERVAL_MS);
  }, 2 * 60 * 1000);
}

async function runRetry(): Promise<void> {
  try {
    logger.debug('[NotificationCron] Starting retry of failed notifications');

    const count = await retryFailedNotifications();

    if (count > 0) {
      logger.info('[NotificationCron] Notifications queued for retry', { count });
    }
  } catch (error: any) {
    logger.error({
      error: error.message
    }, '[NotificationCron] Retry job failed');
  }
}

/**
 * Stats logging job
 */
function startStatsJob(): void {
  // Первый запуск через 1 минуту
  setTimeout(() => {
    runStats();
    setInterval(runStats, STATS_INTERVAL_MS);
  }, 60 * 1000);
}

async function runStats(): Promise<void> {
  try {
    const stats = await getNotificationStats();

    logger.info('[NotificationCron] Notification statistics', {
      pending: stats.pending,
      sent: stats.sent,
      failed: stats.failed,
      skipped: stats.skipped,
      total: stats.total,
      successRate: stats.total > 0
        ? `${((stats.sent / (stats.sent + stats.failed)) * 100).toFixed(1)}%`
        : 'N/A'
    });
  } catch (error: any) {
    logger.error({
      error: error.message
    }, '[NotificationCron] Stats job failed');
  }
}
