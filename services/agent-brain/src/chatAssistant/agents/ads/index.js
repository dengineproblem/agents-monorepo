/**
 * AdsAgent - Facebook/Instagram Advertising Agent
 * Handles all advertising-related queries and operations
 */

import { BaseAgent } from '../BaseAgent.js';
import { ADS_TOOLS, ADS_WRITE_TOOLS, ADS_DANGEROUS_TOOLS } from './tools.js';
import { adsHandlers } from './handlers.js';
import { buildAdsPrompt, PROMPT_VERSION } from './prompt.js';

export class AdsAgent extends BaseAgent {
  constructor() {
    super({
      name: 'AdsAgent',
      description: 'Управление Facebook/Instagram рекламой: кампании, бюджеты, метрики',
      domain: 'ads',
      tools: ADS_TOOLS,
      handlers: adsHandlers,
      buildSystemPrompt: buildAdsPrompt,
      promptVersion: PROMPT_VERSION
    });
  }

  /**
   * Extract notes from tool execution for mid-term memory
   * Captures CPL trends, performance anomalies, and insights
   */
  extractNotes(toolName, args, result) {
    const notes = [];

    // Capture from getSpendReport - CPL trends and anomalies
    if (toolName === 'getSpendReport' && result.report) {
      const report = result.report;

      // High CPL warning
      if (report.avgCPL && report.avgCPL > 1000) {
        notes.push({
          text: `Высокий CPL: ${Math.round(report.avgCPL)}₽ за период ${args.startDate || 'N/A'} - ${args.endDate || 'N/A'}`,
          source: { type: 'tool', ref: 'getSpendReport' },
          importance: 0.7
        });
      }

      // Low conversion warning
      if (report.totalSpend > 10000 && report.totalLeads === 0) {
        notes.push({
          text: `Нет лидов при расходе ${Math.round(report.totalSpend)}₽ — требуется анализ`,
          source: { type: 'tool', ref: 'getSpendReport' },
          importance: 0.9
        });
      }

      // Top performing campaign
      if (report.byCampaign && report.byCampaign.length > 0) {
        const sortedCampaigns = [...report.byCampaign]
          .filter(c => c.leads > 0 && c.cpl > 0)
          .sort((a, b) => a.cpl - b.cpl);

        if (sortedCampaigns.length > 0) {
          const best = sortedCampaigns[0];
          if (best.cpl < 500) {
            notes.push({
              text: `Лучшая кампания: "${best.name}" с CPL ${Math.round(best.cpl)}₽`,
              source: { type: 'tool', ref: 'getSpendReport' },
              importance: 0.6
            });
          }
        }
      }
    }

    // Capture from getCampaignDetails - specific campaign insights
    if (toolName === 'getCampaignDetails' && result.campaign) {
      const campaign = result.campaign;

      // Campaign with issues
      if (campaign.status === 'PAUSED' && campaign.effective_status === 'CAMPAIGN_PAUSED') {
        notes.push({
          text: `Кампания "${campaign.name}" на паузе`,
          source: { type: 'tool', ref: 'getCampaignDetails', campaignId: args.campaignId },
          importance: 0.5
        });
      }
    }

    // Capture from getDirections - direction performance
    if (toolName === 'getDirections' && result.directions) {
      const activeDirections = result.directions.filter(d => d.status === 'active');
      const pausedDirections = result.directions.filter(d => d.status === 'paused');

      if (pausedDirections.length > activeDirections.length) {
        notes.push({
          text: `Много паузнутых направлений: ${pausedDirections.length} из ${result.directions.length}`,
          source: { type: 'tool', ref: 'getDirections' },
          importance: 0.5
        });
      }
    }

    return notes;
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
