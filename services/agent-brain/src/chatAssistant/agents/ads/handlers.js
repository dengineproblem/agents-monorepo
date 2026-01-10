/**
 * AdsAgent Handlers - Facebook/Instagram Advertising
 * Tool execution handlers for advertising operations
 */

import { fbGraph } from '../../shared/fbGraph.js';
import { getDateRange } from '../../shared/dateUtils.js';
import { supabase } from '../../../lib/supabaseClient.js';
import { adsDryRunHandlers } from '../../shared/dryRunHandlers.js';

/**
 * Get date range with date_from/date_to support
 * date_from/date_to have priority over period
 */
function getDateRangeWithDates({ date_from, date_to, period }) {
  if (date_from) {
    return {
      since: date_from,
      until: date_to || new Date().toISOString().split('T')[0]
    };
  }
  return getDateRange(period || 'last_7d');
}
import {
  verifyCampaignStatus,
  verifyAdSetStatus,
  verifyAdSetBudget,
  verifyDirectionStatus
} from '../../shared/postCheck.js';
import { attachRefs, buildEntityMap } from '../../shared/entityLinker.js';
import { getUsdToKzt } from '../../shared/currencyRate.js';
import { logger } from '../../../lib/logger.js';
import {
  formatSummary,
  formatContext,
  formatProposal,
  generateTextReport
} from '../../shared/reportFormatter.js';

