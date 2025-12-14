/**
 * CRMAgent Handlers - Leads & Funnel
 * Tool execution handlers for CRM operations
 */

import { supabase } from '../../../lib/supabaseClient.js';
import { getDateRange } from '../../shared/dateUtils.js';
import { attachRefs, buildEntityMap } from '../../shared/entityLinker.js';

export const crmHandlers = {
  async getLeads({ interest_level, funnel_stage, min_score, limit, search }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    let query = supabase
      .from('leads')
      .select(`
        id, name, phone, created_at,
        dialog_analysis(interest_level, score, funnel_stage, summary)
      `)
      .eq('user_account_id', userAccountId)
      .order('created_at', { ascending: false })
      .limit(limit || 20);

    if (dbAccountId) {
      query = query.eq('account_id', dbAccountId);
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      return { success: false, error: `Ошибка загрузки лидов: ${error.message}` };
    }

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

    const mappedLeads = leads.map(l => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      created_at: l.created_at,
      interest_level: l.dialog_analysis?.interest_level || 'unknown',
      score: l.dialog_analysis?.score || 0,
      funnel_stage: l.dialog_analysis?.funnel_stage || 'новый',
      summary: l.dialog_analysis?.summary
    }));

    // Add entity refs for entity linking
    const leadsWithRefs = attachRefs(mappedLeads, 'l');
    const entityMap = buildEntityMap(mappedLeads, 'l');

    return {
      success: true,
      leads: leadsWithRefs,
      total: leads.length,
      _entityMap: entityMap  // For saving to focus_entities
    };
  },

  async getLeadDetails({ lead_id }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    let query = supabase
      .from('leads')
      .select(`
        *,
        dialog_analysis(*),
        direction:direction_id(name)
      `)
      .eq('id', lead_id)
      .eq('user_account_id', userAccountId);

    if (dbAccountId) {
      query = query.eq('account_id', dbAccountId);
    }

    const { data: lead, error } = await query.single();

    if (error) {
      return { success: false, error: `Ошибка загрузки лида: ${error.message}` };
    }
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

  async getFunnelStats({ period }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;
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

    if (dbAccountId) {
      query = query.eq('account_id', dbAccountId);
    }

    const { data, error } = await query;
    if (error) {
      return { success: false, error: `Ошибка загрузки статистики: ${error.message}` };
    }

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

  async updateLeadStage({ lead_id, new_stage, reason }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Сначала проверяем принадлежность лида к пользователю/аккаунту
    let checkQuery = supabase
      .from('leads')
      .select('id, name')
      .eq('id', lead_id)
      .eq('user_account_id', userAccountId);

    if (dbAccountId) {
      checkQuery = checkQuery.eq('account_id', dbAccountId);
    }

    const { data: lead, error: checkError } = await checkQuery.maybeSingle();

    if (checkError) {
      return { success: false, error: `Ошибка проверки лида: ${checkError.message}` };
    }

    if (!lead) {
      return { success: false, error: 'Лид не найден или не принадлежит вашему аккаунту' };
    }

    // Update in dialog_analysis
    const { error } = await supabase
      .from('dialog_analysis')
      .update({ funnel_stage: new_stage })
      .eq('lead_id', lead_id);

    if (error) {
      return { success: false, error: `Ошибка обновления: ${error.message}` };
    }

    return {
      success: true,
      message: `Этап лида "${lead.name || lead_id}" изменён на "${new_stage}"${reason ? ` (${reason})` : ''}`
    };
  },

  /**
   * Get revenue statistics by leads
   */
  async getRevenueStats({ period, direction_id }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Period to days
    const periodDays = {
      'last_7d': 7,
      'last_30d': 30,
      'all': null
    }[period] || null;

    const since = (() => {
      if (!periodDays) return null;
      const d = new Date();
      d.setDate(d.getDate() - periodDays);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    })();

    // Step 1: Get leads
    let leadsQuery = supabase
      .from('leads')
      .select('id, chat_id, name, direction_id, is_qualified, created_at')
      .eq('user_account_id', userAccountId);

    if (dbAccountId) {
      leadsQuery = leadsQuery.eq('account_id', dbAccountId);
    }
    if (direction_id) {
      leadsQuery = leadsQuery.eq('direction_id', direction_id);
    }
    if (since) {
      leadsQuery = leadsQuery.gte('created_at', since);
    }

    const { data: leadsData, error: leadsError } = await leadsQuery;

    if (leadsError) {
      return { error: `Ошибка загрузки лидов: ${leadsError.message}` };
    }

    const totalLeads = leadsData?.length || 0;
    const qualifiedLeads = leadsData?.filter(l => l.is_qualified === true).length || 0;

    // Step 2: Get purchases linked to leads
    const leadPhones = leadsData?.map(l => l.chat_id).filter(Boolean) || [];

    if (leadPhones.length === 0) {
      return {
        period,
        totalLeads,
        qualifiedLeads,
        qualificationRate: 0,
        totalRevenue: 0,
        totalRevenue_formatted: '0 ₸',
        purchaseCount: 0,
        averageCheck: 0,
        averageCheck_formatted: '0 ₸',
        conversionRate: 0,
        message: 'Лиды не найдены за указанный период'
      };
    }

    let purchasesQuery = supabase
      .from('purchases')
      .select('id, client_phone, amount, created_at')
      .eq('user_account_id', userAccountId)
      .in('client_phone', leadPhones);

    if (dbAccountId) {
      purchasesQuery = purchasesQuery.eq('account_id', dbAccountId);
    }
    if (since) {
      purchasesQuery = purchasesQuery.gte('created_at', since);
    }

    const { data: purchasesData, error: purchasesError } = await purchasesQuery;

    if (purchasesError) {
      return { error: `Ошибка загрузки продаж: ${purchasesError.message}` };
    }

    // Calculate stats
    const purchaseCount = purchasesData?.length || 0;
    const totalRevenue = purchasesData?.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || 0;
    const averageCheck = purchaseCount > 0 ? Math.round(totalRevenue / purchaseCount) : 0;

    // Unique buyers
    const uniqueBuyers = new Set(purchasesData?.map(p => p.client_phone) || []);
    const conversionRate = totalLeads > 0 ? Math.round((uniqueBuyers.size / totalLeads) * 100) : 0;
    const qualificationRate = totalLeads > 0 ? Math.round((qualifiedLeads / totalLeads) * 100) : 0;

    // Top buyers (by revenue)
    const revenueByPhone = new Map();
    const leadByPhone = new Map();

    for (const lead of leadsData || []) {
      if (lead.chat_id) {
        leadByPhone.set(lead.chat_id, lead);
      }
    }

    for (const purchase of purchasesData || []) {
      const phone = purchase.client_phone;
      if (!revenueByPhone.has(phone)) {
        revenueByPhone.set(phone, 0);
      }
      revenueByPhone.set(phone, revenueByPhone.get(phone) + (Number(purchase.amount) || 0));
    }

    const topBuyers = [...revenueByPhone.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([phone, revenue]) => {
        const lead = leadByPhone.get(phone);
        return {
          name: lead?.name || phone,
          phone,
          revenue,
          revenue_formatted: `${(revenue / 1000).toFixed(0)}K ₸`
        };
      });

    return {
      period,
      totalLeads,
      qualifiedLeads,
      qualificationRate,
      qualificationRate_formatted: `${qualificationRate}%`,
      totalRevenue,
      totalRevenue_formatted: `${(totalRevenue / 1000).toFixed(0)}K ₸`,
      purchaseCount,
      averageCheck,
      averageCheck_formatted: `${(averageCheck / 1000).toFixed(0)}K ₸`,
      uniqueBuyers: uniqueBuyers.size,
      conversionRate,
      conversionRate_formatted: `${conversionRate}%`,
      topBuyers
    };
  }
};
