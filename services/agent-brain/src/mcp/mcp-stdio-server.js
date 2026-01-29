#!/usr/bin/env node
/**
 * Standalone MCP Stdio Server
 *
 * Используется Claude Agent SDK через stdio transport.
 * Запускается как дочерний процесс оркестратором.
 *
 * Контекст передаётся через environment variables:
 * - MCP_USER_ACCOUNT_ID
 * - MCP_AD_ACCOUNT_ID
 * - MCP_AD_ACCOUNT_DB_ID
 * - MCP_ACCESS_TOKEN
 * - MCP_DANGEROUS_POLICY (allow|block)
 * - MCP_CONVERSATION_ID
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { allMCPTools } from './tools/definitions.js';
import { isDangerousTool } from './tools/constants.js';

// Read context from environment variables
const toolContext = {
  userAccountId: process.env.MCP_USER_ACCOUNT_ID,
  adAccountId: process.env.MCP_AD_ACCOUNT_ID,
  adAccountDbId: process.env.MCP_AD_ACCOUNT_DB_ID,
  accessToken: process.env.MCP_ACCESS_TOKEN
};

const dangerousPolicy = process.env.MCP_DANGEROUS_POLICY || 'block';
const conversationId = process.env.MCP_CONVERSATION_ID;

// Log to stderr (stdout is reserved for MCP protocol)
const log = (level, msg, data = {}) => {
  const entry = {
    time: new Date().toISOString(),
    level,
    msg,
    ...data
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
};

log('info', 'MCP stdio server starting', {
  hasContext: !!toolContext.userAccountId,
  dangerousPolicy,
  toolCount: allMCPTools.length
});

// Create MCP server
const server = new Server(
  {
    name: 'meta-ads',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Build tool list (convert Zod schemas to JSON Schema)
const toolDefinitions = [];
const toolHandlers = new Map();

for (const mcpTool of allMCPTools) {
  const { name, description, zodSchema, handler } = mcpTool;

  // Skip tools without Zod schema
  if (!zodSchema) {
    log('warn', 'Skipping tool without schema', { name });
    continue;
  }

  // Convert Zod schema to JSON Schema
  let inputSchema;
  try {
    inputSchema = zodToJsonSchema(zodSchema, { target: 'openApi3' });
    // Remove $schema and other metadata that MCP doesn't need
    delete inputSchema.$schema;
  } catch (err) {
    log('warn', 'Failed to convert schema', { name, error: err.message });
    continue;
  }

  // Check if dangerous and blocked
  const dangerous = isDangerousTool(name);

  toolDefinitions.push({
    name,
    description: dangerous && dangerousPolicy === 'block'
      ? `[REQUIRES APPROVAL] ${description}`
      : description,
    inputSchema
  });

  // Store handler with dangerous check
  toolHandlers.set(name, { handler, dangerous });
}

log('info', 'Tools registered', {
  total: toolDefinitions.length,
  dangerous: [...toolHandlers.values()].filter(t => t.dangerous).length
});

// Handle tools/list request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: toolDefinitions };
});

// Handle tools/call request
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();

  log('info', 'Tool call started', { name, argsKeys: Object.keys(args || {}) });

  const toolInfo = toolHandlers.get(name);
  if (!toolInfo) {
    log('error', 'Tool not found', { name });
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Tool not found: ${name}` }) }],
      isError: true
    };
  }

  const { handler, dangerous } = toolInfo;

  // Check dangerous policy
  if (dangerous && dangerousPolicy === 'block') {
    log('info', 'Tool blocked (dangerous)', { name });
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

  try {
    const result = await handler(args, toolContext);
    const latencyMs = Date.now() - startTime;

    log('info', 'Tool call completed', { name, latencyMs, success: true });

    // Format result for MCP
    const text = typeof result === 'string'
      ? result
      : JSON.stringify(result, null, 2);

    return { content: [{ type: 'text', text }] };
  } catch (error) {
    const latencyMs = Date.now() - startTime;

    log('error', 'Tool call failed', { name, latencyMs, error: error.message });

    return {
      content: [{ type: 'text', text: JSON.stringify({ error: error.message, success: false }) }],
      isError: true
    };
  }
});

// Start server with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'MCP stdio server connected');
}

main().catch((error) => {
  log('error', 'MCP stdio server failed', { error: error.message, stack: error.stack });
  process.exit(1);
});
