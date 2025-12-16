/**
 * UI Components for Web
 *
 * Generates ui_json structures for frontend rendering.
 * Used by ResponseAssembler for tier-based UI.
 *
 * Component types:
 * - actions: Button menu for next steps
 * - choice: Radio/select for clarifying questions
 * - approval: Confirmation dialog for dangerous actions
 * - progress: Tier progress indicator
 * - table: Data table
 * - cards: Card grid for entities
 */

/**
 * Create an actions component (next steps menu)
 * @param {Object} options
 * @param {string} options.title - Menu title
 * @param {Array} options.items - Array of { id, label, icon?, payload, style? }
 * @param {string} [options.layout] - 'horizontal' | 'vertical'
 * @returns {Object} Actions component
 */
export function createActionsComponent({ title, items, layout = 'auto' }) {
  if (!items || items.length === 0) return null;

  return {
    type: 'actions',
    title: title || 'Действия',
    items: items.map(item => ({
      id: item.id,
      label: item.label,
      icon: item.icon || '➡️',
      payload: item.payload || { actionId: item.id },
      style: item.style || 'default',
      disabled: item.disabled || false
    })),
    layout: layout === 'auto'
      ? (items.length <= 2 ? 'horizontal' : 'vertical')
      : layout
  };
}

/**
 * Create a choice component (clarifying question)
 * @param {Object} options
 * @param {string} options.fieldId - Field identifier
 * @param {string} options.title - Question text
 * @param {Array} options.options - Array of { value, label }
 * @param {string} [options.default] - Default value
 * @param {boolean} [options.required] - Is required
 * @param {string} [options.conversationId] - For payload
 * @returns {Object} Choice component
 */
export function createChoiceComponent({ fieldId, title, options, default: defaultValue, required = true, conversationId }) {
  if (!options || options.length === 0) return null;

  return {
    type: 'choice',
    fieldId,
    title,
    options: options.map(opt => ({
      value: opt.value,
      label: opt.label,
      selected: opt.value === defaultValue
    })),
    default: defaultValue,
    required,
    payload: {
      conversationId,
      fieldId
    }
  };
}

/**
 * Create an approval component (dangerous action confirmation)
 * @param {Object} options
 * @param {string} options.tool - Tool name
 * @param {Object} options.args - Tool arguments
 * @param {string} [options.label] - Action label
 * @param {string} [options.warning] - Warning message
 * @param {string} [options.toolCallId] - For tracking
 * @returns {Object} Approval component
 */
export function createApprovalComponent({ tool, args, label, warning, toolCallId }) {
  return {
    type: 'approval',
    title: 'Требуется подтверждение',
    action: {
      tool,
      args,
      label: label || `Выполнить ${tool}`
    },
    warning: warning || getDefaultWarning(tool, args),
    buttons: [
      {
        id: 'approve',
        label: 'Подтвердить',
        style: 'danger',
        payload: { approve: true, toolCallId }
      },
      {
        id: 'cancel',
        label: 'Отмена',
        style: 'secondary',
        payload: { approve: false, toolCallId }
      }
    ]
  };
}

/**
 * Get default warning message for dangerous tools
 */
function getDefaultWarning(tool, args = {}) {
  const warnings = {
    pauseCampaign: `Кампания ${args.campaign_id || ''} будет остановлена`,
    pauseAdSet: `Адсет ${args.adset_id || ''} будет остановлен`,
    pauseDirection: `Направление и все связанные адсеты будут остановлены`,
    updateBudget: `Бюджет будет изменён на $${(args.new_budget_cents / 100 || 0).toFixed(2)}/день`,
    updateDirectionBudget: `Бюджет направления будет изменён на $${args.new_budget || 0}/день`,
    triggerBrainOptimizationRun: 'Brain Agent может изменить бюджеты и статусы адсетов',
    deleteCampaign: 'Кампания будет удалена безвозвратно!',
    bulkPause: `Будет остановлено несколько объектов`
  };

  return warnings[tool] || 'Это действие может повлиять на ваши рекламные кампании';
}

/**
 * Create a progress component (tier indicator)
 * @param {Object} tierState - Current tier state
 * @returns {Object} Progress component
 */
export function createProgressComponent(tierState) {
  if (!tierState) return null;

  const tiers = [
    { id: 'snapshot', label: 'Обзор', icon: '📊' },
    { id: 'drilldown', label: 'Детали', icon: '🔍' },
    { id: 'actions', label: 'Действия', icon: '⚡' }
  ];

  return {
    type: 'progress',
    current: tierState.currentTier,
    playbookId: tierState.playbookId,
    items: tiers.map((tier, idx) => ({
      id: tier.id,
      label: tier.label,
      icon: tier.icon,
      order: idx + 1,
      status: tierState.completedTiers?.includes(tier.id)
        ? 'completed'
        : tierState.currentTier === tier.id
          ? 'current'
          : 'pending'
    }))
  };
}

