import cron from 'node-cron';
import { pino } from 'pino';
import { runLabelSync } from './labelSync.js';

const log = pino({ name: 'cron' });

let isRunning = false;

export function startCron(): void {
  const schedule = process.env.CRON_SCHEDULE || '0 3 * * *'; // default: 03:00 every night

  log.info({ schedule }, 'Starting label sync cron');

  cron.schedule(schedule, async () => {
    if (isRunning) {
      log.warn('Label sync already running, skipping');
      return;
    }

    isRunning = true;
    const startTime = Date.now();

    try {
      log.info('Cron triggered: starting label sync');
      await runLabelSync();
      const duration = Math.round((Date.now() - startTime) / 1000);
      log.info({ durationSec: duration }, 'Cron label sync completed');
    } catch (err: any) {
      log.error({ err: err.message }, 'Cron label sync failed');
    } finally {
      isRunning = false;
    }
  });
}
