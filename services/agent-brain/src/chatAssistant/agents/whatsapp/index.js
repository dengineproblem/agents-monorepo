/**
 * WhatsAppAgent - WhatsApp Dialogs Agent
 * Handles all WhatsApp-related queries and operations
 */

import { BaseAgent } from '../BaseAgent.js';
import { WHATSAPP_TOOLS, WHATSAPP_WRITE_TOOLS } from './tools.js';
import { whatsappHandlers } from './handlers.js';
import { buildWhatsAppPrompt, PROMPT_VERSION } from './prompt.js';

export class WhatsAppAgent extends BaseAgent {
  constructor() {
    super({
      name: 'WhatsAppAgent',
      description: 'Анализ WhatsApp диалогов: переписки, интересы клиентов, рекомендации',
      domain: 'whatsapp',
      tools: WHATSAPP_TOOLS,
      handlers: whatsappHandlers,
      buildSystemPrompt: buildWhatsAppPrompt,
      promptVersion: PROMPT_VERSION
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

  /**
   * Extract notes from tool results for mid-term memory
   * Captures: objections, interests, patterns from dialog analysis
   */
  extractNotes(toolName, args, result) {
    const notes = [];

    // Capture from analyzeDialog results
    if (toolName === 'analyzeDialog' && result.analysis) {
      const analysis = result.analysis;

      // Capture objections
      if (analysis.objections?.length > 0) {
        const objectionText = analysis.objections.slice(0, 3).join(', ');
        notes.push({
          text: `Возражения клиента: ${objectionText}`,
          source: { type: 'analyzeDialog', phone: args.contact_phone?.slice(-4) || 'unknown' },
          importance: 0.7
        });
      }

      // Capture interests/services
      if (analysis.interests?.length > 0 || analysis.services_interest?.length > 0) {
        const interests = analysis.interests || analysis.services_interest || [];
        const interestText = interests.slice(0, 3).join(', ');
        notes.push({
          text: `Интересы клиента: ${interestText}`,
          source: { type: 'analyzeDialog', phone: args.contact_phone?.slice(-4) || 'unknown' },
          importance: 0.6
        });
      }

      // Capture pain points
      if (analysis.pain_points?.length > 0) {
        const painText = analysis.pain_points.slice(0, 2).join(', ');
        notes.push({
          text: `Боли клиента: ${painText}`,
          source: { type: 'analyzeDialog', phone: args.contact_phone?.slice(-4) || 'unknown' },
          importance: 0.7
        });
      }
    }

    return notes;
  }
}

// Export singleton instance
export const whatsappAgent = new WhatsAppAgent();
