/**
 * AdsAgent Handlers - Facebook/Instagram Advertising
 * Tool execution handlers for advertising operations
 */

import { fbGraph } from '../../shared/fbGraph.js';
import { getDateRange } from '../../shared/dateUtils.js';
import { supabase } from '../../../lib/supabaseClient.js';
import { adsDryRunHandlers } from '../../shared/dryRunHandlers.js';
import {
  verifyCampaignStatus,
  verifyAdSetStatus,
  verifyAdSetBudget,
  verifyDirectionStatus
} from '../../shared/postCheck.js';

export const adsHandlers = {
  // ============================================================
  // READ HANDLERS
  // ============================================================

  async getCampaigns({ period, status }, { accessToken, adAccountId }) {
    const dateRange = getDateRange(period);

    const fields = 'id,name,status,objective,daily_budget,lifetime_budget,insights.date_preset(today){spend,impressions,clicks,actions}';

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

      // Count leads from ALL sources like dashboard:
      // - messaging leads (WhatsApp/Instagram conversations)
      // - site leads (pixel events)
      let messagingLeads = 0;
      let siteLeads = 0;

      if (insights.actions && Array.isArray(insights.actions)) {
        for (const action of insights.actions) {
          if (action.action_type === 'onsite_conversion.total_messaging_connection') {
            messagingLeads = parseInt(action.value || '0', 10);
          } else if (action.action_type === 'offsite_conversion.fb_pixel_lead') {
            siteLeads = parseInt(action.value || '0', 10);
          } else if (typeof action.action_type === 'string' && action.action_type.startsWith('offsite_conversion.custom')) {
            siteLeads += parseInt(action.value || '0', 10);
          }
        }
      }

      const leads = messagingLeads + siteLeads;

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
    const fields = 'id,name,status,daily_budget,targeting,insights.date_preset(today){spend,impressions,clicks,actions}';

    const result = await fbGraph('GET', `${campaign_id}/adsets`, accessToken, {
      fields,
      time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until })
    });

    const adsets = (result.data || []).map(a => {
      const insights = a.insights?.data?.[0] || {};
      const spend = parseFloat(insights.spend || 0);

      // Count leads from ALL sources like dashboard:
      let messagingLeads = 0;
      let siteLeads = 0;

      if (insights.actions && Array.isArray(insights.actions)) {
        for (const action of insights.actions) {
          if (action.action_type === 'onsite_conversion.total_messaging_connection') {
            messagingLeads = parseInt(action.value || '0', 10);
          } else if (action.action_type === 'offsite_conversion.fb_pixel_lead') {
            siteLeads = parseInt(action.value || '0', 10);
          } else if (typeof action.action_type === 'string' && action.action_type.startsWith('offsite_conversion.custom')) {
            siteLeads += parseInt(action.value || '0', 10);
          }
        }
      }

      const leads = messagingLeads + siteLeads;

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

    // Log for debugging
    console.log('[getSpendReport] period:', period, '-> dateRange:', dateRange);

    // Normalize: don't add act_ prefix if already present
    const actId = adAccountId?.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const result = await fbGraph('GET', `${actId}/insights`, accessToken, {
      fields: 'spend,impressions,clicks,actions',
      time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until }),
      time_increment: group_by === 'day' ? 1 : undefined,
      level: group_by === 'campaign' ? 'campaign' : 'account',
      // Request action breakdown to get all lead types
      action_breakdowns: 'action_type'
    });

    // Debug: log raw actions from FB API
    console.log('[getSpendReport] FB API result.data:', JSON.stringify(result.data, null, 2));

    const data = (result.data || []).map(row => {
      // Count leads from ALL sources like dashboard does:
      // - messaging leads (WhatsApp conversations)
      // - site leads (pixel events)
      // - custom conversions
      let messagingLeads = 0;
      let siteLeads = 0;

      // Debug: log all action types for this row
      if (row.actions) {
        console.log('[getSpendReport] Actions for row:', row.actions.map(a => `${a.action_type}: ${a.value}`).join(', '));
      }

      if (row.actions && Array.isArray(row.actions)) {
        for (const action of row.actions) {
          // Messaging leads (WhatsApp/Instagram conversations started)
          if (action.action_type === 'onsite_conversion.total_messaging_connection') {
            messagingLeads = parseInt(action.value || '0', 10);
          }
          // Site leads from FB pixel
          else if (action.action_type === 'offsite_conversion.fb_pixel_lead') {
            siteLeads = parseInt(action.value || '0', 10);
          }
          // Custom pixel conversions (also count as site leads)
          else if (typeof action.action_type === 'string' && action.action_type.startsWith('offsite_conversion.custom')) {
            siteLeads += parseInt(action.value || '0', 10);
          }
        }
      }

      const totalLeads = messagingLeads + siteLeads;

      return {
        date: row.date_start,
        spend: parseFloat(row.spend || 0),
        leads: totalLeads,
        messagingLeads,
        siteLeads,
        impressions: parseInt(row.impressions || 0),
        clicks: parseInt(row.clicks || 0)
      };
    });

    const totalSpend = data.reduce((sum, d) => sum + d.spend, 0);
    const totalLeads = data.reduce((sum, d) => sum + d.leads, 0);
    const totalMessagingLeads = data.reduce((sum, d) => sum + d.messagingLeads, 0);
    const totalSiteLeads = data.reduce((sum, d) => sum + d.siteLeads, 0);

    return {
      success: true,
      period,
      group_by: group_by || 'total',
      data,
      totals: {
        spend: totalSpend.toFixed(2),
        leads: totalLeads,
        messagingLeads: totalMessagingLeads,
        siteLeads: totalSiteLeads,
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

    // Get current status before change
    let beforeStatus = null;
    try {
      const current = await fbGraph('GET', campaign_id, accessToken, { fields: 'status' });
      beforeStatus = current.status;
    } catch (e) {
      // Continue even if we can't get before status
    }

    // Execute pause
    await fbGraph('POST', campaign_id, accessToken, { status: 'PAUSED' });

    // Post-check verification
    const verification = await verifyCampaignStatus(campaign_id, 'PAUSED', accessToken);

    // Log action
    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Campaign ${campaign_id} paused via Chat Assistant`,
      context: {
        reason,
        source: 'chat_assistant',
        agent: 'AdsAgent',
        verified: verification.verified,
        before: beforeStatus,
        after: verification.after
      }
    });

    return {
      success: true,
      message: `Кампания ${campaign_id} поставлена на паузу`,
      verification: {
        verified: verification.verified,
        before: beforeStatus,
        after: verification.after,
        warning: verification.warning
      }
    };
  },

  async resumeCampaign({ campaign_id }, { accessToken }) {
    // Get current status before change
    let beforeStatus = null;
    try {
      const current = await fbGraph('GET', campaign_id, accessToken, { fields: 'status' });
      beforeStatus = current.status;
    } catch (e) { /* ignore */ }

    await fbGraph('POST', campaign_id, accessToken, { status: 'ACTIVE' });

    // Post-check verification
    const verification = await verifyCampaignStatus(campaign_id, 'ACTIVE', accessToken);

    return {
      success: true,
      message: `Кампания ${campaign_id} возобновлена`,
      verification: {
        verified: verification.verified,
        before: beforeStatus,
        after: verification.after,
        warning: verification.warning
      }
    };
  },

  async pauseAdSet({ adset_id, reason, dry_run }, { accessToken, adAccountId }) {
    // Dry-run mode: return preview without executing
    if (dry_run) {
      return adsDryRunHandlers.pauseAdSet({ adset_id }, { accessToken });
    }

    // Get current status before change
    let beforeStatus = null;
    try {
      const current = await fbGraph('GET', adset_id, accessToken, { fields: 'status' });
      beforeStatus = current.status;
    } catch (e) { /* ignore */ }

    await fbGraph('POST', adset_id, accessToken, { status: 'PAUSED' });

    // Post-check verification
    const verification = await verifyAdSetStatus(adset_id, 'PAUSED', accessToken);

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `AdSet ${adset_id} paused via Chat Assistant`,
      context: {
        reason,
        source: 'chat_assistant',
        agent: 'AdsAgent',
        verified: verification.verified,
        before: beforeStatus,
        after: verification.after
      }
    });

    return {
      success: true,
      message: `Адсет ${adset_id} поставлен на паузу`,
      verification: {
        verified: verification.verified,
        before: beforeStatus,
        after: verification.after,
        warning: verification.warning
      }
    };
  },

  async resumeAdSet({ adset_id }, { accessToken }) {
    // Get current status before change
    let beforeStatus = null;
    try {
      const current = await fbGraph('GET', adset_id, accessToken, { fields: 'status' });
      beforeStatus = current.status;
    } catch (e) { /* ignore */ }

    await fbGraph('POST', adset_id, accessToken, { status: 'ACTIVE' });

    // Post-check verification
    const verification = await verifyAdSetStatus(adset_id, 'ACTIVE', accessToken);

    return {
      success: true,
      message: `Адсет ${adset_id} возобновлён`,
      verification: {
        verified: verification.verified,
        before: beforeStatus,
        after: verification.after,
        warning: verification.warning
      }
    };
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

    // Get current budget before change
    let beforeBudget = null;
    try {
      const current = await fbGraph('GET', adset_id, accessToken, { fields: 'daily_budget' });
      beforeBudget = parseInt(current.daily_budget || 0);
    } catch (e) { /* ignore */ }

    await fbGraph('POST', adset_id, accessToken, {
      daily_budget: new_budget_cents
    });

    // Post-check verification
    const verification = await verifyAdSetBudget(adset_id, new_budget_cents, accessToken);

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Budget updated for AdSet ${adset_id}: $${(new_budget_cents / 100).toFixed(2)}`,
      context: {
        new_budget_cents,
        before_budget_cents: beforeBudget,
        verified: verification.verified,
        source: 'chat_assistant',
        agent: 'AdsAgent'
      }
    });

    return {
      success: true,
      message: `Бюджет адсета ${adset_id} изменён на $${(new_budget_cents / 100).toFixed(2)}/день`,
      verification: {
        verified: verification.verified,
        before: beforeBudget ? `$${(beforeBudget / 100).toFixed(2)}` : null,
        after: verification.after ? `$${(verification.after / 100).toFixed(2)}` : null,
        warning: verification.warning
      }
    };
  },

  // ============================================================
  // DIRECTIONS HANDLERS
  // ============================================================

  async getDirections({ status, period }, { userAccountId, adAccountId, adAccountDbId }) {
    // Get directions for this user account
    // Note: account_directions uses user_account_id, not ad_account_id
    const dbAccountId = adAccountDbId || null;

    let query = supabase
      .from('account_directions')
      .select(`
        id,
        name,
        is_active,
        campaign_status,
        daily_budget_cents,
        target_cpl_cents,
        objective,
        fb_campaign_id,
        created_at,
        updated_at
      `)
      .eq('user_account_id', userAccountId);

    // Фильтр по account_id для мультиаккаунтности
    if (dbAccountId) {
      query = query.eq('account_id', dbAccountId);
    }

    // Filter by status: 'active' = is_active=true, 'paused' = is_active=false
    if (status && status !== 'all') {
      if (status === 'active') {
        query = query.eq('is_active', true);
      } else if (status === 'paused') {
        query = query.eq('is_active', false);
      }
    }

    const { data: directions, error } = await query.order('created_at', { ascending: false });

    if (error) {
      return { success: false, error: error.message };
    }

    // Format directions for response
    const enrichedDirections = (directions || []).map(d => {
      return {
        id: d.id,
        name: d.name,
        status: d.is_active ? 'active' : 'paused',
        campaign_status: d.campaign_status,
        budget_per_day: d.daily_budget_cents / 100, // Convert cents to dollars
        target_cpl: d.target_cpl_cents / 100, // Convert cents to dollars
        objective: d.objective,
        campaign_id: d.fb_campaign_id,
        created_at: d.created_at,
        updated_at: d.updated_at
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
      .from('account_directions')
      .select(`
        id,
        name,
        is_active,
        campaign_status,
        daily_budget_cents,
        target_cpl_cents,
        objective,
        fb_campaign_id,
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

    // Get campaign info from Facebook if available
    let campaignInfo = null;
    if (direction.fb_campaign_id && accessToken) {
      try {
        campaignInfo = await fbGraph('GET', direction.fb_campaign_id, accessToken, {
          fields: 'id,name,status,daily_budget'
        });
      } catch (e) {
        // Ignore FB errors
      }
    }

    return {
      success: true,
      direction: {
        id: direction.id,
        name: direction.name,
        status: direction.is_active ? 'active' : 'paused',
        campaign_status: direction.campaign_status,
        budget_per_day: direction.daily_budget_cents / 100,
        target_cpl: direction.target_cpl_cents / 100,
        objective: direction.objective,
        campaign_id: direction.fb_campaign_id,
        created_at: direction.created_at,
        updated_at: direction.updated_at,
        creatives: creatives || [],
        campaign: campaignInfo
      }
    };
  },

  async getDirectionMetrics({ direction_id, period }, { adAccountId, userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;
    const days = { '7d': 7, '14d': 14, '30d': 30 }[period] || 7;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // 1. Пробуем получить из rollup (быстро)
    let rollupQuery = supabase
      .from('direction_metrics_rollup')
      .select('*')
      .eq('direction_id', direction_id)
      .eq('user_account_id', userAccountId)
      .gte('day', startDate)
      .order('day', { ascending: true });

    // Фильтр по account_id для мультиаккаунтности
    if (dbAccountId) {
      rollupQuery = rollupQuery.eq('account_id', dbAccountId);
    }

    const { data: rollupMetrics, error: rollupError } = await rollupQuery;

    if (!rollupError && rollupMetrics?.length > 0) {
      // Используем данные из rollup
      const totals = rollupMetrics.reduce((acc, d) => ({
        spend: acc.spend + parseFloat(d.spend || 0),
        leads: acc.leads + parseInt(d.leads || 0),
        impressions: acc.impressions + parseInt(d.impressions || 0),
        clicks: acc.clicks + parseInt(d.clicks || 0)
      }), { spend: 0, leads: 0, impressions: 0, clicks: 0 });

      // Форматируем daily для единообразия
      const daily = rollupMetrics.map(d => ({
        date: d.day,
        spend: parseFloat(d.spend || 0),
        leads: parseInt(d.leads || 0),
        impressions: parseInt(d.impressions || 0),
        clicks: parseInt(d.clicks || 0),
        cpl: d.cpl ? parseFloat(d.cpl) : null,
        ctr: d.ctr ? parseFloat(d.ctr) : null,
        cpm: d.cpm ? parseFloat(d.cpm) : null,
        active_creatives: d.active_creatives_count,
        active_ads: d.active_ads_count,
        spend_delta: d.spend_delta ? parseFloat(d.spend_delta) : null,
        leads_delta: d.leads_delta,
        cpl_delta: d.cpl_delta ? parseFloat(d.cpl_delta) : null
      }));

      return {
        success: true,
        direction_id,
        period,
        source: 'rollup',
        daily,
        totals: {
          ...totals,
          cpl: totals.leads > 0 ? (totals.spend / totals.leads).toFixed(2) : null,
          ctr: totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : null
        }
      };
    }

    // 2. Fallback: агрегируем из creative_metrics_history через ad_creative_mapping
    let metricsQuery = supabase
      .from('creative_metrics_history')
      .select(`
        date,
        spend,
        leads,
        impressions,
        clicks,
        ad_id
      `)
      .eq('user_account_id', userAccountId)
      .gte('date', startDate)
      .eq('source', 'production');

    // Фильтр по account_id для мультиаккаунтности
    if (dbAccountId) {
      metricsQuery = metricsQuery.eq('account_id', dbAccountId);
    }

    const { data: metricsData, error: metricsError } = await metricsQuery;

    if (metricsError) {
      return { success: false, error: metricsError.message };
    }

    // Получаем ad_ids для этого direction
    let mappingsQuery = supabase
      .from('ad_creative_mapping')
      .select('ad_id')
      .eq('direction_id', direction_id);

    // Фильтр по account_id для мультиаккаунтности
    if (dbAccountId) {
      mappingsQuery = mappingsQuery.eq('account_id', dbAccountId);
    }

    const { data: mappings } = await mappingsQuery;

    const directionAdIds = new Set((mappings || []).map(m => m.ad_id));

    // Фильтруем метрики по ads этого direction
    const filteredMetrics = (metricsData || []).filter(m => directionAdIds.has(m.ad_id));

    // Группируем по дате
    const byDate = {};
    for (const m of filteredMetrics) {
      if (!byDate[m.date]) {
        byDate[m.date] = { spend: 0, leads: 0, impressions: 0, clicks: 0 };
      }
      byDate[m.date].spend += parseFloat(m.spend || 0);
      byDate[m.date].leads += parseInt(m.leads || 0);
      byDate[m.date].impressions += parseInt(m.impressions || 0);
      byDate[m.date].clicks += parseInt(m.clicks || 0);
    }

    const daily = Object.entries(byDate)
      .map(([date, d]) => ({
        date,
        ...d,
        cpl: d.leads > 0 ? (d.spend / d.leads).toFixed(2) : null,
        ctr: d.impressions > 0 ? ((d.clicks / d.impressions) * 100).toFixed(2) : null
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totals = daily.reduce((acc, d) => ({
      spend: acc.spend + d.spend,
      leads: acc.leads + d.leads,
      impressions: acc.impressions + d.impressions,
      clicks: acc.clicks + d.clicks
    }), { spend: 0, leads: 0, impressions: 0, clicks: 0 });

    return {
      success: true,
      direction_id,
      period,
      source: 'fallback_aggregation',
      daily,
      totals: {
        ...totals,
        cpl: totals.leads > 0 ? (totals.spend / totals.leads).toFixed(2) : null,
        ctr: totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : null
      }
    };
  },

  async updateDirectionBudget({ direction_id, new_budget, dry_run }, { adAccountId, userAccountId }) {
    // Dry-run mode: return preview with change % and warnings
    if (dry_run) {
      return adsDryRunHandlers.updateDirectionBudget({ direction_id, new_budget }, { adAccountId });
    }

    // Convert dollars to cents for storage
    const newBudgetCents = Math.round(new_budget * 100);

    // Update direction budget (stored in cents)
    const { data, error } = await supabase
      .from('account_directions')
      .update({ daily_budget_cents: newBudgetCents, updated_at: new Date().toISOString() })
      .eq('id', direction_id)
      .select('id, name, daily_budget_cents')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Direction budget updated: ${data.name} → $${new_budget}/day`,
      context: { direction_id, new_budget, new_budget_cents: newBudgetCents, source: 'chat_assistant', agent: 'AdsAgent' }
    });

    return {
      success: true,
      message: `Бюджет направления "${data.name}" изменён на $${new_budget}/день`
    };
  },

  async updateDirectionTargetCPL({ direction_id, target_cpl }, { adAccountId }) {
    // Convert dollars to cents for storage
    const targetCplCents = Math.round(target_cpl * 100);

    const { data, error } = await supabase
      .from('account_directions')
      .update({ target_cpl_cents: targetCplCents, updated_at: new Date().toISOString() })
      .eq('id', direction_id)
      .select('id, name, target_cpl_cents')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Direction target CPL updated: ${data.name} → $${target_cpl}`,
      context: { direction_id, target_cpl, target_cpl_cents: targetCplCents, source: 'chat_assistant', agent: 'AdsAgent' }
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

    // Get direction with fb_campaign_id
    const { data: direction, error: fetchError } = await supabase
      .from('account_directions')
      .select('id, name, fb_campaign_id')
      .eq('id', direction_id)
      .single();

    if (fetchError) {
      return { success: false, error: fetchError.message };
    }

    // Update direction status (is_active = false)
    const { error: updateError } = await supabase
      .from('account_directions')
      .update({ is_active: false, campaign_status: 'PAUSED', updated_at: new Date().toISOString() })
      .eq('id', direction_id);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Pause FB campaign if linked
    let fbPaused = false;
    if (direction.fb_campaign_id && accessToken) {
      try {
        await fbGraph('POST', direction.fb_campaign_id, accessToken, { status: 'PAUSED' });
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
      message: `Направление "${direction.name}" поставлено на паузу${fbPaused ? ' (включая FB кампанию)' : ''}`
    };
  },

  // ============================================================
  // ROI ANALYTICS HANDLERS
  // ============================================================

  /**
   * Get ROI report for creatives
   * Logic adapted from salesApi.getROIData()
   */
  async getROIReport({ period, direction_id, media_type }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Period to days
    const periodDays = {
      'last_7d': 7,
      'last_30d': 30,
      'last_90d': 90,
      'all': null
    }[period] || null;

    const since = (() => {
      if (!periodDays) return null;
      const d = new Date();
      d.setDate(d.getDate() - periodDays);
      d.setHours(0, 0, 0, 0);
      return d.toISOString().split('T')[0];
    })();

    // USD to KZT rate
    const usdToKztRate = 530;

    // Step 1: Load user_creatives
    let creativesQuery = supabase
      .from('user_creatives')
      .select('id, title, media_type, direction_id')
      .eq('user_id', userAccountId)
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .limit(500);

    if (dbAccountId) {
      creativesQuery = creativesQuery.eq('account_id', dbAccountId);
    }
    if (direction_id) {
      creativesQuery = creativesQuery.eq('direction_id', direction_id);
    }
    if (media_type) {
      creativesQuery = creativesQuery.eq('media_type', media_type);
    }

    const { data: creatives, error: creativesError } = await creativesQuery;

    if (creativesError) {
      return { error: `Ошибка загрузки креативов: ${creativesError.message}` };
    }

    if (!creatives || creatives.length === 0) {
      return {
        totalSpend: 0,
        totalRevenue: 0,
        totalROI: 0,
        totalLeads: 0,
        totalConversions: 0,
        campaigns: [],
        message: 'Креативы не найдены за указанный период'
      };
    }

    const creativeIds = creatives.map(c => c.id);

    // Step 2: Load metrics from creative_metrics_history
    let metricsQuery = supabase
      .from('creative_metrics_history')
      .select('user_creative_id, impressions, clicks, leads, spend')
      .in('user_creative_id', creativeIds)
      .eq('user_account_id', userAccountId)
      .eq('source', 'production');

    if (since) {
      metricsQuery = metricsQuery.gte('date', since);
    }

    const { data: metricsHistory } = await metricsQuery;

    // Aggregate metrics by creative
    const metricsMap = new Map();
    for (const metric of metricsHistory || []) {
      const creativeId = metric.user_creative_id;
      if (!metricsMap.has(creativeId)) {
        metricsMap.set(creativeId, { impressions: 0, clicks: 0, leads: 0, spend: 0 });
      }
      const agg = metricsMap.get(creativeId);
      agg.impressions += metric.impressions || 0;
      agg.clicks += metric.clicks || 0;
      agg.leads += metric.leads || 0;
      agg.spend += metric.spend || 0;
    }

    // Step 3: Load leads for revenue calculation
    let leadsQuery = supabase
      .from('leads')
      .select('id, chat_id, creative_id, is_qualified')
      .eq('user_account_id', userAccountId)
      .in('creative_id', creativeIds);

    if (dbAccountId) {
      leadsQuery = leadsQuery.eq('account_id', dbAccountId);
    }
    if (direction_id) {
      leadsQuery = leadsQuery.eq('direction_id', direction_id);
    }
    if (since) {
      leadsQuery = leadsQuery.gte('created_at', since + 'T00:00:00.000Z');
    }

    const { data: leadsData } = await leadsQuery;

    // Step 4: Load purchases for revenue
    const leadPhones = leadsData?.map(l => l.chat_id).filter(Boolean) || [];

    let purchasesQuery = supabase
      .from('purchases')
      .select('client_phone, amount')
      .eq('user_account_id', userAccountId);

    if (dbAccountId) {
      purchasesQuery = purchasesQuery.eq('account_id', dbAccountId);
    }
    if (leadPhones.length > 0) {
      purchasesQuery = purchasesQuery.in('client_phone', leadPhones);
    } else {
      purchasesQuery = purchasesQuery.in('client_phone', ['__no_match__']);
    }
    if (since) {
      purchasesQuery = purchasesQuery.gte('created_at', since + 'T00:00:00.000Z');
    }

    const { data: purchasesData } = await purchasesQuery;

    // Group purchases by phone
    const purchasesByPhone = new Map();
    for (const purchase of purchasesData || []) {
      const phone = purchase.client_phone;
      if (!purchasesByPhone.has(phone)) {
        purchasesByPhone.set(phone, { count: 0, amount: 0 });
      }
      const p = purchasesByPhone.get(phone);
      p.count++;
      p.amount += Number(purchase.amount) || 0;
    }

    // Group revenue by creative
    const revenueByCreative = new Map();
    for (const lead of leadsData || []) {
      const creativeId = lead.creative_id;
      if (!creativeId) continue;

      if (!revenueByCreative.has(creativeId)) {
        revenueByCreative.set(creativeId, { revenue: 0, conversions: 0 });
      }
      const rev = revenueByCreative.get(creativeId);

      const purchaseData = purchasesByPhone.get(lead.chat_id);
      if (purchaseData) {
        rev.revenue += purchaseData.amount;
        rev.conversions += purchaseData.count;
      }
    }

    // Step 5: Build result
    const campaigns = [];
    let totalRevenue = 0;
    let totalSpend = 0;
    let totalLeads = 0;
    let totalConversions = 0;

    for (const creative of creatives) {
      const metrics = metricsMap.get(creative.id) || { impressions: 0, clicks: 0, leads: 0, spend: 0 };
      const revenueData = revenueByCreative.get(creative.id) || { revenue: 0, conversions: 0 };

      const leads = metrics.leads;
      const spend = Math.round(metrics.spend * usdToKztRate);
      const revenue = revenueData.revenue;
      const conversions = revenueData.conversions;

      // ROI calculation
      const roi = spend > 0 ? Math.round(((revenue - spend) / spend) * 100) : 0;

      if (leads > 0 || spend > 0) { // Only include creatives with activity
        campaigns.push({
          id: creative.id,
          name: creative.title || `Креатив ${creative.id.substring(0, 8)}`,
          media_type: creative.media_type,
          spend,
          revenue,
          roi,
          leads,
          conversions
        });

        totalRevenue += revenue;
        totalSpend += spend;
        totalLeads += leads;
        totalConversions += conversions;
      }
    }

    // Sort by leads descending
    campaigns.sort((a, b) => b.leads - a.leads);

    const totalROI = totalSpend > 0 ? Math.round(((totalRevenue - totalSpend) / totalSpend) * 100) : 0;

    return {
      period,
      totalSpend,
      totalSpend_formatted: `${(totalSpend / 1000).toFixed(0)}K ₸`,
      totalRevenue,
      totalRevenue_formatted: `${(totalRevenue / 1000).toFixed(0)}K ₸`,
      totalROI,
      totalROI_formatted: `${totalROI}%`,
      totalLeads,
      totalConversions,
      campaigns: campaigns.slice(0, 10) // Top 10 creatives
    };
  },

  /**
   * Compare ROI between creatives or directions
   */
  async getROIComparison({ period, compare_by, top_n = 5 }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Period to days
    const periodDays = period === 'last_7d' ? 7 : 30;

    const since = (() => {
      const d = new Date();
      d.setDate(d.getDate() - periodDays);
      d.setHours(0, 0, 0, 0);
      return d.toISOString().split('T')[0];
    })();

    const usdToKztRate = 530;

    if (compare_by === 'direction') {
      // Compare by directions
      let directionsQuery = supabase
        .from('account_directions')
        .select('id, name')
        .eq('user_account_id', userAccountId)
        .eq('is_active', true);

      if (dbAccountId) {
        directionsQuery = directionsQuery.eq('account_id', dbAccountId);
      }

      const { data: directions } = await directionsQuery;

      if (!directions || directions.length === 0) {
        return { error: 'Направления не найдены' };
      }

      const results = [];

      for (const direction of directions) {
        // Load metrics for direction's creatives
        let creativesQuery = supabase
          .from('user_creatives')
          .select('id')
          .eq('user_id', userAccountId)
          .eq('direction_id', direction.id)
          .eq('status', 'ready');

        if (dbAccountId) {
          creativesQuery = creativesQuery.eq('account_id', dbAccountId);
        }

        const { data: dirCreatives } = await creativesQuery;
        const creativeIds = dirCreatives?.map(c => c.id) || [];

        if (creativeIds.length === 0) continue;

        // Get metrics
        let metricsQuery = supabase
          .from('creative_metrics_history')
          .select('leads, spend')
          .in('user_creative_id', creativeIds)
          .eq('user_account_id', userAccountId)
          .eq('source', 'production')
          .gte('date', since);

        const { data: metrics } = await metricsQuery;

        let totalLeads = 0;
        let totalSpend = 0;

        for (const m of metrics || []) {
          totalLeads += m.leads || 0;
          totalSpend += m.spend || 0;
        }

        const spendKzt = Math.round(totalSpend * usdToKztRate);

        // Get revenue
        let leadsQuery = supabase
          .from('leads')
          .select('chat_id')
          .eq('user_account_id', userAccountId)
          .eq('direction_id', direction.id)
          .gte('created_at', since + 'T00:00:00.000Z');

        if (dbAccountId) {
          leadsQuery = leadsQuery.eq('account_id', dbAccountId);
        }

        const { data: leadsData } = await leadsQuery;
        const phones = leadsData?.map(l => l.chat_id).filter(Boolean) || [];

        let revenue = 0;
        if (phones.length > 0) {
          let purchasesQuery = supabase
            .from('purchases')
            .select('amount')
            .eq('user_account_id', userAccountId)
            .in('client_phone', phones)
            .gte('created_at', since + 'T00:00:00.000Z');

          if (dbAccountId) {
            purchasesQuery = purchasesQuery.eq('account_id', dbAccountId);
          }

          const { data: purchases } = await purchasesQuery;
          revenue = purchases?.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || 0;
        }

        const roi = spendKzt > 0 ? Math.round(((revenue - spendKzt) / spendKzt) * 100) : 0;

        results.push({
          id: direction.id,
          name: direction.name,
          spend: spendKzt,
          revenue,
          roi,
          leads: totalLeads
        });
      }

      // Sort by ROI descending
      results.sort((a, b) => b.roi - a.roi);

      return {
        period,
        compare_by: 'direction',
        items: results.slice(0, top_n)
      };

    } else {
      // Compare by creatives - use getROIReport and sort by ROI
      const report = await this.getROIReport(
        { period, direction_id: null, media_type: null },
        { userAccountId, adAccountId, adAccountDbId }
      );

      if (report.error) return report;

      // Sort by ROI
      const sorted = [...(report.campaigns || [])].sort((a, b) => b.roi - a.roi);

      return {
        period,
        compare_by: 'creative',
        items: sorted.slice(0, top_n)
      };
    }
  }
};
