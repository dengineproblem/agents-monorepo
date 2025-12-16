/**
 * Hybrid MCP Executor Module
 *
 * Orchestrator контролирует, MCP выполняет.
 *
 * Exports:
 * - PolicyEngine - Playbook → allowedTools
 * - toolFilter - Фильтрация tools перед OpenAI
 * - ClarifyingGate - Уточняющие вопросы (Phase 2)
 * - ResponseAssembler - Сборка ответа (Phase 3)
 */

// Phase 1: Policy Engine + Tool Filter
export { PolicyEngine, policyEngine } from './policyEngine.js';
export {
  filterToolsForOpenAI,
  validateToolCall,
  isDangerousTool,
  getToolType,
  getToolsSummary,
  filterReadOnlyTools,
  policyToSessionExtensions
} from './toolFilter.js';

// Phase 2: Clarifying Gate
export {
  ClarifyingGate,
  clarifyingGate,
  QUESTION_TYPES,
  EXTRACTION_PATTERNS
} from './clarifyingGate.js';

// Phase 3: Response Assembler
export {
  ResponseAssembler,
  responseAssembler,
  SECTION_TYPES,
  NEXT_STEP_RULES
} from './responseAssembler.js';

// Config
export const HYBRID_CONFIG = {
  enabled: process.env.HYBRID_ENABLED === 'true',
  clarifyingGateEnabled: process.env.CLARIFYING_GATE_ENABLED !== 'false',  // Default true
  maxToolCalls: parseInt(process.env.HYBRID_MAX_TOOL_CALLS || '5', 10),
  defaultDangerousPolicy: 'block'
};