/**
 * Create a table component
 * @param {Object} options
 * @param {string} options.title - Table title
 * @param {Array} options.columns - Column headers
 * @param {Array} options.rows - Row data (array of arrays)
 * @param {number} [options.limit] - Max rows to show
 * @returns {Object} Table component
 */
export function createTableComponent({ title, columns, rows, limit = 10 }) {
  if (!rows || rows.length === 0) return null;

  return {
    type: 'table',
    title,
    columns,
    rows: rows.slice(0, limit),
    hasMore: rows.length > limit,
    totalRows: rows.length
  };
}

/**
 * Create a cards component
 * @param {Object} options
 * @param {string} options.title - Section title
 * @param {Array} options.items - Array of { title, subtitle?, metric?, thumbnail?, id }
 * @param {number} [options.limit] - Max cards to show
 * @returns {Object} Cards component
 */
export function createCardsComponent({ title, items, limit = 5 }) {
  if (!items || items.length === 0) return null;

  return {
    type: 'cards',
    title,
    items: items.slice(0, limit).map(item => ({
      id: item.id,
      title: item.title,
      subtitle: item.subtitle,
      metric: item.metric,
      thumbnail: item.thumbnail,
      entityRef: item.entityRef // e.g., [c1], [d1]
    })),
    hasMore: items.length > limit,
    totalItems: items.length
  };
}

/**
 * Create a metric card component (single KPI)
 * @param {Object} options
 * @param {string} options.label - Metric label
 * @param {string|number} options.value - Metric value
 * @param {string} [options.unit] - Unit (e.g., '₽', '%')
 * @param {string} [options.trend] - 'up' | 'down' | 'neutral'
 * @param {string} [options.trendValue] - e.g., '+15%'
 * @returns {Object} Metric component
 */
export function createMetricComponent({ label, value, unit, trend, trendValue }) {
  return {
    type: 'metric',
    label,
    value,
    unit,
    trend,
    trendValue
  };
}

/**
 * Create a metrics row (multiple KPIs)
 * @param {Array} metrics - Array of metric objects
 * @returns {Object} Metrics row component
 */
export function createMetricsRowComponent(metrics) {
  if (!metrics || metrics.length === 0) return null;

  return {
    type: 'metrics_row',
    items: metrics.map(m => createMetricComponent(m))
  };
}

/**
 * Create an alert/notice component
 * @param {Object} options
 * @param {string} options.type - 'info' | 'warning' | 'error' | 'success'
 * @param {string} options.message - Alert message
 * @param {string} [options.title] - Alert title
 * @param {boolean} [options.dismissible] - Can be dismissed
 * @returns {Object} Alert component
 */
export function createAlertComponent({ type, message, title, dismissible = true }) {
  return {
    type: 'alert',
    alertType: type,
    title,
    message,
    dismissible
  };
}

/**
 * Combine multiple components into a ui_json structure
 * @param {Array} components - Array of components
 * @returns {Object} ui_json structure
 */
export function assembleUiJson(components) {
  const validComponents = (components || []).filter(Boolean);

  if (validComponents.length === 0) return null;

  return {
    components: validComponents
  };
}

/**
 * Create standard next steps for a playbook tier
 * @param {Object} playbook - Playbook definition
 * @param {Object} tierState - Current tier state
 * @param {Object} [snapshotData] - Data from snapshot tier
 * @returns {Object} Actions component
 */
export function createPlaybookNextSteps(playbook, tierState, snapshotData = {}) {
  if (!playbook?.nextSteps) return null;

  const items = playbook.nextSteps.map(step => ({
    id: step.id,
    label: step.label,
    icon: step.icon || '➡️',
    payload: {
      nextStepId: step.id,
      targetTier: step.targetTier,
      playbookId: playbook.id
    },
    style: step.targetTier === 'actions' ? 'danger' : 'default'
  }));

  return createActionsComponent({
    title: 'Что сделать дальше?',
    items
  });
}

// Default export with all functions
export default {
  createActionsComponent,
  createChoiceComponent,
  createApprovalComponent,
  createProgressComponent,
  createTableComponent,
  createCardsComponent,
  createMetricComponent,
  createMetricsRowComponent,
  createAlertComponent,
  assembleUiJson,
  createPlaybookNextSteps
};
