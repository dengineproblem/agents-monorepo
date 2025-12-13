/**
 * Idempotent Executor - Wrapper for executing tools with idempotency
 *
 * Ensures WRITE operations are executed only once:
 * - Checks if operation was already executed
 * - If yes - returns cached result with already_applied flag
 * - If no - executes and caches result
 */

import { idempotencyStore } from '../stores/idempotencyStore.js';
import { logger } from '../../lib/logger.js';

/**
 * WRITE tools that support idempotency
 * Only these tools will be checked for duplicates
 */
const IDEMPOTENT_TOOLS = new Set([
  // Ads Agent - campaigns
  'pauseCampaign',
  'resumeCampaign',
  'pauseAdSet',
  'resumeAdSet',
  'updateBudget',

  // Ads Agent - directions
  'updateDirectionBudget',
  'updateDirectionTargetCPL',
  'pauseDirection',
  'resumeDirection',

  // Creative Agent
  'launchCreative',
  'pauseCreative',
  'triggerCreativeAnalysis',
  'startCreativeTest',
  'stopCreativeTest',

  // CRM Agent
  'updateLeadStage',
  'updateLeadQualification',

  // WhatsApp Agent (if any WRITE tools)
  'sendMessage'
]);

/**
 * Tools with permanent TTL (no auto-expiration)
 * Used for critical operations where we want to track forever
 */
const PERMANENT_IDEMPOTENCY_TOOLS = new Set([
  'updateBudget',
  'updateDirectionBudget'
]);

/**
 * Execute a tool with idempotency check
 *
 * @param {string} toolName - Name of the tool
 * @param {Object} args - Tool arguments (may contain operation_id)
 * @param {Object} context - Execution context { userAccountId, adAccountId, planId, ... }
 * @param {Function} executor - Async function(args, context) => result
 * @returns {Promise<Object>} Result with optional already_applied flag
 *
 * @example
 * const result = await executeWithIdempotency(
 *   'updateBudget',
 *   { adset_id: '123', new_budget_cents: 5000 },
 *   { userAccountId, adAccountId },
 *   async (args, ctx) => handler(args, ctx)
 * );
 *
 * if (result.already_applied) {
 *   console.log('Operation was already executed at', result.applied_at);
 * }
 */
export async function executeWithIdempotency(toolName, args, context, executor) {
  // If tool doesn't support idempotency - execute directly
  if (!IDEMPOTENT_TOOLS.has(toolName)) {
    return executor(args, context);
  }

  // Skip idempotency for dry_run mode (preview only)
  if (args?.dry_run) {
    return executor(args, context);
  }

  const { userAccountId } = context;

  if (!userAccountId) {
    logger.warn({ toolName }, 'No userAccountId provided, skipping idempotency check');
    return executor(args, context);
  }

  // Generate or use provided operation key
  const operationKey = idempotencyStore.generateKey(toolName, args, userAccountId);

  try {
    // Check if already executed
    const cached = await idempotencyStore.check(operationKey, userAccountId);

    if (cached) {
      logger.info(
        {
          toolName,
          operationKey: operationKey.slice(0, 8) + '...',
          appliedAt: cached.created_at
        },
        'Idempotent operation already applied'
      );

      // Return cached result with already_applied flag
      return {
        ...cached.result,
        already_applied: true,
        applied_at: cached.created_at,
        original_operation_key: operationKey
      };
    }

    // Execute the operation
    const result = await executor(args, context);

    // Only cache successful results
    if (result?.success !== false) {
      const ttlHours = PERMANENT_IDEMPOTENCY_TOOLS.has(toolName) ? null : 24;

      // Save asynchronously (don't block on save)
      idempotencyStore
        .save(operationKey, {
          userAccountId,
          adAccountId: context.adAccountId,
          toolName,
          toolArgs: args,
          planId: context.planId,
          conversationId: context.conversationId,
          source: context.source || 'chat_assistant',
          ttlHours
        }, result)
        .catch(err => {
          logger.warn({ error: err.message, toolName, operationKey }, 'Failed to save idempotent operation');
        });
    }

    return result;
  } catch (err) {
    // On any idempotency error - execute operation anyway
    logger.error({ error: err.message, toolName }, 'Idempotency check failed, executing anyway');
    return executor(args, context);
  }
}

/**
 * Check if a tool supports idempotency
 *
 * @param {string} toolName - Tool name
 * @returns {boolean} True if tool is idempotent
 */
export function isIdempotentTool(toolName) {
  return IDEMPOTENT_TOOLS.has(toolName);
}

/**
 * Check if a tool has permanent idempotency (no TTL)
 *
 * @param {string} toolName - Tool name
 * @returns {boolean} True if tool has permanent idempotency
 */
export function hasPermanentIdempotency(toolName) {
  return PERMANENT_IDEMPOTENCY_TOOLS.has(toolName);
}

/**
 * Invalidate an idempotent operation (allow re-execution)
 *
 * @param {string} toolName - Tool name
 * @param {Object} args - Original tool arguments
 * @param {string} userAccountId - User account UUID
 */
export async function invalidateOperation(toolName, args, userAccountId) {
  const operationKey = idempotencyStore.generateKey(toolName, args, userAccountId);
  await idempotencyStore.invalidate(operationKey, userAccountId);
}

export default {
  executeWithIdempotency,
  isIdempotentTool,
  hasPermanentIdempotency,
  invalidateOperation
};
