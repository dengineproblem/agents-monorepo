/**
 * UnifiedConversationStore - Unified persistence layer for Web and Telegram chat
 * Replaces both contextGatherer.js and conversationStore.js
 */

import { supabase } from '../../lib/supabaseClient.js';
import { logger } from '../../lib/logger.js';

const MAX_CONTEXT_MESSAGES = 20;
const LOCK_TIMEOUT_MINUTES = 5;

export class UnifiedConversationStore {

  // ============================================================
  // CONVERSATION METHODS
  // ============================================================

  /**
   * Get or create conversation
   * @param {Object} params
   * @param {string} params.source - 'web' or 'telegram'
   * @param {string} params.userAccountId - User account UUID
   * @param {string} [params.adAccountId] - Ad account UUID (optional)
   * @param {string} [params.telegramChatId] - Telegram chat ID (required for telegram source)
   * @returns {Promise<Object>} Conversation object
   */
  async getOrCreate({ source, userAccountId, adAccountId = null, telegramChatId = null }) {
    // For Telegram, try to find existing by telegram_chat_id
    if (source === 'telegram' && telegramChatId) {
      const { data: existing, error: findError } = await supabase
        .from('ai_conversations')
        .select('*')
        .eq('telegram_chat_id', telegramChatId)
        .single();

      if (findError && findError.code !== 'PGRST116') {
        logger.error({ error: findError, telegramChatId }, 'Error finding conversation');
        throw findError;
      }

      if (existing) {
        return existing;
      }
    }

    // Create new conversation
    const { data: newConv, error: createError } = await supabase
      .from('ai_conversations')
      .insert({
        user_account_id: userAccountId,
        ad_account_id: adAccountId,
        source,
        telegram_chat_id: telegramChatId,
        title: source === 'telegram' ? 'Telegram Chat' : 'Новый чат'
      })
      .select()
      .single();

    if (createError) {
      logger.error({ error: createError, source, telegramChatId }, 'Error creating conversation');
      throw createError;
    }

    logger.info({ conversationId: newConv.id, source, telegramChatId }, 'Created new conversation');
    return newConv;
  }

  /**
   * Get conversation by ID
   */
  async getById(conversationId) {
    const { data, error } = await supabase
      .from('ai_conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    if (error) {
      logger.error({ error, conversationId }, 'Error getting conversation');
      throw error;
    }

    return data;
  }

  /**
   * Get conversations list for user
   */
  async getList({ userAccountId, adAccountId = null, limit = 20 }) {
    let query = supabase
      .from('ai_conversations')
      .select('id, title, mode, source, created_at, updated_at, last_agent, last_domain')
      .eq('user_account_id', userAccountId)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (adAccountId) {
      query = query.eq('ad_account_id', adAccountId);
    }

    const { data, error } = await query;

    if (error) {
      logger.error({ error, userAccountId }, 'Error getting conversations list');
      throw error;
    }

    return data || [];
  }

  /**
   * Delete conversation
   */
  async delete(conversationId) {
    const { error } = await supabase
      .from('ai_conversations')
      .delete()
      .eq('id', conversationId);

    if (error) {
      logger.error({ error, conversationId }, 'Error deleting conversation');
      throw error;
    }

    logger.info({ conversationId }, 'Deleted conversation');
  }

  // ============================================================
  // LOCK METHODS (for concurrency control)
  // ============================================================

