/**
 * MCP Tool Definitions
 *
 * Конвертирует существующие toolDefs агентов в формат MCP.
 * Использует zod-to-json-schema для преобразования Zod схем в JSON Schema.
 *
 * Phase 4: All agents (WhatsApp, CRM, Creative, Ads)
 * Total: 40 tools (4 + 4 + 15 + 17)
 */

import { zodToJsonSchema } from 'zod-to-json-schema';

// WhatsApp Agent (4 READ-only tools)
import { WhatsappToolDefs } from '../../chatAssistant/agents/whatsapp/toolDefs.js';
import { whatsappHandlers } from '../../chatAssistant/agents/whatsapp/handlers.js';

// CRM Agent (3 READ + 1 WRITE tools)
import { CrmToolDefs } from '../../chatAssistant/agents/crm/toolDefs.js';
import { crmHandlers } from '../../chatAssistant/agents/crm/handlers.js';

// Creative Agent (10 READ + 5 WRITE tools)
import { CreativeToolDefs, CREATIVE_DANGEROUS_TOOLS } from '../../chatAssistant/agents/creative/toolDefs.js';
import { creativeHandlers } from '../../chatAssistant/agents/creative/handlers.js';

// Ads Agent (9 READ + 8 WRITE tools)
import { AdsToolDefs } from '../../chatAssistant/agents/ads/toolDefs.js';
import { adsHandlers } from '../../chatAssistant/agents/ads/handlers.js';

/**
 * Convert Zod schema to JSON Schema for MCP
 * @param {import('zod').ZodSchema} zodSchema
 * @returns {Object} JSON Schema
 */
function zodToMCPSchema(zodSchema) {
  const jsonSchema = zodToJsonSchema(zodSchema, {
    target: 'openApi3',
    $refStrategy: 'none'
  });

  // Remove $schema as MCP doesn't need it
  delete jsonSchema.$schema;

  return jsonSchema;
}

/**
 * Create MCP tool definition from agent toolDef
 * @param {string} name - Tool name
 * @param {Object} toolDef - Agent tool definition
 * @param {Function} handler - Tool handler function
 * @param {string} agent - Agent name for grouping
 */
function createMCPTool(name, toolDef, handler, agent) {
  return {
    name,
    description: toolDef.description,
    inputSchema: zodToMCPSchema(toolDef.schema),
    zodSchema: toolDef.schema,  // Keep original Zod schema for validation
    handler,
    agent,
    meta: toolDef.meta || {}
  };
}

/**
 * WhatsApp Agent Tools (4 READ-only)
 */
export const whatsappTools = [
  createMCPTool('getDialogs', WhatsappToolDefs.getDialogs, whatsappHandlers.getDialogs, 'whatsapp'),
  createMCPTool('getDialogMessages', WhatsappToolDefs.getDialogMessages, whatsappHandlers.getDialogMessages, 'whatsapp'),
  createMCPTool('analyzeDialog', WhatsappToolDefs.analyzeDialog, whatsappHandlers.analyzeDialog, 'whatsapp'),
  createMCPTool('searchDialogSummaries', WhatsappToolDefs.searchDialogSummaries, whatsappHandlers.searchDialogSummaries, 'whatsapp')
];

/**
 * CRM Agent Tools (3 READ + 1 WRITE)
 */
export const crmTools = [
  // READ tools
  createMCPTool('getLeads', CrmToolDefs.getLeads, crmHandlers.getLeads, 'crm'),
  createMCPTool('getLeadDetails', CrmToolDefs.getLeadDetails, crmHandlers.getLeadDetails, 'crm'),
  createMCPTool('getFunnelStats', CrmToolDefs.getFunnelStats, crmHandlers.getFunnelStats, 'crm'),
  // WRITE tools
  createMCPTool('updateLeadStage', CrmToolDefs.updateLeadStage, crmHandlers.updateLeadStage, 'crm')
];

/**
 * Creative Agent Tools (10 READ + 5 WRITE)
 */
export const creativeTools = [
  // READ tools
  createMCPTool('getCreatives', CreativeToolDefs.getCreatives, creativeHandlers.getCreatives, 'creative'),
  createMCPTool('getCreativeDetails', CreativeToolDefs.getCreativeDetails, creativeHandlers.getCreativeDetails, 'creative'),
  createMCPTool('getCreativeMetrics', CreativeToolDefs.getCreativeMetrics, creativeHandlers.getCreativeMetrics, 'creative'),
  createMCPTool('getCreativeAnalysis', CreativeToolDefs.getCreativeAnalysis, creativeHandlers.getCreativeAnalysis, 'creative'),
  createMCPTool('getTopCreatives', CreativeToolDefs.getTopCreatives, creativeHandlers.getTopCreatives, 'creative'),
  createMCPTool('getWorstCreatives', CreativeToolDefs.getWorstCreatives, creativeHandlers.getWorstCreatives, 'creative'),
  createMCPTool('compareCreatives', CreativeToolDefs.compareCreatives, creativeHandlers.compareCreatives, 'creative'),
  createMCPTool('getCreativeScores', CreativeToolDefs.getCreativeScores, creativeHandlers.getCreativeScores, 'creative'),
  createMCPTool('getCreativeTests', CreativeToolDefs.getCreativeTests, creativeHandlers.getCreativeTests, 'creative'),
  createMCPTool('getCreativeTranscript', CreativeToolDefs.getCreativeTranscript, creativeHandlers.getCreativeTranscript, 'creative'),
  // WRITE tools
  createMCPTool('triggerCreativeAnalysis', CreativeToolDefs.triggerCreativeAnalysis, creativeHandlers.triggerCreativeAnalysis, 'creative'),
  createMCPTool('launchCreative', CreativeToolDefs.launchCreative, creativeHandlers.launchCreative, 'creative'),
  createMCPTool('pauseCreative', CreativeToolDefs.pauseCreative, creativeHandlers.pauseCreative, 'creative'),
  createMCPTool('startCreativeTest', CreativeToolDefs.startCreativeTest, creativeHandlers.startCreativeTest, 'creative'),
  createMCPTool('stopCreativeTest', CreativeToolDefs.stopCreativeTest, creativeHandlers.stopCreativeTest, 'creative')
];

