/**
 * MCP Tool Definitions
 *
 * Конвертирует существующие toolDefs агентов в формат MCP.
 * Использует zod-to-json-schema для преобразования Zod схем в JSON Schema.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import { WhatsappToolDefs } from '../../chatAssistant/agents/whatsapp/toolDefs.js';
import { whatsappHandlers } from '../../chatAssistant/agents/whatsapp/handlers.js';

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
 * All MCP tools - will be extended with other agents in future phases
 * Phase 2: WhatsApp (4 tools)
 * Phase 4: CRM (4 tools), Creative (15 tools), Ads (15 tools)
 */
export const allMCPTools = [
  ...whatsappTools
  // TODO Phase 4: Add CRM, Creative, Ads tools
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

export default allMCPTools;
