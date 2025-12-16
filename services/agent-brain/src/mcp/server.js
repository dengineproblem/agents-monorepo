/**
 * MCP Server Routes
 *
 * Регистрирует HTTP endpoints для MCP протокола в Fastify.
 * Streamable HTTP transport: POST для запросов, GET для SSE.
 *
 * Endpoints:
 * - POST /mcp - JSON-RPC requests от OpenAI
 * - GET /mcp - SSE stream для server-initiated messages
 */

import { getSession } from './sessions.js';
import { handleMCPRequest } from './protocol.js';

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
   */
  fastify.post('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'];
    const protocolVersion = request.headers['mcp-protocol-version'];

    // Log incoming request
    fastify.log.info({
      method: 'POST',
      path: '/mcp',
      sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none',
      protocolVersion,
      jsonrpcMethod: request.body?.method
    }, 'MCP request received');

    // Get user context from session
    const session = getSession(sessionId);
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

    // Handle the MCP request
    const result = await handleMCPRequest(request.body, session || {});

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
      timestamp: new Date().toISOString()
    };
  });

  fastify.log.info('MCP routes registered: POST /mcp, GET /mcp, GET /mcp/health');
}

export default { registerMCPRoutes };
