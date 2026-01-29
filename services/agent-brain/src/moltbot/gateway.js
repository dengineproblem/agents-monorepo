/**
 * Moltbot Gateway WebSocket Client
 *
 * Подключается к Moltbot Gateway для отправки сообщений агенту
 * и получения streaming ответов.
 *
 * Gateway Protocol (v3):
 * - Custom frame format: { type: "req", id, method, params }
 * - Response format: { ok: true/false, id, payload/error }
 * - Event format: { type: "event", event, seq, ... }
 *
 * Improvements:
 * - Connection timeout
 * - Proper cleanup on close
 * - Heartbeat ping/pong
 * - WebSocket ready state checks
 */

import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { logger } from '../lib/logger.js';

const log = logger.child({ module: 'moltbot-gateway' });

// Connection settings
const DEFAULT_CONNECT_TIMEOUT = 10000; // 10 seconds
const DEFAULT_RPC_TIMEOUT = 120000; // 2 minutes
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const PROTOCOL_VERSION = 3; // Moltbot Gateway Protocol v3

/**
 * Moltbot Gateway Client
 */
export class MoltbotGateway {
  constructor(options = {}) {
    this.url = options.url || process.env.MOLTBOT_GATEWAY_URL || 'ws://moltbot:18789';
    this.token = options.token || process.env.MOLTBOT_TOKEN;
    this.connectTimeout = options.connectTimeout || DEFAULT_CONNECT_TIMEOUT;
    this.ws = null;
    this.connected = false;
    this.closed = false; // Explicit close flag
    this.callbacks = new Map();
    this.messageHandlers = new Set();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 3;
    this.reconnectDelay = options.reconnectDelay || 1000;
    this.heartbeatTimer = null;
    this.connectionId = randomUUID().substring(0, 8);

    log.debug({
      connectionId: this.connectionId,
      url: this.url,
      hasToken: !!this.token
    }, 'MoltbotGateway instance created');
  }

