/**
 * Playbook Registry - Tier-based playbooks для Hybrid MCP Executor
 *
 * Progressive disclosure:
 * - Tier 1 (snapshot): read-only tools, базовый обзор
 * - Tier 2 (drilldown): детализация, причины
 * - Tier 3 (actions): write-операции с approval
 *
 * Playbooks определяют:
 * - intents → какие intent-ы матчатся
 * - tiers → tools и политики для каждого tier
 * - clarifyingQuestions → условные вопросы
 * - nextSteps → кнопки для перехода
 * - enterConditions → условия для auto-escalation
 */

import { logger } from '../../lib/logger.js';
import { evaluateCondition } from './expressionEvaluator.js';

/**
 * Playbook definitions
 */
export const PLAYBOOKS = {
  // ============================================
  // 1. ADS NOT WORKING - "реклама не работает"
  // ============================================
  ads_not_working: {
    id: 'ads_not_working',
    name: 'Реклама не работает',
    intents: ['ads_not_working', 'no_results', 'zero_spend', 'diagnosis_leads'],
    domain: 'ads',
    tiers: {
      snapshot: {
        tools: ['getDirections', 'getSpendReport'],
        maxToolCalls: 4,
        dangerousPolicy: 'block'
      },
      drilldown: {
        tools: ['getCampaigns', 'getAdSets', 'getTopCreatives', 'getCreativeScores'],
        maxToolCalls: 5,
        dangerousPolicy: 'block',
        enterIf: ['user_chose_drilldown', 'isHighCPL']
      },
      actions: {
        tools: ['pauseCampaign', 'pauseAdSet', 'updateBudget', 'launchCreative'],
        maxToolCalls: 3,
        dangerousPolicy: 'require_approval'
      }
    },
    clarifyingQuestions: [
      {
        field: 'period',
        type: 'period',
        text: 'За какой период смотреть?',
        options: [
          { value: 'today', label: 'Сегодня' },
          { value: 'yesterday', label: 'Вчера' },
          { value: 'last_3d', label: '3 дня' },
          { value: 'last_7d', label: '7 дней' }
        ],
        default: 'last_3d',
        askIf: 'period_not_in_message'
      },
      {
        field: 'direction',
        type: 'entity',
        text: 'Какое направление проверить?',
        askIf: 'directions_count > 1'
      }
    ],
    nextSteps: [
      {
        id: 'drilldown_campaigns',
        label: 'Посмотреть кампании',
        targetTier: 'drilldown',
        icon: '📊',
        showIf: 'currentTier == snapshot'
      },
      {
        id: 'drilldown_creatives',
        label: 'Проверить креативы',
        targetTier: 'drilldown',
        icon: '🎨',
        showIf: 'currentTier == snapshot'
      },
      {
        id: 'pause_worst',
        label: 'Остановить худшие',
        targetTier: 'actions',
        icon: '⏸️',
        showIf: 'hasWorstCreatives'
      }
    ],
    enterConditions: {
      isSmallSample: { expression: 'impressions < 1000' },
      isHighCPL: { expression: 'cpl > targetCpl * 1.3' },
      isZeroSpend: { expression: 'spend == 0' }
    }
  },

  // ============================================
  // 2. LEAD EXPENSIVE - "лид дорогой"
  // ============================================
  lead_expensive: {
    id: 'lead_expensive',
    name: 'Дорогой лид',
    intents: ['cpl_analysis', 'lead_expensive', 'high_cpl'],
    domain: 'ads',
    tiers: {
      snapshot: {
        tools: ['getDirections', 'getSpendReport'],
        maxToolCalls: 3,
        dangerousPolicy: 'block'
      },
      drilldown: {
        tools: ['getCampaigns', 'getAdSets', 'getCreativeScores', 'getTopCreatives'],
        maxToolCalls: 5,
        dangerousPolicy: 'block',
        enterIf: ['user_chose_drilldown']
      },
      actions: {
        tools: ['pauseCampaign', 'pauseAdSet', 'updateBudget'],
        maxToolCalls: 3,
        dangerousPolicy: 'require_approval'
      }
    },
    clarifyingQuestions: [
      {
        field: 'period',
        type: 'period',
        text: 'За какой период анализировать CPL?',
        default: 'last_3d',
        askIf: 'period_not_in_message'
      },
      {
        field: 'direction',
        type: 'entity',
        text: 'Какое направление?',
        askIf: 'directions_count > 1'
      }
    ],
    nextSteps: [
      {
        id: 'drilldown_adsets',
        label: 'Разбить по адсетам',
        targetTier: 'drilldown',
        icon: '🔍'
      },
      {
        id: 'drilldown_creatives',
        label: 'Посмотреть креативы',
        targetTier: 'drilldown',
        icon: '🎨'
      },
      {
        id: 'pause_expensive',
        label: 'Остановить дорогие',
        targetTier: 'actions',
        icon: '⏸️'
      }
    ],
    enterConditions: {
      isHighCPL: { expression: 'cpl > targetCpl * 1.3' },
      isSmallSample: { expression: 'impressions < 1000' }
    }
  },

  // ============================================
  // 3. NO SALES - "нет продаж"
  // ============================================
  no_sales: {
    id: 'no_sales',
    name: 'Нет продаж',
    intents: ['no_sales', 'revenue_stats', 'funnel_stats'],
    domain: 'crm',
    tiers: {
      snapshot: {
        tools: ['getFunnelStats', 'getLeads', 'getSpendReport'],
        maxToolCalls: 4,
        dangerousPolicy: 'block'
      },
      drilldown: {
        tools: ['getLeadDetails', 'getDialogs', 'getDialogMessages'],
        maxToolCalls: 5,
        dangerousPolicy: 'block',
        enterIf: ['user_chose_drilldown']
      },
      actions: {
        tools: ['updateLeadStage'],
        maxToolCalls: 2,
        dangerousPolicy: 'allow'
      }
    },
    clarifyingQuestions: [
      {
        field: 'period',
        type: 'period',
        text: 'За какой период смотреть воронку?',
        default: 'last_7d',
        askIf: 'period_not_in_message'
      }
    ],
    nextSteps: [
      {
        id: 'drilldown_leads',
        label: 'Посмотреть лидов',
        targetTier: 'drilldown',
        icon: '👥'
      },
      {
        id: 'drilldown_dialogs',
        label: 'Проверить диалоги',
        targetTier: 'drilldown',
        icon: '💬',
        showIf: 'hasWhatsApp'
      }
    ],
    enterConditions: {
      hasLeadsNoSales: { expression: 'leads > 0 && purchases == 0' }
    }
  },

  // ============================================
  // 4. SPEND REPORT - "сколько потратили"
  // ============================================
  spend_report: {
    id: 'spend_report',
    name: 'Отчёт по расходам',
    intents: ['spend_report', 'budget_report'],
    domain: 'ads',
    tiers: {
      snapshot: {
        tools: ['getSpendReport', 'getDirections'],
        maxToolCalls: 2,
        dangerousPolicy: 'block'
      },
      drilldown: {
        tools: ['getCampaigns', 'getAdSets'],
        maxToolCalls: 4,
        dangerousPolicy: 'block',
        enterIf: ['user_chose_drilldown']
      }
    },
    clarifyingQuestions: [
      {
        field: 'period',
        type: 'period',
        text: 'За какой период?',
        options: [
          { value: 'today', label: 'Сегодня' },
          { value: 'yesterday', label: 'Вчера' },
          { value: 'last_3d', label: '3 дня' },
          { value: 'last_7d', label: '7 дней' },
          { value: 'last_30d', label: '30 дней' }
        ],
        default: 'last_7d',
        askIf: 'period_not_in_message'
      }
    ],
    nextSteps: [
      {
        id: 'drilldown_by_campaign',
        label: 'Разбить по кампаниям',
        targetTier: 'drilldown',
        icon: '📊'
      }
    ],
    enterConditions: {}
  },

  // ============================================
  // 5. DIRECTIONS OVERVIEW - "какие направления"
  // ============================================
  directions_overview: {
    id: 'directions_overview',
    name: 'Обзор направлений',
    intents: ['directions_overview', 'directions_list'],
    domain: 'ads',
    tiers: {
      snapshot: {
        tools: ['getDirections'],
        maxToolCalls: 2,
        dangerousPolicy: 'block'
      },
      drilldown: {
        tools: ['getDirectionDetails', 'getDirectionMetrics', 'getCampaigns'],
        maxToolCalls: 4,
        dangerousPolicy: 'block',
        enterIf: ['user_chose_drilldown']
      },
      actions: {
        tools: ['pauseDirection', 'updateDirectionBudget'],
        maxToolCalls: 2,
        dangerousPolicy: 'require_approval'
      }
    },
    clarifyingQuestions: [],
    nextSteps: [
      {
        id: 'drilldown_direction',
        label: 'Детали направления',
        targetTier: 'drilldown',
        icon: '🔍'
      },
      {
        id: 'pause_direction',
        label: 'Остановить направление',
        targetTier: 'actions',
        icon: '⏸️'
      }
    ],
    enterConditions: {}
  },

  // ============================================
  // 6. CREATIVE TOP - "лучшие креативы"
  // ============================================
  creative_top: {
    id: 'creative_top',
    name: 'Топ креативы',
    intents: ['creative_top', 'best_creatives'],
    domain: 'creative',
    tiers: {
      snapshot: {
        tools: ['getTopCreatives', 'getCreativeScores'],
        maxToolCalls: 2,
        dangerousPolicy: 'block'
      },
      drilldown: {
        tools: ['getCreativeDetails', 'getCreativeMetrics', 'compareCreatives'],
        maxToolCalls: 4,
        dangerousPolicy: 'block',
        enterIf: ['user_chose_drilldown']
      },
      actions: {
        tools: ['launchCreative', 'duplicateCreative'],
        maxToolCalls: 2,
        dangerousPolicy: 'require_approval'
      }
    },
    clarifyingQuestions: [
      {
        field: 'metric',
        type: 'choice',
        text: 'По какой метрике?',
        options: [
          { value: 'cpl', label: 'CPL' },
          { value: 'ctr', label: 'CTR' },
          { value: 'leads', label: 'Лиды' },
          { value: 'roi', label: 'ROI' }
        ],
        default: 'cpl',
        askIf: 'metric_not_in_message'
      },
      {
        field: 'period',
        type: 'period',
        default: 'last_7d',
        askIf: 'period_not_in_message'
      }
    ],
    nextSteps: [
      {
        id: 'drilldown_creative',
        label: 'Детали креатива',
        targetTier: 'drilldown',
        icon: '🔍'
      },
      {
        id: 'launch_in_direction',
        label: 'Запустить в направление',
        targetTier: 'actions',
        icon: '🚀'
      }
    ],
    enterConditions: {}
  },

  // ============================================
  // 7. CREATIVE WORST - "худшие креативы"
  // ============================================
  creative_worst: {
    id: 'creative_worst',
    name: 'Худшие креативы',
    intents: ['creative_worst', 'bad_creatives'],
    domain: 'creative',
    tiers: {
      snapshot: {
        tools: ['getWorstCreatives', 'getCreativeScores'],
        maxToolCalls: 2,
        dangerousPolicy: 'block'
      },
      drilldown: {
        tools: ['getCreativeDetails', 'getCreativeMetrics'],
        maxToolCalls: 3,
        dangerousPolicy: 'block',
        enterIf: ['user_chose_drilldown']
      },
      actions: {
        tools: ['pauseCreative'],
        maxToolCalls: 2,
        dangerousPolicy: 'require_approval'
      }
    },
    clarifyingQuestions: [
      {
        field: 'period',
        type: 'period',
        default: 'last_7d',
        askIf: 'period_not_in_message'
      }
    ],
    nextSteps: [
      {
        id: 'pause_worst',
        label: 'Остановить худшие',
        targetTier: 'actions',
        icon: '⏸️'
      }
    ],
    enterConditions: {
      hasWorstCreatives: { expression: 'worstCreativesCount > 0' }
    }
  },

  // ============================================
  // 8. BRAIN HISTORY - "что делал brain"
  // ============================================
  brain_history: {
    id: 'brain_history',
    name: 'История Brain Agent',
    intents: ['brain_history', 'brain_actions', 'autopilot_history'],
    domain: 'ads',
    tiers: {
      snapshot: {
        tools: ['getAgentBrainActions'],
        maxToolCalls: 1,
        dangerousPolicy: 'block'
      },
      drilldown: {
        tools: ['getCampaigns', 'getAdSets', 'getCreativeScores'],
        maxToolCalls: 4,
        dangerousPolicy: 'block',
        enterIf: ['user_chose_drilldown']
      },
      actions: {
        tools: ['triggerBrainOptimizationRun'],
        maxToolCalls: 1,
        dangerousPolicy: 'require_approval'
      }
    },
    clarifyingQuestions: [
      {
        field: 'period',
        type: 'period',
        text: 'За какой период?',
        default: 'last_3d',
        askIf: 'period_not_in_message'
      }
    ],
    nextSteps: [
      {
        id: 'drilldown_action',
        label: 'Детали действия',
        targetTier: 'drilldown',
        icon: '🔍'
      },
      {
        id: 'trigger_brain',
        label: 'Запустить оптимизацию',
        targetTier: 'actions',
        icon: '🤖'
      }
    ],
    enterConditions: {}
  },

  // ============================================
  // 9. LEADS LIST - "покажи лидов"
  // ============================================
  leads_list: {
    id: 'leads_list',
    name: 'Список лидов',
    intents: ['leads_list', 'show_leads'],
    domain: 'crm',
    tiers: {
      snapshot: {
        tools: ['getLeads'],
        maxToolCalls: 2,
        dangerousPolicy: 'block'
      },
      drilldown: {
        tools: ['getLeadDetails', 'getDialogs', 'getDialogMessages'],
        maxToolCalls: 4,
        dangerousPolicy: 'block',
        enterIf: ['user_chose_drilldown']
      },
      actions: {
        tools: ['updateLeadStage'],
        maxToolCalls: 2,
        dangerousPolicy: 'allow'
      }
    },
    clarifyingQuestions: [
      {
        field: 'period',
        type: 'period',
        text: 'За какой период?',
        default: 'last_7d',
        askIf: 'period_not_in_message'
      },
      {
        field: 'stage',
        type: 'choice',
        text: 'Какой этап воронки?',
        options: [
          { value: 'all', label: 'Все' },
          { value: 'new', label: 'Новые' },
          { value: 'in_progress', label: 'В работе' },
          { value: 'qualified', label: 'Квалифицированные' }
        ],
        default: 'all',
        askIf: 'stage_not_in_message'
      }
    ],
    nextSteps: [
      {
        id: 'drilldown_lead',
        label: 'Детали лида',
        targetTier: 'drilldown',
        icon: '👤'
      },
      {
        id: 'see_dialog',
        label: 'Посмотреть диалог',
        targetTier: 'drilldown',
        icon: '💬',
        showIf: 'hasWhatsApp'
      }
    ],
    enterConditions: {}
  },

  // ============================================
  // 10. BUDGET CHANGE - "измени бюджет"
  // ============================================
  budget_change: {
    id: 'budget_change',
    name: 'Изменение бюджета',
    intents: ['budget_change', 'update_budget'],
    domain: 'ads',
    tiers: {
      snapshot: {
        tools: ['getDirections', 'getCampaigns'],
        maxToolCalls: 2,
        dangerousPolicy: 'block'
      },
      actions: {
        tools: ['updateBudget', 'updateDirectionBudget'],
        maxToolCalls: 2,
        dangerousPolicy: 'require_approval'
      }
    },
    clarifyingQuestions: [
      {
        field: 'entity',
        type: 'entity',
        text: 'Какую кампанию/направление изменить?',
        alwaysAsk: true
      },
      {
        field: 'amount',
        type: 'amount',
        text: 'На сколько изменить? (+20%, -50% или конкретная сумма)',
        alwaysAsk: true
      }
    ],
    nextSteps: [
      {
        id: 'confirm_change',
        label: 'Подтвердить изменение',
        targetTier: 'actions',
        icon: '✅'
      }
    ],
    enterConditions: {}
  }
};

