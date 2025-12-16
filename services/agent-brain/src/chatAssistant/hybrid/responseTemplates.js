/**
 * Response Templates for Hybrid MCP Executor
 *
 * Pre-defined text templates for playbook responses.
 * Used by ResponseAssembler to generate consistent, informative messages.
 */

/**
 * Templates for lead_expensive playbook
 */
export const LEAD_EXPENSIVE_TEMPLATES = {
  // Summary templates based on CPL status
  summary: {
    highCPL: 'CPL {cpl}₸ — на {delta_pct}% выше целевого ({target_cpl}₸)',
    improving: 'CPL снизился на {delta_pct}% vs прошлый период ({previous_cpl}₸ → {cpl}₸)',
    stable: 'CPL в норме: {cpl}₸ (цель: {target_cpl}₸)',
    noData: 'Недостаточно данных для анализа CPL за выбранный период'
  },

  // Insight templates based on metrics analysis
  insights: {
    cpm_high: '📈 CPM вырос на {delta}% — аудитория дорожает или выгорает',
    cpm_low: '📉 CPM снизился на {delta}% — хороший сигнал, охват дешевеет',
    ctr_low: '📉 CTR упал на {delta}% — креативы устарели или не попадают в ЦА',
    ctr_high: '📈 CTR вырос на {delta}% — креативы работают лучше',
    cvr_low: '📉 Конверсия упала — проблема в оффере, лендинге или качестве трафика',
    cvr_high: '📈 Конверсия выросла — воронка работает эффективнее',
    small_sample: '⚠️ Мало данных (<1000 показов) — выводы могут быть неточными',
    audience_fatigue: '🔄 Возможное выгорание аудитории: CPM растёт, CTR падает',
    creative_problem: '🎨 Проблема в креативах: CTR ниже среднего при нормальном CPM'
  },

  // Diagnostic messages
  diagnostics: {
    funnel_top: 'Проблема на верхе воронки: высокий CPM ({cpm}₸) при низком CTR ({ctr}%)',
    funnel_middle: 'Проблема в середине воронки: хороший CTR ({ctr}%), но низкая конверсия',
    funnel_bottom: 'Проблема на конверсии: лиды приходят, но не квалифицируются ({qual_rate}%)',
    all_metrics_bad: 'Все метрики хуже среднего — рекомендуется комплексная оптимизация',
    spike_detected: 'Обнаружен резкий скачок {metric} {date}: +{change}%'
  },

  // Action recommendations
  recommendations: {
    pause_worst: 'Рекомендуется остановить худшие креативы с CPL > {threshold}₸',
    test_new: 'Рекомендуется протестировать новые креативы',
    reduce_budget: 'Рекомендуется снизить бюджет на {pct}% до стабилизации',
    expand_audience: 'Рекомендуется расширить аудиторию для снижения CPM',
    refresh_creatives: 'Рекомендуется обновить креативы — текущие выгорают',
    check_landing: 'Рекомендуется проверить лендинг/оффер — конверсия падает'
  },

  // Next steps context
  nextStepsContext: {
    hasCRM: 'Можно проверить качество лидов в CRM',
    hasWhatsApp: 'Можно разобрать последние диалоги в WhatsApp',
    roiEnabled: 'Можно посмотреть ROI по креативам',
    brainEnabled: 'Brain Agent может автоматически оптимизировать'
  },

  // Period labels
  periodLabels: {
    'last_3d': 'за последние 3 дня',
    'last_7d': 'за последние 7 дней',
    'last_14d': 'за последние 14 дней',
    'last_30d': 'за последние 30 дней',
    'today': 'за сегодня',
    'yesterday': 'за вчера'
  }
};

/**
 * Templates for ads_not_working playbook
 */
export const ADS_NOT_WORKING_TEMPLATES = {
  summary: {
    noSpend: 'Кампании не тратят бюджет — возможные причины ниже',
    lowSpend: 'Расход {spend}₸ значительно ниже дневного бюджета ({budget}₸)',
    accountBlocked: 'Рекламный аккаунт заблокирован: {reason}',
    paymentIssue: 'Проблема с оплатой: требуется пополнение аккаунта'
  },

  issues: {
    campaign_paused: '⏸️ Кампания на паузе',
    adset_paused: '⏸️ Адсет на паузе',
    budget_depleted: '💰 Бюджет исчерпан',
    learning_limited: '📚 Режим обучения ограничен — мало конверсий',
    audience_too_small: '👥 Аудитория слишком узкая',
    bid_too_low: '📉 Ставка ниже конкурентов',
    creative_rejected: '🚫 Креатив отклонён модерацией'
  },

  actions: {
    resume: 'Возобновить {entity_type} {entity_name}',
    increase_budget: 'Увеличить бюджет до {amount}₸/день',
    expand_audience: 'Расширить таргетинг',
    review_creative: 'Проверить креатив на соответствие правилам'
  }
};

