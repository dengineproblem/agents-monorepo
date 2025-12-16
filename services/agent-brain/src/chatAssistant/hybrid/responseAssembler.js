/**
 * Response Assembler - Сборка финального ответа
 *
 * Форматирует ответ с секциями, entity refs и UI компонентами.
 * Добавляет next steps на основе Interactive Router.
 */

import { logger } from '../../lib/logger.js';

/**
 * Типы секций ответа
 */
export const SECTION_TYPES = {
  SUMMARY: 'summary',      // Краткий итог
  DATA: 'data',            // Данные/таблицы
  INSIGHTS: 'insights',    // Инсайты и рекомендации
  NEXT_STEPS: 'next_steps' // Следующие шаги
};

/**
 * Entity ref patterns для разных типов
 */
const ENTITY_PREFIXES = {
  campaign: 'c',
  direction: 'd',
  creative: 'cr',
  lead: 'l',
  adset: 'as'
};

/**
 * Interactive Router - правила для next steps
 */
export const NEXT_STEP_RULES = {
  spend_report: [
    { condition: 'highSpend', text: 'Показать топ расходов по кампаниям', action: 'getTopSpendCampaigns' },
    { condition: 'default', text: 'Сравнить с прошлым периодом', action: 'compareSpend' }
  ],
  roi_analysis: [
    { condition: 'lowROI', text: 'Показать проблемные направления', action: 'getLowROIDirections' },
    { condition: 'default', text: 'Детализация по кампаниям', action: 'getROIByCampaigns' }
  ],
  creative_top: [
    { condition: 'default', text: 'Запустить топ креатив на новую аудиторию', action: 'launchCreative' },
    { condition: 'hasLowPerformers', text: 'Остановить худшие креативы', action: 'pauseLowCreatives' }
  ],
  budget_change: [
    { condition: 'success', text: 'Проверить результат через час', action: 'scheduleCheck' },
    { condition: 'default', text: 'Посмотреть текущие бюджеты', action: 'getBudgets' }
  ],
  campaign_pause: [
    { condition: 'success', text: 'Посмотреть активные кампании', action: 'getActiveCampaigns' }
  ],
  lead_search: [
    { condition: 'hasResults', text: 'Показать детали лида', action: 'getLeadDetails' },
    { condition: 'default', text: 'Найти похожих лидов', action: 'findSimilarLeads' }
  ]
};

/**
 * Response Assembler Class
 */
export class ResponseAssembler {
  constructor() {
    this.entityCounter = new Map();
  }

  /**
   * Собрать финальный ответ
   * @param {Object} response - Raw response от агента
   * @param {Object} options - Опции сборки
   * @param {Object} options.policy - Policy от PolicyEngine
   * @param {Object} options.classification - Результат классификации
   * @param {Object} options.toolResults - Результаты tool calls
   * @returns {Object} Assembled response
   */
  assemble(response, { policy, classification, toolResults = [] }) {
    // Reset entity counter for each response
    this.entityCounter.clear();

    const sections = [];
    let uiJson = null;

    // 1. Parse content into sections if it's structured
    if (response.content) {
      const parsed = this.parseContent(response.content);
      sections.push(...parsed.sections);
      uiJson = parsed.uiJson || uiJson;
    }

    // 2. Add entity refs to content
    const contentWithRefs = this.addEntityRefs(response.content, toolResults);

    // 3. Generate next steps based on intent and results
    const nextSteps = this.generateNextSteps(policy, toolResults, response);

    // 4. Build UI JSON if needed
    if (!uiJson && toolResults.length > 0) {
      uiJson = this.buildUiJson(toolResults, policy);
    }

    // 5. Format final response
    const assembled = {
      content: contentWithRefs,
      sections,
      nextSteps,
      uiJson,
      metadata: {
        intent: policy?.intent,
        playbookId: policy?.playbookId,
        toolsUsed: response.executedActions?.map(a => a.tool) || [],
        entityRefs: Object.fromEntries(this.entityCounter)
      }
    };

    logger.debug({
      intent: policy?.intent,
      sectionsCount: sections.length,
      nextStepsCount: nextSteps.length,
      hasUiJson: !!uiJson
    }, 'Response assembled');

    return assembled;
  }

