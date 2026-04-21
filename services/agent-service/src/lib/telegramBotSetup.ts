/**
 * Telegram Bot Setup
 *
 * Регистрирует команды legacy-бота в Telegram (бургер-меню).
 * Вызывается при старте agent-service. Идемпотентно — Telegram
 * принимает повторные вызовы setMyCommands.
 *
 * @module lib/telegramBotSetup
 */

import { createLogger } from './logger.js';

const log = createLogger({ module: 'telegramBotSetup' });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/**
 * Команды, которые реально обрабатываются legacy-ботом.
 * Любые команды НЕ из этого списка будут скрыты из меню после вызова.
 *
 * - /start — запуск онбординга / перерегистрация (telegramOnboarding)
 * - /help  — справка по онбордингу
 * - /skip  — пропустить необязательный вопрос онбординга
 */
const LEGACY_BOT_COMMANDS = [
  { command: 'start', description: 'Регистрация / перезапуск бота' },
  { command: 'help', description: 'Справка' },
  { command: 'skip', description: 'Пропустить вопрос (онбординг)' },
];

export async function setupLegacyBotCommands(): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) {
    log.warn('TELEGRAM_BOT_TOKEN not set — skipping bot commands setup');
    return;
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands: LEGACY_BOT_COMMANDS }),
      }
    );

    const result = (await response.json()) as { ok: boolean; description?: string };

    if (result.ok) {
      log.info(
        { commands: LEGACY_BOT_COMMANDS.map((c) => c.command) },
        'Telegram bot commands updated'
      );
    } else {
      log.error({ description: result.description }, 'Failed to update bot commands');
    }
  } catch (err: any) {
    log.error({ error: String(err) }, 'Error setting bot commands');
  }
}
