/**
 * AdsAgent Handlers - Facebook/Instagram Advertising
 * Tool execution handlers for advertising operations
 */

import { fbGraph } from '../../shared/fbGraph.js';
import { getDateRange } from '../../shared/dateUtils.js';
import { supabase } from '../../../lib/supabaseClient.js';
import { adsDryRunHandlers } from '../../shared/dryRunHandlers.js';

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

  async pauseCampaign({ campaign_id, reason, dry_run }, { accessToken, userAccountId, adAccountId }) {
    // Dry-run mode: return preview without executing
    if (dry_run) {
      return adsDryRunHandlers.pauseCampaign({ campaign_id }, { accessToken });
    }

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

  async pauseAdSet({ adset_id, reason, dry_run }, { accessToken, adAccountId }) {
    // Dry-run mode: return preview without executing
    if (dry_run) {
      return adsDryRunHandlers.pauseAdSet({ adset_id }, { accessToken });
    }

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

  async updateBudget({ adset_id, new_budget_cents, dry_run }, { accessToken, adAccountId }) {
    // Validate minimum budget
    if (new_budget_cents < 500) {
      return { success: false, error: 'Минимальный бюджет $5 (500 центов)' };
    }

    // Dry-run mode: return preview with change % and warnings
    if (dry_run) {
      return adsDryRunHandlers.updateBudget({ adset_id, new_budget_cents }, { accessToken });
    }

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
  },

  // ============================================================
  // DIRECTIONS HANDLERS
  // ============================================================

  async getDirections({ status, period }, { userAccountId, adAccountId }) {
    // Get directions for this ad account
    let query = supabase
      .from('directions')
      .select(`
        id,
        name,
        status,
        budget_per_day,
        target_cpl,
        created_at,
        updated_at,
        campaign_id
      `)
      .eq('ad_account_id', adAccountId);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data: directions, error } = await query.order('created_at', { ascending: false });

    if (error) {
      return { success: false, error: error.message };
    }

    // Get aggregated metrics for directions
    const periodDays = {
      'today': 1,
      'yesterday': 1,
      'last_7d': 7,
      'last_30d': 30
    };
    const days = periodDays[period] || 7;

    const { data: metrics, error: metricsError } = await supabase
      .rpc('get_direction_aggregated_metrics', {
        p_ad_account_id: adAccountId,
        p_days: days
      });

    // Merge metrics with directions
    const metricsMap = new Map((metrics || []).map(m => [m.direction_id, m]));

    const enrichedDirections = directions.map(d => {
      const m = metricsMap.get(d.id) || {};
      return {
        id: d.id,
        name: d.name,
        status: d.status,
        budget_per_day: d.budget_per_day,
        target_cpl: d.target_cpl,
        campaign_id: d.campaign_id,
        metrics: {
          spend: parseFloat(m.total_spend || 0),
          leads: parseInt(m.total_leads || 0),
          cpl: m.total_leads > 0 ? (m.total_spend / m.total_leads).toFixed(2) : null,
          impressions: parseInt(m.total_impressions || 0),
          active_creatives: parseInt(m.active_creatives || 0)
        }
      };
    });

    return {
      success: true,
      period: period || 'last_7d',
      directions: enrichedDirections,
      total: enrichedDirections.length
    };
  },

  async getDirectionDetails({ direction_id }, { userAccountId, adAccountId, accessToken }) {
    // Get direction info
    const { data: direction, error } = await supabase
      .from('directions')
      .select(`
        id,
        name,
        status,
        budget_per_day,
        target_cpl,
        campaign_id,
        adset_id,
        created_at,
        updated_at
      `)
      .eq('id', direction_id)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    // Get creatives linked to this direction
    const { data: creatives } = await supabase
      .from('user_creatives')
      .select(`
        id,
        name,
        status,
        media_type,
        created_at
      `)
      .eq('direction_id', direction_id)
      .limit(20);

    // Get adset info from Facebook if available
    let adsetInfo = null;
    if (direction.adset_id && accessToken) {
      try {
        adsetInfo = await fbGraph('GET', direction.adset_id, accessToken, {
          fields: 'id,name,status,daily_budget,targeting'
        });
      } catch (e) {
        // Ignore FB errors
      }
    }

    return {
      success: true,
      direction: {
        ...direction,
        creatives: creatives || [],
        adset: adsetInfo
      }
    };
  },

  async getDirectionMetrics({ direction_id, period }, { adAccountId }) {
    const days = { '7d': 7, '14d': 14, '30d': 30 }[period] || 7;

    // Get daily metrics breakdown
    const { data: dailyMetrics, error } = await supabase
      .from('direction_metrics_daily')
      .select('*')
      .eq('direction_id', direction_id)
      .gte('date', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
      .order('date', { ascending: true });

    if (error) {
      return { success: false, error: error.message };
    }

    // Calculate totals
    const totals = (dailyMetrics || []).reduce((acc, d) => ({
      spend: acc.spend + parseFloat(d.spend || 0),
      leads: acc.leads + parseInt(d.leads || 0),
      impressions: acc.impressions + parseInt(d.impressions || 0),
      clicks: acc.clicks + parseInt(d.clicks || 0)
    }), { spend: 0, leads: 0, impressions: 0, clicks: 0 });

    return {
      success: true,
      direction_id,
      period,
      daily: dailyMetrics || [],
      totals: {
        ...totals,
        cpl: totals.leads > 0 ? (totals.spend / totals.leads).toFixed(2) : null,
        ctr: totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : null
      }
    };
  },

  async updateDirectionBudget({ direction_id, new_budget, dry_run }, { adAccountId }) {
    // Dry-run mode: return preview with change % and warnings
    if (dry_run) {
      return adsDryRunHandlers.updateDirectionBudget({ direction_id, new_budget }, { adAccountId });
    }

    // Update direction budget
    const { data, error } = await supabase
      .from('directions')
      .update({ budget_per_day: new_budget, updated_at: new Date().toISOString() })
      .eq('id', direction_id)
      .select('id, name, budget_per_day')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Direction budget updated: ${data.name} → $${new_budget}/day`,
      context: { direction_id, new_budget, source: 'chat_assistant', agent: 'AdsAgent' }
    });

    return {
      success: true,
      message: `Бюджет направления "${data.name}" изменён на $${new_budget}/день`
    };
  },

  async updateDirectionTargetCPL({ direction_id, target_cpl }, { adAccountId }) {
    const { data, error } = await supabase
      .from('directions')
      .update({ target_cpl, updated_at: new Date().toISOString() })
      .eq('id', direction_id)
      .select('id, name, target_cpl')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Direction target CPL updated: ${data.name} → $${target_cpl}`,
      context: { direction_id, target_cpl, source: 'chat_assistant', agent: 'AdsAgent' }
    });

    return {
      success: true,
      message: `Целевой CPL направления "${data.name}" изменён на $${target_cpl}`
    };
  },

  async pauseDirection({ direction_id, reason, dry_run }, { adAccountId, accessToken }) {
    // Dry-run mode: return preview with affected entities
    if (dry_run) {
      return adsDryRunHandlers.pauseDirection({ direction_id }, { adAccountId });
    }

    // Get direction with adset_id
    const { data: direction, error: fetchError } = await supabase
      .from('directions')
      .select('id, name, adset_id')
      .eq('id', direction_id)
      .single();

    if (fetchError) {
      return { success: false, error: fetchError.message };
    }

    // Update direction status
    const { error: updateError } = await supabase
      .from('directions')
      .update({ status: 'paused', updated_at: new Date().toISOString() })
      .eq('id', direction_id);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Pause FB adset if linked
    let fbPaused = false;
    if (direction.adset_id && accessToken) {
      try {
        await fbGraph('POST', direction.adset_id, accessToken, { status: 'PAUSED' });
        fbPaused = true;
      } catch (e) {
        // Log but don't fail
      }
    }

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Direction paused: ${direction.name}`,
      context: { direction_id, reason, fb_paused: fbPaused, source: 'chat_assistant', agent: 'AdsAgent' }
    });

    return {
      success: true,
      message: `Направление "${direction.name}" поставлено на паузу${fbPaused ? ' (включая FB адсет)' : ''}`
    };
  }
};
