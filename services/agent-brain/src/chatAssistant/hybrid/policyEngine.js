/**
 * Policy Engine - Playbook → allowedTools
 *
 * Определяет policy на основе intent запроса.
 * Policy включает:
 * - allowedTools - механически разрешённые tools
 * - clarifyingQuestions - вопросы перед выполнением
 * - dangerousPolicy - политика для dangerous tools
 * - maxToolCalls - лимит вызовов
 */

import { logger } from '../../lib/logger.js';
import { playbookRegistry, getPlaybookWithStackExtensions } from './playbookRegistry.js';

/**
 * Policy definitions - маппинг intent → policy
 * Intent detection is now handled by LLM in orchestrator/index.js
 */
const POLICY_DEFINITIONS = {
  // === ADS WRITE ===
  budget_change: {
    domain: 'ads',
    allowedTools: ['getDirections', 'getDirectionDetails', 'updateBudget', 'updateDirectionBudget'],
    dangerousPolicy: 'block',
    maxToolCalls: 3,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'entity', text: 'Какое направление или кампанию изменить?', type: 'entity' },
      { field: 'amount', text: 'На сколько изменить бюджет? (+20%, -50%, или конкретная сумма)', type: 'amount' }
    ]
  },
  pause_entity: {
    domain: 'ads',
    allowedTools: ['getDirections', 'getCampaigns', 'pauseDirection', 'pauseCampaign', 'pauseAdSet'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'entity', text: 'Что именно поставить на паузу? (укажи название или ref)', type: 'entity' }
    ]
  },
  resume_entity: {
    domain: 'ads',
    allowedTools: ['getDirections', 'getCampaigns', 'resumeCampaign', 'resumeAdSet'],
    dangerousPolicy: 'allow',  // Resume менее опасно
    maxToolCalls: 2,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'entity', text: 'Что возобновить?', type: 'entity' }
    ]
  },

  // === ADS READ ===
  spend_report: {
    domain: 'ads',
    allowedTools: ['getSpendReport', 'getDirections', 'getCampaigns'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'period', text: 'За какой период? (сегодня/вчера/7 дней/30 дней)', type: 'period', default: 'last_7d' }
    ]
  },
  directions_overview: {
    domain: 'ads',
    allowedTools: ['getDirections', 'getDirectionDetails', 'getDirectionMetrics'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: false
  },
  campaigns_overview: {
    domain: 'ads',
    allowedTools: ['getCampaigns', 'getCampaignDetails', 'getAdSets'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: false
  },
  roi_analysis: {
    domain: 'ads',
    allowedTools: ['getROIReport', 'getROIComparison', 'getDirections'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'period', text: 'За какой период считать ROI?', type: 'period', default: 'last_7d' }
    ],
    preflightCheck: (ctx) => ctx.integrations?.roi === true,
    preflightError: 'ROI недоступен — нет данных о покупках. Подключите CRM с purchases.'
  },
  brain_history: {
    domain: 'ads',
    allowedTools: [],  // Данные в context.brainActions
    dangerousPolicy: 'block',
    maxToolCalls: 0,
    clarifyingRequired: false,
    useContextOnly: true,
    contextSource: 'brainActions'
  },
  cpl_analysis: {
    domain: 'ads',
    allowedTools: ['getSpendReport', 'getDirections', 'getCampaigns'],
    dangerousPolicy: 'block',
    maxToolCalls: 3,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'period', text: 'За какой период анализировать CPL?', type: 'period', default: 'last_7d' }
    ]
  },
  diagnosis_leads: {
    domain: 'ads',
    allowedTools: ['getSpendReport', 'getDirections', 'getCampaigns'],
    optionalTools: ['getDialogs', 'getFunnelStats'],  // Если есть интеграции
    dangerousPolicy: 'block',
    maxToolCalls: 3,
    clarifyingRequired: false
  },

  // === CREATIVE WRITE ===
  launch_creative: {
    domain: 'creative',
    allowedTools: ['getCreatives', 'getDirections', 'launchCreative'],
    dangerousPolicy: 'block',
    maxToolCalls: 3,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'creative', text: 'Какой креатив запустить?', type: 'entity' },
      { field: 'direction', text: 'В какое направление?', type: 'entity' }
    ]
  },
  pause_creative: {
    domain: 'creative',
    allowedTools: ['getCreatives', 'pauseCreative'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'creative', text: 'Какой креатив остановить?', type: 'entity' }
    ]
  },
  start_test: {
    domain: 'creative',
    allowedTools: ['getCreatives', 'getDirections', 'startCreativeTest'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'creatives', text: 'Какие креативы тестировать? (2-5 штук)', type: 'entity' }
    ]
  },

  // === CREATIVE READ ===
  creative_list: {
    domain: 'creative',
    allowedTools: ['getCreatives', 'getCreativeDetails'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: false
  },
  creative_top: {
    domain: 'creative',
    allowedTools: ['getTopCreatives', 'getCreativeMetrics', 'getCreativeScores'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'metric', text: 'По какой метрике? (CPL/CTR/leads/ROI)', type: 'metric', default: 'cpl' }
    ]
  },
  creative_worst: {
    domain: 'creative',
    allowedTools: ['getWorstCreatives', 'getCreativeMetrics', 'getCreativeScores'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: false
  },
  creative_burnout: {
    domain: 'creative',
    allowedTools: [],  // Данные в scoring_output.ready_creatives
    dangerousPolicy: 'block',
    maxToolCalls: 0,
    clarifyingRequired: false,
    useContextOnly: true,
    contextSource: 'scoringDetails'
  },
  creative_compare: {
    domain: 'creative',
    allowedTools: ['compareCreatives', 'getCreativeDetails', 'getCreativeMetrics'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'creatives', text: 'Какие креативы сравнить? (укажи 2-5)', type: 'entity' }
    ]
  },
  creative_analysis: {
    domain: 'creative',
    allowedTools: ['getCreativeAnalysis', 'getCreativeMetrics', 'triggerCreativeAnalysis'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'creative', text: 'Какой креатив проанализировать?', type: 'entity' }
    ]
  },

  // === CRM ===
  leads_list: {
    domain: 'crm',
    allowedTools: ['getLeads', 'getLeadDetails'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'period', text: 'За какой период показать лидов?', type: 'period', default: 'last_7d' }
    ],
    preflightCheck: (ctx) => ctx.integrations?.crm === true,
    preflightError: 'CRM не подключен — данные о лидах недоступны.'
  },
  funnel_stats: {
    domain: 'crm',
    allowedTools: ['getFunnelStats', 'getLeads'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: false,
    preflightCheck: (ctx) => ctx.integrations?.crm === true,
    preflightError: 'CRM не подключен — воронка недоступна.'
  },
  revenue_stats: {
    domain: 'crm',
    allowedTools: ['getRevenueStats', 'getFunnelStats'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'period', text: 'За какой период показать выручку?', type: 'period', default: 'last_30d' }
    ],
    preflightCheck: (ctx) => ctx.integrations?.roi === true,
    preflightError: 'Нет данных о покупках — выручка недоступна.'
  },
  update_lead_stage: {
    domain: 'crm',
    allowedTools: ['getLeads', 'getLeadDetails', 'updateLeadStage'],
    dangerousPolicy: 'allow',  // Менее опасно чем ads
    maxToolCalls: 2,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'lead', text: 'Какой лид перевести?', type: 'entity' },
      { field: 'stage', text: 'На какой этап?', type: 'stage' }
    ],
    preflightCheck: (ctx) => ctx.integrations?.crm === true,
    preflightError: 'CRM не подключен.'
  },

  // === WHATSAPP ===
  dialogs_list: {
    domain: 'whatsapp',
    allowedTools: ['getDialogs', 'getDialogMessages'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: false,
    preflightCheck: (ctx) => ctx.integrations?.whatsapp === true,
    preflightError: 'WhatsApp не подключен.'
  },
  dialog_analysis: {
    domain: 'whatsapp',
    allowedTools: ['getDialogs', 'getDialogMessages', 'analyzeDialog'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'phone', text: 'Какой диалог проанализировать? (номер телефона или ref)', type: 'phone' }
    ],
    preflightCheck: (ctx) => ctx.integrations?.whatsapp === true,
    preflightError: 'WhatsApp не подключен.'
  },
  dialog_search: {
    domain: 'whatsapp',
    allowedTools: ['searchDialogSummaries', 'getDialogs'],
    dangerousPolicy: 'block',
    maxToolCalls: 2,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'query', text: 'Что искать в диалогах?', type: 'text' }
    ],
    preflightCheck: (ctx) => ctx.integrations?.whatsapp === true,
    preflightError: 'WhatsApp не подключен.'
  },

  // === GENERAL ===
  general_question: {
    domain: 'general',
    allowedTools: [],  // Отвечаем без tools
    dangerousPolicy: 'block',
    maxToolCalls: 0,
    clarifyingRequired: false,
    useContextOnly: true
  },

  // === GREETING/NEUTRAL ===
  greeting_neutral: {
    domain: 'general',
    allowedTools: [],  // Не используем tools, preflight делает orchestrator
    dangerousPolicy: 'block',
    maxToolCalls: 0,
    clarifyingRequired: false,  // Не спрашивать уточнения
    specialHandler: 'greeting_preflight'  // Флаг для orchestrator
  },

  // === FALLBACK ===
  unknown: {
    domain: 'unknown',
    allowedTools: [],  // Безопасный fallback
    dangerousPolicy: 'block',
    maxToolCalls: 0,
    clarifyingRequired: true,
    clarifyingQuestions: [
      { field: 'intent', text: 'Уточните, что именно вы хотите сделать?', type: 'text' }
    ]
  }
};

