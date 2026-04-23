/**
 * Menu модуль для @prfmntai_bot (legacy-only).
 *
 * Entry points:
 *   - showMainMenu(chatId, userAccountId, { messageId? })  — /menu
 *   - handleMenuCallback(cq, { userAccountId })            — callback_query dispatcher
 *   - buildManualLaunchContext(telegramId)                 — инжект контекста для AI после ручного запуска
 *   - isMenuTrigger(text)                                  — проверка текстовых триггеров
 *
 * Все tools вызываются через POST ${AGENT_BRAIN_URL}/brain/tools/:name с X-Service-Auth.
 * Для legacy-юзеров передаём только userAccountId (agent-brain сам определяет credentials).
 */

import { createLogger } from '../logger.js';
import {
  buildMainMenuKeyboard,
  buildStatsKeyboard,
  buildAiLaunchConfirmKeyboard,
  buildDirectionsKeyboard,
} from './keyboards.js';
import {
  sendMessage,
  editMessageText,
  editMessageReplyMarkup,
  answerCallbackQuery,
  safeEditOrSend,
} from './tgApi.js';
import { executeTool, extractToolResult } from './tools.js';
import {
  formatSpendReport,
  formatDirections,
  formatCreativesForManualLaunch,
  formatOptimizationResult,
  formatTopCreatives,
  formatAiLaunchResult,
  escapeMd,
} from './formatters.js';
import {
  getMenuFlow,
  setMenuFlow,
  clearMenuFlow,
  type ManualLaunchCreative,
} from './session.js';
import { mirrorMenuReply } from './mirror.js';

const log = createLogger({ module: 'telegramMenu' });

// =====================================================
// Types
// =====================================================

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number };
  message?: {
    message_id: number;
    chat: { id: number; type: string };
  };
  data?: string;
}

export interface MenuContext {
  /** UUID user_accounts.id — нужен для вызова tools */
  userAccountId: string;
}

// =====================================================
// Public API
// =====================================================

const MENU_TRIGGERS = new Set(['/menu', 'меню', 'menu', 'главное меню']);

export function isMenuTrigger(text: string | undefined | null): boolean {
  if (!text) return false;
  const trimmed = text.trim().toLowerCase();
  return MENU_TRIGGERS.has(trimmed);
}

export async function showMainMenu(
  chatId: number,
  options: { messageId?: number; userAccountId?: string } = {},
): Promise<void> {
  const text = '👋 Выберите действие:';
  const reply_markup = buildMainMenuKeyboard();

  if (options.messageId) {
    try {
      await editMessageText(chatId, options.messageId, text, { reply_markup });
      if (options.userAccountId) await mirrorMenuReply(options.userAccountId, chatId, text);
      return;
    } catch {
      // fallback — новым сообщением
    }
  }
  await sendMessage(chatId, text, { reply_markup });
  if (options.userAccountId) await mirrorMenuReply(options.userAccountId, chatId, text);
}

/**
 * Главный dispatcher для callback_query.
 * Возвращает true, если callback был обработан (включая ошибки внутри обработчика).
 */
export async function handleMenuCallback(
  cq: TelegramCallbackQuery,
  ctx: MenuContext,
): Promise<boolean> {
  if (!cq.data || !cq.message) {
    try { await answerCallbackQuery(cq.id); } catch { /* ignore */ }
    return false;
  }

  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;
  const telegramId = String(cq.from.id);
  const data = cq.data;

  const colonIdx = data.indexOf(':');
  if (colonIdx === -1) {
    try { await answerCallbackQuery(cq.id); } catch { /* ignore */ }
    return false;
  }

  const prefix = data.slice(0, colonIdx);
  const action = data.slice(colonIdx + 1);

  try {
    switch (prefix) {
      case 'menu':
        return await handleMenuAction(action, { chatId, messageId, queryId: cq.id, telegramId, ctx });
      case 'stats':
        return await handleStatsAction(action, { chatId, messageId, queryId: cq.id, ctx });
      case 'ai':
        return await handleAiAction(action, { chatId, messageId, queryId: cq.id, ctx });
      case 'manual':
        return await handleManualAction(action, { chatId, messageId, queryId: cq.id, telegramId, ctx });
      case 'back':
        return await handleBackAction(action, { chatId, messageId, queryId: cq.id, telegramId, ctx });
      default:
        try { await answerCallbackQuery(cq.id); } catch { /* ignore */ }
        return false;
    }
  } catch (err: any) {
    log.error({ error: String(err), data, telegramId }, 'Menu callback error');
    try {
      await answerCallbackQuery(cq.id, { text: 'Ошибка. Попробуйте ещё раз.' });
    } catch { /* ignore */ }
    return true;
  }
}

