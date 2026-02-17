import TelegramBot from 'node-telegram-bot-api';
import { UserSession } from './session.js';
import { executeTool } from './tools.js';
import { storeMessage } from './db.js';
import { logger } from './logger.js';
import { ASSISTANT_NAME } from './config.js';

// =====================================================
// CONSTANTS
// =====================================================

const MENU_FLOW_TTL_MS = 10 * 60 * 1000; // 10 минут

// =====================================================
// KEYBOARD BUILDERS
// =====================================================

/** Главное меню — 7 кнопок в 2 колонки */
export function buildMainMenuKeyboard(): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '\u{1F4CA} \u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430', callback_data: 'menu:stats' },
        { text: '\u{1F916} \u0417\u0430\u043F\u0443\u0441\u043A AI', callback_data: 'menu:ailaunch' },
      ],
      [
        { text: '\u{1F680} \u0420\u0443\u0447\u043D\u043E\u0439 \u0437\u0430\u043F\u0443\u0441\u043A', callback_data: 'menu:manual' },
        { text: '\u{1F4CB} \u041D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F', callback_data: 'menu:dirs' },
      ],
      [
        { text: '\u26A1 \u041E\u043F\u0442\u0438\u043C\u0438\u0437\u0430\u0446\u0438\u044F', callback_data: 'menu:optimize' },
        { text: '\u{1F3A8} \u041A\u0440\u0435\u0430\u0442\u0438\u0432\u044B', callback_data: 'menu:creatives' },
      ],
      [
        { text: '\u2728 \u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F \u043A\u0440\u0435\u0430\u0442\u0438\u0432\u043E\u0432', callback_data: 'menu:generate' },
      ],
      [
        { text: '🛟 Техподдержка', url: 'https://t.me/Moltbot_prfmnt_bot' },
      ],
    ],
  };
}

/** Подменю периодов статистики */
function buildStatsKeyboard(): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '\u{1F4C5} \u0421\u0435\u0433\u043E\u0434\u043D\u044F', callback_data: 'stats:today' },
        { text: '\u{1F4C5} \u0412\u0447\u0435\u0440\u0430', callback_data: 'stats:yesterday' },
      ],
      [
        { text: '\u{1F4C5} 3 \u0434\u043D\u044F', callback_data: 'stats:3d' },
        { text: '\u{1F4C5} 7 \u0434\u043D\u0435\u0439', callback_data: 'stats:7d' },
      ],
      [
        { text: '\u21A9\uFE0F \u041D\u0430\u0437\u0430\u0434', callback_data: 'back:main' },
      ],
    ],
  };
}

/** Кнопки подтверждения AI Launch */
function buildAiLaunchConfirmKeyboard(): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '\u2705 \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C', callback_data: 'ai:confirm' },
        { text: '\u274C \u041E\u0442\u043C\u0435\u043D\u0430', callback_data: 'ai:cancel' },
      ],
    ],
  };
}

/** Кнопки направлений для ручного запуска */
function buildDirectionsKeyboard(
  directions: Array<{ id: string; name: string }>,
): TelegramBot.InlineKeyboardMarkup {
  const buttons: TelegramBot.InlineKeyboardButton[][] = directions.map((dir, i) => ([{
    text: dir.name,
    callback_data: `manual:${i}`,
  }]));
  buttons.push([{ text: '\u21A9\uFE0F \u041D\u0430\u0437\u0430\u0434', callback_data: 'back:main' }]);
  return { inline_keyboard: buttons };
}

// =====================================================
// RESULT FORMATTERS (tool JSON → Telegram Markdown)
// =====================================================

