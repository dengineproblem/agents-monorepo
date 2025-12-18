/**
 * Meta-Tools Executor
 *
 * Выполнение domain tools по имени с валидацией, таймаутами и идемпотентностью
 */

import { adsHandlers } from '../agents/ads/handlers.js';
import { creativeHandlers } from '../agents/creative/handlers.js';
import { crmHandlers } from '../agents/crm/handlers.js';
import { whatsappHandlers } from '../agents/whatsapp/handlers.js';
import { toolRegistry } from '../shared/toolRegistry.js';
import { withTimeout } from '../shared/retryUtils.js';
import { executeWithIdempotency } from '../shared/idempotentExecutor.js';
import { findTool, getDomainForTool } from './formatters.js';
import { logger } from '../../lib/logger.js';

/**
 * Domain handlers mapping
 */
const DOMAIN_HANDLERS = {
  ads: adsHandlers,
  creative: creativeHandlers,
  crm: crmHandlers,
  whatsapp: whatsappHandlers
};

/**
 * Execute a tool by name
 * @param {string} toolName - Tool name (e.g., 'getSpendReport')
 * @param {Object} args - Tool arguments
 * @param {Object} context - Execution context (accessToken, adAccountId, etc.)
 * @returns {Promise<Object>} Tool result or error
 */
export async function executeToolByName(toolName, args, context) {
  const startTime = Date.now();

  // 1. Find tool and domain
  const toolInfo = findTool(toolName);

  if (!toolInfo) {
    return {
      success: false,
      error: `Unknown tool: ${toolName}`,
      error_code: 'TOOL_NOT_FOUND'
    };
  }

  const { domain, tool } = toolInfo;
  const handlers = DOMAIN_HANDLERS[domain];

  if (!handlers || !handlers[toolName]) {
    return {
      success: false,
      error: `Handler not found for tool: ${toolName}`,
      error_code: 'HANDLER_NOT_FOUND'
    };
  }

  const handler = handlers[toolName];

  // 2. Check if tool is dangerous and warn LLM
  if (tool.meta?.dangerous === true) {
    logger.warn({ tool: toolName, domain }, 'Executing DANGEROUS tool');
  }

  // 3. Validate arguments through registry
  const validation = toolRegistry.validate(toolName, args);

  if (!validation.success) {
    logger.warn({ tool: toolName, error: validation.error }, 'Tool validation failed');
    return {
      success: false,
      error: `Validation error for ${toolName}: ${validation.error}`,
      error_code: 'VALIDATION_ERROR'
    };
  }

  const validatedArgs = validation.data;

  // 4. Get metadata for timeout
  const metadata = toolRegistry.getMetadata(toolName);
  const timeout = metadata?.timeout || tool.meta?.timeout || 20000;

  try {
    // 5. Execute with idempotency wrapper
    const result = await executeWithIdempotency(
      toolName,
      validatedArgs,
      {
        ...context,
        source: 'meta_tools'
      },
      async (finalArgs, ctx) => {
        return withTimeout(
          () => handler(finalArgs, ctx),
          timeout,
          `tool:${toolName}`
        );
      }
    );

    const latency = Date.now() - startTime;
    logger.info({ tool: toolName, domain, latency, cached: result.already_applied || false }, 'Tool executed');

    // Add metadata to result
    return {
      ...result,
      _meta: {
        tool: toolName,
        domain,
        latency_ms: latency,
        cached: result.already_applied || false
      }
    };

  } catch (error) {
    const latency = Date.now() - startTime;
    const isTimeout = error.message?.includes('timed out');

    logger.error({ tool: toolName, domain, error: error.message, latency, isTimeout }, 'Tool execution failed');

    return {
      success: false,
      error: isTimeout
        ? `Tool ${toolName} timed out after ${timeout}ms. Try again or simplify the request.`
        : error.message,
      error_code: isTimeout ? 'TIMEOUT' : 'EXECUTION_ERROR',
      _meta: {
        tool: toolName,
        domain,
        latency_ms: latency
      }
    };
  }
}

/**
 * Execute multiple tools in parallel
 * @param {Array<{name: string, args: Object}>} toolCalls - Array of tool calls
 * @param {Object} context - Execution context
 * @returns {Promise<Array>} Array of results
 */
export async function executeToolsInParallel(toolCalls, context) {
  const promises = toolCalls.map(({ name, args }) =>
    executeToolByName(name, args, context)
      .catch(error => ({
        success: false,
        error: error.message,
        error_code: 'PARALLEL_EXECUTION_ERROR',
        _meta: { tool: name }
      }))
  );

  return Promise.all(promises);
}

/**
 * Check if tool is dangerous
 * @param {string} toolName - Tool name
 * @returns {boolean}
 */
export function isToolDangerous(toolName) {
  const toolInfo = findTool(toolName);
  return toolInfo?.tool?.meta?.dangerous === true;
}

/**
 * Get list of all dangerous tools
 * @returns {string[]} Array of dangerous tool names
 */
export function getAllDangerousTools() {
  const dangerous = [];

  for (const [domain, handlers] of Object.entries(DOMAIN_HANDLERS)) {
    for (const toolName of Object.keys(handlers)) {
      const toolInfo = findTool(toolName);
      if (toolInfo?.tool?.meta?.dangerous === true) {
        dangerous.push(toolName);
      }
    }
  }

  return dangerous;
}
