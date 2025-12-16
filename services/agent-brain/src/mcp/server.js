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

  fastify.log.info('MCP routes registered: POST /mcp, GET /mcp, GET /mcp/health');
}

export default { registerMCPRoutes };
