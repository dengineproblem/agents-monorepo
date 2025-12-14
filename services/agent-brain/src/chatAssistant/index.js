/**
 * Chat Assistant Module
 * Main entry point with API endpoint for chat interactions
 * Uses multi-agent architecture with Orchestrator
 */

import OpenAI from 'openai';
import { buildSystemPrompt, buildUserPrompt } from './systemPrompt.js';
import { getToolsForOpenAI, isToolDangerous } from './tools.js';
import { executeTool } from './toolHandlers.js';
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
// conversationStore deprecated, use unifiedStore instead (imported dynamically in executeFullPlan)

const MODEL = process.env.CHAT_ASSISTANT_MODEL || 'gpt-4o';
const MAX_TOOL_CALLS = 5; // Prevent infinite loops

// Use multi-agent orchestrator
const USE_ORCHESTRATOR = process.env.CHAT_USE_ORCHESTRATOR !== 'false';
const orchestrator = new Orchestrator();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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
    // Returns { dbId: UUID for database, fbId: Facebook account ID for API }
    const { dbId, fbId } = await resolveAdAccountId(userAccountId, adAccountId);

    // 1. Get access token for Facebook API
    // Use dbId (UUID) for lookup in ad_accounts table
    const accessToken = await getAccessToken(userAccountId, dbId);

    // 2. Get or create conversation
    // Use dbId for database storage (null for legacy mode)
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
    // Use dbId for database, fbId for Facebook context
    const context = await gatherContext({
      userAccountId,
      adAccountId: dbId,
      conversationId: conversation.id,
      fbAdAccountId: fbId  // Pass Facebook ID for API context
    });

    // 4. Save user message
    await saveMessage({
      conversationId: conversation.id,
      role: 'user',
      content: message
    });

    // 5. Build prompts
    const systemPrompt = buildSystemPrompt(mode, context.businessProfile);
    const userPrompt = buildUserPrompt(message, context);

    // 6. Prepare conversation history for agents
    const conversationHistory = [];
    if (context.recentMessages?.length > 0) {
      for (const msg of context.recentMessages.slice(-10)) { // Last 10 messages
        if (msg.role === 'user' || msg.role === 'assistant') {
          conversationHistory.push({ role: msg.role, content: msg.content });
        }
      }
    }

    // 7. Process via Orchestrator (multi-agent) or legacy LLM
    // adAccountId: fbId for Facebook API calls
    // adAccountDbId: dbId (UUID) for database queries (memory, specs, notes)
    const toolContext = { accessToken, userAccountId, adAccountId: fbId, adAccountDbId: dbId };
    let response;

    if (USE_ORCHESTRATOR) {
      // NEW: Multi-agent orchestrator
      response = await orchestrator.processRequest({
        message: userPrompt,
        context,
        mode,
        toolContext,
        conversationHistory
      });
    } else {
      // LEGACY: Direct LLM with all tools
      const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: userPrompt }
      ];
      response = await callLLMWithTools(messages, toolContext, mode);
    }

    // 8. Parse and save assistant response
    const parsedResponse = parseAssistantResponse(response.content);

    await saveMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: parsedResponse.response || response.content,
      planJson: parsedResponse.plan,
      actionsJson: response.executedActions,
      toolCallsJson: response.toolCalls
    });

    // 9. Return result
    const duration = Date.now() - startTime;
    logger.info({
      conversationId: conversation.id,
      duration,
      mode,
      agent: response.agent,
      delegatedTo: response.delegatedTo
    }, 'Chat processed');

    return {
      conversationId: conversation.id,
      response: parsedResponse.response || response.content,
      plan: parsedResponse.plan,
      data: parsedResponse.data,
      needsClarification: parsedResponse.needs_clarification,
      clarificationQuestion: parsedResponse.clarification_question,
      executedActions: response.executedActions,
      mode,
      // Multi-agent metadata
      agent: response.agent,
      delegatedTo: response.delegatedTo,
      classification: response.classification
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
 * Call LLM with tools and handle tool calls
 */
async function callLLMWithTools(messages, toolContext, mode) {
  const tools = getToolsForOpenAI();
  const executedActions = [];
  const allToolCalls = [];

  let currentMessages = [...messages];
  let iterations = 0;

  while (iterations < MAX_TOOL_CALLS) {
    iterations++;

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: currentMessages,
      tools,
      tool_choice: 'auto',
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
      const toolArgs = JSON.parse(toolCall.function.arguments);

      allToolCalls.push({ name: toolName, args: toolArgs });

      // Check if tool requires confirmation in current mode
      const requiresApproval = shouldRequireApproval(toolName, mode);

      if (requiresApproval) {
        // Don't execute, return plan for approval
        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            status: 'pending_approval',
            message: 'This action requires approval before execution'
          })
        });
        continue;
      }

      // Execute the tool
      const result = await executeTool(toolName, toolArgs, toolContext);

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

  // If we hit max iterations, return last response
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
 * Determine if a tool requires approval based on mode
 */
