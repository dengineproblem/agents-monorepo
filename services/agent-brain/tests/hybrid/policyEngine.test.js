/**
 * PolicyEngine Tests
 * Tests for detectIntent and resolvePolicy functions
 */

import { describe, it, expect } from 'vitest';
import { policyEngine } from '../../src/chatAssistant/hybrid/policyEngine.js';

describe('PolicyEngine', () => {
  describe('detectIntent', () => {
    it('detects spend_report intent', () => {
      const result = policyEngine.detectIntent('покажи расходы за неделю');
      expect(result.intent).toBe('spend_report');
      expect(result.domain).toBe('ads');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('detects budget_change intent', () => {
      const result = policyEngine.detectIntent('увеличь бюджет на 20%');
      expect(result.intent).toBe('budget_change');
      expect(result.domain).toBe('ads');
    });

    it('detects pause_entity intent', () => {
      const result = policyEngine.detectIntent('останови кампанию Test');
      expect(result.intent).toBe('pause_entity');
      expect(result.domain).toBe('ads');
    });

    it('detects directions_overview intent', () => {
      const result = policyEngine.detectIntent('покажи направления');
      expect(result.intent).toBe('directions_overview');
      expect(result.domain).toBe('ads');
    });

    it('detects creative intent', () => {
      const result = policyEngine.detectIntent('покажи топ креативов');
      // The actual intent may be creative_list or creative_top depending on patterns
      expect(result.domain).toBe('creative');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('detects leads_list intent', () => {
      const result = policyEngine.detectIntent('покажи лидов за неделю');
      expect(result.intent).toBe('leads_list');
      expect(result.domain).toBe('crm');
    });

    it('detects dialogs_list intent', () => {
      const result = policyEngine.detectIntent('покажи диалоги');
      expect(result.intent).toBe('dialogs_list');
      expect(result.domain).toBe('whatsapp');
    });

    it('returns unknown for unrecognized input', () => {
      const result = policyEngine.detectIntent('abrakadabra xyz');
      expect(result.intent).toBe('unknown');
      expect(result.confidence).toBeLessThan(0.5);
    });
  });

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
