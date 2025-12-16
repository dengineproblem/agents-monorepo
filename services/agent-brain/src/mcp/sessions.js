/**
 * MCP Session Management
 *
 * Решает проблему: OpenAI вызывает MCP server напрямую, не зная userAccountId/adAccountId.
 * Решение: создаём сессию с контекстом пользователя перед вызовом OpenAI,
 * передаём sessionId в заголовках MCP запросов.
 */

import crypto from 'crypto';

// In-memory session store
// TODO: Заменить на Redis для масштабирования
const sessions = new Map();

// Session TTL: 30 минут
const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Создать новую сессию с контекстом пользователя
 * @param {Object} context - User context
 * @param {string} context.userAccountId - User account ID (UUID)
 * @param {string} context.adAccountId - Facebook Ad Account ID
 * @param {string} context.accessToken - Facebook Access Token
 * @param {string} [context.conversationId] - Current conversation ID
 * @returns {string} Session ID
 */
export function createSession({ userAccountId, adAccountId, accessToken, conversationId }) {
  const sessionId = crypto.randomUUID();
  const now = Date.now();

  sessions.set(sessionId, {
    userAccountId,
    adAccountId,
    accessToken,
    conversationId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    lastAccessedAt: now
  });

  return sessionId;
}

/**
 * Получить сессию по ID
 * @param {string} sessionId
 * @returns {Object|null} Session data or null if expired/not found
 */
export function getSession(sessionId) {
  if (!sessionId) return null;

  const session = sessions.get(sessionId);
  if (!session) return null;

  const now = Date.now();

  // Check expiration
  if (now > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }

  // Update last accessed time
  session.lastAccessedAt = now;

  return {
    userAccountId: session.userAccountId,
    adAccountId: session.adAccountId,
    accessToken: session.accessToken,
    conversationId: session.conversationId
  };
}

/**
 * Удалить сессию
 * @param {string} sessionId
 */
export function deleteSession(sessionId) {
  sessions.delete(sessionId);
}

/**
 * Продлить сессию
 * @param {string} sessionId
 * @returns {boolean} true if session exists and was extended
 */
export function extendSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;

  const now = Date.now();
  session.expiresAt = now + SESSION_TTL_MS;
  session.lastAccessedAt = now;

  return true;
}

/**
 * Получить статистику сессий (для мониторинга)
 */
export function getSessionStats() {
  const now = Date.now();
  let active = 0;
  let expired = 0;

  for (const [id, session] of sessions) {
    if (now > session.expiresAt) {
      expired++;
    } else {
      active++;
    }
  }

  return { active, expired, total: sessions.size };
}

// Cleanup expired sessions every 5 minutes
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now > session.expiresAt) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

// Prevent interval from keeping Node.js alive
cleanupInterval.unref?.();

export default {
  createSession,
  getSession,
  deleteSession,
  extendSession,
  getSessionStats
};