function escapeMd(text: string): string {
  return text.replace(/([*_`\[\]])/g, '\\$1');
}

/** Извлекает inner data из обёртки agent-brain и проверяет inner success */
function extractResult(result: any): { ok: true; data: any } | { ok: false; error: string } {
  if (!result || result.success === false) {
    return { ok: false, error: result?.error || result?.message || 'неизвестная ошибка' };
  }
  const inner = result.result || result.data || result;
  if (inner && inner.success === false) {
    return { ok: false, error: inner.error || inner.message || 'неизвестная ошибка' };
  }
  return { ok: true, data: inner };
}

/** Форматирует getSpendReport результат */
function formatSpendReport(result: any, periodLabel: string): string {
  const ex = extractResult(result);
  if (!ex.ok) return `\u274C \u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0443: ${ex.error}`;
  const data = ex.data;

  const lines: string[] = [`\u{1F4CA} *\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430 \u0437\u0430 ${periodLabel}*\n`];

  const t = data.totals || data.total;
  if (t) {
    if (t.spend != null) lines.push(`\u{1F4B0} \u0420\u0430\u0441\u0445\u043E\u0434: *$${Number(t.spend).toFixed(2)}*`);
    if (t.leads != null) lines.push(`\u{1F4E9} \u041B\u0438\u0434\u044B: *${t.leads}*`);
    if (t.cpl != null) lines.push(`\u{1F4CA} CPL: *$${Number(t.cpl).toFixed(2)}*`);
    if (t.impressions != null) lines.push(`\u{1F441} \u041F\u043E\u043A\u0430\u0437\u044B: *${Number(t.impressions).toLocaleString()}*`);
    if (t.clicks != null) lines.push(`\u{1F5B1} \u041A\u043B\u0438\u043A\u0438: *${t.clicks}*`);
    lines.push('');
  }

  // data.data содержит строки (по дням или по кампаниям в зависимости от group_by)
  const rows = data.data || data.campaigns || data.rows || [];
  if (Array.isArray(rows) && rows.length > 1) {
    lines.push('*\u041F\u043E\u0434\u0440\u043E\u0431\u043D\u043E:*');
    for (const c of rows.slice(0, 10)) {
      const label = escapeMd(c.campaign_name || c.name || c.date || 'N/A');
      const spend = c.spend != null ? `$${Number(c.spend).toFixed(2)}` : '-';
      const leads = c.leads != null ? `${c.leads} \u043B\u0438\u0434\u043E\u0432` : '';
      const cplVal = c.leads > 0 && c.spend > 0 ? `CPL $${(c.spend / c.leads).toFixed(2)}` : '';
      const parts = [spend, leads, cplVal].filter(Boolean).join(' | ');
      lines.push(`\u2022 ${label}: ${parts}`);
    }
    if (rows.length > 10) {
      lines.push(`... \u0438 \u0435\u0449\u0451 ${rows.length - 10}`);
    }
  }

  if (!t && rows.length === 0) {
    lines.push('\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445 \u0437\u0430 \u044D\u0442\u043E\u0442 \u043F\u0435\u0440\u0438\u043E\u0434.');
  }

  return lines.join('\n');
}

/** Форматирует getDirections результат */
function formatDirections(result: any): string {
  const ex = extractResult(result);
  if (!ex.ok) return `\u274C \u041E\u0448\u0438\u0431\u043A\u0430: ${ex.error}`;

  const d = ex.data;
  const dirs = d.directions || (Array.isArray(d) ? d : []);
  if (!Array.isArray(dirs) || dirs.length === 0) return '\u{1F4CB} \u041D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0439 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442.';

  const lines = ['\u{1F4CB} *\u041D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F:*\n'];
  for (const d of dirs) {
    const status = d.status === 'active' ? '\u{1F7E2}' : '\u{1F534}';
    const name = escapeMd(d.name || 'N/A');
    const parts: string[] = [];
    if (d.budget_per_day) parts.push(`$${d.budget_per_day}/\u0434\u0435\u043D\u044C`);
    if (d.target_cpl) parts.push(`CPL $${d.target_cpl}`);
    lines.push(`${status} *${name}*${parts.length ? ` (${parts.join(', ')})` : ''}`);
  }

  return lines.join('\n');
}

/** Форматирует креативы для ручного запуска */
function formatCreativesForManualLaunch(result: any, directionName: string): string {
  const ex = extractResult(result);
  if (!ex.ok) return `\u274C \u041E\u0448\u0438\u0431\u043A\u0430: ${ex.error}`;

  const d = ex.data;
  const creatives = d.creatives || (Array.isArray(d) ? d : []);
  if (!Array.isArray(creatives) || creatives.length === 0) {
    return `\u0412 \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0438 "${escapeMd(directionName)}" \u043D\u0435\u0442 \u043A\u0440\u0435\u0430\u0442\u0438\u0432\u043E\u0432.`;
  }

  const lines = [
    `\u{1F3A8} *\u041A\u0440\u0435\u0430\u0442\u0438\u0432\u044B \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F "${escapeMd(directionName)}":*\n`,
    '\u0414\u043B\u044F \u0437\u0430\u043F\u0443\u0441\u043A\u0430 \u043D\u0430\u043F\u0438\u0448\u0438\u0442\u0435 \u043D\u043E\u043C\u0435\u0440\u0430 \u043A\u0440\u0435\u0430\u0442\u0438\u0432\u043E\u0432 \u0438 \u0431\u044E\u0434\u0436\u0435\u0442.',
    '\u041F\u0440\u0438\u043C\u0435\u0440: `1, 3, 5 \u0431\u044E\u0434\u0436\u0435\u0442 $10`\n',
  ];

  creatives.forEach((c: any, i: number) => {
    const name = escapeMd(c.name || c.title || c.filename || '\u0411\u0435\u0437 \u0438\u043C\u0435\u043D\u0438');
    const parts: string[] = [];
    if (c.media_type) parts.push(c.media_type === 'video' ? '\u{1F3AC}' : '\u{1F5BC}');
    const status = c.status === 'ready' ? '\u{1F7E2}' : c.status === 'active' ? '\u{1F7E2}' : '\u23F8';
    lines.push(`${i + 1}. ${status} ${name}${parts.length ? ` (${parts.join(', ')})` : ''}`);
    lines.push(`   ID: \`${c.id}\``);
  });

  return lines.join('\n');
}