function shouldRequireApproval(toolName, mode) {
  // In Plan mode, all write operations require approval
  if (mode === 'plan') {
    const writeTools = [
      'pauseCampaign', 'resumeCampaign', 'pauseAdSet', 'resumeAdSet',
      'updateBudget', 'updateLeadStage', 'generateCreative'
    ];
    return writeTools.includes(toolName);
  }

  // Dangerous tools always require approval
  if (isToolDangerous(toolName)) {
    return true;
  }

  return false;
}

/**
 * Parse assistant response from JSON format
 */
function parseAssistantResponse(content) {
  try {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        thinking: parsed.thinking,
        needs_clarification: parsed.needs_clarification || false,
        clarification_question: parsed.clarification_question,
        plan: parsed.plan,
        response: parsed.response || content,
        data: parsed.data
      };
    }
  } catch (e) {
    // If JSON parsing fails, return raw content
  }

  return {
    response: content,
    needs_clarification: false
  };
}

/**
 * Resolve ad account ID if not provided
 * Checks multi_account_enabled flag to determine source
 * Returns { dbId, fbId } where:
 *   - dbId: UUID for database (null for legacy mode)
 *   - fbId: Facebook ad account ID for API calls
 */
async function resolveAdAccountId(userAccountId, adAccountId) {
  // If adAccountId provided, it's a UUID from ad_accounts table
  if (adAccountId) {
    const { data: adAccount } = await supabase
      .from('ad_accounts')
      .select('id, ad_account_id')
      .eq('id', adAccountId)
      .single();

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
  // dbId = null (can't store in FK), fbId = Facebook account ID
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
 * Execute a planned action (after user approval)
 * Now uses unified store and plan executor
 */
export async function executePlanAction({ conversationId, actionIndex, userAccountId, adAccountId }) {
  // First try to find in ai_pending_plans (new system)
  const { unifiedStore } = await import('./stores/unifiedStore.js');
  const { planExecutor } = await import('./planExecutor.js');

  const pendingPlan = await unifiedStore.getPendingPlan(conversationId);

  if (pendingPlan) {
    // New system: use planExecutor
    await unifiedStore.approvePlan(pendingPlan.id);
    const result = await planExecutor.executeSingleStep({
      planId: pendingPlan.id,
      stepIndex: actionIndex,
      toolContext: { userAccountId, adAccountId }
    });
    return result;
  }

  // Fallback: Legacy system with plan_json in ai_messages
  const { data: messages } = await supabase
    .from('ai_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .eq('role', 'assistant')
    .not('plan_json', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!messages?.length || !messages[0].plan_json) {
    throw new Error('No pending plan found');
  }

  const plan = messages[0].plan_json;
  const step = plan.steps?.[actionIndex];

  if (!step) {
    throw new Error('Action not found in plan');
  }

  // Execute the action
  const accessToken = await getAccessToken(userAccountId, adAccountId);
  const result = await executeTool(step.action, step.params, {
    accessToken,
    userAccountId,
    adAccountId
  });

  // Save execution result
  await saveMessage({
    conversationId,
    role: 'system',
    content: result.success
      ? `✅ Выполнено: ${step.description}`
      : `❌ Ошибка: ${result.error}`,
    actionsJson: [{ ...step, result }]
  });

  return result;
}

/**
 * Execute all plan actions
 * Now uses unified store and plan executor
 */
export async function executeFullPlan({ conversationId, userAccountId, adAccountId }) {
  // First try to find in ai_pending_plans (new system)
  const { unifiedStore } = await import('./stores/unifiedStore.js');
  const { planExecutor } = await import('./planExecutor.js');

  const pendingPlan = await unifiedStore.getPendingPlan(conversationId);

  if (pendingPlan) {
    // New system: use planExecutor
    await unifiedStore.approvePlan(pendingPlan.id);
    const result = await planExecutor.executeFullPlan({
      planId: pendingPlan.id,
      toolContext: { userAccountId, adAccountId }
    });

    // Save result message
    await unifiedStore.addMessage(conversationId, {
      role: 'system',
      content: result.success
        ? `✅ План выполнен: ${result.summary}`
        : `⚠️ План выполнен частично: ${result.summary}`
    });

    return result;
  }

  // Fallback: Legacy system with plan_json in ai_messages
  const { data: messages } = await supabase
    .from('ai_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .eq('role', 'assistant')
    .not('plan_json', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!messages?.length || !messages[0].plan_json) {
    throw new Error('No pending plan found');
  }

  const plan = messages[0].plan_json;
  const results = [];

  const accessToken = await getAccessToken(userAccountId, adAccountId);

  for (const step of plan.steps || []) {
    const result = await executeTool(step.action, step.params, {
      accessToken,
      userAccountId,
      adAccountId
    });
    results.push({ step, result });
  }

  // Save all results
  await saveMessage({
    conversationId,
    role: 'system',
    content: `План выполнен: ${results.filter(r => r.result.success).length}/${results.length} действий успешно`,
    actionsJson: results
  });

  return { results, success: results.every(r => r.result.success) };
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

  // ============================================================
  // TELEGRAM ENDPOINTS
  // ============================================================

  /**
   * Process Telegram message with streaming persistence
   * Called from external Telegram bot service
   */
  fastify.post('/api/brain/telegram/chat', async (request, reply) => {
    const { telegramChatId, message } = request.body;

    if (!telegramChatId || !message) {
      return reply.code(400).send({ error: 'telegramChatId and message are required' });
    }

    try {
      // Create a mock ctx for non-streaming response
      // Real streaming happens when called from Telegram bot directly
      const result = await processTelegramMessage(telegramChatId, message);
      return reply.send(result);
    } catch (error) {
      fastify.log.error({ error: error.message }, 'Telegram chat error');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'telegram_chat_endpoint',
        endpoint: '/api/brain/telegram/chat',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * Clear Telegram conversation
   */
  fastify.post('/api/brain/telegram/clear', async (request, reply) => {
    const { telegramChatId } = request.body;

    if (!telegramChatId) {
      return reply.code(400).send({ error: 'telegramChatId is required' });
    }

    try {
      const userAccount = await findUserByTelegramId(telegramChatId);
      if (!userAccount) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const conversation = await conversationStore.getOrCreateConversation(
        telegramChatId,
        userAccount.id
      );

      await conversationStore.clearMessages(conversation.id);

      return reply.send({ success: true, message: 'Conversation cleared' });
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * Set Telegram conversation mode
   */
  fastify.post('/api/brain/telegram/mode', async (request, reply) => {
    const { telegramChatId, mode } = request.body;

    if (!telegramChatId || !mode) {
      return reply.code(400).send({ error: 'telegramChatId and mode are required' });
    }

    if (!['auto', 'plan', 'ask'].includes(mode)) {
      return reply.code(400).send({ error: 'Invalid mode. Use: auto, plan, ask' });
    }

    try {
      const userAccount = await findUserByTelegramId(telegramChatId);
      if (!userAccount) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const conversation = await conversationStore.getOrCreateConversation(
        telegramChatId,
        userAccount.id
      );

      await conversationStore.setMode(conversation.id, mode);

      return reply.send({ success: true, mode });
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * Get Telegram conversation status
   */
  fastify.get('/api/brain/telegram/status', async (request, reply) => {
    const { telegramChatId } = request.query;

    if (!telegramChatId) {
      return reply.code(400).send({ error: 'telegramChatId is required' });
    }

    try {
      const userAccount = await findUserByTelegramId(telegramChatId);
      if (!userAccount) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const conversation = await conversationStore.getOrCreateConversation(
        telegramChatId,
        userAccount.id
      );

      const messageCount = await conversationStore.getMessageCount(conversation.id);
      const pendingActions = await conversationStore.getPendingActions(conversation.id);

      return reply.send({
        conversationId: conversation.id,
        mode: conversation.mode,
        messageCount,
        lastAgent: conversation.last_agent,
        lastDomain: conversation.last_domain,
        hasPendingActions: pendingActions.length > 0,
        pendingActions: pendingActions.map(a => ({
          id: a.id,
          toolName: a.tool_name,
          agent: a.agent
        }))
      });
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });

  fastify.log.info('Chat Assistant routes registered (including Telegram endpoints)');
}

// ============================================================
// TELEGRAM HELPER FUNCTIONS
// ============================================================

/**
 * Find user by telegram_id
 */
async function findUserByTelegramId(telegramChatId) {
  const chatIdStr = String(telegramChatId);

  const { data } = await supabase
    .from('user_accounts')
    .select('id, username, access_token, ad_account_id, multi_account_enabled')
    .or(`telegram_id.eq.${chatIdStr},telegram_id_2.eq.${chatIdStr},telegram_id_3.eq.${chatIdStr},telegram_id_4.eq.${chatIdStr}`)
    .limit(1)
    .single();

  if (!data) return null;

  // Get default ad account if multi-account
  if (data.multi_account_enabled) {
    const { data: adAccount } = await supabase
      .from('ad_accounts')
      .select('id, access_token')
      .eq('user_account_id', data.id)
      .eq('is_default', true)
      .single();

    if (adAccount) {
      data.default_ad_account_id = adAccount.id;
      if (adAccount.access_token) {
        data.access_token = adAccount.access_token;
      }
    }
  }

  return data;
}

/**
 * Process Telegram message (non-streaming API version)
 */
async function processTelegramMessage(telegramChatId, message) {
  // Find user
  const userAccount = await findUserByTelegramId(telegramChatId);
  if (!userAccount) {
    throw new Error('User not found for this Telegram ID');
  }

  const adAccountId = userAccount.default_ad_account_id || userAccount.ad_account_id;

  // Get or create conversation
  const conversation = await conversationStore.getOrCreateConversation(
    telegramChatId,
    userAccount.id,
    adAccountId
  );

  // Check lock
  const lockAcquired = await conversationStore.acquireLock(conversation.id);
  if (!lockAcquired) {
    throw new Error('Conversation is busy, please wait');
  }

  try {
    // Load history
    const history = await conversationStore.loadMessages(conversation.id);

    // Save user message
    await conversationStore.addMessage(conversation.id, {
      role: 'user',
      content: message
    });

    // Get access token
    const accessToken = await getAccessToken(userAccount.id, adAccountId);

    // Process via orchestrator (non-streaming)
    const response = await orchestrator.processRequest({
      message,
      context: { userAccountId: userAccount.id, adAccountId },
      mode: conversation.mode || 'auto',
      toolContext: { accessToken, userAccountId: userAccount.id, adAccountId },
      conversationHistory: history
    });

    // Save assistant response
    await conversationStore.addMessage(conversation.id, {
      role: 'assistant',
      content: response.content,
      agent: response.agent
    });

    return {
      success: true,
      conversationId: conversation.id,
      content: response.content,
      agent: response.agent,
      executedActions: response.executedActions
    };

  } finally {
    await conversationStore.releaseLock(conversation.id);
  }
}

export default {
  processChat,
  executePlanAction,
  executeFullPlan,
  registerChatRoutes,
  // Telegram exports
  handleTelegramMessage,
  handleClearCommand,
  handleModeCommand,
  handleStatusCommand
};
