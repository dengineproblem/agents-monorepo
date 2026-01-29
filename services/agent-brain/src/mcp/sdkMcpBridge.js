/**
 * SDK MCP Bridge
 *
 * Создаёт встроенный SDK MCP сервер для Claude Agent SDK.
 * Конвертирует существующие tool definitions (Zod schemas + handlers)
 * в формат, совместимый с createSdkMcpServer.
 *
 * Ключевые особенности:
 * - Используем tool() функцию SDK для создания инструментов
 * - Передаём tools напрямую в createSdkMcpServer
 * - allowedTools нужен для разрешения MCP tools без permissionMode
 * - Контекст сессии инъецируется через замыкания
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { allMCPTools } from './tools/definitions.js';
import { isDangerousTool } from './tools/constants.js';
import { logger } from '../lib/logger.js';

const MCP_SERVER_NAME = 'meta-ads';

/**
 * Extract Zod shape from a z.object() schema
 * z.object({ foo: z.string() })._def.shape() → { foo: ZodString }
 *
 * @param {import('zod').ZodObject} zodSchema
 * @returns {Record<string, import('zod').ZodType>|null}
 */
function extractZodShape(zodSchema) {
  if (!zodSchema) return null;

  // z.object() has _def.shape (function in Zod v3)
  if (zodSchema._def?.typeName === 'ZodObject') {
    const shape = typeof zodSchema._def.shape === 'function'
      ? zodSchema._def.shape()
      : zodSchema._def.shape;
    return shape || null;
  }

  return null;
}

/**
 * Create embedded SDK MCP server with all tools
 *
 * @param {Object} context - Session context for tool handlers
 * @param {string} context.userAccountId
 * @param {string} context.adAccountId
 * @param {string} [context.adAccountDbId]
 * @param {string} context.accessToken
 * @param {string} [context.dangerousPolicy='block']
 * @param {string} [context.conversationId]
 * @param {Function} [context.onToolCall] - Callback when tool is called
 * @returns {{ server: Object, allowedToolNames: string[] }}
 */
export function createEmbeddedMcpServer(context) {
  const {
    userAccountId,
    adAccountId,
    adAccountDbId,
    accessToken,
    dangerousPolicy = 'block',
    conversationId,
    onToolCall
  } = context;

  // Tool context matching existing handler signature: handler(args, toolContext)
  const toolContext = {
    userAccountId,
    adAccountId,
    adAccountDbId,
    accessToken
  };

  const sdkTools = [];
  const registeredTools = [];
  const skippedTools = [];

  for (const mcpTool of allMCPTools) {
    const { name, description, zodSchema, handler, agent } = mcpTool;

    // Extract Zod shape for tool() function
    const shape = extractZodShape(zodSchema);
    if (!shape) {
      skippedTools.push({ name, reason: 'no Zod shape' });
      continue;
    }

    // Check dangerous policy
    const dangerous = isDangerousTool(name);
    if (dangerous && dangerousPolicy === 'block') {
      // Create tool that returns approval_required instead of executing
      sdkTools.push(
        tool(
          name,
          `[REQUIRES APPROVAL] ${description}`,
          shape,
          async (args) => {
            onToolCall?.({ name, args, blocked: true });
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  approval_required: true,
                  tool: name,
                  args,
                  reason: `Действие "${name}" требует подтверждения пользователя`,
                  meta: { dangerous: true, conversationId }
                })
              }]
            };
          }
        )
      );
    } else {
      // Create tool with actual handler
      sdkTools.push(
        tool(
          name,
          description,
          shape,
          async (args) => {
            const startTime = Date.now();
            onToolCall?.({ name, args, started: true });

            try {
              const result = await handler(args, toolContext);
              const latencyMs = Date.now() - startTime;

              onToolCall?.({ name, args, success: true, latencyMs });

              // Format result for MCP
              const text = typeof result === 'string'
                ? result
                : JSON.stringify(result, null, 2);

              return { content: [{ type: 'text', text }] };
            } catch (error) {
              const latencyMs = Date.now() - startTime;
              onToolCall?.({ name, args, success: false, error: error.message, latencyMs });

              return {
                content: [{ type: 'text', text: JSON.stringify({ error: error.message, success: false }) }],
                isError: true
              };
            }
          }
        )
      );
    }

    registeredTools.push({ name, agent, dangerous });
  }

  // Create server with all tools (as per SDK documentation)
  const server = createSdkMcpServer({
    name: MCP_SERVER_NAME,
    version: '1.0.0',
    tools: sdkTools
  });

  // Build allowedTools list (MCP tool names have prefix mcp__<server>__)
  const allowedToolNames = registeredTools.map(t => `mcp__${MCP_SERVER_NAME}__${t.name}`);

  logger.info({
    registered: registeredTools.length,
    skipped: skippedTools.length,
    dangerous: registeredTools.filter(t => t.dangerous).length,
    dangerousPolicy,
    serverName: MCP_SERVER_NAME
  }, 'SDK MCP bridge created');

  if (skippedTools.length > 0) {
    logger.warn({ skippedTools }, 'Some tools skipped (no Zod schema)');
  }

  return {
    server,
    allowedToolNames,
    registeredCount: registeredTools.length,
    skippedCount: skippedTools.length
  };
}
