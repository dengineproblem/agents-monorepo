/**
 * MCP Tool Executor
 *
 * Выполняет инструменты MCP с инъекцией контекста пользователя.
 * Обрабатывает таймауты и ошибки.
 *
 * Hybrid C: Добавлена проверка dangerous tools и approval flow.
 */

import { getToolByName, isDangerousTool } from './definitions.js';
import { incrementToolCalls, incrementToolCallsAsync } from '../sessions.js';
import { logger } from '../../lib/logger.js';

/**
 * Execute a tool with user context
 * @param {string} name - Tool name
 * @param {Object} args - Tool arguments
 * @param {Object} context - Session context
 * @param {string} context.userAccountId
 * @param {string} context.adAccountId
 * @param {string} context.accessToken
 * @param {string} [context.dangerousPolicy='block'] - Policy for dangerous tools
 * @param {string} [context.conversationId] - Conversation ID for pending plan
 * @param {string} [context.sessionId] - MCP session ID for tool call limits
 * @returns {Promise<Object>} Tool result or approval_required response
 */
export async function executeToolWithContext(name, args, context) {
  const { layerLogger } = context;

  // Layer 7: MCP Executor start
  layerLogger?.start(7, { toolName: name });

  const tool = getToolByName(name);

  if (!tool) {
    layerLogger?.error(7, new Error(`Tool not found: ${name}`));
    throw new Error(`Tool not found: ${name}`);
  }

  // Hybrid: Check maxToolCalls limit before executing
  if (context.sessionId) {
    const limitCheck = context.useRedis
      ? await incrementToolCallsAsync(context.sessionId)
      : incrementToolCalls(context.sessionId);

    if (!limitCheck.allowed) {
      layerLogger?.end(7, { toolName: name, error: 'TOOL_CALL_LIMIT' });
      return {
        success: false,
        error: 'tool_call_limit_reached',
        message: `Достигнут лимит вызовов инструментов (${limitCheck.max}). Уточните запрос или начните новую сессию.`,
        meta: {
          toolCallsUsed: limitCheck.used,
          maxToolCalls: limitCheck.max,
          sessionId: context.sessionId
        }
      };
    }
  }

  const { handler, meta } = tool;
  const timeout = meta?.timeout || 30000;

  // Phase 2: Validate arguments against Zod schema
  const validation = validateToolArgs(name, args);
  if (!validation.valid) {
    // Detailed logging for debugging
    logger.warn({
      tool: name,
      receivedArgs: args,
      errors: validation.errors
    }, 'Tool validation failed');

    layerLogger?.end(7, { toolName: name, error: 'VALIDATION_ERROR' });
    return {
      success: false,
      error: 'validation_error',
      message: formatValidationErrors(validation.errors),
      validation_errors: validation.errors
    };
  }
  // Use coerced args (with defaults applied)
  const validatedArgs = validation.coerced || args;

  layerLogger?.info(7, 'Validation passed', { toolName: name });

  // Hybrid C: Check if dangerous tool requires approval
  if (isDangerousTool(name)) {
    const dangerousPolicy = context.dangerousPolicy || 'block';

    layerLogger?.info(7, 'Dangerous tool detected', { toolName: name, policy: dangerousPolicy });

    if (dangerousPolicy === 'block') {
      // Return approval_required instead of executing
      layerLogger?.end(7, { toolName: name, approval_required: true });
      return {
        approval_required: true,
        tool: name,
        args: validatedArgs,  // Use validated args with defaults
        reason: getToolDangerReason(name),
        meta: {
          dangerous: true,
          conversationId: context.conversationId
        }
      };
    }
    // dangerousPolicy === 'allow' - proceed with execution
  }

  // Layer 8: Domain Handler start
  layerLogger?.start(8, { handler: name, timeout });

  // Build tool context (matches existing agent handler signature)
  const toolContext = {
    userAccountId: context.userAccountId,
    adAccountId: context.adAccountId,
    adAccountDbId: context.adAccountDbId,  // UUID for database queries
    accessToken: context.accessToken
  };

  try {
    // Execute with timeout (using validated args with defaults)
    const result = await Promise.race([
      handler(validatedArgs, toolContext),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Tool timeout after ${timeout}ms`)), timeout)
      )
    ]);

    layerLogger?.end(8, { handler: name, success: result?.success !== false });
    layerLogger?.end(7, { toolName: name, success: true });

    return result;
  } catch (error) {
    layerLogger?.error(8, error, { handler: name });
    layerLogger?.end(7, { toolName: name, error: error.message });
    throw error;
  }
}

/**
 * Get human-readable reason why a tool is dangerous
 * @param {string} toolName
 * @returns {string}
 */
function getToolDangerReason(toolName) {
  const reasons = {
    // Creative tools
    launchCreative: 'Запустит рекламу и начнёт расходовать бюджет',
    pauseCreative: 'Остановит рекламу креатива',
    startCreativeTest: 'Запустит A/B тест (~$20 бюджет)',
    // Ads tools
    pauseCampaign: 'Остановит всю кампанию',
    pauseAdSet: 'Остановит адсет',
    updateBudget: 'Изменит дневной бюджет адсета',
    updateDirectionBudget: 'Изменит суточный бюджет направления',
    pauseDirection: 'Остановит все адсеты направления'
  };

  return reasons[toolName] || 'Действие может изменить рекламные кампании или бюджеты';
}

/**
 * Validate tool arguments against Zod schema
 * @param {string} name - Tool name
 * @param {Object} args - Arguments to validate
 * @returns {{valid: boolean, errors?: Array<{field: string, message: string}>, coerced?: Object}}
 */
export function validateToolArgs(name, args) {
  const tool = getToolByName(name);

  if (!tool) {
    return { valid: false, errors: [{ field: '_tool', message: `Tool not found: ${name}` }] };
  }

  const { zodSchema } = tool;

  if (!zodSchema) {
    // No schema defined, assume valid
    return { valid: true, coerced: args };
  }

  try {
    // safeParse returns { success, data, error }
    const result = zodSchema.safeParse(args);

    if (result.success) {
      // Return coerced/defaulted data
      return { valid: true, coerced: result.data };
    }

    // Format Zod errors into readable format
    const errors = result.error.issues.map(issue => ({
      field: issue.path.join('.') || '_root',
      message: issue.message,
      code: issue.code,
      expected: issue.expected,
      received: issue.received
    }));

    return { valid: false, errors };

  } catch (error) {
    return {
      valid: false,
      errors: [{ field: '_validation', message: `Validation error: ${error.message}` }]
    };
  }
}

/**
 * Format validation errors for user display
 * @param {Array<{field: string, message: string}>} errors
 * @returns {string}
 */
export function formatValidationErrors(errors) {
  if (!errors || errors.length === 0) return '';

  return errors.map(e => {
    if (e.field === '_root' || e.field === '_tool' || e.field === '_validation') {
      return e.message;
    }
    return `${e.field}: ${e.message}`;
  }).join('; ');
}

export default { executeToolWithContext, validateToolArgs, getToolDangerReason, formatValidationErrors };