/**
 * Ads Agent Tools (9 READ + 8 WRITE)
 */
export const adsTools = [
  // READ tools - Campaigns & AdSets
  createMCPTool('getCampaigns', AdsToolDefs.getCampaigns, adsHandlers.getCampaigns, 'ads'),
  createMCPTool('getCampaignDetails', AdsToolDefs.getCampaignDetails, adsHandlers.getCampaignDetails, 'ads'),
  createMCPTool('getAdSets', AdsToolDefs.getAdSets, adsHandlers.getAdSets, 'ads'),
  createMCPTool('getSpendReport', AdsToolDefs.getSpendReport, adsHandlers.getSpendReport, 'ads'),
  // READ tools - Directions
  createMCPTool('getDirections', AdsToolDefs.getDirections, adsHandlers.getDirections, 'ads'),
  createMCPTool('getDirectionDetails', AdsToolDefs.getDirectionDetails, adsHandlers.getDirectionDetails, 'ads'),
  createMCPTool('getDirectionMetrics', AdsToolDefs.getDirectionMetrics, adsHandlers.getDirectionMetrics, 'ads'),
  // READ tools - ROI Reports
  createMCPTool('getROIReport', AdsToolDefs.getROIReport, adsHandlers.getROIReport, 'ads'),
  createMCPTool('getROIComparison', AdsToolDefs.getROIComparison, adsHandlers.getROIComparison, 'ads'),
  // WRITE tools - Campaigns & AdSets
  createMCPTool('pauseCampaign', AdsToolDefs.pauseCampaign, adsHandlers.pauseCampaign, 'ads'),
  createMCPTool('resumeCampaign', AdsToolDefs.resumeCampaign, adsHandlers.resumeCampaign, 'ads'),
  createMCPTool('pauseAdSet', AdsToolDefs.pauseAdSet, adsHandlers.pauseAdSet, 'ads'),
  createMCPTool('resumeAdSet', AdsToolDefs.resumeAdSet, adsHandlers.resumeAdSet, 'ads'),
  createMCPTool('updateBudget', AdsToolDefs.updateBudget, adsHandlers.updateBudget, 'ads'),
  // WRITE tools - Directions
  createMCPTool('updateDirectionBudget', AdsToolDefs.updateDirectionBudget, adsHandlers.updateDirectionBudget, 'ads'),
  createMCPTool('updateDirectionTargetCPL', AdsToolDefs.updateDirectionTargetCPL, adsHandlers.updateDirectionTargetCPL, 'ads'),
  createMCPTool('pauseDirection', AdsToolDefs.pauseDirection, adsHandlers.pauseDirection, 'ads')
];

/**
 * All MCP tools - Phase 4 complete
 * WhatsApp (4) + CRM (4) + Creative (15) + Ads (17) = 40 tools
 */
export const allMCPTools = [
  ...whatsappTools,
  ...crmTools,
  ...creativeTools,
  ...adsTools
];

/**
 * Get tool by name
 * @param {string} name
 * @returns {Object|undefined}
 */
export function getToolByName(name) {
  return allMCPTools.find(t => t.name === name);
}

/**
 * Get all tools for a specific agent
 * @param {string} agent
 * @returns {Array}
 */
export function getToolsByAgent(agent) {
  return allMCPTools.filter(t => t.agent === agent);
}

/**
 * List of dangerous tools that require confirmation
 * These tools can spend money or make irreversible changes
 */
export const DANGEROUS_TOOLS = [
  // Creative (3 dangerous)
  'launchCreative',      // Spends budget
  'pauseCreative',       // Stops ads
  'startCreativeTest',   // Spends ~$20
  // Ads (6 dangerous)
  'pauseCampaign',       // Stops campaign
  'pauseAdSet',          // Stops adset
  'updateBudget',        // Changes spending
  'updateDirectionBudget', // Changes spending
  'pauseDirection'       // Stops all direction ads
];

/**
 * Check if a tool is dangerous
 * @param {string} toolName
 * @returns {boolean}
 */
export function isDangerousTool(toolName) {
  return DANGEROUS_TOOLS.includes(toolName);
}

export default allMCPTools;
