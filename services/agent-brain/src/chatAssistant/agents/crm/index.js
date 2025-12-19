/**
 * CRMAgent - Leads & Funnel Agent
 * Handles all CRM-related queries and operations
 */

import { BaseAgent } from '../BaseAgent.js';
import { CRM_TOOLS, CRM_WRITE_TOOLS, CRM_DANGEROUS_TOOLS, AMOCRM_TOOLS } from './tools.js';
import { crmHandlers } from './handlers.js';
import { buildCRMPrompt, PROMPT_VERSION } from './prompt.js';

export class CRMAgent extends BaseAgent {
  constructor() {
    super({
      name: 'CRMAgent',
      description: 'Управление лидами и воронкой продаж: поиск, статистика, изменение этапов',
      domain: 'crm',
      tools: CRM_TOOLS,
      handlers: crmHandlers,
      buildSystemPrompt: buildCRMPrompt,
      promptVersion: PROMPT_VERSION
    });
  }

  /**
   * Extract notes from tool execution for mid-term memory
   * Captures funnel insights and lead patterns
   */
  extractNotes(toolName, args, result) {
    const notes = [];

    // Capture from getFunnelStats - funnel bottlenecks
    if (toolName === 'getFunnelStats' && result.stats) {
      const stats = result.stats;

      // High drop-off stages
      if (stats.stages) {
        for (const stage of stats.stages) {
          if (stage.dropOffRate && stage.dropOffRate > 50) {
            notes.push({
              text: `Высокий отвал на этапе "${stage.name}": ${stage.dropOffRate}%`,
              source: { type: 'tool', ref: 'getFunnelStats' },
              importance: 0.8
            });
          }
        }
      }

      // Cold leads accumulation
      if (stats.cold && stats.total && (stats.cold / stats.total) > 0.6) {
        notes.push({
          text: `Много холодных лидов: ${stats.cold} из ${stats.total} (${Math.round(stats.cold / stats.total * 100)}%)`,
          source: { type: 'tool', ref: 'getFunnelStats' },
          importance: 0.7
        });
      }
    }

    // Capture from getLeadDetails - common loss reasons
    if (toolName === 'getLeadDetails' && result.lead) {
      const lead = result.lead;

      if (lead.status === 'lost' && lead.loss_reason) {
        notes.push({
          text: `Причина потери лида: ${lead.loss_reason}`,
          source: { type: 'tool', ref: 'getLeadDetails', leadId: args.leadId },
          importance: 0.5
        });
      }
    }

    // Capture from searchLeads - segment patterns
    if (toolName === 'searchLeads' && result.leads && result.leads.length > 5) {
      const leads = result.leads;
      const hotCount = leads.filter(l => l.temperature === 'hot').length;

      if (hotCount > leads.length / 2) {
        notes.push({
          text: `Сегмент "${args.query || 'поиск'}" содержит много горячих лидов: ${hotCount} из ${leads.length}`,
          source: { type: 'tool', ref: 'searchLeads' },
          importance: 0.6
        });
      }
    }

    // amoCRM: Capture from getAmoCRMQualificationStats - low qualification creatives
    if (toolName === 'getAmoCRMQualificationStats' && result.creatives) {
      const lowQualCreatives = result.creatives.filter(c => c.rate < 20 && c.total >= 5);
      if (lowQualCreatives.length > 0) {
        notes.push({
          text: `Низкая квалификация (${lowQualCreatives.length} креативов < 20%)`,
          source: { type: 'tool', ref: 'getAmoCRMQualificationStats' },
          importance: 0.8
        });
      }

      const highQualCreatives = result.creatives.filter(c => c.rate > 50 && c.total >= 5);
      if (highQualCreatives.length > 0) {
        notes.push({
          text: `Высокая квалификация: ${highQualCreatives.map(c => c.name || c.id).join(', ')}`,
          source: { type: 'tool', ref: 'getAmoCRMQualificationStats' },
          importance: 0.7
        });
      }
    }

    // amoCRM: Capture from getAmoCRMKeyStageStats - funnel health
    if (toolName === 'getAmoCRMKeyStageStats' && result.key_stages) {
      for (const stage of result.key_stages) {
        if (stage.rate > 40) {
          notes.push({
            text: `Высокая конверсия в "${stage.name}": ${stage.rate}%`,
            source: { type: 'tool', ref: 'getAmoCRMKeyStageStats' },
            importance: 0.7
          });
        }
        if (stage.rate < 10 && stage.total_leads > 10) {
          notes.push({
            text: `Низкая конверсия в "${stage.name}": ${stage.rate}% — узкое место воронки`,
            source: { type: 'tool', ref: 'getAmoCRMKeyStageStats' },
            importance: 0.8
          });
        }
      }
    }

    // amoCRM: Capture from syncAmoCRMLeads - sync issues
    if (toolName === 'syncAmoCRMLeads' && result.errors && result.errors > 0) {
      notes.push({
        text: `Ошибки синхронизации amoCRM: ${result.errors} из ${result.total}`,
        source: { type: 'tool', ref: 'syncAmoCRMLeads' },
        importance: 0.9
      });
    }

    return notes;
  }

  /**
   * Execute tool with preflight check for amoCRM tools
   */
  async executeTool(toolName, args, context) {
    // Preflight check для amoCRM tools (кроме getAmoCRMStatus)
    if (AMOCRM_TOOLS.includes(toolName) && toolName !== 'getAmoCRMStatus') {
      const status = await this.handlers.getAmoCRMStatus({}, context);

      if (!status.connected) {
        return {
          success: false,
          error: 'amoCRM не подключён. Подключите интеграцию в настройках.',
          amocrm_status: status
        };
      }

      if (!status.tokenValid) {
        return {
          success: false,
          error: 'Токен amoCRM истёк. Требуется переподключение.',
          amocrm_status: status
        };
      }
    }

    // Call parent executeTool
    return super.executeTool(toolName, args, context);
  }

  /**
   * Check if tool requires approval based on mode
   */
  shouldRequireApproval(toolName, mode) {
    // Dangerous tools ALWAYS require approval
    if (CRM_DANGEROUS_TOOLS.includes(toolName)) {
      return true;
    }

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
