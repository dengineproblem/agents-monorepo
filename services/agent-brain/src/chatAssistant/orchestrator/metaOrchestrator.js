/**
 * Meta-Tools Orchestrator
 *
 * Simplified orchestrator using GPT-5.2 Thinking with lazy-loading meta-tools.
 * Single LLM call with tool loop instead of intent detection + agent execution.
 */

import OpenAI from 'openai';
import { META_TOOLS, getMetaToolsForOpenAI } from '../metaTools/definitions.js';
import { buildMetaSystemPrompt } from './metaSystemPrompt.js';
import { runsStore } from '../stores/runsStore.js';
import { logger } from '../../lib/logger.js';
import { createSession, deleteSession } from '../../mcp/sessions.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Model configuration
const MODEL = process.env.META_ORCHESTRATOR_MODEL || 'gpt-5.2';
const MAX_ITERATIONS = 10;

/**
 * Process message with meta-tools architecture
 * @param {Object} params
 * @param {string} params.message - User message
 * @param {Object} params.context - Business context
 * @param {Array} params.conversationHistory - Previous messages
 * @param {Object} params.toolContext - Context for tool execution
 * @returns {Promise<Object>} Response with content and metadata
 */
export async function processWithMetaTools({
  message,
  context,
  conversationHistory = [],
  toolContext = {}
}) {
  const startTime = Date.now();
  const { layerLogger } = toolContext;

  // Layer 3: Meta Orchestrator start
  layerLogger?.start(3, { model: MODEL, maxIterations: MAX_ITERATIONS });

  // Create MCP session for this request
  const sessionId = createSession({
    userAccountId: toolContext.userAccountId,
    adAccountId: toolContext.adAccountId,
    accessToken: toolContext.accessToken,
    conversationId: toolContext.conversationId,
    dangerousPolicy: 'block',
    integrations: context?.integrations
  });

  // Enrich toolContext with sessionId for MCP bridge
  const enrichedToolContext = {
    ...toolContext,
    sessionId,
    dangerousPolicy: 'block',
    layerLogger // Pass logger to downstream
  };

  layerLogger?.info(3, 'MCP session created', { sessionId: sessionId.substring(0, 8) });
  logger.debug({ sessionId: sessionId.substring(0, 8) }, 'MCP session created for meta orchestrator');

  // Build system prompt with context
  const systemPrompt = buildMetaSystemPrompt(context);

  // Prepare messages
  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: message }
  ];

  // Get meta-tools for OpenAI
  const tools = getMetaToolsForOpenAI();

  // Create run record for tracing
  let runId = null;
  if (toolContext?.conversationId && toolContext?.userAccountId) {
    try {
      const run = await runsStore.create({
        conversationId: toolContext.conversationId,
        userAccountId: toolContext.userAccountId,
        model: MODEL,
        agent: 'MetaOrchestrator',
        domain: 'meta',
        userMessage: message,
        promptVersion: 'meta-v1'
      });
      runId = run.id;
    } catch (err) {
      logger.warn({ error: err.message }, 'Failed to create run record');
    }
  }

  // Tool execution tracking
  const executedTools = [];
  let iterations = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    // Tool call loop
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      layerLogger?.info(3, `LLM iteration ${iterations}`, { iteration: iterations });
      logger.debug({ iteration: iterations, messageCount: messages.length }, 'Meta orchestrator iteration');

      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
        temperature: 0.7
      });

      // Track tokens
      if (completion.usage) {
        totalInputTokens += completion.usage.prompt_tokens || 0;
        totalOutputTokens += completion.usage.completion_tokens || 0;
      }

      const assistantMessage = completion.choices[0].message;

      // No tool calls - final response
      if (!assistantMessage.tool_calls?.length) {
        // Layer 10: Response Assembly
        layerLogger?.start(10, { hasContent: !!assistantMessage.content });

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
          model: MODEL,
          iterations,
          toolCalls: executedTools.length,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          latencyMs: latency
        }, 'Meta orchestrator completed');

        layerLogger?.end(10, { contentLength: assistantMessage.content?.length || 0 });
        layerLogger?.end(3, { iterations, toolCalls: executedTools.length, tokens: totalInputTokens + totalOutputTokens });

        return {
          content: assistantMessage.content,
          executedTools,
          iterations,
          tokens: {
            input: totalInputTokens,
            output: totalOutputTokens
          },
          latencyMs: latency,
          runId
        };
      }

      // Process tool calls
      messages.push(assistantMessage);

      // Execute tool calls in parallel
      const toolResults = await Promise.all(
        assistantMessage.tool_calls.map(async (toolCall) => {
          const toolName = toolCall.function.name;
          let toolArgs;

          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch (e) {
            toolArgs = {};
          }

          // Layer 4: Meta Tools
          layerLogger?.start(4, { toolName, iteration: iterations });

          // Find and execute meta-tool
          const metaTool = META_TOOLS[toolName];

          if (!metaTool) {
            layerLogger?.error(4, new Error(`Unknown meta-tool: ${toolName}`));
            return {
              tool_call_id: toolCall.id,
              error: `Unknown meta-tool: ${toolName}`
            };
          }

          const toolStartTime = Date.now();

          try {
            const result = await metaTool.handler(toolArgs, {
              ...enrichedToolContext,
              integrations: context?.integrations
            });

            const toolLatency = Date.now() - toolStartTime;

            executedTools.push({
              name: toolName,
              args: toolArgs,
              success: true,
              latencyMs: toolLatency
            });

            // Record tool execution
            if (runId) {
              await runsStore.recordToolExecution(runId, {
                name: toolName,
                args: toolArgs,
                success: true,
                latencyMs: toolLatency
              });
            }

            layerLogger?.end(4, { toolName, success: true, latencyMs: toolLatency });

            return {
              tool_call_id: toolCall.id,
              content: JSON.stringify(result)
            };

          } catch (error) {
            const toolLatency = Date.now() - toolStartTime;

            executedTools.push({
              name: toolName,
              args: toolArgs,
              success: false,
              error: error.message,
              latencyMs: toolLatency
            });

            // Record failed execution
            if (runId) {
              await runsStore.recordToolExecution(runId, {
                name: toolName,
                args: toolArgs,
                success: false,
                latencyMs: toolLatency,
                error: error.message
              });
            }

            layerLogger?.error(4, error, { toolName });

            return {
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                success: false,
                error: error.message
              })
            };
          }
        })
      );

      // Add tool results to messages
      for (const result of toolResults) {
        messages.push({
          role: 'tool',
          tool_call_id: result.tool_call_id,
          content: result.content || JSON.stringify({ error: result.error })
        });
      }
    }

    // Max iterations reached
    layerLogger?.info(3, 'Max iterations reached', { iterations: MAX_ITERATIONS });
    logger.warn({ iterations: MAX_ITERATIONS, toolCalls: executedTools.length }, 'Meta orchestrator max iterations reached');

    // Layer 10: Response Assembly (forced)
    layerLogger?.start(10, { maxIterationsReached: true });

    // Get final response without tools
    const finalCompletion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.7
    });

    if (finalCompletion.usage) {
      totalInputTokens += finalCompletion.usage.prompt_tokens || 0;
      totalOutputTokens += finalCompletion.usage.completion_tokens || 0;
    }

    // Complete run
    if (runId) {
      await runsStore.complete(runId, {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        latencyMs: Date.now() - startTime
      });
    }

    layerLogger?.end(10, { contentLength: finalCompletion.choices[0].message.content?.length || 0 });
    layerLogger?.end(3, { iterations, maxIterationsReached: true });

    return {
      content: finalCompletion.choices[0].message.content,
      executedTools,
      iterations,
      maxIterationsReached: true,
      tokens: {
        input: totalInputTokens,
        output: totalOutputTokens
      },
      latencyMs: Date.now() - startTime,
      runId
    };

  } catch (error) {
    layerLogger?.error(3, error, { iterations });
    logger.error({ error: error.message, iterations }, 'Meta orchestrator failed');

    // Record failure
    if (runId) {
      await runsStore.fail(runId, {
        latencyMs: Date.now() - startTime,
        errorMessage: error.message
      });
    }

    throw error;
  } finally {
    // Cleanup MCP session
    deleteSession(sessionId);
    layerLogger?.info(3, 'MCP session cleaned up', { sessionId: sessionId.substring(0, 8) });
    logger.debug({ sessionId: sessionId.substring(0, 8) }, 'MCP session cleaned up');
  }
}

export default processWithMetaTools;