/** Форматирует triggerBrainOptimizationRun dry_run */
function formatOptimizationResult(result: any): string {
  const ex = extractResult(result);
  if (!ex.ok) return `\u274C \u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u043F\u0442\u0438\u043C\u0438\u0437\u0430\u0446\u0438\u0438: ${ex.error}`;

  const data = ex.data;
  const lines = ['\u26A1 *\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u044B \u043E\u043F\u0442\u0438\u043C\u0438\u0437\u0430\u0446\u0438\u0438:*\n'];

  if (data.proposals && Array.isArray(data.proposals)) {
    if (data.proposals.length === 0) {
      lines.push('\u0420\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0430\u0446\u0438\u0439 \u043D\u0435\u0442 \u2014 \u0432\u0441\u0451 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0445\u043E\u0440\u043E\u0448\u043E.');
    } else {
      for (const p of data.proposals) {
        const icon = p.action === 'pauseAdSet' || p.action === 'pauseAd' ? '\u23F8'
          : p.action === 'updateBudget' ? '\u{1F4B0}'
          : p.action === 'createAdSet' ? '\u{1F680}'
          : p.action === 'review' ? '\u{1F50D}'
          : '\u{1F527}';
        const name = p.direction_name || p.entity_name || '';
        const prefix = name ? `*${escapeMd(name)}*: ` : '';
        lines.push(`${icon} ${prefix}${escapeMd(p.reason || p.description || JSON.stringify(p))}`);
      }
    }
  } else if (data.message) {
    lines.push(escapeMd(data.message));
  } else {
    lines.push('\u041E\u043F\u0442\u0438\u043C\u0438\u0437\u0430\u0446\u0438\u044F \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430.');
  }

  return lines.join('\n');
}

