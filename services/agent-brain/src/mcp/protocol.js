/**
 * MCP Protocol Handler
 *
 * Обрабатывает JSON-RPC 2.0 сообщения по спецификации MCP.
 * Поддерживаемые методы:
 * - initialize: Инициализация соединения
 * - tools/list: Список доступных инструментов
 * - tools/call: Выполнение инструмента
 * - resources/list: Список ресурсов
 * - resources/read: Чтение ресурса
 */

import { getToolRegistry } from './tools/registry.js';
import { executeToolWithContext } from './tools/executor.js';
import { getResourceRegistry, readResource } from './resources/registry.js';
import { isToolAllowed } from './sessions.js';

// MCP Protocol version
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'agents-mcp-server';
const SERVER_VERSION = '1.0.0';

/**
 * Handle incoming MCP JSON-RPC request
 * @param {Object} request - JSON-RPC request
 * @param {Object} context - Session context (userAccountId, adAccountId, accessToken)
 * @returns {Object} JSON-RPC response
 */
export async function handleMCPRequest(request, context) {
  const { jsonrpc, id, method, params } = request;

  // Validate JSON-RPC version
  if (jsonrpc !== '2.0') {
    return createErrorResponse(id, -32600, 'Invalid Request: jsonrpc must be "2.0"');
  }

  try {
    switch (method) {
      case 'initialize':
        return handleInitialize(id, params);

      case 'initialized':
        // Client notification - no response needed
        return null;

      case 'tools/list':
        return handleToolsList(id, params, context);

      case 'tools/call':
        return await handleToolsCall(id, params, context);

      case 'resources/list':
        return handleResourcesList(id, params, context);

      case 'resources/read':
        return await handleResourcesRead(id, params, context);

      case 'ping':
        return createSuccessResponse(id, {});

      default:
        return createErrorResponse(id, -32601, `Method not found: ${method}`);
    }
  } catch (error) {
    console.error(`MCP protocol error in ${method}:`, error);
    return createErrorResponse(id, -32603, `Internal error: ${error.message}`);
  }
}

/**
 * Handle initialize request
 */
function handleInitialize(id, params) {
  const { protocolVersion, clientInfo } = params || {};

  console.log(`MCP initialize from ${clientInfo?.name || 'unknown'} v${clientInfo?.version || '?'}`);

  return createSuccessResponse(id, {
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION
    },
    capabilities: {
      tools: {
        listChanged: false  // We don't dynamically change tools
      },
      resources: {
        subscribe: false,
        listChanged: false
      }
    }
  });
}

/**
 * Handle tools/list request
 * Filters tools based on session allowedTools if specified
 */
function handleToolsList(id, params, context) {
  const tools = getToolRegistry();
  const { sessionId, allowedTools } = context || {};

  // Filter tools based on session allowedTools
  let filteredTools = tools;
  if (allowedTools && Array.isArray(allowedTools) && allowedTools.length > 0) {
    filteredTools = tools.filter(tool => allowedTools.includes(tool.name));
  }

  // Convert to MCP format
  const mcpTools = filteredTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }));

  return createSuccessResponse(id, { tools: mcpTools });
}

/**
 * Handle tools/call request
 * Checks if tool is allowed for session before execution
 */
async function handleToolsCall(id, params, context) {
  const { name, arguments: args } = params || {};
  const { sessionId, allowedTools } = context || {};

  if (!name) {
    return createErrorResponse(id, -32602, 'Invalid params: tool name is required');
  }

  // Security check: verify tool is in allowedTools (if specified)
  if (allowedTools && Array.isArray(allowedTools) && allowedTools.length > 0) {
    if (!allowedTools.includes(name)) {
      return createSuccessResponse(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: `Tool "${name}" is not allowed for this session`,
              success: false,
              code: 'TOOL_NOT_ALLOWED'
            })
          }
        ],
        isError: true
      });
    }
  }

  try {
    const result = await executeToolWithContext(name, args || {}, context);

    return createSuccessResponse(id, {
      content: [
        {
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        }
      ]
    });
  } catch (error) {
    // Tool execution errors are returned as tool results, not protocol errors
    return createSuccessResponse(id, {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: error.message, success: false })
        }
      ],
      isError: true
    });
  }
}

/**
 * Handle resources/list request
 */
function handleResourcesList(id, params, context) {
  const resources = getResourceRegistry();

  return createSuccessResponse(id, { resources });
}

/**
 * Handle resources/read request
 */
async function handleResourcesRead(id, params, context) {
  const { uri } = params || {};

  if (!uri) {
    return createErrorResponse(id, -32602, 'Invalid params: resource uri is required');
  }

  try {
    const contents = await readResource(uri, context);

    return createSuccessResponse(id, { contents });
  } catch (error) {
    return createErrorResponse(id, -32602, `Resource error: ${error.message}`);
  }
}

/**
 * Create JSON-RPC success response
 */
function createSuccessResponse(id, result) {
  return {
    jsonrpc: '2.0',
    id,
    result
  };
}

/**
 * Create JSON-RPC error response
 */
function createErrorResponse(id, code, message, data = undefined) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data !== undefined && { data })
    }
  };
}

export default { handleMCPRequest };