/**
 * PlaybookRegistry class
 */
export class PlaybookRegistry {
  constructor() {
    this.playbooks = PLAYBOOKS;
    this.intentToPlaybook = this._buildIntentIndex();
  }

  /**
   * Построить индекс intent → playbook
   * @private
   */
  _buildIntentIndex() {
    const index = {};
    for (const [id, playbook] of Object.entries(this.playbooks)) {
      for (const intent of playbook.intents) {
        index[intent] = id;
      }
    }
    return index;
  }

  /**
   * Получить playbook по ID
   * @param {string} id
   * @returns {Object|null}
   */
  getPlaybook(id) {
    return this.playbooks[id] || null;
  }

  /**
   * Получить playbook по intent
   * @param {string} intent
   * @returns {Object|null}
   */
  getPlaybookByIntent(intent) {
    const id = this.intentToPlaybook[intent];
    return id ? this.playbooks[id] : null;
  }

  /**
   * Получить tools для tier
   * @param {string} playbookId
   * @param {string} tierName - 'snapshot' | 'drilldown' | 'actions'
   * @returns {string[]}
   */
  getToolsForTier(playbookId, tierName) {
    const playbook = this.getPlaybook(playbookId);
    if (!playbook || !playbook.tiers[tierName]) {
      return [];
    }
    return playbook.tiers[tierName].tools || [];
  }

