/**
 * Moltbot Orchestrator
 *
 * Обрабатывает chat запросы через Moltbot Gateway.
 * Конвертирует WebSocket события в SSE для frontend.
 *
 * Flow:
 * 1. Подключиться к Gateway (с reuse из пула)
 * 2. Подписаться на события
 * 3. Отправить сообщение в сессию
 * 4. Стримить ответы через SSE
 * 5. Дождаться завершения
 *
 * Improvements:
 * - Connection pooling via getGateway()
 * - Single subscription (no duplicates)
 * - Proper cleanup in all cases
 * - Input validation
 * - Detailed logging with request tracing
 */

import { MoltbotGateway, getGateway } from './gateway.js';
import { logger } from '../lib/logger.js';
import { randomUUID } from 'node:crypto';
import { checkUserLimit, trackUsage, formatLimitExceededMessage } from '../lib/usageLimits.js';

const log = logger.child({ module: 'moltbot-orchestrator' });

// Configuration
const DEFAULT_TIMEOUT = 120000; // 2 minutes
const MIN_MESSAGE_LENGTH = 1;
const MAX_MESSAGE_LENGTH = 50000;

/**
 * Process streaming chat request via Moltbot
 * @param {Object} params
 * @param {string} params.message - User message
 * @param {string} params.conversationId - Conversation ID
 * @param {Function} params.sendEvent - SSE event sender
 * @param {Object} params.context - User context (adAccountId, accessToken, etc)
 * @param {Array} params.history - Conversation history
 * @param {number} params.timeout - Timeout in ms
 * @returns {Promise<Object>} Final response
 */
