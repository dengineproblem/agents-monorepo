/**
 * Preflight Service - Pre-check и smart suggestions для greeting
 *
 * Кэш с TTL 10 минут для preflight данных.
 * Используется Orchestrator для обработки нейтральных сообщений (привет/салам).
 */

import { supabase } from '../../lib/supabaseClient.js';
import { logger } from '../../lib/logger.js';
import { adsHandlers } from '../agents/ads/handlers.js';
import { createActionsComponent, createAlertComponent, assembleUiJson } from './uiComponents.js';

// In-memory кэш для preflight
const preflightCache = new Map();
const PREFLIGHT_TTL = 10 * 60 * 1000; // 10 минут

/**
 * Получить или создать preflight данные
 * @param {Object} params
 * @param {string} params.userAccountId
 * @param {string} params.adAccountId - FB account ID
 * @param {string} params.adAccountDbId - UUID из ad_accounts
 * @param {string} params.accessToken
 * @param {Object} params.integrations - уже загруженные интеграции
 * @returns {Promise<Object>}
 */
export async function runPreflight({ userAccountId, adAccountId, adAccountDbId, accessToken, integrations }) {
  const cacheKey = `${userAccountId}:${adAccountDbId || 'default'}`;

  // Проверяем кэш
  const cached = preflightCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < PREFLIGHT_TTL) {
    logger.debug({ cacheKey, age: Date.now() - cached.timestamp }, 'Preflight cache hit');
    return cached.data;
  }

  logger.info({ userAccountId, adAccountDbId }, 'Running preflight checks');

  const result = {
    integrations,
    adAccountStatus: null,
    lastActivity: null,
    timestamp: Date.now()
  };

  // Параллельные проверки
  const checks = [];

  // 1. Ad Account Status (если FB подключён)
  if (integrations.fb && accessToken && adAccountId) {
    checks.push(
      adsHandlers.getAdAccountStatus({}, { accessToken, adAccountId })
        .then(status => { result.adAccountStatus = status; })
        .catch(err => {
          logger.warn({ error: err.message }, 'Ad account status check failed');
          result.adAccountStatus = {
            success: false,
            status: 'ERROR',
            can_run_ads: false,
            blocking_reasons: [{ code: 'CHECK_FAILED', message: err.message }]
          };
        })
    );
  }

  // 2. Last activity check (14 дней)
  if (adAccountDbId) {
    checks.push(
      getLastActivityDate(userAccountId, adAccountDbId)
        .then(lastActivity => { result.lastActivity = lastActivity; })
        .catch(err => {
          logger.warn({ error: err.message }, 'Last activity check failed');
        })
    );
  }

  await Promise.all(checks);

  // Кэшируем результат
  preflightCache.set(cacheKey, {
    data: result,
    timestamp: Date.now()
  });

  return result;
}

/**
 * Получить дату последней активности (spend или leads)
 * @param {string} userAccountId
 * @param {string} adAccountDbId
 * @returns {Promise<Object>} { lastDate, daysSince, hasRecentActivity }
 */
async function getLastActivityDate(userAccountId, adAccountDbId) {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('direction_metrics_rollup')
    .select('day, spend, leads')
    .eq('user_account_id', userAccountId)
    .eq('account_id', adAccountDbId)
    .gte('day', fourteenDaysAgo)
    .or('spend.gt.0,leads.gt.0')
    .order('day', { ascending: false })
    .limit(1);

  if (error || !data?.length) {
    return {
      lastDate: null,
      daysSince: null,
      hasRecentActivity: false
    };
  }

  const lastDate = new Date(data[0].day);
  const daysSince = Math.floor((Date.now() - lastDate.getTime()) / (24 * 60 * 60 * 1000));

  return {
    lastDate: data[0].day,
    daysSince,
    hasRecentActivity: daysSince < 14,
    lastSpend: parseFloat(data[0].spend) || 0,
    lastLeads: parseInt(data[0].leads) || 0
  };
}

/**
 * Сгенерировать smart suggestions на основе preflight
 * @param {Object} preflight - результат runPreflight
 * @returns {Object} { text, suggestions, alert }
 */
