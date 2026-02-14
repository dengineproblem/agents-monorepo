/**
 * Domain Definitions — maps domains to their tools and prompt files
 *
 * Tools are filtered by name from the main tools array in tools.ts.
 * Each domain has its own CLAUDE.md under groups/{domain}/.
 */
import Anthropic from '@anthropic-ai/sdk';
import { tools } from './tools.js';

export interface DomainConfig {
  name: string;
  promptFile: string;       // relative to groups/ directory
  toolNames: string[];      // tool names to include
  includeWebSearch: boolean;
}

// Tools available in every domain
const SHARED_TOOLS = ['getUserErrors', 'getKnowledgeBase'];

export const DOMAINS: Record<string, DomainConfig> = {
  ads: {
    name: 'Facebook Ads Specialist',
    promptFile: 'ads/CLAUDE.md',
    toolNames: [
      // READ
      'getCampaigns', 'getAdSets', 'getAds', 'getCampaignDetails',
      'getSpendReport', 'getDirections', 'getDirectionMetrics',
      'getDirectionCreatives', 'getDirectionInsights', 'getExternalCampaignMetrics',
      'getROIReport', 'getROIComparison', 'getAdAccountStatus',
      'getLeadsEngagementRate', 'getAgentBrainActions', 'triggerBrainOptimizationRun',
      // WRITE — Directions
      'pauseDirection', 'resumeDirection', 'updateDirectionBudget', 'updateDirectionTargetCPL',
      'createDirection', 'approveBrainActions',
      // WRITE — Launch (proxy to agent-service)
      'aiLaunch', 'createAdSet',
      // WRITE — Direct FB API
      'pauseCampaign', 'resumeCampaign',
      'pauseAdSet', 'resumeAdSet', 'updateBudget', 'scaleBudget',
      'pauseAd', 'resumeAd',
      // WRITE — Direct FB Entity Modifications
      'updateTargeting', 'updateSchedule', 'updateBidStrategy',
      'renameEntity', 'updateCampaignBudget',
      // READ — Insights Breakdown
      'getInsightsBreakdown',
      // WRITE — External campaigns
      'saveCampaignMapping',
      // Flexible FB API
      'customFbQuery',
      // Bridge: creative context for ROI
      'getCreatives', 'getTopCreatives', 'getWorstCreatives',
      ...SHARED_TOOLS,
    ],
    includeWebSearch: true,
  },

  creative: {
    name: 'Creatives Specialist',
    promptFile: 'creative/CLAUDE.md',
    toolNames: [
      // READ
      'getCreatives', 'getCreativeDetails', 'getCreativeMetrics',
      'getTopCreatives', 'getWorstCreatives', 'compareCreatives',
      'getCreativeAnalysis', 'getCreativeScores', 'getCreativeTests',
      'getCreativeTranscript',
      // WRITE
      'generateOffer', 'generateBullets', 'generateProfits', 'generateCta',
      'generateCreatives', 'generateCarouselTexts', 'generateCarousel',
      'generateTextCreative', 'createImageCreative',
      'pauseCreative', 'launchCreative', 'startCreativeTest', 'stopCreativeTest',
      'triggerCreativeAnalysis',
      // Bridge: directions for launching creatives
      'getDirections',
      ...SHARED_TOOLS,
    ],
    includeWebSearch: true,
  },

  crm: {
    name: 'CRM Specialist',
    promptFile: 'crm/CLAUDE.md',
    toolNames: [
      'getLeads', 'getSales', 'getFunnelStats', 'getDialogs',
      'analyzeDialog', 'getSalesQuality', 'addSale', 'updateLeadStage',
      ...SHARED_TOOLS,
    ],
    includeWebSearch: false,
  },

  tiktok: {
    name: 'TikTok Specialist',
    promptFile: 'tiktok/CLAUDE.md',
    toolNames: [
      'getTikTokCampaigns', 'compareTikTokWithFacebook', 'pauseTikTokCampaign',
      ...SHARED_TOOLS,
    ],
    includeWebSearch: true,
  },

  onboarding: {
    name: 'Onboarding Specialist',
    promptFile: 'onboarding/CLAUDE.md',
    toolNames: [
      'createUser',
      ...SHARED_TOOLS,
    ],
    includeWebSearch: false,
  },

  general: {
    name: 'General Assistant',
    promptFile: 'general/CLAUDE.md',
    toolNames: [...SHARED_TOOLS],
    includeWebSearch: true,
  },
};

// TikTok tools — фильтруются если нет tiktok в стеке
const TIKTOK_TOOL_NAMES = new Set([
  'getTikTokCampaigns', 'compareTikTokWithFacebook', 'pauseTikTokCampaign',
]);

/**
 * Get filtered Anthropic Tool definitions for a domain.
 * Returns all tools if domain is not found.
 */
export function getToolsForDomain(domain: string): Anthropic.Tool[] {
  const config = DOMAINS[domain];
  if (!config) return tools; // fallback: all tools
  return tools.filter(t => config.toolNames.includes(t.name));
}

/**
 * Get filtered tools with stack awareness.
 * Removes TikTok tools if user doesn't have tiktok in stack.
 */
export function getToolsForDomainWithStack(
  domain: string,
  userStack: string[],
): Anthropic.Tool[] {
  let filtered = getToolsForDomain(domain);
  if (!userStack.includes('tiktok')) {
    filtered = filtered.filter(t => !TIKTOK_TOOL_NAMES.has(t.name));
  }
  return filtered;
}
