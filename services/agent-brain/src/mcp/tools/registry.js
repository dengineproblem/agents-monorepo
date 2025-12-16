/**
 * MCP Tool Registry
 *
 * Unified registry for all MCP tools.
 * Provides tool discovery for tools/list requests.
 */

import { allMCPTools, getToolByName } from './definitions.js';

/**
 * Get all registered tools in MCP format
 * @returns {Array} Tools for tools/list response
 */
export function getToolRegistry() {
  return allMCPTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }));
}

/**
 * Get tool handler by name
 * @param {string} name
 * @returns {Function|undefined}
 */
export function getToolHandler(name) {
  const tool = getToolByName(name);
  return tool?.handler;
}

/**
 * Check if tool exists
 * @param {string} name
 * @returns {boolean}
 */
export function hasToolHandler(name) {
  return !!getToolByName(name);
}

/**
 * Get tool metadata
 * @param {string} name
 * @returns {Object|undefined}
 */
export function getToolMeta(name) {
  const tool = getToolByName(name);
  return tool?.meta;
}

/**
 * Get all tool names
 * @returns {string[]}
 */
export function getAllToolNames() {
  return allMCPTools.map(t => t.name);
}

export default {
  getToolRegistry,
  getToolHandler,
  hasToolHandler,
  getToolMeta,
  getAllToolNames
};
