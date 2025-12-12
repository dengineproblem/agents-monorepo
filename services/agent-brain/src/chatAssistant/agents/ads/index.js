/**
 * AdsAgent - Facebook/Instagram Advertising Agent
 * Handles all advertising-related queries and operations
 */

import { BaseAgent } from '../BaseAgent.js';
import { ADS_TOOLS, ADS_WRITE_TOOLS, ADS_DANGEROUS_TOOLS } from './tools.js';
import { adsHandlers } from './handlers.js';
import { buildAdsPrompt } from './prompt.js';

export class AdsAgent extends BaseAgent {
  constructor() {
    super({
      name: 'AdsAgent',
      description: 'Управление Facebook/Instagram рекламой: кампании, бюджеты, метрики',
      tools: ADS_TOOLS,
      handlers: adsHandlers,
      buildSystemPrompt: buildAdsPrompt
    });
  }

  /**
   * Check if tool requires approval based on mode
   * Override for ads-specific logic
   */
  shouldRequireApproval(toolName, mode) {
    // Dangerous tools always require confirmation
    if (ADS_DANGEROUS_TOOLS.includes(toolName)) {
      return true;
    }

    // In 'plan' or 'ask' mode, write operations need approval
    if (mode === 'plan' || mode === 'ask') {
      return ADS_WRITE_TOOLS.includes(toolName);
    }

    return false;
  }

  /**
   * Check if a tool is a write operation
   */
  isWriteTool(toolName) {
    return ADS_WRITE_TOOLS.includes(toolName);
  }
}

// Export singleton instance
export const adsAgent = new AdsAgent();
