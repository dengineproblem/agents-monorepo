/**
 * WhatsAppAgent Handlers - WhatsApp Dialogs
 * Tool execution handlers for WhatsApp operations
 */

import { supabase } from '../../../lib/supabaseClient.js';

export const whatsappHandlers = {
  async getDialogs({ status, limit }, { userAccountId, adAccountId }) {
    // Get dialogs from dialog_analysis (which tracks WhatsApp conversations)
    let query = supabase
      .from('dialog_analysis')
      .select(`
        id, contact_phone, interest_level, score, funnel_stage,
        last_message_at, messages_count, summary,
        lead:lead_id(name)
      `)
      .eq('user_account_id', userAccountId)
      .order('last_message_at', { ascending: false })
      .limit(limit || 20);

    if (adAccountId) {
      query = query.eq('account_id', adAccountId);
    }

    // Filter by activity status
    if (status === 'active') {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      query = query.gte('last_message_at', dayAgo);
    } else if (status === 'inactive') {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      query = query.lt('last_message_at', dayAgo);
    }

    const { data, error } = await query;
    if (error) throw error;

    return {
      success: true,
      dialogs: (data || []).map(d => ({
        id: d.id,
        contact_phone: d.contact_phone,
        lead_name: d.lead?.name,
        interest_level: d.interest_level,
        score: d.score,
        funnel_stage: d.funnel_stage,
        messages_count: d.messages_count,
        last_message_at: d.last_message_at,
        summary: d.summary
      })),
      total: data?.length || 0
    };
  },

  async getDialogMessages({ contact_phone, limit }, { userAccountId }) {
    // Get messages from whatsapp_messages table
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('id, content, from_me, created_at, message_type')
      .eq('contact_phone', contact_phone)
      .eq('user_account_id', userAccountId)
      .order('created_at', { ascending: false })
      .limit(limit || 50);

    if (error) throw error;

    return {
      success: true,
      contact_phone,
      messages: (data || []).reverse().map(m => ({
        id: m.id,
        content: m.content,
        from_me: m.from_me,
        created_at: m.created_at,
        type: m.message_type
      })),
      total: data?.length || 0
    };
  },

  async analyzeDialog({ contact_phone }, { userAccountId }) {
    // Get existing analysis
    const { data: analysis, error } = await supabase
      .from('dialog_analysis')
      .select('*')
      .eq('contact_phone', contact_phone)
      .eq('user_account_id', userAccountId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    if (!analysis) {
      return {
        success: false,
        error: 'Анализ диалога не найден. Возможно, диалог ещё не проанализирован.'
      };
    }

    return {
      success: true,
      analysis: {
        interest_level: analysis.interest_level,
        score: analysis.score,
        funnel_stage: analysis.funnel_stage,
        summary: analysis.summary,
        key_interests: analysis.key_interests,
        objections: analysis.objections,
        buying_signals: analysis.buying_signals,
        next_action: analysis.next_action,
        analyzed_at: analysis.updated_at
      }
    };
  }
};