/** Форматирует getTopCreatives */
function formatTopCreatives(result: any): string {
  const ex = extractResult(result);
  if (!ex.ok) return `\u274C \u041E\u0448\u0438\u0431\u043A\u0430: ${ex.error}`;

  const d = ex.data;
  const creatives = d.top_creatives || d.creatives || (Array.isArray(d) ? d : []);
  if (!Array.isArray(creatives) || creatives.length === 0) {
    return '\u{1F3A8} \u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445 \u043F\u043E \u043A\u0440\u0435\u0430\u0442\u0438\u0432\u0430\u043C \u0437\u0430 \u044D\u0442\u043E\u0442 \u043F\u0435\u0440\u0438\u043E\u0434.';
  }

  const lines = ['\u{1F3A8} *\u0422\u043E\u043F \u043A\u0440\u0435\u0430\u0442\u0438\u0432\u044B (7 \u0434\u043D\u0435\u0439):*\n'];
  for (const c of creatives.slice(0, 10)) {
    const name = escapeMd(c.title || c.name || c.filename || 'N/A');
    const m = c.metrics || c;
    const parts: string[] = [];
    if (m.spend != null) parts.push(`$${Number(m.spend).toFixed(2)}`);
    if (m.leads != null) parts.push(`${m.leads} \u043B\u0438\u0434\u043E\u0432`);
    if (m.cpl != null) parts.push(`CPL $${Number(m.cpl).toFixed(2)}`);
    lines.push(`\u2022 *${name}*: ${parts.join(' | ') || '-'}`);
  }

  return lines.join('\n');
}

/** Форматирует результат aiLaunch */
function formatAiLaunchResult(result: any): string {
  const ex = extractResult(result);
  if (!ex.ok) return `\u274C AI \u0437\u0430\u043F\u0443\u0441\u043A \u043D\u0435 \u0443\u0434\u0430\u043B\u0441\u044F: ${ex.error}`;

  const data = ex.data;
  const lines = ['\u{1F916} *AI \u0437\u0430\u043F\u0443\u0441\u043A \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D!*\n'];

  if (data.results && Array.isArray(data.results)) {
    for (const r of data.results) {
      const icon = r.status === 'success' ? '\u2705' : r.status === 'skipped' ? '\u23ED' : '\u274C';
      const dirName = escapeMd(r.direction || r.direction_name || 'N/A');
      lines.push(`${icon} ${dirName}: ${r.status}${r.adset_name ? ` (${escapeMd(r.adset_name)})` : ''}`);
    }
  } else if (data.message) {
    lines.push(escapeMd(data.message));
  } else {
    lines.push('\u0417\u0430\u043F\u0443\u0441\u043A \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D.');
  }

  return lines.join('\n');
}

// =====================================================
// HANDLER CONTEXT
// =====================================================

export interface MenuHandlerContext {
  bot: TelegramBot;
  session: UserSession;
  chatId: number;
  messageId: number;
  queryId: string;
  telegramId: number;
  activeRequests: Set<number>;
}

// =====================================================
// MAIN DISPATCHER
// =====================================================

/**
 * Обрабатывает callback_query для menu системы.
 * Возвращает true если callback был обработан, false если нет.
 */
export async function handleMenuCallback(
  data: string,
  ctx: MenuHandlerContext,
): Promise<boolean> {
  const { bot, session, queryId, telegramId, activeRequests } = ctx;

  // Проверка параллельных запросов
  if (activeRequests.has(telegramId)) {
    await bot.answerCallbackQuery(queryId, { text: '\u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435, \u043E\u0431\u0440\u0430\u0431\u0430\u0442\u044B\u0432\u0430\u044E \u0437\u0430\u043F\u0440\u043E\u0441...' });
    return true;
  }

  // Проверка что аккаунт выбран
  if (!session.selectedAccountId) {
    await bot.answerCallbackQuery(queryId, { text: '\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0430\u043A\u043A\u0430\u0443\u043D\u0442.' });
    return true;
  }

  const colonIdx = data.indexOf(':');
  if (colonIdx === -1) return false;

  const prefix = data.slice(0, colonIdx);
  const action = data.slice(colonIdx + 1);

  activeRequests.add(telegramId);
  try {
    switch (prefix) {
      case 'menu':
        return await handleMenuAction(action, ctx);
      case 'stats':
        return await handleStatsAction(action, ctx);
      case 'ai':
        return await handleAiAction(action, ctx);
      case 'manual':
        return await handleManualAction(action, ctx);
      case 'back':
        return await handleBackAction(action, ctx);
      default:
        return false;
    }
  } catch (error: any) {
    logger.error({ error: error.message, data }, 'Menu callback error');
    try {
      await bot.answerCallbackQuery(queryId, { text: '\u041E\u0448\u0438\u0431\u043A\u0430. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437.' });
    } catch { /* ignore */ }
    return true;
  } finally {
    activeRequests.delete(telegramId);
  }
}