export async function processStreamRequest({
  message,
  conversationId,
  sendEvent,
  context = {},
  history = [],
  timeout = DEFAULT_TIMEOUT
}) {
  const requestId = `moltbot-${Date.now()}-${randomUUID().substring(0, 6)}`;
  const startTime = Date.now();

  // Input validation
  if (!message || typeof message !== 'string') {
    const error = new Error('Message is required and must be a string');
    log.error({ requestId, messageType: typeof message }, error.message);
    throw error;
  }

  if (message.length < MIN_MESSAGE_LENGTH || message.length > MAX_MESSAGE_LENGTH) {
    const error = new Error(`Message length must be between ${MIN_MESSAGE_LENGTH} and ${MAX_MESSAGE_LENGTH}`);
    log.error({ requestId, messageLength: message.length }, error.message);
    throw error;
  }

  if (!conversationId) {
    const error = new Error('conversationId is required');
    log.error({ requestId }, error.message);
    throw error;
  }

  if (typeof sendEvent !== 'function') {
    const error = new Error('sendEvent must be a function');
    log.error({ requestId }, error.message);
    throw error;
  }

  log.info({
    requestId,
    conversationId,
    messageLength: message.length,
    historyLength: history?.length || 0,
    hasContext: !!(context.adAccountId || context.userAccountId),
    timeout
  }, 'Moltbot stream request started');

  // Get gateway from pool (reuses connection if available)
  const gateway = getGateway(conversationId);
  let unsubscribe = null;
  let completionUnsubscribe = null;

  // Accumulated response state
  let accumulatedText = '';
  const toolCalls = [];
  let isCompleted = false;

  // Safe sendEvent wrapper (handles SSE errors)
  const safeSendEvent = (event) => {
    try {
      sendEvent(event);
      log.debug({ requestId, eventType: event.type }, 'SSE event sent');
    } catch (error) {
      log.warn({
        requestId,
        eventType: event.type,
        error: error.message
      }, 'Failed to send SSE event (client may have disconnected)');
    }
  };

  try {
    // Connect to gateway
    log.info({ requestId, connectionId: gateway.connectionId }, 'Connecting to Moltbot Gateway...');
    await gateway.connect();

    // ========== CHECK USER SPENDING LIMIT ==========
    if (context.telegramChatId) {
      const limitCheck = await checkUserLimit(context.telegramChatId);

      if (!limitCheck.allowed) {
        log.warn({
          requestId,
          telegramChatId: context.telegramChatId,
          limit: limitCheck.limit,
          spent: limitCheck.spent
        }, 'User daily limit exceeded');

        // Send error event
        safeSendEvent({
          type: 'error',
          error: 'daily_limit_exceeded',
          message: formatLimitExceededMessage(limitCheck),
          requestId
        });

        // Send done event
        safeSendEvent({
          type: 'done',
          content: formatLimitExceededMessage(limitCheck),
          duration: Date.now() - startTime,
          provider: 'moltbot',
          requestId
        });

        return {
          content: formatLimitExceededMessage(limitCheck),
          error: 'daily_limit_exceeded',
          limitExceeded: true
        };
      }

      log.debug({
        requestId,
        telegramChatId: context.telegramChatId,
        remaining: limitCheck.remaining.toFixed(4),
        limit: limitCheck.limit
      }, 'User limit check passed');
    }
    // ================================================

    // Send init event
    safeSendEvent({
      type: 'init',
      conversationId,
      mode: 'auto',
      provider: 'moltbot',
      requestId
    });

    // Build session context
    const contextMessage = buildContextMessage(context);
    const sessionId = `performante-${conversationId}`;

    log.info({
      requestId,
      sessionId,
      hasContext: !!contextMessage
    }, 'Session context prepared');

    // Subscribe to messages BEFORE sending
    unsubscribe = gateway.subscribe((event) => {
      if (isCompleted) return; // Ignore events after completion

      log.debug({
        requestId,
        eventMethod: event.method,
        eventType: event.params?.type
      }, 'Moltbot event received');

      handleMoltbotEvent(event, {
        requestId,
        accumulatedText,
        toolCalls,
        safeSendEvent,
        updateAccumulated: (text) => { accumulatedText = text; }
      });
    });

    // Send the message with context
    const fullMessage = contextMessage
      ? `${contextMessage}\n\n${message}`
      : message;

    log.info({
      requestId,
      sessionId,
      fullMessageLength: fullMessage.length
    }, 'Sending message to Moltbot...');

    await gateway.sendMessage(fullMessage, sessionId);

    log.info({ requestId }, 'Message sent, waiting for completion...');

    // Wait for completion
    const result = await waitForCompletion(gateway, requestId, timeout);

    isCompleted = true;
    const duration = Date.now() - startTime;

    // ========== TRACK USAGE ==========
    // Track AI usage if telegram user and usage data is available
    if (context.telegramChatId && result?.usage) {
      const modelName = result.model || 'gpt-5.2'; // Default to gpt-5.2 if not specified

      try {
        await trackUsage(
          context.telegramChatId,
          modelName,
          result.usage
        );

        log.debug({
          requestId,
          telegramChatId: context.telegramChatId,
          model: modelName,
          prompt_tokens: result.usage.prompt_tokens,
          completion_tokens: result.usage.completion_tokens
        }, 'Usage tracked successfully');
      } catch (error) {
        // Don't fail the request if tracking fails
        log.error({
          requestId,
          error: error.message,
          telegramChatId: context.telegramChatId
        }, 'Failed to track usage');
      }
    }
    // =================================

    // Final content from completion or accumulated
    const finalContent = accumulatedText || result?.content || '';

    // Send done event
    safeSendEvent({
      type: 'done',
      content: finalContent,
      executedActions: toolCalls.map(t => ({
        tool: t.name,
        args: t.args,
        result: t.result || 'completed'
      })),
      toolCalls,
      duration,
      provider: 'moltbot',
      requestId
    });

    log.info({
      requestId,
      duration,
      responseLength: finalContent.length,
      toolCallsCount: toolCalls.length,
      success: true
    }, 'Moltbot stream request completed successfully');

    return {
      success: true,
      content: finalContent,
      toolCalls,
      duration
    };

  } catch (error) {
    isCompleted = true;
    const duration = Date.now() - startTime;

    log.error({
      requestId,
      error: error.message,
      stack: error.stack,
      duration,
      accumulatedLength: accumulatedText.length,
      toolCallsCount: toolCalls.length
    }, 'Moltbot stream request failed');

    safeSendEvent({
      type: 'error',
      message: error.message,
      provider: 'moltbot',
      requestId,
      duration
    });

    throw error;

  } finally {
    // Cleanup subscriptions
    if (unsubscribe) {
      try {
        unsubscribe();
        log.debug({ requestId }, 'Main subscription cleaned up');
      } catch (e) {
        log.warn({ requestId, error: e.message }, 'Error cleaning up subscription');
      }
    }

    if (completionUnsubscribe) {
      try {
        completionUnsubscribe();
        log.debug({ requestId }, 'Completion subscription cleaned up');
      } catch (e) {
        log.warn({ requestId, error: e.message }, 'Error cleaning up completion subscription');
      }
    }

    // Note: We don't close the gateway here because it's pooled
    // Pool will handle cleanup of old connections
    log.debug({ requestId }, 'Request cleanup completed');
  }
}

/**
 * Handle Moltbot event and update state
 * @param {Object} event - Moltbot event
 * @param {Object} state - Processing state
 */