  /**
   * Parse content into sections
   */
  parseContent(content) {
    const sections = [];
    let uiJson = null;

    // Try to extract structured sections using patterns
    const summaryMatch = content.match(/(?:итог|summary|результат)[:\s]*(.+?)(?:\n\n|$)/is);
    if (summaryMatch) {
      sections.push({
        type: SECTION_TYPES.SUMMARY,
        content: summaryMatch[1].trim()
      });
    }

    // Extract data section (tables, lists)
    const dataMatch = content.match(/(?:данные|data|статистика)[:\s]*(.+?)(?:\n\n|$)/is);
    if (dataMatch) {
      sections.push({
        type: SECTION_TYPES.DATA,
        content: dataMatch[1].trim()
      });
    }

    // Extract insights
    const insightsMatch = content.match(/(?:инсайт|рекомендаци|анализ)[:\s]*(.+?)(?:\n\n|$)/is);
    if (insightsMatch) {
      sections.push({
        type: SECTION_TYPES.INSIGHTS,
        content: insightsMatch[1].trim()
      });
    }

    // Try to extract UI JSON
    const uiJsonMatch = content.match(/```ui_json\s*([\s\S]*?)```/);
    if (uiJsonMatch) {
      try {
        uiJson = JSON.parse(uiJsonMatch[1]);
      } catch (e) {
        logger.warn({ error: e.message }, 'Failed to parse ui_json');
      }
    }

    return { sections, uiJson };
  }

  /**
   * Add entity refs to content ([c1], [d1], etc.)
   */
  addEntityRefs(content, toolResults) {
    if (!content) return content;

    let result = content;

    // Process tool results to find entities
    for (const toolResult of toolResults) {
      if (!toolResult.result) continue;

      const data = typeof toolResult.result === 'string'
        ? JSON.parse(toolResult.result)
        : toolResult.result;

      // Find campaigns
      if (data.campaigns || data.campaign) {
        const campaigns = data.campaigns || [data.campaign];
        for (const camp of campaigns) {
          if (camp.id && camp.name) {
            const ref = this.getEntityRef('campaign', camp.id);
            // Replace campaign name with ref
            result = result.replace(
              new RegExp(`"${camp.name}"`, 'g'),
              `"${camp.name}" [${ref}]`
            );
          }
        }
      }

      // Find directions
      if (data.directions || data.direction) {
        const directions = data.directions || [data.direction];
        for (const dir of directions) {
          if (dir.id && dir.name) {
            const ref = this.getEntityRef('direction', dir.id);
            result = result.replace(
              new RegExp(`"${dir.name}"`, 'g'),
              `"${dir.name}" [${ref}]`
            );
          }
        }
      }

      // Find creatives
      if (data.creatives || data.creative) {
        const creatives = data.creatives || [data.creative];
        for (const cr of creatives) {
          if (cr.id && cr.name) {
            const ref = this.getEntityRef('creative', cr.id);
            result = result.replace(
              new RegExp(`"${cr.name}"`, 'g'),
              `"${cr.name}" [${ref}]`
            );
          }
        }
      }
    }

    return result;
  }

  /**
   * Get or create entity ref
   */
  getEntityRef(type, id) {
    const prefix = ENTITY_PREFIXES[type] || type[0];
    const key = `${type}:${id}`;

    if (!this.entityCounter.has(key)) {
      const count = [...this.entityCounter.keys()]
        .filter(k => k.startsWith(type))
        .length + 1;
      this.entityCounter.set(key, `${prefix}${count}`);
    }

    return this.entityCounter.get(key);
  }

  /**
   * Generate next steps based on intent and results
   */
  generateNextSteps(policy, toolResults, response) {
    if (!policy?.intent) return [];

    const rules = NEXT_STEP_RULES[policy.intent] || [];
    const steps = [];

    // Evaluate conditions
    const context = this.buildStepContext(toolResults, response);

    for (const rule of rules) {
      if (this.evaluateCondition(rule.condition, context)) {
        steps.push({
          text: rule.text,
          action: rule.action,
          suggested: rule.condition === 'default'
        });
      }

      // Limit to 3 steps
      if (steps.length >= 3) break;
    }

    // Always add at least one default step
    if (steps.length === 0) {
      const defaultRule = rules.find(r => r.condition === 'default');
      if (defaultRule) {
        steps.push({
          text: defaultRule.text,
          action: defaultRule.action,
          suggested: true
        });
      }
    }

    return steps;
  }