// =====================================================
// ACTION HANDLERS
// =====================================================

function buildToolInput(session: UserSession, extra?: Record<string, any>): Record<string, any> {
  return {
    userAccountId: session.userAccountId,
    ...(session.selectedAccountId ? { accountId: session.selectedAccountId } : {}),
    ...extra,
  };
}

async function handleMenuAction(action: string, ctx: MenuHandlerContext): Promise<boolean> {
  const { bot, session, chatId, messageId, queryId } = ctx;

  switch (action) {
    case 'stats': {
      await bot.answerCallbackQuery(queryId);
      await bot.editMessageText('\u{1F4CA} \u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043F\u0435\u0440\u0438\u043E\u0434:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: buildStatsKeyboard(),
      });
      return true;
    }

    case 'ailaunch': {
      await bot.answerCallbackQuery(queryId);
      await bot.editMessageText(
        '\u26A0\uFE0F *\u0417\u0430\u043F\u0443\u0441\u043A AI*\n\n\u0420\u0435\u043A\u043B\u0430\u043C\u0430 \u0431\u0443\u0434\u0435\u0442 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0449\u0435\u043D\u0430 \u0434\u043B\u044F \u0412\u0421\u0415\u0425 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0439. \u0421\u0442\u0430\u0440\u044B\u0435 \u0430\u0434\u0441\u0435\u0442\u044B \u0431\u0443\u0434\u0443\u0442 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u044B, \u043D\u043E\u0432\u044B\u0435 \u0441\u043E\u0437\u0434\u0430\u043D\u044B \u0441 \u043B\u0443\u0447\u0448\u0438\u043C\u0438 \u043A\u0440\u0435\u0430\u0442\u0438\u0432\u0430\u043C\u0438.\n\n\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C?',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: buildAiLaunchConfirmKeyboard(),
        },
      );
      return true;
    }

    case 'manual': {
      await bot.answerCallbackQuery(queryId);
      await bot.editMessageText('\u23F3 \u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F...', {
        chat_id: chatId,
        message_id: messageId,
      });

      const result = await executeTool('getDirections', buildToolInput(session));

      const ex = extractResult(result);
      if (!ex.ok) {
        await safeSendOrEdit(bot, chatId, messageId, `\u274C ${ex.error}`);
        return true;
      }
      const dirs = ex.data?.directions || (Array.isArray(ex.data) ? ex.data : []);
      if (!Array.isArray(dirs) || dirs.length === 0) {
        await bot.editMessageText('\u{1F4CB} \u041D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0439 \u043D\u0435\u0442. \u0421\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0441\u043D\u0430\u0447\u0430\u043B\u0430.', {
          chat_id: chatId,
          message_id: messageId,
        });
        return true;
      }

      // Фильтруем только активные направления
      const activeDirs = dirs.filter((d: any) => d.status === 'active');
      const dirsToShow = activeDirs.length > 0 ? activeDirs : dirs;

      session.menuFlow = {
        flow: 'manual_launch',
        step: 'select_direction',
        data: {
          directions: dirsToShow.map((d: any) => ({ id: d.id, name: d.name })),
        },
        startedAt: Date.now(),
      };

      await bot.editMessageText('\u{1F680} *\u0420\u0443\u0447\u043D\u043E\u0439 \u0437\u0430\u043F\u0443\u0441\u043A* \u2014 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435:', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: buildDirectionsKeyboard(dirsToShow),
      });
      return true;
    }

    case 'dirs': {
      await bot.answerCallbackQuery(queryId);
      await bot.editMessageText('\u23F3 \u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F...', {
        chat_id: chatId,
        message_id: messageId,
      });

      const result = await executeTool('getDirections', buildToolInput(session));
      const text = formatDirections(result);
      await safeSendOrEdit(bot, chatId, messageId, text);
      return true;
    }

    case 'optimize': {
      await bot.answerCallbackQuery(queryId, { text: '\u0417\u0430\u043F\u0443\u0441\u043A\u0430\u044E \u0430\u043D\u0430\u043B\u0438\u0437...' });
      await bot.editMessageText('\u23F3 \u0417\u0430\u043F\u0443\u0441\u043A\u0430\u044E \u043E\u043F\u0442\u0438\u043C\u0438\u0437\u0430\u0446\u0438\u044E (\u0434\u043E 2 \u043C\u0438\u043D)...', {
        chat_id: chatId,
        message_id: messageId,
      });

      const result = await executeTool('triggerBrainOptimizationRun', buildToolInput(session, { dry_run: true }));
      const text = formatOptimizationResult(result);

      storeMenuResponse(chatId, text);
      await safeSendOrEdit(bot, chatId, messageId, text);
      return true;
    }

    case 'creatives': {
      await bot.answerCallbackQuery(queryId);
      await bot.editMessageText('\u23F3 \u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0442\u043E\u043F \u043A\u0440\u0435\u0430\u0442\u0438\u0432\u044B...', {
        chat_id: chatId,
        message_id: messageId,
      });

      const result = await executeTool('getTopCreatives', buildToolInput(session, { period: 'last_7d', metric: 'cpl' }));
      const text = formatTopCreatives(result);

      storeMenuResponse(chatId, text);
      await safeSendOrEdit(bot, chatId, messageId, text);
      return true;
    }

    case 'generate': {
      await bot.answerCallbackQuery(queryId);
      await bot.editMessageText('\u2728 \u041F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0430\u044E \u043D\u0430 \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044E \u043A\u0440\u0435\u0430\u0442\u0438\u0432\u043E\u0432...', {
        chat_id: chatId,
        message_id: messageId,
      });
      await bot.sendMessage(chatId,
        '\u2728 \u041D\u0430\u0447\u0438\u043D\u0430\u0435\u043C \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044E \u043A\u0440\u0435\u0430\u0442\u0438\u0432\u0430! \u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0447\u0442\u043E \u0445\u043E\u0442\u0438\u0442\u0435 \u2014 \u0441\u0442\u0438\u043B\u044C, \u0442\u0435\u043C\u0430\u0442\u0438\u043A\u0443, \u0434\u043B\u044F \u043A\u0430\u043A\u043E\u0433\u043E \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F. \u0418\u043B\u0438 \u043F\u0440\u043E\u0441\u0442\u043E \u043D\u0430\u043F\u0438\u0448\u0438\u0442\u0435 "\u0441\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u0443\u0439 \u043A\u0440\u0435\u0430\u0442\u0438\u0432" \u0438 \u044F \u0437\u0430\u0434\u0430\u043C \u0443\u0442\u043E\u0447\u043D\u044F\u044E\u0449\u0438\u0435 \u0432\u043E\u043F\u0440\u043E\u0441\u044B.',
      );
      return true;
    }

    default:
      return false;
  }
}