/**
 * PolicyEngine class
 * Intent detection is now handled by LLM in orchestrator/index.js
 * This class handles policy resolution based on detected intent
 */
export class PolicyEngine {
  /**
   * Получить policy для intent
   * @param {Object} params
   * @param {string} params.intent - Intent запроса
   * @param {string[]} params.domains - Домены от classifier
   * @param {Object} params.context - Бизнес-контекст
   * @param {Object} params.integrations - Доступные интеграции
   * @param {string} params.stack - Стек интеграций клиента (fb_only, fb_wa, fb_crm, fb_wa_crm, no_fb)
   * @returns {Policy}
   */
  resolvePolicy({ intent, domains, context, integrations, stack }) {
    const basePolicyDef = POLICY_DEFINITIONS[intent] || POLICY_DEFINITIONS.unknown;

    // Копируем policy
    const policy = {
      playbookId: intent,
      intent,
      domain: basePolicyDef.domain,
      allowedTools: [...basePolicyDef.allowedTools],
      dangerousPolicy: basePolicyDef.dangerousPolicy,
      maxToolCalls: basePolicyDef.maxToolCalls,
      clarifyingRequired: basePolicyDef.clarifyingRequired,
      clarifyingQuestions: basePolicyDef.clarifyingQuestions ? [...basePolicyDef.clarifyingQuestions] : [],
      useContextOnly: basePolicyDef.useContextOnly || false,
      contextSource: basePolicyDef.contextSource || null,
      stack: stack || 'fb_only'  // Добавляем stack в policy
    };

    // Preflight check
    if (basePolicyDef.preflightCheck) {
      const passed = basePolicyDef.preflightCheck({ integrations, context });
      if (!passed) {
        policy.preflightFailed = true;
        policy.preflightError = basePolicyDef.preflightError;
        policy.allowedTools = [];  // Блокируем tools
        policy.clarifyingRequired = false;  // Не уточняем, сразу отвечаем ошибкой
      }
    }

    // Добавляем optional tools если есть интеграции
    if (basePolicyDef.optionalTools && integrations) {
      for (const tool of basePolicyDef.optionalTools) {
        if (tool.startsWith('get') && tool.includes('Dialog') && integrations.whatsapp) {
          policy.allowedTools.push(tool);
        }
        if (tool.startsWith('get') && tool.includes('Funnel') && integrations.crm) {
          policy.allowedTools.push(tool);
        }
      }
    }

    logger.debug({
      intent,
      domains,
      allowedTools: policy.allowedTools,
      clarifyingRequired: policy.clarifyingRequired
    }, 'Policy resolved');

    return policy;
  }

