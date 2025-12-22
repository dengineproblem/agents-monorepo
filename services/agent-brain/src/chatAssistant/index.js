/**
 * Chat Assistant Module
 * Main entry point with API endpoint for chat interactions
 * Uses Meta-Tools architecture with Orchestrator
 */

import {
  gatherContext,
  getOrCreateConversation,
  saveMessage,
  updateConversationTitle,
  getConversations,
  deleteConversation
} from './contextGatherer.js';
import { Orchestrator } from './orchestrator/index.js';
import { supabase } from '../lib/supabaseClient.js';
import { logger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import {
  handleTelegramMessage,
  handleClearCommand,
  handleModeCommand,
  handleStatusCommand
} from './telegramHandler.js';
import { LayerLogger, createNoOpLogger } from './shared/layerLogger.js';
import { ORCHESTRATOR_CONFIG } from './config.js';

// SECURITY: Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://app.performanteaiagency.com',
  'https://performanteaiagency.com',
  'https://agents.performanteaiagency.com',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:8081'
];

const orchestrator = new Orchestrator();

/**
 * Process a chat message and return response
 * @param {Object} params
 * @param {string} params.message - User message
 * @param {string} params.conversationId - Existing conversation ID (optional)
 * @param {string} params.mode - 'auto' | 'plan' | 'ask'
 * @param {string} params.userAccountId - User account ID
 * @param {string} params.adAccountId - Ad account ID (optional)
 * @returns {Promise<Object>} Chat response
 */
export async function processChat({ message, conversationId, mode = 'auto', userAccountId, adAccountId }) {
  const startTime = Date.now();

  try {
    // 0. Resolve ad account ID if not provided
    const { dbId, fbId } = await resolveAdAccountId(userAccountId, adAccountId);

    logger.info({ userAccountId, inputAdAccountId: adAccountId, resolvedDbId: dbId, resolvedFbId: fbId }, 'Resolved ad account');

    // 1. Get access token for Facebook API
    const accessToken = await getAccessToken(userAccountId, dbId);

    // 2. Get or create conversation
    const conversation = await getOrCreateConversation({
      userAccountId,
      adAccountId: dbId,
      conversationId,
      mode
    });

    // Update title if this is the first message
    const isFirstMessage = !conversationId;
    if (isFirstMessage) {
      await updateConversationTitle(conversation.id, message);
    }

    // 3. Gather context
    const context = await gatherContext({
      userAccountId,
      adAccountId: dbId,
      conversationId: conversation.id,
      fbAdAccountId: fbId
    });

    // 4. Save user message
    await saveMessage({
      conversationId: conversation.id,
      role: 'user',
      content: message
    });

    // 5. Prepare conversation history
    const conversationHistory = [];
    if (context.recentMessages?.length > 0) {
      for (const msg of context.recentMessages.slice(-10)) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          conversationHistory.push({ role: msg.role, content: msg.content });
        }
      }
    }

    // 6. Tool context
    const toolContext = {
      accessToken,
      userAccountId,
      adAccountId: fbId,
      adAccountDbId: dbId,
      conversationId: conversation.id
    };

    // 7. Process via orchestrator (Meta-Tools architecture)
    const response = await orchestrator.processRequest({
      message,
      context,
      mode,
      toolContext,
      conversationHistory
    });

    // 8. Save assistant response
    await saveMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: response.content,
      actionsJson: response.executedActions
    });

    // 9. Return result
    const duration = Date.now() - startTime;
    logger.info({
      conversationId: conversation.id,
      duration,
      mode,
      agent: response.agent
    }, 'Chat processed');

    return {
      conversationId: conversation.id,
      response: response.content,
      executedActions: response.executedActions,
      mode,
      agent: response.agent,
      classification: response.classification,
      metadata: response.metadata
    };

  } catch (error) {
    logger.error({ error: error.message, userAccountId }, 'Chat processing failed');

    logErrorToAdmin({
      user_account_id: userAccountId,
      error_type: 'api',
      raw_error: error.message || String(error),
      stack_trace: error.stack,
      action: 'chat_assistant_process',
      endpoint: '/api/brain/chat',
      severity: 'warning'
    }).catch(() => {});

    throw error;
  }
}

/**
 * Resolve ad account ID if not provided
 * Returns { dbId, fbId } where:
 *   - dbId: UUID for database (null for legacy mode)
 *   - fbId: Facebook ad account ID for API calls
 */
