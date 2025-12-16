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

    // Step 1: Get leads
    let leadsQuery = supabase
      .from('leads')
      .select('id, name, phone, chat_id, created_at')
      .eq('user_account_id', userAccountId)
      .order('created_at', { ascending: false })
      .limit(limit || 20);

    if (dbAccountId) {
      leadsQuery = leadsQuery.eq('account_id', dbAccountId);
    }

    if (search) {
      leadsQuery = leadsQuery.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    const { data: leadsData, error: leadsError } = await leadsQuery;

    if (leadsError) {
      return { success: false, error: `Ошибка загрузки лидов: ${leadsError.message}` };
    }

    let leads = leadsData || [];

    // Step 2: Get dialog_analysis by contact_phone (linked via leads.chat_id)
    const chatIds = leads.map(l => l.chat_id).filter(Boolean);
    let analysisMap = new Map();

    if (chatIds.length > 0) {
      const { data: analysisData } = await supabase
        .from('dialog_analysis')
        .select('contact_phone, interest_level, score, funnel_stage, summary')
        .in('contact_phone', chatIds);

      if (analysisData) {
        for (const a of analysisData) {
          analysisMap.set(a.contact_phone, a);
        }
      }
    }

    // Step 3: Merge and filter
    let mergedLeads = leads.map(l => {
      const analysis = analysisMap.get(l.chat_id);
      return {
        ...l,
        dialog_analysis: analysis || null
      };
    });

    if (interest_level) {
      mergedLeads = mergedLeads.filter(l => l.dialog_analysis?.interest_level === interest_level);
    }
    if (funnel_stage) {
      mergedLeads = mergedLeads.filter(l => l.dialog_analysis?.funnel_stage === funnel_stage);
    }
    if (min_score) {
      mergedLeads = mergedLeads.filter(l => (l.dialog_analysis?.score || 0) >= min_score);
    }

    const mappedLeads = mergedLeads.map(l => ({
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
      total: mergedLeads.length,
      _entityMap: entityMap  // For saving to focus_entities
    };
  },

  async getLeadDetails({ lead_id }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Step 1: Get lead with direction
    let leadQuery = supabase
      .from('leads')
      .select(`
        *,
        direction:direction_id(name)
      `)
      .eq('id', lead_id)
      .eq('user_account_id', userAccountId);

    if (dbAccountId) {
      leadQuery = leadQuery.eq('account_id', dbAccountId);
    }

    const { data: lead, error: leadError } = await leadQuery.single();

    if (leadError) {
      return { success: false, error: `Ошибка загрузки лида: ${leadError.message}` };
    }
    if (!lead) return { success: false, error: 'Лид не найден' };

    // Step 2: Get dialog_analysis by contact_phone (linked via leads.chat_id)
    let analysis = null;
    if (lead.chat_id) {
      const { data: analysisData } = await supabase
        .from('dialog_analysis')
        .select('*')
        .eq('contact_phone', lead.chat_id)
        .maybeSingle();

      analysis = analysisData;
    }

    return {
      success: true,
      lead: {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        created_at: lead.created_at,
        direction: lead.direction?.name,
        analysis: analysis ? {
          interest_level: analysis.interest_level,
          score: analysis.score,
          funnel_stage: analysis.funnel_stage,
          summary: analysis.summary,
          key_interests: analysis.key_interests,
          objections: analysis.objections,
          next_action: analysis.next_action
        } : null
      }
    };
  },

  async getFunnelStats({ period }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;
    const dateRange = getDateRange(period);

    // Step 1: Get leads with chat_id
    let leadsQuery = supabase
      .from('leads')
      .select('id, chat_id')
      .eq('user_account_id', userAccountId)
      .gte('created_at', dateRange.since)
      .lte('created_at', dateRange.until);

    if (dbAccountId) {
      leadsQuery = leadsQuery.eq('account_id', dbAccountId);
    }

    const { data: leadsData, error: leadsError } = await leadsQuery;
    if (leadsError) {
      return { success: false, error: `Ошибка загрузки статистики: ${leadsError.message}` };
    }

    const leads = leadsData || [];

    // Step 2: Get dialog_analysis by contact_phone (linked via leads.chat_id)
    const chatIds = leads.map(l => l.chat_id).filter(Boolean);
    let analysisMap = new Map();

    if (chatIds.length > 0) {
      const { data: analysisData } = await supabase
        .from('dialog_analysis')
        .select('contact_phone, funnel_stage, interest_level')
        .in('contact_phone', chatIds);

      if (analysisData) {
        for (const a of analysisData) {
          analysisMap.set(a.contact_phone, a);
        }
      }
    }

    // Step 3: Aggregate by funnel stage
    const stages = {};
    const temperatures = { hot: 0, warm: 0, cold: 0, unknown: 0 };

    leads.forEach(lead => {
      const analysis = analysisMap.get(lead.chat_id);
      const stage = analysis?.funnel_stage || 'новый';
      const temp = analysis?.interest_level || 'unknown';

      stages[stage] = (stages[stage] || 0) + 1;
      temperatures[temp] = (temperatures[temp] || 0) + 1;
    });

    return {
      success: true,
      period,
      total_leads: leads.length,
      by_stage: stages,
      by_temperature: temperatures
    };
  },

  async updateLeadStage({ lead_id, new_stage, reason }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Сначала проверяем принадлежность лида к пользователю/аккаунту и получаем chat_id
    let checkQuery = supabase
      .from('leads')
      .select('id, name, chat_id')
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

    if (!lead.chat_id) {
      return { success: false, error: 'У лида отсутствует chat_id для связи с анализом' };
    }

    // Update in dialog_analysis by contact_phone (linked via leads.chat_id)
    const { error } = await supabase
      .from('dialog_analysis')
      .update({ funnel_stage: new_stage })
      .eq('contact_phone', lead.chat_id);

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
  },

  /**
   * getSalesQuality - KPI ladder для анализа качества трафика
   * Возвращает: sales_count, sales_amount, leads_total, qualified_count, qual_rate, conversion_rate
   */
  async getSalesQuality({ direction_id, period }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Period to days
    const periodDays = {
      'last_3d': 3,
      'last_7d': 7,
      'last_14d': 14,
      'last_30d': 30
    }[period] || 7;

    const since = (() => {
      const d = new Date();
      d.setDate(d.getDate() - periodDays);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    })();

    // Step 1: Get leads
    let leadsQuery = supabase
      .from('leads')
      .select('id, chat_id, name, direction_id, is_qualified, created_at')
      .eq('user_account_id', userAccountId)
      .gte('created_at', since);

    if (dbAccountId) {
      leadsQuery = leadsQuery.eq('account_id', dbAccountId);
    }
    if (direction_id) {
      leadsQuery = leadsQuery.eq('direction_id', direction_id);
    }

    const { data: leadsData, error: leadsError } = await leadsQuery;

    if (leadsError) {
      return { success: false, error: `Ошибка загрузки лидов: ${leadsError.message}` };
    }

    const leads = leadsData || [];
    const leads_total = leads.length;
    const qualified_count = leads.filter(l => l.is_qualified === true).length;

    // Step 2: Get purchases linked to leads
    const leadPhones = leads.map(l => l.chat_id).filter(Boolean);

    if (leadPhones.length === 0) {
      return {
        success: true,
        sales_count: 0,
        sales_amount: 0,
        sales_amount_formatted: '0 ₸',
        leads_total,
        qualified_count,
        qual_rate: 0,
        qual_rate_formatted: '0%',
        conversion_rate: 0,
        conversion_rate_formatted: '0%',
        attribution: 'crm_primary',
        period
      };
    }

    let purchasesQuery = supabase
      .from('purchases')
      .select('id, client_phone, amount, created_at')
      .eq('user_account_id', userAccountId)
      .in('client_phone', leadPhones)
      .gte('created_at', since);

    if (dbAccountId) {
      purchasesQuery = purchasesQuery.eq('account_id', dbAccountId);
    }

    const { data: purchasesData, error: purchasesError } = await purchasesQuery;

    if (purchasesError) {
      return { success: false, error: `Ошибка загрузки продаж: ${purchasesError.message}` };
    }

    // Calculate stats
    const sales_count = purchasesData?.length || 0;
    const sales_amount = purchasesData?.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || 0;

    // Unique buyers for conversion
    const uniqueBuyers = new Set(purchasesData?.map(p => p.client_phone) || []);
    const conversion_rate = leads_total > 0 ? Math.round((uniqueBuyers.size / leads_total) * 100) : 0;
    const qual_rate = leads_total > 0 ? Math.round((qualified_count / leads_total) * 100) : 0;

    return {
      success: true,
      sales_count,
      sales_amount,
      sales_amount_formatted: `${(sales_amount / 1000).toFixed(0)}K ₸`,
      leads_total,
      qualified_count,
      qual_rate,
      qual_rate_formatted: `${qual_rate}%`,
      conversion_rate,
      conversion_rate_formatted: `${conversion_rate}%`,
      attribution: 'crm_primary',
      period
    };
  }
};
