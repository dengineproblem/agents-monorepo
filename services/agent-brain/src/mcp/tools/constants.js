/**
 * Tool Constants
 * Отдельный файл без тяжёлых зависимостей для использования в тестах
 */

// Dangerous tools - require approval
export const DANGEROUS_TOOLS = [
  // Creative tools
  'launchCreative',
  'pauseCreative',
  'startCreativeTest',
  'generateCreatives',
  // Ads tools
  'pauseCampaign',
  'resumeCampaign',
  'pauseAdSet',
  'resumeAdSet',
  'pauseAd',
  'updateBudget',
  'updateDirectionBudget',
  'pauseDirection',
  'triggerBrainOptimizationRun'  // Brain Agent - can change budgets, pause/resume adsets
];

/**
 * Check if tool is dangerous
 * @param {string} toolName
 * @returns {boolean}
 */
export function isDangerousTool(toolName) {
  return DANGEROUS_TOOLS.includes(toolName);
}
