/**
 * CRMAgent Handlers - Leads & Funnel
 * Tool execution handlers for CRM operations
 */

import { supabase } from '../../../lib/supabaseClient.js';
import { getDateRange } from '../../shared/dateUtils.js';

export const crmHandlers = {
  async getLeads({ interest_level, funnel_stage, min_score, limit, search }, { userAccountId, adAccountId }) {
    let query = supabase
      .from('leads')
      .select(`
        id, name, phone, created_at,
        dialog_analysis(interest_level, score, funnel_stage, summary)
      `)
      .eq('user_account_id', userAccountId)
      .order('created_at', { ascending: false })
      .limit(limit || 20);

    if (adAccountId) {
      query = query.eq('account_id', adAccountId);
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Filter by analysis fields (post-query since they're in related table)
    let leads = data || [];

    if (interest_level) {
      leads = leads.filter(l => l.dialog_analysis?.interest_level === interest_level);
    }
    if (funnel_stage) {
      leads = leads.filter(l => l.dialog_analysis?.funnel_stage === funnel_stage);
    }
    if (min_score) {
      leads = leads.filter(l => (l.dialog_analysis?.score || 0) >= min_score);
    }

    return {
      success: true,
      leads: leads.map(l => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        created_at: l.created_at,
        interest_level: l.dialog_analysis?.interest_level || 'unknown',
        score: l.dialog_analysis?.score || 0,
        funnel_stage: l.dialog_analysis?.funnel_stage || 'новый',
        summary: l.dialog_analysis?.summary
      })),
      total: leads.length
    };
  },

  async getLeadDetails({ lead_id }, { userAccountId }) {
    const { data: lead, error } = await supabase
      .from('leads')
      .select(`
        *,
        dialog_analysis(*),
        direction:direction_id(name)
      `)
      .eq('id', lead_id)
      .eq('user_account_id', userAccountId)
      .single();

    if (error) throw error;
    if (!lead) return { success: false, error: 'Лид не найден' };

    return {
      success: true,
      lead: {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        created_at: lead.created_at,
        direction: lead.direction?.name,
        analysis: lead.dialog_analysis ? {
          interest_level: lead.dialog_analysis.interest_level,
          score: lead.dialog_analysis.score,
          funnel_stage: lead.dialog_analysis.funnel_stage,
          summary: lead.dialog_analysis.summary,
          key_interests: lead.dialog_analysis.key_interests,
          objections: lead.dialog_analysis.objections,
          next_action: lead.dialog_analysis.next_action
        } : null
      }
    };
  },

  async getFunnelStats({ period }, { userAccountId, adAccountId }) {
    const dateRange = getDateRange(period);

    let query = supabase
      .from('leads')
      .select(`
        id,
        dialog_analysis(funnel_stage, interest_level)
      `)
      .eq('user_account_id', userAccountId)
      .gte('created_at', dateRange.since)
      .lte('created_at', dateRange.until);

    if (adAccountId) {
      query = query.eq('account_id', adAccountId);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Aggregate by funnel stage
    const stages = {};
    const temperatures = { hot: 0, warm: 0, cold: 0, unknown: 0 };

    (data || []).forEach(lead => {
      const stage = lead.dialog_analysis?.funnel_stage || 'новый';
      const temp = lead.dialog_analysis?.interest_level || 'unknown';

      stages[stage] = (stages[stage] || 0) + 1;
      temperatures[temp] = (temperatures[temp] || 0) + 1;
    });

    return {
      success: true,
      period,
      total_leads: data?.length || 0,
      by_stage: stages,
      by_temperature: temperatures
    };
  },

  async updateLeadStage({ lead_id, new_stage, reason }, { userAccountId }) {
    // Update in dialog_analysis
    const { error } = await supabase
      .from('dialog_analysis')
      .update({ funnel_stage: new_stage })
      .eq('lead_id', lead_id);

    if (error) throw error;

    return {
      success: true,
      message: `Этап лида изменён на "${new_stage}"${reason ? ` (${reason})` : ''}`
    };
  }
};
