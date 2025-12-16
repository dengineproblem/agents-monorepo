/**
 * ToolFilter Tests
 * Tests for filterToolsForOpenAI, validateToolCall, isDangerousTool
 */

import { describe, it, expect } from 'vitest';
import {
  filterToolsForOpenAI,
  validateToolCall,
  getToolType,
  filterReadOnlyTools
} from '../../src/chatAssistant/hybrid/toolFilter.js';
import { isDangerousTool } from '../../src/mcp/tools/constants.js';

describe('ToolFilter', () => {
  // Sample tools for testing
  const sampleTools = [
    { name: 'getCampaigns', description: 'Get campaigns' },
    { name: 'getSpendReport', description: 'Get spend report' },
    { name: 'pauseCampaign', description: 'Pause campaign' },
    { name: 'updateBudget', description: 'Update budget' },
    { name: 'getCreatives', description: 'Get creatives' },
    { name: 'launchCreative', description: 'Launch creative' }
  ];

  describe('filterToolsForOpenAI', () => {
    it('filters tools based on allowedTools', () => {
      const policy = {
        allowedTools: ['getCampaigns', 'getSpendReport']
      };

      const filtered = filterToolsForOpenAI(sampleTools, policy);

      expect(filtered).toHaveLength(2);
      expect(filtered.map(t => t.name)).toContain('getCampaigns');
      expect(filtered.map(t => t.name)).toContain('getSpendReport');
      expect(filtered.map(t => t.name)).not.toContain('pauseCampaign');
    });

    it('returns all tools when allowedTools is empty (backward compatibility)', () => {
      const policy = {
        allowedTools: []
      };

      const filtered = filterToolsForOpenAI(sampleTools, policy);

      // Empty allowedTools means no restriction (allow all) for backward compatibility
      expect(filtered).toHaveLength(sampleTools.length);
    });

    it('returns all tools when allowedTools is null', () => {
      const policy = {
        allowedTools: null
      };

      const filtered = filterToolsForOpenAI(sampleTools, policy);

      // Null allowedTools means allow all
      expect(filtered).toHaveLength(sampleTools.length);
    });

    it('handles non-existent tools in allowedTools', () => {
      const policy = {
        allowedTools: ['getCampaigns', 'nonExistentTool']
      };

      const filtered = filterToolsForOpenAI(sampleTools, policy);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('getCampaigns');
    });
  });

  describe('validateToolCall', () => {
    it('validates allowed tool call', () => {
      const policy = {
        allowedTools: ['getCampaigns', 'getSpendReport'],
        dangerousPolicy: 'block'
      };

      // validateToolCall takes (toolCall, policy) where toolCall has a name property
      const result = validateToolCall({ name: 'getCampaigns' }, policy);

      expect(result.valid).toBe(true);
    });

    it('rejects tool not in allowedTools', () => {
      const policy = {
        allowedTools: ['getCampaigns'],
        dangerousPolicy: 'block'
      };

      const result = validateToolCall({ name: 'pauseCampaign' }, policy);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not_in_allowed');
    });

    it('blocks dangerous tool when policy is block', () => {
      const policy = {
        allowedTools: ['pauseCampaign'],
        dangerousPolicy: 'block'
      };

      const result = validateToolCall({ name: 'pauseCampaign' }, policy);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('approval');
    });

    it('allows dangerous tool when policy is allow', () => {
      const policy = {
        allowedTools: ['pauseCampaign'],
        dangerousPolicy: 'allow'
      };

      const result = validateToolCall({ name: 'pauseCampaign' }, policy);

      expect(result.valid).toBe(true);
    });
  });

  describe('isDangerousTool', () => {
    it('identifies dangerous tools', () => {
      expect(isDangerousTool('pauseCampaign')).toBe(true);
      expect(isDangerousTool('pauseAdSet')).toBe(true);
      expect(isDangerousTool('updateBudget')).toBe(true);
      expect(isDangerousTool('launchCreative')).toBe(true);
      expect(isDangerousTool('pauseCreative')).toBe(true);
      expect(isDangerousTool('startCreativeTest')).toBe(true);
    });

    it('identifies safe tools', () => {
      expect(isDangerousTool('getCampaigns')).toBe(false);
      expect(isDangerousTool('getSpendReport')).toBe(false);
      expect(isDangerousTool('getCreatives')).toBe(false);
      expect(isDangerousTool('getLeads')).toBe(false);
    });
  });

  describe('getToolType', () => {
    it('returns read for GET tools', () => {
      expect(getToolType('getCampaigns')).toBe('read');
      expect(getToolType('getSpendReport')).toBe('read');
      expect(getToolType('getCreatives')).toBe('read');
    });

    it('returns write for action tools', () => {
      expect(getToolType('pauseCampaign')).toBe('write');
      expect(getToolType('updateBudget')).toBe('write');
      expect(getToolType('launchCreative')).toBe('write');
    });
  });

  describe('filterReadOnlyTools', () => {
    it('filters only read-only tools', () => {
      const readOnly = filterReadOnlyTools(sampleTools);

      expect(readOnly.every(t => t.name.startsWith('get'))).toBe(true);
      expect(readOnly.map(t => t.name)).not.toContain('pauseCampaign');
      expect(readOnly.map(t => t.name)).not.toContain('updateBudget');
      expect(readOnly.map(t => t.name)).not.toContain('launchCreative');
    });
  });
});