/**
 * Проверяет: если у юзера активен flow "Ручной запуск" на шаге await_input —
 * возвращает блок контекста для инжекта в AI-запрос (и сбрасывает flow).
 * Возвращает '' если flow неактивен.
 *
 * Важно: context НЕ меняет message.text пользователя — он дописывается в системную инструкцию
 * через поле `extra_system` при форварде в agent-brain.
 */
export function buildManualLaunchContext(telegramId: string): string {
  const flow = getMenuFlow(telegramId);
  if (!flow) return '';
  if (flow.flow !== 'manual_launch' || flow.step !== 'await_input') return '';
  if (!flow.data.selectedDirectionId) return '';

  const dirName = flow.data.selectedDirectionName || 'N/A';
  const dirId = flow.data.selectedDirectionId;
  const creatives = flow.data.creatives || [];
  const creativesList = creatives
    .map(c => `  ${c.index}. ${c.name} (ID: ${c.id})`)
    .join('\n');

  clearMenuFlow(telegramId);

  log.info({ telegramId, dirId, dirName, creativesCount: creatives.length }, 'Manual launch context injected');

  return [
    '',
    '[КОНТЕКСТ: Пользователь в режиме "Ручной запуск".',
    `Направление: "${dirName}" (direction_id: ${dirId}).`,
    creatives.length ? `Доступные креативы:\n${creativesList}` : 'Креативов в направлении нет.',
    'Пользователь выбирает номера креативов и бюджет для создания адсета.',
    'Используй tool createAdSet с creative_ids (UUID креативов по номерам) и direction_id.',
    'НЕ меняй бюджет направления — создай новый адсет.]',
  ].join('\n');
}

// =====================================================
// Sub-handlers
// =====================================================

interface HandlerArgs {
  chatId: number;
  messageId: number;
  queryId: string;
  telegramId?: string;
  ctx: MenuContext;
}

function buildToolInput(ctx: MenuContext, extra: Record<string, any> = {}): Record<string, any> {
  // Legacy режим: передаём только userAccountId.
  // agent-brain getCredentials() сам смотрит user_accounts.multi_account_enabled и берёт creds.
  return {
    userAccountId: ctx.userAccountId,
    ...extra,
  };
}

