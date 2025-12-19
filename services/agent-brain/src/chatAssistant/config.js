/**
 * Chat Assistant Configuration
 *
 * Configuration for Meta-Tools architecture
 */

export const ORCHESTRATOR_CONFIG = {
  /**
   * Model for meta-tools orchestrator
   */
  model: process.env.META_ORCHESTRATOR_MODEL || 'gpt-5.2',

  /**
   * Model for domain agents (data processing)
   */
  domainAgentModel: process.env.DOMAIN_AGENT_MODEL || 'gpt-4o-mini',

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
