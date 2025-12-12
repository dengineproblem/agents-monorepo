/**
 * AdsAgent Handlers - Facebook/Instagram Advertising
 * Tool execution handlers for advertising operations
 */

import { fbGraph } from '../../shared/fbGraph.js';
import { getDateRange } from '../../shared/dateUtils.js';
import { supabase } from '../../../lib/supabaseClient.js';

export const adsHandlers = {
  // ============================================================
  // READ HANDLERS
  // ============================================================

  async getCampaigns({ period, status }, { accessToken, adAccountId }) {
    const dateRange = getDateRange(period);

    const fields = 'id,name,status,objective,daily_budget,lifetime_budget,insights.date_preset(today){spend,impressions,clicks,actions}';

    let path = `act_${adAccountId}/campaigns`;
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
      const leads = insights.actions?.find(a => a.action_type === 'lead')?.value || 0;
      const spend = parseFloat(insights.spend || 0);

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective,
        daily_budget: c.daily_budget ? parseInt(c.daily_budget) / 100 : null,
        spend: spend,
        leads: parseInt(leads),
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
    const fields = 'id,name,status,daily_budget,targeting,insights.date_preset(today){spend,impressions,clicks,actions}';

    const result = await fbGraph('GET', `${campaign_id}/adsets`, accessToken, {
      fields,
      time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until })
    });

    const adsets = (result.data || []).map(a => {
      const insights = a.insights?.data?.[0] || {};
      const leads = insights.actions?.find(act => act.action_type === 'lead')?.value || 0;
      const spend = parseFloat(insights.spend || 0);

      return {
        id: a.id,
        name: a.name,
        status: a.status,
        daily_budget: a.daily_budget ? parseInt(a.daily_budget) / 100 : null,
        spend,
        leads: parseInt(leads),
        cpl: leads > 0 ? (spend / leads).toFixed(2) : null
      };
    });

    return { success: true, adsets };
  },

  async getSpendReport({ period, group_by }, { accessToken, adAccountId }) {
    const dateRange = getDateRange(period);

    const result = await fbGraph('GET', `act_${adAccountId}/insights`, accessToken, {
      fields: 'spend,impressions,clicks,actions',
      time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until }),
      time_increment: group_by === 'day' ? 1 : undefined,
      level: group_by === 'campaign' ? 'campaign' : 'account'
    });

    const data = (result.data || []).map(row => {
      const leads = row.actions?.find(a => a.action_type === 'lead')?.value || 0;
      return {
        date: row.date_start,
        spend: parseFloat(row.spend || 0),
        leads: parseInt(leads),
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
  // WRITE HANDLERS
  // ============================================================

  async pauseCampaign({ campaign_id, reason }, { accessToken, userAccountId, adAccountId }) {
    await fbGraph('POST', campaign_id, accessToken, { status: 'PAUSED' });

    // Log action
    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Campaign ${campaign_id} paused via Chat Assistant`,
      context: { reason, source: 'chat_assistant', agent: 'AdsAgent' }
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
      context: { reason, source: 'chat_assistant', agent: 'AdsAgent' }
    });

    return { success: true, message: `Адсет ${adset_id} поставлен на паузу` };
  },

  async resumeAdSet({ adset_id }, { accessToken }) {
    await fbGraph('POST', adset_id, accessToken, { status: 'ACTIVE' });
    return { success: true, message: `Адсет ${adset_id} возобновлён` };
  },

  async updateBudget({ adset_id, new_budget_cents }, { accessToken, adAccountId }) {
    // Validate minimum budget
    if (new_budget_cents < 500) {
      return { success: false, error: 'Минимальный бюджет $5 (500 центов)' };
    }

    // TODO: Add 50% change validation
    // Get current budget and compare with new_budget_cents
    // If change > 50%, return warning for confirmation

    await fbGraph('POST', adset_id, accessToken, {
      daily_budget: new_budget_cents
    });

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Budget updated for AdSet ${adset_id}: $${(new_budget_cents / 100).toFixed(2)}`,
      context: { new_budget_cents, source: 'chat_assistant', agent: 'AdsAgent' }
    });

    return {
      success: true,
      message: `Бюджет адсета ${adset_id} изменён на $${(new_budget_cents / 100).toFixed(2)}/день`
    };
  }
};
