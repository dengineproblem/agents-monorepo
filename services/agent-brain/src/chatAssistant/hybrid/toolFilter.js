/**
 * Tool Filter - Фильтрация tools перед OpenAI API
 *
 * Механическое ограничение tools на основе policy.
 * Гарантирует что LLM получит только разрешённые tools.
 */

import { logger } from '../../lib/logger.js';
import { DANGEROUS_TOOLS } from '../../mcp/tools/constants.js';

/**
 * Фильтрует tools для OpenAI API на основе policy
 * @param {Array} allTools - Все tools агента (OpenAI format)
 * @param {Object} policy - Policy от PolicyEngine
 * @returns {Array} Отфильтрованные tools
 */
export function filterToolsForOpenAI(allTools, policy) {
  if (!policy || !policy.allowedTools || policy.allowedTools.length === 0) {
    // Если нет ограничений - возвращаем все (для обратной совместимости)
    logger.debug({ totalTools: allTools.length }, 'No tool filtering applied');
    return allTools;
  }

  const allowed = new Set(policy.allowedTools);
  const filtered = allTools.filter(tool => {
    const name = tool.function?.name || tool.name;
    return allowed.has(name);
  });

  logger.info({
    totalTools: allTools.length,
    allowedCount: policy.allowedTools.length,
    filteredCount: filtered.length,
    allowedTools: policy.allowedTools
  }, 'Tools filtered for OpenAI');

  return filtered;
}

/**
 * Валидирует tool call против policy
 * @param {Object} toolCall - Tool call от LLM { name, arguments }
 * @param {Object} policy - Policy от PolicyEngine
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateToolCall(toolCall, policy) {
  const name = toolCall.name || toolCall.function?.name;

  // Проверка на blocked tools
  if (policy.blockedTools?.includes(name)) {
    return {
      valid: false,
      reason: 'explicitly_blocked',
      message: `Tool ${name} явно заблокирован`
    };
  }

  // Проверка на allowed tools
  if (policy.allowedTools?.length > 0 && !policy.allowedTools.includes(name)) {
    return {
      valid: false,
      reason: 'not_in_allowed_list',
      message: `Tool ${name} не в списке разрешённых для этого запроса`
    };
  }

  // Проверка на dangerous tools
  if (isDangerousTool(name) && policy.dangerousPolicy === 'block') {
    return {
      valid: false,
      reason: 'dangerous_requires_approval',
      message: `Tool ${name} требует подтверждения`
    };
  }

  // Проверка лимита tool calls
  if (policy.maxToolCalls !== undefined && policy.toolCallCount >= policy.maxToolCalls) {
    return {
      valid: false,
      reason: 'max_tool_calls_exceeded',
      message: `Превышен лимит вызовов tools (${policy.maxToolCalls})`
    };
  }

  return { valid: true };
}

/**
 * Проверяет, является ли tool dangerous
 * @param {string} toolName
 * @returns {boolean}
 */
export function isDangerousTool(toolName) {
  return DANGEROUS_TOOLS.includes(toolName);
}

/**
 * Определяет тип tool (READ/WRITE)
 * @param {string} toolName
 * @returns {'read' | 'write'}
 */
export function getToolType(toolName) {
  // WRITE tools
  const writePatterns = [
    /^pause/i,
    /^resume/i,
    /^update/i,
    /^launch/i,
    /^start/i,
    /^stop/i,
    /^trigger/i,
    /^send/i
  ];

  for (const pattern of writePatterns) {
    if (pattern.test(toolName)) {
      return 'write';
    }
  }

  return 'read';
}

/**
 * Создаёт summary разрешённых tools для логирования
 * @param {Object} policy
 * @returns {Object}
 */
export function getToolsSummary(policy) {
  const readTools = [];
  const writeTools = [];
  const dangerousTools = [];

  for (const tool of policy.allowedTools || []) {
    const type = getToolType(tool);
    if (type === 'write') {
      writeTools.push(tool);
      if (isDangerousTool(tool)) {
        dangerousTools.push(tool);
      }
    } else {
      readTools.push(tool);
    }
  }

  return {
    total: policy.allowedTools?.length || 0,
    read: readTools,
    write: writeTools,
    dangerous: dangerousTools,
    maxCalls: policy.maxToolCalls
  };
}

/**
 * Фильтрует tools по типу (только READ)
 * @param {Array} tools
 * @returns {Array}
 */
export function filterReadOnlyTools(tools) {
  return tools.filter(tool => {
    const name = tool.function?.name || tool.name;
    return getToolType(name) === 'read';
  });
}

/**
 * Применяет policy к MCP session
 * @param {Object} policy
 * @returns {Object} Session extensions
 */
export function policyToSessionExtensions(policy) {
  return {
    allowedTools: policy.allowedTools,
    allowedDomains: [policy.domain],
    mode: policy.clarifyingRequired ? 'plan' : 'auto',
    dangerousPolicy: policy.dangerousPolicy,
    policyMetadata: {
      playbookId: policy.playbookId,
      intent: policy.intent,
      maxToolCalls: policy.maxToolCalls,
      toolCallCount: 0
    }
  };
}

export default {
  filterToolsForOpenAI,
  validateToolCall,
  isDangerousTool,
  getToolType,
  getToolsSummary,
  filterReadOnlyTools,
  policyToSessionExtensions
};
