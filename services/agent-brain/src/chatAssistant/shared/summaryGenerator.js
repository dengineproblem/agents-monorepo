/**
 * SummaryGenerator - LLM-based rolling summary for Chat Assistant
 * Compresses old messages to maintain context without exceeding token limits
 */

import OpenAI from 'openai';
import { logger } from '../../lib/logger.js';
import { unifiedStore } from '../stores/unifiedStore.js';

const SUMMARY_MODEL = process.env.SUMMARY_MODEL || 'gpt-4o-mini';

// Thresholds for triggering summary update
const MIN_MESSAGES_FOR_SUMMARY = 20;       // Don't summarize until we have this many messages
const MESSAGES_SINCE_LAST_SUMMARY = 10;    // Summarize every N new messages
const TOKEN_BUDGET_THRESHOLD = 0.9;        // Or when context is > 90% full

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Check if we should update the rolling summary
 * @param {Object} conversation - Conversation record from DB
 * @param {number} currentMessageCount - Current number of messages
 * @param {Object} tokenBudgetStats - Stats from token budget calculation
 * @returns {boolean}
 */
export function shouldUpdateSummary(conversation, currentMessageCount, tokenBudgetStats = {}) {
  const lastSummaryAt = conversation.summary_message_count || 0;
  const messagesSinceSummary = currentMessageCount - lastSummaryAt;

  // Rule 1: Enough messages AND enough new messages since last summary
  if (currentMessageCount >= MIN_MESSAGES_FOR_SUMMARY &&
      messagesSinceSummary >= MESSAGES_SINCE_LAST_SUMMARY) {
    logger.debug({
      conversationId: conversation.id,
      currentMessageCount,
      lastSummaryAt,
      messagesSinceSummary
    }, 'Summary update triggered by message count');
    return true;
  }

  // Rule 2: Token budget is almost full
  if (tokenBudgetStats.utilization && tokenBudgetStats.utilization >= TOKEN_BUDGET_THRESHOLD) {
    logger.debug({
      conversationId: conversation.id,
      utilization: tokenBudgetStats.utilization
    }, 'Summary update triggered by token budget');
    return true;
  }

  return false;
}

/**
 * Generate a compressed summary of messages
 * @param {string} existingSummary - Previous rolling summary (if any)
 * @param {Array} messages - Messages to summarize (OpenAI format)
 * @returns {Promise<string>} New compressed summary
 */
export async function generateSummary(existingSummary, messages) {
  if (!messages || messages.length === 0) {
    return existingSummary || '';
  }

  // Format messages for the prompt
  const formattedMessages = messages.map(m => {
    if (m.role === 'tool') {
      return `[Tool Result: ${m.content?.substring(0, 200)}...]`;
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const toolNames = m.tool_calls.map(tc => tc.function?.name).join(', ');
      return `Assistant: [Called tools: ${toolNames}] ${m.content || ''}`;
    }
    return `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`;
  }).join('\n');

  const systemPrompt = `Ты - помощник, который сжимает историю диалогов в краткое резюме.

Твоя задача: создать компактное резюме (максимум 500 слов), сохраняя важную информацию для продолжения диалога.

Обязательно сохрани:
1. О чём говорили (кампании, креативы, лиды, номера телефонов)
2. Какие действия выполнялись (пауза, изменение бюджета, запуск креатива)
3. Какие решения приняты пользователем
4. Важные числа и идентификаторы (ID кампаний, суммы, CPL)
5. Контекст для понимания следующих вопросов

НЕ включай:
- Приветствия и вежливые фразы
- Повторяющуюся информацию
- Детали, которые не влияют на продолжение диалога

Формат ответа: только текст резюме, без заголовков и форматирования.`;

  const userPrompt = existingSummary
    ? `Существующее резюме:\n${existingSummary}\n\nНовые сообщения для добавления в резюме:\n${formattedMessages}\n\nСоздай обновлённое резюме, объединив старую информацию с новой.`
    : `Сообщения для резюме:\n${formattedMessages}\n\nСоздай краткое резюме этого диалога.`;

  try {
    const response = await openai.chat.completions.create({
      model: SUMMARY_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 800
    });

    const summary = response.choices[0]?.message?.content?.trim() || '';

    logger.info({
      existingSummaryLength: existingSummary?.length || 0,
      messagesCount: messages.length,
      newSummaryLength: summary.length,
      model: SUMMARY_MODEL
    }, 'Generated rolling summary');

    return summary;

  } catch (error) {
    logger.error({ error: error.message }, 'Failed to generate summary');
    // Return existing summary if generation fails
    return existingSummary || '';
  }
}

/**
 * Update rolling summary for a conversation if needed
 * Call this after processing a message
 *
 * @param {string} conversationId
 * @param {Array} allMessages - All messages in conversation (OpenAI format)
 * @param {Object} tokenBudgetStats - Stats from token budget
 * @returns {Promise<boolean>} True if summary was updated
 */
export async function maybeUpdateRollingSummary(conversationId, allMessages, tokenBudgetStats = {}) {
  try {
    // Get conversation to check summary state
    const conversation = await unifiedStore.getById(conversationId);
    if (!conversation) {
      logger.warn({ conversationId }, 'Conversation not found for summary update');
      return false;
    }

    const messageCount = allMessages.length;

    // Check if we should update
    if (!shouldUpdateSummary(conversation, messageCount, tokenBudgetStats)) {
      return false;
    }

    // Keep last 10 messages fresh, summarize the rest
    const KEEP_RECENT = 10;
    const messagesToSummarize = allMessages.slice(0, -KEEP_RECENT);

    if (messagesToSummarize.length === 0) {
      return false;
    }

    // Generate new summary
    const existingSummary = conversation.rolling_summary || '';
    const newSummary = await generateSummary(existingSummary, messagesToSummarize);

    if (!newSummary) {
      return false;
    }

    // Save summary and update message count
    await unifiedStore.updateRollingSummary(conversationId, newSummary);
    await unifiedStore.updateSummaryMessageCount(conversationId, messageCount);

    logger.info({
      conversationId,
      messageCount,
      summaryLength: newSummary.length
    }, 'Updated rolling summary');

    return true;

  } catch (error) {
    logger.error({ error: error.message, conversationId }, 'Failed to update rolling summary');
    return false;
  }
}

/**
 * Format rolling summary for injection into system prompt
 * @param {string} rollingSummary
 * @returns {string} Formatted section for prompt
 */
export function formatSummaryForPrompt(rollingSummary) {
  if (!rollingSummary || rollingSummary.trim().length === 0) {
    return '';
  }

  return `
## Контекст предыдущего диалога

${rollingSummary}

---
`;
}

/**
 * Get summary context for a conversation
 * Returns the rolling summary and whether it's being used
 * @param {string} conversationId
 * @returns {Promise<{summary: string, used: boolean}>}
 */
export async function getSummaryContext(conversationId) {
  try {
    const conversation = await unifiedStore.getById(conversationId);
    const summary = conversation?.rolling_summary || '';
    return {
      summary,
      used: summary.length > 0,
      updatedAt: conversation?.summary_updated_at
    };
  } catch (error) {
    logger.warn({ error: error.message, conversationId }, 'Failed to get summary context');
    return { summary: '', used: false };
  }
}