async function handleStatsAction(period: string, ctx: MenuHandlerContext): Promise<boolean> {
  const { bot, session, chatId, messageId, queryId } = ctx;

  const periodMap: Record<string, { param: string; label: string }> = {
    today: { param: 'today', label: '\u0441\u0435\u0433\u043E\u0434\u043D\u044F' },
    yesterday: { param: 'yesterday', label: '\u0432\u0447\u0435\u0440\u0430' },
    '3d': { param: 'last_3d', label: '\u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 3 \u0434\u043D\u044F' },
    '7d': { param: 'last_7d', label: '\u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 7 \u0434\u043D\u0435\u0439' },
  };

  const p = periodMap[period];
  if (!p) return false;

  await bot.answerCallbackQuery(queryId, { text: '\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E...' });
  await bot.editMessageText(`\u23F3 \u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0443 \u0437\u0430 ${p.label}...`, {
    chat_id: chatId,
    message_id: messageId,
  });

  const result = await executeTool('getSpendReport', buildToolInput(session, {
    period: p.param,
    group_by: 'campaign',
  }));

  logger.debug({ resultKeys: result ? Object.keys(result) : null, success: result?.success }, 'Stats result structure');
  const text = formatSpendReport(result, p.label);
  logger.debug({ textLen: text.length, textPreview: text.slice(0, 200) }, 'Formatted stats text');
  storeMenuResponse(chatId, text);
  await safeSendOrEdit(bot, chatId, messageId, text);
  return true;
}