  /**
   * Connect to Moltbot Gateway with timeout
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.connected) {
      log.debug({ connectionId: this.connectionId }, 'Already connected');
      return;
    }

    if (this.closed) {
      throw new Error('Gateway was explicitly closed');
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      log.info({
        connectionId: this.connectionId,
        url: this.url,
        timeout: this.connectTimeout
      }, 'Connecting to Moltbot Gateway...');

      // Connection timeout
      const connectTimer = setTimeout(() => {
        if (this.ws) {
          this.ws.terminate();
          this.ws = null;
        }
        const error = new Error(`Connection timeout after ${this.connectTimeout}ms`);
        log.error({
          connectionId: this.connectionId,
          url: this.url,
          timeout: this.connectTimeout
        }, error.message);
        reject(error);
      }, this.connectTimeout);

      // Build URL with token (don't log the token)
      const wsUrl = this.token
        ? `${this.url}?token=${this.token}`
        : this.url;

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (error) {
        clearTimeout(connectTimer);
        log.error({
          connectionId: this.connectionId,
          error: error.message
        }, 'Failed to create WebSocket');
        reject(error);
        return;
      }

      this.ws.on('open', async () => {
        clearTimeout(connectTimer);
        const duration = Date.now() - startTime;

        log.info({
          connectionId: this.connectionId,
          url: this.url,
          duration
        }, 'WebSocket connected, sending handshake...');

        // Send connect handshake in Moltbot Gateway Protocol v3 format
        try {
          const connectId = randomUUID();
          const connectFrame = {
            type: 'req',
            id: connectId,
            method: 'connect',
            params: {
              minProtocol: PROTOCOL_VERSION,
              maxProtocol: PROTOCOL_VERSION,
              client: {
                id: 'gateway-client', // Must be one of GATEWAY_CLIENT_IDS
                displayName: 'Agent Brain MCP Client',
                version: '1.0.0',
                platform: 'linux',
                mode: 'backend'
              },
              caps: [],
              auth: this.token ? { token: this.token } : undefined,
              role: 'operator',
              scopes: ['operator.admin']
            }
          };

          log.debug({
            connectionId: this.connectionId,
            connectId,
            hasToken: !!this.token
          }, 'Sending connect handshake (Protocol v3)');

          // Store callback for connect response
          this.callbacks.set(connectId, (response) => {
            if (response.ok) {
              this.connected = true;
              this.reconnectAttempts = 0;
              this._startHeartbeat();

              log.info({
                connectionId: this.connectionId,
                url: this.url,
                duration,
                policy: response.payload?.policy
              }, 'Connected to Moltbot Gateway (handshake OK)');

              resolve();
            } else {
              const error = new Error(response.error?.message || 'Connect handshake failed');
              log.error({
                connectionId: this.connectionId,
                error: response.error
              }, 'Connect handshake rejected');
              reject(error);
            }
          });

          this.ws.send(JSON.stringify(connectFrame));
        } catch (handshakeError) {
          log.error({
            connectionId: this.connectionId,
            error: handshakeError.message
          }, 'Handshake failed');
          reject(handshakeError);
        }
      });

      this.ws.on('error', (error) => {
        log.error({
          connectionId: this.connectionId,
          error: error.message,
          code: error.code
        }, 'Moltbot Gateway connection error');

        if (!this.connected) {
          clearTimeout(connectTimer);
          reject(error);
        }
      });

      this.ws.on('close', (code, reason) => {
        log.info({
          connectionId: this.connectionId,
          code,
          reason: reason?.toString()
        }, 'Moltbot Gateway connection closed');

        this._stopHeartbeat();
        this.connected = false;

        // Only reconnect if not explicitly closed
        if (!this.closed) {
          this._handleReconnect();
        }
      });

      this.ws.on('message', (data) => {
        this._handleMessage(data);
      });

      this.ws.on('pong', () => {
        log.debug({ connectionId: this.connectionId }, 'Received pong');
      });
    });
  }

  /**
   * Start heartbeat ping
   */
  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        log.debug({ connectionId: this.connectionId }, 'Sending ping');
        this.ws.ping();
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * Stop heartbeat ping
   */
  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Handle incoming WebSocket message
   * Moltbot Gateway Protocol v3:
   * - Response: { id, ok: true/false, payload/error }
   * - Event: { type: "event", event: "...", seq, ... }
   * @param {Buffer} data - Raw message data
   */
  _handleMessage(data) {
    const dataStr = data.toString();

    try {
      const message = JSON.parse(dataStr);

      log.debug({
        connectionId: this.connectionId,
        type: message.type,
        hasId: !!message.id,
        event: message.event,
        ok: message.ok,
        dataLength: dataStr.length
      }, 'Received message from Moltbot');

      // Handle response frame (has id and ok field)
      if (message.id && typeof message.ok === 'boolean') {
        if (this.callbacks.has(message.id)) {
          const callback = this.callbacks.get(message.id);
          this.callbacks.delete(message.id);
          callback(message);
        }
        return;
      }

      // Handle event frame (type: "event")
      if (message.type === 'event') {
        log.debug({
          connectionId: this.connectionId,
          event: message.event,
          seq: message.seq,
          handlersCount: this.messageHandlers.size
        }, 'Broadcasting event to handlers');

        for (const handler of this.messageHandlers) {
          try {
            handler(message);
          } catch (handlerError) {
            log.error({
              connectionId: this.connectionId,
              error: handlerError.message
            }, 'Message handler error');
          }
        }
      }
    } catch (error) {
      log.error({
        connectionId: this.connectionId,
        error: error.message,
        dataPreview: dataStr.substring(0, 200)
      }, 'Failed to parse Moltbot message');
    }
  }

