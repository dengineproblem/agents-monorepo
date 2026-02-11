import cron from 'node-cron';
import type TelegramBot from 'node-telegram-bot-api';
import { config } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { kickMember } from '../lib/telegram.js';

const logger = createLogger({ module: 'cron-expiry' });

interface ExpiredSubscription {
  telegram_id: number;
  user_account_id: string;
  channel_status: string;
  tarif_expires: string | null;
}

export function startExpiryCron(bot: TelegramBot): cron.ScheduledTask | null {
  if (!config.cronEnabled) {
    logger.info('Cron disabled');
    return null;
  }

  const task = cron.schedule(config.expiryCronSchedule, () => {
    checkExpiredSubscriptions(bot).catch(err => {
      logger.error({ error: err.message }, 'Cron job failed');
    });
  });

  logger.info({ schedule: config.expiryCronSchedule }, 'Expiry cron scheduled');
  return task;
}

async function checkExpiredSubscriptions(bot: TelegramBot) {
  logger.info('Checking expired subscriptions...');

  const { data: expired, error } = await supabase
    .from('bot_subscriptions')
    .select(`
      telegram_id,
      user_account_id,
      channel_status,
      user_accounts!inner(tarif_expires)
    `)
    .eq('channel_status', 'active')
    .lt('user_accounts.tarif_expires', new Date().toISOString().slice(0, 10));

  if (error) {
    logger.error({ error: error.message }, 'Failed to query expired subscriptions');
    return;
  }

  if (!expired || expired.length === 0) {
    logger.info('No expired subscriptions');
    return;
  }

  let kicked = 0;
  let errors = 0;

  for (const sub of expired) {
    const row = sub as any;
    const telegramId = row.telegram_id as number;
    const userAccountId = row.user_account_id as string;

    try {
      const wasKicked = await kickMember(bot, telegramId);

      if (wasKicked) {
        await supabase
          .from('bot_subscriptions')
          .update({ channel_status: 'kicked' })
          .eq('telegram_id', telegramId);

        await supabase
          .from('user_accounts')
          .update({ is_active: false })
          .eq('id', userAccountId);

        // Notify user
        try {
          await bot.sendMessage(telegramId,
            '⏰ Ваша подписка истекла.\n\n' +
            'Доступ к каналу приостановлен. Используйте /renew для продления.'
          );
        } catch {
          // User may have blocked the bot
        }

        kicked++;
        logger.info({ telegramId }, 'User kicked from channel');
      } else {
        errors++;
      }

      // Telegram rate limit: 200ms between API calls
      await sleep(200);
    } catch (err: any) {
      errors++;
      logger.error({ telegramId, error: err.message }, 'Error processing expired subscription');
    }
  }

  logger.info({ total: expired.length, kicked, errors }, 'Expiry cron completed');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
