/**
 * Модуль для контроля затрат на AI модели
 *
 * - Проверка дневных лимитов пользователей
 * - Трекинг использования токенов
 * - Калькуляция стоимости запросов
 */

import { supabase } from './supabaseClient.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'usageLimits' });

/**
 * Pricing для разных моделей ($/1M токенов)
 */
export const MODEL_PRICING = {
  'gpt-5.2': {
    input: 1.75 / 1_000_000,   // $1.75 per 1M input tokens
    output: 14.00 / 1_000_000  // $14.00 per 1M output tokens
  },
  'claude-sonnet-4-20250514': {
    input: 3.00 / 1_000_000,
    output: 15.00 / 1_000_000
  },
  'gpt-4o': {
    input: 2.50 / 1_000_000,
    output: 10.00 / 1_000_000
  },
  'gemini-3-pro-preview': {
    input: 2.00 / 1_000_000,    // $2.00 per 1M input tokens (estimated)
    output: 8.00 / 1_000_000    // $8.00 per 1M output tokens (estimated)
  }
};

/**
 * Валидация Telegram ID
 * @param {any} telegramId - Telegram ID для проверки
 * @returns {boolean} true если валидный
 */
function isValidTelegramId(telegramId) {
  if (!telegramId) return false;
  const str = String(telegramId);
  // Telegram ID - число или строка с числами, длина обычно 8-12 символов
  return str.length > 0 && /^\d+$/.test(str) && str.length >= 5 && str.length <= 15;
}

/**
 * Нормализация имени модели
 * Убирает префиксы openai/ anthropic/ google/ и приводит к стандартному виду
 */
