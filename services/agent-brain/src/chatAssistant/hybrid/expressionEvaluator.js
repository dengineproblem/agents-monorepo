/**
 * Expression Evaluator - Безопасный eval для условий
 *
 * Поддерживает выражения типа:
 * - 'cpl > targetCpl * 1.3'
 * - 'impressions < 1000'
 * - 'directions_count > 1'
 * - 'spend == 0'
 */

import { logger } from '../../lib/logger.js';

/**
 * Допустимые операторы
 */
const ALLOWED_OPERATORS = ['>', '<', '>=', '<=', '==', '!=', '&&', '||', '+', '-', '*', '/'];

/**
 * Безопасный eval для простых математических/логических выражений
 * @param {string} expression - Выражение для вычисления
 * @param {Object} context - Контекст с переменными
 * @returns {any} Результат вычисления
 */
export function evaluateExpression(expression, context = {}) {
  try {
    // Проверяем на запрещённые конструкции
    if (containsDangerousCode(expression)) {
      logger.warn({ expression }, 'Dangerous expression blocked');
      return false;
    }

    // Заменяем переменные на значения из контекста
    let evalString = expression;

    // Сортируем ключи по длине (longer first) чтобы избежать частичной замены
    const sortedKeys = Object.keys(context).sort((a, b) => b.length - a.length);

    for (const key of sortedKeys) {
      const value = context[key];
      const regex = new RegExp(`\\b${key}\\b`, 'g');

      if (typeof value === 'number') {
        evalString = evalString.replace(regex, String(value));
      } else if (typeof value === 'boolean') {
        evalString = evalString.replace(regex, String(value));
      } else if (typeof value === 'string') {
        evalString = evalString.replace(regex, `"${value}"`);
      } else if (value === null || value === undefined) {
        evalString = evalString.replace(regex, 'null');
      }
    }

    // Проверяем, что после замены осталось только безопасное выражение
    if (!isSafeExpression(evalString)) {
      logger.warn({ expression, evalString }, 'Unsafe expression after substitution');
      return false;
    }

    // Используем Function для изолированного eval
    const fn = new Function(`return (${evalString})`);
    const result = fn();

    logger.debug({ expression, context, evalString, result }, 'Expression evaluated');

    return result;
  } catch (error) {
    logger.error({ expression, context, error: error.message }, 'Expression evaluation failed');
    return false;
  }
}

/**
 * Проверка на опасный код
 * @param {string} expression
 * @returns {boolean}
 */
function containsDangerousCode(expression) {
  const dangerous = [
    /\bfunction\b/i,
    /\breturn\b/i,
    /\beval\b/i,
    /\bimport\b/i,
    /\brequire\b/i,
    /\bexport\b/i,
    /\bprocess\b/i,
    /\bglobal\b/i,
    /\bwindow\b/i,
    /\bdocument\b/i,
    /\bconstructor\b/i,
    /\bprototype\b/i,
    /\b__proto__\b/i,
    /\[\s*['"`]/,  // property access via string
    /\bFetch\b/i,
    /\bXMLHttp/i,
    /\.\s*call\b/,
    /\.\s*apply\b/,
    /\.\s*bind\b/
  ];

  return dangerous.some(pattern => pattern.test(expression));
}

/**
 * Проверка, что выражение безопасно после подстановки
 * @param {string} evalString
 * @returns {boolean}
 */
function isSafeExpression(evalString) {
  // Должно содержать только: числа, операторы, скобки, пробелы, true/false, null
  const safePattern = /^[\d\s\.\+\-\*\/\>\<\=\!\&\|\(\)truefalslenull"]+$/;
  return safePattern.test(evalString);
}

/**
 * Предустановленные условия для playbooks
 */
export const PRESET_CONDITIONS = {
  /**
   * Малая выборка (< 1000 impressions)
   */
  isSmallSample: (data) => {
    const impressions = data.impressions || data.total_impressions || 0;
    return impressions < 1000;
  },

  /**
   * Дорогой лид (CPL > target * 1.3)
   */
  isHighCPL: (data) => {
    const cpl = data.cpl || data.avg_cpl || 0;
    const targetCpl = data.targetCpl || data.target_cpl || data.target_cpl_cents / 100 || Infinity;
    return cpl > targetCpl * 1.3;
  },

  /**
   * Нулевой расход
   */
  isZeroSpend: (data) => {
    const spend = data.spend || data.total_spend || 0;
    return spend === 0 || spend < 1;
  },

  /**
   * Есть расход, но нет лидов
   */
  isSpendNoLeads: (data) => {
    const spend = data.spend || data.total_spend || 0;
    const leads = data.leads || data.total_leads || 0;
    return spend > 10 && leads === 0;
  },

  /**
   * Низкий CTR (< 0.5%)
   */
  isLowCTR: (data) => {
    const ctr = data.ctr || data.avg_ctr || 0;
    return ctr < 0.5;
  },

  /**
   * Высокая частота (frequency > 3)
   */
  isHighFrequency: (data) => {
    const frequency = data.frequency || data.avg_frequency || 0;
    return frequency > 3;
  },

  /**
   * Много направлений (> 1)
   */
  hasMultipleDirections: (data) => {
    const count = data.directions_count || data.directionsCount || 0;
    return count > 1;
  }
};

/**
 * Вычисляет условие по имени или выражению
 * @param {string} condition - Имя предустановленного условия или выражение
 * @param {Object} data - Данные для проверки
 * @returns {boolean}
 */
export function evaluateCondition(condition, data) {
  // Проверяем предустановленные условия
  if (PRESET_CONDITIONS[condition]) {
    return PRESET_CONDITIONS[condition](data);
  }

  // Иначе вычисляем как выражение
  return evaluateExpression(condition, data);
}

export default {
  evaluateExpression,
  evaluateCondition,
  PRESET_CONDITIONS
};
