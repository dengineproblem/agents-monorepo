/**
 * Chat Assistant Configuration
 *
 * Feature flags и конфигурация для управления режимами работы
 */

/**
 * Orchestrator mode configuration
 *
 * Modes:
 * - 'legacy' — старая архитектура (intent detection → policy → agent)
 * - 'meta' — новая архитектура (meta-tools с lazy loading)
 * - 'parallel' — A/B тестирование (случайный выбор по проценту)
 */
export const ORCHESTRATOR_CONFIG = {
  /**
   * Current orchestrator mode
   * @type {'legacy' | 'meta' | 'parallel'}
   */
  mode: process.env.ORCHESTRATOR_MODE || 'legacy',

  /**
   * Percentage of requests to route to meta-tools (0-100)
   * Only used when mode === 'parallel'
   */
  metaToolsPercentage: parseInt(process.env.META_TOOLS_PERCENTAGE || '0', 10),

  /**
   * Model for meta-tools orchestrator
   */
  metaModel: process.env.META_ORCHESTRATOR_MODEL || 'gpt-5.2',

  /**
   * Model for legacy orchestrator (intent detection)
   */
  legacyIntentModel: process.env.CHAT_ASSISTANT_INTENT_MODEL || 'gpt-4o-mini',

  /**
   * Model for legacy agent execution
   */
  legacyAgentModel: process.env.CHAT_ASSISTANT_MODEL || 'gpt-5.2',

  /**
   * Max iterations for meta-tools loop
   */
  maxMetaIterations: parseInt(process.env.META_MAX_ITERATIONS || '10', 10),

  /**
   * Enable detailed logging for debugging
   */
  debugMode: process.env.ORCHESTRATOR_DEBUG === 'true'
};

/**
 * Select orchestrator mode for a request
 * @param {Object} context - Request context
 * @returns {'legacy' | 'meta'}
 */
export function selectOrchestratorMode(context = {}) {
  const { mode, metaToolsPercentage } = ORCHESTRATOR_CONFIG;

  // Force mode via context (for testing)
  if (context.forceMode && ['legacy', 'meta'].includes(context.forceMode)) {
    return context.forceMode;
  }

  // Direct mode selection
  if (mode === 'legacy') return 'legacy';
  if (mode === 'meta') return 'meta';

  // A/B testing mode
  if (mode === 'parallel') {
    const roll = Math.random() * 100;
    return roll < metaToolsPercentage ? 'meta' : 'legacy';
  }

  // Default to legacy
  return 'legacy';
}

/**
 * Log configuration on startup
 */
export function logConfig() {
  const { mode, metaToolsPercentage, metaModel, legacyAgentModel } = ORCHESTRATOR_CONFIG;

  console.log('[ChatAssistant] Configuration:');
  console.log(`  Mode: ${mode}`);

  if (mode === 'parallel') {
    console.log(`  Meta-tools percentage: ${metaToolsPercentage}%`);
  }

  if (mode === 'meta' || mode === 'parallel') {
    console.log(`  Meta model: ${metaModel}`);
  }

  if (mode === 'legacy' || mode === 'parallel') {
    console.log(`  Legacy model: ${legacyAgentModel}`);
  }
}

export default ORCHESTRATOR_CONFIG;