  /**
   * Получить policy для tier
   * @param {string} playbookId
   * @param {string} tierName
   * @returns {Object}
   */
  getTierPolicy(playbookId, tierName) {
    const playbook = this.getPlaybook(playbookId);
    if (!playbook || !playbook.tiers[tierName]) {
      return {
        allowedTools: [],
        maxToolCalls: 0,
        dangerousPolicy: 'block'
      };
    }

    const tier = playbook.tiers[tierName];
    return {
      playbookId,
      intent: playbookId,
      tier: tierName,
      domain: playbook.domain,
      allowedTools: tier.tools || [],
      maxToolCalls: tier.maxToolCalls || 5,
      dangerousPolicy: tier.dangerousPolicy || 'block',
      enterIf: tier.enterIf || []
    };
  }

  /**
   * Получить clarifying questions для playbook
   * @param {string} playbookId
   * @param {Object} context - Контекст для проверки условий
   * @returns {Array}
   */
  getClarifyingQuestions(playbookId, context = {}) {
    const playbook = this.getPlaybook(playbookId);
    if (!playbook || !playbook.clarifyingQuestions) {
      return [];
    }

    // Фильтруем по условиям askIf/alwaysAsk
    return playbook.clarifyingQuestions.filter(q => {
      if (q.alwaysAsk) return true;
      if (!q.askIf) return true;
      return this._evaluateAskIf(q.askIf, context);
    });
  }

