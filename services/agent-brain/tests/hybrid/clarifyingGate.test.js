/**
 * ClarifyingGate Tests
 * Tests for evaluate and extractFromMessage functions
 */

import { describe, it, expect } from 'vitest';
import { clarifyingGate, QUESTION_TYPES } from '../../src/chatAssistant/hybrid/clarifyingGate.js';

describe('ClarifyingGate', () => {
  describe('QUESTION_TYPES', () => {
    it('has all expected question types', () => {
      expect(QUESTION_TYPES).toHaveProperty('PERIOD');
      expect(QUESTION_TYPES).toHaveProperty('ENTITY');
      expect(QUESTION_TYPES).toHaveProperty('AMOUNT');
      expect(QUESTION_TYPES).toHaveProperty('METRIC');
      expect(QUESTION_TYPES).toHaveProperty('CONFIRMATION');
    });

    it('has correct string values', () => {
      expect(QUESTION_TYPES.PERIOD).toBe('period');
      expect(QUESTION_TYPES.ENTITY).toBe('entity');
      expect(QUESTION_TYPES.AMOUNT).toBe('amount');
    });
  });

  describe('evaluate', () => {
    it('extracts period from message', () => {
      const policy = {
        clarifyingRequired: true,
        clarifyingQuestions: [
          { field: 'period', text: 'За какой период?', type: 'period' }
        ]
      };

      const result = clarifyingGate.evaluate({
        message: 'покажи расходы за неделю',
        policy,
        context: {}
      });

      // Period should be extracted from message
      expect(result.answers.period).toBeDefined();
      expect(result.complete).toBe(true);
    });

    it('extracts amount from message', () => {
      const policy = {
        clarifyingRequired: true,
        clarifyingQuestions: [
          { field: 'amount', text: 'На сколько изменить?', type: 'amount' }
        ]
      };

      const result = clarifyingGate.evaluate({
        message: 'увеличь бюджет на 20%',
        policy,
        context: {}
      });

      // Amount should be extracted
      expect(result.answers.amount).toBeDefined();
    });

    it('returns complete=true when all required answers provided', () => {
      const policy = {
        clarifyingRequired: true,
        clarifyingQuestions: [
          { field: 'period', text: 'За какой период?', type: 'period' }
        ]
      };

      // Provide answer in message
      const result = clarifyingGate.evaluate({
        message: 'покажи за месяц',
        policy,
        context: {}
      });

      expect(result.complete).toBe(true);
    });

    it('returns pending questions when not all answered', () => {
      const policy = {
        clarifyingRequired: true,
        clarifyingQuestions: [
          { field: 'period', text: 'За какой период?', type: 'period' },
          { field: 'entity', text: 'Какое направление?', type: 'entity' }
        ]
      };

      const result = clarifyingGate.evaluate({
        message: 'покажи за неделю',  // Only period, not entity
        policy,
        context: {}
      });

      // Should have period but need entity - check questions array
      expect(result.answers.period).toBeDefined();
      expect(result.questions?.length).toBeGreaterThan(0);
    });
  });

  describe('extractFromMessage', () => {
    it('extracts period values', () => {
      const testCases = [
        { message: 'за сегодня', expected: 'today' },
        { message: 'за вчера', expected: 'yesterday' },
        { message: 'за 7 дней', expected: 'last_7d' },
        { message: 'за неделю', expected: 'last_7d' },
        { message: 'за месяц', expected: 'last_30d' }
      ];

      for (const { message, expected } of testCases) {
        const result = clarifyingGate.extractFromMessage(message, 'period');
        expect(result).toBe(expected);
      }
    });

    it('extracts percentage amounts', () => {
      const result = clarifyingGate.extractFromMessage('увеличь на 25%', 'amount');
      expect(result).toBeDefined();
      expect(result.percent).toBe(25);
      expect(result.relative).toBe(true);
    });

    it('extracts absolute amounts in RUB', () => {
      const result = clarifyingGate.extractFromMessage('поставь 1000 рублей', 'amount');
      expect(result).toBeDefined();
      expect(result.value).toBe(1000);
      expect(result.currency).toBe('RUB');
    });

    it('returns null for unrecognized patterns', () => {
      const result = clarifyingGate.extractFromMessage('непонятный текст', 'period');
      expect(result).toBeNull();
    });
  });
});