async function resolveAdAccountId(userAccountId, adAccountId) {
  console.log('[resolveAdAccountId] input:', { userAccountId, adAccountId });

  // If adAccountId provided, it's a UUID from ad_accounts table
  if (adAccountId) {
    const { data: adAccount } = await supabase
      .from('ad_accounts')
      .select('id, ad_account_id')
      .eq('id', adAccountId)
      .single();

    console.log('[resolveAdAccountId] found by UUID:', adAccount);
    if (adAccount) {
      return { dbId: adAccount.id, fbId: adAccount.ad_account_id };
    }
    return { dbId: adAccountId, fbId: null };
  }

  // Get user to check multi_account_enabled flag
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('ad_account_id, multi_account_enabled')
    .eq('id', userAccountId)
    .single();

  if (!userAccount) {
    logger.warn({ userAccountId }, 'User account not found');
    return { dbId: null, fbId: null };
  }

  // Multi-account mode: get from ad_accounts table
  if (userAccount.multi_account_enabled) {
    const { data: adAccount } = await supabase
      .from('ad_accounts')
      .select('id, ad_account_id')
      .eq('user_account_id', userAccountId)
      .or('is_default.eq.true,is_active.eq.true')
      .order('is_default', { ascending: false })
      .limit(1)
      .single();

    if (adAccount) {
      logger.info({ userAccountId, dbId: adAccount.id, fbId: adAccount.ad_account_id, mode: 'multi' }, 'Resolved ad account');
      return { dbId: adAccount.id, fbId: adAccount.ad_account_id };
    }
  }

  // Legacy mode: ad_account_id is Facebook ID, not UUID
  if (userAccount.ad_account_id) {
    logger.info({ userAccountId, fbId: userAccount.ad_account_id, mode: 'legacy' }, 'Resolved ad account');
    return { dbId: null, fbId: userAccount.ad_account_id };
  }

  logger.warn({ userAccountId }, 'No ad account found for user');
  return { dbId: null, fbId: null };
}

/**
 * Get Facebook access token for user
 */
async function getAccessToken(userAccountId, adAccountId) {
  // First try to get from ad_accounts table
  if (adAccountId) {
    const { data: adAccount } = await supabase
      .from('ad_accounts')
      .select('access_token')
      .eq('id', adAccountId)
      .single();

    if (adAccount?.access_token) {
      return adAccount.access_token;
    }
  }

  // Fallback to user_accounts
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('access_token')
    .eq('id', userAccountId)
    .single();

  if (!userAccount?.access_token) {
    throw new Error('No Facebook access token found');
  }

  return userAccount.access_token;
}

/**
 * Check if layer logging should be enabled for this request
 * @param {string} userAccountId - User account ID
 * @param {boolean} requestParam - debugLayers param from request
 * @returns {Promise<boolean>}
 */
async function shouldEnableLayerLogging(userAccountId, requestParam) {
  // If not requested, check global env flag
  if (!requestParam && !ORCHESTRATOR_CONFIG.enableLayerLogging) {
    return false;
  }

  // If globally enabled via env, allow for all
  if (ORCHESTRATOR_CONFIG.enableLayerLogging) {
    return true;
  }

  // If requested, check if user is admin
  if (requestParam) {
    // Check hardcoded admin list
    if (ORCHESTRATOR_CONFIG.layerLoggingAdminIds.includes(userAccountId)) {
      return true;
    }

    // Check is_tech_admin in database
    const { data } = await supabase
      .from('user_accounts')
      .select('is_tech_admin')
      .eq('id', userAccountId)
      .single();

    return data?.is_tech_admin === true;
  }

  return false;
}

/**
 * Execute a planned action (after user approval)
 */
export async function executePlanAction({ conversationId, actionIndex, userAccountId, adAccountId }) {
  const { unifiedStore } = await import('./stores/unifiedStore.js');
  const { planExecutor } = await import('./planExecutor.js');

  const pendingPlan = await unifiedStore.getPendingPlan(conversationId);

  if (pendingPlan) {
    await unifiedStore.approvePlan(pendingPlan.id);
    const result = await planExecutor.executeSingleStep({
      planId: pendingPlan.id,
      stepIndex: actionIndex,
      toolContext: { userAccountId, adAccountId }
    });
    return result;
  }

  throw new Error('No pending plan found');
}

/**
 * Execute all plan actions
 */
export async function executeFullPlan({ conversationId, userAccountId, adAccountId }) {
  const { unifiedStore } = await import('./stores/unifiedStore.js');
  const { planExecutor } = await import('./planExecutor.js');

  const pendingPlan = await unifiedStore.getPendingPlan(conversationId);

  if (pendingPlan) {
    await unifiedStore.approvePlan(pendingPlan.id);
    const result = await planExecutor.executeFullPlan({
      planId: pendingPlan.id,
      toolContext: { userAccountId, adAccountId }
    });

    await unifiedStore.addMessage(conversationId, {
      role: 'system',
      content: result.success
        ? `✅ План выполнен: ${result.summary}`
        : `⚠️ План выполнен частично: ${result.summary}`
    });

    return result;
  }

  throw new Error('No pending plan found');
}

