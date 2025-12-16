/**
 * Orchestrator - Coordinates specialized agents
 * Routes requests and combines responses
 */

import OpenAI from 'openai';
import { classifyRequest } from './classifier.js';
import { buildOrchestratorPrompt, buildSynthesisPrompt } from './systemPrompt.js';
import { AdsAgent } from '../agents/ads/index.js';
import { CreativeAgent } from '../agents/creative/index.js';
import { WhatsAppAgent } from '../agents/whatsapp/index.js';
import { CRMAgent } from '../agents/crm/index.js';
import { memoryStore } from '../stores/memoryStore.js';
import { parseMemoryCommand, memoryHandlers, inferDomain } from './memoryTools.js';
import { logger } from '../../lib/logger.js';
import { maybeUpdateRollingSummary, getSummaryContext, formatSummaryForPrompt } from '../shared/summaryGenerator.js';
import { unifiedStore } from '../stores/unifiedStore.js';
import { getBusinessSnapshot, formatSnapshotForPrompt, getRecentBrainActions, getIntegrations, formatIntegrationsForPrompt } from '../contextGatherer.js';

const MODEL = process.env.CHAT_ASSISTANT_MODEL || 'gpt-5.2';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export class Orchestrator {
  constructor() {
    // Initialize all agents
    this.agents = {
      ads: new AdsAgent(),
      creative: new CreativeAgent(),
      whatsapp: new WhatsAppAgent(),
      crm: new CRMAgent()
    };
  }

  /**
   * Process a user request
   * @param {Object} params
   * @param {string} params.message - User message
   * @param {Object} params.context - Business context
   * @param {string} params.mode - 'auto' | 'plan' | 'ask'
   * @param {Object} params.toolContext - Context for tool execution
   * @param {Array} params.conversationHistory - Previous messages
   * @returns {Promise<Object>} Response
   */
  async processRequest({ message, context, mode, toolContext, conversationHistory = [] }) {
    const startTime = Date.now();

    try {
      // 0. Check for direct memory commands first
      const memoryCommand = parseMemoryCommand(message);
      if (memoryCommand) {
        const result = await this.handleMemoryCommand(memoryCommand, toolContext);
        return {
          agent: 'Orchestrator',
          content: result.content,
          executedActions: result.executedActions || [],
          classification: { domain: 'memory', agents: [] },
          duration: Date.now() - startTime
        };
      }

      // 1. Load memory (specs + notes + rolling summary) AND business snapshot in parallel
      // Use adAccountDbId (UUID) for database queries, adAccountId (fbId) for FB API
      const dbAccountId = toolContext.adAccountDbId || null;
      const hasFbToken = Boolean(toolContext.accessToken);

      const [specs, notes, summaryContext, snapshot, brainActions, integrations] = await Promise.all([
        memoryStore.getSpecs(toolContext.userAccountId, dbAccountId),
        memoryStore.getNotesDigest(toolContext.userAccountId, dbAccountId),
        toolContext.conversationId
          ? getSummaryContext(toolContext.conversationId)
          : Promise.resolve({ summary: '', used: false }),
        getBusinessSnapshot({
          userAccountId: toolContext.userAccountId,
          adAccountId: dbAccountId  // UUID for database queries
        }),
        // Brain actions history (last 3 days) for AdsAgent context
        getRecentBrainActions(toolContext.userAccountId, dbAccountId),
        // Check available integrations (fb, crm, roi, whatsapp)
        getIntegrations(toolContext.userAccountId, dbAccountId, hasFbToken)
      ]);

      // Enrich context with memory AND snapshot (snapshot-first pattern)
      const enrichedContext = {
        ...context,
        specs,
        notes,
        rollingSummary: summaryContext.summary,
        rollingSummaryFormatted: formatSummaryForPrompt(summaryContext.summary),
        // Snapshot-first: pre-loaded business data
        businessSnapshot: snapshot,
        businessSnapshotFormatted: formatSnapshotForPrompt(snapshot),
        // Brain agent actions history (for AdsAgent to avoid conflicting recommendations)
        brainActions,
        // Available integrations for tool routing
        integrations,
        integrationsFormatted: formatIntegrationsForPrompt(integrations)
      };

      // Track context stats for runsStore
      const snapshotUsed = snapshot && snapshot.freshness !== 'error' && snapshot.freshness !== 'missing';
      toolContext.contextStats = {
        ...toolContext.contextStats,
        rollingSummaryUsed: summaryContext.used,
        snapshotUsed,
        snapshotFreshness: snapshot?.freshness,
        integrations
      };

      // 2. Classify the request (now has snapshot for better routing)
      const classification = await classifyRequest(message, enrichedContext);

      logger.info({
        message: message.substring(0, 50),
        classification,
        usingSummary: summaryContext.used,
        usingSnapshot: snapshotUsed,
        integrations
      }, 'Request classified');

      // 3. Route to appropriate agent(s)
      let response;

      if (classification.agents.length === 1) {
        // Single agent - delegate directly
        response = await this.delegateToAgent(
          classification.agents[0],
          { message, context: enrichedContext, mode, toolContext, conversationHistory }
        );
      } else {
        // Multiple agents - coordinate
        response = await this.coordinateAgents(
          classification.agents,
          { message, context: enrichedContext, mode, toolContext, conversationHistory }
        );
      }

      const duration = Date.now() - startTime;
      logger.info({
        duration,
        agents: classification.agents,
        domain: classification.domain
      }, 'Orchestrator processed request');

      // Update rolling summary if needed (async, don't wait)
      if (toolContext.conversationId && conversationHistory.length > 0) {
        maybeUpdateRollingSummary(
          toolContext.conversationId,
          conversationHistory,
          toolContext.contextStats
        ).catch(err => {
          logger.warn({ error: err.message }, 'Failed to update rolling summary');
        });
      }

      return {
        ...response,
        classification,
        duration
      };

    } catch (error) {
      logger.error({ error: error.message }, 'Orchestrator processing failed');
      throw error;
    }
  }

  /**
   * Delegate request to a single agent
   */
  async delegateToAgent(agentName, params) {
    const agent = this.agents[agentName];

    if (!agent) {
      throw new Error(`Unknown agent: ${agentName}`);
    }

    logger.info({ agent: agentName }, 'Delegating to agent');

    return await agent.process(params);
  }

  /**
   * Coordinate multiple agents and synthesize responses
   */
  async coordinateAgents(agentNames, params) {
    const { message, context, mode, toolContext, conversationHistory } = params;

    logger.info({ agents: agentNames }, 'Coordinating multiple agents');

    // Execute agents in parallel
    const agentPromises = agentNames.map(name =>
      this.delegateToAgent(name, { message, context, mode, toolContext, conversationHistory })
        .then(response => ({ name, response }))
        .catch(error => ({ name, error: error.message }))
    );

    const results = await Promise.all(agentPromises);

    // Collect successful responses
    const successfulResponses = results
      .filter(r => r.response && !r.error)
      .map(r => ({
        agent: r.name,
        content: r.response.content,
        executedActions: r.response.executedActions || []
      }));

    if (successfulResponses.length === 0) {
      throw new Error('All agents failed to respond');
    }

    // If only one succeeded, return it directly
    if (successfulResponses.length === 1) {
      return {
        agent: 'Orchestrator',
        delegatedTo: successfulResponses[0].agent,
        content: successfulResponses[0].content,
        executedActions: successfulResponses[0].executedActions,
        toolCalls: []
      };
    }

    // Synthesize multiple responses
    const synthesizedContent = await this.synthesizeResponses(successfulResponses);

    // Combine all executed actions
    const allActions = successfulResponses.flatMap(r => r.executedActions);

    return {
      agent: 'Orchestrator',
      delegatedTo: agentNames,
      content: synthesizedContent,
      executedActions: allActions,
      toolCalls: [],
      agentResponses: successfulResponses
    };
  }

  /**
   * Synthesize responses from multiple agents into one coherent response
   */
  async synthesizeResponses(agentResponses) {
    const synthesisPrompt = buildSynthesisPrompt(agentResponses);

    try {
      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: buildOrchestratorPrompt() },
          { role: 'user', content: synthesisPrompt }
        ],
        temperature: 0.7
      });

      return completion.choices[0].message.content;
    } catch (error) {
      logger.error({ error: error.message }, 'Response synthesis failed');

      // Fallback: concatenate responses
      return agentResponses
        .map(r => `**${r.agent}:**\n${r.content}`)
        .join('\n\n---\n\n');
    }
  }

  /**
   * Get available agents
   */
  getAgents() {
    return Object.keys(this.agents);
  }

  /**
   * Get agent by name
   */
  getAgent(name) {
    return this.agents[name];
  }

  // ============================================================
  // MEMORY COMMAND HANDLING
  // ============================================================

  /**
   * Handle direct memory commands
   * @param {Object} command - Parsed memory command
   * @param {Object} toolContext - Context with user/account IDs
   * @returns {Promise<Object>} Response
   */
  async handleMemoryCommand(command, toolContext) {
    logger.info({ command: command.type }, 'Handling memory command');

    switch (command.type) {
      case 'remember': {
        const domain = inferDomain(command.note);
        const result = await memoryHandlers.rememberNote(
          { note: command.note, domain, importance: 0.7 },
          toolContext
        );
        return {
          content: result.success
            ? `✅ ${result.message}`
            : `❌ ${result.error}`,
          executedActions: [{
            tool: 'rememberNote',
            args: { note: command.note, domain },
            result: result.success ? 'success' : 'failed'
          }]
        };
      }

      case 'forget': {
        const result = await memoryHandlers.forgetNote(
          { searchText: command.searchText },
          toolContext
        );
        return {
          content: result.success
            ? `✅ ${result.message}`
            : `❌ ${result.error}`,
          executedActions: [{
            tool: 'forgetNote',
            args: { searchText: command.searchText },
            result: result.success ? 'success' : 'failed'
          }]
        };
      }

      case 'list': {
        const result = await memoryHandlers.listNotes({ domain: 'all' }, toolContext);

        if (!result.success) {
          return {
            content: `❌ ${result.error}`,
            executedActions: []
          };
        }

        if (result.total === 0) {
          return {
            content: '📋 У меня пока нет сохранённых заметок.',
            executedActions: []
          };
        }

        // Format notes for display
        const lines = ['📋 **Сохранённые заметки:**\n'];
        const domainLabels = {
          ads: '📊 Реклама',
          creative: '🎨 Креативы',
          whatsapp: '💬 Диалоги',
          crm: '👥 CRM'
        };

        for (const [domain, notes] of Object.entries(result.notes)) {
          if (notes.length > 0) {
            lines.push(`\n**${domainLabels[domain]}** (${notes.length}):`);
            for (const note of notes) {
              const importance = note.importance >= 0.7 ? '⭐' : '';
              lines.push(`• ${importance}${note.text}`);
            }
          }
        }

        lines.push(`\n_Всего: ${result.total} заметок_`);

        return {
          content: lines.join('\n'),
          executedActions: [{
            tool: 'listNotes',
            args: { domain: 'all' },
            result: 'success'
          }]
        };
      }

      default:
        return {
          content: 'Не понял команду памяти',
          executedActions: []
        };
    }
  }

  // ============================================================
  // STREAMING METHODS
  // ============================================================

  /**
   * Process request with streaming
   * @yields {Object} Stream events from agent: text, tool_start, tool_result, approval_required, done
   */
  async *processStreamRequest({ message, context, mode, toolContext, conversationHistory = [] }) {
    const startTime = Date.now();

    try {
      // 0. Check for direct memory commands first
      const memoryCommand = parseMemoryCommand(message);
      if (memoryCommand) {
        const result = await this.handleMemoryCommand(memoryCommand, toolContext);
        yield {
          type: 'text',
          content: result.content,
          accumulated: result.content
        };
        yield {
          type: 'done',
          agent: 'Orchestrator',
          content: result.content,
          executedActions: result.executedActions || [],
          toolCalls: [],
          domain: 'memory',
          classification: { domain: 'memory', agents: [] },
          duration: Date.now() - startTime
        };
        return;
      }

      // 1. Load memory (specs + notes + rolling summary) AND business snapshot in parallel
      // Use adAccountDbId (UUID) for database queries, adAccountId (fbId) for FB API
      const dbAccountId = toolContext.adAccountDbId || null;
      const hasFbToken = Boolean(toolContext.accessToken);

      const [specs, notes, summaryContext, snapshot, brainActions, integrations] = await Promise.all([
        memoryStore.getSpecs(toolContext.userAccountId, dbAccountId),
        memoryStore.getNotesDigest(toolContext.userAccountId, dbAccountId),
        toolContext.conversationId
          ? getSummaryContext(toolContext.conversationId)
          : Promise.resolve({ summary: '', used: false }),
        getBusinessSnapshot({
          userAccountId: toolContext.userAccountId,
          adAccountId: dbAccountId  // UUID for database queries
        }),
        // Brain actions history (last 3 days) for AdsAgent context
        getRecentBrainActions(toolContext.userAccountId, dbAccountId),
        // Check available integrations (fb, crm, roi, whatsapp)
        getIntegrations(toolContext.userAccountId, dbAccountId, hasFbToken)
      ]);

      // Enrich context with memory AND snapshot (snapshot-first pattern)
      const enrichedContext = {
        ...context,
        specs,
        notes,
        rollingSummary: summaryContext.summary,
        rollingSummaryFormatted: formatSummaryForPrompt(summaryContext.summary),
        // Snapshot-first: pre-loaded business data
        businessSnapshot: snapshot,
        businessSnapshotFormatted: formatSnapshotForPrompt(snapshot),
        // Brain agent actions history (for AdsAgent to avoid conflicting recommendations)
        brainActions,
        // Available integrations for tool routing
        integrations,
        integrationsFormatted: formatIntegrationsForPrompt(integrations)
      };

      // Track context stats for runsStore
      const snapshotUsed = snapshot && snapshot.freshness !== 'error' && snapshot.freshness !== 'missing';
      toolContext.contextStats = {
        ...toolContext.contextStats,
        rollingSummaryUsed: summaryContext.used,
        snapshotUsed,
        snapshotFreshness: snapshot?.freshness,
        integrations
      };

      // 2. Classify the request (now has snapshot for better routing)
      const classification = await classifyRequest(message, enrichedContext);

      logger.info({
        message: message.substring(0, 50),
        classification,
        usingSummary: summaryContext.used,
        usingSnapshot: snapshotUsed,
        integrations
      }, 'Request classified for streaming');

      yield {
        type: 'classification',
        domain: classification.domain,
        agents: classification.agents
      };

      // Yield thinking message based on domain
      const thinkingMessage = getThinkingMessage(classification.domain);
      yield {
        type: 'thinking',
        message: thinkingMessage
      };

      // 2. Route to appropriate agent (single agent for streaming)
      // For multi-agent requests, we use the primary agent
      const primaryAgent = classification.agents[0];
      const agent = this.agents[primaryAgent];

      if (!agent) {
        yield {
          type: 'error',
          error: `Unknown agent: ${primaryAgent}`
        };
        return;
      }

      logger.info({ agent: primaryAgent }, 'Streaming via agent');

      // 3. Stream through the agent
      for await (const event of agent.processStreamLoop({
        message,
        context: enrichedContext,
        mode,
        toolContext,
        conversationHistory
      })) {
        // Add classification info to done event
        if (event.type === 'done') {
          const duration = Date.now() - startTime;

          // Update rolling summary if needed (async, don't wait)
          if (toolContext.conversationId && conversationHistory.length > 0) {
            maybeUpdateRollingSummary(
              toolContext.conversationId,
              conversationHistory,
              toolContext.contextStats
            ).catch(err => {
              logger.warn({ error: err.message }, 'Failed to update rolling summary after streaming');
            });
          }

          yield {
            ...event,
            domain: classification.domain,
            classification,
            duration
          };
        } else {
          yield event;
        }
      }

    } catch (error) {
      logger.error({ error: error.message }, 'Orchestrator streaming failed');

      yield {
        type: 'error',
        error: error.message
      };
    }
  }

  /**
   * Process streaming request with callback (convenience method)
   */
  async processStreamWithCallback({ message, context, mode, toolContext, conversationHistory = [] }, onEvent) {
    let finalResult = null;

    for await (const event of this.processStreamRequest({
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
          toolCalls: event.toolCalls,
          classification: event.classification,
          domain: event.domain,
          duration: event.duration
        };
      }

      if (event.type === 'error') {
        throw new Error(event.error);
      }
    }

    return finalResult;
  }
}

/**
 * Get thinking message based on domain
 * Provides user-friendly feedback about what the assistant is doing
 */
function getThinkingMessage(domain) {
  const messages = {
    ads: 'Смотрю статистику рекламы...',
    creative: 'Анализирую креативы...',
    crm: 'Проверяю лидов...',
    whatsapp: 'Ищу диалоги...',
    memory: 'Проверяю заметки...',
    mixed: 'Собираю данные из нескольких источников...'
  };
  return messages[domain] || 'Обрабатываю запрос...';
}

// Export singleton instance
export const orchestrator = new Orchestrator();
