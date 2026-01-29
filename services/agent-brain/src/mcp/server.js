/**
 * MCP Server Routes
 *
 * Регистрирует HTTP endpoints для MCP протокола в Fastify.
 * Streamable HTTP transport: POST для запросов, GET для SSE.
 *
 * Endpoints:
 * - POST /mcp - JSON-RPC requests от OpenAI
 * - GET /mcp - SSE stream для server-initiated messages
 *
 * Security (Hybrid C):
 * - Rate limiting: 100 req/min per session
 * - Secret header verification (X-MCP-Secret)
 * - Audit logging for tool executions
 */

import { getSession, getSessionAsync, getStoreType } from './sessions.js';
import { handleMCPRequest } from './protocol.js';
import { executeToolWithContext } from './tools/executor.js';
import { getToolByName, allMCPTools } from './tools/definitions.js';
import { supabase } from '../lib/supabase.js';

/**
 * Get access token from database by fb_ad_account_id
 * @param {string} fbAdAccountId - Facebook ad account ID (act_...)
 * @returns {Promise<{accessToken: string|null, dbId: string|null}>}
 */
async function getAccessTokenByFbAccountId(fbAdAccountId) {
  if (!fbAdAccountId) return { accessToken: null, dbId: null };

  try {
    const { data, error } = await supabase
      .from('ad_accounts')
      .select('id, access_token')
      .eq('fb_ad_account_id', fbAdAccountId)
      .single();

    if (error || !data) {
      return { accessToken: null, dbId: null };
    }

    return {
      accessToken: data.access_token,
      dbId: data.id
    };
  } catch (err) {
    return { accessToken: null, dbId: null };
  }
}

// Rate limiting: 100 requests per minute per session
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 100;
const rateLimitStore = new Map();

// MCP Secret (shared between agent-brain and MCP server)
const MCP_SECRET = process.env.MCP_SECRET || null;

/**
 * Simple rate limiter per session
 * @param {string} sessionId
 * @returns {boolean} true if request is allowed
 */
