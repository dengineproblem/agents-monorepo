/**
 * WhatsAppAgent - WhatsApp Dialogs Agent
 * Handles all WhatsApp-related queries and operations
 */

import { BaseAgent } from '../BaseAgent.js';
import { WHATSAPP_TOOLS, WHATSAPP_WRITE_TOOLS } from './tools.js';
import { whatsappHandlers } from './handlers.js';
import { buildWhatsAppPrompt } from './prompt.js';

export class WhatsAppAgent extends BaseAgent {
  constructor() {
    super({
      name: 'WhatsAppAgent',
      description: 'Анализ WhatsApp диалогов: переписки, интересы клиентов, рекомендации',
      tools: WHATSAPP_TOOLS,
      handlers: whatsappHandlers,
      buildSystemPrompt: buildWhatsAppPrompt
    });
  }

  /**
   * Check if tool requires approval based on mode
   * WhatsApp agent has no write tools, so never requires approval
   */
  shouldRequireApproval(toolName, mode) {
    return false;
  }

  /**
   * Check if a tool is a write operation
   */
  isWriteTool(toolName) {
    return WHATSAPP_WRITE_TOOLS.includes(toolName);
  }
}

// Export singleton instance
export const whatsappAgent = new WhatsAppAgent();
