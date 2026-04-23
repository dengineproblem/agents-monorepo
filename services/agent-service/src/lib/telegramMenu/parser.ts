/**
 * Парсер ввода "Ручного запуска" вида:
 *   "1, 3, 5 бюджет $10"
 *   "1 3 5 budget 15"
 *   "1, 2"
 *   "$10 1, 3"
 *
 * Возвращает либо список creative_ids (по индексам) и опциональный дневной бюджет в центах,
 * либо ошибку с подсказкой.
 */

import type { ManualLaunchCreative } from './session.js';

export type ParseResult =
  | {
      ok: true;
      creativeIds: string[];
      creativeIndices: number[];
      dailyBudgetCents?: number;
    }
  | {
      ok: false;
      error: string;
    };

const BUDGET_REGEXES: RegExp[] = [
  /\$\s*(\d+(?:[.,]\d+)?)/i,
  /(\d+(?:[.,]\d+)?)\s*\$/i,
  /бюджет[:\s]*(\d+(?:[.,]\d+)?)/i,
  /budget[:\s]*(\d+(?:[.,]\d+)?)/i,
];

export function parseManualLaunchInput(
  text: string,
  creatives: ManualLaunchCreative[],
): ParseResult {
  const clean = (text || '').trim();
  if (!clean) {
    return {
      ok: false,
      error: 'Пустой ввод. Пример: `1, 3` или `1, 3 бюджет $10`',
    };
  }

  let remaining = clean;
  let budgetUsd: number | undefined;

  for (const re of BUDGET_REGEXES) {
    const m = remaining.match(re);
    if (m) {
      const val = parseFloat(m[1].replace(',', '.'));
      if (!isNaN(val) && val > 0) budgetUsd = val;
      remaining = remaining.replace(m[0], ' ');
      break;
    }
  }

  const numMatches = remaining.match(/\d+/g) || [];
  const rawIndices = numMatches.map(n => parseInt(n, 10)).filter(n => !isNaN(n));

  if (rawIndices.length === 0) {
    return {
      ok: false,
      error:
        'Не нашёл номера креативов. Пример: `1, 3, 5 бюджет $10`.\n' +
        'Для выхода нажмите /menu',
    };
  }

  const max = creatives.length;
  if (max === 0) {
    return { ok: false, error: 'В направлении нет креативов.' };
  }

  const invalid = rawIndices.filter(i => i < 1 || i > max);
  if (invalid.length > 0) {
    return {
      ok: false,
      error: `Неверные номера: ${invalid.join(', ')}. Доступны 1–${max}.`,
    };
  }

  const seen = new Set<number>();
  const indices: number[] = [];
  for (const i of rawIndices) {
    if (!seen.has(i)) {
      seen.add(i);
      indices.push(i);
    }
  }

  const creativeIds = indices.map(i => creatives[i - 1].id);

  if (budgetUsd !== undefined) {
    const cents = Math.round(budgetUsd * 100);
    if (cents < 300) {
      return {
        ok: false,
        error: `Бюджет $${budgetUsd} слишком маленький. Минимум $3.`,
      };
    }
    return { ok: true, creativeIds, creativeIndices: indices, dailyBudgetCents: cents };
  }

  return { ok: true, creativeIds, creativeIndices: indices };
}
