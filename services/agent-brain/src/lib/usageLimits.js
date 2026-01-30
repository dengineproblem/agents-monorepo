/**
 * Модуль для контроля затрат на AI модели
 *
 * - Проверка дневных лимитов пользователей
 * - Трекинг использования токенов
 * - Калькуляция стоимости запросов
 */

import { supabase } from './supabase.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'usageLimits' });

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
  }
};

/**
 * Нормализация имени модели
 * Убирает префиксы openai/ anthropic/ и приводит к стандартному виду
 */
export function normalizeModelName(model) {
  if (!model) return 'unknown';

  // Убираем провайдера
  const normalized = model.replace(/^(openai|anthropic)\//, '');

  // Проверяем есть ли в pricing
  if (MODEL_PRICING[normalized]) {
    return normalized;
  }

  // Возвращаем как есть
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
    log.warn({ model }, 'No usage data provided for cost calculation');
    return 0;
  }

  const normalizedModel = normalizeModelName(model);
  const pricing = MODEL_PRICING[normalizedModel];

  if (!pricing) {
    log.warn({ model: normalizedModel }, 'Unknown model, cannot calculate cost');
    return 0;
  }

  const inputCost = (usage.prompt_tokens || 0) * pricing.input;
  const outputCost = (usage.completion_tokens || 0) * pricing.output;
  const totalCost = inputCost + outputCost;

  log.debug({
    model: normalizedModel,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    cost_usd: totalCost.toFixed(6)
  }, 'Calculated request cost');

  return totalCost;
}

/**
 * Проверка дневного лимита пользователя
 *
 * @param {string} telegramId - Telegram ID пользователя
 * @returns {Promise<{allowed: boolean, remaining: number, limit: number, spent: number}>}
 */
export async function checkUserLimit(telegramId) {
  if (!telegramId) {
    log.error('No telegramId provided for limit check');
    return { allowed: false, remaining: 0, limit: 0, spent: 0, error: 'No telegram ID' };
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    // 1. Получаем лимит пользователя
    const { data: limit, error: limitError } = await supabase
      .from('user_ai_limits')
      .select('daily_limit_usd, is_unlimited')
      .eq('telegram_id', telegramId)
      .single();

    if (limitError && limitError.code !== 'PGRST116') { // PGRST116 = not found
      log.error({ error: limitError, telegramId }, 'Error fetching user limit');
      // При ошибке БД - разрешаем (fail open)
      return { allowed: true, remaining: 1.00, limit: 1.00, spent: 0 };
    }

    // 2. Если лимита нет - создаём с дефолтным значением
    if (!limit) {
      const { error: insertError } = await supabase
        .from('user_ai_limits')
        .insert({
          telegram_id: telegramId,
          daily_limit_usd: 1.00 // $1/день по умолчанию
        });

      if (insertError) {
        log.error({ error: insertError, telegramId }, 'Error creating default limit');
      }

      return { allowed: true, remaining: 1.00, limit: 1.00, spent: 0 };
    }

    // 3. Unlimited пользователи
    if (limit.is_unlimited) {
      log.debug({ telegramId }, 'User has unlimited access');
      return { allowed: true, remaining: Infinity, limit: Infinity, spent: 0 };
    }

    // 4. Получаем текущий расход за сегодня
    const { data: usageRows, error: usageError } = await supabase
      .from('user_ai_usage')
      .select('cost_usd')
      .eq('telegram_id', telegramId)
      .eq('date', today);

    if (usageError) {
      log.error({ error: usageError, telegramId }, 'Error fetching usage');
      // При ошибке БД - разрешаем
      return { allowed: true, remaining: limit.daily_limit_usd, limit: limit.daily_limit_usd, spent: 0 };
    }

    // 5. Суммируем затраты
    const totalSpent = usageRows?.reduce((sum, row) => sum + parseFloat(row.cost_usd || 0), 0) || 0;
    const remaining = limit.daily_limit_usd - totalSpent;

    log.debug({
      telegramId,
      limit: limit.daily_limit_usd,
      spent: totalSpent.toFixed(4),
      remaining: remaining.toFixed(4)
    }, 'Checked user limit');

    return {
      allowed: remaining > 0,
      remaining: Math.max(0, remaining),
      limit: limit.daily_limit_usd,
      spent: totalSpent
    };

  } catch (error) {
    log.error({ error: String(error), telegramId }, 'Unexpected error in checkUserLimit');
    // При неожиданной ошибке - разрешаем (fail open)
    return { allowed: true, remaining: 1.00, limit: 1.00, spent: 0 };
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
  if (!telegramId || !model || !usage) {
    log.warn({ telegramId, model, usage }, 'Missing parameters for trackUsage');
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const cost = calculateCost(model, usage);
  const normalizedModel = normalizeModelName(model);

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

    if (error) {
      log.error({
        error,
        telegramId,
        model: normalizedModel,
        cost: cost.toFixed(6)
      }, 'Error tracking usage');
    } else {
      log.info({
        telegramId,
        model: normalizedModel,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        cost_usd: cost.toFixed(6)
      }, 'Tracked AI usage');
    }
  } catch (error) {
    log.error({ error: String(error), telegramId, model }, 'Unexpected error in trackUsage');
  }
}

/**
 * Форматирует сообщение об превышении лимита
 *
 * @param {object} limitCheck - Результат checkUserLimit()
 * @returns {string} Сообщение для пользователя
 */
export function formatLimitExceededMessage(limitCheck) {
  return `⚠️ Превышен дневной лимит затрат

Ваш лимит: $${limitCheck.limit.toFixed(2)}
Потрачено сегодня: $${limitCheck.spent.toFixed(2)}

Попробуйте завтра или обратитесь в поддержку для увеличения лимита.`;
}