export function normalizeModelName(model) {
  if (!model) {
    log.warn('normalizeModelName called with empty model');
    return 'unknown';
  }

  // Убираем провайдера
  const normalized = model.replace(/^(openai|anthropic|google)\//, '');

  // Проверяем есть ли в pricing
  if (MODEL_PRICING[normalized]) {
    log.debug({ original: model, normalized }, 'Model name normalized');
    return normalized;
  }

  // Неизвестная модель - логируем warning
  log.warn({ model, normalized }, 'Unknown model in pricing table');
  return normalized;
}

/**
 * Калькуляция стоимости запроса в USD
 *
 * @param {string} model - Название модели
 * @param {object} usage - Объект с prompt_tokens и completion_tokens
 * @returns {number} Стоимость в USD
 */
export function calculateCost(model, usage) {
  if (!usage || (!usage.prompt_tokens && !usage.completion_tokens)) {
    log.warn({ model, usage }, 'No usage data provided for cost calculation');
    return 0;
  }

  const normalizedModel = normalizeModelName(model);
  const pricing = MODEL_PRICING[normalizedModel];

  if (!pricing) {
    log.warn({ model: normalizedModel }, 'Unknown model, cannot calculate cost');
    return 0;
  }

  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const inputCost = promptTokens * pricing.input;
  const outputCost = completionTokens * pricing.output;
  const totalCost = inputCost + outputCost;

  log.info({
    model: normalizedModel,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    input_cost_usd: inputCost.toFixed(6),
    output_cost_usd: outputCost.toFixed(6),
    total_cost_usd: totalCost.toFixed(6)
  }, 'Cost calculated');

  return totalCost;
}

/**
 * Проверка дневного лимита пользователя
 *
 * @param {string} telegramId - Telegram ID пользователя
 * @returns {Promise<{allowed: boolean, remaining: number, limit: number, spent: number, nearLimit?: boolean}>}
 */
export async function checkUserLimit(telegramId) {
  const checkStartTime = Date.now();

  // Валидация telegramId
  if (!telegramId) {
    log.error('checkUserLimit: No telegramId provided');
    return { allowed: false, remaining: 0, limit: 0, spent: 0, error: 'No telegram ID' };
  }

  if (!isValidTelegramId(telegramId)) {
    log.error({ telegramId }, 'checkUserLimit: Invalid telegram ID format');
    return { allowed: false, remaining: 0, limit: 0, spent: 0, error: 'Invalid telegram ID' };
  }

  const today = new Date().toISOString().split('T')[0];
  log.debug({ telegramId, date: today }, 'Starting limit check');

  try {
    // 1. Получаем лимит пользователя
    const { data: limit, error: limitError } = await supabase
      .from('user_ai_limits')
      .select('daily_limit_usd, is_unlimited')
      .eq('telegram_id', telegramId)
      .single();

    if (limitError && limitError.code !== 'PGRST116') { // PGRST116 = not found
      log.error({ error: limitError, telegramId, code: limitError.code }, 'Database error fetching user limit');
      // При ошибке БД - разрешаем (fail open) но логируем критическую ошибку
      log.warn({ telegramId }, 'FAIL-OPEN: Allowing request due to DB error');
      return { allowed: true, remaining: 1.00, limit: 1.00, spent: 0, failOpen: true };
    }

    // 2. Если лимита нет - создаём с дефолтным значением
    if (!limit) {
      log.info({ telegramId }, 'New user detected, creating default limit ($1/day)');

      const { error: insertError } = await supabase
        .from('user_ai_limits')
        .insert({
          telegram_id: telegramId,
          daily_limit_usd: 1.00 // $1/день по умолчанию
        });

      if (insertError) {
        log.error({ error: insertError, telegramId }, 'Failed to create default limit');
      } else {
        log.info({ telegramId }, 'Default limit created successfully');
      }

      return { allowed: true, remaining: 1.00, limit: 1.00, spent: 0 };
    }

    // 3. Unlimited пользователи
    if (limit.is_unlimited) {
      log.info({ telegramId }, 'User has UNLIMITED access');
      return { allowed: true, remaining: Infinity, limit: Infinity, spent: 0, unlimited: true };
    }

    // 4. Получаем текущий расход за сегодня
    const { data: usageRows, error: usageError } = await supabase
      .from('user_ai_usage')
      .select('cost_usd')
      .eq('telegram_id', telegramId)
      .eq('date', today);

    if (usageError) {
      log.error({ error: usageError, telegramId }, 'Database error fetching usage');
      // При ошибке БД - разрешаем
      log.warn({ telegramId }, 'FAIL-OPEN: Allowing request due to usage fetch error');
      return { allowed: true, remaining: limit.daily_limit_usd, limit: limit.daily_limit_usd, spent: 0, failOpen: true };
    }

    // 5. Суммируем затраты
    const totalSpent = usageRows?.reduce((sum, row) => sum + parseFloat(row.cost_usd || 0), 0) || 0;
    const remaining = limit.daily_limit_usd - totalSpent;
    const checkDuration = Date.now() - checkStartTime;

    // Вычисляем % использования
    const usagePercent = (totalSpent / limit.daily_limit_usd) * 100;
    const nearLimit = remaining > 0 && usagePercent >= 80; // Близко к лимиту если использовано >=80%

    if (nearLimit) {
      log.warn({
        telegramId,
        limit: limit.daily_limit_usd,
        spent: totalSpent.toFixed(4),
        remaining: remaining.toFixed(4),
        usagePercent: usagePercent.toFixed(1)
      }, 'User is near daily limit (>=80% used)');
    } else {
      log.info({
        telegramId,
        limit: limit.daily_limit_usd,
        spent: totalSpent.toFixed(4),
        remaining: remaining.toFixed(4),
        usagePercent: usagePercent.toFixed(1),
        checkDuration
      }, 'Limit check passed');
    }

    return {
      allowed: remaining > 0,
      remaining: Math.max(0, remaining),
      limit: limit.daily_limit_usd,
      spent: totalSpent,
      nearLimit
    };

  } catch (error) {
    log.error({
      error: error.message,
      stack: error.stack,
      telegramId
    }, 'Unexpected error in checkUserLimit');
    // При неожиданной ошибке - разрешаем (fail open)
    log.warn({ telegramId }, 'FAIL-OPEN: Allowing request due to unexpected error');
    return { allowed: true, remaining: 1.00, limit: 1.00, spent: 0, failOpen: true };
  }
}

/**
 * Записывает использование токенов в БД
 *
 * @param {string} telegramId - Telegram ID пользователя
 * @param {string} model - Название модели
 * @param {object} usage - Объект с prompt_tokens и completion_tokens
 */
export async function trackUsage(telegramId, model, usage) {
  const trackStartTime = Date.now();

  // Валидация параметров
  if (!telegramId || !model || !usage) {
    log.error({ telegramId, model, usage }, 'trackUsage: Missing required parameters');
    return;
  }

  if (!isValidTelegramId(telegramId)) {
    log.error({ telegramId }, 'trackUsage: Invalid telegram ID format');
    return;
  }

  if (!usage.prompt_tokens && !usage.completion_tokens) {
    log.warn({ telegramId, model, usage }, 'trackUsage: No tokens in usage data');
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const cost = calculateCost(model, usage);
  const normalizedModel = normalizeModelName(model);

  log.debug({
    telegramId,
    model: normalizedModel,
    date: today,
    prompt_tokens: usage.prompt_tokens || 0,
    completion_tokens: usage.completion_tokens || 0,
    cost_usd: cost.toFixed(6)
  }, 'Attempting to track usage');

  try {
    const { error } = await supabase.rpc('increment_usage', {
      p_telegram_id: telegramId,
      p_date: today,
      p_model: normalizedModel,
      p_prompt_tokens: usage.prompt_tokens || 0,
      p_completion_tokens: usage.completion_tokens || 0,
      p_cost_usd: cost,
      p_request_count: 1
    });

    const trackDuration = Date.now() - trackStartTime;

    if (error) {
      log.error({
        error: error.message,
        code: error.code,
        telegramId,
        model: normalizedModel,
        cost: cost.toFixed(6),
        trackDuration
      }, 'Database error tracking usage');
    } else {
      log.info({
        telegramId,
        model: normalizedModel,
        date: today,
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
        cost_usd: cost.toFixed(6),
        trackDuration
      }, 'Usage tracked successfully');
    }
  } catch (error) {
    log.error({
      error: error.message,
      stack: error.stack,
      telegramId,
      model: normalizedModel,
      cost: cost.toFixed(6)
    }, 'Unexpected error in trackUsage');
  }
}

/**
 * Форматирует сообщение об превышении лимита
 *
 * @param {object} limitCheck - Результат checkUserLimit()
 * @returns {string} Сообщение для пользователя
 */
export function formatLimitExceededMessage(limitCheck) {
  const usagePercent = Math.round((limitCheck.spent / limitCheck.limit) * 100);

  return `⚠️ Превышен дневной лимит использования AI

Использовано: ${usagePercent}% дневного лимита

Попробуйте завтра или обратитесь в поддержку для увеличения лимита.`;
}

/**
 * Форматирует предупреждение о приближении к лимиту
 *
 * @param {object} limitCheck - Результат checkUserLimit()
 * @returns {string} Сообщение для пользователя
 */
export function formatNearLimitWarning(limitCheck) {
  const usagePercent = Math.round((limitCheck.spent / limitCheck.limit) * 100);
  const remainingPercent = 100 - usagePercent;

  return `⚠️ Внимание: Использовано ${usagePercent}% дневного лимита AI.

Осталось: ${remainingPercent}%`;
}