  /**
   * Проверить, разрешён ли tool в policy
   * @param {string} toolName
   * @param {Policy} policy
   * @returns {boolean}
   */
  isToolAllowed(toolName, policy) {
    if (!policy.allowedTools || policy.allowedTools.length === 0) {
      return true;  // Если нет ограничений
    }
    return policy.allowedTools.includes(toolName);
  }

  /**
   * Получить все определения policy (для отладки)
   */
  getAllPolicies() {
    return POLICY_DEFINITIONS;
  }

  // ============================================================
  // PLAYBOOK REGISTRY INTEGRATION
  // ============================================================

  /**
   * Получить policy для конкретного tier playbook'а
   * @param {Object} params
   * @param {string} params.playbookId - ID playbook'а
   * @param {string} params.tier - Название tier'а ('snapshot', 'drilldown', 'actions')
   * @param {Object} params.context - Бизнес-контекст
   * @param {Object} params.integrations - Доступные интеграции
   * @param {string} params.stack - Стек интеграций клиента
   * @returns {Policy}
   */
  resolveTierPolicy({ playbookId, tier = 'snapshot', context = {}, integrations = {}, stack = 'fb_only' }) {
    const tierPolicy = playbookRegistry.getTierPolicy(playbookId, tier);

    if (!tierPolicy || tierPolicy.allowedTools.length === 0) {
      // Fallback на legacy policy
      const playbook = playbookRegistry.getPlaybook(playbookId);
      if (playbook) {
        const legacyPolicy = this.resolvePolicy({
          intent: playbookId,
          domains: [playbook.domain],
          context,
          integrations,
          stack
        });
        return {
          ...legacyPolicy,
          tier: 'snapshot',
          fromPlaybook: false,
          stack
        };
      }

      return {
        playbookId,
        tier,
        intent: 'unknown',
        domain: 'unknown',
        allowedTools: [],
        dangerousPolicy: 'block',
        maxToolCalls: 0,
        fromPlaybook: false,
        stack
      };
    }

    // Получаем playbook с учётом stack extensions
    const playbook = getPlaybookWithStackExtensions(playbookId, stack);
    const clarifyingQuestions = playbook?.clarifyingQuestions || [];

    const policy = {
      ...tierPolicy,
      clarifyingRequired: clarifyingQuestions.length > 0 && tier === 'snapshot',
      clarifyingQuestions,
      fromPlaybook: true,
      stack,
      // Добавляем stack-extended данные в policy
      nextSteps: playbook?.nextSteps || [],
      drilldownBranches: playbook?.drilldownBranches || [],
      stackExtended: playbook?._stackExtended || null
    };

    // Preflight checks для интеграций
    if (policy.domain === 'crm' && !integrations.crm) {
      policy.preflightFailed = true;
      policy.preflightError = 'CRM не подключен — данные недоступны.';
      policy.allowedTools = [];
    }

    if (policy.domain === 'whatsapp' && !integrations.whatsapp) {
      policy.preflightFailed = true;
      policy.preflightError = 'WhatsApp не подключен.';
      policy.allowedTools = [];
    }

    logger.debug({
      playbookId,
      tier,
      allowedTools: policy.allowedTools,
      dangerousPolicy: policy.dangerousPolicy
    }, 'Tier policy resolved');

    return policy;
  }

  /**
   * Найти playbook по intent
   * @param {string} intent
   * @returns {Object|null}
   */
  getPlaybookForIntent(intent) {
    return playbookRegistry.getPlaybookByIntent(intent);
  }

  /**
   * Проверить, есть ли playbook для intent
   * @param {string} intent
   * @returns {boolean}
   */
  hasPlaybook(intent) {
    return playbookRegistry.getPlaybookByIntent(intent) !== null;
  }

  /**
   * Получить все playbooks для domain
   * @param {string} domain
   * @returns {Object[]}
   */
  getPlaybooksForDomain(domain) {
    return playbookRegistry.getPlaybooksForDomain(domain);
  }
}

// Singleton instance
export const policyEngine = new PolicyEngine();

export default policyEngine;
