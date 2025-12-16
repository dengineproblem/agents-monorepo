/**
 * MCP Tool Executor
 *
 * Выполняет инструменты MCP с инъекцией контекста пользователя.
 * Обрабатывает таймауты и ошибки.
 */

import { getToolByName } from './definitions.js';

/**
 * Execute a tool with user context
 * @param {string} name - Tool name
 * @param {Object} args - Tool arguments
 * @param {Object} context - Session context
 * @param {string} context.userAccountId
 * @param {string} context.adAccountId
 * @param {string} context.accessToken
 * @returns {Promise<Object>} Tool result
 */
export async function executeToolWithContext(name, args, context) {
  const tool = getToolByName(name);

  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }

  const { handler, meta } = tool;
  const timeout = meta?.timeout || 30000;

  // Build tool context (matches existing agent handler signature)
  const toolContext = {
    userAccountId: context.userAccountId,
    adAccountId: context.adAccountId,
    accessToken: context.accessToken
  };

  // Execute with timeout
  const result = await Promise.race([
    handler(args, toolContext),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Tool timeout after ${timeout}ms`)), timeout)
    )
  ]);

  return result;
}

/**
 * Validate tool arguments against schema
 * @param {string} name - Tool name
 * @param {Object} args - Arguments to validate
 * @returns {{valid: boolean, errors?: string[]}}
 */
export function validateToolArgs(name, args) {
  const tool = getToolByName(name);

  if (!tool) {
    return { valid: false, errors: [`Tool not found: ${name}`] };
  }

  // TODO: Implement Zod validation using original schema
  // For now, assume valid if tool exists
  return { valid: true };
}

export default { executeToolWithContext, validateToolArgs };