async function handleMenuAction(action: string, a: HandlerArgs): Promise<boolean> {
  const { chatId, messageId, queryId, telegramId, ctx } = a;
  const mirror = (text: string) => mirrorMenuReply(ctx.userAccountId, chatId, text);

  switch (action) {
    case 'stats': {
      await answerCallbackQuery(queryId);
      const text = '📊 Выберите период:';
      await editMessageText(chatId, messageId, text, { reply_markup: buildStatsKeyboard() });
      await mirror(text);
      return true;
    }

    case 'ailaunch': {
      await answerCallbackQuery(queryId);
      const text = '⚠️ *Запуск AI*\n\nРеклама будет перезапущена для ВСЕХ активных направлений. Старые адсеты будут остановлены, новые созданы с лучшими креативами.\n\nПодтвердить?';
      await editMessageText(chatId, messageId, text, {
        parse_mode: 'Markdown',
        reply_markup: buildAiLaunchConfirmKeyboard(),
      });
      await mirror(text);
      return true;
    }

    case 'manual': {
      await answerCallbackQuery(queryId);
      await editMessageText(chatId, messageId, '⏳ Загружаю направления...');

      const result = await executeTool('getDirections', buildToolInput(ctx));
      const ex = extractToolResult(result);
      if (!ex.ok) {
        const text = `❌ ${ex.error}`;
        await safeEditOrSend(chatId, messageId, text);
        await mirror(text);
        return true;
      }
      const dirs: Array<{ id: string; name: string; status?: string }> =
        ex.data?.directions || (Array.isArray(ex.data) ? ex.data : []);
      if (!Array.isArray(dirs) || dirs.length === 0) {
        const text = '📋 Направлений нет. Создайте направление сначала.';
        await editMessageText(chatId, messageId, text);
        await mirror(text);
        return true;
      }

      const activeDirs = dirs.filter(d => d.status === 'active');
      const dirsToShow = activeDirs.length > 0 ? activeDirs : dirs;

      if (telegramId) {
        setMenuFlow(telegramId, {
          flow: 'manual_launch',
          step: 'select_direction',
          data: { directions: dirsToShow.map(d => ({ id: d.id, name: d.name })) },
          startedAt: Date.now(),
        });
      }

      const text = '🚀 *Ручной запуск* — выберите направление:';
      await editMessageText(chatId, messageId, text, {
        parse_mode: 'Markdown',
        reply_markup: buildDirectionsKeyboard(dirsToShow),
      });
      await mirror(text);
      return true;
    }

    case 'dirs': {
      await answerCallbackQuery(queryId);
      await editMessageText(chatId, messageId, '⏳ Загружаю направления...');
      const result = await executeTool('getDirections', buildToolInput(ctx));
      const text = formatDirections(result);
      await safeEditOrSend(chatId, messageId, text);
      await mirror(text);
      return true;
    }

    case 'optimize': {
      await answerCallbackQuery(queryId, { text: 'Запускаю анализ...' });
      await editMessageText(chatId, messageId, '⏳ Запускаю оптимизацию (до 2 мин)...');
      const result = await executeTool(
        'triggerBrainOptimizationRun',
        buildToolInput(ctx, { dry_run: true }),
      );
      const text = formatOptimizationResult(result);
      await safeEditOrSend(chatId, messageId, text);
      await mirror(text);
      return true;
    }

    case 'creatives': {
      await answerCallbackQuery(queryId);
      await editMessageText(chatId, messageId, '⏳ Загружаю топ креативы...');
      const result = await executeTool(
        'getTopCreatives',
        buildToolInput(ctx, { period: 'last_7d', metric: 'cpl' }),
      );
      const text = formatTopCreatives(result);
      await safeEditOrSend(chatId, messageId, text);
      await mirror(text);
      return true;
    }

    default:
      try { await answerCallbackQuery(queryId); } catch { /* ignore */ }
      return false;
  }
}

async function handleStatsAction(period: string, a: HandlerArgs): Promise<boolean> {
  const { chatId, messageId, queryId, ctx } = a;
  const mirror = (text: string) => mirrorMenuReply(ctx.userAccountId, chatId, text);

  const periodMap: Record<string, { param: string; label: string }> = {
    today: { param: 'today', label: 'сегодня' },
    yesterday: { param: 'yesterday', label: 'вчера' },
    '3d': { param: 'last_3d', label: 'последние 3 дня' },
    '7d': { param: 'last_7d', label: 'последние 7 дней' },
  };

  const p = periodMap[period];
  if (!p) {
    try { await answerCallbackQuery(queryId); } catch { /* ignore */ }
    return false;
  }

  await answerCallbackQuery(queryId, { text: 'Загружаю...' });
  await editMessageText(chatId, messageId, `⏳ Загружаю статистику за ${p.label}...`);

  const result = await executeTool(
    'getSpendReport',
    buildToolInput(ctx, { period: p.param, group_by: 'campaign' }),
  );
  const text = formatSpendReport(result, p.label);
  await safeEditOrSend(chatId, messageId, text);
  await mirror(text);
  return true;
}

