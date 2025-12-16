/**
 * MCP Module Entry Point
 *
 * Exports all MCP functionality for use in agent-brain.
 */

export { registerMCPRoutes } from './server.js';
export { createSession, getSession, deleteSession, extendSession, getSessionStats } from './sessions.js';
export { handleMCPRequest } from './protocol.js';
export { getToolRegistry, getToolHandler, hasToolHandler } from './tools/registry.js';
export { executeToolWithContext } from './tools/executor.js';
export { getResourceRegistry, readResource } from './resources/registry.js';

/**
 * MCP Configuration
 */
export const MCP_CONFIG = {
  get enabled() {
    return process.env.MCP_ENABLED === 'true';
  },
  get serverUrl() {
    return process.env.MCP_SERVER_URL || 'http://localhost:7080/mcp';
  },
  // Phase 2: Only WhatsApp enabled
  enabledAgents: ['whatsapp'],
  // Fallback to legacy orchestrator if MCP fails
  fallbackToLegacy: true
};