  /**
   * Handle reconnection (only if not explicitly closed)
   */
  _handleReconnect() {
    if (this.closed) {
      log.debug({ connectionId: this.connectionId }, 'Skipping reconnect - gateway closed');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.error({
        connectionId: this.connectionId,
        attempts: this.reconnectAttempts
      }, 'Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff

    log.info({
      connectionId: this.connectionId,
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      delay
    }, 'Scheduling reconnection...');

    setTimeout(() => {
      if (!this.closed) {
        this.connect().catch((error) => {
          log.error({
            connectionId: this.connectionId,
            error: error.message
          }, 'Reconnection failed');
        });
      }
    }, delay);
  }

  /**
   * Check if WebSocket is ready for sending
   * @returns {boolean}
   */
  isReady() {
    return this.ws && this.ws.readyState === WebSocket.OPEN && this.connected;
  }

  /**
   * Send request and wait for response (Moltbot Gateway Protocol v3)
   * Request format: { type: "req", id, method, params }
   * Response format: { id, ok: true/false, payload/error }
   * @param {string} method - Method name
   * @param {Object} params - Method parameters
   * @param {number} timeout - Timeout in ms
   * @returns {Promise<Object>} Response payload
   */
  async rpc(method, params = {}, timeout = DEFAULT_RPC_TIMEOUT) {
    if (!this.isReady()) {
      log.info({ connectionId: this.connectionId, method }, 'WebSocket not ready, connecting...');
      await this.connect();
    }

    // Double-check after connect
    if (!this.isReady()) {
      throw new Error('WebSocket not ready after connect attempt');
    }

    const id = randomUUID();
    const startTime = Date.now();

    log.info({
      connectionId: this.connectionId,
      method,
      rpcId: id,
      timeout
    }, 'Sending request');

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.callbacks.delete(id);
        const error = new Error(`RPC timeout after ${timeout}ms: ${method}`);
        log.error({
          connectionId: this.connectionId,
          method,
          rpcId: id,
          timeout
        }, error.message);
        reject(error);
      }, timeout);

      this.callbacks.set(id, (response) => {
        clearTimeout(timer);
        const duration = Date.now() - startTime;

        if (!response.ok) {
          log.error({
            connectionId: this.connectionId,
            method,
            rpcId: id,
            duration,
            error: response.error
          }, 'Request error response');
          reject(new Error(response.error?.message || 'Request failed'));
        } else {
          log.info({
            connectionId: this.connectionId,
            method,
            rpcId: id,
            duration
          }, 'Request success');
          resolve(response.payload);
        }
      });

      // Moltbot Gateway Protocol v3 request frame
      const request = {
        type: 'req',
        id,
        method,
        params
      };

      try {
        this.ws.send(JSON.stringify(request));
      } catch (sendError) {
        clearTimeout(timer);
        this.callbacks.delete(id);
        log.error({
          connectionId: this.connectionId,
          method,
          rpcId: id,
          error: sendError.message
        }, 'Failed to send request');
        reject(sendError);
      }
    });
  }

  /**
   * Send chat message to Moltbot agent
   * Uses chat.send method from Gateway Protocol v3
   * @param {string} message - User message
   * @param {string} sessionKey - Session key for context (required)
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Response with runId
   */
  async sendMessage(message, sessionKey, options = {}) {
    if (!sessionKey) {
      sessionKey = `session-${randomUUID().substring(0, 8)}`;
    }

    const idempotencyKey = options.idempotencyKey || `msg-${Date.now()}-${randomUUID().substring(0, 8)}`;

    log.info({
      connectionId: this.connectionId,
      sessionKey,
      idempotencyKey,
      messageLength: message?.length
    }, 'Sending chat message to Moltbot');

    const params = {
      sessionKey,
      message,
      idempotencyKey,
      timeoutMs: options.timeoutMs || 120000,
      deliver: options.deliver !== false, // Default true
      ...(options.attachments && { attachments: options.attachments }),
      ...(options.thinking && { thinking: options.thinking })
    };

    return this.rpc('chat.send', params);
  }

  /**
   * Subscribe to agent events
   * @param {Function} callback - Handler for events
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    this.messageHandlers.add(callback);

    log.debug({
      connectionId: this.connectionId,
      handlersCount: this.messageHandlers.size
    }, 'Added event handler');

    return () => {
      this.messageHandlers.delete(callback);
      log.debug({
        connectionId: this.connectionId,
        handlersCount: this.messageHandlers.size
      }, 'Removed event handler');
    };
  }

  /**
   * List sessions
   * @param {Object} options - List options
   * @returns {Promise<Object>} Sessions list
   */
  async listSessions(options = {}) {
    log.info({ connectionId: this.connectionId }, 'Listing sessions');
    return this.rpc('sessions.list', {
      limit: options.limit || 50,
      includeGlobal: options.includeGlobal || false,
      includeDerivedTitles: options.includeDerivedTitles || false,
      ...options
    });
  }

  /**
   * Get chat history for session
   * @param {string} sessionKey - Session key
   * @param {number} limit - Max messages to return
   * @returns {Promise<Object>} Chat history
   */
  async getHistory(sessionKey, limit = 50) {
    log.info({ connectionId: this.connectionId, sessionKey, limit }, 'Getting chat history');
    return this.rpc('chat.history', { sessionKey, limit });
  }

  /**
   * Close connection permanently
   */
  close() {
    log.info({ connectionId: this.connectionId }, 'Closing gateway connection');

    this.closed = true; // Prevent reconnect
    this._stopHeartbeat();

    if (this.ws) {
      try {
        this.ws.close(1000, 'Client closing');
      } catch (error) {
        log.warn({
          connectionId: this.connectionId,
          error: error.message
        }, 'Error closing WebSocket');
      }
      this.ws = null;
    }

    this.connected = false;

    // Clear all pending callbacks with error
    for (const [id, callback] of this.callbacks) {
      try {
        callback({ error: { message: 'Connection closed' } });
      } catch (e) {
        // Ignore
      }
    }
    this.callbacks.clear();
    this.messageHandlers.clear();

    log.info({ connectionId: this.connectionId }, 'Gateway connection closed');
  }
}

