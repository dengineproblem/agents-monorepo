/**
 * ConversationStore - Persistence layer for chat conversations
 * Handles storage and retrieval of conversation history
 */

import { supabase } from '../../lib/supabaseClient.js';
import { logger } from '../../lib/logger.js';

const MAX_CONTEXT_MESSAGES = 20;

export class ConversationStore {

  /**
   * Get or create conversation by telegram chat ID
   */
  async getOrCreateConversation(telegramChatId, userAccountId, adAccountId = null) {
    // Try to find existing
    let { data, error } = await supabase
      .from('chat_conversations')
      .select('*')
      .eq('telegram_chat_id', telegramChatId)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows found, which is expected
      logger.error({ error, telegramChatId }, 'Error finding conversation');
      throw error;
    }

    if (!data) {
      // Create new conversation
      const { data: newConv, error: createError } = await supabase
        .from('chat_conversations')
        .insert({
          telegram_chat_id: telegramChatId,
          user_account_id: userAccountId,
          ad_account_id: adAccountId,
          source: 'telegram'
        })
        .select()
        .single();

      if (createError) {
        logger.error({ error: createError, telegramChatId }, 'Error creating conversation');
        throw createError;
      }
      data = newConv;

      logger.info({ conversationId: data.id, telegramChatId }, 'Created new conversation');
    }

