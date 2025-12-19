/**
 * MCP Bridge
 *
 * Мост между Meta-Tools и MCP executor.
 * Заменяет прямые вызовы handlers на вызовы через MCP протокол
 * с поддержкой dangerousPolicy, allowedTools и tool call limits.
 */

import { executeToolWithContext } from '../../mcp/tools/executor.js';
import { getDomainForTool } from './formatters.js';
import { executeWithIdempotency } from '../shared/idempotentExecutor.js';
import { logger } from '../../lib/logger.js';

// Feature flag для безопасного rollout
const USE_MCP_RUNTIME = process.env.USE_MCP_RUNTIME !== 'false';

/**
 * Execute tool through MCP with compatibility adapter
 * @param {string} toolName - Tool name
 * @param {Object} args - Tool arguments
 * @param {Object} context - Execution context
 * @param {string} context.sessionId - MCP session ID
 * @param {string} context.userAccountId - User account ID
 * @param {string} context.adAccountId - Ad account ID
 * @param {string} context.accessToken - Access token
 * @param {string} [context.dangerousPolicy='block'] - Policy for dangerous tools
 * @param {string} [context.conversationId] - Conversation ID
 * @returns {Promise<Object>} Tool result with _meta
 */
export async function executeMCPTool(toolName, args, context) {
  const startTime = Date.now();
  const domain = getDomainForTool(toolName);

  if (!domain) {
    return {
      success: false,
      error: `Unknown tool: ${toolName}`,
      error_code: 'TOOL_NOT_FOUND',
      _meta: { tool: toolName, latency_ms: Date.now() - startTime }
    };
  }

  try {
    // Execute through MCP with idempotency wrapper
    const result = await executeWithIdempotency(
      toolName,
      args,
      {
        ...context,
        source: 'mcp_bridge'
      },
      async (finalArgs, ctx) => {
        // Build MCP context
        const mcpContext = {
          userAccountId: ctx.userAccountId,
          adAccountId: ctx.adAccountId,
          accessToken: ctx.accessToken,
          dangerousPolicy: ctx.dangerousPolicy || 'block',
          conversationId: ctx.conversationId,
          sessionId: ctx.sessionId
        };

        return executeToolWithContext(toolName, finalArgs, mcpContext);
      }
    );

    const latency = Date.now() - startTime;

    // Handle approval_required response from MCP
    if (result.approval_required) {
      logger.info({
        tool: toolName,
        domain,
        reason: result.reason
      }, 'MCP tool requires approval');

      return {
        success: false,
        approval_required: true,
        tool: result.tool,
        args: result.args,
        reason: result.reason,
        message: `⚠️ Действие "${toolName}" требует подтверждения: ${result.reason}`,
        _meta: {
          tool: toolName,
          domain,
          latency_ms: latency,
          requires_approval: true,
          via: 'mcp'
        }
      };
    }

    // Handle tool call limit exceeded
    if (result.error === 'tool_call_limit_reached') {
      logger.warn({
        tool: toolName,
        used: result.meta?.toolCallsUsed,
        max: result.meta?.maxToolCalls
      }, 'MCP tool call limit reached');

      return {
        success: false,
        error: result.message,
        error_code: 'TOOL_CALL_LIMIT',
        _meta: {
          tool: toolName,
          domain,
          latency_ms: latency,
          via: 'mcp'
        }
      };
    }

    // Handle validation errors
    if (result.error === 'validation_error') {
      return {
        success: false,
        error: result.message,
        error_code: 'VALIDATION_ERROR',
        validation_errors: result.validation_errors,
        _meta: {
          tool: toolName,
          domain,
          latency_ms: latency,
          via: 'mcp'
        }
      };
    }

    logger.info({
      tool: toolName,
      domain,
      latency,
      cached: result.already_applied || false
    }, 'MCP tool executed');

    // Return result with metadata
    return {
      ...result,
      _meta: {
        tool: toolName,
        domain,
        latency_ms: latency,
        cached: result.already_applied || false,
        via: 'mcp'
      }
    };

  } catch (error) {
    const latency = Date.now() - startTime;
    const isTimeout = error.message?.includes('timeout');

    logger.error({
      tool: toolName,
      domain,
      error: error.message,
      latency,
      isTimeout
    }, 'MCP tool execution failed');

    return {
      success: false,
      error: isTimeout
        ? `Tool ${toolName} timed out. Try again or simplify the request.`
        : error.message,
      error_code: isTimeout ? 'TIMEOUT' : 'EXECUTION_ERROR',
      _meta: {
        tool: toolName,
        domain,
        latency_ms: latency,
        via: 'mcp'
      }
    };
  }
}

/**
 * Execute multiple tools through MCP in parallel
 * @param {Array<{name: string, args: Object}>} toolCalls - Array of tool calls
 * @param {Object} context - Execution context
 * @returns {Promise<Array>} Array of results
 */
export async function executeMCPToolsInParallel(toolCalls, context) {
  const promises = toolCalls.map(({ name, args }) =>
    executeMCPTool(name, args, context)
      .catch(error => ({
        success: false,
        error: error.message,
        error_code: 'PARALLEL_EXECUTION_ERROR',
        _meta: { tool: name, via: 'mcp' }
      }))
  );

  return Promise.all(promises);
}

/**
 * Adaptive executor with feature flag
 * Falls back to legacy executor if USE_MCP_RUNTIME=false
 */
export async function executeToolAdaptive(toolName, args, context) {
  if (USE_MCP_RUNTIME && context.sessionId) {
    return executeMCPTool(toolName, args, context);
  }

  // Fallback to legacy executor (dynamic import to avoid circular deps)
  const { executeToolByName } = await import('./executor.js');
  return executeToolByName(toolName, args, context);
}

export default {
  executeMCPTool,
  executeMCPToolsInParallel,
  executeToolAdaptive
};