export function generateSmartGreetingSuggestions(preflight) {
  const { integrations, adAccountStatus, lastActivity } = preflight;

  // Кейс 1: Facebook не подключён
  if (!integrations.fb) {
    return {
      text: 'Привет! Facebook не подключён — большинство функций недоступны.',
      suggestions: [
        { id: 'connect_fb', label: 'Подключить Facebook', icon: '🔗', payload: { action: 'connect_fb' } },
        { id: 'what_connected', label: 'Что подключено?', icon: '🔌', payload: { action: 'show_integrations' } },
        { id: 'what_can_do', label: 'Что умеет ассистент?', icon: '❓', payload: { action: 'show_capabilities' } }
      ],
      alert: {
        type: 'warning',
        title: 'Facebook не подключён',
        message: 'Подключите рекламный аккаунт для доступа к аналитике и управлению кампаниями.'
      }
    };
  }

  // Кейс 2: FB подключён, но реклама не крутится
  if (adAccountStatus && !adAccountStatus.can_run_ads) {
    const reason = adAccountStatus.blocking_reasons?.[0];
    const reasonText = reason?.message || 'Неизвестная причина';
    const statusText = getStatusDescription(adAccountStatus.status);

    return {
      text: `Привет! Вижу проблему с рекламным аккаунтом: ${statusText}`,
      suggestions: [
        { id: 'show_reason', label: 'Подробнее о причине', icon: '🔍', payload: { action: 'show_blocking_reason', reason } },
        { id: 'check_billing', label: 'Проверить платежи', icon: '💳', payload: { action: 'check_billing' } },
        { id: 'last_active_campaigns', label: 'Последние кампании', icon: '📊', payload: { action: 'show_last_campaigns' } }
      ],
      alert: {
        type: 'error',
        title: 'Реклама не крутится',
        message: reasonText
      }
    };
  }

  // Кейс 3: FB ок, но нет активности 14+ дней
  if (lastActivity && !lastActivity.hasRecentActivity) {
    const daysText = lastActivity.daysSince
      ? `${lastActivity.daysSince} дней`
      : 'давно';

    return {
      text: `Привет! Аккаунт в порядке, но рекламы не было уже ${daysText}.`,
      suggestions: [
        { id: 'why_no_ads', label: 'Почему не крутится?', icon: '🤔', payload: { action: 'diagnose_no_activity' } },
        { id: 'show_campaigns', label: 'Показать кампании', icon: '📋', payload: { action: 'show_campaigns' } },
        { id: 'run_diagnosis', label: 'Диагностика', icon: '🔬', payload: { action: 'run_diagnosis' } }
      ],
      alert: {
        type: 'warning',
        title: 'Нет активности',
        message: `Последний расход был ${daysText} назад.`
      }
    };
  }

  // Кейс 4: Всё хорошо, есть активность
  // Подбираем suggestions в зависимости от integrations
  const suggestions = [];

  // Базовые suggestions для ads
  suggestions.push({
    id: 'spend_report',
    label: 'Расходы за неделю',
    icon: '📊',
    payload: { action: 'spend_report', period: 'last_7d' }
  });

  if (integrations.roi) {
    suggestions.push({
      id: 'roi_report',
      label: 'Отчёт по ROI',
      icon: '💰',
      payload: { action: 'roi_report' }
    });
  }

  if (integrations.crm) {
    suggestions.push({
      id: 'leads_today',
      label: 'Лиды сегодня',
      icon: '👥',
      payload: { action: 'leads_list', period: 'today' }
    });
  } else {
    suggestions.push({
      id: 'cpl_analysis',
      label: 'Анализ CPL',
      icon: '📈',
      payload: { action: 'cpl_analysis' }
    });
  }

  if (integrations.whatsapp && suggestions.length < 3) {
    suggestions.push({
      id: 'recent_dialogs',
      label: 'Последние диалоги',
      icon: '💬',
      payload: { action: 'dialogs_list' }
    });
  }

  // Ограничиваем до 3
  const finalSuggestions = suggestions.slice(0, 3);

  return {
    text: 'Привет! Данные по рекламе доступны. Что посмотрим?',
    suggestions: finalSuggestions,
    alert: null
  };
}

/**
 * Получить описание статуса аккаунта
 * @param {string} status
 * @returns {string}
 */
function getStatusDescription(status) {
  const descriptions = {
    'DISABLED': 'аккаунт отключён',
    'PAYMENT_REQUIRED': 'нужна оплата',
    'REVIEW': 'аккаунт на проверке',
    'ERROR': 'ошибка проверки'
  };
  return descriptions[status] || status;
}

/**
 * Форматировать greeting response с UI компонентами
 * @param {Object} smartSuggestions - результат generateSmartGreetingSuggestions
 * @returns {Object} { content, uiJson }
 */
export function formatGreetingResponse(smartSuggestions) {
  const { text, suggestions, alert } = smartSuggestions;

  const components = [];

  // Alert если есть
  if (alert) {
    components.push(createAlertComponent(alert));
  }

  // Actions (quick replies)
  if (suggestions?.length > 0) {
    components.push(createActionsComponent({
      title: 'Быстрые действия',
      items: suggestions,
      layout: 'horizontal'
    }));
  }

  return {
    content: text,
    uiJson: components.length > 0 ? assembleUiJson(components) : null
  };
}

/**
 * Инвалидировать кэш для аккаунта
 * @param {string} userAccountId
 * @param {string} [adAccountDbId]
 */
export function invalidatePreflightCache(userAccountId, adAccountDbId = null) {
  const cacheKey = `${userAccountId}:${adAccountDbId || 'default'}`;
  preflightCache.delete(cacheKey);
  logger.debug({ cacheKey }, 'Preflight cache invalidated');
}

/**
 * Очистить весь кэш (для тестов)
 */
export function clearPreflightCache() {
  preflightCache.clear();
}

export default {
  runPreflight,
  generateSmartGreetingSuggestions,
  formatGreetingResponse,
  invalidatePreflightCache,
  clearPreflightCache
};
