/**
 * Community Channel Cron
 *
 * Ежедневно проверяет просроченные подписки и кикает пользователей
 * из закрытого канала комьюнити.
 *
 * @module cron/communityChannelCron
 */

import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { kickFromChannel, sendTelegramNotification } from '../lib/telegramNotifier.js';

const logger = createLogger({ module: 'communityChannelCron' });

const ALMATY_TIMEZONE = 'Asia/Almaty';

function getAlmatyTodayString(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ALMATY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find(p => p.type === 'year')?.value || '2026';
  const month = parts.find(p => p.type === 'month')?.value || '01';
  const day = parts.find(p => p.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

interface ExpiredUserRow {
  id: string;
  telegram_id: string;
  tarif_expires: string;
}

async function processExpiredCommunityMembers(): Promise<void> {
  const communityChannelId = process.env.COMMUNITY_CHANNEL_ID;
  if (!communityChannelId) {
    logger.debug('COMMUNITY_CHANNEL_ID not set, skipping community channel cron');
    return;
  }

  logger.info('Checking expired community channel members...');
  const today = getAlmatyTodayString();

  const { data: expired, error } = await supabase
    .from('user_accounts')
    .select('id, telegram_id, tarif_expires')
    .eq('community_channel_invited', true)
    .not('telegram_id', 'is', null)
    .lt('tarif_expires', today);

  if (error) {
    logger.error({ error: error.message }, 'Failed to query expired community members');
    return;
  }

  if (!expired || expired.length === 0) {
    logger.info('No expired community members');
    return;
  }

  let kicked = 0;
  let errors = 0;

  for (const user of expired as ExpiredUserRow[]) {
    try {
      const wasKicked = await kickFromChannel(communityChannelId, user.telegram_id);

      if (wasKicked) {
        await supabase
          .from('user_accounts')
          .update({ community_channel_invited: false })
          .eq('id', user.id);

        // Уведомить пользователя
        try {
          await sendTelegramNotification(user.telegram_id,
            '⏰ Ваша подписка истекла.\n\nДоступ к каналу комьюнити приостановлен. Используйте /subscription для продления.',
            { userAccountId: user.id, source: 'bot' }
          );
        } catch {
          // Пользователь мог заблокировать бота
        }

        kicked++;
        logger.info({ userId: user.id, telegramId: user.telegram_id }, 'User kicked from community channel');
      } else {
        errors++;
      }

      // Telegram rate limit: 200ms между API-вызовами
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (err: any) {
      errors++;
      logger.error({ userId: user.id, error: err.message }, 'Error processing expired community member');
    }
  }

  logger.info({ total: expired.length, kicked, errors }, 'Community channel cron completed');
}

export function startCommunityChannelCron(app: FastifyInstance): void {
  if (!process.env.COMMUNITY_CHANNEL_ID) {
    app.log.info('COMMUNITY_CHANNEL_ID not set, community channel cron disabled');
    return;
  }

  app.log.info('Community channel cron started (runs daily at 03:00 Almaty)');

  cron.schedule('0 3 * * *', async () => {
    try {
      await processExpiredCommunityMembers();
    } catch (err) {
      logger.error({ error: String(err) }, 'Unexpected error in community channel cron');
    }
  }, {
    timezone: ALMATY_TIMEZONE,
  });
}
