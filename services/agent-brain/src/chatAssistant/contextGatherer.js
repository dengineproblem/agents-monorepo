/**
 * Context Gatherer for Chat Assistant
 * Collects relevant context data before LLM call
 *
 * NOTE: For conversation/message CRUD operations, prefer using unifiedStore.
 * This module focuses on gathering context data (metrics, profiles, etc.)
 */

import { supabase, supabaseQuery } from '../lib/supabaseClient.js';
import { logger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import { unifiedStore } from './stores/unifiedStore.js';

/**
 * Gather all context needed for the chat assistant
 * @param {Object} params
 * @param {string} params.userAccountId - User account ID
 * @param {string} params.adAccountId - Ad account ID (optional)
 * @param {string} params.conversationId - Current conversation ID
 * @returns {Promise<Object>} Context data
 */
export async function gatherContext({ userAccountId, adAccountId, conversationId }) {
  const context = {};

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

    // Process results
    if (chatHistory.status === 'fulfilled') {
      context.recentMessages = chatHistory.value;
    }

    if (businessProfile.status === 'fulfilled') {
      context.businessProfile = businessProfile.value;
    }

    if (todayMetrics.status === 'fulfilled') {
      context.todayMetrics = todayMetrics.value;
    }

    if (activeContexts.status === 'fulfilled') {
      context.activeContexts = activeContexts.value;
    }

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

    return context;
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
 * Get today's campaign metrics summary
 */
async function getTodayMetrics(userAccountId, adAccountId) {
  // Try to get from campaign_reports or calculate from recent data
  const today = new Date().toISOString().split('T')[0];

  const { data: reports, error } = await supabase
    .from('campaign_reports')
    .select('spend, leads, impressions, clicks')
    .eq('user_account_id', userAccountId)
    .gte('report_date', today)
    .limit(100);

  if (error || !reports?.length) {
    // Fallback: try to get from agent_executions summary
    const { data: execData } = await supabase
      .from('agent_executions')
      .select('request_json')
      .eq('ad_account_id', adAccountId)
      .gte('created_at', today)
      .order('created_at', { ascending: false })
      .limit(1);

    if (execData?.[0]?.request_json?.metrics) {
      return execData[0].request_json.metrics;
    }

    return null;
  }

  // Aggregate metrics
  const totals = reports.reduce((acc, r) => ({
    spend: acc.spend + (r.spend || 0),
    leads: acc.leads + (r.leads || 0),
    impressions: acc.impressions + (r.impressions || 0),
    clicks: acc.clicks + (r.clicks || 0)
  }), { spend: 0, leads: 0, impressions: 0, clicks: 0 });

  totals.cpl = totals.leads > 0 ? Math.round(totals.spend / totals.leads) : null;
  totals.active_campaigns = reports.length;

  return totals;
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
 */
export async function getSpecs(userAccountId, accountId = null) {
  let query = supabase
    .from('user_briefing_responses')
    .select('tracking_spec, crm_spec, kpi_spec')
    .eq('user_id', userAccountId);

  if (accountId) {
    query = query.eq('account_id', accountId);
  } else {
    query = query.is('account_id', null);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    logger.warn({ error: error.message, userAccountId, accountId }, 'Failed to get specs');
    return { tracking: {}, crm: {}, kpi: {} };
  }

  return {
    tracking: data?.tracking_spec || {},
    crm: data?.crm_spec || {},
    kpi: data?.kpi_spec || {}
  };
}

// Re-export unifiedStore for convenience
export { unifiedStore } from './stores/unifiedStore.js';

export default {
  gatherContext,
  getOrCreateConversation,
  saveMessage,
  updateConversationTitle,
  getConversations,
  deleteConversation,
  getSpecs,
  // Also expose unifiedStore on default export
  unifiedStore
};
