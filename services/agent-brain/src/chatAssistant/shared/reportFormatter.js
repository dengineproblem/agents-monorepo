/**
 * Report Formatter - Человекочитаемые отчёты Brain Mini
 *
 * Преобразует технические данные в понятный формат для пользователя.
 * Убирает ID, переводит термины на русский.
 */

/**
 * Словарь переводов технических терминов
 */
const TRANSLATIONS = {
  // Источники данных
  hist7d_source: {
    label: 'История за 7 дней',
    values: {
      'brain_report': 'из отчёта Brain',
      'fb_api_calculated': 'из Facebook API',
      'none': 'нет данных'
    }
  },
  target_cpl_source: {
    label: 'Источник целевого CPL',
    values: {
      'direction': 'из направления',
      'account_default': 'по умолчанию аккаунта',
      'none': 'не задан'
    }
  },
  metrics_source: {
    label: 'Источник метрик',
    values: {
      'today': 'за сегодня',
      'last_7d': 'за последние 7 дней'
    }
  },

  // Статусы и классы
  hs_class: {
    label: 'Оценка',
    values: {
      'excellent': 'Отлично',
      'good': 'Хорошо',
      'acceptable': 'Приемлемо',
      'warning': 'Внимание',
      'critical': 'Критично',
      'neutral': 'Недостаточно данных'
    }
  },
  status: {
    label: 'Статус',
    values: {
      'ACTIVE': 'Активен',
      'PAUSED': 'На паузе',
      'DELETED': 'Удалён',
      'ARCHIVED': 'В архиве'
    }
  },

  // Действия
  action: {
    label: 'Действие',
    values: {
      'updateBudget': 'Изменить бюджет',
      'pauseAdSet': 'Поставить на паузу',
      'pauseAd': 'Остановить объявление',
      'enableAdSet': 'Включить группу',
      'enableAd': 'Включить объявление',
      'createAdSet': 'Создать группу',
      'launchNewCreatives': 'Запустить креативы',
      'review': 'Требует внимания'
    }
  },

  // Приоритеты
  priority: {
    label: 'Приоритет',
    values: {
      'critical': 'Критичный',
      'high': 'Высокий',
      'medium': 'Средний',
      'low': 'Низкий'
    }
  },

  // Причины низкого объёма
  low_volume_reason: {
    label: 'Причина',
    values: {
      'low_impressions': 'Мало показов',
      'low_spend': 'Мало расхода',
      'no_leads': 'Нет лидов',
      'new_adset': 'Новая группа'
    }
  }
};

/**
 * Перевести значение по ключу
 */
function translate(key, value) {
  const dict = TRANSLATIONS[key];
  if (!dict) return value;
  return dict.values?.[value] || value;
}

/**
 * Получить человекочитаемую метку
 */
function getLabel(key) {
  return TRANSLATIONS[key]?.label || key;
}

/**
 * Форматировать денежную сумму
 */
function formatMoney(cents, currency = 'USD') {
  if (cents === null || cents === undefined) return '—';
  const dollars = cents / 100;
  return `$${dollars.toFixed(2)}`;
}

/**
 * Форматировать процент
 */
function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value}%`;
}

/**
 * Форматировать summary для пользователя
 */
export function formatSummary(summary) {
  if (!summary) return null;

  const lines = [];

  // Основные метрики за сегодня
  if (summary.today_total_spend !== undefined) {
    lines.push(`Расход сегодня: $${summary.today_total_spend?.toFixed(2) || '0.00'}`);
  }
  if (summary.today_total_leads !== undefined) {
    lines.push(`Лидов сегодня: ${summary.today_total_leads || 0}`);
  }

  // Статистика анализа
  if (summary.total_adsets_analyzed !== undefined) {
    lines.push(`Проанализировано групп: ${summary.total_adsets_analyzed}`);
  }

  // Распределение по оценкам
  if (summary.by_hs_class) {
    const classes = [];
    if (summary.by_hs_class.excellent) classes.push(`${summary.by_hs_class.excellent} отличных`);
    if (summary.by_hs_class.good) classes.push(`${summary.by_hs_class.good} хороших`);
    if (summary.by_hs_class.warning) classes.push(`${summary.by_hs_class.warning} требуют внимания`);
    if (summary.by_hs_class.critical) classes.push(`${summary.by_hs_class.critical} критичных`);
    if (summary.by_hs_class.neutral) classes.push(`${summary.by_hs_class.neutral} без данных`);

    if (classes.length > 0) {
      lines.push(`Оценка групп: ${classes.join(', ')}`);
    }
  }

  // Типы кампаний
  if (summary.by_campaign_type) {
    const types = [];
    if (summary.by_campaign_type.internal) types.push(`${summary.by_campaign_type.internal} внутренних`);
    if (summary.by_campaign_type.external) types.push(`${summary.by_campaign_type.external} внешних`);
    if (types.length > 0) {
      lines.push(`Кампании: ${types.join(', ')}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Форматировать данные анализа адсета для пользователя
 */
