/**
 * Orchestrator - Routes user requests through Meta-Tools architecture
 *
 * Flow:
 * 1. User message → Orchestrator
 * 2. Memory command check
 * 3. Context gathering (integrations, ad account status)
 * 4. Route to MetaOrchestrator (processWithMetaTools)
 * 5. MetaOrchestrator → Domain tools → Domain agents → Response
 */

import { memoryStore } from '../stores/memoryStore.js';
import { runsStore } from '../stores/runsStore.js';
import { parseMemoryCommand, memoryHandlers, inferDomain } from './memoryTools.js';
import { logger } from '../../lib/logger.js';
import { maybeUpdateRollingSummary, getSummaryContext, formatSummaryForPrompt } from '../shared/summaryGenerator.js';
import {
  getRecentBrainActions,
  getIntegrations,
  formatIntegrationsForPrompt,
  getIntegrationStack,
  getStackDescription,
  getStackCapabilities
} from '../contextGatherer.js';
import { adsHandlers } from '../agents/ads/handlers.js';
// Meta-tools orchestrator (OpenAI)
import { processWithMetaTools } from './metaOrchestrator.js';
// Claude Agent SDK orchestrator
import { processWithClaudeSDK } from './claudeOrchestrator.js';
import { ORCHESTRATOR_CONFIG } from '../config.js';

// LLM Provider selection
const USE_CLAUDE = process.env.LLM_PROVIDER === 'claude' || ORCHESTRATOR_CONFIG.llmProvider === 'claude';
const ENABLE_FALLBACK = process.env.LLM_FALLBACK === 'true';

// In-memory cache for ad account status
const adAccountStatusCache = new Map();
const AD_ACCOUNT_STATUS_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Get ad account status with caching
 * @param {Object} toolContext
 * @returns {Promise<Object>}
 */
async function getCachedAdAccountStatus(toolContext) {
  const { accessToken, adAccountId, userAccountId, adAccountDbId } = toolContext;

  // No FB connection
  if (!accessToken || !adAccountId) {
    return { can_run_ads: false, status: 'NO_FB_CONNECTION', success: false };
  }

  const cacheKey = `${userAccountId}:${adAccountDbId || adAccountId}`;
  const cached = adAccountStatusCache.get(cacheKey);

  // Check cache
  if (cached && Date.now() - cached.timestamp < AD_ACCOUNT_STATUS_TTL) {
    logger.debug({ cacheKey }, 'Ad account status cache hit');
    return cached.data;
  }

  try {
    const status = await adsHandlers.getAdAccountStatus({}, { accessToken, adAccountId });
    adAccountStatusCache.set(cacheKey, { data: status, timestamp: Date.now() });
    return status;
  } catch (error) {
    logger.warn({ error: error.message, adAccountId }, 'getCachedAdAccountStatus failed');
    return {
      success: false,
      status: 'ERROR',
      can_run_ads: false,
      error: error.message
    };
  }
}

export class Orchestrator {
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
    const { layerLogger } = toolContext;

    // Layer 2: Orchestrator start
    layerLogger?.start(2, { mode, hasHistory: conversationHistory.length > 0 });