// Connection pool for reuse
const connectionPool = new Map();
const POOL_CLEANUP_INTERVAL = 60000; // 1 minute
const CONNECTION_MAX_AGE = 300000; // 5 minutes

/**
 * Get or create gateway instance for a session
 * Reuses connections when possible
 * @param {string} sessionId - Session ID for pooling
 * @returns {MoltbotGateway}
 */
export function getGateway(sessionId = 'default') {
  const existing = connectionPool.get(sessionId);

  if (existing && existing.gateway.isReady()) {
    existing.lastUsed = Date.now();
    log.debug({ sessionId, connectionId: existing.gateway.connectionId }, 'Reusing pooled connection');
    return existing.gateway;
  }

  // Create new connection
  const gateway = new MoltbotGateway();
  connectionPool.set(sessionId, {
    gateway,
    lastUsed: Date.now(),
    created: Date.now()
  });

  log.info({ sessionId, connectionId: gateway.connectionId }, 'Created new pooled connection');
  return gateway;
}

/**
 * Cleanup old connections from pool
 */
function cleanupPool() {
  const now = Date.now();
  for (const [sessionId, entry] of connectionPool) {
    if (now - entry.lastUsed > CONNECTION_MAX_AGE || now - entry.created > CONNECTION_MAX_AGE * 2) {
      log.info({ sessionId, connectionId: entry.gateway.connectionId }, 'Cleaning up old connection');
      entry.gateway.close();
      connectionPool.delete(sessionId);
    }
  }
}

// Periodic cleanup
setInterval(cleanupPool, POOL_CLEANUP_INTERVAL);

export default MoltbotGateway;
