/**
 * CreativeAgent - Creative Management Agent
 * Handles creative metrics, analysis, tests, and launches
 */

import { BaseAgent } from '../BaseAgent.js';
import { CREATIVE_TOOLS, CREATIVE_WRITE_TOOLS, CREATIVE_DANGEROUS_TOOLS } from './tools.js';
import { creativeHandlers } from './handlers.js';
import { buildCreativePrompt, PROMPT_VERSION } from './prompt.js';

export class CreativeAgent extends BaseAgent {
  constructor() {
    super({
      name: 'CreativeAgent',
      description: 'Работа с креативами: метрики, анализ, тесты, запуск',
      domain: 'creative',
      tools: CREATIVE_TOOLS,
      handlers: creativeHandlers,
      buildSystemPrompt: buildCreativePrompt,
      promptVersion: PROMPT_VERSION
    });
  }

  /**
   * Extract notes from tool execution for mid-term memory
   * Captures creative performance patterns and insights
   */
  extractNotes(toolName, args, result) {
    const notes = [];

    // Capture from getCreativeMetrics - performance insights
    if (toolName === 'getCreativeMetrics' && result.creatives) {
      const creatives = result.creatives;

      // Find top performer
      const sorted = [...creatives]
        .filter(c => c.leads > 0 && c.cpl > 0)
        .sort((a, b) => a.cpl - b.cpl);

      if (sorted.length > 0 && sorted[0].cpl < 400) {
        notes.push({
          text: `Топ-креатив: "${sorted[0].name || sorted[0].id}" с CPL ${Math.round(sorted[0].cpl)}₽`,
          source: { type: 'tool', ref: 'getCreativeMetrics' },
          importance: 0.6
        });
      }

      // Find underperformers
      const underperformers = creatives.filter(c => c.spend > 5000 && c.leads === 0);
      if (underperformers.length > 0) {
        notes.push({
          text: `${underperformers.length} креатив(ов) без лидов при расходе >5000₽`,
          source: { type: 'tool', ref: 'getCreativeMetrics' },
          importance: 0.7
        });
      }
    }

    // Capture from analyzeCreative - angle/hook insights
    if (toolName === 'analyzeCreative' && result.analysis) {
      const analysis = result.analysis;

      if (analysis.best_hook) {
        notes.push({
          text: `Эффективный хук: "${analysis.best_hook}"`,
          source: { type: 'tool', ref: 'analyzeCreative' },
          importance: 0.6
        });
      }

      if (analysis.winning_angle) {
        notes.push({
          text: `Рабочий угол: ${analysis.winning_angle}`,
          source: { type: 'tool', ref: 'analyzeCreative' },
          importance: 0.6
        });
      }
    }

    return notes;
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