  /**
   * Получить next steps для playbook
   * @param {string} playbookId
   * @param {Object} snapshotData - Данные snapshot tier
   * @returns {Array}
   */
  getNextSteps(playbookId, snapshotData = {}) {
    const playbook = this.getPlaybook(playbookId);
    if (!playbook || !playbook.nextSteps) {
      return [];
    }

    // Фильтруем по условиям showIf
    return playbook.nextSteps.filter(step => {
      if (!step.showIf) return true;
      return evaluateCondition(step.showIf, snapshotData);
    });
  }

  /**
   * Проверить enter conditions
   * @param {string} playbookId
   * @param {Object} data - Бизнес-данные
   * @returns {Object} - { conditionName: boolean }
   */
  evaluateEnterConditions(playbookId, data) {
    const playbook = this.getPlaybook(playbookId);
    if (!playbook || !playbook.enterConditions) {
      return {};
    }

    const results = {};
    for (const [name, config] of Object.entries(playbook.enterConditions)) {
      results[name] = evaluateCondition(config.expression, data);
    }

    logger.debug({ playbookId, data, results }, 'Enter conditions evaluated');

    return results;
  }

  /**
   * Получить все playbooks для domain
   * @param {string} domain - 'ads' | 'creative' | 'crm' | 'whatsapp'
   * @returns {Object[]}
   */
  getPlaybooksForDomain(domain) {
    return Object.values(this.playbooks).filter(p => p.domain === domain);
  }

  /**
   * Проверить условие askIf
   * @private
   */
  _evaluateAskIf(askIf, context) {
    // Специальные условия
    if (askIf === 'period_not_in_message') {
      return !context.extractedPeriod;
    }
    if (askIf === 'metric_not_in_message') {
      return !context.extractedMetric;
    }
    if (askIf === 'stage_not_in_message') {
      return !context.extractedStage;
    }
    if (askIf === 'directions_count > 1') {
      return (context.directionsCount || 0) > 1;
    }

    // Общая проверка через evaluateCondition
    return evaluateCondition(askIf, context);
  }

  /**
   * Получить все ID playbooks
   * @returns {string[]}
   */
  getAllPlaybookIds() {
    return Object.keys(this.playbooks);
  }
}

// Singleton instance
export const playbookRegistry = new PlaybookRegistry();

export default playbookRegistry;
