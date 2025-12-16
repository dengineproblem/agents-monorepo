/**
 * Sessions Tests
 * Tests for maxToolCalls enforcement via incrementToolCalls
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSession,
  getSession,
  incrementToolCalls,
  getToolCallStats,
  deleteSession
} from '../../src/mcp/sessions.js';

describe('MCP Sessions - Tool Call Limits', () => {
  let sessionId;

  beforeEach(() => {
    // Create a fresh session for each test
    sessionId = createSession({
      userAccountId: 'test-user-123',
      adAccountId: 'test-ad-account',
      accessToken: 'test-token',
      policyMetadata: {
        maxToolCalls: 3,
        toolCallCount: 0
      }
    });
  });

  describe('createSession with policyMetadata', () => {
    it('creates session with maxToolCalls', () => {
      const session = getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session.policyMetadata?.maxToolCalls).toBe(3);
    });

    it('initializes toolCallCount to 0', () => {
      const stats = getToolCallStats(sessionId);
      expect(stats.used).toBe(0);
      expect(stats.max).toBe(3);
    });
  });

  describe('incrementToolCalls', () => {
    it('increments counter and returns allowed=true when under limit', () => {
      const result1 = incrementToolCalls(sessionId);
      expect(result1.allowed).toBe(true);
      expect(result1.used).toBe(1);
      expect(result1.max).toBe(3);

      const result2 = incrementToolCalls(sessionId);
      expect(result2.allowed).toBe(true);
      expect(result2.used).toBe(2);

      const result3 = incrementToolCalls(sessionId);
      expect(result3.allowed).toBe(true);
      expect(result3.used).toBe(3);
    });

    it('returns allowed=false when limit exceeded', () => {
      // Use up the limit
      incrementToolCalls(sessionId);
      incrementToolCalls(sessionId);
      incrementToolCalls(sessionId);

      // 4th call should be blocked
      const result = incrementToolCalls(sessionId);
      expect(result.allowed).toBe(false);
      expect(result.used).toBe(4);
      expect(result.max).toBe(3);
    });

    it('returns error for non-existent session', () => {
      const result = incrementToolCalls('non-existent-session-id');
      expect(result.allowed).toBe(false);
      expect(result.error).toBe('session_not_found');
    });
  });

  describe('getToolCallStats', () => {
    it('returns current stats without incrementing', () => {
      incrementToolCalls(sessionId);
      incrementToolCalls(sessionId);

      const stats = getToolCallStats(sessionId);
      expect(stats.used).toBe(2);
      expect(stats.max).toBe(3);

      // Calling again should not change the count
      const stats2 = getToolCallStats(sessionId);
      expect(stats2.used).toBe(2);
    });

    it('returns zeros for non-existent session', () => {
      const stats = getToolCallStats('non-existent-session');
      expect(stats.used).toBe(0);
      expect(stats.max).toBe(0);
    });
  });

  describe('default maxToolCalls', () => {
    it('uses default of 5 when incrementing without policyMetadata', async () => {
      const defaultSessionId = createSession({
        userAccountId: 'test-user',
        adAccountId: 'test-ad',
        accessToken: 'token'
        // No policyMetadata
      });

      // Wait for async session creation
      await new Promise(resolve => setTimeout(resolve, 10));

      // incrementToolCalls will use default of 5
      const result = incrementToolCalls(defaultSessionId);
      expect(result.max).toBe(5); // Default

      // Clean up
      deleteSession(defaultSessionId);
    });
  });

  describe('session cleanup', () => {
    it('deleteSession removes session', () => {
      deleteSession(sessionId);

      // Give it a moment to process async delete
      setTimeout(() => {
        const session = getSession(sessionId);
        expect(session).toBeNull();
      }, 100);
    });
  });
});