function handleMoltbotEvent(event, state) {
  const { requestId, safeSendEvent, updateAccumulated } = state;
  let { accumulatedText, toolCalls } = state;

  if (event.method !== 'message') return;

  const { params } = event;
  if (!params) return;

  // Text content
  if (params.type === 'text' || (params.content && !params.type)) {
    const text = params.content || params.text || '';
    if (text) {
      accumulatedText += text;
      updateAccumulated(accumulatedText);

      safeSendEvent({
        type: 'text',
        content: text,
        accumulated: accumulatedText
      });

      log.debug({
        requestId,
        chunkLength: text.length,
        totalLength: accumulatedText.length
      }, 'Text chunk received');
    }
  }

  // Tool use started
  if (params.type === 'tool_use' || params.tool) {
    const toolName = params.tool || params.name;
    const toolArgs = params.args || params.input || {};

    toolCalls.push({
      name: toolName,
      args: toolArgs,
      startTime: Date.now()
    });

    safeSendEvent({
      type: 'tool_start',
      name: toolName,
      args: toolArgs
    });

    log.info({
      requestId,
      toolName,
      toolIndex: toolCalls.length - 1
    }, 'Tool execution started');
  }

  // Tool result
  if (params.type === 'tool_result') {
    const toolName = params.name;
    const lastTool = toolCalls.find(t => t.name === toolName && !t.result);

    if (lastTool) {
      lastTool.result = params.error ? 'error' : 'success';
      lastTool.duration = Date.now() - lastTool.startTime;
    }

    safeSendEvent({
      type: 'tool_result',
      name: toolName,
      success: !params.error,
      duration: lastTool?.duration,
      error: params.error
    });

    log.info({
      requestId,
      toolName,
      success: !params.error,
      duration: lastTool?.duration
    }, 'Tool execution completed');
  }

  // Block content (alternative format)
  if (params.type === 'block' || params.block) {
    const block = params.block || params.content || '';
    if (block) {
      accumulatedText += block;
      updateAccumulated(accumulatedText);

      safeSendEvent({
        type: 'text',
        content: block,
        accumulated: accumulatedText
      });

      log.debug({
        requestId,
        blockLength: block.length,
        totalLength: accumulatedText.length
      }, 'Block received');
    }
  }
}

/**
 * Build context message for Moltbot
 * @param {Object} context
 * @returns {string|null}
 */
function buildContextMessage(context) {
  if (!context) return null;
  if (!context.adAccountId && !context.userAccountId) return null;

  const parts = ['[Контекст сессии]'];

  // User Account ID (UUID) - always required
  if (context.userAccountId) {
    parts.push(`User Account ID: ${context.userAccountId}`);
  }

  // Account ID (UUID from ad_accounts) - for multi-account mode
  if (context.accountId) {
    parts.push(`Account ID: ${context.accountId}`);
  }

  // Ad Account ID (Facebook act_xxx) - for API calls
  if (context.adAccountId) {
    parts.push(`Ad Account ID: ${context.adAccountId}`);
  }

  if (context.accessToken) {
    // Security: Don't include full token
    parts.push('Access Token: [available]');
  }

  log.debug({
    hasUserAccountId: !!context.userAccountId,
    hasAccountId: !!context.accountId,
    hasAdAccountId: !!context.adAccountId,
    hasAccessToken: !!context.accessToken
  }, 'Context message built');

  return parts.join('\n');
}

/**
 * Wait for Moltbot to complete response
 * Uses single subscription to avoid duplicates
 * @param {MoltbotGateway} gateway
 * @param {string} requestId
 * @param {number} timeout
 * @returns {Promise<Object>}
 */
function waitForCompletion(gateway, requestId, timeout) {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        log.error({ requestId, timeout }, 'Moltbot response timeout');
        reject(new Error(`Moltbot response timeout after ${timeout}ms`));
      }
    }, timeout);

    const unsubscribe = gateway.subscribe((event) => {
      if (resolved) return;

      if (event.method === 'message') {
        const { params } = event;

        // Completion signals
        if (params?.type === 'done' || params?.type === 'turn_end' || params?.done) {
          resolved = true;
          clearTimeout(timer);
          unsubscribe();

          log.info({
            requestId,
            completionType: params?.type || 'done'
          }, 'Completion signal received');

          resolve(params);
        }

        // Error signal
        if (params?.type === 'error') {
          resolved = true;
          clearTimeout(timer);
          unsubscribe();

          const errorMessage = params.message || params.error || 'Moltbot error';
          log.error({ requestId, error: errorMessage }, 'Error signal received');

          reject(new Error(errorMessage));
        }
      }
    });

    // Store unsubscribe for cleanup in case of external abort
    // (though Promise doesn't have built-in abort, this is for future use)
  });
}

/**
 * Health check for Moltbot Gateway
 * @returns {Promise<Object>}
 */
export async function checkHealth() {
  const gateway = new MoltbotGateway();

  try {
    const startTime = Date.now();
    await gateway.connect();
    const connectDuration = Date.now() - startTime;

    gateway.close();

    return {
      status: 'healthy',
      connectDuration,
      url: gateway.url
    };
  } catch (error) {
    gateway.close();

    return {
      status: 'unhealthy',
      error: error.message,
      url: gateway.url
    };
  }
}

export default { processStreamRequest, checkHealth };