export function formatAdsetAnalysis(adset) {
  if (!adset) return null;

  const result = {
    // Показываем только название, без ID
    name: adset.name || adset.entity_name || 'Без названия',

    // Оценка
    healthScore: adset.health_score,
    rating: translate('hs_class', adset.hs_class),

    // Метрики
    metrics: {}
  };

  // Форматируем метрики
  if (adset.today_spend !== undefined) {
    result.metrics['Расход'] = formatMoney(adset.today_spend * 100);
  }
  if (adset.today_leads !== undefined) {
    result.metrics['Лиды'] = adset.today_leads;
  }
  if (adset.today_cpl !== undefined) {
    result.metrics['CPL'] = formatMoney(adset.today_cpl * 100);
  }
  if (adset.target_cpl !== undefined) {
    result.metrics['Цель CPL'] = formatMoney(adset.target_cpl * 100);
  }

  // Источники данных (переведённые)
  if (adset.hist7d_source) {
    result.historySource = translate('hist7d_source', adset.hist7d_source);
  }
  if (adset.target_cpl_source) {
    result.targetSource = translate('target_cpl_source', adset.target_cpl_source);
  }

  return result;
}

/**
 * Форматировать контекст анализа для пользователя
 */
export function formatContext(context) {
  if (!context) return null;

  const lines = [];

  // Направление
  if (context.direction_name) {
    lines.push(`Направление: ${context.direction_name}`);
  }

  // Целевой CPL
  if (context.target_cpl) {
    lines.push(`Целевой CPL: $${context.target_cpl}`);
  }

  // Наличие истории
  if (context.brain_report_available !== undefined) {
    lines.push(`Предыдущие отчёты: ${context.brain_report_available ? 'есть' : 'нет'}`);
  }

  // Период данных
  if (context.data_period) {
    lines.push(`Период данных: ${context.data_period}`);
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Форматировать предложение (proposal) для пользователя
 */
export function formatProposal(proposal) {
  if (!proposal) return null;

  return {
    // Название сущности (без ID)
    entityName: proposal.entity_name || 'Без названия',
    entityType: proposal.entity_type === 'adset' ? 'Группа' :
                proposal.entity_type === 'ad' ? 'Объявление' :
                proposal.entity_type === 'campaign' ? 'Кампания' : proposal.entity_type,

    // Действие
    action: translate('action', proposal.action),

    // Причина
    reason: proposal.reason,

    // Приоритет
    priority: translate('priority', proposal.priority),

    // Health Score
    healthScore: proposal.health_score,
    rating: translate('hs_class', proposal.hs_class),

    // Детали бюджета (если есть)
    budgetDetails: proposal.suggested_action_params?.current_budget_cents ? {
      current: formatMoney(proposal.suggested_action_params.current_budget_cents),
      new: formatMoney(proposal.suggested_action_params.new_budget_cents),
      change: formatPercent(proposal.suggested_action_params.increase_percent || -proposal.suggested_action_params.decrease_percent)
    } : null
  };
}

/**
 * Форматировать полный отчёт Brain Mini
 */
export function formatBrainMiniReport({ proposals, summary, context, adset_analysis }) {
  const report = {
    // Краткое резюме
    summary: formatSummary(summary),

    // Контекст анализа
    context: formatContext(context),

    // Предложения (без технических ID)
    proposals: proposals?.map(formatProposal) || [],

    // Анализ адсетов (без технических деталей)
    adsets: adset_analysis?.map(formatAdsetAnalysis) || []
  };

  return report;
}

/**
 * Генерировать текстовый отчёт для отображения
 */
export function generateTextReport({ proposals, summary, context, message }) {
  const lines = [];

  // Заголовок
  lines.push('=== Отчёт Brain Mini ===\n');

  // Сообщение
  if (message) {
    lines.push(message);
    lines.push('');
  }

  // Контекст
  if (context) {
    const contextText = formatContext(context);
    if (contextText) {
      lines.push('--- Контекст ---');
      lines.push(contextText);
      lines.push('');
    }
  }

  // Резюме
  if (summary) {
    const summaryText = formatSummary(summary);
    if (summaryText) {
      lines.push('--- Статистика ---');
      lines.push(summaryText);
      lines.push('');
    }
  }

  // Предложения
  if (proposals?.length > 0) {
    lines.push('--- Предложения ---');
    proposals.forEach((p, i) => {
      const formatted = formatProposal(p);
      lines.push(`${i + 1}. ${formatted.entityName}`);
      lines.push(`   ${formatted.action} — ${formatted.reason}`);
      if (formatted.budgetDetails) {
        lines.push(`   Бюджет: ${formatted.budgetDetails.current} → ${formatted.budgetDetails.new} (${formatted.budgetDetails.change})`);
      }
      lines.push(`   Приоритет: ${formatted.priority}, Оценка: ${formatted.rating}`);
    });
  } else {
    lines.push('Оптимизация не требуется — все показатели в норме.');
  }

  return lines.join('\n');
}

export default {
  formatSummary,
  formatAdsetAnalysis,
  formatContext,
  formatProposal,
  formatBrainMiniReport,
  generateTextReport,
  translate,
  getLabel,
  formatMoney,
  formatPercent
};
