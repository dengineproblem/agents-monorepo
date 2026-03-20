import cron from 'node-cron';
import { pino } from 'pino';
import { runQualificationSync } from './qualificationSync.js';
import { runLabelSync } from './labelSync.js';
import { runMissedMessagesRecovery } from './missedMessages.js';

const log = pino({ name: 'cron' });

let isLabelSyncRunning = false;
let isMissedMsgRunning = false;

export function startCron(): void {
  // Label sync — ночью (по умолчанию 03:00)
  // Порядок: 1) квалификация диалогов → 2) проставление ярлыков
  const labelSchedule = process.env.CRON_SCHEDULE || '0 3 * * *';
  log.info({ schedule: labelSchedule }, 'Starting label sync cron (with qualification)');

  cron.schedule(labelSchedule, async () => {
    if (isLabelSyncRunning || isMissedMsgRunning) {
      log.warn('Another job is running, skipping label sync');
      return;
    }

    isLabelSyncRunning = true;
    const startTime = Date.now();

    try {
      // Шаг 1: Анализ переписок за последние сутки → обновление is_qualified
      log.info('Cron step 1: running qualification analysis');
      await runQualificationSync();

      // Шаг 2: Проставление ярлыков квалифицированным лидам через wwebjs
      log.info('Cron step 2: running label sync');
      await runLabelSync();

      const duration = Math.round((Date.now() - startTime) / 1000);
      log.info({ durationSec: duration }, 'Cron qualification + label sync completed');
    } catch (err: any) {
      log.error({ err: err.message }, 'Cron label sync failed');
    } finally {
      isLabelSyncRunning = false;
    }
  });

  // Missed messages recovery — каждый час
  const missedSchedule = process.env.MISSED_MSG_CRON_SCHEDULE || '0 * * * *';
  log.info({ schedule: missedSchedule }, 'Starting missed messages recovery cron');

  cron.schedule(missedSchedule, async () => {
    if (isMissedMsgRunning || isLabelSyncRunning) {
      log.warn('Another job is running, skipping missed messages recovery');
      return;
    }

    isMissedMsgRunning = true;
    const startTime = Date.now();

    try {
      log.info('Cron triggered: starting missed messages recovery');
      await runMissedMessagesRecovery();
      const duration = Math.round((Date.now() - startTime) / 1000);
      log.info({ durationSec: duration }, 'Cron missed messages recovery completed');
    } catch (err: any) {
      log.error({ err: err.message }, 'Cron missed messages recovery failed');
    } finally {
      isMissedMsgRunning = false;
    }
  });
}
