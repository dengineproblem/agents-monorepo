/**
 * Agents Index
 * Exports all specialized agents and registers tool definitions
 */

import { toolRegistry } from '../shared/toolRegistry.js';
import { AdsToolDefs } from './ads/toolDefs.js';
import { CreativeToolDefs } from './creative/toolDefs.js';
import { CrmToolDefs } from './crm/toolDefs.js';
import { WhatsappToolDefs } from './whatsapp/toolDefs.js';

// Register all tool definitions on module load
toolRegistry.registerFromDefs(AdsToolDefs);
toolRegistry.registerFromDefs(CreativeToolDefs);
toolRegistry.registerFromDefs(CrmToolDefs);
toolRegistry.registerFromDefs(WhatsappToolDefs);

export { BaseAgent } from './BaseAgent.js';
export { AdsAgent, adsAgent } from './ads/index.js';
export { WhatsAppAgent, whatsappAgent } from './whatsapp/index.js';
export { CRMAgent, crmAgent } from './crm/index.js';

// Map of agent names to instances
export const agents = {
  ads: () => import('./ads/index.js').then(m => m.adsAgent),
  whatsapp: () => import('./whatsapp/index.js').then(m => m.whatsappAgent),
  crm: () => import('./crm/index.js').then(m => m.crmAgent)
};

// Export registry for external access
export { toolRegistry };
