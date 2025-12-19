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
  debugMode: process.env.ORCHESTRATOR_DEBUG === 'true'
};

export default ORCHESTRATOR_CONFIG;