async function handleAiAction(action: string, a: HandlerArgs): Promise<boolean> {
  const { chatId, messageId, queryId, ctx } = a;
  const mirror = (text: string) => mirrorMenuReply(ctx.userAccountId, chatId, text);

  if (action === 'cancel') {
    await answerCallbackQuery(queryId);
    const text = '↩️ Операция отменена.';
    await editMessageText(chatId, messageId, text);
    await mirror(text);
    return true;
  }

  if (action === 'confirm') {
    await answerCallbackQuery(queryId, { text: 'Запускаю AI...' });
    await editMessageText(chatId, messageId, '⏳ Выполняю AI запуск (до 3 мин)...');

    log.info({ userAccountId: ctx.userAccountId, chatId }, 'AUDIT: AI Launch via menu');
    const result = await executeTool('aiLaunch', buildToolInput(ctx));
    const text = formatAiLaunchResult(result);
    await safeEditOrSend(chatId, messageId, text);
    await mirror(text);
    return true;
  }

  try { await answerCallbackQuery(queryId); } catch { /* ignore */ }
  return false;
}

async function handleManualAction(indexStr: string, a: HandlerArgs): Promise<boolean> {
  const { chatId, messageId, queryId, telegramId, ctx } = a;
  const mirror = (t: string) => mirrorMenuReply(ctx.userAccountId, chatId, t);

  if (!telegramId) {
    try { await answerCallbackQuery(queryId, { text: 'Нет контекста.' }); } catch { /* ignore */ }
    return true;
  }

  const flow = getMenuFlow(telegramId);
  if (!flow || flow.flow !== 'manual_launch' || !flow.data.directions) {
    try { await answerCallbackQuery(queryId, { text: 'Сессия истекла. Выберите действие заново.' }); } catch { /* ignore */ }
    return true;
  }

  const index = parseInt(indexStr, 10);
  if (isNaN(index) || index < 0 || index >= flow.data.directions.length) {
    try { await answerCallbackQuery(queryId, { text: 'Направление не найдено.' }); } catch { /* ignore */ }
    return true;
  }

  const dir = flow.data.directions[index];

  await answerCallbackQuery(queryId);
  await editMessageText(chatId, messageId, `⏳ Загружаю креативы для "${escapeMd(dir.name)}"...`, {
    parse_mode: 'Markdown',
  });

  const result = await executeTool(
    'getDirectionCreatives',
    buildToolInput(ctx, { direction_id: dir.id }),
  );

  const ex = extractToolResult(result);
  const creativesData: any[] = ex.ok ? (ex.data.creatives || []) : [];
  const creativesForFlow: ManualLaunchCreative[] = creativesData.map((c: any, i: number) => ({
    id: c.id,
    name: c.name || c.title || 'Без имени',
    index: i + 1,
  }));

  setMenuFlow(telegramId, {
    flow: 'manual_launch',
    step: 'await_input',
    data: {
      ...flow.data,
      selectedDirectionId: dir.id,
      selectedDirectionName: dir.name,
      creatives: creativesForFlow,
    },
    startedAt: flow.startedAt,
  });

  const text = formatCreativesForManualLaunch(result, dir.name);
  try {
    await sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch {
    try { await sendMessage(chatId, text); } catch { /* ignore */ }
  }
  await mirror(text);

  try {
    await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
  } catch { /* возможно удалены */ }

  return true;
}

async function handleBackAction(
  target: string,
  a: HandlerArgs,
): Promise<boolean> {
  const { chatId, messageId, queryId, telegramId, ctx } = a;

  if (target === 'main') {
    if (telegramId) clearMenuFlow(telegramId);
    try { await answerCallbackQuery(queryId); } catch { /* ignore */ }
    const text = '👋 Выберите действие:';
    await editMessageText(chatId, messageId, text, { reply_markup: buildMainMenuKeyboard() });
    await mirrorMenuReply(ctx.userAccountId, chatId, text);
    return true;
  }

  try { await answerCallbackQuery(queryId); } catch { /* ignore */ }
  return false;
}
