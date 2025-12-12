/**
 * CRMAgent - Leads & Funnel Agent
 * Handles all CRM-related queries and operations
 */

import { BaseAgent } from '../BaseAgent.js';
import { CRM_TOOLS, CRM_WRITE_TOOLS } from './tools.js';
import { crmHandlers } from './handlers.js';
import { buildCRMPrompt } from './prompt.js';

export class CRMAgent extends BaseAgent {
  constructor() {
    super({
      name: 'CRMAgent',
      description: 'Управление лидами и воронкой продаж: поиск, статистика, изменение этапов',
      tools: CRM_TOOLS,
      handlers: crmHandlers,
      buildSystemPrompt: buildCRMPrompt
    });
  }

  /**
   * Check if tool requires approval based on mode
   */
  shouldRequireApproval(toolName, mode) {
    // In 'plan' or 'ask' mode, write operations need approval
    if (mode === 'plan' || mode === 'ask') {
      return CRM_WRITE_TOOLS.includes(toolName);
    }
    return false;
  }

  /**
   * Check if a tool is a write operation
   */
  isWriteTool(toolName) {
    return CRM_WRITE_TOOLS.includes(toolName);
  }
}

// Export singleton instance
export const crmAgent = new CRMAgent();
