/**
 * Claude Agent SDK Orchestrator
 *
 * Использует Claude Agent SDK (@anthropic-ai/claude-agent-sdk) для обработки сообщений.
 * Аналог metaOrchestrator.js но с Claude вместо OpenAI.
 *
 * Features:
 * - query() с agentic tool loop
 * - Skills из .claude/skills/
 * - MCP интеграция через mcpServers
 * - SSE streaming совместимый с frontend
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { mapSdkMessageToSseEvent } from '../metaTools/claudeAdapter.js';
import { buildMetaSystemPrompt } from './metaSystemPrompt.js';
import { runsStore } from '../stores/runsStore.js';
import { logger } from '../../lib/logger.js';
import { createSession, deleteSession } from '../../mcp/sessions.js';
import { createEmbeddedMcpServer } from '../../mcp/sdkMcpBridge.js';
import { ORCHESTRATOR_CONFIG } from '../config.js';

// Model configuration
const MODEL = process.env.CLAUDE_MODEL || ORCHESTRATOR_CONFIG.claudeModel || 'claude-sonnet-4-20250514';
const MAX_TURNS = parseInt(process.env.CLAUDE_MAX_TURNS || String(ORCHESTRATOR_CONFIG.claudeMaxTurns) || '10', 10);
const QUERY_TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS || '120000', 10); // 2 minutes default

/**
 * Create a timeout promise that rejects after specified ms
 * @param {number} ms - Timeout in milliseconds
 * @param {string} operation - Operation name for error message
 * @returns {Promise<never>}
 */
function createTimeout(ms, operation) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`${operation} timed out after ${ms}ms`));
    }, ms);
  });
}

/**
 * Wrap async generator with timeout
 * @param {AsyncGenerator} generator - Source generator
 * @param {number} timeoutMs - Timeout for each iteration
 * @returns {AsyncGenerator}
 */
