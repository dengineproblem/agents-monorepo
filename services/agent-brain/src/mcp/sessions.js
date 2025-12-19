/**
 * MCP Session Management
 *
 * Решает проблему: OpenAI вызывает MCP server напрямую, не зная userAccountId/adAccountId.
 * Решение: создаём сессию с контекстом пользователя перед вызовом OpenAI,
 * передаём sessionId в заголовках MCP запросов.
 *
 * Phase 3: Redis support with in-memory fallback
 * - REDIS_URL env variable enables Redis storage
 * - Falls back to in-memory Map if Redis unavailable
 *
 * Extended (Hybrid C):
 * - allowedDomains: список доменов от classifier (ads, creative, crm, whatsapp)
 * - allowedTools: список конкретных tool names для фильтрации
 * - mode: auto | plan | ask - режим работы агента
 * - dangerousPolicy: block | allow - политика для dangerous tools
 * - integrations: доступные интеграции пользователя
 */

import crypto from 'crypto';
import { logger } from '../lib/logger.js';

// Session TTL: 15 минут (уменьшено для безопасности)
const SESSION_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

// Redis key prefix
const REDIS_PREFIX = 'mcp:session:';

// Session store abstraction
let store = null;
let storeType = 'memory';

/**
 * In-memory session store (fallback)
 */
class MemoryStore {
  constructor() {
    this.sessions = new Map();

    // Cleanup expired sessions every 5 minutes
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, session] of this.sessions) {
        if (now > session.expiresAt) {
          this.sessions.delete(id);
        }
      }
    }, 5 * 60 * 1000);

    this.cleanupInterval.unref?.();
  }

  async set(sessionId, data, ttlMs) {
    this.sessions.set(sessionId, {
      ...data,
      expiresAt: Date.now() + ttlMs
    });
  }

  async get(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  async delete(sessionId) {
    this.sessions.delete(sessionId);
  }

  async extend(sessionId, ttlMs) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.expiresAt = Date.now() + ttlMs;
    session.lastAccessedAt = Date.now();
    return true;
  }

  async stats() {
    const now = Date.now();
    let active = 0;
    let expired = 0;

    for (const [id, session] of this.sessions) {
      if (now > session.expiresAt) {
        expired++;
      } else {
        active++;
      }
    }

    return { active, expired, total: this.sessions.size, storeType: 'memory' };
  }
}

/**
 * Redis session store
 */
class RedisStore {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  async set(sessionId, data, ttlMs) {
    const key = REDIS_PREFIX + sessionId;
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    await this.redis.setex(key, ttlSeconds, JSON.stringify({
      ...data,
      createdAt: Date.now(),
      lastAccessedAt: Date.now()
    }));
  }

  async get(sessionId) {
    const key = REDIS_PREFIX + sessionId;
    const data = await this.redis.get(key);

    if (!data) return null;

    try {
      const session = JSON.parse(data);
      // Update last accessed time
      session.lastAccessedAt = Date.now();
      return session;
    } catch (e) {
      return null;
    }
  }

  async delete(sessionId) {
    const key = REDIS_PREFIX + sessionId;
    await this.redis.del(key);
  }

  async extend(sessionId, ttlMs) {
    const key = REDIS_PREFIX + sessionId;
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    const exists = await this.redis.expire(key, ttlSeconds);
    if (exists) {
      // Update last accessed time
      const data = await this.redis.get(key);
      if (data) {
        const session = JSON.parse(data);
        session.lastAccessedAt = Date.now();
        await this.redis.setex(key, ttlSeconds, JSON.stringify(session));
      }
    }
    return exists === 1;
  }

  async stats() {
    // Get all session keys
    const keys = await this.redis.keys(REDIS_PREFIX + '*');
    return {
      active: keys.length,
      expired: 0, // Redis handles expiration automatically
      total: keys.length,
      storeType: 'redis'
    };
  }
}

/**
 * Initialize session store
 * Uses Redis if REDIS_URL is set, otherwise falls back to in-memory
 */
async function initStore() {
  if (store) return store;

  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    try {
      // Dynamic import to avoid requiring ioredis if not used
      const Redis = (await import('ioredis')).default;
      const redisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        lazyConnect: true
      });

      await redisClient.connect();

      store = new RedisStore(redisClient);
      storeType = 'redis';
      logger.info({ redisUrl: redisUrl.replace(/\/\/.*@/, '//**@') }, 'MCP sessions using Redis');

    } catch (error) {
      logger.warn({ error: error.message }, 'Redis connection failed, falling back to in-memory sessions');
      store = new MemoryStore();
      storeType = 'memory';
    }
  } else {
    store = new MemoryStore();
    storeType = 'memory';
    logger.info('MCP sessions using in-memory store (set REDIS_URL for Redis)');
  }

  return store;
}

