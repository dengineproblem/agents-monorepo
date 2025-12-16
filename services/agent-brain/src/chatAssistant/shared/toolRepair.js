/**
 * Tool Repair Module — attempts to fix invalid tool arguments via LLM
 *
 * When tool validation fails, this module sends the error back to LLM
 * with a repair prompt, asking it to fix the arguments.
 *
 * Max 2 repair attempts before giving up.
 */

import OpenAI from 'openai';
import { logger } from '../../lib/logger.js';
import { toolRegistry } from './toolRegistry.js';

const MODEL = process.env.CHAT_ASSISTANT_MODEL || 'gpt-5.2';
const MAX_REPAIR_ATTEMPTS = 2;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Attempt to repair invalid tool arguments via LLM
 *
 * @param {Object} params
 * @param {string} params.toolName - Name of the tool
 * @param {Object} params.originalArgs - Original (invalid) arguments
 * @param {string} params.validationError - Error message from validation
 * @param {Object} params.toolDefinition - OpenAI tool definition (for schema)
 * @param {Array} params.conversationContext - Last few messages for context
 * @returns {Promise<{ success: boolean, repairedArgs?: Object, error?: string, attempts: number }>}
 */
export async function attemptToolRepair({
  toolName,
  originalArgs,
  validationError,
  toolDefinition,
  conversationContext = []
}) {
  let attempts = 0;
  let currentArgs = originalArgs;
  let currentError = validationError;

  while (attempts < MAX_REPAIR_ATTEMPTS) {
    attempts++;

    logger.info({
      toolName,
      attempt: attempts,
      error: currentError
    }, 'Attempting to repair tool arguments');

    try {
      const repairPrompt = buildRepairPrompt({
        toolName,
        args: currentArgs,
        error: currentError,
        toolDefinition
      });

      const messages = [
        ...conversationContext.slice(-3), // Last 3 messages for context
        { role: 'user', content: repairPrompt }
      ];

      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages,
        temperature: 0.1, // Low temperature for precise JSON generation
        max_tokens: 500
      });

      const response = completion.choices[0].message.content;

      // Extract JSON from response
      const repairedArgs = extractJsonFromResponse(response);

      if (!repairedArgs) {
        logger.warn({
          toolName,
          attempt: attempts,
          response: response?.substring(0, 200)
        }, 'Failed to extract JSON from repair response');

        currentError = 'Could not parse repaired arguments as JSON';
        continue;
      }

      // Validate repaired arguments
      const validation = toolRegistry.validate(toolName, repairedArgs);

      if (validation.success) {
        logger.info({
          toolName,
          attempts,
          originalArgs,
          repairedArgs: validation.data
        }, 'Successfully repaired tool arguments');

        return {
          success: true,
          repairedArgs: validation.data,
          attempts
        };
      }

      // Still invalid — try again
      currentArgs = repairedArgs;
      currentError = validation.error;

      logger.debug({
        toolName,
        attempt: attempts,
        newError: validation.error
      }, 'Repaired arguments still invalid, retrying');

    } catch (error) {
      logger.error({
        toolName,
        attempt: attempts,
        error: error.message
      }, 'Error during tool repair attempt');

      return {
        success: false,
        error: `Repair failed: ${error.message}`,
        attempts
      };
    }
  }

  // Exhausted attempts
  logger.warn({
    toolName,
    attempts,
    finalError: currentError
  }, 'Tool repair exhausted all attempts');

  return {
    success: false,
    error: currentError,
    attempts
  };
}

/**
 * Build the repair prompt for LLM
 */
function buildRepairPrompt({ toolName, args, error, toolDefinition }) {
  const schemaDescription = toolDefinition?.parameters
    ? JSON.stringify(toolDefinition.parameters, null, 2)
    : 'Schema not available';

  return `Исправь аргументы для инструмента "${toolName}".

## Ошибка валидации
${error}

## Текущие аргументы (невалидные)
\`\`\`json
${JSON.stringify(args, null, 2)}
\`\`\`

## Ожидаемая схема
\`\`\`json
${schemaDescription}
\`\`\`

## Задача
Верни ТОЛЬКО исправленный JSON объект с аргументами, без пояснений.
Убедись что все обязательные поля заполнены и типы данных корректны.

\`\`\`json`;
}

/**
 * Extract JSON object from LLM response
 * Handles various formats: raw JSON, markdown code blocks, etc.
 */
function extractJsonFromResponse(response) {
  if (!response) return null;

  // Try direct parse first
  try {
    return JSON.parse(response.trim());
  } catch (e) {
    // Continue to other methods
  }

  // Try to find JSON in code blocks
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (e) {
      // Continue
    }
  }

  // Try to find any JSON object in the response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      // Give up
    }
  }

  return null;
}

/**
 * Check if error is repairable (validation error vs other errors)
 */
export function isRepairableError(error) {
  if (!error) return false;

  const repairablePatterns = [
    'Invalid arguments',
    'Validation error',
    'required',
    'must be',
    'expected',
    'type',
    'enum',
    'minimum',
    'maximum'
  ];

  const errorLower = error.toLowerCase();
  return repairablePatterns.some(pattern =>
    errorLower.includes(pattern.toLowerCase())
  );
}

export default {
  attemptToolRepair,
  isRepairableError
};