async function* withIterationTimeout(generator, timeoutMs) {
  const startTime = Date.now();
  for await (const value of generator) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Claude query exceeded total timeout of ${timeoutMs}ms`);
    }
    yield value;
  }
}

/**
 * Process message with Claude Agent SDK
 *
 * @param {Object} params
 * @param {string} params.message - User message
 * @param {Object} params.context - Business context
 * @param {Array} params.conversationHistory - Previous messages
 * @param {Object} params.toolContext - Context for tool execution
 * @param {Function} params.onToolEvent - Callback for tool events (optional)
 * @returns {AsyncGenerator<Object>} SSE events generator
 */
export async function* processWithClaudeSDK({
  message,
  context,
  conversationHistory = [],
  toolContext = {},
  onToolEvent = null
}) {
  const startTime = Date.now();
  const { layerLogger, mode } = toolContext;
  const requestId = `claude-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Detailed startup logging
  logger.info({
    requestId,
    model: MODEL,
    maxTurns: MAX_TURNS,
    timeoutMs: QUERY_TIMEOUT_MS,
    mode,
    messageLength: message?.length || 0,
    historyLength: conversationHistory.length,
    hasContext: !!context,
    userAccountId: toolContext.userAccountId,
    adAccountId: toolContext.adAccountId
  }, 'Claude orchestrator starting');

  // Layer 3: Claude Orchestrator start
  layerLogger?.start(3, { model: MODEL, maxTurns: MAX_TURNS, mode, provider: 'claude', requestId });

  // Determine dangerous policy based on mode
  const dangerousPolicy = mode === 'plan' ? 'allow' : 'block';

  // Create MCP session for this request
  const sessionId = createSession({
    userAccountId: toolContext.userAccountId,
    adAccountId: toolContext.adAccountId,
    adAccountDbId: toolContext.adAccountDbId,
    accessToken: toolContext.accessToken,
    conversationId: toolContext.conversationId,
    dangerousPolicy,
    integrations: context?.integrations
  });

  layerLogger?.info(3, 'MCP session created for Claude', { sessionId: sessionId.substring(0, 8), dangerousPolicy });
  logger.info({
    requestId,
    sessionId: sessionId.substring(0, 8),
    mode,
    dangerousPolicy,
    model: MODEL,
    hasIntegrations: !!context?.integrations
  }, 'Claude MCP session created');

  // Build system prompt
  const systemPrompt = buildMetaSystemPrompt(context, { mode, dangerousPolicy });

  // Generate conversation ID
  const conversationId = toolContext.conversationId || `claude-${Date.now()}`;

  // Yield init event
  yield {
    type: 'init',
    conversationId,
    mode: mode || 'auto'
  };

  // Create run record
  let runId = null;
  if (toolContext?.conversationId && toolContext?.userAccountId) {
    try {
      const run = await runsStore.create({
        conversationId: toolContext.conversationId,
        userAccountId: toolContext.userAccountId,
        model: MODEL,
        agent: 'ClaudeOrchestrator',
        domain: 'meta',
        userMessage: message,
        promptVersion: 'claude-v1'
      });
      runId = run.id;
    } catch (err) {
      logger.warn({ error: err.message }, 'Failed to create run record');
    }
  }

  // Tool execution tracking
  const executedTools = [];
  let accumulatedText = '';
  let extractedPlan = null;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    // Create embedded SDK MCP server with all tools
    const { server: mcpServer, allowedToolNames, registeredCount } = createEmbeddedMcpServer({
      userAccountId: toolContext.userAccountId,
      adAccountId: toolContext.adAccountId,
      adAccountDbId: toolContext.adAccountDbId,
      accessToken: toolContext.accessToken,
      dangerousPolicy,
      conversationId,
      onToolCall: (event) => {
        // Track tool execution
        if (event.started) {
          layerLogger?.start(4, { toolName: event.name });
          onToolEvent?.({ type: 'tool_start', name: event.name, args: event.args });
          logger.info({ requestId, toolName: event.name, argsKeys: Object.keys(event.args || {}) }, 'Claude MCP tool started');
        } else {
          const toolEntry = {
            tool: event.name,
            args: event.args,
            result: event.success ? 'success' : 'failed',
            latencyMs: event.latencyMs
          };
          if (!event.success) toolEntry.message = event.error;
          executedTools.push(toolEntry);

          // Record in runsStore
          if (runId) {
            runsStore.recordToolExecution(runId, {
              name: event.name,
              args: event.args,
              success: event.success,
              latencyMs: event.latencyMs,
              ...(event.error && { error: event.error })
            }).catch(err => logger.warn({ error: err.message }, 'Failed to record tool execution'));
          }

          layerLogger?.end(4, { toolName: event.name, success: event.success, latencyMs: event.latencyMs });
          onToolEvent?.({
            type: 'tool_result',
            name: event.name,
            success: event.success,
            duration: event.latencyMs,
            ...(event.error && { error: event.error })
          });

          logger.info({
            requestId,
            toolName: event.name,
            success: event.success,
            latencyMs: event.latencyMs
          }, 'Claude MCP tool completed');
        }
      }
    });

    logger.info({ requestId, registeredCount, allowedToolsCount: allowedToolNames.length }, 'Embedded MCP server created');

    // Build prompt with conversation history
    // SDK query() only supports type: "user" in prompt generator,
    // so we embed history as context in a single user message
    let promptText = message;

    if (conversationHistory.length > 0) {
      const historyText = conversationHistory
        .map(msg => `${msg.role === 'assistant' ? 'assistant' : 'user'}: ${msg.content}`)
        .join('\n');
      promptText = `<conversation_history>\n${historyText}\n</conversation_history>\n\n${message}`;
    }

    // Create async generator for prompt
    async function* generatePrompt() {
      yield {
        type: 'user',
        message: { role: 'user', content: promptText }
      };
    }

    // Query Claude Agent SDK with embedded MCP server
    const sdkOptions = {
      systemPrompt,
      model: MODEL,
      maxTurns: MAX_TURNS,
      cwd: process.cwd(),
      // Embedded MCP server (no HTTP, tools run in-process)
      mcpServers: {
        'meta-ads': mcpServer
      },
      // Allow all registered MCP tools without permission prompts
      allowedTools: allowedToolNames
    };

    // Query Claude SDK with timeout wrapper
    logger.info({ requestId, model: MODEL, maxTurns: MAX_TURNS }, 'Starting Claude SDK query');

    let messageCount = 0;
    let lastMessageType = null;

    const sdkQuery = query({
      prompt: generatePrompt(),
      options: sdkOptions
    });

    // Wrap with timeout
    for await (const sdkMessage of withIterationTimeout(sdkQuery, QUERY_TIMEOUT_MS)) {
      messageCount++;
      lastMessageType = sdkMessage?.type;

      // Detailed message logging (debug level for high-volume events)
      if (sdkMessage?.type === 'stream_event') {
        logger.debug({ requestId, messageCount, type: sdkMessage.type }, 'Claude SDK stream event');
      } else {
        logger.info({
          requestId,
          messageCount,
          type: sdkMessage?.type,
          subtype: sdkMessage?.subtype,
          hasUsage: !!sdkMessage?.usage,
          hasContent: !!sdkMessage?.message?.content
        }, 'Claude SDK message received');
      }

      // Track tokens if available
      if (sdkMessage.usage) {
        totalInputTokens += sdkMessage.usage.input_tokens || 0;
        totalOutputTokens += sdkMessage.usage.output_tokens || 0;
        logger.debug({
          requestId,
          inputTokens: sdkMessage.usage.input_tokens,
          outputTokens: sdkMessage.usage.output_tokens,
          totalInput: totalInputTokens,
          totalOutput: totalOutputTokens
        }, 'Claude token usage update');
      }

      // Map SDK message to SSE event(s)
      const sseEvents = mapSdkMessageToSseEvent(sdkMessage);

      if (sseEvents) {
        // Handle array of events
        const events = Array.isArray(sseEvents) ? sseEvents : [sseEvents];

        for (const event of events) {
          if (event.type === 'text') {
            accumulatedText += event.content || '';
            yield {
              ...event,
              accumulated: accumulatedText
            };
          } else if (event.type === 'tool_start') {
            // Tools execute automatically via embedded MCP server
            yield event;
          } else if (event.type === 'done') {
            logger.info({ requestId, hasContent: !!accumulatedText, toolCount: executedTools.length }, 'Claude done event');
            // Add accumulated data to done event
            yield {
              ...event,
              content: accumulatedText || event.content,
              executedActions: executedTools,
              plan: extractedPlan
            };
          } else {
            yield event;
          }
        }
      }
    }

    logger.info({ requestId, totalMessages: messageCount, lastMessageType }, 'Claude SDK query stream completed');

    // Complete run
    if (runId) {
      await runsStore.complete(runId, {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        latencyMs: Date.now() - startTime
      });
    }

    const latency = Date.now() - startTime;
    logger.info({
      requestId,
      model: MODEL,
      toolCalls: executedTools.length,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      latencyMs: latency,
      contentLength: accumulatedText?.length || 0,
      hasPlan: !!extractedPlan
    }, 'Claude orchestrator completed successfully');

    layerLogger?.end(3, { toolCalls: executedTools.length, tokens: totalInputTokens + totalOutputTokens });

    // Yield final done event if not already yielded
    if (accumulatedText && executedTools.length === 0) {
      yield {
        type: 'done',
        agent: 'claude',
        content: accumulatedText,
        executedActions: executedTools,
        toolCalls: executedTools,
        domain: 'meta',
        classification: { domain: 'meta', agents: ['claude'] },
        duration: latency,
        plan: extractedPlan
      };
    }

  } catch (error) {
    const latency = Date.now() - startTime;
    const isTimeout = error.message?.includes('timed out') || error.message?.includes('timeout');

    layerLogger?.error(3, error);
    logger.error({
      requestId,
      error: error.message,
      errorType: error.name || 'Error',
      errorStack: error.stack?.split('\n').slice(0, 5).join('\n'),
      isTimeout,
      latencyMs: latency,
      toolsExecuted: executedTools.length,
      accumulatedTextLength: accumulatedText?.length || 0
    }, 'Claude orchestrator failed');

    // Record failure
    if (runId) {
      await runsStore.fail(runId, {
        latencyMs: latency,
        errorMessage: error.message
      });
    }

    yield {
      type: 'error',
      message: error.message,
      isTimeout
    };

  } finally {
    // Cleanup MCP session
    deleteSession(sessionId);
    const totalLatency = Date.now() - startTime;
    layerLogger?.info(3, 'MCP session cleaned up', { sessionId: sessionId.substring(0, 8) });
    logger.info({
      requestId,
      sessionId: sessionId.substring(0, 8),
      totalLatencyMs: totalLatency
    }, 'Claude MCP session cleaned up');
  }
}

export default processWithClaudeSDK;