    return data;
  }

  /**
   * Get conversation by ID
   */
  async getConversation(conversationId) {
    const { data, error } = await supabase
      .from('chat_conversations')
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
   * Load last N messages for LLM context
   * Returns messages in OpenAI format
   */
  async loadMessages(conversationId, limit = MAX_CONTEXT_MESSAGES) {
    const { data: messages, error } = await supabase
      .from('chat_messages')
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
        content: m.content
      };

      // Add tool_calls for assistant messages
      if (m.tool_calls && m.tool_calls.length > 0) {
        msg.tool_calls = m.tool_calls;
      }

      return msg;
    });
  }

  /**
   * Add message to conversation
   */
  async addMessage(conversationId, message) {
    const { error } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: conversationId,
        role: message.role,
        content: message.content,
        tool_calls: message.tool_calls,
        tool_call_id: message.tool_call_id,
        tool_name: message.tool_name,
        tool_result: message.tool_result,
        agent: message.agent,
        tokens_used: message.tokens_used
      });

    if (error) {
      logger.error({ error, conversationId, role: message.role }, 'Error adding message');
      throw error;
    }

    // Update conversation timestamp and last_agent
    await supabase
      .from('chat_conversations')
      .update({
        updated_at: new Date().toISOString(),
        ...(message.agent ? { last_agent: message.agent } : {})
      })
      .eq('id', conversationId);
  }

  /**
   * Add multiple messages (batch insert)
   */
  async addMessages(conversationId, messages) {
    if (!messages || messages.length === 0) return;

    const records = messages.map(m => ({
      conversation_id: conversationId,
      role: m.role,
      content: m.content,
      tool_calls: m.tool_calls,
      tool_call_id: m.tool_call_id,
      tool_name: m.tool_name,
      tool_result: m.tool_result,
      agent: m.agent,
      tokens_used: m.tokens_used
    }));

    const { error } = await supabase
      .from('chat_messages')
      .insert(records);

    if (error) {
      logger.error({ error, conversationId, count: messages.length }, 'Error adding batch messages');
      throw error;
    }

    // Update conversation timestamp
    const lastAgent = messages.filter(m => m.agent).pop()?.agent;
    await supabase
      .from('chat_conversations')
      .update({
        updated_at: new Date().toISOString(),
        ...(lastAgent ? { last_agent: lastAgent } : {})
      })
      .eq('id', conversationId);
  }

  /**
   * Acquire processing lock (mutex)
   * Returns true if lock acquired, false if already processing
   */
  async acquireLock(conversationId) {
    const { data, error } = await supabase
      .from('chat_conversations')
      .update({ is_processing: true })
      .eq('id', conversationId)
      .eq('is_processing', false)  // Only if not already processing
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
      .from('chat_conversations')
      .update({ is_processing: false })
      .eq('id', conversationId);

    if (error) {
      logger.error({ error, conversationId }, 'Error releasing lock');
    }
  }

  /**
   * Update rolling summary (called periodically for long conversations)
   */
  async updateRollingSummary(conversationId, summary) {
    const { error } = await supabase
      .from('chat_conversations')
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
   * Clear conversation messages (keep header, delete messages)
   */
  async clearMessages(conversationId) {
    const { error } = await supabase
      .from('chat_messages')
      .delete()
      .eq('conversation_id', conversationId);

    if (error) {
      logger.error({ error, conversationId }, 'Error clearing messages');
      throw error;
    }

    // Also clear pending actions and rolling summary
    await supabase
      .from('chat_pending_actions')
      .delete()
      .eq('conversation_id', conversationId);

    await supabase
      .from('chat_conversations')
      .update({
        rolling_summary: null,
        summary_updated_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId);

    logger.info({ conversationId }, 'Cleared conversation messages');
  }

  /**
   * Set conversation mode
   */
  async setMode(conversationId, mode) {
    if (!['auto', 'plan', 'ask'].includes(mode)) {
      throw new Error(`Invalid mode: ${mode}`);
    }

    const { error } = await supabase
      .from('chat_conversations')
      .update({ mode })
      .eq('id', conversationId);

    if (error) {
      logger.error({ error, conversationId, mode }, 'Error setting mode');
      throw error;
    }

    logger.info({ conversationId, mode }, 'Changed conversation mode');
  }

  /**
   * Update conversation metadata
   */
  async updateMetadata(conversationId, metadata) {
    const updates = {};
    if (metadata.lastAgent) updates.last_agent = metadata.lastAgent;
    if (metadata.lastDomain) updates.last_domain = metadata.lastDomain;
    if (metadata.adAccountId) updates.ad_account_id = metadata.adAccountId;
    updates.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from('chat_conversations')
      .update(updates)
      .eq('id', conversationId);

    if (error) {
      logger.error({ error, conversationId }, 'Error updating metadata');
      throw error;
    }
  }

  /**
   * Add pending action (for approval flow)
   */
  async addPendingAction(conversationId, action) {
    const { data, error } = await supabase
      .from('chat_pending_actions')
      .insert({
        conversation_id: conversationId,
        tool_name: action.toolName,
        tool_args: action.toolArgs,
        agent: action.agent,
        status: 'pending'
      })
      .select()
      .single();

    if (error) {
      logger.error({ error, conversationId, toolName: action.toolName }, 'Error adding pending action');
      throw error;
    }

    return data;
  }

  /**
   * Get pending actions for conversation
   */
  async getPendingActions(conversationId) {
    const { data, error } = await supabase
      .from('chat_pending_actions')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      logger.error({ error, conversationId }, 'Error getting pending actions');
      throw error;
    }

    return data || [];
  }

  /**
   * Resolve pending action (approve/reject)
   */
  async resolvePendingAction(actionId, status) {
    if (!['approved', 'rejected'].includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    const { data, error } = await supabase
      .from('chat_pending_actions')
      .update({
        status,
        resolved_at: new Date().toISOString()
      })
      .eq('id', actionId)
      .select()
      .single();

    if (error) {
      logger.error({ error, actionId, status }, 'Error resolving pending action');
      throw error;
    }

    return data;
  }

  /**
   * Get message count for conversation
   */
  async getMessageCount(conversationId) {
    const { count, error } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId);

    if (error) {
      logger.error({ error, conversationId }, 'Error getting message count');
      return 0;
    }

    return count || 0;
  }
}

// Export singleton instance
export const conversationStore = new ConversationStore();