async function handleAiAction(action: string, ctx: MenuHandlerContext): Promise<boolean> {
  const { bot, session, chatId, messageId, queryId, telegramId } = ctx;

  if (action === 'cancel') {
    await bot.answerCallbackQuery(queryId);
    await bot.editMessageText('\u21A9\uFE0F \u041E\u043F\u0435\u0440\u0430\u0446\u0438\u044F \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u0430.', {
      chat_id: chatId,
      message_id: messageId,
    });
    return true;
  }

  if (action === 'confirm') {
    await bot.answerCallbackQuery(queryId, { text: '\u0417\u0430\u043F\u0443\u0441\u043A\u0430\u044E AI...' });
    await bot.editMessageText('\u23F3 \u0412\u044B\u043F\u043E\u043B\u043D\u044F\u044E AI \u0437\u0430\u043F\u0443\u0441\u043A (\u0434\u043E 3 \u043C\u0438\u043D)...', {
      chat_id: chatId,
      message_id: messageId,
    });

    logger.info({ toolName: 'aiLaunch', telegramId, chatId }, 'AUDIT: AI Launch via menu');

    const result = await executeTool('aiLaunch', buildToolInput(session));
    logger.info({ chatId, resultSuccess: result?.success, hasResult: !!result?.result }, 'AI Launch tool result received');
    const text = formatAiLaunchResult(result);
    logger.info({ chatId, textLen: text.length, textPreview: text.slice(0, 100) }, 'AI Launch formatted');

    storeMenuResponse(chatId, text);
    await safeSendOrEdit(bot, chatId, messageId, text);
    logger.info({ chatId }, 'AI Launch response sent');
    return true;
  }

  return false;
}

async function handleManualAction(indexStr: string, ctx: MenuHandlerContext): Promise<boolean> {
  const { bot, session, chatId, messageId, queryId } = ctx;

  const flow = session.menuFlow;
  if (!flow || flow.flow !== 'manual_launch' || !flow.data.directions) {
    await bot.answerCallbackQuery(queryId, { text: '\u0421\u0435\u0441\u0441\u0438\u044F \u0438\u0441\u0442\u0435\u043A\u043B\u0430. \u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0437\u0430\u043D\u043E\u0432\u043E.' });
    return true;
  }

  if (Date.now() - flow.startedAt > MENU_FLOW_TTL_MS) {
    session.menuFlow = null;
    await bot.answerCallbackQuery(queryId, { text: '\u0421\u0435\u0441\u0441\u0438\u044F \u043C\u0435\u043D\u044E \u0438\u0441\u0442\u0435\u043A\u043B\u0430.' });
    return true;
  }

  const index = parseInt(indexStr, 10);
  if (isNaN(index) || index < 0 || index >= flow.data.directions.length) {
    await bot.answerCallbackQuery(queryId, { text: '\u041D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E.' });
    return true;
  }

  const dir = flow.data.directions[index];

  await bot.answerCallbackQuery(queryId);
  await bot.editMessageText(`\u23F3 \u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u043A\u0440\u0435\u0430\u0442\u0438\u0432\u044B \u0434\u043B\u044F "${escapeMd(dir.name)}"...`, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
  });

  const result = await executeTool('getDirectionCreatives', buildToolInput(session, {
    direction_id: dir.id,
  }));

  // Извлекаем креативы для контекста
  const ex = extractResult(result);
  const creativesData = ex.ok ? (ex.data.creatives || []) : [];
  const creativesForFlow = creativesData.map((c: any, i: number) => ({
    id: c.id,
    name: c.name || c.title || 'Без имени',
    index: i + 1,
  }));

  // Обновляем flow
  session.menuFlow = {
    flow: 'manual_launch',
    step: 'await_input',
    data: {
      ...flow.data,
      selectedDirectionId: dir.id,
      selectedDirectionName: dir.name,
      creatives: creativesForFlow,
    },
    startedAt: flow.startedAt,
  };

  const text = formatCreativesForManualLaunch(result, dir.name);
  storeMenuResponse(chatId, text);

  // Отправляем новым сообщением (чтобы user мог ответить)
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch {
    await bot.sendMessage(chatId, text);
  }

  // Убираем старые кнопки
  try {
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      { chat_id: chatId, message_id: messageId },
    );
  } catch { /* может уже удалены */ }

  return true;
}

