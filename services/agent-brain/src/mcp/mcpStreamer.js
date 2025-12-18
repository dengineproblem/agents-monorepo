/**
 * MCP Streamer
 *
 * Provides streaming-like interface for MCP responses.
 * Yields events compatible with TelegramStreamer:
 * - thinking: Agent is processing
 * - classification: Domain determined
 * - tool_start: Tool execution started
 * - tool_result: Tool execution completed
 * - text: Text chunk (accumulated)
 * - approval_required: Dangerous tool needs approval
 * - done: Processing complete
 * - error: Error occurred
 *
 * Note: OpenAI Responses API doesn't support true streaming yet,
 * so this emits events sequentially as tools execute.
 */

import { createSession, MCP_CONFIG } from './index.js';
import { detectIntentWithLLM, INTENT_DOMAIN_MAP } from '../chatAssistant/orchestrator/index.js';
import { getToolsByAgent } from './tools/definitions.js';
import { formatMCPResponse } from './responseFormatter.js';
import { logger } from '../lib/logger.js';

// Domain to agent mapping
const DOMAIN_TO_MCP_AGENT = {
  ads: 'ads',
  creative: 'creative',
  whatsapp: 'whatsapp',
  crm: 'crm'
};

/**
 * Get allowed tools for domains
 */
function getAllowedToolsForDomains(domains) {
  const tools = [];
  for (const domain of domains) {
    const agentName = DOMAIN_TO_MCP_AGENT[domain];
    if (agentName) {
      const agentTools = getToolsByAgent(agentName);
      tools.push(...agentTools.map(t => t.name));
    }
  }
  return [...new Set(tools)];
}

/**
 * Process chat via MCP with streaming events
 * @param {Object} params
 * @yields {Object} Stream events
 */
export async function* processChatViaMCPStream({
  systemPrompt,
  userPrompt,
  toolContext,
  conversationHistory,
  mode
}) {
  let sessionId = null;
  let classification = { domain: 'unknown', confidence: 0 };

  try {
    // 1. Yield thinking event
    yield { type: 'thinking', message: 'Анализирую запрос...' };

    // 2. Detect intent using LLM (Single-LLM Architecture)
    let allowedTools = null;
    let allowedDomains = null;

    try {
      // Build minimal context for intent detection
      const minimalContext = {
        integrations: toolContext.integrations || {}
      };

      classification = await detectIntentWithLLM(userPrompt, minimalContext);

      if (classification.domain !== 'mixed' && classification.domain !== 'unknown') {
        allowedDomains = [classification.domain];
        allowedTools = getAllowedToolsForDomains(allowedDomains);
      } else if (classification.agents && classification.agents.length > 1) {
        allowedDomains = classification.agents.slice(0, 2);
        allowedTools = getAllowedToolsForDomains(allowedDomains);
      }

      // Yield classification event
      yield {
        type: 'classification',
        intent: classification.intent,
        domain: classification.domain,
        confidence: classification.confidence,
        agents: classification.agents
      };

      // Handle context-only responses (greeting, brain_history)
      if (classification.contextOnlyResponse) {
        yield { type: 'text', content: classification.contextOnlyResponse, accumulated: classification.contextOnlyResponse };
        yield { type: 'done', content: classification.contextOnlyResponse, agent: 'MCP', domain: classification.domain };
        return;
      }

    } catch (detectError) {
      logger.warn({ error: detectError.message }, 'Intent detection failed in stream');
      yield { type: 'classification', domain: 'unknown', confidence: 0 };
    }

    // 3. Create session
    const dangerousPolicy = 'block';
    sessionId = createSession({
      userAccountId: toolContext.userAccountId,
      adAccountId: toolContext.adAccountId,
      accessToken: toolContext.accessToken,
      conversationId: toolContext.conversationId,
      allowedDomains,
      allowedTools,
      mode,
      dangerousPolicy,
      integrations: toolContext.integrations || null
    });

    // 4. Build messages
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userPrompt }
    ];

    // 5. Build MCP headers
    const mcpHeaders = { 'Mcp-Session-Id': sessionId };
    if (process.env.MCP_SECRET) {
      mcpHeaders['X-MCP-Secret'] = process.env.MCP_SECRET;
    }

    // 6. Call OpenAI Responses API
    yield { type: 'thinking', message: 'Выполняю запрос к AI...' };

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.CHAT_ASSISTANT_MODEL || 'gpt-4o',
        input: messages,
        tools: [{
          type: 'mcp',
          server_label: 'agents-mcp',
          server_url: MCP_CONFIG.serverUrl,
          headers: mcpHeaders,
          require_approval: 'never'
        }],
        tool_choice: 'auto'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const result = await response.json();

    // 7. Yield tool events
    const toolCalls = result.tool_calls || [];

    for (const tc of toolCalls) {
      // Yield tool_start
      yield {
        type: 'tool_start',
        name: tc.name,
        args: tc.arguments
      };

      // Check for approval_required in result
      if (tc.result) {
        try {
          const parsed = typeof tc.result === 'string' ? JSON.parse(tc.result) : tc.result;
          if (parsed.approval_required) {
            yield {
              type: 'approval_required',
              name: tc.name,
              tool: parsed.tool,
              args: parsed.args,
              reason: parsed.reason
            };
          }
        } catch (e) {
          // Not JSON
        }
      }

      // Yield tool_result
      yield {
        type: 'tool_result',
        name: tc.name,
        result: tc.result,
        success: !tc.result?.error
      };
    }

    // 8. Format and yield final response
    const rawContent = result.output_text || result.output?.[0]?.content || '';
    const formatted = formatMCPResponse(
      { content: rawContent, toolCalls },
      {
        domain: classification.domain,
        validate: true,
        addRefs: true
      }
    );

    // Yield text (could be chunked in future true streaming)
    yield {
      type: 'text',
      content: formatted.content,
      accumulated: formatted.content
    };

    // 9. Yield done
    yield {
      type: 'done',
      content: formatted.content,
      agent: 'MCP',
      domain: classification.domain,
      toolCalls,
      entities: formatted.entities,
      uiJson: formatted.uiJson,
      validation: formatted.validation
    };

  } catch (error) {
    logger.error({ error: error.message, sessionId }, 'MCP stream error');

    yield {
      type: 'error',
      error: error.message,
      sessionId
    };

    throw error;
  }
}

/**
 * Helper to consume stream and collect events
 * @param {AsyncGenerator} stream
 * @returns {Promise<Object>} Final result
 */
export async function collectStreamEvents(stream) {
  const events = [];
  let finalResult = null;

  for await (const event of stream) {
    events.push(event);

    if (event.type === 'done') {
      finalResult = event;
    }
  }

  return { events, finalResult };
}

export default { processChatViaMCPStream, collectStreamEvents };
