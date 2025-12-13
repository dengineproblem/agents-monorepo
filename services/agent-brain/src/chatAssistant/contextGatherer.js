/**
 * Context Gatherer for Chat Assistant
 * Collects relevant context data before LLM call with token budgeting
 *
 * NOTE: For conversation/message CRUD operations, prefer using unifiedStore.
 * This module focuses on gathering context data (metrics, profiles, etc.)
 */

import { supabase, supabaseQuery } from '../lib/supabaseClient.js';
import { logger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import { unifiedStore } from './stores/unifiedStore.js';
import { TokenBudget } from './shared/tokenBudget.js';

/**
 * Gather all context needed for the chat assistant with token budgeting
 * @param {Object} params
 * @param {string} params.userAccountId - User account ID
 * @param {string} params.adAccountId - Ad account ID (optional)
 * @param {string} params.conversationId - Current conversation ID
 * @param {Object} params.budget - Optional custom budget configuration
 * @returns {Promise<Object>} Context data with stats
 */
export async function gatherContext({ userAccountId, adAccountId, conversationId, budget = {} }) {
  const tokenBudget = new TokenBudget(budget);

  try {
    // Run queries in parallel for speed
    const [
      chatHistory,
      businessProfile,
      todayMetrics,
      activeContexts
    ] = await Promise.allSettled([
      getChatHistory(conversationId),
      getBusinessProfile(userAccountId),
      getTodayMetrics(userAccountId, adAccountId),
      getActiveContexts(userAccountId)
    ]);

    // Add blocks with priorities (higher = more important, kept first)
    // Priority 10: Chat history — most important for continuity
    if (chatHistory.status === 'fulfilled' && chatHistory.value) {
      tokenBudget.addBlock('recentMessages', chatHistory.value, 10);
    }

    // Priority 8: Today's metrics — current state
    if (todayMetrics.status === 'fulfilled' && todayMetrics.value) {
      tokenBudget.addBlock('todayMetrics', todayMetrics.value, 8);
    }

    // Priority 6: Business profile — context about the business
    if (businessProfile.status === 'fulfilled' && businessProfile.value) {
      tokenBudget.addBlock('businessProfile', businessProfile.value, 6);
    }

    // Priority 4: Active contexts — promotional contexts
    if (activeContexts.status === 'fulfilled' && activeContexts.value) {
      tokenBudget.addBlock('activeContexts', activeContexts.value, 4);
    }

    // Build context with budgeting
    const { context, stats } = tokenBudget.build();

    logger.debug({
      userAccountId,
      conversationId,
      contextStats: {
        usedTokens: stats.usedTokens,
        budget: stats.budget,
        utilization: stats.utilization + '%',
        blocks: stats.blocksIncluded
      }
    }, 'Context gathered with token budgeting');

    return context;

  } catch (error) {
    logger.error({ error: error.message }, 'Failed to gather context');

    logErrorToAdmin({
      user_account_id: userAccountId,
      error_type: 'api',
      raw_error: error.message || String(error),
      stack_trace: error.stack,
      action: 'gather_context',
      severity: 'warning'
    }).catch(() => {});

    return {};
  }
}

/**
 * Get recent chat history for conversation
 */
async function getChatHistory(conversationId) {
  if (!conversationId) return [];

  const { data, error } = await supabase
    .from('ai_messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    logger.warn({ error: error.message }, 'Failed to get chat history');
    return [];
  }

  // Return in chronological order
  return (data || []).reverse();
}

/**
 * Get business profile for personalized context
 */
async function getBusinessProfile(userAccountId) {
  const { data, error } = await supabase
    .from('business_profile')
    .select('*')
    .eq('user_account_id', userAccountId)
    .maybeSingle();

  if (error) {
    logger.warn({ error: error.message }, 'Failed to get business profile');
    return null;
  }

  return data;
}

/**
 * Get today's campaign metrics summary from scoring_executions
 * scoring_output содержит готовую выжимку метрик (обновляется каждый день в 08:00)
 */
async function getTodayMetrics(userAccountId, adAccountId) {
  try {
    // 1. Получить последний scoring_output (обновляется каждый день в 08:00)
    let query = supabase
      .from('scoring_executions')
      .select('scoring_output, created_at')
      .eq('user_account_id', userAccountId)
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(1);

    // Для мультиаккаунтности фильтруем по account_id
    if (adAccountId) {
      query = query.eq('account_id', adAccountId);
    }

    const { data: execution, error } = await query.maybeSingle();

    if (error) {
      logger.warn({ error: error.message }, 'Failed to get scoring_executions');
      return null;
    }

    if (!execution?.scoring_output) {
      return null;
    }

    // 2. Извлечь агрегированные метрики из adsets
    const { adsets, ready_creatives } = execution.scoring_output;

    if (!adsets?.length) {
      return null;
    }

    // 3. Суммировать по всем adsets (metrics_last_7d — это агрегат за 7 дней)
    const totals = adsets.reduce((acc, adset) => {
      const m = adset.metrics_last_7d || {};
      return {
        spend: acc.spend + (parseFloat(m.spend) || 0),
        leads: acc.leads + (parseInt(m.total_leads) || 0),
        impressions: acc.impressions + (parseInt(m.impressions) || 0),
        clicks: acc.clicks + (parseInt(m.clicks) || 0)
      };
    }, { spend: 0, leads: 0, impressions: 0, clicks: 0 });

    // Округляем spend
    totals.spend = Math.round(totals.spend * 100) / 100;
    totals.cpl = totals.leads > 0 ? Math.round(totals.spend / totals.leads) : null;
    totals.active_adsets = adsets.length;
    totals.active_creatives = ready_creatives?.filter(c => c.has_data)?.length || 0;
    totals.data_date = execution.created_at;
    totals.period = 'last_7d'; // scoring_output содержит метрики за 7 дней

    return totals;

  } catch (error) {
    logger.warn({ error: error.message }, 'Error getting today metrics from scoring_executions');
    return null;
  }
}

/**
 * Get active promotional contexts
 */
async function getActiveContexts(userAccountId) {
  const { data, error } = await supabase
    .from('campaign_contexts')
    .select('id, title, content, context_type')
    .eq('user_account_id', userAccountId)
    .eq('is_active', true)
    .limit(5);

  if (error) {
    logger.warn({ error: error.message }, 'Failed to get active contexts');
    return [];
  }

  return data || [];
}

/**
 * Get or create a conversation
 * @deprecated Use unifiedStore.getOrCreate() for new code
 */
export async function getOrCreateConversation({ userAccountId, adAccountId, conversationId, mode }) {
  // Delegate to unifiedStore for unified behavior
  if (conversationId) {
    const existing = await unifiedStore.getById(conversationId);
    if (existing && existing.user_account_id === userAccountId) {
      return existing;
    }
  }

  // Create via unifiedStore (source: 'web' for backward compatibility)
  return await unifiedStore.getOrCreate({
    source: 'web',
    userAccountId,
    adAccountId,
    mode
  });
}

/**
 * Save a message to the conversation
 * @deprecated Use unifiedStore.addMessage() for new code
 */
export async function saveMessage({ conversationId, role, content, planJson, actionsJson, toolCallsJson, agent, domain }) {
  // Delegate to unifiedStore for unified behavior
  return await unifiedStore.addMessage(conversationId, {
    role,
    content,
    plan_json: planJson,
    actions_json: actionsJson,
    tool_calls: toolCallsJson,
    agent,
    domain
  });
}

/**
 * Update conversation title (auto-generated from first message)
 */
export async function updateConversationTitle(conversationId, message) {
  // Generate title from first user message (truncated)
  const title = message.slice(0, 50) + (message.length > 50 ? '...' : '');

  await supabase
    .from('ai_conversations')
    .update({ title })
    .eq('id', conversationId);
}

/**
 * Get list of conversations for user
 */
export async function getConversations({ userAccountId, adAccountId, limit = 20, source = null }) {
  let query = supabase
    .from('ai_conversations')
    .select('id, title, mode, source, last_agent, last_domain, updated_at, created_at')
    .eq('user_account_id', userAccountId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (adAccountId) {
    query = query.eq('ad_account_id', adAccountId);
  }

  // Filter by source if specified (web, telegram)
  if (source) {
    query = query.eq('source', source);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get conversations: ${error.message}`);
  }

  return data || [];
}

/**
 * Delete a conversation
 */
export async function deleteConversation(conversationId, userAccountId) {
  const { error } = await supabase
    .from('ai_conversations')
    .delete()
    .eq('id', conversationId)
    .eq('user_account_id', userAccountId);

  if (error) {
    throw new Error(`Failed to delete conversation: ${error.message}`);
  }

  return { success: true };
}

/**
 * Get business specs (procedural memory)
 * @param {string} userAccountId
 * @param {string|null} accountId - For multi-account: ad_account FK, null for legacy
 * @returns {Promise<Object>} { tracking, crm, kpi }
 * @deprecated Use memoryStore.getSpecs() directly
 */
export async function getSpecs(userAccountId, accountId = null) {
  const { memoryStore } = await import('./stores/memoryStore.js');
  return memoryStore.getSpecs(userAccountId, accountId);
}

/**
 * Get agent notes digest (mid-term memory)
 * @param {string} userAccountId
 * @param {string|null} accountId
 * @returns {Promise<Object>} { ads: [...], creative: [...], ... }
 */
export async function getNotesDigest(userAccountId, accountId = null) {
  const { memoryStore } = await import('./stores/memoryStore.js');
  return memoryStore.getNotesDigest(userAccountId, accountId);
}

// Re-export stores for convenience
export { unifiedStore } from './stores/unifiedStore.js';
export { memoryStore } from './stores/memoryStore.js';

export default {
  gatherContext,
  getOrCreateConversation,
  saveMessage,
  updateConversationTitle,
  getConversations,
  deleteConversation,
  getSpecs,
  getNotesDigest,
  // Also expose stores on default export
  unifiedStore,
  memoryStore
};
