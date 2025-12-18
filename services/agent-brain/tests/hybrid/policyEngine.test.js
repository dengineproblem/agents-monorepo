/**
 * PolicyEngine Tests
 * Tests for resolvePolicy function
 * Note: Intent detection is now handled by LLM in orchestrator/index.js
 */

import { describe, it, expect } from 'vitest';
import { policyEngine } from '../../src/chatAssistant/hybrid/policyEngine.js';

describe('PolicyEngine', () => {
  describe('resolvePolicy', () => {
    it('returns policy with allowedTools for spend_report', () => {
      const policy = policyEngine.resolvePolicy({
        intent: 'spend_report',
        domains: ['ads'],
        context: {},
        integrations: { fb: true }
      });

      expect(policy.playbookId).toBe('spend_report');
      expect(policy.allowedTools).toContain('getSpendReport');
      expect(policy.maxToolCalls).toBeGreaterThan(0);
      expect(policy.dangerousPolicy).toBe('block');
    });

    it('returns policy with clarifyingQuestions for budget_change', () => {
      const policy = policyEngine.resolvePolicy({
        intent: 'budget_change',
        domains: ['ads'],
        context: {},
        integrations: { fb: true }
      });

      expect(policy.clarifyingRequired).toBe(true);
      expect(policy.clarifyingQuestions.length).toBeGreaterThan(0);
      expect(policy.allowedTools).toContain('updateBudget');
    });

    it('fails preflight check when CRM not connected', () => {
      const policy = policyEngine.resolvePolicy({
        intent: 'leads_list',
        domains: ['crm'],
        context: {},
        integrations: { crm: false }
      });

      expect(policy.preflightFailed).toBe(true);
      expect(policy.preflightError).toBeDefined();
      expect(policy.allowedTools).toEqual([]);
    });

    it('passes preflight check when CRM connected', () => {
      const policy = policyEngine.resolvePolicy({
        intent: 'leads_list',
        domains: ['crm'],
        context: {},
        integrations: { crm: true }
      });

      expect(policy.preflightFailed).toBeUndefined();
      expect(policy.allowedTools).toContain('getLeads');
    });

    it('returns fallback policy for unknown intent', () => {
      const policy = policyEngine.resolvePolicy({
        intent: 'unknown',
        domains: [],
        context: {},
        integrations: {}
      });

      expect(policy.playbookId).toBe('unknown');
      expect(policy.allowedTools).toEqual([]);
      expect(policy.clarifyingRequired).toBe(true);
    });

    it('returns correct maxToolCalls for different intents', () => {
      const budgetPolicy = policyEngine.resolvePolicy({
        intent: 'budget_change',
        domains: ['ads'],
        context: {},
        integrations: {}
      });
      expect(budgetPolicy.maxToolCalls).toBe(3);

      const overviewPolicy = policyEngine.resolvePolicy({
        intent: 'directions_overview',
        domains: ['ads'],
        context: {},
        integrations: {}
      });
      expect(overviewPolicy.maxToolCalls).toBeGreaterThan(0);
    });
  });
});