  /**
   * Acquire processing lock (mutex)
   * Returns true if lock acquired, false if already processing
   */
  async acquireLock(conversationId) {
    // Also check for stale locks (older than LOCK_TIMEOUT_MINUTES)
    const staleThreshold = new Date(Date.now() - LOCK_TIMEOUT_MINUTES * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('ai_conversations')
      .update({
        is_processing: true,
        processing_started_at: new Date().toISOString()
      })
      .eq('id', conversationId)
      .or(`is_processing.eq.false,processing_started_at.lt.${staleThreshold}`)
      .select('id')
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error, conversationId }, 'Error acquiring lock');
      return false;
    }

    return !!data;
  }

  /**
   * Release processing lock
   */
  async releaseLock(conversationId) {
    const { error } = await supabase
      .from('ai_conversations')
      .update({
        is_processing: false,
        processing_started_at: null
      })
      .eq('id', conversationId);

    if (error) {
      logger.error({ error, conversationId }, 'Error releasing lock');
    }
  }

  // ============================================================
  // MESSAGE METHODS
  // ============================================================

  /**
   * Load last N messages for LLM context
   * Returns messages in OpenAI format
   */
  async loadMessages(conversationId, limit = MAX_CONTEXT_MESSAGES) {
    const { data: messages, error } = await supabase
      .from('ai_messages')
      .select('role, content, tool_calls, tool_call_id, tool_name, tool_result')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error({ error, conversationId }, 'Error loading messages');
      throw error;
    }

    // Reverse to chronological order and format for OpenAI
    return (messages || []).reverse().map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: m.tool_call_id,
          content: typeof m.tool_result === 'string' ? m.tool_result : JSON.stringify(m.tool_result)
        };
      }

      const msg = {
        role: m.role,
        content: m.content || ''
      };

      // Add tool_calls for assistant messages
      if (m.tool_calls && m.tool_calls.length > 0) {
        msg.tool_calls = m.tool_calls;
      }

      return msg;
    });
  }

  /**
   * Add single message to conversation
   */
  async addMessage(conversationId, message) {
    const { data, error } = await supabase
      .from('ai_messages')
      .insert({
        conversation_id: conversationId,
        role: message.role,
        content: message.content || '',
        plan_json: message.planJson,
        actions_json: message.actionsJson,
        tool_calls: message.toolCalls,
        tool_calls_json: message.toolCallsJson,
        tool_call_id: message.toolCallId,
        tool_name: message.toolName,
        tool_result: message.toolResult,
        agent: message.agent,
        tokens_used: message.tokensUsed
      })
      .select('id')
      .single();

    if (error) {
      logger.error({ error, conversationId, role: message.role }, 'Error adding message');
      throw error;
    }

    // Update conversation timestamp and metadata
    const updates = { updated_at: new Date().toISOString() };
    if (message.agent) updates.last_agent = message.agent;
    if (message.domain) updates.last_domain = message.domain;

    await supabase
      .from('ai_conversations')
      .update(updates)
      .eq('id', conversationId);

    return data;
  }

  /**
   * Add multiple messages (batch insert)
   */
  async addMessages(conversationId, messages) {
    if (!messages || messages.length === 0) return;

    const records = messages.map(m => ({
      conversation_id: conversationId,
      role: m.role,
      content: m.content || '',
      plan_json: m.planJson,
      actions_json: m.actionsJson,
      tool_calls: m.toolCalls,
      tool_calls_json: m.toolCallsJson,
      tool_call_id: m.toolCallId,
      tool_name: m.toolName,
      tool_result: m.toolResult,
      agent: m.agent,
      tokens_used: m.tokensUsed
    }));

    const { error } = await supabase
      .from('ai_messages')
      .insert(records);

    if (error) {
      logger.error({ error, conversationId, count: messages.length }, 'Error adding batch messages');
      throw error;
    }

    // Update conversation timestamp
    const lastAgent = messages.filter(m => m.agent).pop()?.agent;
    const lastDomain = messages.filter(m => m.domain).pop()?.domain;

    const updates = { updated_at: new Date().toISOString() };
    if (lastAgent) updates.last_agent = lastAgent;
    if (lastDomain) updates.last_domain = lastDomain;

    await supabase
      .from('ai_conversations')
      .update(updates)
      .eq('id', conversationId);
  }

  /**
   * Clear conversation messages
   */
  async clearMessages(conversationId) {
    // Delete messages
    const { error: msgError } = await supabase
      .from('ai_messages')
      .delete()
      .eq('conversation_id', conversationId);

    if (msgError) {
      logger.error({ error: msgError, conversationId }, 'Error clearing messages');
      throw msgError;
    }

    // Delete pending plans
    await supabase
      .from('ai_pending_plans')
      .delete()
      .eq('conversation_id', conversationId);

    // Reset rolling summary
    await supabase
      .from('ai_conversations')
      .update({
        rolling_summary: null,
        summary_updated_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId);

    logger.info({ conversationId }, 'Cleared conversation messages');
  }

  /**
   * Get message count
   */
  async getMessageCount(conversationId) {
    const { count, error } = await supabase
      .from('ai_messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId);

    if (error) {
      logger.error({ error, conversationId }, 'Error getting message count');
      return 0;
    }

    return count || 0;
  }

  // ============================================================
  // CONVERSATION STATE METHODS
  // ============================================================

  /**
   * Set conversation mode
   */
  async setMode(conversationId, mode) {
    if (!['auto', 'plan', 'ask'].includes(mode)) {
      throw new Error(`Invalid mode: ${mode}`);
    }

    const { error } = await supabase
      .from('ai_conversations')
      .update({ mode })
      .eq('id', conversationId);

    if (error) {
      logger.error({ error, conversationId, mode }, 'Error setting mode');
      throw error;
    }

    logger.info({ conversationId, mode }, 'Changed conversation mode');
  }

  /**
   * Update rolling summary
   */
  async updateRollingSummary(conversationId, summary) {
    const { error } = await supabase
      .from('ai_conversations')
      .update({
        rolling_summary: summary,
        summary_updated_at: new Date().toISOString()
      })
      .eq('id', conversationId);

    if (error) {
      logger.error({ error, conversationId }, 'Error updating rolling summary');
      throw error;
    }
  }

  /**
   * Update summary message count (for tracking when to update summary)
   */
  async updateSummaryMessageCount(conversationId, messageCount) {
    const { error } = await supabase
      .from('ai_conversations')
      .update({
        summary_message_count: messageCount
      })
      .eq('id', conversationId);

    if (error) {
      logger.error({ error, conversationId }, 'Error updating summary message count');
      throw error;
    }
  }

  /**
   * Update conversation metadata
   */
  async updateMetadata(conversationId, metadata) {
    const updates = { updated_at: new Date().toISOString() };

    if (metadata.lastAgent) updates.last_agent = metadata.lastAgent;
    if (metadata.lastDomain) updates.last_domain = metadata.lastDomain;
    if (metadata.adAccountId) updates.ad_account_id = metadata.adAccountId;
    if (metadata.title) updates.title = metadata.title;

    const { error } = await supabase
      .from('ai_conversations')
      .update(updates)
      .eq('id', conversationId);

    if (error) {
      logger.error({ error, conversationId }, 'Error updating metadata');
      throw error;
    }
  }

  /**
   * Update conversation title (auto-generate from first message)
   */
  async updateTitle(conversationId, title) {
    const { error } = await supabase
      .from('ai_conversations')
      .update({ title })
      .eq('id', conversationId);

    if (error) {
      logger.error({ error, conversationId }, 'Error updating title');
      throw error;
    }
  }

  // ============================================================
  // FOCUS ENTITIES METHODS (Session Memory)
  // ============================================================

  /**
   * Get focus entities from conversation
   * @param {string} conversationId
   * @returns {Promise<Object>} Focus entities (campaignId, directionId, dialogPhone, period)
   */
  async getFocusEntities(conversationId) {
    const { data, error } = await supabase
      .from('ai_conversations')
      .select('focus_entities')
      .eq('id', conversationId)
      .single();

    if (error) {
      logger.error({ error, conversationId }, 'Error getting focus entities');
      return {};
    }

    return data?.focus_entities || {};
  }

  /**
   * Update focus entities (merge with existing, not replace)
   * @param {string} conversationId
   * @param {Object} entities - New entities to merge
   */
  async updateFocusEntities(conversationId, entities) {
    if (!entities || Object.keys(entities).length === 0) {
      return;
    }

    // Get current entities
    const { data: current } = await supabase
      .from('ai_conversations')
      .select('focus_entities')
      .eq('id', conversationId)
      .single();

    // Merge with new entities
    const merged = { ...(current?.focus_entities || {}), ...entities };

    const { error } = await supabase
      .from('ai_conversations')
      .update({ focus_entities: merged })
      .eq('id', conversationId);

    if (error) {
      logger.error({ error, conversationId }, 'Error updating focus entities');
    } else {
      logger.debug({ conversationId, entities }, 'Updated focus entities');
    }
  }

  /**
   * Clear focus entities
   */
  async clearFocusEntities(conversationId) {
    const { error } = await supabase
      .from('ai_conversations')
      .update({ focus_entities: {} })
      .eq('id', conversationId);

    if (error) {
      logger.error({ error, conversationId }, 'Error clearing focus entities');
    }
  }

  /**
   * Set last_list for entity linking (replaces, not merges)
   * @param {string} conversationId
   * @param {Array} entityMap - Array of {ref, type, id, name}
   */
  async setLastList(conversationId, entityMap) {
    if (!Array.isArray(entityMap)) return;

    // Get current entities first
    const { data: current } = await supabase
      .from('ai_conversations')
      .select('focus_entities')
      .eq('id', conversationId)
      .single();

    // Replace only last_list, keep other focus entities
    const updated = {
      ...(current?.focus_entities || {}),
      last_list: entityMap
    };

    const { error } = await supabase
      .from('ai_conversations')
      .update({ focus_entities: updated })
      .eq('id', conversationId);

    if (error) {
      logger.error({ error, conversationId }, 'Error setting last_list');
    } else {
      logger.debug({ conversationId, count: entityMap.length }, 'Set last_list for entity linking');
    }
  }

  // ============================================================
  // PENDING PLAN METHODS
  // ============================================================

  /**
   * Create pending plan
   */
  async createPendingPlan(conversationId, planJson, options = {}) {
    const { source = 'web', telegramChatId = null, agent = null, domain = null } = options;

    const totalSteps = planJson.steps?.length || 0;

    const { data, error } = await supabase
      .from('ai_pending_plans')
      .insert({
        conversation_id: conversationId,
        plan_json: planJson,
        source,
        telegram_chat_id: telegramChatId,
        agent,
        domain,
        total_steps: totalSteps
      })
      .select()
      .single();

    if (error) {
      logger.error({ error, conversationId }, 'Error creating pending plan');
      throw error;
    }

    logger.info({ planId: data.id, conversationId, totalSteps }, 'Created pending plan');
    return data;
  }

  /**
   * Get pending plan for conversation
   */
  async getPendingPlan(conversationId) {
    const { data, error } = await supabase
      .from('ai_pending_plans')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error, conversationId }, 'Error getting pending plan');
      throw error;
    }

    return data;
  }

  /**
   * Get pending plan by ID
   */
  async getPendingPlanById(planId) {
    const { data, error } = await supabase
      .from('ai_pending_plans')
      .select('*')
      .eq('id', planId)
      .single();

    if (error) {
      logger.error({ error, planId }, 'Error getting pending plan by ID');
      throw error;
    }

    return data;
  }

  /**
   * Approve pending plan
   */
  async approvePlan(planId) {
    const { data, error } = await supabase
      .from('ai_pending_plans')
      .update({
        status: 'approved',
        resolved_at: new Date().toISOString()
      })
      .eq('id', planId)
      .eq('status', 'pending')
      .select()
      .single();

    if (error) {
      logger.error({ error, planId }, 'Error approving plan');
      throw error;
    }

    logger.info({ planId }, 'Approved pending plan');
    return data;
  }

  /**
   * Reject pending plan
   */
  async rejectPlan(planId) {
    const { data, error } = await supabase
      .from('ai_pending_plans')
      .update({
        status: 'rejected',
        resolved_at: new Date().toISOString()
      })
      .eq('id', planId)
      .eq('status', 'pending')
      .select()
      .single();

    if (error) {
      logger.error({ error, planId }, 'Error rejecting plan');
      throw error;
    }

    logger.info({ planId }, 'Rejected pending plan');
    return data;
  }

  /**
   * Start plan execution
   */
  async startExecution(planId) {
    const { data, error } = await supabase
      .from('ai_pending_plans')
      .update({
        status: 'executing'
      })
      .eq('id', planId)
      .select()
      .single();

    if (error) {
      logger.error({ error, planId }, 'Error starting execution');
      throw error;
    }

    return data;
  }

  /**
   * Complete plan execution
   */
  async completeExecution(planId, results) {
    const executedSteps = results.filter(r => r.success).length;

    const { data, error } = await supabase
      .from('ai_pending_plans')
      .update({
        status: 'completed',
        execution_results: results,
        executed_steps: executedSteps,
        resolved_at: new Date().toISOString()
      })
      .eq('id', planId)
      .select()
      .single();

    if (error) {
      logger.error({ error, planId }, 'Error completing execution');
      throw error;
    }

    logger.info({ planId, executedSteps, totalSteps: data.total_steps }, 'Completed plan execution');
    return data;
  }

  /**
   * Fail plan execution
   */
  async failExecution(planId, results, errorMessage = null) {
    const executedSteps = results.filter(r => r.success).length;

    const { data, error } = await supabase
      .from('ai_pending_plans')
      .update({
        status: 'failed',
        execution_results: results,
        executed_steps: executedSteps,
        resolved_at: new Date().toISOString()
      })
      .eq('id', planId)
      .select()
      .single();

    if (error) {
      logger.error({ error, planId }, 'Error marking execution as failed');
      throw error;
    }

    logger.warn({ planId, executedSteps, errorMessage }, 'Plan execution failed');
    return data;
  }

  /**
   * Update Telegram message ID for plan (for inline keyboard)
   */
  async updateTelegramMessageId(planId, messageId, chatId) {
    const { error } = await supabase
      .from('ai_pending_plans')
      .update({
        telegram_message_id: messageId,
        telegram_chat_id: chatId
      })
      .eq('id', planId);

    if (error) {
      logger.error({ error, planId }, 'Error updating telegram message ID');
      throw error;
    }
  }
}

// Export singleton instance
export const unifiedStore = new UnifiedConversationStore();
