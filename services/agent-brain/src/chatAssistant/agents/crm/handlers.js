/**
 * CRMAgent Handlers - Leads, Funnel & amoCRM
 * Tool execution handlers for CRM operations
 */

import { supabase } from '../../../lib/supabaseClient.js';
import { getDateRange } from '../../shared/dateUtils.js';
import { attachRefs, buildEntityMap } from '../../shared/entityLinker.js';

// Helper: get period days
function getPeriodDays(period) {
  return {
    'last_3d': 3,
    'last_7d': 7,
    'last_14d': 14,
    'last_30d': 30,
    'last_90d': 90,
    'last_6m': 180,
    'last_12m': 365,
    'last_year': 365,
    'all': 3650 // ~10 лет - достаточно для "все время"
  }[period] || 7;
}

// Helper: get since date from period
function getSinceDate(period) {
  const days = getPeriodDays(period);
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// Helper: get date range from date_from/date_to or fallback to period
// Returns { since: ISO string, until: ISO string, periodDescription: string }
function getDateRangeFromParams({ date_from, date_to, period }) {
  if (date_from) {
    // Explicit date range has priority
    const sinceDate = new Date(date_from + 'T00:00:00Z').toISOString();
    const untilDate = date_to
      ? new Date(date_to + 'T23:59:59Z').toISOString()
      : new Date().toISOString();
    return {
      since: sinceDate,
      until: untilDate,
      periodDescription: `${date_from} - ${date_to || 'сегодня'}`
    };
  }
  // Fallback to preset period
  const since = getSinceDate(period || 'last_7d');
  return {
    since,
    until: new Date().toISOString(),
    periodDescription: period || 'last_7d'
  };
}

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

  async getSales({ direction_id, period, date_from, date_to, min_amount, search, limit }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Get date range
    const { since, until, periodDescription } = getDateRangeFromParams({ date_from, date_to, period });

    // Query purchases
    let purchasesQuery = supabase
      .from('purchases')
      .select(`
        id,
        client_phone,
        amount,
        created_at,
        user_account_id,
        account_id
      `)
      .eq('user_account_id', userAccountId)
      .gte('created_at', since)
      .lte('created_at', until)
      .order('created_at', { ascending: false })
      .limit(limit || 50);

    if (dbAccountId) {
      purchasesQuery = purchasesQuery.eq('account_id', dbAccountId);
    }

    if (min_amount) {
      purchasesQuery = purchasesQuery.gte('amount', min_amount);
    }

    if (search) {
      purchasesQuery = purchasesQuery.ilike('client_phone', `%${search}%`);
    }

    const { data: purchases, error: purchasesError } = await purchasesQuery;

    if (purchasesError) {
      return { success: false, error: `Ошибка загрузки продаж: ${purchasesError.message}` };
    }

    // Get leads info for each purchase
    const phones = purchases?.map(p => p.client_phone).filter(Boolean) || [];
    let leadsMap = new Map();

    if (phones.length > 0) {
      let leadsQuery = supabase
        .from('leads')
        .select(`
          chat_id,
          source_id,
          direction_id,
          direction:direction_id(name),
          creative:creative_id(name)
        `)
        .eq('user_account_id', userAccountId)
        .in('chat_id', phones);

      if (dbAccountId) {
        leadsQuery = leadsQuery.eq('account_id', dbAccountId);
      }

      const { data: leads } = await leadsQuery;

      if (leads) {
        for (const lead of leads) {
          leadsMap.set(lead.chat_id, lead);
        }
      }
    }

    // Map purchases with lead info
    const salesList = purchases?.map(p => {
      const lead = leadsMap.get(p.client_phone);
      return {
        id: p.id,
        client_phone: p.client_phone,
        amount: p.amount,
        amount_formatted: `${(p.amount / 1000).toFixed(0)}K ₸`,
        created_at: p.created_at,
        lead_source: lead?.source_id || 'unknown',
        creative_name: lead?.creative?.name || null,
        direction_name: lead?.direction?.name || null,
        direction_id: lead?.direction_id || null
      };
    }) || [];

    // Filter by direction_id if specified
    const filteredSales = direction_id
      ? salesList.filter(s => s.direction_id === direction_id)
      : salesList;

    // Calculate totals
    const totalAmount = filteredSales.reduce((sum, s) => sum + s.amount, 0);
    const averageCheck = filteredSales.length > 0 ? Math.round(totalAmount / filteredSales.length) : 0;

    return {
      success: true,
      sales: filteredSales,
      total_count: filteredSales.length,
      total_amount: totalAmount,
      total_amount_formatted: `${(totalAmount / 1000).toFixed(0)}K ₸`,
      average_check: averageCheck,
      average_check_formatted: `${(averageCheck / 1000).toFixed(0)}K ₸`,
      period: periodDescription
    };
  },

  async addSale({ client_phone, amount, direction_id, manual_source_id, manual_creative_url }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Normalize phone (remove spaces, dashes)
    const normalizedPhone = client_phone.replace(/[\s-]/g, '');

    // Check if lead exists
    let leadQuery = supabase
      .from('leads')
      .select('id, source_id, creative_url, direction_id, creative_id')
      .eq('user_account_id', userAccountId)
      .eq('chat_id', normalizedPhone);

    if (dbAccountId) {
      leadQuery = leadQuery.eq('account_id', dbAccountId);
    }

    const { data: existingLead, error: leadCheckError } = await leadQuery.maybeSingle();

    if (leadCheckError && leadCheckError.code !== 'PGRST116') {
      return { success: false, error: `Ошибка проверки лида: ${leadCheckError.message}` };
    }

    // If lead not found and no manual_source_id - error
    if (!existingLead && !manual_source_id) {
      return {
        success: false,
        error: `Клиент с номером ${client_phone} не найден в базе лидов. Укажите manual_source_id и manual_creative_url для создания нового лида.`,
        lead_not_found: true
      };
    }

    // If lead not found but manual_source_id provided - create lead
    if (!existingLead && manual_source_id) {
      const leadInsertData = {
        user_account_id: userAccountId,
        account_id: dbAccountId,
        chat_id: normalizedPhone,
        source_id: manual_source_id,
        creative_url: manual_creative_url || '',
        direction_id: direction_id || null,
        created_at: new Date().toISOString()
      };

      const { data: newLead, error: leadError } = await supabase
        .from('leads')
        .insert(leadInsertData)
        .select()
        .single();

      if (leadError) {
        return { success: false, error: `Ошибка создания лида: ${leadError.message}` };
      }
    }

    // Add purchase
    const purchaseInsertData = {
      user_account_id: userAccountId,
      account_id: dbAccountId,
      client_phone: normalizedPhone,
      amount: amount
    };

    const { data: purchase, error: purchaseError } = await supabase
      .from('purchases')
      .insert(purchaseInsertData)
      .select()
      .single();

    if (purchaseError) {
      return { success: false, error: `Ошибка добавления продажи: ${purchaseError.message}` };
    }

    // Update sale_amount in lead
    let updateQuery = supabase
      .from('leads')
      .update({
        sale_amount: supabase.raw('COALESCE(sale_amount, 0) + ?', [amount]),
        updated_at: new Date().toISOString()
      })
      .eq('user_account_id', userAccountId)
      .eq('chat_id', normalizedPhone);

    if (dbAccountId) {
      updateQuery = updateQuery.eq('account_id', dbAccountId);
    }

    await updateQuery;

    return {
      success: true,
      message: `Продажа на сумму ${amount} ₸ успешно добавлена для клиента ${client_phone}`,
      purchase_id: purchase.id,
      amount: amount,
      amount_formatted: `${(amount / 1000).toFixed(0)}K ₸`
    };
  },

  async getFunnelStats({ period, date_from, date_to }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;
    const { since, until, periodDescription } = getDateRangeFromParams({ date_from, date_to, period });

    // Step 1: Get leads with chat_id
    let leadsQuery = supabase
      .from('leads')
      .select('id, chat_id')
      .eq('user_account_id', userAccountId)
      .gte('created_at', since)
      .lte('created_at', until);

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
      period: periodDescription,
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
  async getRevenueStats({ period, direction_id, date_from, date_to }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;
    const { since, until, periodDescription } = getDateRangeFromParams({ date_from, date_to, period });

    // Step 1: Get leads
    let leadsQuery = supabase
      .from('leads')
      .select('id, chat_id, name, direction_id, is_qualified, created_at')
      .eq('user_account_id', userAccountId)
      .gte('created_at', since)
      .lte('created_at', until);

    if (dbAccountId) {
      leadsQuery = leadsQuery.eq('account_id', dbAccountId);
    }
    if (direction_id) {
      leadsQuery = leadsQuery.eq('direction_id', direction_id);
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
        period: periodDescription,
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
      .in('client_phone', leadPhones)
      .gte('created_at', since)
      .lte('created_at', until);

    if (dbAccountId) {
      purchasesQuery = purchasesQuery.eq('account_id', dbAccountId);
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
      period: periodDescription,
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
  async getSalesQuality({ direction_id, period, date_from, date_to }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Используем общий хелпер для дат (date_from/date_to имеют приоритет)
    const { since, until, periodDescription } = getDateRangeFromParams({ date_from, date_to, period });

    // Step 0: Если указан direction_id, загружаем креативы этого направления
    // (как ROI Analytics, чтобы найти лидов через creative_id)
    let creativeIds = [];
    if (direction_id) {
      let creativesQuery = supabase
        .from('user_creatives')
        .select('id')
        .eq('user_id', userAccountId)
        .eq('direction_id', direction_id)
        .eq('status', 'ready');

      if (dbAccountId) {
        creativesQuery = creativesQuery.eq('account_id', dbAccountId);
      }

      const { data: creativesData } = await creativesQuery;
      creativeIds = creativesData?.map(c => c.id) || [];
    }

    // Step 1: Get leads
    let leadsQuery = supabase
      .from('leads')
      .select('id, chat_id, name, direction_id, is_qualified, created_at, creative_id')
      .eq('user_account_id', userAccountId)
      .gte('created_at', since)
      .lte('created_at', until);

    if (dbAccountId) {
      leadsQuery = leadsQuery.eq('account_id', dbAccountId);
    }

    // Фильтруем по creative_id вместо direction_id (как ROI Analytics)
    // Это находит лидов пришедших с креативов данного направления
    if (creativeIds.length > 0) {
      leadsQuery = leadsQuery.in('creative_id', creativeIds);
    } else if (direction_id) {
      // Fallback: если нет креативов, фильтруем по direction_id лида
      leadsQuery = leadsQuery.eq('direction_id', direction_id);
    }

    const { data: leadsData, error: leadsError } = await leadsQuery;

    if (leadsError) {
      return { success: false, error: `Ошибка загрузки лидов: ${leadsError.message}` };
    }

    const leads = leadsData || [];
    const leads_total = leads.length;
    const qualified_count = leads.filter(l => l.is_qualified === true).length;

    // DEBUG: логируем данные для отладки
    console.log('[getSalesQuality] DEBUG:', JSON.stringify({
      input_direction_id: direction_id || 'NOT_PROVIDED',
      input_period: period || 'NOT_PROVIDED (default: last_7d)',
      since,
      until,
      userAccountId,
      creativeIds_count: creativeIds.length,
      creativeIds_sample: creativeIds.slice(0, 3),
      leads_total,
      qualified_count,
      sample_leads: leads.slice(0, 3).map(l => ({
        id: l.id,
        is_qualified: l.is_qualified,
        creative_id: l.creative_id,
        direction_id: l.direction_id,
        created_at: l.created_at
      }))
    }));

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
        period: periodDescription
      };
    }

    let purchasesQuery = supabase
      .from('purchases')
      .select('id, client_phone, amount, created_at')
      .eq('user_account_id', userAccountId)
      .in('client_phone', leadPhones)
      .gte('created_at', since)
      .lte('created_at', until);

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
      period: periodDescription
    };
  },

  // ============================================================
  // AMOCRM HANDLERS
  // ============================================================

  /**
   * getAmoCRMStatus - Check amoCRM connection status
   */
  async getAmoCRMStatus({}, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Check in ad_accounts first (multi-account mode), then user_accounts (legacy)
    let tokenData = null;

    if (dbAccountId) {
      const { data } = await supabase
        .from('ad_accounts')
        .select('amocrm_subdomain, amocrm_access_token, amocrm_token_expires_at')
        .eq('id', dbAccountId)
        .maybeSingle();
      tokenData = data;
    }

    if (!tokenData?.amocrm_access_token) {
      const { data } = await supabase
        .from('user_accounts')
        .select('amocrm_subdomain, amocrm_access_token, amocrm_token_expires_at')
        .eq('id', userAccountId)
        .maybeSingle();
      tokenData = data;
    }

    if (!tokenData?.amocrm_access_token) {
      return {
        success: true,
        connected: false,
        subdomain: null,
        tokenValid: false,
        message: 'amoCRM не подключён. Подключите в настройках профиля.'
      };
    }

    const expiresAt = tokenData.amocrm_token_expires_at ? new Date(tokenData.amocrm_token_expires_at) : null;
    const now = new Date();
    const tokenValid = expiresAt ? expiresAt > now : false;
    const expiresIn = expiresAt ? Math.round((expiresAt - now) / 1000 / 60) : null; // minutes

    return {
      success: true,
      connected: true,
      subdomain: tokenData.amocrm_subdomain,
      tokenValid,
      expiresAt: tokenData.amocrm_token_expires_at,
      expiresInMinutes: expiresIn,
      message: tokenValid
        ? `amoCRM подключён (${tokenData.amocrm_subdomain}.amocrm.ru)`
        : 'Токен amoCRM истёк. Требуется переподключение.'
    };
  },

  /**
   * getAmoCRMPipelines - Get amoCRM pipelines and stages
   */
  async getAmoCRMPipelines({ include_qualified_only }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    let query = supabase
      .from('amocrm_pipeline_stages')
      .select('*')
      .eq('user_account_id', userAccountId)
      .order('pipeline_id')
      .order('sort_order');

    if (dbAccountId) {
      query = query.eq('account_id', dbAccountId);
    }

    if (include_qualified_only) {
      query = query.eq('is_qualified_stage', true);
    }

    const { data, error } = await query;

    if (error) {
      return { success: false, error: `Ошибка загрузки воронок: ${error.message}` };
    }

    if (!data || data.length === 0) {
      return {
        success: true,
        pipelines: [],
        total_stages: 0,
        message: 'Воронки не найдены. Выполните синхронизацию через настройки amoCRM.'
      };
    }

    // Group by pipeline
    const pipelinesMap = new Map();
    for (const stage of data) {
      if (!pipelinesMap.has(stage.pipeline_id)) {
        pipelinesMap.set(stage.pipeline_id, {
          pipeline_id: stage.pipeline_id,
          pipeline_name: stage.pipeline_name,
          stages: []
        });
      }
      pipelinesMap.get(stage.pipeline_id).stages.push({
        status_id: stage.status_id,
        status_name: stage.status_name,
        status_color: stage.status_color,
        is_qualified_stage: stage.is_qualified_stage,
        sort_order: stage.sort_order
      });
    }

    const pipelines = [...pipelinesMap.values()];

    return {
      success: true,
      pipelines,
      total_pipelines: pipelines.length,
      total_stages: data.length,
      qualified_stages: data.filter(s => s.is_qualified_stage).length
    };
  },

  /**
   * syncAmoCRMLeads - Sync lead statuses from amoCRM
   * This is a WRITE operation that may take up to 30 seconds
   */
  async syncAmoCRMLeads({ direction_id, limit }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;
    const syncLimit = limit || 100;

    // Get leads that have amocrm_lead_id
    let leadsQuery = supabase
      .from('leads')
      .select('id, name, phone, chat_id, amocrm_lead_id, current_status_id, is_qualified')
      .eq('user_account_id', userAccountId)
      .not('amocrm_lead_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(syncLimit);

    if (dbAccountId) {
      leadsQuery = leadsQuery.eq('account_id', dbAccountId);
    }
    if (direction_id) {
      leadsQuery = leadsQuery.eq('direction_id', direction_id);
    }

    const { data: leads, error: leadsError } = await leadsQuery;

    if (leadsError) {
      return { success: false, error: `Ошибка загрузки лидов: ${leadsError.message}` };
    }

    if (!leads || leads.length === 0) {
      return {
        success: true,
        total: 0,
        synced: 0,
        message: 'Нет лидов с привязкой к amoCRM для синхронизации'
      };
    }

    // Get qualified stages for checking
    const { data: qualifiedStages } = await supabase
      .from('amocrm_pipeline_stages')
      .select('pipeline_id, status_id')
      .eq('user_account_id', userAccountId)
      .eq('is_qualified_stage', true);

    const qualifiedSet = new Set(
      (qualifiedStages || []).map(s => `${s.pipeline_id}:${s.status_id}`)
    );

    // Note: Full sync requires amoCRM API call which is handled by agent-service
    // Here we just return current state and suggest using the API endpoint
    const qualifiedCount = leads.filter(l => l.is_qualified).length;
    const withStatusCount = leads.filter(l => l.current_status_id).length;

    return {
      success: true,
      total: leads.length,
      with_status: withStatusCount,
      qualified: qualifiedCount,
      qualified_stages_configured: qualifiedStages?.length || 0,
      message: `Найдено ${leads.length} лидов с amoCRM. ${qualifiedCount} квалифицированных.`,
      hint: 'Для полной синхронизации используйте API: POST /api/amocrm/sync-leads',
      summary: {
        total_leads: leads.length,
        with_amocrm_status: withStatusCount,
        qualified: qualifiedCount,
        qualification_rate: leads.length > 0 ? Math.round((qualifiedCount / leads.length) * 100) : 0
      }
    };
  },

  /**
   * getAmoCRMKeyStageStats - Statistics by key stages for a direction
   */
  async getAmoCRMKeyStageStats({ direction_id, period, date_from, date_to }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;
    const { since, until, periodDescription } = getDateRangeFromParams({ date_from, date_to, period });

    // Get direction with key stages
    const { data: direction, error: dirError } = await supabase
      .from('account_directions')
      .select(`
        id, name,
        key_stage_1_pipeline_id, key_stage_1_status_id,
        key_stage_2_pipeline_id, key_stage_2_status_id,
        key_stage_3_pipeline_id, key_stage_3_status_id
      `)
      .eq('id', direction_id)
      .eq('user_account_id', userAccountId)
      .maybeSingle();

    if (dirError || !direction) {
      return { success: false, error: 'Направление не найдено' };
    }

    // Get stage names from amocrm_pipeline_stages
    const stageIds = [
      { pipeline: direction.key_stage_1_pipeline_id, status: direction.key_stage_1_status_id },
      { pipeline: direction.key_stage_2_pipeline_id, status: direction.key_stage_2_status_id },
      { pipeline: direction.key_stage_3_pipeline_id, status: direction.key_stage_3_status_id }
    ].filter(s => s.pipeline && s.status);

    const { data: stageNames } = await supabase
      .from('amocrm_pipeline_stages')
      .select('pipeline_id, status_id, pipeline_name, status_name, status_color')
      .eq('user_account_id', userAccountId);

    const stageNameMap = new Map();
    for (const s of stageNames || []) {
      stageNameMap.set(`${s.pipeline_id}:${s.status_id}`, s);
    }

    // Get leads for this direction
    let leadsQuery = supabase
      .from('leads')
      .select('id, reached_key_stage_1, reached_key_stage_2, reached_key_stage_3, is_qualified, created_at')
      .eq('user_account_id', userAccountId)
      .eq('direction_id', direction_id)
      .gte('created_at', since)
      .lte('created_at', until);

    if (dbAccountId) {
      leadsQuery = leadsQuery.eq('account_id', dbAccountId);
    }

    const { data: leads, error: leadsError } = await leadsQuery;

    if (leadsError) {
      return { success: false, error: `Ошибка загрузки лидов: ${leadsError.message}` };
    }

    const totalLeads = leads?.length || 0;

    // Calculate stats for each key stage
    const keyStages = [];
    const recommendations = [];

    for (let i = 1; i <= 3; i++) {
      const pipelineId = direction[`key_stage_${i}_pipeline_id`];
      const statusId = direction[`key_stage_${i}_status_id`];

      if (!pipelineId || !statusId) continue;

      const stageInfo = stageNameMap.get(`${pipelineId}:${statusId}`);
      const reachedCount = leads?.filter(l => l[`reached_key_stage_${i}`] === true).length || 0;
      const rate = totalLeads > 0 ? Math.round((reachedCount / totalLeads) * 100) : 0;

      keyStages.push({
        index: i,
        pipeline_id: pipelineId,
        status_id: statusId,
        pipeline_name: stageInfo?.pipeline_name || 'Unknown',
        status_name: stageInfo?.status_name || 'Unknown',
        status_color: stageInfo?.status_color,
        reached_count: reachedCount,
        total_leads: totalLeads,
        rate,
        rate_formatted: `${rate}%`
      });

      // Generate recommendations
      if (rate > 40) {
        recommendations.push({
          type: 'high_conversion',
          stage_index: i,
          reason: `Высокая конверсия в "${stageInfo?.status_name}": ${rate}%`,
          action_label: 'Можно масштабировать трафик'
        });
      } else if (rate < 10 && totalLeads > 20) {
        recommendations.push({
          type: 'low_conversion',
          stage_index: i,
          reason: `Низкая конверсия в "${stageInfo?.status_name}": ${rate}%`,
          action_label: 'Проверить качество трафика или воронку'
        });
      }
    }

    if (keyStages.length === 0) {
      return {
        success: true,
        direction: { id: direction.id, name: direction.name },
        key_stages: [],
        total_leads: totalLeads,
        message: 'Ключевые этапы не настроены для этого направления'
      };
    }

    return {
      success: true,
      direction: { id: direction.id, name: direction.name },
      period: periodDescription,
      total_leads: totalLeads,
      key_stages: keyStages,
      recommendations
    };
  },

  /**
   * getAmoCRMQualificationStats - Qualification statistics by creatives
   */
  async getAmoCRMQualificationStats({ direction_id, period, date_from, date_to }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;
    const { since, until, periodDescription } = getDateRangeFromParams({ date_from, date_to, period });

    // Get leads with creative_id
    let leadsQuery = supabase
      .from('leads')
      .select('id, creative_id, is_qualified, amocrm_lead_id')
      .eq('user_account_id', userAccountId)
      .not('amocrm_lead_id', 'is', null)
      .gte('created_at', since)
      .lte('created_at', until);

    if (dbAccountId) {
      leadsQuery = leadsQuery.eq('account_id', dbAccountId);
    }
    if (direction_id) {
      leadsQuery = leadsQuery.eq('direction_id', direction_id);
    }

    const { data: leads, error: leadsError } = await leadsQuery;

    if (leadsError) {
      return { success: false, error: `Ошибка загрузки лидов: ${leadsError.message}` };
    }

    if (!leads || leads.length === 0) {
      return {
        success: true,
        creatives: [],
        total_leads: 0,
        total_qualified: 0,
        overall_rate: 0,
        message: 'Нет лидов с amoCRM за указанный период'
      };
    }

    // Get creative names
    const creativeIds = [...new Set(leads.map(l => l.creative_id).filter(Boolean))];
    const { data: creatives } = await supabase
      .from('user_creatives')
      .select('id, name')
      .in('id', creativeIds);

    const creativeNameMap = new Map();
    for (const c of creatives || []) {
      creativeNameMap.set(c.id, c.name);
    }

    // Group by creative
    const statsMap = new Map();
    for (const lead of leads) {
      const cid = lead.creative_id || 'unknown';
      if (!statsMap.has(cid)) {
        statsMap.set(cid, { total: 0, qualified: 0 });
      }
      statsMap.get(cid).total++;
      if (lead.is_qualified) {
        statsMap.get(cid).qualified++;
      }
    }

    // Build result with recommendations
    const creativeStats = [];
    const recommendations = [];

    for (const [cid, stats] of statsMap) {
      const rate = stats.total > 0 ? Math.round((stats.qualified / stats.total) * 100) : 0;
      const creativeName = creativeNameMap.get(cid) || (cid === 'unknown' ? 'Без креатива' : cid);

      creativeStats.push({
        creative_id: cid,
        creative_name: creativeName,
        total_leads: stats.total,
        qualified_leads: stats.qualified,
        qualification_rate: rate,
        qualification_rate_formatted: `${rate}%`
      });

      // Generate recommendations
      if (rate < 15 && stats.total > 10) {
        recommendations.push({
          type: 'review_creative',
          entity_id: cid,
          creative_name: creativeName,
          reason: `Квалификация ${rate}% при ${stats.total} лидах`,
          action_label: 'Проверить таргетинг или креатив'
        });
      } else if (rate > 50 && stats.total >= 5) {
        recommendations.push({
          type: 'scale_creative',
          entity_id: cid,
          creative_name: creativeName,
          reason: `Высокая квалификация ${rate}%`,
          action_label: 'Масштабировать'
        });
      }
    }

    // Sort by total leads desc
    creativeStats.sort((a, b) => b.total_leads - a.total_leads);

    const totalLeads = leads.length;
    const totalQualified = leads.filter(l => l.is_qualified).length;
    const overallRate = totalLeads > 0 ? Math.round((totalQualified / totalLeads) * 100) : 0;

    return {
      success: true,
      period: periodDescription,
      creatives: creativeStats,
      total_leads: totalLeads,
      total_qualified: totalQualified,
      overall_rate: overallRate,
      overall_rate_formatted: `${overallRate}%`,
      recommendations
    };
  },

  /**
   * getAmoCRMLeadHistory - Get lead status change history in amoCRM
   */
  async getAmoCRMLeadHistory({ lead_id }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Get lead first
    let leadQuery = supabase
      .from('leads')
      .select('id, name, phone, amocrm_lead_id, current_status_id, current_pipeline_id, is_qualified')
      .eq('id', lead_id)
      .eq('user_account_id', userAccountId);

    if (dbAccountId) {
      leadQuery = leadQuery.eq('account_id', dbAccountId);
    }

    const { data: lead, error: leadError } = await leadQuery.maybeSingle();

    if (leadError || !lead) {
      return { success: false, error: 'Лид не найден' };
    }

    if (!lead.amocrm_lead_id) {
      return {
        success: true,
        lead: { id: lead.id, name: lead.name, phone: lead.phone },
        history: [],
        message: 'Лид не связан с amoCRM'
      };
    }

    // Get history
    const { data: history, error: histError } = await supabase
      .from('amocrm_lead_status_history')
      .select('*')
      .eq('lead_id', lead.id)
      .order('changed_at', { ascending: false });

    if (histError) {
      return { success: false, error: `Ошибка загрузки истории: ${histError.message}` };
    }

    // Get stage names
    const { data: stages } = await supabase
      .from('amocrm_pipeline_stages')
      .select('pipeline_id, status_id, pipeline_name, status_name')
      .eq('user_account_id', userAccountId);

    const stageMap = new Map();
    for (const s of stages || []) {
      stageMap.set(`${s.pipeline_id}:${s.status_id}`, s);
    }

    // Format history
    const formattedHistory = (history || []).map(h => {
      const fromStage = stageMap.get(`${h.from_pipeline_id}:${h.from_status_id}`);
      const toStage = stageMap.get(`${h.to_pipeline_id}:${h.to_status_id}`);

      return {
        id: h.id,
        changed_at: h.changed_at,
        from: {
          pipeline_id: h.from_pipeline_id,
          status_id: h.from_status_id,
          pipeline_name: fromStage?.pipeline_name || null,
          status_name: fromStage?.status_name || null
        },
        to: {
          pipeline_id: h.to_pipeline_id,
          status_id: h.to_status_id,
          pipeline_name: toStage?.pipeline_name || null,
          status_name: toStage?.status_name || null
        }
      };
    });

    // Current status
    const currentStage = stageMap.get(`${lead.current_pipeline_id}:${lead.current_status_id}`);

    return {
      success: true,
      lead: {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        amocrm_lead_id: lead.amocrm_lead_id,
        is_qualified: lead.is_qualified,
        current_status: currentStage ? {
          pipeline_name: currentStage.pipeline_name,
          status_name: currentStage.status_name
        } : null
      },
      history: formattedHistory,
      total_changes: formattedHistory.length
    };
  }
};
