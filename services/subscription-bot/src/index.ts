import { createLogger } from './lib/logger.js';
import { initBot } from './bot.js';
import { startServer } from './server.js';
import { startExpiryCron } from './cron/subscriptionExpiry.js';

const logger = createLogger({ module: 'main' });

async function main() {
  logger.info('Starting subscription-bot...');

  // 1. Init Telegram bot (polling)
  const bot = initBot();

  // Verify bot access
  const me = await bot.getMe();
  logger.info({ username: me.username, id: me.id }, 'Bot connected');

  // 2. Start HTTP server (for Robokassa callbacks)
  const server = await startServer();

  // 3. Start cron (subscription expiry checks)
  const cronTask = startExpiryCron(bot);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    bot.stopPolling();
    cronTask?.stop();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('subscription-bot is ready');
}

main().catch(err => {
  logger.fatal({ error: err.message, stack: err.stack }, 'Failed to start');
  process.exit(1);
});