// Initialize store on module load
const storePromise = initStore();

/**
 * Get initialized store (await on first call)
 */
async function getStore() {
  return storePromise;
}

/**
 * Создать новую сессию с контекстом пользователя
 * @param {Object} context - User context
 * @param {string} context.userAccountId - User account ID (UUID)
 * @param {string} context.adAccountId - Facebook Ad Account ID
 * @param {string} context.accessToken - Facebook Access Token
 * @param {string} [context.conversationId] - Current conversation ID
 * @param {string[]} [context.allowedDomains] - Allowed domains from classifier (ads, creative, crm, whatsapp)
 * @param {string[]} [context.allowedTools] - Specific tool names allowed for this session
 * @param {string} [context.mode='auto'] - Agent mode: auto | plan | ask
 * @param {string} [context.dangerousPolicy='block'] - Policy for dangerous tools: block | allow
 * @param {Object} [context.integrations] - Available integrations for user
 * @param {Object} [context.clarifyingState] - Clarifying Gate state
 * @param {Object} [context.policyMetadata] - Policy metadata (playbookId, intent, etc.)
 * @param {Object} [context.tierState] - Tier state from PlaybookRegistry
 * @returns {string} Session ID
 */
export function createSession({
  userAccountId,
  adAccountId,
  accessToken,
  conversationId,
  // Hybrid C extensions
  allowedDomains = null,
  allowedTools = null,
  mode = 'auto',
  dangerousPolicy = 'block',
  integrations = null,
  // Clarifying Gate state
  clarifyingState = null,
  // Policy metadata
  policyMetadata = null,
  // Tier state for PlaybookRegistry
  tierState = null
}) {
  const sessionId = crypto.randomUUID();

  const sessionData = {
    // Core context
    userAccountId,
    adAccountId,
    accessToken,
    conversationId,
    // Hybrid C extensions
    allowedDomains,      // ['ads'] | ['ads', 'creative'] | null (all)
    allowedTools,        // ['getCampaigns', 'getSpendReport'] | null (all)
    mode,                // 'auto' | 'plan' | 'ask'
    dangerousPolicy,     // 'block' | 'allow'
    integrations,        // { fb: true, crm: true, roi: true, whatsapp: false }
    // Clarifying Gate state
    clarifyingState,     // { required, questions, answers, complete }
    // Policy metadata
    policyMetadata,      // { playbookId, intent, maxToolCalls, toolCallCount }
    // Tier state for PlaybookRegistry
    tierState            // { playbookId, currentTier, completedTiers, snapshotData, pendingNextStep }
  };

  // Fire and forget - session creation is sync for API compatibility
  getStore().then(s => s.set(sessionId, sessionData, SESSION_TTL_MS));

  return sessionId;
}

/**
 * Получить сессию по ID
 * @param {string} sessionId
 * @returns {Object|null} Session data or null if expired/not found
 */
export function getSession(sessionId) {
  if (!sessionId) return null;

  // For sync compatibility, we need to handle this carefully
  // In practice, the store is initialized before first getSession call
  const s = store;
  if (!s) return null;

  // For in-memory store, we can return synchronously
  if (storeType === 'memory') {
    const session = s.sessions.get(sessionId);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      s.sessions.delete(sessionId);
      return null;
    }

    session.lastAccessedAt = Date.now();

    return {
      userAccountId: session.userAccountId,
      adAccountId: session.adAccountId,
      accessToken: session.accessToken,
      conversationId: session.conversationId,
      allowedDomains: session.allowedDomains,
      allowedTools: session.allowedTools,
      mode: session.mode,
      dangerousPolicy: session.dangerousPolicy,
      integrations: session.integrations,
      clarifyingState: session.clarifyingState,
      policyMetadata: session.policyMetadata,
      tierState: session.tierState
    };
  }

  // For Redis, we need async - but maintain sync API for compatibility
  // This returns null for Redis until we migrate callers to async
  logger.warn('getSession called synchronously with Redis store - use getSessionAsync instead');
  return null;
}

