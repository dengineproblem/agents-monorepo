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
import { attachRefs, buildEntityMap } from '../../shared/entityLinker.js';
import { getUsdToKzt } from '../../shared/currencyRate.js';
import { logger } from '../../../lib/logger.js';

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

    // Add entity refs for entity linking
    const campaignsWithRefs = attachRefs(campaigns, 'c');
    const entityMap = buildEntityMap(campaigns, 'c');

    return {
      success: true,
      period,
      campaigns: campaignsWithRefs,
      total: campaigns.length,
      _entityMap: entityMap  // For saving to focus_entities
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
   * Enhanced with recommendations, top/worst performers
   */
  async getROIReport({ period, direction_id, media_type, group_by }, { userAccountId, adAccountId, adAccountDbId }) {
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

    // USD to KZT rate from DB (cached, updated daily by cron)
    const usdToKztRate = await getUsdToKzt();

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
      logger.info({ userAccountId, dbAccountId, period, direction_id, media_type },
        'getROIReport: no creatives found');
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

    logger.debug({ creativesCount: creatives.length, since, period },
      'getROIReport: found creatives');

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

    // Sort by leads descending for main list
    campaigns.sort((a, b) => b.leads - a.leads);

    const totalROI = totalSpend > 0 ? Math.round(((totalRevenue - totalSpend) / totalSpend) * 100) : 0;

    // Get top and worst performers by ROI
    const sortedByROI = [...campaigns].sort((a, b) => b.roi - a.roi);
    const topPerformers = sortedByROI.filter(c => c.roi > 0).slice(0, 3);
    const worstPerformers = sortedByROI.filter(c => c.roi < 0 && c.spend > 0).reverse().slice(0, 3);

    // Generate recommendations based on data analysis
    const recommendations = [];

    // Recommendation 1: Cut budget for negative ROI
    for (const item of worstPerformers) {
      if (item.roi < -20 && item.spend > 10000) { // More than -20% ROI and >10K spend
        recommendations.push({
          type: 'cut_budget',
          entity_type: 'creative',
          entity_id: item.id,
          entity_name: item.name,
          reason: `ROI ${item.roi}%, потрачено ${(item.spend / 1000).toFixed(0)}K ₸ без окупаемости`,
          action_label: 'Снизить бюджет или остановить'
        });
      }
    }

    // Recommendation 2: Scale top performers
    for (const item of topPerformers) {
      if (item.roi > 100 && item.leads >= 5) { // >100% ROI with decent leads
        recommendations.push({
          type: 'increase_budget',
          entity_type: 'creative',
          entity_id: item.id,
          entity_name: item.name,
          reason: `ROI +${item.roi}%, ${item.leads} лидов — можно масштабировать`,
          action_label: 'Увеличить бюджет'
        });
      }
    }

    // Recommendation 3: Overall performance insights
    if (totalROI < 0 && totalSpend > 50000) {
      recommendations.push({
        type: 'review_strategy',
        entity_type: 'account',
        reason: `Общий ROI отрицательный (${totalROI}%). Рекомендуем пересмотреть стратегию.`,
        action_label: 'Провести аудит кампаний'
      });
    }

    // Recommendation 4: No conversions
    const noConversionCampaigns = campaigns.filter(c => c.leads > 5 && c.conversions === 0);
    if (noConversionCampaigns.length > 2) {
      recommendations.push({
        type: 'improve_funnel',
        entity_type: 'funnel',
        reason: `${noConversionCampaigns.length} креативов с лидами, но без продаж. Проверьте воронку.`,
        action_label: 'Проверить обработку лидов'
      });
    }

    return {
      success: true,
      period,
      totalSpend,
      totalSpend_formatted: `${(totalSpend / 1000).toFixed(0)}K ₸`,
      totalRevenue,
      totalRevenue_formatted: `${(totalRevenue / 1000).toFixed(0)}K ₸`,
      totalROI,
      totalROI_formatted: `${totalROI}%`,
      totalLeads,
      totalConversions,
      conversionRate: totalLeads > 0 ? Math.round((totalConversions / totalLeads) * 100) : 0,
      conversionRate_formatted: totalLeads > 0 ? `${Math.round((totalConversions / totalLeads) * 100)}%` : '0%',
      campaigns: campaigns.slice(0, 10), // Top 10 creatives by leads
      topPerformers,   // Top 3 by ROI
      worstPerformers, // Worst 3 by ROI
      recommendations, // Auto-generated recommendations
      meta: {
        source: 'creative_metrics_history',
        usdKztRate: usdToKztRate
      }
    };
  },

  /**
   * Compare ROI between creatives or directions
   */
  async getROIComparison({ period = 'all', compare_by, top_n = 5 }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Period to days (null = all time)
    const periodDays = {
      'last_7d': 7,
      'last_30d': 30,
      'last_90d': 90,
      'all': null
    }[period] || null;

    const since = (() => {
      if (!periodDays) return null; // all time - no filter
      const d = new Date();
      d.setDate(d.getDate() - periodDays);
      d.setHours(0, 0, 0, 0);
      return d.toISOString().split('T')[0];
    })();

    // USD to KZT rate from DB (cached, updated daily by cron)
    const usdToKztRate = await getUsdToKzt();

    logger.debug({ period, compare_by, since, dbAccountId }, 'getROIComparison: starting');

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
          .eq('source', 'production');

        if (since) {
          metricsQuery = metricsQuery.gte('date', since);
        }

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
          .eq('direction_id', direction.id);

        if (since) {
          leadsQuery = leadsQuery.gte('created_at', since + 'T00:00:00.000Z');
        }
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
            .in('client_phone', phones);

          if (since) {
            purchasesQuery = purchasesQuery.gte('created_at', since + 'T00:00:00.000Z');
          }
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
      const report = await adsHandlers.getROIReport(
        { period, direction_id: null, media_type: null },
        { userAccountId, adAccountId, adAccountDbId }
      );

      if (report.error) {
        logger.warn({ error: report.error, period }, 'getROIComparison: getROIReport returned error');
        return report;
      }

      // Sort by ROI
      const sorted = [...(report.campaigns || [])].sort((a, b) => b.roi - a.roi);

      logger.debug({
        period,
        campaignsCount: report.campaigns?.length || 0,
        sortedCount: sorted.length,
        message: report.message
      }, 'getROIComparison: returning creative comparison');

      return {
        period,
        compare_by: 'creative',
        items: sorted.slice(0, top_n),
        // Include message if no data found
        ...(report.message && sorted.length === 0 ? { message: report.message } : {})
      };
    }
  },

  // ============================================================
  // BRAIN AGENT HANDLERS
  // ============================================================

  /**
   * Get recent Brain Agent actions from brain_executions
   * Shows what the automated optimization has done recently
   */
  async getAgentBrainActions({ period, limit, action_type }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Calculate date range
    const periodDays = {
      'last_1d': 1,
      'last_3d': 3,
      'last_7d': 7
    }[period] || 3;

    const sinceDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

    // Query brain_executions
    let query = supabase
      .from('brain_executions')
      .select('id, actions_json, plan_json, created_at, status, execution_mode')
      .eq('user_account_id', userAccountId)
      .gte('created_at', sinceDate)
      .order('created_at', { ascending: false })
      .limit(10); // Max 10 executions, then filter actions

    if (dbAccountId) {
      query = query.eq('account_id', dbAccountId);
    }

    const { data: executions, error } = await query;

    if (error) {
      return { success: false, error: error.message };
    }

    if (!executions || executions.length === 0) {
      return {
        success: true,
        period,
        actions: [],
        total: 0,
        message: 'Brain Agent не выполнял действий за указанный период'
      };
    }

    // Flatten and format all actions from all executions
    const allActions = [];

    for (const execution of executions) {
      if (!execution.actions_json) continue;

      const actions = Array.isArray(execution.actions_json)
        ? execution.actions_json
        : [execution.actions_json];

      for (const action of actions) {
        // Determine action type
        let type = 'other';
        if (action.action === 'budget_change' || action.type === 'budget_change') {
          type = 'budget_change';
        } else if (action.action === 'pause' || action.type === 'pause' || action.status === 'PAUSED') {
          type = 'pause';
        } else if (action.action === 'resume' || action.type === 'resume' || action.status === 'ACTIVE') {
          type = 'resume';
        } else if (action.action === 'launch' || action.type === 'creative_launch') {
          type = 'launch';
        }

        // Filter by action_type if specified
        if (action_type !== 'all' && type !== action_type) continue;

        allActions.push({
          id: action.id || action.adset_id || action.ad_id,
          name: action.name || action.adset_name || action.ad_name || 'Unknown',
          type,
          action_label: action.action || action.type || type,
          details: {
            old_budget: action.old_budget,
            new_budget: action.new_budget,
            reason: action.reason,
            score: action.score,
            metrics: action.metrics
          },
          executed_at: execution.created_at,
          execution_id: execution.id,
          execution_mode: execution.execution_mode,
          status: execution.status
        });
      }
    }

    // Apply limit
    const limitedActions = allActions.slice(0, limit || 20);

    // Group by type for summary
    const summary = {
      budget_changes: allActions.filter(a => a.type === 'budget_change').length,
      pauses: allActions.filter(a => a.type === 'pause').length,
      resumes: allActions.filter(a => a.type === 'resume').length,
      launches: allActions.filter(a => a.type === 'launch').length
    };

    return {
      success: true,
      period,
      actions: limitedActions,
      total: allActions.length,
      summary,
      executions_count: executions.length
    };
  },

  /**
   * Trigger a Brain Agent optimization run
   * WARNING: This is a dangerous operation that can modify budgets and pause/resume adsets
   */
  async triggerBrainOptimizationRun({ direction_id, dry_run, reason }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Dry-run mode: show what would be optimized
    if (dry_run) {
      // Get current state for preview
      let directionsQuery = supabase
        .from('account_directions')
        .select('id, name, is_active, daily_budget_cents, target_cpl_cents')
        .eq('user_account_id', userAccountId)
        .eq('is_active', true);

      if (dbAccountId) {
        directionsQuery = directionsQuery.eq('account_id', dbAccountId);
      }
      if (direction_id) {
        directionsQuery = directionsQuery.eq('id', direction_id);
      }

      const { data: directions } = await directionsQuery;

      // Get last scoring output for insights
      let scoringQuery = supabase
        .from('scoring_executions')
        .select('scoring_output, created_at')
        .eq('user_account_id', userAccountId)
        .eq('status', 'success')
        .order('created_at', { ascending: false })
        .limit(1);

      if (dbAccountId) {
        scoringQuery = scoringQuery.eq('account_id', dbAccountId);
      }

      const { data: lastScoring } = await scoringQuery.maybeSingle();

      return {
        success: true,
        dry_run: true,
        preview: {
          directions_to_optimize: (directions || []).map(d => ({
            id: d.id,
            name: d.name,
            current_budget: d.daily_budget_cents / 100,
            target_cpl: d.target_cpl_cents / 100
          })),
          total_directions: directions?.length || 0,
          last_scoring_at: lastScoring?.created_at,
          adsets_in_scope: lastScoring?.scoring_output?.adsets?.length || 0
        },
        warning: 'Brain Agent может изменить бюджеты и статусы адсетов. Используй dry_run: false для выполнения.'
      };
    }

    // Actual execution — create brain_executions record and trigger
    const executionId = crypto.randomUUID();

    // Insert execution record
    const { error: insertError } = await supabase
      .from('brain_executions')
      .insert({
        id: executionId,
        user_account_id: userAccountId,
        account_id: dbAccountId,
        execution_mode: 'manual_trigger',
        status: 'pending',
        plan_json: {
          triggered_by: 'chat_assistant',
          reason: reason || 'Manual trigger via Chat Assistant',
          direction_id: direction_id || null,
          triggered_at: new Date().toISOString()
        }
      });

    if (insertError) {
      return { success: false, error: `Не удалось создать запись выполнения: ${insertError.message}` };
    }

    // Log the action
    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Brain optimization triggered via Chat Assistant`,
      context: {
        execution_id: executionId,
        direction_id,
        reason,
        source: 'chat_assistant',
        agent: 'AdsAgent'
      }
    });

    return {
      success: true,
      message: 'Brain Agent оптимизация запущена',
      execution_id: executionId,
      note: 'Результаты будут доступны через getAgentBrainActions через несколько минут',
      approval_required: false // Already approved if we got here
    };
  },

  // ============================================================
  // PRE-CHECK & INSIGHTS HANDLERS (Hybrid MCP)
  // ============================================================

  /**
   * Get ad account status - pre-check for playbooks
   * Checks if account can run ads, blocking reasons, limits
   */
  async getAdAccountStatus({}, { accessToken, adAccountId }) {
    // Normalize: don't add act_ prefix if already present
    const actId = adAccountId?.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    try {
      const result = await fbGraph('GET', actId, accessToken, {
        fields: 'account_status,disable_reason,spend_cap,amount_spent,currency,name,funding_source_details,business'
      });

      // Map FB account_status to our status enum
      // 1 = ACTIVE, 2 = DISABLED, 3 = UNSETTLED, 7 = PENDING_RISK_REVIEW, 8 = PENDING_SETTLEMENT, 9 = IN_GRACE_PERIOD, 100 = PENDING_CLOSURE, 101 = CLOSED, 201 = ANY_ACTIVE, 202 = ANY_CLOSED
      const statusMap = {
        1: 'ACTIVE',
        2: 'DISABLED',
        3: 'PAYMENT_REQUIRED',
        7: 'REVIEW',
        8: 'PAYMENT_REQUIRED',
        9: 'ACTIVE',
        100: 'DISABLED',
        101: 'DISABLED'
      };

      const status = statusMap[result.account_status] || 'ERROR';
      const canRunAds = result.account_status === 1 || result.account_status === 9;

      // Build blocking reasons
      const blockingReasons = [];

      if (result.account_status === 2) {
        blockingReasons.push({
          code: 'ACCOUNT_DISABLED',
          message: result.disable_reason || 'Аккаунт отключён'
        });
      }

      if (result.account_status === 3 || result.account_status === 8) {
        blockingReasons.push({
          code: 'BILLING',
          message: 'Проблема с оплатой — проверьте платёжный метод'
        });
      }

      if (result.account_status === 7) {
        blockingReasons.push({
          code: 'REVIEW',
          message: 'Аккаунт на проверке — ожидайте рассмотрения'
        });
      }

      // Check spend limits
      const spendCap = result.spend_cap ? parseFloat(result.spend_cap) / 100 : null;
      const amountSpent = result.amount_spent ? parseFloat(result.amount_spent) / 100 : 0;

      if (spendCap && amountSpent >= spendCap * 0.95) {
        blockingReasons.push({
          code: 'SPEND_LIMIT',
          message: `Лимит расхода почти исчерпан: $${amountSpent.toFixed(2)} из $${spendCap.toFixed(2)}`
        });
      }

      return {
        success: true,
        status,
        can_run_ads: canRunAds,
        blocking_reasons: blockingReasons,
        limits: {
          spend_cap: spendCap,
          amount_spent: amountSpent,
          currency: result.currency || 'USD'
        },
        account: {
          id: actId,
          name: result.name
        },
        last_error: blockingReasons.length > 0 ? blockingReasons[0] : null
      };
    } catch (error) {
      logger.error({ error: error.message, adAccountId }, 'getAdAccountStatus failed');

      return {
        success: false,
        status: 'ERROR',
        can_run_ads: false,
        blocking_reasons: [{
          code: 'API_ERROR',
          message: `Не удалось проверить статус: ${error.message}`
        }],
        limits: { spend_cap: null, amount_spent: null, currency: 'USD' },
        last_error: { code: 'API_ERROR', message: error.message }
      };
    }
  },

  /**
   * Get direction insights with period comparison
   * Returns current metrics + delta vs previous period
   */
  async getDirectionInsights({ direction_id, period = 'last_3d', compare }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Parse period
    const periodDays = {
      'last_3d': 3,
      'last_7d': 7,
      'last_14d': 14,
      'last_30d': 30
    }[period] || 3;

    const now = new Date();
    const currentEnd = now.toISOString().split('T')[0];
    const currentStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Get direction info including target CPL
    const { data: direction } = await supabase
      .from('account_directions')
      .select('id, name, target_cpl_cents, daily_budget_cents')
      .eq('id', direction_id)
      .single();

    const targetCpl = direction?.target_cpl_cents ? direction.target_cpl_cents / 100 : null;

    // Get current period metrics from rollup
    let currentQuery = supabase
      .from('direction_metrics_rollup')
      .select('*')
      .eq('direction_id', direction_id)
      .eq('user_account_id', userAccountId)
      .gte('day', currentStart)
      .lte('day', currentEnd)
      .order('day', { ascending: true });

    if (dbAccountId) {
      currentQuery = currentQuery.eq('account_id', dbAccountId);
    }

    const { data: currentMetrics } = await currentQuery;

    // Aggregate current period
    const current = (currentMetrics || []).reduce((acc, d) => ({
      spend: acc.spend + parseFloat(d.spend || 0),
      leads: acc.leads + parseInt(d.leads || 0),
      impressions: acc.impressions + parseInt(d.impressions || 0),
      clicks: acc.clicks + parseInt(d.clicks || 0)
    }), { spend: 0, leads: 0, impressions: 0, clicks: 0 });

    // Calculate derived metrics
    current.cpl = current.leads > 0 ? current.spend / current.leads : null;
    current.ctr = current.impressions > 0 ? (current.clicks / current.impressions) * 100 : null;
    current.cpm = current.impressions > 0 ? (current.spend / current.impressions) * 1000 : null;
    current.cpc = current.clicks > 0 ? current.spend / current.clicks : null;

    let previous = null;
    let delta = null;

    // Get previous period if comparison requested
    if (compare === 'previous_same') {
      const prevEnd = new Date(new Date(currentStart).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const prevStart = new Date(new Date(prevEnd).getTime() - (periodDays - 1) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      let prevQuery = supabase
        .from('direction_metrics_rollup')
        .select('*')
        .eq('direction_id', direction_id)
        .eq('user_account_id', userAccountId)
        .gte('day', prevStart)
        .lte('day', prevEnd);

      if (dbAccountId) {
        prevQuery = prevQuery.eq('account_id', dbAccountId);
      }

      const { data: prevMetrics } = await prevQuery;

      previous = (prevMetrics || []).reduce((acc, d) => ({
        spend: acc.spend + parseFloat(d.spend || 0),
        leads: acc.leads + parseInt(d.leads || 0),
        impressions: acc.impressions + parseInt(d.impressions || 0),
        clicks: acc.clicks + parseInt(d.clicks || 0)
      }), { spend: 0, leads: 0, impressions: 0, clicks: 0 });

      previous.cpl = previous.leads > 0 ? previous.spend / previous.leads : null;
      previous.ctr = previous.impressions > 0 ? (previous.clicks / previous.impressions) * 100 : null;
      previous.cpm = previous.impressions > 0 ? (previous.spend / previous.impressions) * 1000 : null;
      previous.cpc = previous.clicks > 0 ? previous.spend / previous.clicks : null;

      // Calculate deltas
      delta = {
        spend_pct: previous.spend > 0 ? ((current.spend - previous.spend) / previous.spend) * 100 : null,
        leads_pct: previous.leads > 0 ? ((current.leads - previous.leads) / previous.leads) * 100 : null,
        cpl_pct: previous.cpl > 0 ? ((current.cpl - previous.cpl) / previous.cpl) * 100 : null,
        ctr_pct: previous.ctr > 0 ? ((current.ctr - previous.ctr) / previous.ctr) * 100 : null,
        cpm_pct: previous.cpm > 0 ? ((current.cpm - previous.cpm) / previous.cpm) * 100 : null
      };
    }

    // Check guards
    const minImpressions = Math.min(...(currentMetrics || []).map(d => parseInt(d.impressions || 0)));
    const isSmallSample = minImpressions < 1000;

    // CPL vs target analysis
    let cplStatus = 'normal';
    let cplVsTargetPct = null;
    if (targetCpl && current.cpl) {
      cplVsTargetPct = ((current.cpl - targetCpl) / targetCpl) * 100;
      if (cplVsTargetPct > 30) {
        cplStatus = 'high';
      } else if (cplVsTargetPct < -20) {
        cplStatus = 'low';
      }
    }

    return {
      success: true,
      direction_id,
      direction_name: direction?.name,
      period: { start: currentStart, end: currentEnd },
      current: {
        ...current,
        cpl: current.cpl?.toFixed(2) || null,
        ctr: current.ctr?.toFixed(2) || null,
        cpm: current.cpm?.toFixed(2) || null,
        cpc: current.cpc?.toFixed(2) || null
      },
      previous: previous ? {
        ...previous,
        cpl: previous.cpl?.toFixed(2) || null,
        ctr: previous.ctr?.toFixed(2) || null,
        cpm: previous.cpm?.toFixed(2) || null,
        cpc: previous.cpc?.toFixed(2) || null,
        period: compare === 'previous_same' ? {
          start: new Date(new Date(currentStart).getTime() - periodDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          end: new Date(new Date(currentStart).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        } : null
      } : null,
      delta: delta ? {
        spend_pct: delta.spend_pct?.toFixed(1) || null,
        leads_pct: delta.leads_pct?.toFixed(1) || null,
        cpl_pct: delta.cpl_pct?.toFixed(1) || null,
        ctr_pct: delta.ctr_pct?.toFixed(1) || null,
        cpm_pct: delta.cpm_pct?.toFixed(1) || null
      } : null,
      analysis: {
        target_cpl: targetCpl,
        cpl_vs_target_pct: cplVsTargetPct?.toFixed(1) || null,
        cpl_status: cplStatus,
        is_small_sample: isSmallSample
      },
      source: 'rollup'
    };
  },

  /**
   * Get leads engagement rate (2+ messages)
   * Quality metric for lead quality assessment
   */
  async getLeadsEngagementRate({ direction_id, period = 'last_7d' }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    const periodDays = {
      'last_3d': 3,
      'last_7d': 7,
      'last_14d': 14,
      'last_30d': 30
    }[period] || 7;

    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

    // Get leads for the period
    let leadsQuery = supabase
      .from('leads')
      .select('id, chat_id')
      .eq('user_account_id', userAccountId)
      .gte('created_at', since);

    if (dbAccountId) {
      leadsQuery = leadsQuery.eq('account_id', dbAccountId);
    }
    if (direction_id) {
      leadsQuery = leadsQuery.eq('direction_id', direction_id);
    }

    const { data: leads, error: leadsError } = await leadsQuery;

    if (leadsError) {
      return { success: false, error: leadsError.message };
    }

    const totalLeads = leads?.length || 0;

    if (totalLeads === 0) {
      return {
        success: true,
        period,
        leads_total: 0,
        leads_with_2plus_msgs: 0,
        engagement_rate: 0,
        source: 'no_leads'
      };
    }

    // Get chat_ids
    const chatIds = leads.map(l => l.chat_id).filter(Boolean);

    if (chatIds.length === 0) {
      return {
        success: true,
        period,
        leads_total: totalLeads,
        leads_with_2plus_msgs: 0,
        engagement_rate: 0,
        source: 'no_chat_ids'
      };
    }

    // Count messages per chat from dialogs table
    let dialogsQuery = supabase
      .from('dialogs')
      .select('id, phone, messages_count')
      .eq('user_account_id', userAccountId)
      .in('phone', chatIds);

    if (dbAccountId) {
      dialogsQuery = dialogsQuery.eq('account_id', dbAccountId);
    }

    const { data: dialogs } = await dialogsQuery;

    // Count leads with 2+ messages
    let leadsWithEngagement = 0;
    const engagedChatIds = new Set();

    for (const dialog of dialogs || []) {
      if ((dialog.messages_count || 0) >= 2) {
        engagedChatIds.add(dialog.phone);
      }
    }

    leadsWithEngagement = leads.filter(l => engagedChatIds.has(l.chat_id)).length;

    const engagementRate = totalLeads > 0 ? (leadsWithEngagement / totalLeads) * 100 : 0;

    return {
      success: true,
      period,
      leads_total: totalLeads,
      leads_with_2plus_msgs: leadsWithEngagement,
      engagement_rate: engagementRate.toFixed(1),
      source: 'dialogs'
    };
  },

  /**
   * Competitor analysis from Facebook Ad Library
   * Returns insights about competitor ads (graceful fallback if not configured)
   */
  async competitorAnalysis({ direction_id, keywords }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Get direction for context
    const { data: direction } = await supabase
      .from('account_directions')
      .select('id, name')
      .eq('id', direction_id)
      .single();

    // Check if competitor tracking is configured
    // For now, return graceful fallback since this requires separate setup
    const { data: competitorConfig } = await supabase
      .from('user_settings')
      .select('competitor_tracking_enabled')
      .eq('user_account_id', userAccountId)
      .single();

    if (!competitorConfig?.competitor_tracking_enabled) {
      return {
        success: true,
        status: 'not_configured',
        message: 'Отслеживание конкурентов не настроено',
        direction: direction?.name,
        setup_guide: 'Для включения анализа конкурентов добавьте ключевые слова в настройках или используйте параметр keywords',
        recommendations: [
          'Настройте ключевые слова для отслеживания конкурентов',
          'Используйте Facebook Ad Library напрямую: https://www.facebook.com/ads/library'
        ]
      };
    }

    // If configured, fetch from competitor_ads table (pre-collected data)
    let competitorQuery = supabase
      .from('competitor_ads')
      .select('*')
      .eq('user_account_id', userAccountId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (dbAccountId) {
      competitorQuery = competitorQuery.eq('account_id', dbAccountId);
    }
    if (direction_id) {
      competitorQuery = competitorQuery.eq('direction_id', direction_id);
    }

    const { data: competitorAds } = await competitorQuery;

    if (!competitorAds || competitorAds.length === 0) {
      return {
        success: true,
        status: 'no_data',
        message: 'Нет данных о конкурентах за последний период',
        direction: direction?.name,
        recommendations: ['Проверьте настройки отслеживания', 'Добавьте больше ключевых слов']
      };
    }

    // Group by competitor
    const byCompetitor = {};
    for (const ad of competitorAds) {
      const key = ad.competitor_name || 'Unknown';
      if (!byCompetitor[key]) {
        byCompetitor[key] = { ads: [], creativeTypes: new Set(), angles: [] };
      }
      byCompetitor[key].ads.push(ad);
      if (ad.creative_type) byCompetitor[key].creativeTypes.add(ad.creative_type);
      if (ad.angle) byCompetitor[key].angles.push(ad.angle);
    }

    const insights = Object.entries(byCompetitor).map(([name, data]) => ({
      competitor: name,
      ad_count: data.ads.length,
      creative_types: Array.from(data.creativeTypes),
      top_angles: [...new Set(data.angles)].slice(0, 3)
    }));

    return {
      success: true,
      status: 'success',
      direction: direction?.name,
      competitors_found: insights.length,
      ads_analyzed: competitorAds.length,
      insights,
      recommendations: [
        insights.length > 0 ? `Конкуренты активно используют: ${insights[0].creative_types.join(', ')}` : null,
        'Проанализируйте успешные форматы конкурентов'
      ].filter(Boolean)
    };
  }
};
