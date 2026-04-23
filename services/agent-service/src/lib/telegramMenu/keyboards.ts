/**
 * Keyboard builders для menu системы @prfmntai_bot.
 * Адаптация из services/telegram-claude-bot/src/menu.ts (6 кнопок вместо 7, без "Генерация креативов").
 */

import type { InlineKeyboardMarkup } from './tgApi.js';

const SUPPORT_URL = process.env.MENU_SUPPORT_URL || 'https://t.me/Moltbot_prfmnt_bot';

/** Главное меню — 6 кнопок в 3 ряда по 2 + кнопка техподдержки */
export function buildMainMenuKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📊 Статистика', callback_data: 'menu:stats' },
        { text: '🤖 Запуск AI', callback_data: 'menu:ailaunch' },
      ],
      [
        { text: '🚀 Ручной запуск', callback_data: 'menu:manual' },
        { text: '📋 Направления', callback_data: 'menu:dirs' },
      ],
      [
        { text: '⚡ Оптимизация', callback_data: 'menu:optimize' },
        { text: '🎨 Креативы', callback_data: 'menu:creatives' },
      ],
      [
        { text: '🛟 Техподдержка', url: SUPPORT_URL },
      ],
    ],
  };
}

/** Подменю выбора периода для статистики */
export function buildStatsKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📅 Сегодня', callback_data: 'stats:today' },
        { text: '📅 Вчера', callback_data: 'stats:yesterday' },
      ],
      [
        { text: '📅 3 дня', callback_data: 'stats:3d' },
        { text: '📅 7 дней', callback_data: 'stats:7d' },
      ],
      [
        { text: '↩️ Назад', callback_data: 'back:main' },
      ],
    ],
  };
}

/** Подтверждение AI Launch */
export function buildAiLaunchConfirmKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Подтвердить', callback_data: 'ai:confirm' },
        { text: '❌ Отмена', callback_data: 'ai:cancel' },
      ],
    ],
  };
}

/** Список направлений для ручного запуска */
export function buildDirectionsKeyboard(
  directions: Array<{ id: string; name: string }>,
): InlineKeyboardMarkup {
  const buttons = directions.map((dir, i) => ([{
    text: dir.name,
    callback_data: `manual:${i}`,
  }]));
  buttons.push([{ text: '↩️ Назад', callback_data: 'back:main' }]);
  return { inline_keyboard: buttons };
}