/**
 * Async version of getSession for Redis support
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function getSessionAsync(sessionId) {
  if (!sessionId) return null;

  const s = await getStore();
  const session = await s.get(sessionId);

  if (!session) return null;

  return {
    userAccountId: session.userAccountId,
    adAccountId: session.adAccountId,
    accessToken: session.accessToken,
    conversationId: session.conversationId,
    allowedDomains: session.allowedDomains,
    allowedTools: session.allowedTools,
    mode: session.mode,
    dangerousPolicy: session.dangerousPolicy,
    integrations: session.integrations,
    clarifyingState: session.clarifyingState,
    policyMetadata: session.policyMetadata,
    tierState: session.tierState
  };
}

/**
 * Обновить clarifyingState в сессии
 * @param {string} sessionId
 * @param {Object} clarifyingState
 */
export function updateClarifyingState(sessionId, clarifyingState) {
  const s = store;
  if (!s || storeType !== 'memory') return false;

  const session = s.sessions.get(sessionId);
  if (!session) return false;

  session.clarifyingState = clarifyingState;
  session.lastAccessedAt = Date.now();

  return true;
}

/**
 * Async version of updateClarifyingState
 */
export async function updateClarifyingStateAsync(sessionId, clarifyingState) {
  const s = await getStore();
  const session = await s.get(sessionId);
  if (!session) return false;

  session.clarifyingState = clarifyingState;
  await s.set(sessionId, session, SESSION_TTL_MS);
  return true;
}

/**
 * Обновить tierState в сессии
 * @param {string} sessionId
 * @param {Object} tierState
 */
export function updateTierState(sessionId, tierState) {
  const s = store;
  if (!s || storeType !== 'memory') return false;

  const session = s.sessions.get(sessionId);
  if (!session) return false;

  session.tierState = tierState;
  session.lastAccessedAt = Date.now();

  return true;
}

/**
 * Async version of updateTierState
 */
export async function updateTierStateAsync(sessionId, tierState) {
  const s = await getStore();
  const session = await s.get(sessionId);
  if (!session) return false;

  session.tierState = tierState;
  await s.set(sessionId, session, SESSION_TTL_MS);
  return true;
}

/**
 * Get tierState from session
 * @param {string} sessionId
 * @returns {Object|null}
 */
export function getTierState(sessionId) {
  const session = getSession(sessionId);
  if (!session) return null;
  return session.tierState || null;
}

/**
 * Async version of getTierState
 */
export async function getTierStateAsync(sessionId) {
  const session = await getSessionAsync(sessionId);
  if (!session) return null;
  return session.tierState || null;
}

// ============================================================
// TOOL CALL LIMIT ENFORCEMENT
// ============================================================

/**
 * Increment tool call counter and check limit
 * @param {string} sessionId
 * @returns {{allowed: boolean, used: number, max: number}}
 */
export function incrementToolCalls(sessionId) {
  const s = store;
  if (!s || storeType !== 'memory') {
    return { allowed: true, used: 0, max: 0 };
  }

  const session = s.sessions.get(sessionId);
  if (!session) {
    return { allowed: false, used: 0, max: 0, error: 'session_not_found' };
  }

  // Get max from policyMetadata or default to 20 (enough for complex queries)
  const maxToolCalls = session.policyMetadata?.maxToolCalls || 20;

  // Initialize counter if not exists
  if (!session.policyMetadata) {
    session.policyMetadata = { toolCallCount: 0, maxToolCalls };
  }

  // Increment counter
  session.policyMetadata.toolCallCount = (session.policyMetadata.toolCallCount || 0) + 1;
  const used = session.policyMetadata.toolCallCount;

  logger.debug({
    sessionId: sessionId.substring(0, 8),
    used,
    max: maxToolCalls
  }, 'Tool call incremented');

  return {
    allowed: used <= maxToolCalls,
    used,
    max: maxToolCalls
  };
}

/**
 * Async version for Redis
 * @param {string} sessionId
 * @returns {Promise<{allowed: boolean, used: number, max: number}>}
 */