/**
 * Templates for no_sales playbook
 */
export const NO_SALES_TEMPLATES = {
  summary: {
    leadsNoSales: '{leads} лидов, {sales} продаж — конверсия {rate}%',
    qualityIssue: 'Качество лидов низкое: только {qual_rate}% квалифицированных',
    goodLeads: 'Лиды качественные ({qual_rate}% квал.), проблема в обработке'
  },

  insights: {
    slow_response: '⏱️ Среднее время ответа: {time} — слишком долго',
    no_followup: '📞 {count} лидов без follow-up',
    cold_leads: '❄️ {count} холодных лидов — нужен nurturing',
    objection_price: '💰 Частое возражение: цена слишком высокая',
    objection_timing: '⏰ Частое возражение: сейчас не время'
  }
};

/**
 * General utility templates
 */
export const GENERAL_TEMPLATES = {
  errors: {
    noPermission: 'Нет доступа к этим данным',
    serviceUnavailable: 'Сервис временно недоступен, попробуйте позже',
    invalidPeriod: 'Некорректный период: {period}',
    entityNotFound: '{entity_type} не найден: {entity_id}'
  },

  success: {
    actionCompleted: '✅ {action} выполнено успешно',
    dataLoaded: 'Данные загружены за {period}'
  },

  warnings: {
    smallSample: '⚠️ Малая выборка — статистика может быть неточной',
    outdatedData: '⚠️ Данные могут быть неактуальны (последнее обновление: {date})',
    partialData: '⚠️ Часть данных недоступна'
  }
};

/**
 * Format a template string with provided values
 * @param {string} template - Template string with {placeholders}
 * @param {Object} values - Key-value pairs for substitution
 * @returns {string} Formatted string
 */
export function formatTemplate(template, values = {}) {
  if (!template) return '';

  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return values[key] !== undefined ? String(values[key]) : match;
  });
}

/**
 * Get the appropriate template based on metrics analysis
 * @param {Object} metrics - Current metrics
 * @param {Object} comparison - Comparison with previous period
 * @returns {Object} Selected templates and formatted messages
 */
export function selectLeadExpensiveTemplates(metrics, comparison = null) {
  const templates = LEAD_EXPENSIVE_TEMPLATES;
  const messages = [];

  // Summary selection
  if (!metrics || !metrics.cpl) {
    messages.push({ type: 'summary', text: templates.summary.noData });
  } else if (metrics.target_cpl && metrics.cpl > metrics.target_cpl * 1.3) {
    const delta_pct = Math.round(((metrics.cpl - metrics.target_cpl) / metrics.target_cpl) * 100);
    messages.push({
      type: 'summary',
      text: formatTemplate(templates.summary.highCPL, {
        cpl: metrics.cpl.toFixed(2),
        target_cpl: metrics.target_cpl.toFixed(2),
        delta_pct
      })
    });
  } else if (comparison?.cpl_pct && comparison.cpl_pct < -10) {
    messages.push({
      type: 'summary',
      text: formatTemplate(templates.summary.improving, {
        delta_pct: Math.abs(comparison.cpl_pct).toFixed(1),
        previous_cpl: comparison.previous_cpl?.toFixed(2),
        cpl: metrics.cpl.toFixed(2)
      })
    });
  } else {
    messages.push({
      type: 'summary',
      text: formatTemplate(templates.summary.stable, {
        cpl: metrics.cpl.toFixed(2),
        target_cpl: metrics.target_cpl?.toFixed(2) || 'N/A'
      })
    });
  }

  // Insights based on comparison
  if (comparison) {
    if (comparison.cpm_pct > 20) {
      messages.push({
        type: 'insight',
        text: formatTemplate(templates.insights.cpm_high, { delta: comparison.cpm_pct.toFixed(1) })
      });
    }
    if (comparison.ctr_pct < -15) {
      messages.push({
        type: 'insight',
        text: formatTemplate(templates.insights.ctr_low, { delta: Math.abs(comparison.ctr_pct).toFixed(1) })
      });
    }

    // Check for audience fatigue pattern
    if (comparison.cpm_pct > 15 && comparison.ctr_pct < -10) {
      messages.push({
        type: 'insight',
        text: templates.insights.audience_fatigue
      });
    }
  }

  // Small sample warning
  if (metrics.impressions && metrics.impressions < 1000) {
    messages.push({
      type: 'warning',
      text: templates.insights.small_sample
    });
  }

  return messages;
}

export default {
  LEAD_EXPENSIVE_TEMPLATES,
  ADS_NOT_WORKING_TEMPLATES,
  NO_SALES_TEMPLATES,
  GENERAL_TEMPLATES,
  formatTemplate,
  selectLeadExpensiveTemplates
};
