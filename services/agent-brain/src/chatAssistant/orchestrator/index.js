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
import { runsStore } from '../stores/runsStore.js';
import { parseMemoryCommand, memoryHandlers, inferDomain } from './memoryTools.js';
import { logger } from '../../lib/logger.js';
import { maybeUpdateRollingSummary, getSummaryContext, formatSummaryForPrompt } from '../shared/summaryGenerator.js';
import { unifiedStore } from '../stores/unifiedStore.js';
import { getBusinessSnapshot, formatSnapshotForPrompt, getRecentBrainActions, getIntegrations, formatIntegrationsForPrompt } from '../contextGatherer.js';
// Hybrid MCP imports
import {
  policyEngine,
  clarifyingGate,
  filterToolsForOpenAI,
  playbookRegistry,
  tierManager,
  TIERS
} from '../hybrid/index.js';
import { runPreflight, generateSmartGreetingSuggestions, formatGreetingResponse } from '../hybrid/preflightService.js';
import { createSession, updateTierState } from '../../mcp/sessions.js';

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

  // ============================================================
  // HYBRID MCP FLOW
  // ============================================================

  /**
   * Process request with Hybrid MCP flow
   * Orchestrator controls, MCP executes
   *
   * @param {Object} params
   * @param {string} params.message - User message
   * @param {Object} params.context - Business context
   * @param {string} params.mode - 'auto' | 'plan' | 'ask'
   * @param {Object} params.toolContext - Context for tool execution
   * @param {Array} params.conversationHistory - Previous messages
   * @param {Object} params.clarifyingState - Existing clarifying state (for follow-up)
   * @returns {Promise<Object>} Response
   */
  async processHybridRequest({ message, context, mode, toolContext, conversationHistory = [], clarifyingState = null }) {
    const startTime = Date.now();

    try {
      // 0. Reuse-or-create runId for tracing
      const runId = toolContext?.runId ?? await runsStore.create({
        conversationId: toolContext.conversationId,
        userAccountId: toolContext.userAccountId,
        model: MODEL,
        agent: 'Orchestrator',
        domain: 'hybrid',
        userMessage: message?.substring(0, 200)
      });
      toolContext.runId = runId?.id || runId;

      // 0.1 Check for direct memory commands first
      const memoryCommand = parseMemoryCommand(message);
      if (memoryCommand) {
        const result = await this.handleMemoryCommand(memoryCommand, toolContext);
        return {
          type: 'response',
          agent: 'Orchestrator',
          content: result.content,
          executedActions: result.executedActions || [],
          classification: { domain: 'memory', agents: [], intent: 'memory' },
          duration: Date.now() - startTime
        };
      }

      // 0.5 Load clarifyingState from DB (persistence for refresh/Telegram)
      let effectiveClarifyingState = clarifyingState;
      if (!effectiveClarifyingState && toolContext.conversationId) {
        effectiveClarifyingState = await unifiedStore.getClarifyingState(toolContext.conversationId);
        if (effectiveClarifyingState) {
          logger.debug({
            conversationId: toolContext.conversationId,
            answersCount: Object.keys(effectiveClarifyingState.answers || {}).length
          }, 'Hybrid: Loaded clarifying state from DB');
        }
      }

      // 1. Load context in parallel (same as processRequest)
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
          adAccountId: dbAccountId
        }),
        getRecentBrainActions(toolContext.userAccountId, dbAccountId),
        getIntegrations(toolContext.userAccountId, dbAccountId, hasFbToken)
      ]);

      const enrichedContext = {
        ...context,
        specs,
        notes,
        rollingSummary: summaryContext.summary,
        rollingSummaryFormatted: formatSummaryForPrompt(summaryContext.summary),
        businessSnapshot: snapshot,
        businessSnapshotFormatted: formatSnapshotForPrompt(snapshot),
        brainActions,
        integrations,
        integrationsFormatted: formatIntegrationsForPrompt(integrations)
      };

      // 2. Classify request (now includes intent)
      const classification = await classifyRequest(message, enrichedContext);

      logger.info({
        message: message.substring(0, 50),
        domain: classification.domain,
        intent: classification.intent,
        intentConfidence: classification.intentConfidence
      }, 'Hybrid: Request classified');

      // 3. Resolve policy based on intent
      const policy = policyEngine.resolvePolicy({
        intent: classification.intent,
        domains: classification.agents,
        context: enrichedContext,
        integrations
      });

      logger.info({
        intent: policy.intent,
        playbookId: policy.playbookId,
        allowedTools: policy.allowedTools?.length || 0,
        clarifyingRequired: policy.clarifyingRequired,
        dangerousPolicy: policy.dangerousPolicy
      }, 'Hybrid: Policy resolved');

      // 3.5. Handle greeting/neutral with preflight
      if (policy.specialHandler === 'greeting_preflight') {
        logger.info({ intent: policy.intent }, 'Hybrid: Handling greeting with preflight');

        const preflight = await runPreflight({
          userAccountId: toolContext.userAccountId,
          adAccountId: toolContext.adAccountId,
          adAccountDbId: toolContext.adAccountDbId,
          accessToken: toolContext.accessToken,
          integrations
        });

        const smartSuggestions = generateSmartGreetingSuggestions(preflight);
        const { content, uiJson } = formatGreetingResponse(smartSuggestions);

        logger.info({
          hasFb: integrations.fb,
          canRunAds: preflight.adAccountStatus?.can_run_ads,
          hasActivity: preflight.lastActivity?.hasRecentActivity,
          suggestionsCount: smartSuggestions.suggestions?.length
        }, 'Hybrid: Greeting preflight completed');

        return {
          type: 'greeting_response',
          agent: 'Orchestrator',
          content,
          uiJson,
          suggestions: smartSuggestions.suggestions,
          preflight: {
            integrations,
            adAccountStatus: preflight.adAccountStatus?.status,
            canRunAds: preflight.adAccountStatus?.can_run_ads,
            hasRecentActivity: preflight.lastActivity?.hasRecentActivity
          },
          classification,
          policy: {
            playbookId: policy.playbookId,
            intent: policy.intent,
            specialHandler: 'greeting_preflight'
          },
          duration: Date.now() - startTime
        };
      }

      // 4. Handle context-only responses (no tools needed)
      if (policy.useContextOnly) {
        return this.handleContextOnlyResponse({
          message,
          context: enrichedContext,
          policy,
          classification,
          conversationHistory,
          startTime
        });
      }

      // 5. Clarifying Gate
      const existingAnswers = effectiveClarifyingState?.answers || {};
      const clarifyResult = clarifyingGate.evaluate({
        message,
        policy,
        context: { recentMessages: conversationHistory },
        existingAnswers
      });

      if (clarifyResult.needsClarifying) {
        // Store state for follow-up
        const newClarifyingState = {
          required: true,
          questions: clarifyResult.questions,
          answers: clarifyResult.answers,
          complete: false,
          policy,
          originalMessage: effectiveClarifyingState?.originalMessage || message
        };

        // Persist to DB for refresh/Telegram support
        if (toolContext.conversationId) {
          await unifiedStore.setClarifyingState(toolContext.conversationId, newClarifyingState);
        }

        const clarifyingContent = clarifyResult.formatForUser();

        logger.info({
          intent: policy.intent,
          pendingQuestions: clarifyResult.questions.length,
          answeredCount: Object.keys(clarifyResult.answers).length,
          persistedToDB: !!toolContext.conversationId
        }, 'Hybrid: Clarifying questions needed');

        return {
          type: 'clarifying',
          agent: 'Orchestrator',
          content: clarifyingContent,
          clarifyingState: newClarifyingState,
          classification,
          policy: {
            playbookId: policy.playbookId,
            intent: policy.intent
          },
          duration: Date.now() - startTime
        };
      }

      // 6. Create MCP session with policy restrictions
      const sessionId = createSession({
        userAccountId: toolContext.userAccountId,
        adAccountId: toolContext.adAccountId,
        accessToken: toolContext.accessToken,
        conversationId: toolContext.conversationId,
        allowedDomains: classification.agents,
        allowedTools: policy.allowedTools,
        mode: policy.clarifyingRequired ? 'plan' : mode,
        dangerousPolicy: policy.dangerousPolicy,
        integrations,
        clarifyingState: {
          required: false,
          complete: true,
          answers: clarifyResult.answers
        },
        policyMetadata: {
          playbookId: policy.playbookId,
          intent: policy.intent,
          maxToolCalls: policy.maxToolCalls,
          toolCallCount: 0
        }
      });

      logger.info({
        sessionId,
        allowedTools: policy.allowedTools,
        clarifyingAnswers: clarifyResult.answers
      }, 'Hybrid: MCP session created');

      // 7. Get agent and filter tools
      const primaryAgent = classification.agents[0];
      const agent = this.agents[primaryAgent];

      if (!agent) {
        throw new Error(`Unknown agent: ${primaryAgent}`);
      }

      // Filter tools based on policy
      const allTools = agent.getTools ? agent.getTools() : [];
      const filteredTools = filterToolsForOpenAI(allTools, policy);

      logger.info({
        agent: primaryAgent,
        totalTools: allTools.length,
        filteredTools: filteredTools.length
      }, 'Hybrid: Tools filtered');

      // 8. Execute via agent with filtered tools
      // Pass sessionId and filteredTools to agent
      const response = await agent.process({
        message,
        context: enrichedContext,
        mode,
        toolContext: {
          ...toolContext,
          sessionId,
          filteredTools,
          policy,
          clarifyingAnswers: clarifyResult.answers
        },
        conversationHistory
      });

      // 8.1 Handle tool limit reached with partial response
      if (response.error === 'tool_call_limit_reached') {
        const partialData = response.executedActions || [];

        // Record error in runs
        await runsStore.recordHybridError(toolContext.runId, {
          type: 'limit_reached',
          tool: response.lastTool,
          message: `Tool limit ${policy.maxToolCalls} reached`,
          meta: { toolCallsUsed: partialData.length }
        });

        // Build partial response with collected data
        const partialContent = partialData.length > 0
          ? assemblePartialResponse(partialData, {
              disclaimer: `⚠️ Достигнут лимит вызовов (${policy.maxToolCalls}). Показываю собранные данные:`
            })
          : 'Не удалось собрать данные в рамках лимита.';

        return {
          type: 'limit_reached',
          agent: 'Orchestrator',
          content: partialContent,
          partialData,
          nextSteps: getContextualNextSteps(policy, partialData),
          classification,
          policy: { playbookId: policy.playbookId, intent: policy.intent },
          duration: Date.now() - startTime
        };
      }

      // 9. Check for approval_required
      if (response.approvalRequired) {
        // Create pending plan for dangerous action
        const planId = await unifiedStore.createPendingPlan(toolContext.conversationId, {
          steps: response.pendingSteps || [{ action: response.blockedTool, params: response.blockedArgs }],
          summary: `Требуется подтверждение: ${response.blockedTool}`
        });

        return {
          type: 'approval_required',
          agent: 'Orchestrator',
          content: response.content || `Для выполнения ${response.blockedTool} требуется подтверждение.`,
          planId,
          blockedTool: response.blockedTool,
          classification,
          policy: {
            playbookId: policy.playbookId,
            intent: policy.intent
          },
          duration: Date.now() - startTime
        };
      }

      const duration = Date.now() - startTime;

      // Clear clarifying state after successful execution
      if (toolContext.conversationId) {
        await unifiedStore.clearClarifyingState(toolContext.conversationId);
      }

      // Update rolling summary if needed
      if (toolContext.conversationId && conversationHistory.length > 0) {
        maybeUpdateRollingSummary(
          toolContext.conversationId,
          conversationHistory,
          toolContext.contextStats
        ).catch(err => {
          logger.warn({ error: err.message }, 'Failed to update rolling summary');
        });
      }

      // Record hybrid metadata for tracing
      await runsStore.recordHybridMetadata(toolContext.runId, {
        sessionId,
        allowedTools: policy.allowedTools,
        playbookId: policy.playbookId,
        intent: policy.intent,
        maxToolCalls: policy.maxToolCalls,
        toolCallsUsed: response.executedActions?.length || 0,
        clarifyingAnswers: clarifyResult.answers
      });

      await runsStore.complete(toolContext.runId, {
        latencyMs: duration,
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens
      });

      // Log completion with all relevant data
      logger.info({
        duration,
        runId: toolContext.runId,
        agents: classification.agents,
        domain: classification.domain,
        playbookId: policy.playbookId,
        intent: policy.intent,
        toolsUsed: response.executedActions?.length || 0,
        nextStepsCount: response.nextSteps?.length || 0,
        clarifyingAnswersCount: Object.keys(clarifyResult.answers || {}).length
      }, 'Hybrid: Request completed');

      return {
        type: 'response',
        ...response,
        classification,
        policy: {
          playbookId: policy.playbookId,
          intent: policy.intent,
          toolsUsed: response.executedActions?.length || 0
        },
        duration
      };

    } catch (error) {
      // Record failure in runs
      if (toolContext?.runId) {
        await runsStore.fail(toolContext.runId, {
          latencyMs: Date.now() - startTime,
          errorMessage: error.message,
          errorCode: error.code
        }).catch(() => {}); // Don't fail on tracing error
      }
      logger.error({ error: error.message }, 'Hybrid processing failed');
      throw error;
    }
  }

  // ============================================================
  // TIER-BASED HYBRID FLOW (Playbook Registry)
  // ============================================================

  /**
   * Process request with tier-based playbook flow
   * Supports progressive disclosure: snapshot → drilldown → actions
   *
   * @param {Object} params
   * @param {string} params.message - User message
   * @param {Object} params.context - Business context
   * @param {string} params.mode - 'auto' | 'plan' | 'ask'
   * @param {Object} params.toolContext - Context for tool execution
   * @param {Array} params.conversationHistory - Previous messages
   * @param {Object} params.pendingNextStep - Selected next step (for tier transition)
   * @returns {Promise<Object>} Response with nextSteps menu
   */
  async processHybridRequestWithTiers({
    message,
    context,
    mode,
    toolContext,
    conversationHistory = [],
    pendingNextStep = null
  }) {
    const startTime = Date.now();

    try {
      // 0. Check for direct memory commands first
      const memoryCommand = parseMemoryCommand(message);
      if (memoryCommand) {
        const result = await this.handleMemoryCommand(memoryCommand, toolContext);
        return {
          type: 'response',
          agent: 'Orchestrator',
          content: result.content,
          executedActions: result.executedActions || [],
          classification: { domain: 'memory', agents: [], intent: 'memory' },
          duration: Date.now() - startTime
        };
      }

      // 1. Load tier state from DB
      let tierState = null;
      if (toolContext.conversationId) {
        tierState = await unifiedStore.getTierState(toolContext.conversationId);
      }

      // 2. Handle pending next step (tier transition)
      if (pendingNextStep && tierState) {
        const { allowed, reason } = tierManager.canTransitionTo(
          tierState,
          pendingNextStep.targetTier,
          { user_chose_drilldown: true }
        );

        if (allowed) {
          tierState = tierManager.transitionTo(tierState, pendingNextStep.targetTier, {
            reason: 'user_request',
            triggeredBy: pendingNextStep.id
          });

          // Persist updated tier state
          if (toolContext.conversationId) {
            await unifiedStore.setTierState(toolContext.conversationId, tierState);
          }

          logger.info({
            playbookId: tierState.playbookId,
            newTier: tierState.currentTier,
            triggeredBy: pendingNextStep.id
          }, 'Tier transition via nextStep');
        }
      }

      // 3. Load context in parallel
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
          adAccountId: dbAccountId
        }),
        getRecentBrainActions(toolContext.userAccountId, dbAccountId),
        getIntegrations(toolContext.userAccountId, dbAccountId, hasFbToken)
      ]);

      const enrichedContext = {
        ...context,
        specs,
        notes,
        rollingSummary: summaryContext.summary,
        rollingSummaryFormatted: formatSummaryForPrompt(summaryContext.summary),
        businessSnapshot: snapshot,
        businessSnapshotFormatted: formatSnapshotForPrompt(snapshot),
        brainActions,
        integrations,
        integrationsFormatted: formatIntegrationsForPrompt(integrations)
      };

      // 4. Get directions count for conditional questions
      const directionsCount = snapshot?.directions?.length || 0;
      const businessContext = {
        directionsCount,
        integrations
      };

      // 5. Classify and detect intent with playbook
      const classification = await classifyRequest(message, enrichedContext);
      const intentResult = policyEngine.detectIntentWithPlaybook(message);

      logger.info({
        message: message.substring(0, 50),
        domain: classification.domain,
        intent: intentResult.intent,
        playbookId: intentResult.playbookId,
        hasTierState: !!tierState
      }, 'Tier-based: Request classified');

      // 6. Create or continue tier state
      if (!tierState && intentResult.playbookId) {
        tierState = tierManager.createInitialState(intentResult.playbookId);

        if (toolContext.conversationId) {
          await unifiedStore.setTierState(toolContext.conversationId, tierState);
        }

        logger.info({
          playbookId: intentResult.playbookId,
          initialTier: tierState.currentTier
        }, 'Tier-based: Created initial tier state');
      }

      // 7. Resolve policy based on current tier
      const currentTier = tierState?.currentTier || TIERS.SNAPSHOT;
      const playbookId = tierState?.playbookId || intentResult.playbookId || intentResult.intent;

      const policy = policyEngine.resolveTierPolicy({
        playbookId,
        tier: currentTier,
        context: enrichedContext,
        integrations
      });

      logger.info({
        playbookId,
        tier: currentTier,
        allowedTools: policy.allowedTools?.length || 0,
        fromPlaybook: policy.fromPlaybook
      }, 'Tier-based: Policy resolved');

      // 8. Handle context-only responses
      if (policy.useContextOnly) {
        return this.handleContextOnlyResponse({
          message,
          context: enrichedContext,
          policy,
          classification,
          conversationHistory,
          startTime
        });
      }

      // 9. Clarifying Gate with playbook questions
      const playbook = playbookRegistry.getPlaybook(playbookId);
      const playbookQuestions = playbook?.clarifyingQuestions || policy.clarifyingQuestions || [];

      const clarifyResult = clarifyingGate.evaluateWithPlaybook({
        message,
        questions: playbookQuestions,
        businessContext,
        existingAnswers: {}
      });

      if (clarifyResult.needsClarifying) {
        logger.info({
          playbookId,
          pendingQuestions: clarifyResult.questions.length,
          uiComponents: clarifyResult.uiComponents.length
        }, 'Tier-based: Clarifying questions needed');

        return {
          type: 'clarifying',
          agent: 'Orchestrator',
          content: clarifyResult.formatForUser(),
          clarifyingState: {
            required: true,
            questions: clarifyResult.questions,
            answers: clarifyResult.answers,
            complete: false
          },
          uiComponents: clarifyResult.uiComponents,
          classification,
          policy: { playbookId, tier: currentTier },
          duration: Date.now() - startTime
        };
      }

      // 10. Create MCP session with tier-based policy
      const sessionId = createSession({
        userAccountId: toolContext.userAccountId,
        adAccountId: toolContext.adAccountId,
        accessToken: toolContext.accessToken,
        conversationId: toolContext.conversationId,
        allowedDomains: classification.agents,
        allowedTools: policy.allowedTools,
        mode,
        dangerousPolicy: policy.dangerousPolicy,
        integrations,
        tierState,
        policyMetadata: {
          playbookId,
          intent: policy.intent,
          tier: currentTier,
          maxToolCalls: policy.maxToolCalls,
          toolCallCount: 0
        }
      });

      // 11. Execute via agent
      const primaryAgent = classification.agents[0];
      const agent = this.agents[primaryAgent];

      if (!agent) {
        throw new Error(`Unknown agent: ${primaryAgent}`);
      }

      const allTools = agent.getTools ? agent.getTools() : [];
      const filteredTools = filterToolsForOpenAI(allTools, policy);

      const response = await agent.process({
        message,
        context: enrichedContext,
        mode,
        toolContext: {
          ...toolContext,
          sessionId,
          filteredTools,
          policy,
          clarifyingAnswers: clarifyResult.answers
        },
        conversationHistory
      });

      // 12. Save snapshot data for tier
      if (currentTier === TIERS.SNAPSHOT && response.executedActions?.length > 0) {
        const snapshotData = this.extractSnapshotData(response);
        tierState = tierManager.saveSnapshotData(tierState, snapshotData);

        if (toolContext.conversationId) {
          await unifiedStore.setTierState(toolContext.conversationId, tierState);
        }
      }

      // 13. Evaluate enter conditions for auto-escalation
      const autoEscalation = tierManager.checkAutoEscalation(tierState, {
        ...tierState?.snapshotData,
        ...businessContext
      });

      // 14. Get available next steps
      const nextSteps = tierManager.getAvailableNextSteps(tierState, businessContext);

      const duration = Date.now() - startTime;

      // Clear clarifying state after success
      if (toolContext.conversationId) {
        await unifiedStore.clearClarifyingState(toolContext.conversationId);
      }

      return {
        type: 'response',
        ...response,
        classification,
        policy: {
          playbookId,
          tier: currentTier,
          toolsUsed: response.executedActions?.length || 0
        },
        tierState: {
          playbookId: tierState?.playbookId,
          currentTier: tierState?.currentTier,
          completedTiers: tierState?.completedTiers
        },
        nextSteps: nextSteps.length > 0 ? nextSteps : null,
        autoEscalation: autoEscalation.shouldEscalate ? autoEscalation : null,
        duration
      };

    } catch (error) {
      logger.error({ error: error.message }, 'Tier-based processing failed');
      throw error;
    }
  }

  /**
   * Extract data from response for snapshot tier
   * @private
   */
  extractSnapshotData(response) {
    const data = {};

    // Extract metrics from tool results
    for (const action of response.executedActions || []) {
      if (action.result && typeof action.result === 'object') {
        if (action.result.spend !== undefined) data.spend = action.result.spend;
        if (action.result.leads !== undefined) data.leads = action.result.leads;
        if (action.result.cpl !== undefined) data.cpl = action.result.cpl;
        if (action.result.impressions !== undefined) data.impressions = action.result.impressions;
        if (action.result.directions) data.directionsCount = action.result.directions.length;
      }
    }

    return data;
  }

  /**
   * Handle context-only responses (no tool calls needed)
   */
  async handleContextOnlyResponse({ message, context, policy, classification, conversationHistory, startTime }) {
    // Build prompt with context
    const systemPrompt = buildOrchestratorPrompt();
    const contextInfo = policy.contextSource === 'brain_history'
      ? context.brainActions
      : context.businessSnapshotFormatted;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-10),
      { role: 'user', content: message }
    ];

    // Add context as system message
    if (contextInfo) {
      messages.splice(1, 0, {
        role: 'system',
        content: `Контекст для ответа:\n${JSON.stringify(contextInfo, null, 2)}`
      });
    }

    try {
      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages,
        temperature: 0.7
      });

      return {
        type: 'response',
        agent: 'Orchestrator',
        content: completion.choices[0].message.content,
        executedActions: [],
        classification,
        policy: {
          playbookId: policy.playbookId,
          intent: policy.intent,
          contextOnly: true
        },
        duration: Date.now() - startTime
      };
    } catch (error) {
      logger.error({ error: error.message }, 'Context-only response failed');
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

      // Handle greeting intent - return preflight response
      if (classification.intent === 'greeting_neutral') {
        logger.info({ intent: 'greeting_neutral' }, 'Streaming: Handling greeting with preflight');

        const preflight = await runPreflight({
          userAccountId: toolContext.userAccountId,
          adAccountId: toolContext.adAccountId,
          adAccountDbId: toolContext.adAccountDbId,
          accessToken: toolContext.accessToken,
          integrations
        });

        const smartSuggestions = generateSmartGreetingSuggestions(preflight);
        logger.info({ smartSuggestions }, 'Greeting: Generated smart suggestions');

        const { content, uiJson } = formatGreetingResponse(smartSuggestions);
        logger.info({ content, hasUiJson: !!uiJson }, 'Greeting: Formatted response');

        const textEvent = {
          type: 'text',
          content,
          accumulated: content
        };
        logger.info({ textEvent }, 'Greeting: Yielding text event');
        yield textEvent;

        const doneEvent = {
          type: 'done',
          content,
          uiJson,
          uiComponents: uiJson,  // For route compatibility
          suggestions: smartSuggestions.suggestions,
          classification,
          duration: Date.now() - startTime
        };
        logger.info({ doneEventType: doneEvent.type, hasContent: !!doneEvent.content }, 'Greeting: Yielding done event');
        yield doneEvent;

        logger.info('Greeting: Flow complete, returning');
        return;
      }

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

/**
 * Get contextual next steps based on policy and partial data
 * @param {Object} policy - Current policy with playbookId
 * @param {Array} partialData - Executed actions so far
 * @returns {Array} Next step suggestions
 */
function getContextualNextSteps(policy, partialData) {
  const steps = [
    { text: 'Сузить период (3d / 7d)', action: 'narrow_period', icon: '📅' }
  ];

  if (policy.playbookId?.includes('lead')) {
    steps.push({ text: 'Проверить качество лидов', action: 'check_quality', icon: '🔍' });
  }
  if (policy.playbookId?.includes('creative')) {
    steps.push({ text: 'Провалиться в креативы', action: 'drilldown_creatives', icon: '🎨' });
  }
  if (partialData?.some(d => d.tool === 'getDirections')) {
    steps.push({ text: 'Детали направления', action: 'drilldown_direction', icon: '📊' });
  }
  if (policy.playbookId?.includes('spend') || policy.playbookId?.includes('expensive')) {
    steps.push({ text: 'Сравнить с прошлым периодом', action: 'compare_periods', icon: '📈' });
  }

  return steps.slice(0, 3); // Max 3 next steps
}

/**
 * Assemble partial response from executed actions
 * @param {Array} executedActions - Results of executed tools
 * @param {Object} options - { disclaimer }
 * @returns {string} Formatted partial content
 */
function assemblePartialResponse(executedActions, { disclaimer = '' } = {}) {
  if (!executedActions?.length) {
    return disclaimer || 'Данные не собраны.';
  }

  const sections = [];

  if (disclaimer) {
    sections.push(disclaimer);
  }

  for (const action of executedActions) {
    if (action.result?.success !== false) {
      const toolName = action.tool || action.name;
      const summary = summarizeToolResult(toolName, action.result);
      if (summary) {
        sections.push(summary);
      }
    }
  }

  return sections.join('\n\n') || 'Частичные данные недоступны.';
}

/**
 * Summarize tool result for partial response
 * @param {string} toolName
 * @param {Object} result
 * @returns {string|null}
 */
function summarizeToolResult(toolName, result) {
  if (!result) return null;

  // Summarize based on tool type
  if (toolName === 'getSpendReport' && result.totals) {
    const spend = result.totals.spend || 0;
    const leads = result.totals.leads || 0;
    const cpl = leads > 0 ? Math.round(spend / leads) : 0;
    return `📊 **Расход**: ${spend.toLocaleString('ru-RU')}₽, лидов: ${leads}${cpl > 0 ? `, CPL: ${cpl}₽` : ''}`;
  }
  if (toolName === 'getDirections' && result.directions) {
    const active = result.directions.filter(d => d.is_active).length;
    return `📁 **Направлений**: ${result.directions.length} (активных: ${active})`;
  }
  if (toolName === 'getCampaigns' && result.campaigns) {
    const active = result.campaigns.filter(c => c.status === 'ACTIVE').length;
    return `📢 **Кампаний**: ${result.campaigns.length} (активных: ${active})`;
  }
  if (toolName === 'getLeads' && result.leads) {
    return `👥 **Лидов**: ${result.leads.length}`;
  }
  if (toolName === 'getCreatives' && result.creatives) {
    return `🎨 **Креативов**: ${result.creatives.length}`;
  }

  return null;
}

// Export singleton instance
export const orchestrator = new Orchestrator();