export async function incrementToolCallsAsync(sessionId) {
  const s = await getStore();
  const session = await s.get(sessionId);

  if (!session) {
    return { allowed: false, used: 0, max: 0, error: 'session_not_found' };
  }

  const maxToolCalls = session.policyMetadata?.maxToolCalls || 20;

  // Initialize or increment counter
  if (!session.policyMetadata) {
    session.policyMetadata = { toolCallCount: 0, maxToolCalls };
  }

  session.policyMetadata.toolCallCount = (session.policyMetadata.toolCallCount || 0) + 1;
  const used = session.policyMetadata.toolCallCount;

  // Save updated session
  await s.set(sessionId, session, SESSION_TTL_MS);

  logger.debug({
    sessionId: sessionId.substring(0, 8),
    used,
    max: maxToolCalls
  }, 'Tool call incremented (async)');

  return {
    allowed: used <= maxToolCalls,
    used,
    max: maxToolCalls
  };
}

/**
 * Get current tool call stats without incrementing
 * @param {string} sessionId
 * @returns {{used: number, max: number}}
 */
export function getToolCallStats(sessionId) {
  const s = store;
  if (!s || storeType !== 'memory') {
    return { used: 0, max: 0 };
  }

  const session = s.sessions.get(sessionId);
  if (!session) {
    return { used: 0, max: 0 };
  }

  return {
    used: session.policyMetadata?.toolCallCount || 0,
    max: session.policyMetadata?.maxToolCalls || 20
  };
}

/**
 * Async version of getToolCallStats
 */
export async function getToolCallStatsAsync(sessionId) {
  const s = await getStore();
  const session = await s.get(sessionId);

  if (!session) {
    return { used: 0, max: 0 };
  }

  return {
    used: session.policyMetadata?.toolCallCount || 0,
    max: session.policyMetadata?.maxToolCalls || 20
  };
}

/**
 * Проверить, разрешён ли tool для сессии
 * @param {string} sessionId
 * @param {string} toolName
 * @returns {boolean}
 */
export function isToolAllowed(sessionId, toolName) {
  const session = getSession(sessionId);
  if (!session) return false;

  // If allowedTools not specified, all tools are allowed
  if (!session.allowedTools) return true;

  return session.allowedTools.includes(toolName);
}

/**
 * Async version for Redis
 */
export async function isToolAllowedAsync(sessionId, toolName) {
  const session = await getSessionAsync(sessionId);
  if (!session) return false;
  if (!session.allowedTools) return true;
  return session.allowedTools.includes(toolName);
}

/**
 * Проверить, требуется ли approval для dangerous tool
 * @param {string} sessionId
 * @returns {boolean}
 */
export function requiresApproval(sessionId) {
  const session = getSession(sessionId);
  if (!session) return true; // Default to requiring approval

  return session.dangerousPolicy === 'block';
}

/**
 * Удалить сессию
 * @param {string} sessionId
 */
export function deleteSession(sessionId) {
  getStore().then(s => s.delete(sessionId));
}

/**
 * Продлить сессию
 * @param {string} sessionId
 * @returns {boolean} true if session exists and was extended
 */
export function extendSession(sessionId) {
  // For sync compatibility with in-memory
  const s = store;
  if (!s || storeType !== 'memory') return false;

  const session = s.sessions.get(sessionId);
  if (!session) return false;

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  session.lastAccessedAt = Date.now();

  return true;
}

/**
 * Async version of extendSession
 */
export async function extendSessionAsync(sessionId) {
  const s = await getStore();
  return s.extend(sessionId, SESSION_TTL_MS);
}

/**
 * Получить статистику сессий (для мониторинга)
 */
export function getSessionStats() {
  // Sync version for in-memory only
  const s = store;
  if (!s || storeType !== 'memory') {
    return { active: 0, expired: 0, total: 0, storeType };
  }

  const now = Date.now();
  let active = 0;
  let expired = 0;

  for (const [id, session] of s.sessions) {
    if (now > session.expiresAt) {
      expired++;
    } else {
      active++;
    }
  }

  return { active, expired, total: s.sessions.size, storeType: 'memory' };
}

/**
 * Async version of getSessionStats
 */
export async function getSessionStatsAsync() {
  const s = await getStore();
  return s.stats();
}

/**
 * Get current store type
 */
export function getStoreType() {
  return storeType;
}

export default {
  createSession,
  getSession,
  getSessionAsync,
  deleteSession,
  extendSession,
  extendSessionAsync,
  getSessionStats,
  getSessionStatsAsync,
  getStoreType,
  // Hybrid C helpers
  isToolAllowed,
  isToolAllowedAsync,
  requiresApproval,
  // Clarifying Gate helpers
  updateClarifyingState,
  updateClarifyingStateAsync,
  // Tier state helpers
  updateTierState,
  updateTierStateAsync,
  getTierState,
  getTierStateAsync
};
