/**
 * BaseAgent - Base class for all specialized agents
 * Provides common functionality for LLM calls and tool execution
 */

import OpenAI from 'openai';
import { logger } from '../../lib/logger.js';
import { logErrorToAdmin } from '../../lib/errorLogger.js';
import { unifiedStore } from '../stores/unifiedStore.js';

const MODEL = process.env.CHAT_ASSISTANT_MODEL || 'gpt-4o';
const MAX_TOOL_CALLS = 5;
const MAX_STREAM_ITERATIONS = 5;

// Dangerous tools that ALWAYS require approval regardless of mode
const DANGEROUS_KEYWORDS = ['pause', 'delete', 'budget', 'bulk', 'массов'];

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export class BaseAgent {
  /**
   * @param {Object} config
   * @param {string} config.name - Agent name (e.g., 'AdsAgent')
   * @param {string} config.description - What this agent does
   * @param {Array} config.tools - OpenAI function definitions for this agent
   * @param {Object} config.handlers - Map of tool name to handler function
   * @param {Function} config.buildSystemPrompt - Function to build system prompt with context
   */
  constructor({ name, description, tools, handlers, buildSystemPrompt }) {
    this.name = name;
    this.description = description;
    this.tools = tools;
    this.handlers = handlers;
    this.buildSystemPrompt = buildSystemPrompt;
  }

  /**
   * Process a request through this agent
   * @param {Object} params
   * @param {string} params.message - User message
   * @param {Object} params.context - Business context (ads metrics, leads, etc.)
   * @param {string} params.mode - 'auto' | 'plan' | 'ask'
   * @param {Object} params.toolContext - Context for tool execution (tokens, IDs)
   * @param {Array} params.conversationHistory - Previous messages
   * @returns {Promise<Object>} Agent response
   */
  async process({ message, context, mode, toolContext, conversationHistory = [] }) {
    const startTime = Date.now();

    try {
      // Build system prompt with agent-specific context
      const systemPrompt = this.buildSystemPrompt(context, mode);

      // Prepare messages
      const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: message }
      ];

      // Call LLM with this agent's tools
      const response = await this.callLLMWithTools(messages, toolContext, mode);

      const duration = Date.now() - startTime;
      logger.info({ agent: this.name, duration, toolCalls: response.toolCalls?.length || 0 }, 'Agent processed request');

      return {
        agent: this.name,
        content: response.content,
        executedActions: response.executedActions,
        toolCalls: response.toolCalls
      };

    } catch (error) {
      logger.error({ agent: this.name, error: error.message }, 'Agent processing failed');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: `agent_${this.name}_process`,
        severity: 'warning'
      }).catch(() => {});

      throw error;
    }
  }

  /**
   * Call LLM with tools and handle tool calls
   */
  async callLLMWithTools(messages, toolContext, mode) {
    const executedActions = [];
    const allToolCalls = [];

    let currentMessages = [...messages];
    let iterations = 0;

    // Format tools for OpenAI
    const openAITools = this.tools.map(tool => ({
      type: 'function',
      function: tool
    }));

    while (iterations < MAX_TOOL_CALLS) {
      iterations++;

      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: currentMessages,
        tools: openAITools.length > 0 ? openAITools : undefined,
        tool_choice: openAITools.length > 0 ? 'auto' : undefined,
        temperature: 0.7
      });

      const assistantMessage = completion.choices[0].message;

      // If no tool calls, return the response
      if (!assistantMessage.tool_calls?.length) {
        return {
          content: assistantMessage.content,
          executedActions,
          toolCalls: allToolCalls
        };
      }

      // Process tool calls
      currentMessages.push(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name;
        let toolArgs;

        try {
          toolArgs = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          toolArgs = {};
        }

        allToolCalls.push({ name: toolName, args: toolArgs });

        // Check if tool requires confirmation in current mode
        const requiresApproval = this.shouldRequireApproval(toolName, mode);

        if (requiresApproval) {
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              status: 'pending_approval',
              message: 'Это действие требует подтверждения перед выполнением'
            })
          });
          continue;
        }

        // Execute the tool
        const result = await this.executeTool(toolName, toolArgs, toolContext);

        executedActions.push({
          tool: toolName,
          args: toolArgs,
          result: result.success ? 'success' : 'failed',
          message: result.message || result.error
        });

        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }
    }

    // If we hit max iterations, get final response
    const lastCompletion = await openai.chat.completions.create({
      model: MODEL,
      messages: currentMessages,
      temperature: 0.7
    });

    return {
      content: lastCompletion.choices[0].message.content,
      executedActions,
      toolCalls: allToolCalls
    };
  }

  /**
   * Execute a tool by name
   */
  async executeTool(name, args, context) {
    const handler = this.handlers[name];

    if (!handler) {
      return {
        success: false,
        error: `Unknown tool: ${name}`
      };
    }

    try {
      const result = await handler(args, context);

      // Auto-update focus entities after successful tool execution
      if (result.success !== false && context.conversationId) {
        const focusEntities = this.extractFocusEntities(name, args, result);
        if (Object.keys(focusEntities).length > 0) {
          unifiedStore.updateFocusEntities(context.conversationId, focusEntities).catch(err => {
            logger.warn({ error: err.message, conversationId: context.conversationId }, 'Failed to update focus entities');
          });
        }
      }

      return result;
    } catch (error) {
      logger.error({ agent: this.name, tool: name, error: error.message }, 'Tool execution failed');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: `agent_${this.name}_tool_${name}`,
        severity: 'warning'
      }).catch(() => {});

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Extract focus entities from tool execution
   * Subclasses can override for agent-specific extraction
   */
  extractFocusEntities(toolName, args, result) {
    const entities = {};

    // Campaign-related tools
    if (toolName === 'getCampaignDetails' && args.campaignId) {
      entities.campaignId = args.campaignId;
    }
    if (toolName === 'getCampaigns' && result.campaigns?.length === 1) {
      entities.campaignId = result.campaigns[0].id;
    }

    // Direction-related tools
    if (toolName === 'getDirectionDetails' && args.directionId) {
      entities.directionId = args.directionId;
    }

    // Dialog-related tools
    if (toolName === 'getDialogMessages' && args.contact_phone) {
      entities.dialogPhone = args.contact_phone;
    }
    if (toolName === 'analyzeDialog' && args.contact_phone) {
      entities.dialogPhone = args.contact_phone;
    }

    // Date range tracking
    if (args.startDate && args.endDate) {
      entities.period = `${args.startDate}:${args.endDate}`;
    } else if (args.date_from && args.date_to) {
      entities.period = `${args.date_from}:${args.date_to}`;
    }

    return entities;
  }

  /**
   * Check if tool is dangerous and ALWAYS requires approval
   */
  isDangerousTool(toolName) {
    return DANGEROUS_KEYWORDS.some(kw => toolName.toLowerCase().includes(kw));
  }

  /**
   * Check if tool requires approval based on mode
   * Override in subclasses for agent-specific logic
   */
  shouldRequireApproval(toolName, mode) {
    // Dangerous tools ALWAYS require approval
    if (this.isDangerousTool(toolName)) {
      return true;
    }

    // In 'plan' mode, all write operations need approval
    if (mode === 'plan') {
      return this.isWriteTool(toolName);
    }

    // In 'ask' mode, everything needs approval
    if (mode === 'ask') {
      return true;
    }

    return false;
  }

  /**
   * Check if a tool modifies data (write operation)
   * Override in subclasses with specific write tools
   */
  isWriteTool(toolName) {
    // Default: tools with certain keywords are write operations
    const writeKeywords = ['update', 'pause', 'resume', 'create', 'delete', 'set', 'change'];
    return writeKeywords.some(keyword => toolName.toLowerCase().includes(keyword));
  }

  /**
   * Get tool definitions for this agent
   */
  getTools() {
    return this.tools;
  }

  /**
   * Get tool names for this agent
   */
  getToolNames() {
    return this.tools.map(t => t.name);
  }

  // ============================================================
  // STREAMING METHODS
  // ============================================================

  /**
   * Multi-round streaming with tool execution
   * @yields {Object} Stream events: text, tool_start, tool_result, approval_required, done
   */
  async *processStreamLoop({ message, context, mode, toolContext, conversationHistory = [] }) {
    const startTime = Date.now();
    const systemPrompt = this.buildSystemPrompt(context, mode);

    let currentMessages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: message }
    ];

    const executedActions = [];
    const allToolCalls = [];
    let iterations = 0;
    let finalContent = '';

    // Format tools for OpenAI
    const openAITools = this.tools.length > 0
      ? this.tools.map(tool => ({ type: 'function', function: tool }))
      : undefined;

    try {
      while (iterations < MAX_STREAM_ITERATIONS) {
        iterations++;

        // Streaming request to OpenAI
        const stream = await openai.chat.completions.create({
          model: MODEL,
          messages: currentMessages,
          tools: openAITools,
          stream: true,
          temperature: 0.7
        });

        let content = '';
        let toolCallsRaw = [];  // [{index, id, name, arguments}]

        // Process stream
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;

          // Text content
          if (delta?.content) {
            content += delta.content;
            yield { type: 'text', content: delta.content, accumulated: content };
          }

          // Tool calls (accumulate across chunks)
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallsRaw[idx]) {
                toolCallsRaw[idx] = { id: '', name: '', arguments: '' };
              }
              if (tc.id) toolCallsRaw[idx].id = tc.id;
              if (tc.function?.name) toolCallsRaw[idx].name = tc.function.name;
              if (tc.function?.arguments) toolCallsRaw[idx].arguments += tc.function.arguments;
            }
          }
        }

        // No tool calls = final response
        if (toolCallsRaw.length === 0) {
          finalContent = content;
          break;
        }

        // Build assistant message with tool_calls
        const assistantMessage = {
          role: 'assistant',
          content: content || null,
          tool_calls: toolCallsRaw.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments }
          }))
        };
        currentMessages.push(assistantMessage);

        // Execute each tool
        for (const tc of toolCallsRaw) {
          // Parse arguments safely
          let args = {};
          try {
            args = JSON.parse(tc.arguments);
          } catch (e) {
            logger.warn({ agent: this.name, tool: tc.name, args: tc.arguments }, 'Invalid tool arguments JSON');
            args = {};
          }

          allToolCalls.push({ name: tc.name, args, id: tc.id });

          // Check approval requirement
          const requiresApproval = this.shouldRequireApproval(tc.name, mode);

          if (requiresApproval) {
            yield {
              type: 'approval_required',
              name: tc.name,
              args,
              toolCallId: tc.id,
              message: `Действие "${tc.name}" требует подтверждения`
            };

            // Add pending result to messages
            currentMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify({ status: 'pending_approval', tool: tc.name })
            });
            continue;
          }

          // Execute tool
          yield { type: 'tool_start', name: tc.name, args };

          const result = await this.executeTool(tc.name, args, toolContext);

          executedActions.push({
            tool: tc.name,
            args,
            result: result.success ? 'success' : 'failed',
            message: result.message || result.error
          });

          yield { type: 'tool_result', name: tc.name, result };

          // Add tool result to messages for next iteration
          currentMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result)
          });
        }
      }

      const duration = Date.now() - startTime;
      logger.info({
        agent: this.name,
        duration,
        iterations,
        toolCalls: allToolCalls.length,
        executedActions: executedActions.length
      }, 'Agent stream completed');

      yield {
        type: 'done',
        agent: this.name,
        content: finalContent,
        executedActions,
        toolCalls: allToolCalls,
        iterations
      };

    } catch (error) {
      logger.error({ agent: this.name, error: error.message }, 'Agent stream failed');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: `agent_${this.name}_stream`,
        severity: 'warning'
      }).catch(() => {});

      yield {
        type: 'error',
        agent: this.name,
        error: error.message
      };
    }
  }

  /**
   * Process with streaming (wrapper that returns final result)
   * For cases where you need streaming but also want a final result
   */
  async processWithStream({ message, context, mode, toolContext, conversationHistory = [] }, onEvent) {
    let finalResult = null;

    for await (const event of this.processStreamLoop({
      message,
      context,
      mode,
      toolContext,
      conversationHistory
    })) {
      if (onEvent) {
        await onEvent(event);
      }

      if (event.type === 'done') {
        finalResult = {
          agent: event.agent,
          content: event.content,
          executedActions: event.executedActions,
          toolCalls: event.toolCalls
        };
      }

      if (event.type === 'error') {
        throw new Error(event.error);
      }
    }

    return finalResult;
  }
}
