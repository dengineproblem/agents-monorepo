/**
 * Agents Index
 * Exports all specialized agents
 */

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
