/**
 * Context Gatherer for Chat Assistant
 * Collects relevant context data before LLM call
 */

import { supabase, supabaseQuery } from '../lib/supabaseClient.js';
import { logger } from '../lib/logger.js';

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
 */
export async function getOrCreateConversation({ userAccountId, adAccountId, conversationId, mode }) {
  // If conversationId provided, fetch it
  if (conversationId) {
    const { data, error } = await supabase
      .from('ai_conversations')
      .select('*')
      .eq('id', conversationId)
      .eq('user_account_id', userAccountId)
      .single();

    if (!error && data) {
      return data;
    }
  }

  // Create new conversation
  const { data: newConv, error: createError } = await supabase
    .from('ai_conversations')
    .insert({
      user_account_id: userAccountId,
      ad_account_id: adAccountId,
      title: 'Новый чат',
      mode: mode || 'auto'
    })
    .select()
    .single();

  if (createError) {
    throw new Error(`Failed to create conversation: ${createError.message}`);
  }

  return newConv;
}

/**
 * Save a message to the conversation
 */
export async function saveMessage({ conversationId, role, content, planJson, actionsJson, toolCallsJson }) {
  const { data, error } = await supabase
    .from('ai_messages')
    .insert({
      conversation_id: conversationId,
      role,
      content,
      plan_json: planJson || null,
      actions_json: actionsJson || null,
      tool_calls_json: toolCallsJson || null
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to save message: ${error.message}`);
  }

  return data;
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
export async function getConversations({ userAccountId, adAccountId, limit = 20 }) {
  let query = supabase
    .from('ai_conversations')
    .select('id, title, mode, updated_at, created_at')
    .eq('user_account_id', userAccountId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (adAccountId) {
    query = query.eq('ad_account_id', adAccountId);
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

export default {
  gatherContext,
  getOrCreateConversation,
  saveMessage,
  updateConversationTitle,
  getConversations,
  deleteConversation
};
