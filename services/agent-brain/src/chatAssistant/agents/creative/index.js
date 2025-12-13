/**
 * CreativeAgent - Creative Management Agent
 * Handles creative metrics, analysis, tests, and launches
 */

import { BaseAgent } from '../BaseAgent.js';
import { CREATIVE_TOOLS, CREATIVE_WRITE_TOOLS, CREATIVE_DANGEROUS_TOOLS } from './tools.js';
import { creativeHandlers } from './handlers.js';
import { buildCreativePrompt } from './prompt.js';

export class CreativeAgent extends BaseAgent {
  constructor() {
    super({
      name: 'CreativeAgent',
      description: 'Работа с креативами: метрики, анализ, тесты, запуск',
      tools: CREATIVE_TOOLS,
      handlers: creativeHandlers,
      buildSystemPrompt: buildCreativePrompt
    });
  }

  /**
   * Check if tool requires approval based on mode
   * Override for creative-specific logic
   */
  shouldRequireApproval(toolName, mode) {
    // Dangerous tools always require confirmation
    if (CREATIVE_DANGEROUS_TOOLS.includes(toolName)) {
      return true;
    }

    // In 'plan' or 'ask' mode, write operations need approval
    if (mode === 'plan' || mode === 'ask') {
      return CREATIVE_WRITE_TOOLS.includes(toolName);
    }

    return false;
  }

  /**
   * Check if a tool is a write operation
   */
  isWriteTool(toolName) {
    return CREATIVE_WRITE_TOOLS.includes(toolName);
  }
}

// Export singleton instance
export const creativeAgent = new CreativeAgent();