    try {
      // 0. Check for direct memory commands first
      const memoryCommand = parseMemoryCommand(message);
      if (memoryCommand) {
        layerLogger?.info(2, 'Memory command detected', { type: memoryCommand.type });
        const result = await this.handleMemoryCommand(memoryCommand, toolContext);
        layerLogger?.end(2, { memoryCommand: true, type: memoryCommand.type });
        return {
          agent: 'Orchestrator',
          content: result.content,
          executedActions: result.executedActions || [],
          classification: { domain: 'memory', agents: [] },
          duration: Date.now() - startTime
        };
      }

      // 1. Gather context in parallel
      layerLogger?.info(2, 'Gathering context');
      const dbAccountId = toolContext.adAccountDbId || null;
      const hasFbToken = Boolean(toolContext.accessToken);

      const [specs, notes, summaryContext, brainActions, integrations, adAccountStatus] = await Promise.all([
        memoryStore.getSpecs(toolContext.userAccountId, dbAccountId),
        memoryStore.getNotesDigest(toolContext.userAccountId, dbAccountId),
        toolContext.conversationId
          ? getSummaryContext(toolContext.conversationId)
          : Promise.resolve({ summary: '', used: false }),
        getRecentBrainActions(toolContext.userAccountId, dbAccountId),
        getIntegrations(toolContext.userAccountId, dbAccountId, hasFbToken),
        getCachedAdAccountStatus(toolContext)
      ]);

      // Determine integration stack
      const stack = getIntegrationStack(integrations);

      layerLogger?.info(2, 'Context gathered', {
        hasSpecs: specs?.length > 0,
        hasNotes: notes?.length > 0,
        hasSummary: !!summaryContext.summary,
        stack
      });

      // Enrich context
      const enrichedContext = {
        ...context,
        specs,
        notes,
        rollingSummary: summaryContext.summary,
        rollingSummaryFormatted: formatSummaryForPrompt(summaryContext.summary),
        brainActions,
        adAccountStatus,
        integrations,
        integrationsFormatted: formatIntegrationsForPrompt(integrations, stack),
        stack,
        stackDescription: getStackDescription(stack),
        stackCapabilities: getStackCapabilities(stack)
      };

      // Track context stats
      toolContext.contextStats = {
        ...toolContext.contextStats,
        rollingSummaryUsed: summaryContext.used,
        adAccountStatus: adAccountStatus?.status,
        canRunAds: adAccountStatus?.can_run_ads,
        integrations,
        stack
      };

      // 2. Route to appropriate orchestrator based on LLM provider
      const provider = USE_CLAUDE ? 'claude' : 'openai';
      layerLogger?.info(2, `Routing to ${provider === 'claude' ? 'ClaudeOrchestrator' : 'MetaOrchestrator'}`, { provider });
      logger.info({ provider, fallbackEnabled: ENABLE_FALLBACK }, 'LLM provider selected');

      let metaResult;
      let usedProvider = provider;

      if (USE_CLAUDE) {
        try {
          // Collect results from Claude generator
          let accumulatedContent = '';
          let executedTools = [];
          let plan = null;

          for await (const event of processWithClaudeSDK({
            message,
            context: enrichedContext,
            conversationHistory,
            toolContext: { ...toolContext, mode }
          })) {
            if (event.type === 'text') {
              accumulatedContent = event.accumulated || accumulatedContent + event.content;
            } else if (event.type === 'done') {
              executedTools = event.executedActions || [];
              plan = event.plan;
              accumulatedContent = event.content || accumulatedContent;
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          }

          metaResult = {
            content: accumulatedContent,
            executedTools,
            plan,
            iterations: executedTools.length
          };

        } catch (claudeError) {
          if (ENABLE_FALLBACK) {
            logger.warn({ error: claudeError.message }, 'Claude failed, falling back to OpenAI');
            usedProvider = 'openai-fallback';

            metaResult = await processWithMetaTools({
              message,
              context: enrichedContext,
              conversationHistory,
              toolContext: { ...toolContext, mode }
            });
          } else {
            throw claudeError;
          }
        }
      } else {
        // Use OpenAI
        metaResult = await processWithMetaTools({
          message,
          context: enrichedContext,
          conversationHistory,
          toolContext: { ...toolContext, mode }
        });
      }

      const duration = Date.now() - startTime;

      // Update rolling summary if needed (async)
      if (toolContext.conversationId && conversationHistory.length > 0) {
        maybeUpdateRollingSummary(
          toolContext.conversationId,
          conversationHistory,
          toolContext.contextStats
        ).catch(err => {
          logger.warn({ error: err.message }, 'Failed to update rolling summary');
        });
      }

      logger.info({
        duration,
        iterations: metaResult.iterations,
        toolCalls: metaResult.executedTools?.length || 0,
        provider: usedProvider
      }, 'Orchestrator completed');

      layerLogger?.end(2, {
        iterations: metaResult.iterations,
        toolCalls: metaResult.executedTools?.length || 0,
        provider: usedProvider
      });

      return {
        agent: usedProvider === 'claude' ? 'ClaudeOrchestrator' : 'MetaOrchestrator',
        content: metaResult.content,
        executedActions: metaResult.executedTools || [],
        classification: { domain: 'meta', agents: [usedProvider === 'claude' ? 'ClaudeOrchestrator' : 'MetaOrchestrator'] },
        duration,
        metadata: {
          iterations: metaResult.iterations,
          tokens: metaResult.tokens,
          runId: metaResult.runId,
          provider: usedProvider
        }
      };

    } catch (error) {
      layerLogger?.error(2, error);
      logger.error({ error: error.message }, 'Orchestrator processing failed');
      throw error;
    }
  }

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