  /**
   * Build context for step condition evaluation
   */
  buildStepContext(toolResults, response) {
    const context = {
      success: !response.error,
      hasResults: toolResults.length > 0,
      highSpend: false,
      lowROI: false,
      hasLowPerformers: false
    };

    // Analyze tool results
    for (const result of toolResults) {
      if (!result.result) continue;

      const data = typeof result.result === 'string'
        ? JSON.parse(result.result)
        : result.result;

      // Check for high spend
      if (data.totalSpend && data.totalSpend > 100000) {
        context.highSpend = true;
      }

      // Check for low ROI
      if (data.roi !== undefined && data.roi < 1) {
        context.lowROI = true;
      }

      // Check for low performers
      if (data.lowPerformers && data.lowPerformers.length > 0) {
        context.hasLowPerformers = true;
      }
    }

    return context;
  }

  /**
   * Evaluate condition against context
   */
  evaluateCondition(condition, context) {
    if (condition === 'default') return true;
    return context[condition] === true;
  }

  /**
   * Build UI JSON for frontend components
   */
  buildUiJson(toolResults, policy) {
    const components = [];

    for (const result of toolResults) {
      if (!result.result) continue;

      const data = typeof result.result === 'string'
        ? JSON.parse(result.result)
        : result.result;

      // Table for spend reports
      if (result.tool === 'getSpendReport' && data.rows) {
        components.push({
          type: 'table',
          title: 'Расходы',
          columns: ['Название', 'Расход', 'Лиды', 'CPL'],
          rows: data.rows.slice(0, 10).map(r => [
            r.name,
            `${r.spend}₽`,
            r.leads || 0,
            r.cpl ? `${r.cpl}₽` : '-'
          ])
        });
      }

      // Chart for ROI
      if (result.tool === 'getROIReport' && data.chart) {
        components.push({
          type: 'chart',
          chartType: 'bar',
          title: 'ROI по направлениям',
          data: data.chart
        });
      }

      // Cards for top creatives
      if (result.tool === 'getTopCreatives' && data.creatives) {
        components.push({
          type: 'cards',
          title: 'Топ креативы',
          items: data.creatives.slice(0, 5).map(c => ({
            title: c.name,
            metric: c.cpl ? `CPL: ${c.cpl}₽` : `CTR: ${c.ctr}%`,
            thumbnail: c.thumbnail
          }))
        });
      }
    }

    return components.length > 0 ? { components } : null;
  }

  /**
   * Format response for Telegram (with markdown)
   */
  formatForTelegram(assembled) {
    let text = assembled.content;

    // Add next steps as buttons hint
    if (assembled.nextSteps.length > 0) {
      text += '\n\n---\n';
      text += '**Что дальше?**\n';
      for (const step of assembled.nextSteps) {
        text += `• ${step.text}\n`;
      }
    }

    return {
      text,
      ui_json: assembled.uiJson,
      metadata: assembled.metadata
    };
  }

  // ============================================================
  // TIER-BASED UI COMPONENTS
  // ============================================================

  /**
   * Format next steps menu from playbook for tier transitions
   * @param {Array} nextSteps - Next steps from playbook
   * @param {Object} tierState - Current tier state
   * @returns {Object} UI component for next steps menu
   */
  formatNextStepsMenu(nextSteps, tierState = null) {
    if (!nextSteps || nextSteps.length === 0) return null;

    return {
      type: 'actions',
      title: 'Что сделать дальше?',
      items: nextSteps.map(step => ({
        id: step.id,
        label: step.label,
        icon: step.icon || '➡️',
        payload: {
          nextStepId: step.id,
          targetTier: step.targetTier,
          playbookId: tierState?.playbookId
        },
        style: step.targetTier === 'actions' ? 'danger' : 'default'
      })),
      layout: nextSteps.length <= 2 ? 'horizontal' : 'vertical'
    };
  }

  /**
   * Format choice component for clarifying questions (CHOICE type)
   * @param {Object} question - Question definition from playbook
   * @param {string} conversationId - Conversation ID for payload
   * @returns {Object} UI component for choice selection
   */
  formatChoiceComponent(question, conversationId) {
    if (!question || !question.options) return null;

    return {
      type: 'choice',
      fieldId: question.field,
      title: question.question || `Выберите ${question.field}`,
      options: question.options.map(opt => ({
        label: opt.label,
        value: opt.value,
        selected: opt.value === question.default
      })),
      default: question.default,
      required: question.required !== false,
      payload: {
        conversationId,
        fieldId: question.field
      }
    };
  }