export const adsHandlers = {
  // ============================================================
  // READ HANDLERS
  // ============================================================

  async getCampaigns({ period, date_from, date_to, status }, { accessToken, adAccountId }) {
    const dateRange = getDateRangeWithDates({ date_from, date_to, period });

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

      // Count leads from ALL sources like dashboard:
      // - messaging leads (WhatsApp/Instagram conversations)
      // - site leads (pixel events)
      // - lead form leads (Facebook Instant Forms)
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
            // Custom conversions - only if no fb_pixel_lead to avoid duplication
            siteLeads = parseInt(action.value || '0', 10);
          } else if (action.action_type === 'onsite_conversion.lead_grouped') {
            // Facebook Lead Forms - only onsite_conversion.lead_grouped
            // DON'T count 'lead' - it's an aggregate that duplicates pixel_lead for site campaigns
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

  async getAdSets({ campaign_id, period, date_from, date_to }, { accessToken }) {
    const dateRange = getDateRangeWithDates({ date_from, date_to, period });
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

      // Count leads from ALL sources like dashboard:
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
            // Custom conversions - only if no fb_pixel_lead to avoid duplication
            siteLeads = parseInt(action.value || '0', 10);
          } else if (action.action_type === 'onsite_conversion.lead_grouped') {
            // Facebook Lead Forms - only onsite_conversion.lead_grouped
            // DON'T count 'lead' - it's an aggregate that duplicates pixel_lead for site campaigns
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

  async getAds({ campaign_id, period, date_from, date_to }, { accessToken, adAccountId }) {
    console.log('[getAds] adAccountId from context:', adAccountId);
    const dateRange = getDateRangeWithDates({ date_from, date_to, period });

    // Определяем endpoint: кампания или весь аккаунт
    const normalizedAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const endpoint = campaign_id ? `${campaign_id}/ads` : `${normalizedAccountId}/ads`;

    const fields = 'id,name,status,effective_status,campaign{id,name}';

    // Получаем список объявлений
    console.log('[getAds] endpoint:', endpoint, 'campaign_id:', campaign_id || 'ALL');
    const result = await fbGraph('GET', endpoint, accessToken, {
      fields,
      limit: 500
    });

    console.log('[getAds] Got', result.data?.length || 0, 'ads from FB');

    if (!result.data || result.data.length === 0) {
      return { success: true, ads: [], totals: { spend: 0, leads: 0, cpl: null } };
    }

    // Получаем insights для всех объявлений
    const adIds = result.data.map(ad => ad.id);
    const insightsResult = await fbGraph('GET', `${normalizedAccountId}/insights`, accessToken, {
      level: 'ad',
      fields: 'ad_id,ad_name,spend,impressions,clicks,actions',
      time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until }),
      filtering: JSON.stringify([{ field: 'ad.id', operator: 'IN', value: adIds }]),
      limit: 500
    });

    // Создаём map insights по ad_id
    console.log('[getAds] Got', insightsResult.data?.length || 0, 'insights from FB for', adIds.length, 'ads');
    const insightsMap = {};
    for (const insight of (insightsResult.data || [])) {
      insightsMap[insight.ad_id] = insight;
    }

    let totalSpend = 0;
    let totalLeads = 0;

    const ads = result.data.map(ad => {
      const insights = insightsMap[ad.id] || {};
      const spend = parseFloat(insights.spend || 0);

      // Count leads from ALL sources
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
            // Custom conversions - only if no fb_pixel_lead to avoid duplication
            siteLeads = parseInt(action.value || '0', 10);
          } else if (action.action_type === 'onsite_conversion.lead_grouped') {
            // Facebook Lead Forms - only onsite_conversion.lead_grouped
            // DON'T count 'lead' - it's an aggregate that duplicates pixel_lead for site campaigns
            leadFormLeads = parseInt(action.value || '0', 10);
          }
        }
      }

      const leads = messagingLeads + siteLeads + leadFormLeads;
      totalSpend += spend;
      totalLeads += leads;

      return {
        id: ad.id,
        name: insights.ad_name || ad.name,
        status: ad.effective_status || ad.status,
        campaign_id: ad.campaign?.id || null,
        campaign_name: ad.campaign?.name || null,
        spend: spend.toFixed(2),
        leads,
        cpl: leads > 0 ? (spend / leads).toFixed(2) : null,
        impressions: parseInt(insights.impressions || 0),
        clicks: parseInt(insights.clicks || 0)
      };
    }).filter(ad => parseFloat(ad.spend) > 0 || ad.leads > 0); // Только с активностью

    console.log('[getAds] After filter:', ads.length, 'ads with activity. Total spend:', totalSpend.toFixed(2), 'leads:', totalLeads);

    // Агрегация по кампаниям для LLM (чтобы не терялись данные в большом списке)
    const campaignStats = {};
    for (const ad of ads) {
      const cid = ad.campaign_id || 'unknown';
      const cname = ad.campaign_name || 'Без кампании';
      if (!campaignStats[cid]) {
        campaignStats[cid] = { campaign_id: cid, campaign_name: cname, spend: 0, leads: 0, ads_count: 0 };
      }
      campaignStats[cid].spend += parseFloat(ad.spend);
      campaignStats[cid].leads += ad.leads;
      campaignStats[cid].ads_count += 1;
    }

    const campaigns_summary = Object.values(campaignStats).map(c => ({
      ...c,
      spend: c.spend.toFixed(2),
      cpl: c.leads > 0 ? (c.spend / c.leads).toFixed(2) : null
    }));

    console.log('[getAds] campaigns_summary:', JSON.stringify(campaigns_summary));

    return {
      success: true,
      // Все объявления с активностью (сортировка по тратам)
      ads: ads.sort((a, b) => parseFloat(b.spend) - parseFloat(a.spend)),
      // Сводка по кампаниям для контекста
      campaigns_summary,
      totals: {
        spend: totalSpend.toFixed(2),
        leads: totalLeads,
        cpl: totalLeads > 0 ? (totalSpend / totalLeads).toFixed(2) : null,
        campaigns_count: campaigns_summary.length,
        ads_count: ads.length
      },
      period: { since: dateRange.since, until: dateRange.until }
    };
  },

  async getSpendReport({ period, date_from, date_to, group_by }, { accessToken, adAccountId }) {
    const dateRange = getDateRangeWithDates({ date_from, date_to, period });

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
      // - lead form leads (Facebook Instant Forms)
      let messagingLeads = 0;
      let siteLeads = 0;
      let leadFormLeads = 0;

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
          // Custom pixel conversions - only if no fb_pixel_lead to avoid duplication
          else if (!siteLeads && typeof action.action_type === 'string' && action.action_type.startsWith('offsite_conversion.custom')) {
            siteLeads = parseInt(action.value || '0', 10);
          }
          // Facebook Lead Forms - only onsite_conversion.lead_grouped
          // DON'T count 'lead' - it's an aggregate that duplicates pixel_lead for site campaigns
          else if (action.action_type === 'onsite_conversion.lead_grouped') {
            leadFormLeads = parseInt(action.value || '0', 10);
          }
        }
      }

      const totalLeads = messagingLeads + siteLeads + leadFormLeads;

      return {
        date: row.date_start,
        spend: parseFloat(row.spend || 0),
        leads: totalLeads,
        messagingLeads,
        siteLeads,
        leadFormLeads,
        impressions: parseInt(row.impressions || 0),
        clicks: parseInt(row.clicks || 0)
      };
    });

    const totalSpend = data.reduce((sum, d) => sum + d.spend, 0);
    const totalLeads = data.reduce((sum, d) => sum + d.leads, 0);
    const totalMessagingLeads = data.reduce((sum, d) => sum + d.messagingLeads, 0);
    const totalSiteLeads = data.reduce((sum, d) => sum + d.siteLeads, 0);
    const totalLeadFormLeads = data.reduce((sum, d) => sum + d.leadFormLeads, 0);

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
        leadFormLeads: totalLeadFormLeads,
        cpl: totalLeads > 0 ? (totalSpend / totalLeads).toFixed(2) : null
      }
    };
  },

  // ============================================================
  // WRITE HANDLERS - AdSets & Ads
  // ============================================================

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

  async pauseAd({ ad_id, reason, dry_run }, { accessToken, adAccountId }) {
    // Get current status before change
    let beforeStatus = null;
    try {
      const current = await fbGraph('GET', ad_id, accessToken, { fields: 'status,name' });
      beforeStatus = current.status;
    } catch (e) { /* ignore */ }

    if (dry_run) {
      return {
        success: true,
        dry_run: true,
        preview: {
          ad_id,
          current_status: beforeStatus,
          action: 'pause',
          new_status: 'PAUSED'
        },
        warning: 'Объявление будет поставлено на паузу. Используй dry_run: false для выполнения.'
      };
    }

    await fbGraph('POST', ad_id, accessToken, { status: 'PAUSED' });

    // Verify status change
    let afterStatus = null;
    try {
      const after = await fbGraph('GET', ad_id, accessToken, { fields: 'status' });
      afterStatus = after.status;
    } catch (e) { /* ignore */ }

    const verified = afterStatus === 'PAUSED';

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Ad ${ad_id} paused via Chat Assistant`,
      context: {
        reason,
        source: 'chat_assistant',
        agent: 'AdsAgent',
        verified,
        before: beforeStatus,
        after: afterStatus
      }
    });

    return {
      success: true,
      message: `Объявление ${ad_id} поставлено на паузу`,
      verification: {
        verified,
        before: beforeStatus,
        after: afterStatus,
        warning: !verified ? 'Статус не подтверждён — проверьте вручную' : null
      }
    };
  },

  async resumeAd({ ad_id }, { accessToken, adAccountId }) {
    // Get current status before change
    let beforeStatus = null;
    try {
      const current = await fbGraph('GET', ad_id, accessToken, { fields: 'status' });
      beforeStatus = current.status;
    } catch (e) { /* ignore */ }

    await fbGraph('POST', ad_id, accessToken, { status: 'ACTIVE' });

    // Verify status change
    let afterStatus = null;
    try {
      const after = await fbGraph('GET', ad_id, accessToken, { fields: 'status' });
      afterStatus = after.status;
    } catch (e) { /* ignore */ }

    const verified = afterStatus === 'ACTIVE';

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Ad ${ad_id} resumed via Chat Assistant`,
      context: {
        source: 'chat_assistant',
        agent: 'AdsAgent',
        verified,
        before: beforeStatus,
        after: afterStatus
      }
    });

    return {
      success: true,
      message: `Объявление ${ad_id} возобновлено`,
      verification: {
        verified,
        before: beforeStatus,
        after: afterStatus,
        warning: !verified ? 'Статус не подтверждён — проверьте вручную' : null
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

  /**
   * Create AdSet in campaign with creatives
   * Uses direction settings for targeting
   */
  async createAdSet({ direction_id, creative_ids, daily_budget_cents, adset_name, dry_run }, { accessToken, adAccountId, userAccountId, pageId }) {
    // 1. Get direction with campaign_id and settings
    const { data: direction, error: dirError } = await supabase
      .from('account_directions')
      .select('id, name, fb_campaign_id, objective, daily_budget_cents, pixel_id')
      .eq('id', direction_id)
      .single();

    if (dirError || !direction) {
      return { success: false, error: `Направление не найдено: ${dirError?.message || 'not found'}` };
    }

    if (!direction.fb_campaign_id) {
      return { success: false, error: 'У направления нет привязанной FB кампании' };
    }

    // 2. Get direction settings for targeting
    const { data: settings, error: settingsError } = await supabase
      .from('default_ad_settings')
      .select('*')
      .eq('direction_id', direction_id)
      .maybeSingle();

    if (settingsError || !settings) {
      return { success: false, error: `Настройки таргетинга не настроены для направления: ${settingsError?.message || 'not configured'}` };
    }

    // 3. Get creatives
    const { data: creatives, error: creativesError } = await supabase
      .from('user_creatives')
      .select('id, title, fb_creative_id_whatsapp, fb_creative_id_instagram_traffic, fb_creative_id_site_leads, fb_creative_id_lead_forms')
      .in('id', creative_ids)
      .eq('user_id', userAccountId)
      .eq('status', 'ready');

    if (creativesError || !creatives || creatives.length === 0) {
      return { success: false, error: `Креативы не найдены или не готовы: ${creativesError?.message || 'no valid creatives'}` };
    }

    // 4. Build targeting
    const targeting = {
      age_min: 18,
      age_max: 65,
      targeting_automation: { advantage_audience: 1 }
    };

    if (settings.gender && settings.gender !== 'all') {
      targeting.genders = settings.gender === 'male' ? [1] : [2];
    }

    if (settings.cities && Array.isArray(settings.cities) && settings.cities.length > 0) {
      const countries = [];
      const cities = [];
      for (const item of settings.cities) {
        if (typeof item === 'string' && item.length === 2 && item === item.toUpperCase()) {
          countries.push(item);
        } else {
          cities.push(String(item));
        }
      }
      targeting.geo_locations = {};
      if (countries.length > 0) targeting.geo_locations.countries = countries;
      if (cities.length > 0) targeting.geo_locations.cities = cities.map(id => ({ key: id }));
    }

    // 5. Get optimization_goal and billing_event based on objective
    const objectiveMap = {
      whatsapp: { optimization_goal: 'CONVERSATIONS', billing_event: 'IMPRESSIONS', destination_type: 'WHATSAPP' },
      instagram_traffic: { optimization_goal: 'LINK_CLICKS', billing_event: 'IMPRESSIONS', destination_type: 'INSTAGRAM_PROFILE' },
      site_leads: { optimization_goal: 'OFFSITE_CONVERSIONS', billing_event: 'IMPRESSIONS', destination_type: 'WEBSITE' },
      lead_forms: { optimization_goal: 'LEAD_GENERATION', billing_event: 'IMPRESSIONS', destination_type: 'ON_AD' }
    };
    const objectiveSettings = objectiveMap[direction.objective] || objectiveMap.whatsapp;

    // 6. Build promoted_object
    let promoted_object = {};
    if (direction.objective === 'whatsapp') {
      promoted_object = { page_id: pageId };
    } else if (direction.objective === 'instagram_traffic') {
      promoted_object = { page_id: pageId };
    } else if (direction.objective === 'site_leads') {
      promoted_object = { custom_event_type: 'LEAD' };
      if (direction.pixel_id || settings.pixel_id) {
        promoted_object.pixel_id = String(direction.pixel_id || settings.pixel_id);
      }
    } else if (direction.objective === 'lead_forms') {
      // lead_gen_form_id НЕ добавляем в promoted_object - он передаётся только в креативе (call_to_action)
      promoted_object = { page_id: pageId };
    }

    const finalBudget = daily_budget_cents || direction.daily_budget_cents || 500;
    const finalName = adset_name || `${direction.name} - ${new Date().toISOString().split('T')[0]}`;

    // Dry-run mode
    if (dry_run) {
      return {
        success: true,
        dry_run: true,
        preview: {
          campaign_id: direction.fb_campaign_id,
          direction_id,
          direction_name: direction.name,
          adset_name: finalName,
          daily_budget: finalBudget / 100,
          targeting,
          objective: direction.objective,
          optimization_goal: objectiveSettings.optimization_goal,
          creatives_count: creatives.length,
          creatives: creatives.map(c => ({ id: c.id, title: c.title }))
        },
        message: `Будет создан адсет "${finalName}" с бюджетом $${(finalBudget / 100).toFixed(2)}/день и ${creatives.length} объявлениями`
      };
    }

    // 7. Create AdSet via FB Graph API
    const actId = adAccountId?.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    const adsetBody = {
      name: finalName,
      campaign_id: direction.fb_campaign_id,
      daily_budget: finalBudget,
      billing_event: objectiveSettings.billing_event,
      optimization_goal: objectiveSettings.optimization_goal,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting,
      status: 'ACTIVE',
      destination_type: objectiveSettings.destination_type,
      promoted_object
    };

    let adsetResult;
    try {
      adsetResult = await fbGraph('POST', `${actId}/adsets`, accessToken, adsetBody);
    } catch (fbError) {
      logger.error({ err: fbError, direction_id, adsetBody }, 'createAdSet: FB API error');
      return { success: false, error: `Ошибка создания адсета: ${fbError.message}` };
    }

    const adsetId = adsetResult.id;
    logger.info({ adsetId, direction_id, creativesCount: creatives.length }, 'createAdSet: adset created');

    // 8. Create Ads for each creative
    const createdAds = [];
    for (const creative of creatives) {
      const creativeIdField = direction.objective === 'whatsapp' ? 'fb_creative_id_whatsapp'
        : direction.objective === 'instagram_traffic' ? 'fb_creative_id_instagram_traffic'
        : direction.objective === 'lead_forms' ? 'fb_creative_id_lead_forms'
        : 'fb_creative_id_site_leads';

      const fbCreativeId = creative[creativeIdField];
      if (!fbCreativeId) {
        logger.warn({ creativeId: creative.id, objective: direction.objective }, 'createAdSet: no FB creative ID for objective');
        continue;
      }

      try {
        const adResult = await fbGraph('POST', `${actId}/ads`, accessToken, {
          name: `Ad - ${creative.title}`,
          adset_id: adsetId,
          creative: { creative_id: fbCreativeId },
          status: 'ACTIVE'
        });

        createdAds.push({
          ad_id: adResult.id,
          name: `Ad - ${creative.title}`,
          creative_id: creative.id,
          creative_title: creative.title
        });

        // Save mapping for lead tracking
        await supabase.from('ad_creative_mapping').insert({
          ad_id: adResult.id,
          user_creative_id: creative.id,
          direction_id,
          user_id: userAccountId,
          adset_id: adsetId,
          campaign_id: direction.fb_campaign_id
        }).catch(() => {});

      } catch (adError) {
        logger.error({ err: adError, creativeId: creative.id }, 'createAdSet: failed to create ad');
      }
    }

    // Log action
    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `AdSet created: ${finalName} with ${createdAds.length} ads`,
      context: {
        adset_id: adsetId,
        direction_id,
        direction_name: direction.name,
        daily_budget_cents: finalBudget,
        ads_count: createdAds.length,
        source: 'chat_assistant',
        agent: 'AdsAgent'
      }
    });

    return {
      success: true,
      message: `Создан адсет "${finalName}" с ${createdAds.length} объявлениями`,
      adset_id: adsetId,
      adset_name: finalName,
      daily_budget: finalBudget / 100,
      ads_created: createdAds.length,
      ads: createdAds,
      direction_id,
      direction_name: direction.name,
      campaign_id: direction.fb_campaign_id
    };
  },

  /**
   * Create single Ad in existing AdSet
   */
  async createAd({ adset_id, creative_id, ad_name, dry_run }, { accessToken, adAccountId, userAccountId }) {
    // 1. Get creative
    const { data: creative, error: creativeError } = await supabase
      .from('user_creatives')
      .select('id, title, direction_id, fb_creative_id_whatsapp, fb_creative_id_instagram_traffic, fb_creative_id_site_leads, fb_creative_id_lead_forms')
      .eq('id', creative_id)
      .eq('user_id', userAccountId)
      .eq('status', 'ready')
      .single();

    if (creativeError || !creative) {
      return { success: false, error: `Креатив не найден или не готов: ${creativeError?.message || 'not found'}` };
    }

    // 2. Get adset to determine objective
    let adsetInfo;
    try {
      adsetInfo = await fbGraph('GET', adset_id, accessToken, { fields: 'id,name,campaign_id,optimization_goal' });
    } catch (fbError) {
      return { success: false, error: `Адсет не найден: ${fbError.message}` };
    }

    // Determine objective from optimization_goal
    const goalToObjective = {
      'CONVERSATIONS': 'whatsapp',
      'LINK_CLICKS': 'instagram_traffic',
      'OFFSITE_CONVERSIONS': 'site_leads',
      'LEAD_GENERATION': 'lead_forms'
    };
    const objective = goalToObjective[adsetInfo.optimization_goal] || 'whatsapp';

    // Get appropriate FB creative ID
    const creativeIdField = objective === 'whatsapp' ? 'fb_creative_id_whatsapp'
      : objective === 'instagram_traffic' ? 'fb_creative_id_instagram_traffic'
      : objective === 'lead_forms' ? 'fb_creative_id_lead_forms'
      : 'fb_creative_id_site_leads';

    const fbCreativeId = creative[creativeIdField];
    if (!fbCreativeId) {
      return { success: false, error: `У креатива нет FB creative ID для objective "${objective}"` };
    }

    const finalName = ad_name || `Ad - ${creative.title}`;

    // Dry-run mode
    if (dry_run) {
      return {
        success: true,
        dry_run: true,
        preview: {
          adset_id,
          adset_name: adsetInfo.name,
          ad_name: finalName,
          creative_id: creative.id,
          creative_title: creative.title,
          fb_creative_id: fbCreativeId,
          objective
        },
        message: `Будет создано объявление "${finalName}" в адсете "${adsetInfo.name}"`
      };
    }

    // 3. Create Ad
    const actId = adAccountId?.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    let adResult;
    try {
      adResult = await fbGraph('POST', `${actId}/ads`, accessToken, {
        name: finalName,
        adset_id,
        creative: { creative_id: fbCreativeId },
        status: 'ACTIVE'
      });
    } catch (fbError) {
      logger.error({ err: fbError, adset_id, creative_id }, 'createAd: FB API error');
      return { success: false, error: `Ошибка создания объявления: ${fbError.message}` };
    }

    // Save mapping
    await supabase.from('ad_creative_mapping').insert({
      ad_id: adResult.id,
      user_creative_id: creative.id,
      direction_id: creative.direction_id,
      user_id: userAccountId,
      adset_id,
      campaign_id: adsetInfo.campaign_id
    }).catch(() => {});

    // Log action
    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Ad created: ${finalName} in AdSet ${adsetInfo.name}`,
      context: {
        ad_id: adResult.id,
        adset_id,
        creative_id: creative.id,
        creative_title: creative.title,
        source: 'chat_assistant',
        agent: 'AdsAgent'
      }
    });

    return {
      success: true,
      message: `Создано объявление "${finalName}" в адсете "${adsetInfo.name}"`,
      ad_id: adResult.id,
      ad_name: finalName,
      adset_id,
      adset_name: adsetInfo.name,
      creative_id: creative.id,
      creative_title: creative.title
    };
  },

  // ============================================================
  // DIRECTIONS HANDLERS
  // ============================================================

  async getDirections({ status, period, date_from, date_to }, { userAccountId, adAccountId, adAccountDbId }) {
    // Note: period/date_from/date_to not used yet - directions don't have time-based metrics
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

  async getDirectionCreatives({ direction_id }, { userAccountId }) {
    // Get direction name for context
    const { data: direction, error: dirError } = await supabase
      .from('account_directions')
      .select('id, name')
      .eq('id', direction_id)
      .single();

    if (dirError) {
      return { success: false, error: dirError.message };
    }

    // Get creatives linked to this direction with metrics
    const { data: creatives, error } = await supabase
      .from('user_creatives')
      .select(`
        id,
        name,
        title,
        status,
        media_type,
        risk_score,
        performance_tier,
        created_at,
        updated_at
      `)
      .eq('direction_id', direction_id)
      .eq('user_id', userAccountId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      return { success: false, error: error.message };
    }

    // Count by status
    const statusCounts = {
      ready: 0,
      pending: 0,
      rejected: 0,
      archived: 0
    };
    for (const c of creatives || []) {
      if (statusCounts[c.status] !== undefined) {
        statusCounts[c.status]++;
      }
    }

    return {
      success: true,
      direction_id,
      direction_name: direction?.name,
      creatives: (creatives || []).map(c => ({
        id: c.id,
        name: c.name || c.title,
        status: c.status,
        media_type: c.media_type,
        risk_score: c.risk_score,
        performance_tier: c.performance_tier,
        created_at: c.created_at
      })),
      total: creatives?.length || 0,
      status_counts: statusCounts
    };
  },

  async getDirectionMetrics({ direction_id, period, date_from, date_to }, { adAccountId, userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Support date_from/date_to with priority over period
    let startDate, endDate;
    if (date_from) {
      startDate = date_from;
      endDate = date_to || new Date().toISOString().split('T')[0];
    } else {
      const days = { '7d': 7, '14d': 14, '30d': 30, '90d': 90, '6m': 180, '12m': 365 }[period] || 7;
      startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      endDate = new Date().toISOString().split('T')[0];
    }

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

  async resumeDirection({ direction_id }, { adAccountId, accessToken }) {
    // Get direction with fb_campaign_id
    const { data: direction, error: fetchError } = await supabase
      .from('account_directions')
      .select('id, name, fb_campaign_id')
      .eq('id', direction_id)
      .single();

    if (fetchError) {
      return { success: false, error: fetchError.message };
    }

    // Update direction status (is_active = true)
    const { error: updateError } = await supabase
      .from('account_directions')
      .update({ is_active: true, campaign_status: 'ACTIVE', updated_at: new Date().toISOString() })
      .eq('id', direction_id);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Resume FB campaign if linked
    let fbResumed = false;
    if (direction.fb_campaign_id && accessToken) {
      try {
        await fbGraph('POST', direction.fb_campaign_id, accessToken, { status: 'ACTIVE' });
        fbResumed = true;
      } catch (e) {
        // Log but don't fail
      }
    }

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Direction resumed: ${direction.name}`,
      context: { direction_id, fb_resumed: fbResumed, source: 'chat_assistant', agent: 'AdsAgent' }
    });

    return {
      success: true,
      message: `Направление "${direction.name}" возобновлено${fbResumed ? ' (включая FB кампанию)' : ''}`
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
  async getROIReport({ period, date_from, date_to, direction_id, media_type, group_by }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Support date_from/date_to with priority over period
    let since, until;
    if (date_from) {
      since = date_from;
      until = date_to || new Date().toISOString().split('T')[0];
    } else {
      // Period to days
      const periodDays = {
        'today': 1,
        'yesterday': 1,
        'last_3d': 3,
        'last_7d': 7,
        'last_14d': 14,
        'last_30d': 30,
        'last_90d': 90,
        'last_6m': 180,
        'last_12m': 365,
        'all': null
      }[period] || null;

      since = (() => {
        if (!periodDays) return null;
        const d = new Date();
        d.setDate(d.getDate() - periodDays);
        d.setHours(0, 0, 0, 0);
        return d.toISOString().split('T')[0];
      })();
      until = new Date().toISOString().split('T')[0];
    }

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
  async getROIComparison({ period, date_from, date_to, compare_by, top_n = 5 }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Support date_from/date_to with priority over period
    let since, until;
    if (date_from) {
      since = date_from;
      until = date_to || new Date().toISOString().split('T')[0];
    } else {
      // Period to days (null = all time)
      const periodDays = {
        'today': 1,
        'yesterday': 1,
        'last_3d': 3,
        'last_7d': 7,
        'last_14d': 14,
        'last_30d': 30,
        'last_90d': 90,
        'last_6m': 180,
        'last_12m': 365,
        'all': null
      }[period || 'all'] || null;

      since = (() => {
        if (!periodDays) return null; // all time - no filter
        const d = new Date();
        d.setDate(d.getDate() - periodDays);
        d.setHours(0, 0, 0, 0);
        return d.toISOString().split('T')[0];
      })();
      until = new Date().toISOString().split('T')[0];
    }

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
  async getAgentBrainActions({ period, date_from, date_to, limit, action_type }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Calculate date range - prefer explicit dates over period
    let sinceDate, untilDate;

    if (date_from) {
      // Use explicit date range
      sinceDate = new Date(date_from + 'T00:00:00Z').toISOString();
      untilDate = date_to ? new Date(date_to + 'T23:59:59Z').toISOString() : new Date().toISOString();
    } else {
      // Use preset period
      const periodDays = {
        'last_1d': 1,
        'last_3d': 3,
        'last_7d': 7
      }[period] || 3;
      sinceDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
      untilDate = null; // no upper limit
    }

    // Query brain_executions
    let query = supabase
      .from('brain_executions')
      .select('id, actions_json, plan_json, created_at, status, execution_mode')
      .eq('user_account_id', userAccountId)
      .gte('created_at', sinceDate)
      .order('created_at', { ascending: false })
      .limit(10); // Max 10 executions, then filter actions

    // Add upper bound if explicit date range
    if (untilDate) {
      query = query.lte('created_at', untilDate);
    }

    if (dbAccountId) {
      query = query.eq('account_id', dbAccountId);
    }

    const { data: executions, error } = await query;

    if (error) {
      return { success: false, error: error.message };
    }

    // Format period for response
    const periodDescription = date_from
      ? `${date_from} - ${date_to || 'сегодня'}`
      : period || 'last_3d';

    if (!executions || executions.length === 0) {
      return {
        success: true,
        period: periodDescription,
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
  async triggerBrainOptimizationRun({ direction_id, campaign_id, dry_run, reason }, { userAccountId, adAccountId, adAccountDbId, accessToken }) {
    const dbAccountId = adAccountDbId || null;

    // Логируем входящие параметры
    logger.info({
      where: 'triggerBrainOptimizationRun',
      phase: 'start',
      userAccountId,
      adAccountId,
      adAccountDbId,
      direction_id: direction_id || null,
      campaign_id: campaign_id || null,
      dry_run,
      reason,
      message: campaign_id
        ? `Запуск Brain Mini для кампании ${campaign_id}`
        : direction_id
          ? `Запуск Brain Mini для направления ${direction_id}`
          : 'Запуск Brain Mini для всего аккаунта'
    });

    // ========================================
    // INTERACTIVE MODE: Generate proposals (dry_run=true или false)
    // runInteractiveBrain ВСЕГДА только генерирует proposals БЕЗ исполнения
    // dry_run влияет только на отображение в UI
    // ========================================
    try {
      const { runInteractiveBrain } = await import('../../../scoring.js');

      // ========================================
      // МУЛЬТИАККАУНТНОСТЬ: Консистентно с основным Brain (server.js)
      // Проверяем multi_account_enabled и загружаем credentials из ad_accounts
      // ========================================
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('id, ad_account_id, access_token, multi_account_enabled')
        .eq('id', userAccountId)
        .single();

      if (userError || !userAccount) {
        return { success: false, error: 'Не удалось получить данные пользователя' };
      }

      // Определяем credentials в зависимости от режима
      let finalAdAccountId = userAccount.ad_account_id;
      let finalAccessToken = accessToken || userAccount.access_token;
      let accountUUID = null;

      // Мультиаккаунтный режим: загружаем из ad_accounts
      if (userAccount.multi_account_enabled && adAccountDbId) {
        const { data: adAccount, error: adAccountError } = await supabase
          .from('ad_accounts')
          .select('id, access_token, ad_account_id')
          .eq('id', adAccountDbId)
          .eq('user_account_id', userAccountId)
          .single();

        if (adAccountError || !adAccount) {
          logger.error({
            where: 'triggerBrainOptimizationRun',
            error: 'Ad account not found',
            adAccountDbId,
            userAccountId,
            details: adAccountError?.message
          });
          return { success: false, error: `Рекламный аккаунт не найден: ${adAccountDbId}` };
        }

        // Переопределяем credentials из ad_accounts
        finalAdAccountId = adAccount.ad_account_id;
        finalAccessToken = accessToken || adAccount.access_token;
        accountUUID = adAccount.id;

        logger.info({
          where: 'triggerBrainOptimizationRun',
          phase: 'multi_account_mode',
          userAccountId,
          adAccountDbId,
          finalAdAccountId,
          accountUUID
        });
      } else {
        logger.info({
          where: 'triggerBrainOptimizationRun',
          phase: 'legacy_mode',
          userAccountId,
          finalAdAccountId: userAccount.ad_account_id
        });
      }

      if (!finalAccessToken) {
        return { success: false, error: 'Access token не доступен' };
      }

      if (!finalAdAccountId) {
        return { success: false, error: 'Ad account ID не найден' };
      }

      // Run interactive brain с правильными credentials
      const result = await runInteractiveBrain(
        {
          ad_account_id: finalAdAccountId,
          access_token: finalAccessToken,
          id: userAccountId,
          account_uuid: accountUUID  // Передаём UUID для фильтрации по аккаунту
        },
        {
          directionId: direction_id,
          campaignId: campaign_id,  // Facebook campaign ID для фильтрации по кампании
          supabase,
          logger,
          accountUUID  // Также передаём в options для directions
        }
      );

      // Log the action
      await supabase.from('agent_logs').insert({
        ad_account_id: adAccountId,
        level: 'info',
        message: `Brain interactive analysis completed: ${result.proposals?.length || 0} proposals`,
        context: {
          direction_id,
          reason,
          proposals_count: result.proposals?.length || 0,
          source: 'chat_assistant',
          agent: 'AdsAgent',
          mode: 'interactive'
        }
      });

      // Transform proposals to Plan format for frontend
      const plan = result.proposals?.length > 0 ? {
        description: `Brain Agent предлагает ${result.proposals.length} действий для оптимизации на основе сегодняшних данных`,
        steps: result.proposals.map(p => ({
          action: p.action,
          params: {
            entity_type: p.entity_type,
            entity_id: p.entity_id,
            entity_name: p.entity_name,
            direction_id: p.direction_id,
            // Map entity_id to specific ID fields for tool handlers
            ...(p.entity_type === 'adset' && { adset_id: p.entity_id }),
            ...(p.entity_type === 'ad' && { ad_id: p.entity_id }),
            ...(p.entity_type === 'campaign' && { campaign_id: p.entity_id }),
            ...p.suggested_action_params
          },
          description: p.reason,
          priority: p.priority,
          health_score: p.health_score,
          hs_class: p.hs_class,
          metrics: p.metrics
        })),
        requires_approval: true,
        estimated_impact: result.summary
          ? `Сегодня: $${result.summary.today_total_spend} расход, ${result.summary.today_total_leads} лидов. Анализ ${result.summary.total_adsets_analyzed} адсетов.`
          : 'Оптимизация бюджетов на основе Health Score'
      } : null;

      // Return proposals for user confirmation
      // Форматируем данные для человекочитаемого отчёта
      const proposalsCount = result.proposals?.length || 0;
      const adsetsCount = result.summary?.total_adsets_analyzed || 0;

      // Человекочитаемое сообщение (без технических деталей)
      const humanMessage = proposalsCount > 0
        ? `Brain Agent предлагает ${proposalsCount} ${proposalsCount === 1 ? 'действие' : proposalsCount < 5 ? 'действия' : 'действий'} для оптимизации. Проанализировано ${adsetsCount} ${adsetsCount === 1 ? 'группа' : adsetsCount < 5 ? 'группы' : 'групп'}.`
        : `Brain Agent не нашёл действий для оптимизации. Проанализировано ${adsetsCount} ${adsetsCount === 1 ? 'группа' : adsetsCount < 5 ? 'группы' : 'групп'}.`;

      // Форматированный отчёт для пользователя
      const formattedReport = {
        summary: formatSummary(result.summary),
        context: formatContext(result.context),
        proposals: result.proposals?.map(formatProposal) || [],
        // Генерируем текстовый отчёт
        text: generateTextReport({
          proposals: result.proposals,
          summary: result.summary,
          context: result.context,
          message: humanMessage
        })
      };

      return {
        success: true,
        mode: 'interactive',
        dry_run: !!dry_run,
        message: humanMessage,
        proposals: result.proposals || [],
        plan,  // Plan в формате frontend
        // Форматированные данные для UI
        formatted: formattedReport,
        // Технические данные (для отладки, можно скрыть в UI)
        _debug: {
          summary: result.summary,
          adset_analysis: result.adset_analysis,
          context: result.context
        },
        instructions: proposalsCount > 0
          ? 'Подтвердите план для выполнения действий.'
          : null
      };

    } catch (brainError) {
      logger.error({ err: brainError, userAccountId }, 'triggerBrainOptimizationRun: interactive brain failed');

      // Fallback to legacy mode if interactive fails
      const executionId = crypto.randomUUID();

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
            reason: reason || 'Manual trigger via Chat Assistant (fallback)',
            direction_id: direction_id || null,
            triggered_at: new Date().toISOString(),
            interactive_failed: true,
            interactive_error: String(brainError)
          }
        });

      if (insertError) {
        return { success: false, error: `Не удалось создать запись выполнения: ${insertError.message}` };
      }

      await supabase.from('agent_logs').insert({
        ad_account_id: adAccountId,
        level: 'warn',
        message: `Brain interactive mode failed, falling back to async execution`,
        context: {
          execution_id: executionId,
          direction_id,
          reason,
          error: String(brainError),
          source: 'chat_assistant',
          agent: 'AdsAgent'
        }
      });

      return {
        success: true,
        message: 'Brain Agent оптимизация запущена в фоновом режиме (interactive mode недоступен)',
        execution_id: executionId,
        note: 'Результаты будут доступны через getAgentBrainActions через несколько минут',
        fallback: true
      };
    }
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
  async getDirectionInsights({ direction_id, period, date_from, date_to, compare }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Support date_from/date_to with priority over period
    let currentStart, currentEnd, periodDays;
    const now = new Date();

    if (date_from) {
      currentStart = date_from;
      currentEnd = date_to || now.toISOString().split('T')[0];
      // Calculate days for comparison period
      periodDays = Math.ceil((new Date(currentEnd) - new Date(currentStart)) / (24 * 60 * 60 * 1000));
    } else {
      // Parse period
      periodDays = {
        'today': 1,
        'yesterday': 1,
        'last_3d': 3,
        'last_7d': 7,
        'last_14d': 14,
        'last_30d': 30,
        'last_90d': 90,
        'last_6m': 180,
        'last_12m': 365
      }[period || 'last_3d'] || 3;

      currentEnd = now.toISOString().split('T')[0];
      currentStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }

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
   * Get leads engagement rate (2+ messages) from Facebook API
   * Uses onsite_conversion.messaging_user_depth_2_message_send action type
   * Same logic as dashboard SummaryStats.tsx
   */
  async getLeadsEngagementRate({ direction_id, period, date_from, date_to }, { userAccountId, adAccountId, adAccountDbId, accessToken }) {
    // Support date_from/date_to with priority over period
    let dateRange;
    if (date_from) {
      dateRange = {
        since: date_from,
        until: date_to || new Date().toISOString().split('T')[0]
      };
    } else {
      dateRange = getDateRange(period || 'last_7d');
    }

    // If direction_id specified, get campaigns for that direction
    let campaignFilter = null;
    if (direction_id) {
      const { data: directionCampaigns } = await supabase
        .from('direction_campaigns')
        .select('campaign_id')
        .eq('direction_id', direction_id);

      if (directionCampaigns && directionCampaigns.length > 0) {
        campaignFilter = directionCampaigns.map(dc => dc.campaign_id);
      }
    }

    try {
      // Normalize adAccountId
      const accountId = adAccountId?.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

      // Request insights from Facebook API
      const params = {
        level: 'campaign',
        fields: 'campaign_id,campaign_name,actions',
        time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until }),
        action_breakdowns: 'action_type',
        limit: '500'
      };

      // Add campaign filter if direction specified
      if (campaignFilter && campaignFilter.length > 0) {
        params.filtering = JSON.stringify([{
          field: 'campaign.id',
          operator: 'IN',
          value: campaignFilter
        }]);
      }

      const response = await fbGraph('GET', `${accountId}/insights`, accessToken, params);

      if (!response.data || response.data.length === 0) {
        return {
          success: true,
          period,
          date_range: dateRange,
          messaging_leads: 0,
          quality_leads: 0,
          engagement_rate: 0,
          source: 'facebook_api',
          note: 'No campaign data for period'
        };
      }

      // Parse Facebook actions - same logic as dashboard
      let totalMessagingLeads = 0;
      let totalQualityLeads = 0;

      for (const stat of response.data) {
        if (stat.actions && Array.isArray(stat.actions)) {
          for (const action of stat.actions) {
            // Total messaging connections (all leads who started a conversation)
            if (action.action_type === 'onsite_conversion.total_messaging_connection') {
              totalMessagingLeads += parseInt(action.value || '0', 10);
            }
            // Quality leads (2+ messages sent by user)
            else if (action.action_type === 'onsite_conversion.messaging_user_depth_2_message_send') {
              totalQualityLeads += parseInt(action.value || '0', 10);
            }
          }
        }
      }

      // Calculate engagement rate (quality / messaging * 100)
      const engagementRate = totalMessagingLeads > 0
        ? (totalQualityLeads / totalMessagingLeads) * 100
        : 0;

      return {
        success: true,
        period,
        date_range: dateRange,
        messaging_leads: totalMessagingLeads,
        quality_leads: totalQualityLeads,
        engagement_rate: parseFloat(engagementRate.toFixed(1)),
        source: 'facebook_api',
        direction_id: direction_id || null,
        campaigns_count: response.data.length
      };

    } catch (error) {
      logger.error({ error: error.message, direction_id, period }, 'getLeadsEngagementRate failed');
      return {
        success: false,
        error: error.message,
        source: 'facebook_api'
      };
    }
  },

  // ============================================================
  // CUSTOM FB API QUERY (LLM-powered)
  // ============================================================

  /**
   * Execute custom Facebook API query using LLM
   * For non-standard metrics that don't have a dedicated tool
   *
   * Flow:
   * 1. LLM analyzes user_request
   * 2. LLM builds FB Graph API query (endpoint, fields, params)
   * 3. Execute query to FB
   * 4. On error: LLM fixes query, retry (max 3 times)
   * 5. Return result or final error
   */
  async customFbQuery({ user_request, entity_type, entity_id, period }, { accessToken, adAccountId }) {
    const openai = await import('openai');
    const OpenAI = openai.default;
    const client = new OpenAI();

    const actId = adAccountId?.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const dateRange = period ? getDateRange(period) : null;

    // Build entity path based on type
    let basePath;
    switch (entity_type) {
      case 'campaign':
        basePath = entity_id;
        break;
      case 'adset':
        basePath = entity_id;
        break;
      case 'ad':
        basePath = entity_id;
        break;
      case 'account':
      default:
        basePath = actId;
    }

    const systemPrompt = `Ты эксперт по Facebook Marketing API.

Твоя задача: построить корректный запрос к FB Graph API на основе вопроса пользователя.

## Доступные endpoints и fields:

### Account level (act_<id>):
- /insights: spend, impressions, clicks, cpm, cpc, ctr, actions, cost_per_action_type
- /campaigns: id, name, status, objective, daily_budget
- /adsets: id, name, status, daily_budget, targeting
- /ads: id, name, status, creative

### Campaign/AdSet/Ad level:
- /insights: те же метрики + date breakdown
- fields: id, name, status, effective_status, daily_budget, bid_amount

### Breakdowns:
- age, gender, country, region, device_platform, publisher_platform, placement

### Time ranges:
- time_range: {"since": "YYYY-MM-DD", "until": "YYYY-MM-DD"}
- date_preset: today, yesterday, last_7d, last_14d, last_30d, lifetime

## Формат ответа (JSON):
{
  "endpoint": "<entity_id>/insights или <entity_id>/campaigns и т.д.",
  "fields": "spend,impressions,clicks,ctr",
  "params": {
    "time_range": {"since": "2024-01-01", "until": "2024-01-07"},
    "breakdowns": "age,gender",
    "level": "ad"
  },
  "explanation": "Краткое объяснение что запрашиваем"
}

Отвечай ТОЛЬКО JSON без markdown.`;

    const userPrompt = `Запрос пользователя: "${user_request}"

Базовый путь: ${basePath}
Тип сущности: ${entity_type}
${dateRange ? `Период: ${dateRange.since} - ${dateRange.until}` : 'Период: не указан, используй last_7d'}

Построй FB API запрос для этого вопроса.`;

    const MAX_ATTEMPTS = 3;
    let lastError = null;
    let attemptPrompt = userPrompt;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // Step 1: Get query from LLM
        const completion = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: attemptPrompt }
          ],
          temperature: 0.2,
          max_tokens: 500
        });

        const llmResponse = completion.choices[0]?.message?.content || '';

        // Parse LLM response
        let queryPlan;
        try {
          // Try to extract JSON from response
          const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            throw new Error('No JSON found in LLM response');
          }
          queryPlan = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
          logger.warn({ attempt, llmResponse }, 'customFbQuery: failed to parse LLM response');
          lastError = `Не удалось распознать план запроса: ${parseError.message}`;
          attemptPrompt = `${userPrompt}\n\nПредыдущая попытка не удалась: ${lastError}\nПопробуй снова, верни только валидный JSON.`;
          continue;
        }

        // Step 2: Execute FB API query
        const params = {
          fields: queryPlan.fields,
          ...queryPlan.params
        };

        // Handle time_range
        if (params.time_range && typeof params.time_range === 'object') {
          params.time_range = JSON.stringify(params.time_range);
        } else if (dateRange && !params.date_preset) {
          params.time_range = JSON.stringify({ since: dateRange.since, until: dateRange.until });
        }

        logger.info({
          attempt,
          endpoint: queryPlan.endpoint,
          params,
          explanation: queryPlan.explanation
        }, 'customFbQuery: executing FB API request');

        const result = await fbGraph('GET', queryPlan.endpoint, accessToken, params);

        // Success!
        return {
          success: true,
          query: {
            endpoint: queryPlan.endpoint,
            fields: queryPlan.fields,
            params: queryPlan.params,
            explanation: queryPlan.explanation
          },
          data: result.data || result,
          attempts: attempt,
          source: 'custom_fb_query'
        };

      } catch (fbError) {
        const errorMessage = fbError.message || String(fbError);
        logger.warn({ attempt, error: errorMessage }, 'customFbQuery: FB API error');

        lastError = errorMessage;

        // Build retry prompt with error context
        attemptPrompt = `${userPrompt}

ПРЕДЫДУЩАЯ ПОПЫТКА #${attempt} ОШИБКА:
${errorMessage}

Исправь запрос учитывая эту ошибку. Частые проблемы:
- Неверный формат time_range (должен быть JSON строка)
- Недопустимые breakdowns для данного уровня
- Несуществующие fields
- Нужен access к ads_read permission`;
      }
    }

    // All attempts failed
    return {
      success: false,
      error: `Не удалось выполнить запрос после ${MAX_ATTEMPTS} попыток`,
      last_error: lastError,
      user_request,
      suggestion: 'Попробуйте переформулировать запрос или использовать стандартные tools (getCampaigns, getSpendReport и т.д.)'
    };
  },

  // ============================================================
  // MANUAL MODE HANDLERS (for users without directions)
  // ============================================================

  /**
   * Save campaign mapping for manual mode
   * Stores campaign → direction → target CPL mapping in agent_notes.ads
   * Uses memoryHandlers from orchestrator for consistency
   */
  async saveCampaignMapping({ campaign_id, campaign_name, direction_name, goal, target_cpl_cents }, context) {
    // Import memoryHandlers
    const { memoryHandlers } = await import('../../orchestrator/memoryTools.js');

    // Delegate to memoryHandlers.saveCampaignMapping
    return memoryHandlers.saveCampaignMapping(
      { campaign_id, campaign_name, direction_name, goal, target_cpl_cents },
      context
    );
  }
};
