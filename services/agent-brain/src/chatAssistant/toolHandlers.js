/**
 * Tool Handlers for Chat Assistant
 * Executes tools called by LLM and returns results
 */

import { supabase, supabaseQuery } from '../lib/supabaseClient.js';
import { logger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import { shouldFilterByAccountId } from '../lib/multiAccountHelper.js';

const FB_API_VERSION = process.env.FB_API_VERSION || 'v20.0';
const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || 'http://localhost:8082';

/**
 * Execute a Facebook Graph API call
 */
async function fbGraph(method, path, accessToken, params = {}) {
  const usp = new URLSearchParams();
  usp.set('access_token', accessToken);

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      const value = typeof v === 'object' ? JSON.stringify(v) : String(v);
      usp.set(k, value);
    }
  }

  const url = method === 'GET'
    ? `https://graph.facebook.com/${FB_API_VERSION}/${path}?${usp.toString()}`
    : `https://graph.facebook.com/${FB_API_VERSION}/${path}`;

  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : usp.toString(),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.error?.message || `Facebook API error: ${res.status}`);
  }

  return json;
}

/**
 * Get date range for period
 */
function getDateRange(period) {
  const now = new Date();
  let since, until;

  switch (period) {
    case 'today':
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      until = now;
      break;
    case 'yesterday':
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      until = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'last_7d':
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      until = now;
      break;
    case 'last_30d':
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      until = now;
      break;
    default:
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      until = now;
  }

  return {
    since: since.toISOString().split('T')[0],
    until: until.toISOString().split('T')[0]
  };
}

// ============================================================
// TOOL HANDLERS MAP
// ============================================================