  /**
   * Format approval request for Tier-3 actions
   * @param {Object} action - Action requiring approval
   * @param {Object} context - Business context
   * @returns {Object} UI component for approval
   */
  formatApprovalRequest(action, context = {}) {
    return {
      type: 'approval',
      title: 'Требуется подтверждение',
      action: {
        tool: action.tool,
        args: action.args,
        label: action.label || `Выполнить ${action.tool}`
      },
      warning: action.warning || this.generateWarning(action.tool, action.args, context),
      buttons: [
        {
          label: 'Подтвердить',
          style: 'danger',
          payload: { approve: true, toolCallId: action.toolCallId }
        },
        {
          label: 'Отмена',
          style: 'secondary',
          payload: { approve: false, toolCallId: action.toolCallId }
        }
      ]
    };
  }

  /**
   * Generate warning message for dangerous actions
   */
  generateWarning(toolName, args, context) {
    const warnings = {
      pauseCampaign: `Кампания будет остановлена. Текущий расход: ${context.spend || 'неизвестен'}`,
      updateBudget: `Бюджет будет изменён с ${args.currentBudget || '?'} на ${args.newBudget || '?'}`,
      bulkPause: `Будет остановлено ${args.count || 'несколько'} объектов`,
      deleteCampaign: 'Кампания будет удалена безвозвратно!'
    };

    return warnings[toolName] || 'Это действие может повлиять на ваши рекламные кампании';
  }

  /**
   * Format tier transition indicator
   * @param {Object} tierState - Current tier state
   * @returns {Object} UI component showing tier progress
   */
  formatTierIndicator(tierState) {
    if (!tierState) return null;

    const tiers = ['snapshot', 'drilldown', 'actions'];
    const tierLabels = {
      snapshot: 'Обзор',
      drilldown: 'Детали',
      actions: 'Действия'
    };

    return {
      type: 'progress',
      current: tierState.currentTier,
      items: tiers.map((tier, idx) => ({
        id: tier,
        label: tierLabels[tier],
        status: tierState.completedTiers?.includes(tier)
          ? 'completed'
          : tierState.currentTier === tier
            ? 'current'
            : 'pending',
        order: idx + 1
      }))
    };
  }

  /**
   * Assemble tier-aware response with UI components
   * @param {Object} response - Agent response
   * @param {Object} options - Options including tierState and nextStepsMenu
   * @returns {Object} Assembled response with tier components
   */
  assembleTierResponse(response, { policy, classification, toolResults = [], tierState = null, nextStepsFromPlaybook = [] }) {
    // First, do standard assembly
    const assembled = this.assemble(response, { policy, classification, toolResults });

    // Add tier-specific components
    const tierComponents = [];

    // Add tier indicator
    if (tierState) {
      const indicator = this.formatTierIndicator(tierState);
      if (indicator) {
        tierComponents.push(indicator);
      }
    }

    // Add next steps menu from playbook (replaces generic next steps)
    if (nextStepsFromPlaybook && nextStepsFromPlaybook.length > 0) {
      const menu = this.formatNextStepsMenu(nextStepsFromPlaybook, tierState);
      if (menu) {
        tierComponents.push(menu);
        // Clear generic next steps since we're using playbook-based ones
        assembled.nextSteps = [];
      }
    }

    // Merge tier components into uiJson
    if (tierComponents.length > 0) {
      assembled.uiJson = assembled.uiJson || { components: [] };
      assembled.uiJson.components = [
        ...(assembled.uiJson.components || []),
        ...tierComponents
      ];
    }

    // Add tier state to metadata
    if (tierState) {
      assembled.metadata.tierState = {
        currentTier: tierState.currentTier,
        playbookId: tierState.playbookId,
        completedTiers: tierState.completedTiers
      };
    }

    return assembled;
  }
}

// Singleton instance
export const responseAssembler = new ResponseAssembler();

export default {
  ResponseAssembler,
  responseAssembler,
  SECTION_TYPES,
  NEXT_STEP_RULES,
  // Tier-based formatters (for external use)
  formatNextStepsMenu: (steps, state) => responseAssembler.formatNextStepsMenu(steps, state),
  formatChoiceComponent: (q, cid) => responseAssembler.formatChoiceComponent(q, cid),
  formatApprovalRequest: (a, ctx) => responseAssembler.formatApprovalRequest(a, ctx),
  formatTierIndicator: (state) => responseAssembler.formatTierIndicator(state)
};