async function handleBackAction(target: string, ctx: MenuHandlerContext): Promise<boolean> {
  const { bot, session, chatId, messageId, queryId } = ctx;

  if (target === 'main') {
    session.menuFlow = null;
    await bot.answerCallbackQuery(queryId);
    const accName = session.adAccounts.find(a => a.id === session.selectedAccountId)?.name || '';
    await bot.editMessageText(`\u2705 *${escapeMd(accName)}* \u2014 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435:`, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: buildMainMenuKeyboard(),
    });
    return true;
  }

  return false;
}

// =====================================================
// HELPERS
// =====================================================

/** Безопасное редактирование с Markdown fallback */
async function safeSendOrEdit(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
    });
  } catch (e: any) {
    const errMsg = e.message || e.response?.body?.description || '';
    logger.warn({ error: errMsg, chatId, textLen: text.length }, 'safeSendOrEdit: editMessage failed, trying fallback');

    if (errMsg.includes("can't parse entities") || errMsg.includes('parse')) {
      // Markdown невалидный — отправляем без форматирования
      try {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId });
      } catch (e2: any) {
        logger.warn({ error: e2.message }, 'safeSendOrEdit: plain edit also failed, sending new message');
        try { await bot.sendMessage(chatId, text); } catch { /* last resort */ }
      }
    } else if (errMsg.includes('message is too long') || errMsg.includes('MESSAGE_TOO_LONG')) {
      // Telegram limit 4096 chars — отправляем новым сообщением
      try {
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      } catch {
        try { await bot.sendMessage(chatId, text); } catch { /* last resort */ }
      }
    } else if (errMsg.includes('message is not modified')) {
      // Контент не изменился — нормально, игнорируем
    } else {
      // Неизвестная ошибка — попробовать отправить новым сообщением
      logger.error({ error: errMsg, chatId }, 'safeSendOrEdit: unexpected error');
      try {
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      } catch {
        try { await bot.sendMessage(chatId, text); } catch { /* last resort */ }
      }
    }
  }
}

/** Сохранить ответ меню в историю */
function storeMenuResponse(chatId: number, text: string): void {
  storeMessage({
    id: `menu-${Date.now()}`,
    chat_id: chatId.toString(),
    sender: ASSISTANT_NAME,
    text,
    timestamp: new Date().toISOString(),
    is_from_me: true,
  });
}

/**
 * Показать главное меню (экспорт для вызова из index.ts)
 */
export async function showMainMenu(
  bot: TelegramBot,
  chatId: number,
  accountName: string,
  options?: { messageId?: number },
): Promise<void> {
  const text = `\u2705 \u0410\u043A\u043A\u0430\u0443\u043D\u0442: *${escapeMd(accountName)}* \u2014 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435:`;

  if (options?.messageId) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: options.messageId,
        parse_mode: 'Markdown',
        reply_markup: buildMainMenuKeyboard(),
      });
    } catch {
      await bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: buildMainMenuKeyboard(),
      });
    }
  } else {
    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: buildMainMenuKeyboard(),
    });
  }
}