const toolHandlers = {
  // ============================================================
  // FACEBOOK ADS - READ
  // ============================================================

  async getCampaigns({ period, status }, { accessToken, adAccountId }) {
    const dateRange = getDateRange(period);

    // Use dynamic time_range instead of hardcoded date_preset(today)
    const timeRangeStr = `{"since":"${dateRange.since}","until":"${dateRange.until}"}`;
    const fields = `id,name,status,objective,daily_budget,lifetime_budget,insights.time_range(${timeRangeStr}){spend,impressions,clicks,actions}`;

    // Normalize: don't add act_ prefix if already present
    const actId = adAccountId?.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    let path = `${actId}/campaigns`;
    const params = {
      fields,
      filtering: status && status !== 'all'
        ? JSON.stringify([{ field: 'effective_status', operator: 'IN', value: [status] }])
        : undefined,
      time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until })
    };

    const result = await fbGraph('GET', path, accessToken, params);

    // Parse insights and format response
    const campaigns = (result.data || []).map(c => {
      const insights = c.insights?.data?.[0] || {};
      const spend = parseFloat(insights.spend || 0);

      // Count leads from ALL sources (same logic as facebookApi.ts)
      let messagingLeads = 0;
      let siteLeads = 0;
      let leadFormLeads = 0;
      if (insights.actions && Array.isArray(insights.actions)) {
        for (const action of insights.actions) {
          if (action.action_type === 'onsite_conversion.total_messaging_connection') {
            messagingLeads = parseInt(action.value || '0', 10);
          } else if (action.action_type === 'offsite_conversion.fb_pixel_lead') {
            siteLeads = parseInt(action.value || '0', 10);
          } else if (!siteLeads && typeof action.action_type === 'string' && action.action_type.startsWith('offsite_conversion.custom')) {
            siteLeads = parseInt(action.value || '0', 10);
          } else if (action.action_type === 'onsite_conversion.lead_grouped') {
            leadFormLeads = parseInt(action.value || '0', 10);
          }
        }
      }
      const leads = messagingLeads + siteLeads + leadFormLeads;

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective,
        daily_budget: c.daily_budget ? parseInt(c.daily_budget) / 100 : null,
        spend: spend,
        leads: leads,
        cpl: leads > 0 ? (spend / leads).toFixed(2) : null,
        impressions: parseInt(insights.impressions || 0),
        clicks: parseInt(insights.clicks || 0)
      };
    });

    return {
      success: true,
      period,
      campaigns,
      total: campaigns.length
    };
  },

  async getCampaignDetails({ campaign_id }, { accessToken }) {
    const fields = 'id,name,status,objective,daily_budget,created_time,adsets{id,name,status,daily_budget,targeting},ads{id,name,status,creative{id,thumbnail_url}}';

    const result = await fbGraph('GET', campaign_id, accessToken, { fields });

    return {
      success: true,
      campaign: {
        id: result.id,
        name: result.name,
        status: result.status,
        objective: result.objective,
        daily_budget: result.daily_budget ? parseInt(result.daily_budget) / 100 : null,
        created_time: result.created_time,
        adsets: result.adsets?.data || [],
        ads: result.ads?.data || []
      }
    };
  },

  async getAdSets({ campaign_id, period }, { accessToken }) {
    const dateRange = getDateRange(period || 'last_7d');
    // Use dynamic time_range instead of hardcoded date_preset(today)
    const timeRangeStr = `{"since":"${dateRange.since}","until":"${dateRange.until}"}`;
    const fields = `id,name,status,daily_budget,targeting,insights.time_range(${timeRangeStr}){spend,impressions,clicks,actions}`;

    const result = await fbGraph('GET', `${campaign_id}/adsets`, accessToken, {
      fields,
      time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until })
    });

    const adsets = (result.data || []).map(a => {
      const insights = a.insights?.data?.[0] || {};
      const spend = parseFloat(insights.spend || 0);

      // Count leads from ALL sources (same logic as facebookApi.ts)
      let messagingLeads = 0;
      let siteLeads = 0;
      let leadFormLeads = 0;
      if (insights.actions && Array.isArray(insights.actions)) {
        for (const action of insights.actions) {
          if (action.action_type === 'onsite_conversion.total_messaging_connection') {
            messagingLeads = parseInt(action.value || '0', 10);
          } else if (action.action_type === 'offsite_conversion.fb_pixel_lead') {
            siteLeads = parseInt(action.value || '0', 10);
          } else if (!siteLeads && typeof action.action_type === 'string' && action.action_type.startsWith('offsite_conversion.custom')) {
            siteLeads = parseInt(action.value || '0', 10);
          } else if (action.action_type === 'onsite_conversion.lead_grouped') {
            leadFormLeads = parseInt(action.value || '0', 10);
          }
        }
      }
      const leads = messagingLeads + siteLeads + leadFormLeads;

      return {
        id: a.id,
        name: a.name,
        status: a.status,
        daily_budget: a.daily_budget ? parseInt(a.daily_budget) / 100 : null,
        spend,
        leads: leads,
        cpl: leads > 0 ? (spend / leads).toFixed(2) : null
      };
    });

    return { success: true, adsets };
  },

  async getSpendReport({ period, group_by }, { accessToken, adAccountId }) {
    const dateRange = getDateRange(period);

    let breakdown = '';
    if (group_by === 'day') {
      breakdown = 'day';
    }

    // Normalize: don't add act_ prefix if already present
    const actId = adAccountId?.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const result = await fbGraph('GET', `${actId}/insights`, accessToken, {
      fields: 'spend,impressions,clicks,actions',
      time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until }),
      time_increment: group_by === 'day' ? 1 : undefined,
      level: group_by === 'campaign' ? 'campaign' : 'account'
    });

    const data = (result.data || []).map(row => {
      // Count leads from ALL sources (same logic as facebookApi.ts)
      let messagingLeads = 0;
      let siteLeads = 0;
      let leadFormLeads = 0;
      if (row.actions && Array.isArray(row.actions)) {
        for (const action of row.actions) {
          if (action.action_type === 'onsite_conversion.total_messaging_connection') {
            messagingLeads = parseInt(action.value || '0', 10);
          } else if (action.action_type === 'offsite_conversion.fb_pixel_lead') {
            siteLeads = parseInt(action.value || '0', 10);
          } else if (!siteLeads && typeof action.action_type === 'string' && action.action_type.startsWith('offsite_conversion.custom')) {
            siteLeads = parseInt(action.value || '0', 10);
          } else if (action.action_type === 'onsite_conversion.lead_grouped') {
            leadFormLeads = parseInt(action.value || '0', 10);
          }
        }
      }
      const leads = messagingLeads + siteLeads + leadFormLeads;

      return {
        date: row.date_start,
        spend: parseFloat(row.spend || 0),
        leads: leads,
        impressions: parseInt(row.impressions || 0),
        clicks: parseInt(row.clicks || 0)
      };
    });

    const totalSpend = data.reduce((sum, d) => sum + d.spend, 0);
    const totalLeads = data.reduce((sum, d) => sum + d.leads, 0);

    return {
      success: true,
      period,
      group_by: group_by || 'total',
      data,
      totals: {
        spend: totalSpend.toFixed(2),
        leads: totalLeads,
        cpl: totalLeads > 0 ? (totalSpend / totalLeads).toFixed(2) : null
      }
    };
  },

  // ============================================================
  // FACEBOOK ADS - WRITE
  // ============================================================

  async pauseCampaign({ campaign_id, reason }, { accessToken, userAccountId, adAccountId }) {
    await fbGraph('POST', campaign_id, accessToken, { status: 'PAUSED' });

    // Log action
    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Campaign ${campaign_id} paused via Chat Assistant`,
      context: { reason, source: 'chat_assistant' }
    });

    return { success: true, message: `Кампания ${campaign_id} поставлена на паузу` };
  },

  async resumeCampaign({ campaign_id }, { accessToken }) {
    await fbGraph('POST', campaign_id, accessToken, { status: 'ACTIVE' });
    return { success: true, message: `Кампания ${campaign_id} возобновлена` };
  },

  async pauseAdSet({ adset_id, reason }, { accessToken, adAccountId }) {
    await fbGraph('POST', adset_id, accessToken, { status: 'PAUSED' });

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `AdSet ${adset_id} paused via Chat Assistant`,
      context: { reason, source: 'chat_assistant' }
    });

    return { success: true, message: `Адсет ${adset_id} поставлен на паузу` };
  },

  async resumeAdSet({ adset_id }, { accessToken }) {
    await fbGraph('POST', adset_id, accessToken, { status: 'ACTIVE' });
    return { success: true, message: `Адсет ${adset_id} возобновлён` };
  },

  async updateBudget({ adset_id, new_budget_cents }, { accessToken, adAccountId }) {
    // Validate budget
    if (new_budget_cents < 500) {
      return { success: false, error: 'Минимальный бюджет $5 (500 центов)' };
    }

    await fbGraph('POST', adset_id, accessToken, {
      daily_budget: new_budget_cents
    });

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Budget updated for AdSet ${adset_id}: $${(new_budget_cents / 100).toFixed(2)}`,
      context: { new_budget_cents, source: 'chat_assistant' }
    });

    return {
      success: true,
      message: `Бюджет адсета ${adset_id} изменён на $${(new_budget_cents / 100).toFixed(2)}/день`
    };
  },

  // ============================================================
  // CRM / LEADS
  // ============================================================

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

    // Фильтр по account_id ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
    if (await shouldFilterByAccountId(userAccountId, adAccountId)) {
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

    // Фильтр по account_id ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
    if (await shouldFilterByAccountId(userAccountId, adAccountId)) {
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
  },

  // ============================================================
  // WHATSAPP DIALOGS
  // ============================================================

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

    // Фильтр по account_id ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
    if (await shouldFilterByAccountId(userAccountId, adAccountId)) {
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
      return { success: false, error: 'Анализ диалога не найден. Возможно, диалог ещё не проанализирован.' };
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
  },

  // ============================================================
  // CREATIVES
  // ============================================================

  async getCreatives({ status, sort_by, limit }, { userAccountId, adAccountId }) {
    let query = supabase
      .from('generated_creatives')
      .select(`
        id, title, style, media_type, image_url, video_url,
        status, created_at,
        direction:direction_id(name)
      `)
      .eq('user_account_id', userAccountId)
      .limit(limit || 20);

    // Фильтр по account_id ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
    if (await shouldFilterByAccountId(userAccountId, adAccountId)) {
      query = query.eq('account_id', adAccountId);
    }

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (sort_by === 'date') {
      query = query.order('created_at', { ascending: false });
    } else {
      query = query.order('created_at', { ascending: false }); // Default
    }

    const { data, error } = await query;
    if (error) throw error;

    return {
      success: true,
      creatives: (data || []).map(c => ({
        id: c.id,
        title: c.title,
        style: c.style,
        media_type: c.media_type,
        direction: c.direction?.name,
        thumbnail: c.image_url || c.video_url,
        status: c.status,
        created_at: c.created_at
      })),
      total: data?.length || 0
    };
  },

  async generateCreative({ direction_id, creative_type, style }, { userAccountId, adAccountId }) {
    // Call creative generation service
    const response = await fetch(`${AGENT_SERVICE_URL}/api/creatives/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAccountId,
        accountId: adAccountId,
        directionId: direction_id,
        mediaType: creative_type,
        style: style || 'modern_performance'
      })
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Ошибка генерации креатива' };
    }

    const result = await response.json();

    return {
      success: true,
      message: 'Генерация креатива запущена',
      creative_id: result.creativeId,
      estimated_time: '2-5 минут'
    };
  }
};

/**
 * Execute a tool by name
 * @param {string} toolName - Name of the tool to execute
 * @param {Object} params - Tool parameters
 * @param {Object} context - Execution context (accessToken, userAccountId, etc.)
 * @returns {Promise<Object>} Tool result
 */
export async function executeTool(toolName, params, context) {
  const handler = toolHandlers[toolName];

  if (!handler) {
    return { success: false, error: `Unknown tool: ${toolName}` };
  }

  try {
    logger.info({ tool: toolName, params }, 'Executing chat tool');
    const result = await handler(params, context);
    logger.info({ tool: toolName, success: true }, 'Tool executed successfully');
    return result;
  } catch (error) {
    logger.error({ tool: toolName, error: error.message }, 'Tool execution failed');

    logErrorToAdmin({
      user_account_id: context?.userAccountId,
      error_type: 'api',
      raw_error: error.message || String(error),
      stack_trace: error.stack,
      action: `chat_tool_${toolName}`,
      severity: 'warning'
    }).catch(() => {});

    return {
      success: false,
      error: error.message || 'Ошибка выполнения инструмента'
    };
  }
}

export default { executeTool, toolHandlers };
