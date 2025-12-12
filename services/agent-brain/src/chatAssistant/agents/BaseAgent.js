/**
 * BaseAgent - Base class for all specialized agents
 * Provides common functionality for LLM calls and tool execution
 */

import OpenAI from 'openai';
import { logger } from '../../lib/logger.js';

const MODEL = process.env.CHAT_ASSISTANT_MODEL || 'gpt-4o';
const MAX_TOOL_CALLS = 5;

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
      return await handler(args, context);
    } catch (error) {
      logger.error({ agent: this.name, tool: name, error: error.message }, 'Tool execution failed');
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if tool requires approval based on mode
   * Override in subclasses for agent-specific logic
   */
  shouldRequireApproval(toolName, mode) {
    // By default, in 'plan' mode all write operations need approval
    if (mode === 'plan') {
      return this.isWriteTool(toolName);
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
}
