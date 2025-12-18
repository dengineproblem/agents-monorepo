/**
 * Meta-Tools Module
 *
 * Lazy-loading tools for simplified orchestrator architecture
 * with Domain Router and Domain Agents for processed responses.
 */

export { META_TOOLS, getMetaToolsForOpenAI } from './definitions.js';
export {
  loadDomainTools,
  formatToolsForLLM,
  getDomainDescription,
  getAllDomains,
  findTool,
  getToolDef,
  getDomainForTool
} from './formatters.js';
export {
  executeToolByName,
  executeToolsInParallel,
  isToolDangerous,
  getAllDangerousTools
} from './executor.js';
export {
  routeToolCallsToDomains,
  needsDomainRouting
} from './domainRouter.js';
export {
  processDomainResults
} from './domainAgents.js';