function checkRateLimit(sessionId) {
  if (!sessionId) return true; // Allow requests without session for initialize

  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  let sessionData = rateLimitStore.get(sessionId);
  if (!sessionData) {
    sessionData = { requests: [] };
    rateLimitStore.set(sessionId, sessionData);
  }

  // Remove old requests outside window
  sessionData.requests = sessionData.requests.filter(ts => ts > windowStart);

  // Check limit
  if (sessionData.requests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  // Record this request
  sessionData.requests.push(now);
  return true;
}

// Cleanup rate limit data periodically
setInterval(() => {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  for (const [sessionId, data] of rateLimitStore) {
    data.requests = data.requests.filter(ts => ts > windowStart);
    if (data.requests.length === 0) {
      rateLimitStore.delete(sessionId);
    }
  }
}, 60 * 1000);

/**
 * Register MCP routes in Fastify instance
 * @param {import('fastify').FastifyInstance} fastify
 */
export function registerMCPRoutes(fastify) {
  /**
   * POST /mcp - Handle JSON-RPC requests from OpenAI
   *
   * OpenAI calls this endpoint directly when using MCP tools.
   * Session ID is passed in headers for context injection.
   *
   * Security checks:
   * 1. Secret header verification (if MCP_SECRET is set)
   * 2. Rate limiting per session
   * 3. Audit logging for tool executions
   */
  fastify.post('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'];
    const protocolVersion = request.headers['mcp-protocol-version'];
    const providedSecret = request.headers['x-mcp-secret'];
    const startTime = Date.now();

    // Security: Verify secret header (if configured)
    if (MCP_SECRET && providedSecret !== MCP_SECRET) {
      fastify.log.warn({
        method: 'POST',
        path: '/mcp',
        sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none',
        hasSecret: !!providedSecret
      }, 'MCP request with invalid secret');
      return reply.code(403).send({
        jsonrpc: '2.0',
        id: request.body?.id,
        error: {
          code: -32000,
          message: 'Invalid MCP secret'
        }
      });
    }

    // Security: Rate limit check
    if (!checkRateLimit(sessionId)) {
      fastify.log.warn({
        method: 'POST',
        path: '/mcp',
        sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none'
      }, 'MCP rate limit exceeded');
      return reply.code(429).send({
        jsonrpc: '2.0',
        id: request.body?.id,
        error: {
          code: -32000,
          message: 'Rate limit exceeded (100 req/min)'
        }
      });
    }

    // Log incoming request
    fastify.log.info({
      method: 'POST',
      path: '/mcp',
      sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none',
      protocolVersion,
      jsonrpcMethod: request.body?.method
    }, 'MCP request received');

    // Get user context from session (use async for Redis support)
    const session = await getSessionAsync(sessionId);
    if (!session && request.body?.method !== 'initialize') {
      fastify.log.warn({ sessionId }, 'MCP request with invalid session');
      return reply.code(401).send({
        jsonrpc: '2.0',
        id: request.body?.id,
        error: {
          code: -32000,
          message: 'Invalid or expired session'
        }
      });
    }

    // Handle the MCP request - include sessionId for tool call limit enforcement
    const useRedis = getStoreType() === 'redis';
    const result = await handleMCPRequest(request.body, { ...session, sessionId, useRedis } || { sessionId, useRedis });

    // Audit logging for tool executions
    if (request.body?.method === 'tools/call') {
      const toolName = request.body?.params?.name;
      const duration = Date.now() - startTime;
      const isError = result?.result?.isError;

      fastify.log.info({
        audit: 'tool_execution',
        sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none',
        userAccountId: session?.userAccountId?.substring(0, 8) + '...',
        tool: toolName,
        duration,
        success: !isError,
        approvalRequired: result?.result?.content?.[0]?.text?.includes('approval_required')
      }, `MCP tool executed: ${toolName}`);
    }

    // Null result means notification (no response)
    if (result === null) {
      return reply.code(204).send();
    }

    // Set session header in response
    if (sessionId) {
      reply.header('Mcp-Session-Id', sessionId);
    }

    return result;
  });

  /**
   * GET /mcp - SSE stream for server-initiated messages
   *
   * Used for streaming responses and notifications.
   * Currently just keeps connection open for future use.
   */
  fastify.get('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'];

    fastify.log.info({
      method: 'GET',
      path: '/mcp',
      sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none'
    }, 'MCP SSE connection opened');

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'  // Disable nginx buffering
    });

    // Send initial ping
    reply.raw.write('event: ping\ndata: {}\n\n');

    // Keep connection open
    const keepAlive = setInterval(() => {
      reply.raw.write('event: ping\ndata: {}\n\n');
    }, 30000);

    // Cleanup on close
    request.raw.on('close', () => {
      clearInterval(keepAlive);
      fastify.log.info({ sessionId }, 'MCP SSE connection closed');
    });

    // Don't end the response - keep it open for SSE
    await new Promise(() => {});
  });

  /**
   * Health check for MCP endpoint
   */
  fastify.get('/mcp/health', async (request, reply) => {
    return {
      status: 'ok',
      service: 'mcp-server',
      version: '1.0.0',
      sessionStore: getStoreType(),
      timestamp: new Date().toISOString()
    };
  });

  /**
   * POST /brain/tools/:toolName - Direct tool execution for Moltbot
   *
   * Moltbot skills call this endpoint via curl to execute tools.
   * Context is passed in request body or headers.
   *
   * Security:
   * - Tool name validation (alphanumeric + underscore only)
   * - No tool list exposure on 404
   * - Timeout on execution
   */
  fastify.post('/brain/tools/:toolName', async (request, reply) => {
    const { toolName } = request.params;
    const args = request.body || {};
    const startTime = Date.now();
    const requestId = `tool-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    // Validate tool name format (security: prevent injection)
    if (!toolName || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(toolName)) {
      fastify.log.warn({
        requestId,
        toolName,
        reason: 'invalid_format'
      }, 'Invalid tool name format');

      return reply.code(400).send({
        success: false,
        error: 'invalid_tool_name',
        message: 'Tool name must start with a letter and contain only alphanumeric characters and underscores'
      });
    }

    // Extract context from body or use defaults
    const {
      adAccountId,
      userAccountId,
      accessToken: providedAccessToken,
      dangerousPolicy = 'allow', // Moltbot manages its own approval flow
      ...toolArgs
    } = args;

    // If accessToken not provided, try to get it from database by adAccountId
    let accessToken = providedAccessToken;
    let adAccountDbId = null;

    if (!accessToken && adAccountId) {
      const dbResult = await getAccessTokenByFbAccountId(adAccountId);
      accessToken = dbResult.accessToken;
      adAccountDbId = dbResult.dbId;
    }

    fastify.log.info({
      requestId,
      endpoint: '/brain/tools/:toolName',
      toolName,
      hasAdAccountId: !!adAccountId,
      hasUserAccountId: !!userAccountId,
      hasAccessToken: !!accessToken,
      tokenSource: providedAccessToken ? 'request' : (accessToken ? 'database' : 'none'),
      argKeys: Object.keys(toolArgs)
    }, 'Moltbot tool call received');

    // Check if tool exists (don't expose tool list on 404)
    const tool = getToolByName(toolName);
    if (!tool) {
      fastify.log.warn({
        requestId,
        toolName
      }, 'Tool not found');

      return reply.code(404).send({
        success: false,
        error: 'tool_not_found',
        message: `Tool "${toolName}" not found`
        // Security: Don't expose availableTools list
      });
    }

    try {
      // Build context for tool execution
      const context = {
        adAccountId,
        adAccountDbId,  // UUID from database for internal queries
        userAccountId,
        accessToken,
        dangerousPolicy,
        // No session limits for Moltbot direct calls
        sessionId: null,
        useRedis: false
      };

      // Execute the tool with timeout (2 minutes)
      const TOOL_TIMEOUT = 120000;
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Tool execution timeout after ${TOOL_TIMEOUT}ms`)), TOOL_TIMEOUT);
      });

      const result = await Promise.race([
        executeToolWithContext(toolName, toolArgs, context),
        timeoutPromise
      ]);

      const duration = Date.now() - startTime;

      fastify.log.info({
        requestId,
        toolName,
        duration,
        success: result?.success !== false,
        resultType: typeof result
      }, 'Moltbot tool executed successfully');

      return {
        success: true,
        toolName,
        duration,
        requestId,
        result
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const isTimeout = error.message.includes('timeout');

      fastify.log.error({
        requestId,
        toolName,
        duration,
        error: error.message,
        isTimeout,
        stack: error.stack?.split('\n').slice(0, 3).join('\n')
      }, 'Moltbot tool execution failed');

      return reply.code(isTimeout ? 504 : 500).send({
        success: false,
        error: isTimeout ? 'timeout' : 'execution_error',
        message: error.message,
        toolName,
        duration,
        requestId
      });
    }
  });

  /**
   * GET /brain/tools - List available tools for Moltbot
   */
  fastify.get('/brain/tools', async (request, reply) => {
    const { category, search } = request.query;

    let tools = allMCPTools.map(t => ({
      name: t.name,
      description: t.description,
      agent: t.agent,
      inputSchema: t.inputSchema
    }));

    // Filter by category/agent if provided
    if (category) {
      tools = tools.filter(t => t.agent === category);
    }

    // Search by name/description if provided
    if (search) {
      const searchLower = search.toLowerCase();
      tools = tools.filter(t =>
        t.name.toLowerCase().includes(searchLower) ||
        t.description?.toLowerCase().includes(searchLower)
      );
    }

    fastify.log.info({
      totalTools: allMCPTools.length,
      filteredTools: tools.length,
      category,
      search
    }, 'Tools list requested');

    return {
      count: tools.length,
      totalAvailable: allMCPTools.length,
      tools
    };
  });

  /**
   * GET /brain/health - Health check for Moltbot integration
   */
  fastify.get('/brain/health', async (request, reply) => {
    const { checkHealth } = await import('../moltbot/orchestrator.js');

    const moltbotHealth = await checkHealth();

    fastify.log.info({
      moltbotStatus: moltbotHealth.status,
      toolsCount: allMCPTools.length
    }, 'Brain health check');

    const isHealthy = moltbotHealth.status === 'healthy';

    return reply.code(isHealthy ? 200 : 503).send({
      status: isHealthy ? 'ok' : 'degraded',
      service: 'agent-brain',
      moltbot: moltbotHealth,
      tools: {
        count: allMCPTools.length,
        categories: [...new Set(allMCPTools.map(t => t.agent))].filter(Boolean)
      },
      timestamp: new Date().toISOString()
    });
  });

  fastify.log.info('MCP routes registered: POST /mcp, GET /mcp, GET /mcp/health, POST /brain/tools/:toolName, GET /brain/tools, GET /brain/health');
}

export default { registerMCPRoutes };
