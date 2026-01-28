/**
 * Chat Assistant Configuration
 *
 * Configuration for Meta-Tools architecture with Claude Agent SDK support
 */

export const ORCHESTRATOR_CONFIG = {
  // ============================================================
  // LLM PROVIDER SELECTION
  // ============================================================

  /**
   * LLM provider: 'openai' | 'claude'
   * Set via LLM_PROVIDER env variable
   */
  llmProvider: process.env.LLM_PROVIDER || 'openai',

  /**
   * Enable fallback to OpenAI when Claude fails
   */
  llmFallback: process.env.LLM_FALLBACK === 'true',

  // ============================================================
  // OPENAI CONFIGURATION
  // ============================================================

  /**
   * Model for meta-tools orchestrator (OpenAI)
   * Options: 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'
   */
  model: process.env.META_ORCHESTRATOR_MODEL || 'gpt-4o',

  /**
   * Model for domain agents (data processing)
   */
  domainAgentModel: process.env.DOMAIN_AGENT_MODEL || 'gpt-4o-mini',

  // ============================================================
  // CLAUDE CONFIGURATION
  // ============================================================

  /**
   * Model for Claude orchestrator
   * Options: 'claude-sonnet-4', 'claude-opus-4', 'claude-3-5-sonnet-latest'
   */
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',

  /**
   * Max turns for Claude agent loop
   */
  claudeMaxTurns: parseInt(process.env.CLAUDE_MAX_TURNS || '10', 10),

  /**
   * Enable Skills from .claude/skills/
   */
  claudeEnableSkills: process.env.CLAUDE_ENABLE_SKILLS !== 'false',

  /**
   * Timeout for Claude query in milliseconds
   */
  claudeTimeoutMs: parseInt(process.env.CLAUDE_TIMEOUT_MS || '120000', 10),

  // ============================================================
  // GENERAL SETTINGS
  // ============================================================

  /**
   * Max iterations for meta-tools loop
   */
  maxIterations: parseInt(process.env.META_MAX_ITERATIONS || '10', 10),

  /**
   * Enable detailed logging for debugging
   */
  debugMode: process.env.ORCHESTRATOR_DEBUG === 'true',

  /**
   * Enable layer logging for debugging
   * Can be enabled per-request via debugLayers param for admin users
   */
  enableLayerLogging: process.env.ENABLE_LAYER_LOGGING === 'true',

  /**
   * List of admin user IDs who can see layer logs in production
   */
  layerLoggingAdminIds: (process.env.LAYER_LOGGING_ADMIN_IDS || '').split(',').filter(Boolean)
};

export default ORCHESTRATOR_CONFIG;
