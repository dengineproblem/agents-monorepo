/**
 * Claude Agent SDK Adapter
 *
 * Адаптирует META_TOOLS для использования с Claude Agent SDK.
 * Создаёт MCP-совместимый сервер для интеграции через mcpServers option.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { META_TOOLS } from './definitions.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { logger } from '../../lib/logger.js';

/**
 * Create MCP server with META_TOOLS for Claude Agent SDK
 *
 * @param {Object} context - Tool execution context (userAccountId, adAccountId, etc.)
 * @returns {Object} MCP server configuration for Claude Agent SDK
 */
export function createMetaToolsMcpServer(context = {}) {
  const tools = Object.values(META_TOOLS).map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.schema, { $refStrategy: 'none' })
  }));

  return {
    name: 'meta-tools',
    version: '1.0.0',
    tools,
    // Handler будет вызываться через mcpBridge
    context
  };
}

/**
 * Execute META_TOOL by name
 *
 * @param {string} toolName - Tool name (e.g., 'executeTools')
 * @param {Object} args - Tool arguments
 * @param {Object} context - Execution context
 * @returns {Promise<Object>} Tool result
 */
export async function executeMetaTool(toolName, args, context) {
  const startTime = Date.now();

  // Validate tool name
  if (!toolName || typeof toolName !== 'string') {
    logger.error({ toolName, type: typeof toolName }, 'Invalid tool name provided');
    throw new Error(`Invalid tool name: ${toolName}`);
  }

  const tool = META_TOOLS[toolName];

  if (!tool) {
    const availableTools = Object.keys(META_TOOLS);
    logger.error({ toolName, availableTools }, 'Unknown meta-tool requested');
    throw new Error(`Unknown meta-tool: ${toolName}. Available: ${availableTools.join(', ')}`);
  }

  // Validate args
  if (args !== undefined && args !== null && typeof args !== 'object') {
    logger.warn({ toolName, argsType: typeof args }, 'Tool args is not an object, wrapping');
    args = { value: args };
  }

  logger.debug({
    toolName,
    hasContext: !!context,
    contextKeys: context ? Object.keys(context) : []
  }, 'Executing meta-tool');

  try {
    const result = await tool.handler(args || {}, context);
    const latency = Date.now() - startTime;

    logger.debug({
      toolName,
      latencyMs: latency,
      hasResult: !!result,
      resultType: typeof result
    }, 'Meta-tool execution completed');

    return result;
  } catch (error) {
    const latency = Date.now() - startTime;
    logger.error({
      toolName,
      error: error.message,
      latencyMs: latency
    }, 'Meta-tool execution error');
    throw error;
  }
}

/**
 * Get META_TOOLS as array of tool definitions for Claude
 * Format compatible with Claude Agent SDK tool() function
 *
 * @returns {Array<{name: string, description: string, inputSchema: Object}>}
 */
export function getMetaToolsForClaude() {
  return Object.values(META_TOOLS).map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.schema, { $refStrategy: 'none' })
  }));
}

/**
 * Map Claude SDK message types to SSE event types
 *
 * @param {Object} sdkMessage - Message from Claude Agent SDK query()
 * @returns {Object|Array<Object>|null} SSE event(s) or null if not mappable
 */
export function mapSdkMessageToSseEvent(sdkMessage) {
  // Validate input
  if (!sdkMessage) {
    return null;
  }

  if (typeof sdkMessage !== 'object') {
    logger.warn({ sdkMessageType: typeof sdkMessage }, 'SDK message is not an object');
    return null;
  }

  if (!sdkMessage.type) {
    // Some messages may not have a type, log for debugging
    logger.debug({ sdkMessageKeys: Object.keys(sdkMessage) }, 'SDK message without type');
    return null;
  }

  try {
    switch (sdkMessage.type) {
      case 'system':
        if (sdkMessage.subtype === 'init') {
          return {
            type: 'init',
            conversationId: sdkMessage.session_id || `claude-${Date.now()}`,
            mode: 'auto'
          };
        }
        // Log other system subtypes for debugging
        logger.debug({ subtype: sdkMessage.subtype }, 'Unhandled system subtype');
        return null;

      case 'assistant':
        // Assistant message may contain text and/or tool_use blocks
        const events = [];
        const content = sdkMessage.message?.content;

        // Validate content is an array
        if (!Array.isArray(content)) {
          if (typeof content === 'string') {
            // Handle string content directly
            return {
              type: 'text',
              content: content,
              accumulated: content
            };
          }
          logger.debug({ contentType: typeof content }, 'Assistant message content is not an array');
          return null;
        }

        for (const block of content) {
          if (!block || typeof block !== 'object') {
            continue;
          }

          if (block.type === 'text' && block.text) {
            events.push({
              type: 'text',
              content: block.text,
              accumulated: block.text
            });
          } else if (block.type === 'tool_use') {
            events.push({
              type: 'tool_start',
              name: block.name || 'unknown_tool',
              args: block.input || {}
            });
          }
        }

        // Return based on events count
        if (events.length === 0) {
          return null;
        }
        return events.length === 1 ? events[0] : events;

      case 'user':
        // User messages typically don't need SSE events, but log for debugging
        logger.debug({ hasMessage: !!sdkMessage.message }, 'User type message received');
        return null;

      case 'tool':
        // Tool result
        return {
          type: 'tool_result',
          name: sdkMessage.tool_name || sdkMessage.name || 'unknown',
          success: !sdkMessage.is_error,
          duration: sdkMessage.duration_ms || 0
        };

      case 'result':
        if (sdkMessage.subtype === 'success') {
          return {
            type: 'done',
            content: sdkMessage.result || '',
            executedActions: [],
            toolCalls: [],
            domain: 'meta',
            classification: { domain: 'meta', agents: ['claude'] },
            duration: sdkMessage.duration_ms || 0,
            plan: sdkMessage.plan || null
          };
        } else {
          return {
            type: 'error',
            message: sdkMessage.error || sdkMessage.message || 'Unknown error'
          };
        }

      case 'stream_event':
        // Partial streaming events
        const event = sdkMessage.event;
        if (!event || typeof event !== 'object') {
          return null;
        }

        if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            return {
              type: 'text',
              content: delta.text,
              accumulated: '' // Will be accumulated externally
            };
          }
        }
        return null;

      case 'error':
        // Handle explicit error messages
        return {
          type: 'error',
          message: sdkMessage.error || sdkMessage.message || 'Unknown SDK error'
        };

      default:
        // Log unknown types for debugging
        logger.debug({ sdkMessageType: sdkMessage.type }, 'Unknown SDK message type');
        return null;
    }
  } catch (error) {
    logger.error({
      error: error.message,
      sdkMessageType: sdkMessage.type
    }, 'Error mapping SDK message to SSE event');
    return null;
  }
}

export default {
  createMetaToolsMcpServer,
  executeMetaTool,
  getMetaToolsForClaude,
  mapSdkMessageToSseEvent
};