/**
 * Register routes on Fastify instance
 */
export function registerChatRoutes(fastify) {
  // Main chat endpoint
  fastify.post('/api/brain/chat', async (request, reply) => {
    const { message, conversationId, mode, userAccountId, adAccountId } = request.body;

    if (!message || !userAccountId) {
      return reply.code(400).send({ error: 'message and userAccountId are required' });
    }

    try {
      const result = await processChat({
        message,
        conversationId,
        mode: mode || 'auto',
        userAccountId,
        adAccountId
      });

      return reply.send(result);
    } catch (error) {
      fastify.log.error({ error: error.message }, 'Chat error');

      logErrorToAdmin({
        user_account_id: userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'chat_endpoint',
        endpoint: '/api/brain/chat',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: error.message });
    }
  });

  // SSE Streaming endpoint
  fastify.post('/api/brain/chat/stream', async (request, reply) => {
    const { message, conversationId, mode, userAccountId, adAccountId, debugLayers } = request.body;

    if (!message || !userAccountId) {
      return reply.code(400).send({ error: 'message and userAccountId are required' });
    }

    // Проверяем multi-account режим - требуем adAccountId
    const { data: userAccount } = await supabase
      .from('user_accounts')
      .select('multi_account_enabled')
      .eq('id', userAccountId)
      .single();

    if (userAccount?.multi_account_enabled && !adAccountId) {
      return reply.code(400).send({ error: 'adAccountId required for multi-account mode' });
    }

    // Set SSE headers
    // SECURITY: Validate origin against whitelist
    const requestOrigin = request.headers.origin;
    const allowedOrigin = ALLOWED_ORIGINS.includes(requestOrigin)
      ? requestOrigin
      : 'https://app.performanteaiagency.com';

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Credentials': 'true',
      'X-Accel-Buffering': 'no'
    });

    const sendEvent = (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Initialize layer logger (will be set up after checking permissions)
    let layerLogger = createNoOpLogger();

    try {
      // Check if layer logging should be enabled
      const enableLayers = await shouldEnableLayerLogging(userAccountId, debugLayers);
      if (enableLayers) {
        layerLogger = new LayerLogger({
          enabled: true,
          emitter: sendEvent
        });
      }

      // Layer 1: HTTP Entry
      layerLogger.start(1, { message: message.substring(0, 100), mode, hasConversationId: !!conversationId });

      // Resolve ad account
      const { dbId, fbId } = await resolveAdAccountId(userAccountId, adAccountId);
      const accessToken = await getAccessToken(userAccountId, dbId);

      layerLogger.info(1, 'Ad account resolved', { dbId: dbId?.substring(0, 8), hasFbId: !!fbId });

      // Get or create conversation
      const conversation = await getOrCreateConversation({
        userAccountId,
        adAccountId: dbId,
        conversationId,
        mode
      });

      if (!conversationId) {
        await updateConversationTitle(conversation.id, message);
      }

      // Gather context
      const context = await gatherContext({
        userAccountId,
        adAccountId: dbId,
        conversationId: conversation.id,
        fbAdAccountId: fbId
      });

      layerLogger.info(1, 'Context gathered', {
        hasDirections: !!context.directions,
        recentMessages: context.recentMessages?.length || 0
      });

      // Save user message
      await saveMessage({
        conversationId: conversation.id,
        role: 'user',
        content: message
      });

      // Build conversation history
      const conversationHistory = [];
      if (context.recentMessages?.length > 0) {
        for (const msg of context.recentMessages.slice(-10)) {
          if (msg.role === 'user' || msg.role === 'assistant') {
            conversationHistory.push({ role: msg.role, content: msg.content });
          }
        }
      }

      const toolContext = {
        accessToken,
        userAccountId,
        adAccountId: fbId,
        adAccountDbId: dbId,
        conversationId: conversation.id,
        layerLogger // Pass logger to downstream layers
      };

      layerLogger.end(1, { conversationId: conversation.id });

      // Send init event
      sendEvent({
        type: 'init',
        conversationId: conversation.id,
        mode: mode || 'auto',
        debugLayersEnabled: enableLayers
      });

      // Stream via orchestrator
      let finalContent = '';
      let finalAgent = '';
      let executedActions = [];
      let finalPlan = null; // Plan from mini-AgentBrain

      // Pass sendEvent as callback for real-time tool events
      const toolContextWithEvents = {
        ...toolContext,
        onToolEvent: sendEvent  // Will be called directly when tools execute
      };

      for await (const event of orchestrator.processStreamRequest({
        message,
        context,
        mode: mode || 'auto',
        toolContext: toolContextWithEvents,
        conversationHistory
      })) {
        sendEvent(event);

        if (event.type === 'done') {
          finalContent = event.content;
          finalAgent = event.agent;
          executedActions = event.executedActions || [];
          finalPlan = event.plan || null; // Extract plan from done event
        }
      }

      // Layer 11: Persistence
      layerLogger.start(11, { conversationId: conversation.id });

      // Save assistant response with plan (if any)
      const savedMessage = await saveMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content: finalContent,
        actionsJson: executedActions,
        planJson: finalPlan, // Plan from mini-AgentBrain for user approval
        agent: finalAgent,
        debugLogsJson: layerLogger.isEnabled() ? layerLogger.getAllLogs() : null
      });

      layerLogger.end(11, { messageId: savedMessage?.id, logsCount: layerLogger.getAllLogs().length });

      reply.raw.end();

    } catch (error) {
      layerLogger.error(1, error, { phase: 'streaming' });

      fastify.log.error({ error: error.message }, 'Chat stream error');
      sendEvent({ type: 'error', message: error.message });

      logErrorToAdmin({
        user_account_id: userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'chat_stream_endpoint',
        endpoint: '/api/brain/chat/stream',
        severity: 'warning'
      }).catch(() => {});

      reply.raw.end();
    }
  });

  // Get conversations list
  fastify.get('/api/brain/conversations', async (request, reply) => {
    const { userAccountId, adAccountId, limit } = request.query;

    if (!userAccountId) {
      return reply.code(400).send({ error: 'userAccountId is required' });
    }

    try {
      const conversations = await getConversations({
        userAccountId,
        adAccountId,
        limit: parseInt(limit) || 20
      });

      return reply.send({ conversations });
    } catch (error) {
      logErrorToAdmin({
        user_account_id: userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'get_conversations',
        endpoint: '/api/brain/conversations',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: error.message });
    }
  });

  // Get conversation messages
  fastify.get('/api/brain/conversations/:id/messages', async (request, reply) => {
    const { id } = request.params;
    const { userAccountId } = request.query;

    if (!userAccountId) {
      return reply.code(400).send({ error: 'userAccountId is required' });
    }

    try {
      const { data: messages, error } = await supabase
        .from('ai_messages')
        .select('*')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true });

      if (error) throw error;

      return reply.send({ messages });
    } catch (error) {
      logErrorToAdmin({
        user_account_id: userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'get_conversation_messages',
        endpoint: '/api/brain/conversations/:id/messages',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: error.message });
    }
  });

  // Delete conversation
  fastify.delete('/api/brain/conversations/:id', async (request, reply) => {
    const { id } = request.params;
    const { userAccountId } = request.query;

    if (!userAccountId) {
      return reply.code(400).send({ error: 'userAccountId is required' });
    }

    try {
      await deleteConversation(id, userAccountId);
      return reply.send({ success: true });
    } catch (error) {
      logErrorToAdmin({
        user_account_id: userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'delete_conversation',
        endpoint: '/api/brain/conversations/:id',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: error.message });
    }
  });

  // Execute plan action
  fastify.post('/api/brain/conversations/:id/execute', async (request, reply) => {
    const { id } = request.params;
    const { userAccountId, adAccountId, actionIndex, executeAll } = request.body;

    if (!userAccountId) {
      return reply.code(400).send({ error: 'userAccountId is required' });
    }

    try {
      let result;

      if (executeAll) {
        result = await executeFullPlan({
          conversationId: id,
          userAccountId,
          adAccountId
        });
      } else if (actionIndex !== undefined) {
        result = await executePlanAction({
          conversationId: id,
          actionIndex,
          userAccountId,
          adAccountId
        });
      } else {
        return reply.code(400).send({ error: 'actionIndex or executeAll required' });
      }

      return reply.send(result);
    } catch (error) {
      logErrorToAdmin({
        user_account_id: userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'execute_plan',
        endpoint: '/api/brain/conversations/:id/execute',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: error.message });
    }
  });

  fastify.log.info('Chat Assistant routes registered');
}

export default {
  processChat,
  executePlanAction,
  executeFullPlan,
  registerChatRoutes,
  handleTelegramMessage,
  handleClearCommand,
  handleModeCommand,
  handleStatusCommand
};