  /**
   * Process request with streaming
   * @yields {Object} Stream events
   */
  async *processStreamRequest({ message, context, mode, toolContext, conversationHistory = [] }) {
    const startTime = Date.now();
    const { layerLogger } = toolContext;

    // Layer 2: Orchestrator start
    layerLogger?.start(2, { mode, streaming: true });

    try {
      // 0. Check for direct memory commands first
      const memoryCommand = parseMemoryCommand(message);
      if (memoryCommand) {
        layerLogger?.info(2, 'Memory command detected', { type: memoryCommand.type });
        const result = await this.handleMemoryCommand(memoryCommand, toolContext);
        layerLogger?.end(2, { memoryCommand: true });
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

      // 1. Gather context
      layerLogger?.info(2, 'Gathering context');
      const dbAccountId = toolContext.adAccountDbId || null;
      const hasFbToken = Boolean(toolContext.accessToken);

      const [specs, notes, summaryContext, brainActions, integrations, adAccountStatus] = await Promise.all([
        memoryStore.getSpecs(toolContext.userAccountId, dbAccountId),
        memoryStore.getNotesDigest(toolContext.userAccountId, dbAccountId),
        toolContext.conversationId
          ? getSummaryContext(toolContext.conversationId)
          : Promise.resolve({ summary: '', used: false }),
        getRecentBrainActions(toolContext.userAccountId, dbAccountId),
        getIntegrations(toolContext.userAccountId, dbAccountId, hasFbToken),
        getCachedAdAccountStatus(toolContext)
      ]);

      const stack = getIntegrationStack(integrations);

      layerLogger?.info(2, 'Context gathered', { stack, hasSummary: !!summaryContext.summary });

      const enrichedContext = {
        ...context,
        specs,
        notes,
        rollingSummary: summaryContext.summary,
        rollingSummaryFormatted: formatSummaryForPrompt(summaryContext.summary),
        brainActions,
        adAccountStatus,
        integrations,
        integrationsFormatted: formatIntegrationsForPrompt(integrations, stack),
        stack,
        stackDescription: getStackDescription(stack),
        stackCapabilities: getStackCapabilities(stack)
      };

      toolContext.contextStats = {
        ...toolContext.contextStats,
        rollingSummaryUsed: summaryContext.used,
        adAccountStatus: adAccountStatus?.status,
        canRunAds: adAccountStatus?.can_run_ads,
        integrations,
        stack
      };

      // Yield thinking message
      yield {
        type: 'thinking',
        message: 'Обрабатываю запрос...'
      };

      // 2. Route to appropriate orchestrator based on LLM provider
      const provider = USE_CLAUDE ? 'claude' : 'openai';
      layerLogger?.info(2, `Routing to ${provider === 'claude' ? 'ClaudeOrchestrator' : 'MetaOrchestrator'}`, { provider });
      logger.info({ provider, fallbackEnabled: ENABLE_FALLBACK }, 'LLM provider selected');

      let metaResult;
      let usedProvider = provider;

      if (USE_CLAUDE) {
        try {
          // Use Claude Agent SDK
          let accumulatedContent = '';
          let executedTools = [];
          let plan = null;

          for await (const event of processWithClaudeSDK({
            message,
            context: enrichedContext,
            conversationHistory,
            toolContext: { ...toolContext, mode },
            onToolEvent: toolContext.onToolEvent
          })) {
            // Forward events (except done, we'll create our own)
            if (event.type === 'text') {
              accumulatedContent = event.accumulated || accumulatedContent + event.content;
              yield event;
            } else if (event.type === 'tool_start' || event.type === 'tool_result') {
              yield event;
            } else if (event.type === 'done') {
              executedTools = event.executedActions || [];
              plan = event.plan;
              accumulatedContent = event.content || accumulatedContent;
            } else if (event.type === 'error' && ENABLE_FALLBACK) {
              // Fallback to OpenAI on error
              logger.warn({ error: event.message }, 'Claude failed, falling back to OpenAI');
              usedProvider = 'openai-fallback';
              throw new Error(event.message); // Will be caught by fallback
            } else {
              yield event;
            }
          }

          metaResult = {
            content: accumulatedContent,
            executedTools,
            plan,
            iterations: executedTools.length
          };

        } catch (claudeError) {
          if (ENABLE_FALLBACK) {
            logger.warn({ error: claudeError.message }, 'Claude failed, falling back to OpenAI');
            usedProvider = 'openai-fallback';

            // Fallback to OpenAI
            metaResult = await processWithMetaTools({
              message,
              context: enrichedContext,
              conversationHistory,
              toolContext: { ...toolContext, mode },
              onToolEvent: toolContext.onToolEvent
            });

            // Yield content from OpenAI fallback
            yield {
              type: 'text',
              content: metaResult.content,
              accumulated: metaResult.content
            };
          } else {
            throw claudeError;
          }
        }
      } else {
        // Use OpenAI (existing flow)
        metaResult = await processWithMetaTools({
          message,
          context: enrichedContext,
          conversationHistory,
          toolContext: { ...toolContext, mode },
          onToolEvent: toolContext.onToolEvent
        });

        // Yield content
        yield {
          type: 'text',
          content: metaResult.content,
          accumulated: metaResult.content
        };
      }

      layerLogger?.end(2, { iterations: metaResult.iterations, provider: usedProvider });

      const duration = Date.now() - startTime;

      // Update rolling summary
      if (toolContext.conversationId && conversationHistory.length > 0) {
        maybeUpdateRollingSummary(
          toolContext.conversationId,
          conversationHistory,
          toolContext.contextStats
        ).catch(err => {
          logger.warn({ error: err.message }, 'Failed to update rolling summary');
        });
      }

      yield {
        type: 'done',
        agent: usedProvider === 'claude' ? 'ClaudeOrchestrator' : 'MetaOrchestrator',
        content: metaResult.content,
        executedActions: metaResult.executedTools || [],
        toolCalls: [],
        domain: 'meta',
        classification: { domain: 'meta', agents: [usedProvider === 'claude' ? 'ClaudeOrchestrator' : 'MetaOrchestrator'] },
        duration,
        plan: metaResult.plan || null,
        metadata: {
          iterations: metaResult.iterations,
          tokens: metaResult.tokens,
          provider: usedProvider
        }
      };

    } catch (error) {
      layerLogger?.error(2, error);
      logger.error({ error: error.message }, 'Orchestrator streaming failed');
      yield {
        type: 'error',
        error: error.message
      };
    }
  }

  /**
   * Process streaming request with callback
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

// Export singleton instance
export const orchestrator = new Orchestrator();
