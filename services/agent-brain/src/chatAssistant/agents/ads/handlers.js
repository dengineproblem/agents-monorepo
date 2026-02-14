/**
 * AdsAgent Handlers - Facebook/Instagram Advertising
 * Tool execution handlers for advertising operations
 */

import crypto from 'crypto';
import axios from 'axios';
import { fbGraph } from '../../shared/fbGraph.js';
import { getDateRange } from '../../shared/dateUtils.js';
import { supabase } from '../../../lib/supabaseClient.js';
import { adsDryRunHandlers } from '../../shared/dryRunHandlers.js';
import { generateAdsetName } from '../../../utils/adsetNaming.js';

const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || 'http://agent-service:8082';

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

  async getCampaigns({ period, date_from, date_to, status, campaign_type }, { accessToken, adAccountId, userAccountId }) {
    logger.debug({ period, date_from, date_to, status, campaign_type, userAccountId }, '[getCampaigns] Starting');

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

    // ALWAYS load directions for campaign_type determination
    // This is needed to correctly mark campaigns as internal/external
    const { data: directions, error: directionsError } = await supabase
      .from('account_directions')
      .select('fb_campaign_id')
      .eq('user_account_id', userAccountId);

    if (directionsError) {
      logger.warn({ error: directionsError }, '[getCampaigns] Failed to load directions');
    }

    const internalCampaignIds = new Set(
      (directions || []).map(d => d.fb_campaign_id).filter(Boolean)
    );

    logger.debug({
      internalCount: internalCampaignIds.size,
      campaign_type
    }, '[getCampaigns] Loaded directions for campaign_type filtering');

    const result = await fbGraph('GET', path, accessToken, params);

    // Parse insights and format response
    let campaigns = (result.data || []).map(c => {
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

      // Determine campaign type: internal (has direction) or external (no direction)
      const isInternal = internalCampaignIds.has(c.id);

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
        clicks: parseInt(insights.clicks || 0),
        campaign_type: isInternal ? 'internal' : 'external'
      };
    });

    // Filter by campaign_type if specified
    const beforeFilterCount = campaigns.length;
    if (campaign_type === 'internal') {
      campaigns = campaigns.filter(c => c.campaign_type === 'internal');
    } else if (campaign_type === 'external') {
      campaigns = campaigns.filter(c => c.campaign_type === 'external');
    }

    // Count by type for logging
    const internalCount = campaigns.filter(c => c.campaign_type === 'internal').length;
    const externalCount = campaigns.filter(c => c.campaign_type === 'external').length;

    logger.info({
      total: campaigns.length,
      beforeFilter: beforeFilterCount,
      filter: campaign_type || 'all',
      internal: internalCount,
      external: externalCount,
      period: { since: dateRange.since, until: dateRange.until }
    }, '[getCampaigns] Completed');

    // Add entity refs for entity linking
    const campaignsWithRefs = attachRefs(campaigns, 'c');
    const entityMap = buildEntityMap(campaigns, 'c');

    return {
      success: true,
      period,
      campaigns: campaignsWithRefs,
      total: campaigns.length,
      internal_count: internalCount,
      external_count: externalCount,
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

  async getAdSets({ campaign_id, period, date_from, date_to, campaign_type }, { accessToken, adAccountId, userAccountId }) {
    logger.debug({ campaign_id, period, campaign_type, userAccountId }, '[getAdSets] Starting');

    const dateRange = getDateRangeWithDates({ date_from, date_to, period });
    const normalizedAccountId = adAccountId?.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    // Fields WITHOUT embedded insights - we'll fetch insights separately
    const fields = 'id,name,status,daily_budget,targeting,campaign_id';

    // ALWAYS load directions for campaign_type determination
    const { data: directions, error: directionsError } = await supabase
      .from('account_directions')
      .select('fb_campaign_id')
      .eq('user_account_id', userAccountId);

    if (directionsError) {
      logger.warn({ error: directionsError }, '[getAdSets] Failed to load directions');
    }

    const internalCampaignIds = new Set(
      (directions || []).map(d => d.fb_campaign_id).filter(Boolean)
    );

    logger.debug({ internalCount: internalCampaignIds.size }, '[getAdSets] Loaded directions');

    // If campaign_type filter specified without campaign_id, get campaigns first
    let campaignIds = campaign_id ? [campaign_id] : [];

    if (!campaign_id && campaign_type && campaign_type !== 'all') {
      // Get all campaigns from FB
      const allCampaigns = await fbGraph('GET', `${normalizedAccountId}/campaigns`, accessToken, {
        fields: 'id',
        limit: 500
      });

      // Filter by campaign_type
      campaignIds = (allCampaigns.data || [])
        .filter(c => {
          const isInternal = internalCampaignIds.has(c.id);
          return campaign_type === 'internal' ? isInternal : !isInternal;
        })
        .map(c => c.id);

      logger.debug({ campaignIds: campaignIds.length, filter: campaign_type }, '[getAdSets] Filtered campaigns');
    }

    // Fetch adsets for each campaign (or single campaign_id)
    let allAdsets = [];

    if (campaignIds.length > 0) {
      for (const cid of campaignIds) {
        const result = await fbGraph('GET', `${cid}/adsets`, accessToken, {
          fields,
          limit: 500
        });
        allAdsets.push(...(result.data || []));
      }
    } else if (campaign_id) {
      const result = await fbGraph('GET', `${campaign_id}/adsets`, accessToken, {
        fields,
        limit: 500
      });
      allAdsets = result.data || [];
    }

    logger.debug({ adsetCount: allAdsets.length }, '[getAdSets] Got adsets from FB');

    if (allAdsets.length === 0) {
      return { success: true, adsets: [], totals: { spend: 0, leads: 0, cpl: null } };
    }

    // Fetch insights separately via account-level endpoint (like getAds does)
    const adsetIds = allAdsets.map(a => a.id);
    const insightsResult = await fbGraph('GET', `${normalizedAccountId}/insights`, accessToken, {
      level: 'adset',
      fields: 'adset_id,adset_name,spend,impressions,clicks,inline_link_clicks,actions',
      time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until }),
      filtering: JSON.stringify([{ field: 'adset.id', operator: 'IN', value: adsetIds }]),
      limit: 500
    });

    // Create insights map by adset_id
    logger.debug({ insightsCount: insightsResult.data?.length || 0, adsetCount: adsetIds.length }, '[getAdSets] Got insights from FB');
    const insightsMap = {};
    for (const insight of (insightsResult.data || [])) {
      insightsMap[insight.adset_id] = insight;
    }

    let totalSpend = 0;
    let totalLeads = 0;

    const adsets = allAdsets.map(a => {
      const insights = insightsMap[a.id] || {};
      const spend = parseFloat(insights.spend || 0);

      // Count leads from ALL sources + messaging_conversations_started
      let messagingLeads = 0;
      let siteLeads = 0;
      let leadFormLeads = 0;
      let messagingConversations = 0;

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
            leadFormLeads = parseInt(action.value || '0', 10);
          } else if (action.action_type === 'onsite_conversion.messaging_conversation_started_7d') {
            // Messaging conversations started (для анализа качества диалогов)
            messagingConversations = parseInt(action.value || '0', 10);
          }
        }
      }

      const leads = messagingLeads + siteLeads + leadFormLeads;
      totalSpend += spend;
      totalLeads += leads;
      const isInternal = internalCampaignIds.has(a.campaign_id);

      return {
        id: a.id,
        name: a.name,
        status: a.status,
        daily_budget: a.daily_budget ? parseInt(a.daily_budget) / 100 : null,
        campaign_id: a.campaign_id,
        campaign_type: isInternal ? 'internal' : 'external',
        spend,
        leads,
        cpl: leads > 0 ? (spend / leads).toFixed(2) : null,
        impressions: parseInt(insights.impressions || 0),
        clicks: parseInt(insights.clicks || 0),
        link_clicks: parseInt(insights.inline_link_clicks || 0),
        messaging_conversations: messagingConversations
      };
    });

    logger.debug({ totalAdsets: adsets.length, totalSpend, totalLeads }, '[getAdSets] Completed');

    return {
      success: true,
      adsets,
      totals: {
        spend: totalSpend.toFixed(2),
        leads: totalLeads,
        cpl: totalLeads > 0 ? (totalSpend / totalLeads).toFixed(2) : null
      }
    };
  },

  async getAds({ campaign_id, period, date_from, date_to, campaign_type }, { accessToken, adAccountId, userAccountId }) {
    logger.debug({ campaign_id, period, campaign_type, adAccountId }, '[getAds] Starting');
    const dateRange = getDateRangeWithDates({ date_from, date_to, period });

    // ALWAYS load directions for campaign_type determination
    const { data: directions, error: directionsError } = await supabase
      .from('account_directions')
      .select('fb_campaign_id')
      .eq('user_account_id', userAccountId);

    if (directionsError) {
      logger.warn({ error: directionsError }, '[getAds] Failed to load directions');
    }

    const internalCampaignIds = new Set(
      (directions || []).map(d => d.fb_campaign_id).filter(Boolean)
    );

    logger.debug({ internalCount: internalCampaignIds.size }, '[getAds] Loaded directions');

    // Определяем endpoint: кампания или весь аккаунт
    const normalizedAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const endpoint = campaign_id ? `${campaign_id}/ads` : `${normalizedAccountId}/ads`;

    const fields = 'id,name,status,effective_status,campaign{id,name}';

    // Получаем список объявлений
    logger.debug({ endpoint, campaign_id: campaign_id || 'ALL' }, '[getAds] Fetching ads from FB');
    const result = await fbGraph('GET', endpoint, accessToken, {
      fields,
      limit: 500
    });

    logger.debug({ count: result.data?.length || 0 }, '[getAds] Got ads from FB');

    if (!result.data || result.data.length === 0) {
      return { success: true, ads: [], totals: { spend: 0, leads: 0, cpl: null } };
    }

    // Получаем insights для всех объявлений
    const adIds = result.data.map(ad => ad.id);
    const insightsResult = await fbGraph('GET', `${normalizedAccountId}/insights`, accessToken, {
      level: 'ad',
      fields: 'ad_id,ad_name,spend,impressions,clicks,inline_link_clicks,actions',
      time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until }),
      filtering: JSON.stringify([{ field: 'ad.id', operator: 'IN', value: adIds }]),
      limit: 500
    });

    // Создаём map insights по ad_id
    logger.debug({ insightsCount: insightsResult.data?.length || 0, adsCount: adIds.length }, '[getAds] Got insights from FB');
    const insightsMap = {};
    for (const insight of (insightsResult.data || [])) {
      insightsMap[insight.ad_id] = insight;
    }

    let totalSpend = 0;
    let totalLeads = 0;

    const ads = result.data.map(ad => {
      const insights = insightsMap[ad.id] || {};
      const spend = parseFloat(insights.spend || 0);

      // Count leads from ALL sources + messaging_conversations_started
      let messagingLeads = 0;
      let siteLeads = 0;
      let leadFormLeads = 0;
      let messagingConversations = 0;

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
            leadFormLeads = parseInt(action.value || '0', 10);
          } else if (action.action_type === 'onsite_conversion.messaging_conversation_started_7d') {
            // Messaging conversations started (для анализа качества диалогов)
            messagingConversations = parseInt(action.value || '0', 10);
          }
        }
      }

      const leads = messagingLeads + siteLeads + leadFormLeads;
      totalSpend += spend;
      totalLeads += leads;

      // Determine campaign type
      const campaignId = ad.campaign?.id || null;
      const isInternal = campaignId ? internalCampaignIds.has(campaignId) : false;

      return {
        id: ad.id,
        name: insights.ad_name || ad.name,
        status: ad.effective_status || ad.status,
        campaign_id: campaignId,
        campaign_name: ad.campaign?.name || null,
        campaign_type: isInternal ? 'internal' : 'external',
        spend: spend.toFixed(2),
        leads,
        cpl: leads > 0 ? (spend / leads).toFixed(2) : null,
        impressions: parseInt(insights.impressions || 0),
        clicks: parseInt(insights.clicks || 0),
        link_clicks: parseInt(insights.inline_link_clicks || 0),
        messaging_conversations: messagingConversations
      };
    }).filter(ad => {
      // Filter by activity
      const hasActivity = parseFloat(ad.spend) > 0 || ad.leads > 0;
      if (!hasActivity) return false;

      // Filter by campaign_type if specified
      if (campaign_type === 'internal') return ad.campaign_type === 'internal';
      if (campaign_type === 'external') return ad.campaign_type === 'external';
      return true;
    });

    logger.debug({ adsCount: ads.length, totalSpend: totalSpend.toFixed(2), totalLeads }, '[getAds] After filter');

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

    logger.debug({ campaignsCount: campaigns_summary.length }, '[getAds] Campaigns summary ready');

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
    const MIN_BUDGET_CENTS = 300; // $3 минимум (FB позволяет от $1)

    // Фолбэк на минималку если бюджет слишком низкий
    let finalBudgetCents = new_budget_cents;
    if (new_budget_cents < MIN_BUDGET_CENTS) {
      logger.warn({
        handler: 'updateBudget',
        adset_id,
        requested_budget: new_budget_cents,
        fallback_budget: MIN_BUDGET_CENTS,
        reason: 'fallback_to_minimum'
      }, `updateBudget: бюджет ${new_budget_cents}¢ ниже минимума, фолбэк на ${MIN_BUDGET_CENTS}¢ ($${MIN_BUDGET_CENTS/100})`);
      finalBudgetCents = MIN_BUDGET_CENTS;
    }

    // Dry-run mode: return preview with change % and warnings
    if (dry_run) {
      return adsDryRunHandlers.updateBudget({ adset_id, new_budget_cents: finalBudgetCents }, { accessToken });
    }

    // Get current budget before change
    let beforeBudget = null;
    try {
      const current = await fbGraph('GET', adset_id, accessToken, { fields: 'daily_budget' });
      beforeBudget = parseInt(current.daily_budget || 0);
    } catch (e) { /* ignore */ }

    await fbGraph('POST', adset_id, accessToken, {
      daily_budget: finalBudgetCents
    });

    // Post-check verification
    const verification = await verifyAdSetBudget(adset_id, finalBudgetCents, accessToken);

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Budget updated for AdSet ${adset_id}: $${(finalBudgetCents / 100).toFixed(2)}`,
      context: {
        requested_budget_cents: new_budget_cents,
        final_budget_cents: finalBudgetCents,
        before_budget_cents: beforeBudget,
        verified: verification.verified,
        source: 'chat_assistant',
        agent: 'AdsAgent',
        fallback_applied: new_budget_cents !== finalBudgetCents
      }
    });

    return {
      success: true,
      message: finalBudgetCents !== new_budget_cents
        ? `Бюджет адсета ${adset_id} изменён на $${(finalBudgetCents / 100).toFixed(2)}/день (запрошено $${(new_budget_cents / 100).toFixed(2)}, применён минимум)`
        : `Бюджет адсета ${adset_id} изменён на $${(finalBudgetCents / 100).toFixed(2)}/день`,
      verification: {
        verified: verification.verified,
        before: beforeBudget ? `$${(beforeBudget / 100).toFixed(2)}` : null,
        after: verification.after ? `$${(verification.after / 100).toFixed(2)}` : null,
        warning: verification.warning,
        fallback_applied: new_budget_cents !== finalBudgetCents
      }
    };
  },

  /**
   * Create AdSet in campaign with creatives
   * PROXY: delegates to agent-service /api/campaign-builder/manual-launch-multi
   * for full production workflow (targeting, batch API, direction_adsets, etc.)
   */
  async createAdSet({ direction_id, creative_ids, daily_budget_cents, adset_name, start_mode, dry_run }, { accessToken, adAccountId, userAccountId, pageId, adAccountDbId }) {
    // Dry-run: lightweight preview without calling agent-service
    if (dry_run) {
      return adsDryRunHandlers.createAdSet({ direction_id, creative_ids, daily_budget_cents, adset_name }, { userAccountId, adAccountId, adAccountDbId });
    }

    logger.info({
      handler: 'createAdSet',
      direction_id,
      creative_ids,
      start_mode,
      proxy: 'agent-service/manual-launch-multi',
    }, 'createAdSet: proxying to agent-service');

    try {
      const payload = {
        user_account_id: userAccountId,
        account_id: adAccountDbId || null,
        direction_id,
        start_mode: start_mode || 'now',
        adsets: [{
          creative_ids,
          daily_budget_cents: daily_budget_cents || undefined,
        }],
      };

      const res = await axios.post(
        `${AGENT_SERVICE_URL}/campaign-builder/manual-launch-multi`,
        payload,
        { timeout: 90_000 }
      );

      const data = res.data;
      const firstAdset = data.adsets?.[0];

      return {
        success: data.success,
        message: data.message,
        adset_id: firstAdset?.adset_id,
        adset_name: firstAdset?.adset_name,
        ads_created: firstAdset?.ads_created,
        ads: firstAdset?.ads,
        direction_id: data.direction_id,
        direction_name: data.direction_name,
        campaign_id: data.campaign_id,
      };
    } catch (error) {
      const errMsg = error.response?.data?.error || error.response?.data?.message || error.message;
      logger.error({ handler: 'createAdSet', error: errMsg, direction_id }, 'createAdSet: proxy call failed');
      return { success: false, error: `Ошибка запуска: ${errMsg}` };
    }
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

  // КРИТИЧНО: Добавлен adAccountDbId для мультиаккаунтности
  async getDirectionCreatives({ direction_id }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;
    const filterMode = dbAccountId ? 'multi_account' : 'legacy';

    logger.info({
      handler: 'getDirectionCreatives',
      direction_id,
      userAccountId,
      dbAccountId,
      filterMode
    }, `getDirectionCreatives: загрузка креативов (${filterMode})`);

    // Get direction name for context
    // КРИТИЧНО: Фильтрация по account_id для мультиаккаунтности
    let dirQuery = supabase
      .from('account_directions')
      .select('id, name')
      .eq('id', direction_id);

    if (dbAccountId) {
      dirQuery = dirQuery.eq('account_id', dbAccountId);
    } else {
      dirQuery = dirQuery.is('account_id', null);
    }

    const { data: direction, error: dirError } = await dirQuery.single();

    if (dirError) {
      logger.warn({
        handler: 'getDirectionCreatives',
        direction_id,
        dbAccountId,
        error: dirError.message,
        hint: dbAccountId ? 'Направление не найдено или не принадлежит этому аккаунту' : 'Направление не найдено'
      }, 'getDirectionCreatives: направление не найдено');
      return { success: false, error: dirError.message };
    }

    // Get creatives linked to this direction with metrics
    // КРИТИЧНО: Фильтрация по account_id для мультиаккаунтности
    let creativesQuery = supabase
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
      .eq('user_id', userAccountId);

    if (dbAccountId) {
      creativesQuery = creativesQuery.eq('account_id', dbAccountId);
    } else {
      creativesQuery = creativesQuery.is('account_id', null);
    }

    const { data: creatives, error } = await creativesQuery
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

  async updateDirectionBudget({ direction_id, new_budget, dry_run }, { adAccountId, userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    logger.info({
      handler: 'updateDirectionBudget',
      direction_id,
      new_budget,
      dry_run,
      dbAccountId,
      filterMode: dbAccountId ? 'multi_account' : 'legacy'
    }, 'updateDirectionBudget: начало операции');

    // Dry-run mode: return preview with change % and warnings
    if (dry_run) {
      return adsDryRunHandlers.updateDirectionBudget({ direction_id, new_budget }, { adAccountId, adAccountDbId });
    }

    // Convert dollars to cents for storage
    const newBudgetCents = Math.round(new_budget * 100);

    // Update direction budget (stored in cents)
    // Мультиаккаунтность: проверяем владение направлением через account_id
    let query = supabase
      .from('account_directions')
      .update({ daily_budget_cents: newBudgetCents, updated_at: new Date().toISOString() })
      .eq('id', direction_id);

    // В multi-account режиме проверяем владение через account_id
    if (dbAccountId) {
      query = query.eq('account_id', dbAccountId);
    }
    // В legacy режиме не фильтруем по account_id - обновляем по ID

    const { data, error } = await query
      .select('id, name, daily_budget_cents')
      .single();

    if (error) {
      logger.warn({
        handler: 'updateDirectionBudget',
        direction_id,
        dbAccountId,
        error: error.message,
        hint: dbAccountId ? 'Направление не найдено или не принадлежит этому аккаунту' : 'Направление не найдено в legacy режиме'
      }, 'updateDirectionBudget: ошибка обновления');
      return { success: false, error: `Направление не найдено или недоступно: ${error.message}` };
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

  async updateDirectionTargetCPL({ direction_id, target_cpl }, { adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    logger.info({
      handler: 'updateDirectionTargetCPL',
      direction_id,
      target_cpl,
      dbAccountId,
      filterMode: dbAccountId ? 'multi_account' : 'legacy'
    }, 'updateDirectionTargetCPL: начало операции');

    // Convert dollars to cents for storage
    const targetCplCents = Math.round(target_cpl * 100);

    // Мультиаккаунтность: проверяем владение направлением через account_id
    let query = supabase
      .from('account_directions')
      .update({ target_cpl_cents: targetCplCents, updated_at: new Date().toISOString() })
      .eq('id', direction_id);

    if (dbAccountId) {
      query = query.eq('account_id', dbAccountId);
    } else {
      query = query.is('account_id', null);
    }

    const { data, error } = await query
      .select('id, name, target_cpl_cents')
      .single();

    if (error) {
      logger.warn({
        handler: 'updateDirectionTargetCPL',
        direction_id,
        dbAccountId,
        error: error.message,
        hint: dbAccountId ? 'Направление не найдено или не принадлежит этому аккаунту' : 'Направление не найдено'
      }, 'updateDirectionTargetCPL: ошибка обновления');
      return { success: false, error: `Направление не найдено или недоступно: ${error.message}` };
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

  async pauseDirection({ direction_id, reason, dry_run }, { adAccountId, accessToken, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    logger.info({
      handler: 'pauseDirection',
      direction_id,
      reason,
      dry_run,
      dbAccountId,
      filterMode: dbAccountId ? 'multi_account' : 'legacy'
    }, 'pauseDirection: начало операции');

    // Dry-run mode: return preview with affected entities
    if (dry_run) {
      return adsDryRunHandlers.pauseDirection({ direction_id }, { adAccountId, adAccountDbId });
    }

    // Get direction with fb_campaign_id
    // Мультиаккаунтность: проверяем владение направлением через account_id
    let fetchQuery = supabase
      .from('account_directions')
      .select('id, name, fb_campaign_id')
      .eq('id', direction_id);

    if (dbAccountId) {
      fetchQuery = fetchQuery.eq('account_id', dbAccountId);
    } else {
      fetchQuery = fetchQuery.is('account_id', null);
    }

    const { data: direction, error: fetchError } = await fetchQuery.single();

    if (fetchError) {
      logger.warn({
        handler: 'pauseDirection',
        direction_id,
        dbAccountId,
        error: fetchError.message,
        hint: dbAccountId ? 'Направление не найдено или не принадлежит этому аккаунту' : 'Направление не найдено'
      }, 'pauseDirection: направление не найдено');
      return { success: false, error: `Направление не найдено или недоступно: ${fetchError.message}` };
    }

    // Update direction status (is_active = false)
    let updateQuery = supabase
      .from('account_directions')
      .update({ is_active: false, campaign_status: 'PAUSED', updated_at: new Date().toISOString() })
      .eq('id', direction_id);

    if (dbAccountId) {
      updateQuery = updateQuery.eq('account_id', dbAccountId);
    } else {
      updateQuery = updateQuery.is('account_id', null);
    }

    const { error: updateError } = await updateQuery;

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Pause FB campaign if linked
    let fbPaused = false;
    let fbError = null;
    if (direction.fb_campaign_id && accessToken) {
      try {
        await fbGraph('POST', direction.fb_campaign_id, accessToken, { status: 'PAUSED' });
        fbPaused = true;
      } catch (e) {
        fbError = e.message || 'Unknown FB API error';
        logger.error({
          handler: 'pauseDirection',
          direction_id,
          fb_campaign_id: direction.fb_campaign_id,
          error: fbError,
        }, 'pauseDirection: FB API call failed');
      }
    }

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: fbError ? 'warning' : 'info',
      message: `Direction paused: ${direction.name}`,
      context: { direction_id, reason, fb_paused: fbPaused, fb_error: fbError, source: 'chat_assistant', agent: 'AdsAgent' }
    });

    if (fbError) {
      return {
        success: true,
        warning: true,
        message: `Направление "${direction.name}" поставлено на паузу в системе, но FB кампания НЕ отключена: ${fbError}. Попробуйте ещё раз или отключите кампанию вручную в Ads Manager.`,
        fb_campaign_id: direction.fb_campaign_id,
      };
    }

    return {
      success: true,
      message: `Направление "${direction.name}" поставлено на паузу${fbPaused ? ' (включая FB кампанию в Ads Manager)' : ' (FB кампания не привязана)'}`
    };
  },

  async resumeDirection({ direction_id }, { adAccountId, accessToken, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    logger.info({
      handler: 'resumeDirection',
      direction_id,
      dbAccountId,
      filterMode: dbAccountId ? 'multi_account' : 'legacy'
    }, 'resumeDirection: начало операции');

    // Get direction with fb_campaign_id
    // Мультиаккаунтность: проверяем владение направлением через account_id
    let fetchQuery = supabase
      .from('account_directions')
      .select('id, name, fb_campaign_id')
      .eq('id', direction_id);

    if (dbAccountId) {
      fetchQuery = fetchQuery.eq('account_id', dbAccountId);
    } else {
      fetchQuery = fetchQuery.is('account_id', null);
    }

    const { data: direction, error: fetchError } = await fetchQuery.single();

    if (fetchError) {
      logger.warn({
        handler: 'resumeDirection',
        direction_id,
        dbAccountId,
        error: fetchError.message,
        hint: dbAccountId ? 'Направление не найдено или не принадлежит этому аккаунту' : 'Направление не найдено'
      }, 'resumeDirection: направление не найдено');
      return { success: false, error: `Направление не найдено или недоступно: ${fetchError.message}` };
    }

    // Update direction status (is_active = true)
    let updateQuery = supabase
      .from('account_directions')
      .update({ is_active: true, campaign_status: 'ACTIVE', updated_at: new Date().toISOString() })
      .eq('id', direction_id);

    if (dbAccountId) {
      updateQuery = updateQuery.eq('account_id', dbAccountId);
    } else {
      updateQuery = updateQuery.is('account_id', null);
    }

    const { error: updateError } = await updateQuery;

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Resume FB campaign if linked
    let fbResumed = false;
    let fbError = null;
    if (direction.fb_campaign_id && accessToken) {
      try {
        await fbGraph('POST', direction.fb_campaign_id, accessToken, { status: 'ACTIVE' });
        fbResumed = true;
      } catch (e) {
        fbError = e.message || 'Unknown FB API error';
        logger.error({
          handler: 'resumeDirection',
          direction_id,
          fb_campaign_id: direction.fb_campaign_id,
          error: fbError,
        }, 'resumeDirection: FB API call failed');
      }
    }

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: fbError ? 'warning' : 'info',
      message: `Direction resumed: ${direction.name}`,
      context: { direction_id, fb_resumed: fbResumed, fb_error: fbError, source: 'chat_assistant', agent: 'AdsAgent' }
    });

    if (fbError) {
      return {
        success: true,
        warning: true,
        message: `Направление "${direction.name}" возобновлено в системе, но FB кампания НЕ включена: ${fbError}. Попробуйте ещё раз или включите кампанию вручную в Ads Manager.`,
        fb_campaign_id: direction.fb_campaign_id,
      };
    }

    return {
      success: true,
      message: `Направление "${direction.name}" возобновлено${fbResumed ? ' (включая FB кампанию в Ads Manager)' : ' (FB кампания не привязана)'}`
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
      const periodMap = {
        'today': 1, 'yesterday': 1, 'last_3d': 3, 'last_7d': 7,
        'last_14d': 14, 'last_30d': 30, 'last_90d': 90,
        'last_6m': 180, 'last_12m': 365, 'all': null
      };
      const periodDays = period in periodMap ? periodMap[period] : 7;
      since = (() => {
        if (!periodDays) return null;
        const d = new Date();
        d.setDate(d.getDate() - periodDays);
        d.setHours(0, 0, 0, 0);
        return d.toISOString().split('T')[0];
      })();
      until = new Date().toISOString().split('T')[0];
    }

    const usdToKztRate = await getUsdToKzt();

    // Step 1: Load user_creatives
    let creativesQuery = supabase
      .from('user_creatives')
      .select('id, title, media_type, direction_id')
      .eq('user_id', userAccountId)
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .limit(500);

    if (dbAccountId) creativesQuery = creativesQuery.eq('account_id', dbAccountId);
    if (direction_id) creativesQuery = creativesQuery.eq('direction_id', direction_id);
    if (media_type) creativesQuery = creativesQuery.eq('media_type', media_type);

    const { data: creatives, error: creativesError } = await creativesQuery;

    if (creativesError) {
      return { error: `Ошибка загрузки креативов: ${creativesError.message}` };
    }

    if (!creatives || creatives.length === 0) {
      logger.info({ userAccountId, dbAccountId, period, direction_id, media_type },
        'getROIReport: no creatives found');
      return {
        totalSpend: 0, totalRevenue: 0, totalROI: 0,
        totalLeads: 0, totalConversions: 0,
        platforms: {}, campaigns: [],
        message: 'Креативы не найдены за указанный период'
      };
    }

    logger.debug({ creativesCount: creatives.length, since, period },
      'getROIReport: found creatives');

    const creativeIds = creatives.map(c => c.id);

    // Step 2: Load metrics from creative_metrics_history — include platform for separation
    let metricsQuery = supabase
      .from('creative_metrics_history')
      .select('user_creative_id, impressions, clicks, leads, spend, platform')
      .in('user_creative_id', creativeIds)
      .eq('user_account_id', userAccountId)
      .eq('source', 'production');

    if (since) metricsQuery = metricsQuery.gte('date', since);
    if (until) metricsQuery = metricsQuery.lte('date', until);

    const { data: metricsHistory } = await metricsQuery;

    // Aggregate metrics by creative AND platform
    // Key: `${creativeId}:${platform}`
    const metricsByPlatform = new Map(); // platform -> Map<creativeId, agg>
    for (const metric of metricsHistory || []) {
      const platform = metric.platform || 'facebook';
      if (!metricsByPlatform.has(platform)) {
        metricsByPlatform.set(platform, new Map());
      }
      const platformMap = metricsByPlatform.get(platform);
      const creativeId = metric.user_creative_id;
      if (!platformMap.has(creativeId)) {
        platformMap.set(creativeId, { impressions: 0, clicks: 0, leads: 0, spend: 0 });
      }
      const agg = platformMap.get(creativeId);
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

    if (dbAccountId) leadsQuery = leadsQuery.eq('account_id', dbAccountId);
    if (direction_id) leadsQuery = leadsQuery.eq('direction_id', direction_id);
    if (since) leadsQuery = leadsQuery.gte('created_at', since + 'T00:00:00.000Z');
    if (until) leadsQuery = leadsQuery.lte('created_at', until + 'T23:59:59.999Z');

    const { data: leadsData } = await leadsQuery;

    // Step 4: Load purchases for revenue
    const leadPhones = leadsData?.map(l => l.chat_id).filter(Boolean) || [];

    let purchasesQuery = supabase
      .from('purchases')
      .select('client_phone, amount')
      .eq('user_account_id', userAccountId);

    if (dbAccountId) purchasesQuery = purchasesQuery.eq('account_id', dbAccountId);
    if (leadPhones.length > 0) {
      purchasesQuery = purchasesQuery.in('client_phone', leadPhones);
    } else {
      purchasesQuery = purchasesQuery.in('client_phone', ['__no_match__']);
    }
    if (since) purchasesQuery = purchasesQuery.gte('created_at', since + 'T00:00:00.000Z');
    if (until) purchasesQuery = purchasesQuery.lte('created_at', until + 'T23:59:59.999Z');

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

    // Step 5: Build per-platform results
    // Facebook: spend stored in USD → convert to KZT
    // TikTok: spend stored in KZT → use as-is
    const platformConfigs = {
      facebook: { label: 'Facebook/Instagram', currency: 'USD', spendMultiplier: usdToKztRate },
      tiktok: { label: 'TikTok', currency: 'KZT', spendMultiplier: 1 },
    };

    const platforms = {};
    const allCampaigns = [];
    let grandTotalSpendKzt = 0;
    let grandTotalRevenue = 0;
    let grandTotalLeads = 0;
    let grandTotalConversions = 0;

    for (const [platform, config] of Object.entries(platformConfigs)) {
      const platformMetrics = metricsByPlatform.get(platform);
      if (!platformMetrics || platformMetrics.size === 0) continue;

      const campaigns = [];
      let platSpendKzt = 0;
      let platSpendOriginal = 0;
      let platRevenue = 0;
      let platLeads = 0;
      let platConversions = 0;

      for (const creative of creatives) {
        const metrics = platformMetrics.get(creative.id);
        if (!metrics) continue;

        const revenueData = revenueByCreative.get(creative.id) || { revenue: 0, conversions: 0 };

        const leads = metrics.leads;
        const spendOriginal = Math.round(metrics.spend * 100) / 100; // original currency
        const spendKzt = Math.round(metrics.spend * config.spendMultiplier);
        const revenue = revenueData.revenue;
        const conversions = revenueData.conversions;
        const roi = spendKzt > 0 ? Math.round(((revenue - spendKzt) / spendKzt) * 100) : 0;
        const cpl = leads > 0 ? Math.round(spendOriginal / leads * 100) / 100 : null;

        if (leads > 0 || spendOriginal > 0) {
          campaigns.push({
            id: creative.id,
            name: creative.title || `Креатив ${creative.id.substring(0, 8)}`,
            media_type: creative.media_type,
            platform,
            spend: spendOriginal,
            spend_currency: config.currency,
            spend_kzt: spendKzt,
            cpl,
            cpl_currency: config.currency,
            revenue,
            roi,
            leads,
            conversions
          });

          platSpendOriginal += spendOriginal;
          platSpendKzt += spendKzt;
          platRevenue += revenue;
          platLeads += leads;
          platConversions += conversions;
        }
      }

      campaigns.sort((a, b) => b.leads - a.leads);

      const platROI = platSpendKzt > 0 ? Math.round(((platRevenue - platSpendKzt) / platSpendKzt) * 100) : 0;
      const avgCpl = platLeads > 0 ? Math.round(platSpendOriginal / platLeads * 100) / 100 : null;

      const hasRevenue = platRevenue > 0 || platConversions > 0;
      platforms[platform] = {
        label: config.label,
        currency: config.currency,
        totalSpend: platSpendOriginal,
        totalSpend_formatted: config.currency === 'USD'
          ? `$${platSpendOriginal.toFixed(2)}`
          : `${Math.round(platSpendOriginal).toLocaleString()} ₸`,
        totalSpend_kzt: platSpendKzt,
        totalSpend_kzt_formatted: `${(platSpendKzt / 1000).toFixed(0)}K ₸`,
        avgCPL: avgCpl,
        avgCPL_formatted: avgCpl != null
          ? (config.currency === 'USD' ? `$${avgCpl.toFixed(2)}` : `${Math.round(avgCpl)} ₸`)
          : '—',
        totalLeads: platLeads,
        // Revenue/ROI only when data exists
        ...(hasRevenue ? {
          totalRevenue: platRevenue,
          totalROI: platROI,
          totalROI_formatted: `${platROI}%`,
          totalConversions: platConversions,
        } : {}),
        campaigns: campaigns.slice(0, 10),
      };

      allCampaigns.push(...campaigns);
      grandTotalSpendKzt += platSpendKzt;
      grandTotalRevenue += platRevenue;
      grandTotalLeads += platLeads;
      grandTotalConversions += platConversions;
    }

    const grandTotalROI = grandTotalSpendKzt > 0
      ? Math.round(((grandTotalRevenue - grandTotalSpendKzt) / grandTotalSpendKzt) * 100) : 0;

    // Revenue tracking: if no conversions at all, CRM is likely not connected
    const revenueTrackingAvailable = grandTotalConversions > 0 || grandTotalRevenue > 0;

    // Top/worst performers across all platforms
    const sortedByLeads = [...allCampaigns].sort((a, b) => b.leads - a.leads);
    let topPerformers, worstPerformers;

    if (revenueTrackingAvailable) {
      // With revenue data: rank by ROI
      const sortedByROI = [...allCampaigns].sort((a, b) => b.roi - a.roi);
      topPerformers = sortedByROI.filter(c => c.roi > 0).slice(0, 3);
      worstPerformers = sortedByROI.filter(c => c.roi < 0 && c.spend_kzt > 0).reverse().slice(0, 3);
    } else {
      // Without revenue data: rank by CPL (lower is better)
      const withCpl = allCampaigns.filter(c => c.cpl != null && c.leads > 0);
      const sortedByCpl = [...withCpl].sort((a, b) => a.cpl - b.cpl);
      topPerformers = sortedByCpl.slice(0, 3);
      worstPerformers = sortedByCpl.reverse().slice(0, 3);
    }

    // Recommendations — only generate ROI-based recs when revenue data exists
    const recommendations = [];
    if (revenueTrackingAvailable) {
      for (const item of worstPerformers) {
        if (item.roi < -20 && item.spend_kzt > 10000) {
          recommendations.push({
            type: 'cut_budget', entity_type: 'creative',
            entity_id: item.id, entity_name: item.name, platform: item.platform,
            reason: `ROI ${item.roi}%, потрачено ${(item.spend_kzt / 1000).toFixed(0)}K ₸ без окупаемости`,
            action_label: 'Снизить бюджет или остановить'
          });
        }
      }
      for (const item of topPerformers) {
        if (item.roi > 100 && item.leads >= 5) {
          recommendations.push({
            type: 'increase_budget', entity_type: 'creative',
            entity_id: item.id, entity_name: item.name, platform: item.platform,
            reason: `ROI +${item.roi}%, ${item.leads} лидов — можно масштабировать`,
            action_label: 'Увеличить бюджет'
          });
        }
      }
    }

    return {
      success: true,
      period,
      revenueTrackingAvailable,
      // Grand totals (in KZT for comparability)
      totalSpend_kzt: grandTotalSpendKzt,
      totalSpend_kzt_formatted: `${(grandTotalSpendKzt / 1000).toFixed(0)}K ₸`,
      totalLeads: grandTotalLeads,
      // Revenue/ROI — only meaningful when CRM is connected
      ...(revenueTrackingAvailable ? {
        totalRevenue: grandTotalRevenue,
        totalRevenue_formatted: `${(grandTotalRevenue / 1000).toFixed(0)}K ₸`,
        totalROI: grandTotalROI,
        totalROI_formatted: `${grandTotalROI}%`,
        totalConversions: grandTotalConversions,
        conversionRate: grandTotalLeads > 0 ? Math.round((grandTotalConversions / grandTotalLeads) * 100) : 0,
      } : {}),
      // Per-platform breakdown (Facebook in USD, TikTok in KZT)
      platforms,
      campaigns: allCampaigns.sort((a, b) => b.leads - a.leads).slice(0, 10),
      topPerformers,
      worstPerformers,
      recommendations,
      meta: {
        source: 'creative_metrics_history',
        usdKztRate: usdToKztRate,
        revenueNote: revenueTrackingAvailable
          ? 'Revenue data from CRM (purchases linked to leads)'
          : 'CRM не подключена — данные по выручке и ROI недоступны. Показаны только расходы и лиды.'
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
  // EXTERNAL CAMPAIGNS HANDLERS
  // ============================================================

  /**
   * Get metrics for external campaigns (campaigns without directions)
   * Calculates CPL, health score using fallback target CPL logic
   */
  async getExternalCampaignMetrics({ campaign_id, period, date_from, date_to }, { accessToken, adAccountId, userAccountId }) {
    logger.debug({ campaign_id, period, date_from, date_to, adAccountId }, '[getExternalCampaignMetrics] Starting');
    const dateRange = getDateRangeWithDates({ date_from, date_to, period });

    // 1. Load directions to identify internal campaigns
    const { data: directions, error: directionsError } = await supabase
      .from('account_directions')
      .select('fb_campaign_id, target_cpl_cents')
      .eq('user_account_id', userAccountId);

    if (directionsError) {
      logger.warn({ error: directionsError }, '[getExternalCampaignMetrics] Failed to load directions');
    }

    const internalCampaignIds = new Set(
      (directions || []).map(d => d.fb_campaign_id).filter(Boolean)
    );
    logger.debug({ internalCount: internalCampaignIds.size }, '[getExternalCampaignMetrics] Loaded directions');

    // 2. Load campaign mappings from agent_notes (for external campaigns)
    const { data: notes, error: notesError } = await supabase
      .from('agent_notes')
      .select('content')
      .eq('user_account_id', userAccountId)
      .eq('key', 'campaign_mapping')
      .single();

    if (notesError && notesError.code !== 'PGRST116') {
      logger.warn({ error: notesError }, '[getExternalCampaignMetrics] Failed to load campaign mappings');
    }

    const campaignMappings = notes?.content || {};
    logger.debug({ mappingsCount: Object.keys(campaignMappings).length }, '[getExternalCampaignMetrics] Loaded mappings');

    // 3. Load account default CPL
    const { data: adAccount, error: accountError } = await supabase
      .from('ad_accounts')
      .select('default_cpl_target_cents')
      .eq('fb_ad_account_id', adAccountId)
      .single();

    if (accountError && accountError.code !== 'PGRST116') {
      logger.warn({ error: accountError }, '[getExternalCampaignMetrics] Failed to load account defaults');
    }

    const defaultTargetCPL = adAccount?.default_cpl_target_cents || 1500; // $15 fallback
    logger.debug({ defaultTargetCPL, source: adAccount?.default_cpl_target_cents ? 'account' : 'fallback' }, '[getExternalCampaignMetrics] Target CPL defaults');

    // 4. Get all campaigns from FB
    const timeRangeStr = `{"since":"${dateRange.since}","until":"${dateRange.until}"}`;
    const fields = `id,name,status,objective,daily_budget,insights.time_range(${timeRangeStr}){spend,impressions,clicks,actions}`;
    const actId = adAccountId?.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    const result = await fbGraph('GET', `${actId}/campaigns`, accessToken, {
      fields,
      filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] }]),
      time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until })
    });

    logger.debug({ totalCampaigns: result.data?.length || 0 }, '[getExternalCampaignMetrics] Got campaigns from FB');

    // 5. Filter and enrich external campaigns
    const externalCampaigns = (result.data || [])
      .filter(c => {
        // Filter to external only (not in directions)
        const isInternal = internalCampaignIds.has(c.id);
        if (isInternal) return false;
        // Filter to specific campaign_id if provided
        if (campaign_id && c.id !== campaign_id) return false;
        return true;
      })
      .map(c => {
        const insights = c.insights?.data?.[0] || {};
        const spendCents = Math.round(parseFloat(insights.spend || 0) * 100);

        // Count leads
        let leads = 0;
        if (insights.actions && Array.isArray(insights.actions)) {
          for (const action of insights.actions) {
            if (action.action_type === 'onsite_conversion.total_messaging_connection') {
              leads += parseInt(action.value || '0', 10);
            } else if (action.action_type === 'offsite_conversion.fb_pixel_lead') {
              leads += parseInt(action.value || '0', 10);
            } else if (action.action_type === 'onsite_conversion.lead_grouped') {
              leads += parseInt(action.value || '0', 10);
            }
          }
        }

        // Get target CPL: mapping > account default > hardcoded fallback
        const mapping = campaignMappings[c.id];
        const targetCPLCents = mapping?.target_cpl_cents || defaultTargetCPL;
        const actualCPLCents = leads > 0 ? Math.round(spendCents / leads) : null;

        // Calculate CPL gap and health score
        let cplGapPercent = null;
        let healthScore = 0;

        if (actualCPLCents !== null && targetCPLCents > 0) {
          cplGapPercent = ((actualCPLCents - targetCPLCents) / targetCPLCents * 100).toFixed(1);

          // Health score: 0 = at target, negative = over target (bad), positive = under target (good)
          // Scale: -100 (200% over) to +100 (100% under)
          const gapRatio = (targetCPLCents - actualCPLCents) / targetCPLCents;
          healthScore = Math.max(-100, Math.min(100, Math.round(gapRatio * 100)));
        }

        return {
          id: c.id,
          name: c.name,
          status: c.status,
          objective: c.objective,
          daily_budget_cents: c.daily_budget ? parseInt(c.daily_budget) : null,
          campaign_type: 'external',
          direction_name: mapping?.direction_name || null,
          target_cpl_cents: targetCPLCents,
          target_cpl_source: mapping?.target_cpl_cents ? 'mapping' : (adAccount?.default_cpl_target_cents ? 'account_default' : 'fallback'),
          spend_cents: spendCents,
          leads,
          actual_cpl_cents: actualCPLCents,
          cpl_gap_percent: cplGapPercent,
          health_score: healthScore,
          impressions: parseInt(insights.impressions || 0),
          clicks: parseInt(insights.clicks || 0)
        };
      });

    // Sort by spend descending
    externalCampaigns.sort((a, b) => b.spend_cents - a.spend_cents);

    const totalSpend = externalCampaigns.reduce((sum, c) => sum + c.spend_cents, 0);
    const totalLeads = externalCampaigns.reduce((sum, c) => sum + c.leads, 0);

    logger.info({
      externalCount: externalCampaigns.length,
      totalSpendCents: totalSpend,
      totalLeads,
      avgCPL: totalLeads > 0 ? Math.round(totalSpend / totalLeads) : null
    }, '[getExternalCampaignMetrics] Completed');

    return {
      success: true,
      period: { since: dateRange.since, until: dateRange.until },
      campaigns: externalCampaigns,
      totals: {
        count: externalCampaigns.length,
        spend_cents: totalSpend,
        leads: totalLeads,
        avg_cpl_cents: totalLeads > 0 ? Math.round(totalSpend / totalLeads) : null
      },
      default_target_cpl_cents: defaultTargetCPL,
      tip: 'Используй saveCampaignMapping чтобы указать целевой CPL для внешних кампаний'
    };
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
  async triggerBrainOptimizationRun({ direction_id, campaign_id, dry_run, reason, proposals: preApprovedProposals }, { userAccountId, adAccountId, adAccountDbId, accessToken, openaiApiKey }) {
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
      hasCustomOpenaiKey: !!openaiApiKey,
      hasPreApprovedProposals: !!preApprovedProposals?.length,
      preApprovedProposalsCount: preApprovedProposals?.length || 0,
      message: preApprovedProposals?.length
        ? `Выполнение ${preApprovedProposals.length} готовых proposals`
        : campaign_id
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
        .select('id, ad_account_id, access_token, multi_account_enabled, page_id')
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
      let pageId = null;
      if (userAccount.multi_account_enabled && adAccountDbId) {
        const { data: adAccount, error: adAccountError } = await supabase
          .from('ad_accounts')
          .select('id, access_token, ad_account_id, page_id')
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
        pageId = adAccount.page_id;

        logger.info({
          where: 'triggerBrainOptimizationRun',
          phase: 'multi_account_mode',
          userAccountId,
          adAccountDbId,
          finalAdAccountId,
          accountUUID,
          pageId
        });
      } else {
        // Legacy режим: pageId из user_accounts
        pageId = userAccount.page_id;
        logger.info({
          where: 'triggerBrainOptimizationRun',
          phase: 'legacy_mode',
          userAccountId,
          finalAdAccountId: userAccount.ad_account_id,
          pageId
        });
      }

      if (!finalAccessToken) {
        return { success: false, error: 'Access token не доступен' };
      }

      if (!finalAdAccountId) {
        return { success: false, error: 'Ad account ID не найден' };
      }

      // ========================================
      // FAST PATH: Если переданы готовые proposals - сразу выполняем без анализа
      // ========================================
      if (preApprovedProposals?.length > 0 && !dry_run) {
        logger.info({
          where: 'triggerBrainOptimizationRun',
          phase: 'fast_path_execution',
          proposalsCount: preApprovedProposals.length,
          userAccountId,
          adAccountDbId
        }, `FAST PATH: Параллельное выполнение ${preApprovedProposals.length} proposals`);

        const toolContext = {
          accessToken: finalAccessToken,
          adAccountId: finalAdAccountId,
          userAccountId,
          adAccountDbId,
          pageId
        };

        // Функция выполнения одного proposal
        const executeProposal = async (proposal) => {
          const params = proposal.suggested_action_params || {};

          logger.info({
            where: 'triggerBrainOptimizationRun',
            phase: 'executing_proposal',
            action: proposal.action,
            entityType: proposal.entity_type,
            entityId: proposal.entity_id,
            entityName: proposal.entity_name
          }, `Executing: ${proposal.action}`);

          let executionResult;

          switch (proposal.action) {
            case 'updateBudget':
              executionResult = await adsHandlers.updateBudget(
                { adset_id: proposal.entity_id, new_budget_cents: params.new_budget_cents },
                toolContext
              );
              break;

            case 'pauseAdSet':
              executionResult = await adsHandlers.pauseAdSet(
                { adset_id: proposal.entity_id, reason: proposal.reason },
                toolContext
              );
              break;

            case 'pauseAd':
              executionResult = await adsHandlers.pauseAd(
                { ad_id: proposal.entity_id, reason: proposal.reason },
                toolContext
              );
              break;

            case 'enableAdSet':
              executionResult = await adsHandlers.resumeAdSet(
                { adset_id: proposal.entity_id },
                toolContext
              );
              break;

            case 'enableAd':
              executionResult = await adsHandlers.resumeAd(
                { ad_id: proposal.entity_id },
                toolContext
              );
              break;

            case 'createAdSet':
            case 'launchNewCreatives':
              executionResult = await adsHandlers.createAdSet(
                {
                  direction_id: proposal.direction_id,
                  creative_ids: params.creative_ids || [],
                  daily_budget_cents: params.recommended_budget_cents
                },
                toolContext
              );
              break;

            case 'review':
              executionResult = { success: true, message: 'Отмечено для ручной проверки', skipped: true };
              break;

            default:
              executionResult = { success: false, error: `Unknown action: ${proposal.action}` };
          }

          logger.info({
            where: 'triggerBrainOptimizationRun',
            phase: 'proposal_executed',
            action: proposal.action,
            success: executionResult.success !== false,
            message: executionResult.message
          }, `Proposal ${proposal.action} executed`);

          return {
            proposal: {
              action: proposal.action,
              entity_id: proposal.entity_id,
              entity_name: proposal.entity_name,
              direction_name: proposal.direction_name
            },
            success: executionResult.success !== false,
            message: executionResult.message,
            error: executionResult.error
          };
        };

        // ПАРАЛЛЕЛЬНОЕ выполнение всех proposals
        const startTime = Date.now();
        const results = await Promise.allSettled(
          preApprovedProposals.map(p => executeProposal(p))
        );
        const duration = Date.now() - startTime;

        // Собираем результаты
        const executionResults = results.map((result, index) => {
          if (result.status === 'fulfilled') {
            return result.value;
          } else {
            logger.error({
              where: 'triggerBrainOptimizationRun',
              phase: 'proposal_execution_error',
              action: preApprovedProposals[index].action,
              error: result.reason?.message
            }, `Error executing proposal: ${preApprovedProposals[index].action}`);

            return {
              proposal: {
                action: preApprovedProposals[index].action,
                entity_id: preApprovedProposals[index].entity_id,
                entity_name: preApprovedProposals[index].entity_name
              },
              success: false,
              error: result.reason?.message || 'Unknown error'
            };
          }
        });

        const successCount = executionResults.filter(r => r.success).length;
        const failCount = executionResults.length - successCount;

        logger.info({
          where: 'triggerBrainOptimizationRun',
          phase: 'fast_path_complete',
          totalProposals: preApprovedProposals.length,
          successCount,
          failCount,
          durationMs: duration,
          durationSec: Math.round(duration / 1000)
        }, `FAST PATH завершён: ${successCount}/${preApprovedProposals.length} за ${Math.round(duration / 1000)} сек`);

        // Save to brain_executions
        try {
          await supabase.from('brain_executions').insert({
            user_account_id: userAccountId,
            account_id: adAccountDbId,
            execution_mode: 'manual_trigger',
            idempotency_key: crypto.randomUUID(),
            plan_json: {
              triggered_by: 'brain_mini_fast_path',
              reason: reason || 'Brain Mini execution (fast path)',
              direction_id: direction_id || null,
              proposals: preApprovedProposals.map(p => ({
                action: p.action,
                entity_id: p.entity_id,
                entity_name: p.entity_name,
                reason: p.reason
              }))
            },
            actions_json: executionResults.map(r => ({
              type: r.proposal.action,
              params: r.proposal,
              success: r.success,
              message: r.message || r.error
            })),
            report_text: this.generateDetailedFastPathReport(executionResults, preApprovedProposals, successCount),
            status: failCount === 0 ? 'success' : 'partial',
            actions_taken: successCount,
            actions_failed: failCount
          });
        } catch (saveError) {
          logger.error({ error: saveError.message }, 'Failed to save brain_executions (fast path)');
        }

        return {
          success: failCount === 0,
          mode: 'executed',
          dry_run: false,
          message: `Brain Mini: выполнено ${successCount}/${executionResults.length} действий`,
          execution_results: executionResults,
          success_count: successCount,
          fail_count: failCount
        };
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
          accountUUID,  // Также передаём в options для directions
          openaiApiKey: openaiApiKey || null  // Per-account OpenAI key для Brain LLM
        }
      );

      // ========================================
      // ANALYSIS MODE: Always return proposals for user approval
      // Execution happens ONLY via approveBrainActions → fast path
      // ========================================

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

      // Save proposals to brain_executions so approveBrainActions can find them
      if (result.proposals?.length > 0) {
        const executionId = crypto.randomUUID();
        try {
          await supabase.from('brain_executions').insert({
            id: executionId,
            user_account_id: userAccountId,
            account_id: adAccountDbId || dbAccountId,
            execution_mode: 'manual_trigger',
            idempotency_key: crypto.randomUUID(),
            status: 'pending',
            plan_json: {
              triggered_by: 'brain_mini_analysis',
              reason: reason || 'Brain Mini analysis via Chat Assistant',
              direction_id: direction_id || null,
              proposals: result.proposals.map(p => ({
                action: p.action,
                entity_type: p.entity_type,
                entity_id: p.entity_id,
                entity_name: p.entity_name,
                direction_id: p.direction_id,
                direction_name: p.direction_name,
                reason: p.reason,
                priority: p.priority,
                health_score: p.health_score,
                hs_class: p.hs_class,
                metrics: p.metrics,
                suggested_action_params: p.suggested_action_params
              }))
            },
            report_text: `Brain Mini analysis: ${result.proposals.length} proposals awaiting approval`,
            actions_taken: 0,
            actions_failed: 0
          });
          logger.info({
            where: 'triggerBrainOptimizationRun',
            phase: 'proposals_saved',
            executionId,
            proposalsCount: result.proposals.length
          }, `Proposals saved to brain_executions for approval`);
        } catch (saveError) {
          logger.error({ error: saveError.message }, 'Failed to save proposals to brain_executions');
        }
      }

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

  /**
   * Approve and execute selected Brain optimization proposals
   * Loads proposals from the last brain_execution (or by execution_id),
   * filters by stepIndices, then calls triggerBrainOptimizationRun fast path
   */
  async approveBrainActions({ stepIndices, execution_id, direction_id, campaign_id }, context) {
    const { userAccountId, adAccountDbId } = context;

    try {
      // Загрузить последнее brain_execution с proposals
      let query = supabase
        .from('brain_executions')
        .select('id, plan_json, status, created_at')
        .eq('user_account_id', userAccountId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (execution_id) {
        query = supabase
          .from('brain_executions')
          .select('id, plan_json, status, created_at')
          .eq('id', execution_id)
          .eq('user_account_id', userAccountId)
          .limit(1);
      }

      if (adAccountDbId) {
        query = query.eq('account_id', adAccountDbId);
      }

      const { data: executions, error: execError } = await query;

      if (execError || !executions || executions.length === 0) {
        return { success: false, error: 'Не найдено предыдущее выполнение Brain оптимизации. Сначала запустите triggerBrainOptimizationRun с dry_run=true.' };
      }

      const execution = executions[0];
      const proposals = execution.plan_json?.proposals;

      if (!proposals || !Array.isArray(proposals) || proposals.length === 0) {
        return { success: false, error: 'В последнем выполнении не найдены proposals для одобрения.' };
      }

      // Валидация индексов
      const invalidIndices = stepIndices.filter(i => i < 0 || i >= proposals.length);
      if (invalidIndices.length > 0) {
        return { success: false, error: `Невалидные индексы: ${invalidIndices.join(', ')}. Допустимый диапазон: 0-${proposals.length - 1}` };
      }

      // Отфильтровать proposals по stepIndices
      const selectedProposals = stepIndices.map(i => proposals[i]);

      logger.info({
        where: 'approveBrainActions',
        executionId: execution.id,
        totalProposals: proposals.length,
        selectedCount: selectedProposals.length,
        stepIndices,
        userAccountId,
      }, `Approving ${selectedProposals.length}/${proposals.length} proposals`);

      // Вызвать triggerBrainOptimizationRun fast path с отобранными proposals
      const result = await adsHandlers.triggerBrainOptimizationRun(
        {
          direction_id: direction_id || null,
          campaign_id: campaign_id || null,
          dry_run: false,
          reason: `Approved ${selectedProposals.length} proposals from execution ${execution.id}`,
          proposals: selectedProposals,
        },
        context
      );

      return result;
    } catch (error) {
      logger.error({ error: error.message, userAccountId }, 'approveBrainActions failed');
      return { success: false, error: `Ошибка выполнения: ${error.message}` };
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

    logger.info({
      handler: 'getDirectionInsights',
      direction_id,
      period,
      date_from,
      date_to,
      compare,
      dbAccountId,
      filterMode: dbAccountId ? 'multi_account' : 'legacy'
    }, 'getDirectionInsights: начало операции');

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
    // Мультиаккаунтность: проверяем владение направлением через account_id
    let dirQuery = supabase
      .from('account_directions')
      .select('id, name, target_cpl_cents, daily_budget_cents')
      .eq('id', direction_id);

    if (dbAccountId) {
      dirQuery = dirQuery.eq('account_id', dbAccountId);
    } else {
      dirQuery = dirQuery.is('account_id', null);
    }

    const { data: direction } = await dirQuery.single();

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
  // INSIGHTS BREAKDOWN (stats with breakdowns)
  // ============================================================

  async getInsightsBreakdown({ breakdown, entity_type, entity_id, period, date_from, date_to }, { accessToken, adAccountId }) {
    const actId = adAccountId?.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    if (entity_type !== 'account' && !entity_id) {
      return { success: false, error: 'entity_id обязателен для entity_type campaign/adset' };
    }

    const { since, until } = getDateRangeWithDates({ date_from, date_to, period });
    const basePath = entity_type === 'account' ? actId : entity_id;

    logger.info({ breakdown, entity_type, entity_id: entity_id || actId, since, until }, 'getInsightsBreakdown: requesting');

    try {
      const result = await fbGraph('GET', `${basePath}/insights`, accessToken, {
        fields: 'spend,impressions,clicks,cpm,cpc,ctr,reach,frequency,actions,cost_per_action_type',
        breakdowns: breakdown,
        action_breakdowns: 'action_type',
        time_range: JSON.stringify({ since, until }),
        limit: 200,
      });

      const LEAD_ACTION_TYPES = [
        'onsite_conversion.total_messaging_connection',
        'offsite_conversion.fb_pixel_lead',
        'onsite_conversion.lead_grouped',
      ];

      const rows = (result.data || []).map(row => {
        const spend = parseFloat(row.spend || 0);
        let leads = 0;
        if (row.actions) {
          for (const action of row.actions) {
            if (LEAD_ACTION_TYPES.includes(action.action_type)) {
              leads += parseInt(action.value || 0);
            }
          }
        }
        return {
          ...Object.fromEntries(breakdown.split(',').map(b => [b, row[b]])),
          spend: spend.toFixed(2),
          impressions: parseInt(row.impressions || 0),
          clicks: parseInt(row.clicks || 0),
          cpm: parseFloat(row.cpm || 0).toFixed(2),
          cpc: parseFloat(row.cpc || 0).toFixed(2),
          ctr: parseFloat(row.ctr || 0).toFixed(2),
          reach: parseInt(row.reach || 0),
          leads,
          cpl: leads > 0 ? (spend / leads).toFixed(2) : null,
        };
      });

      logger.info({ breakdown, entity_type, total_rows: rows.length, since, until }, 'getInsightsBreakdown: success');
      return {
        success: true,
        breakdown,
        entity_type,
        period: { since, until },
        data: rows,
        total_rows: rows.length,
      };
    } catch (error) {
      logger.error({ error: error.message, breakdown, entity_type, entity_id: entity_id || actId }, 'getInsightsBreakdown failed');
      return { success: false, error: error.message };
    }
  },

  // ============================================================
  // DIRECT FB ENTITY MODIFICATIONS
  // ============================================================

  async updateTargeting({ adset_id, age_min, age_max, genders, countries, cities, dry_run }, { accessToken }) {
    // Validate at least one change is requested
    if (age_min === undefined && age_max === undefined && genders === undefined && countries === undefined && cities === undefined) {
      return { success: false, error: 'Укажите хотя бы один параметр для изменения (age_min, age_max, genders, countries, cities)' };
    }

    logger.info({ adset_id, age_min, age_max, genders, countries: countries?.length, cities: cities?.length, dry_run }, 'updateTargeting: starting');

    try {
      const current = await fbGraph('GET', adset_id, accessToken, { fields: 'targeting,name,status' });
      const targeting = { ...(current.targeting || {}) };

      if (age_min !== undefined) targeting.age_min = age_min;
      if (age_max !== undefined) targeting.age_max = age_max;
      if (genders !== undefined) targeting.genders = genders;
      if (countries !== undefined) {
        targeting.geo_locations = { ...(targeting.geo_locations || {}), countries };
      }
      if (cities !== undefined) {
        targeting.geo_locations = { ...(targeting.geo_locations || {}), cities };
      }

      if (dry_run) {
        logger.info({ adset_id, adset_name: current.name }, 'updateTargeting: dry_run preview');
        return { success: true, dry_run: true, adset_name: current.name, status: current.status, current_targeting: current.targeting, proposed_targeting: targeting };
      }

      await fbGraph('POST', adset_id, accessToken, { targeting: JSON.stringify(targeting) });
      const after = await fbGraph('GET', adset_id, accessToken, { fields: 'targeting' });

      logger.info({ adset_id, adset_name: current.name }, 'updateTargeting: applied successfully');
      return { success: true, adset_name: current.name, before: current.targeting, after: after.targeting };
    } catch (error) {
      logger.error({ error: error.message, adset_id }, 'updateTargeting failed');
      return { success: false, error: error.message };
    }
  },

  async updateSchedule({ adset_id, start_time, end_time, dry_run }, { accessToken }) {
    if (start_time === undefined && end_time === undefined) {
      return { success: false, error: 'Укажите хотя бы start_time или end_time' };
    }

    logger.info({ adset_id, start_time, end_time, dry_run }, 'updateSchedule: starting');

    try {
      const current = await fbGraph('GET', adset_id, accessToken, { fields: 'start_time,end_time,name,status' });

      if (dry_run) {
        logger.info({ adset_id, adset_name: current.name }, 'updateSchedule: dry_run preview');
        return { success: true, dry_run: true, adset_name: current.name, status: current.status, current: { start_time: current.start_time, end_time: current.end_time }, proposed: { start_time, end_time } };
      }

      const updates = {};
      if (start_time !== undefined) updates.start_time = start_time;
      if (end_time !== undefined) updates.end_time = end_time;

      await fbGraph('POST', adset_id, accessToken, updates);
      const after = await fbGraph('GET', adset_id, accessToken, { fields: 'start_time,end_time' });

      logger.info({ adset_id, adset_name: current.name, before_start: current.start_time, after_start: after.start_time }, 'updateSchedule: applied successfully');
      return { success: true, adset_name: current.name, before: { start_time: current.start_time, end_time: current.end_time }, after: { start_time: after.start_time, end_time: after.end_time } };
    } catch (error) {
      logger.error({ error: error.message, adset_id }, 'updateSchedule failed');
      return { success: false, error: error.message };
    }
  },

  async updateBidStrategy({ adset_id, bid_strategy, bid_amount, dry_run }, { accessToken }) {
    if (bid_strategy === undefined && bid_amount === undefined) {
      return { success: false, error: 'Укажите хотя бы bid_strategy или bid_amount' };
    }

    // Validate: bid_amount requires BID_CAP or COST_CAP
    if (bid_amount !== undefined && bid_strategy === 'LOWEST_COST_WITHOUT_CAP') {
      return { success: false, error: 'bid_amount не используется с LOWEST_COST_WITHOUT_CAP' };
    }

    logger.info({ adset_id, bid_strategy, bid_amount, dry_run }, 'updateBidStrategy: starting');

    try {
      const current = await fbGraph('GET', adset_id, accessToken, { fields: 'bid_strategy,bid_amount,name,status' });

      if (dry_run) {
        logger.info({ adset_id, adset_name: current.name }, 'updateBidStrategy: dry_run preview');
        return { success: true, dry_run: true, adset_name: current.name, status: current.status, current: { bid_strategy: current.bid_strategy, bid_amount: current.bid_amount }, proposed: { bid_strategy, bid_amount } };
      }

      const updates = {};
      if (bid_strategy !== undefined) updates.bid_strategy = bid_strategy;
      if (bid_amount !== undefined) updates.bid_amount = bid_amount;

      await fbGraph('POST', adset_id, accessToken, updates);
      const after = await fbGraph('GET', adset_id, accessToken, { fields: 'bid_strategy,bid_amount' });

      logger.info({ adset_id, adset_name: current.name, new_strategy: after.bid_strategy, new_amount: after.bid_amount }, 'updateBidStrategy: applied successfully');
      return { success: true, adset_name: current.name, before: { bid_strategy: current.bid_strategy, bid_amount: current.bid_amount }, after: { bid_strategy: after.bid_strategy, bid_amount: after.bid_amount } };
    } catch (error) {
      logger.error({ error: error.message, adset_id }, 'updateBidStrategy failed');
      return { success: false, error: error.message };
    }
  },

  async renameEntity({ entity_id, entity_type, new_name }, { accessToken }) {
    logger.info({ entity_id, entity_type, new_name }, 'renameEntity: starting');

    try {
      const current = await fbGraph('GET', entity_id, accessToken, { fields: 'name' });

      if (current.name === new_name) {
        logger.info({ entity_id, entity_type }, 'renameEntity: name already matches, skipping');
        return { success: true, entity_type, old_name: current.name, new_name, note: 'Имя уже совпадает, изменение не требуется' };
      }

      await fbGraph('POST', entity_id, accessToken, { name: new_name });
      const after = await fbGraph('GET', entity_id, accessToken, { fields: 'name' });

      logger.info({ entity_id, entity_type, old_name: current.name, new_name: after.name }, 'renameEntity: applied successfully');
      return { success: true, entity_type, old_name: current.name, new_name: after.name };
    } catch (error) {
      logger.error({ error: error.message, entity_id, entity_type }, 'renameEntity failed');
      return { success: false, error: error.message };
    }
  },

  async updateCampaignBudget({ campaign_id, daily_budget, lifetime_budget, dry_run }, { accessToken }) {
    if (daily_budget === undefined && lifetime_budget === undefined) {
      return { success: false, error: 'Укажите хотя бы daily_budget или lifetime_budget' };
    }

    logger.info({ campaign_id, daily_budget, lifetime_budget, dry_run }, 'updateCampaignBudget: starting');

    try {
      const current = await fbGraph('GET', campaign_id, accessToken, { fields: 'name,daily_budget,lifetime_budget,status' });

      if (dry_run) {
        logger.info({ campaign_id, campaign_name: current.name }, 'updateCampaignBudget: dry_run preview');
        return { success: true, dry_run: true, campaign_name: current.name, status: current.status, current: { daily_budget: current.daily_budget, lifetime_budget: current.lifetime_budget }, proposed: { daily_budget, lifetime_budget } };
      }

      const updates = {};
      if (daily_budget !== undefined) updates.daily_budget = daily_budget;
      if (lifetime_budget !== undefined) updates.lifetime_budget = lifetime_budget;

      await fbGraph('POST', campaign_id, accessToken, updates);
      const after = await fbGraph('GET', campaign_id, accessToken, { fields: 'daily_budget,lifetime_budget' });

      logger.info({ campaign_id, campaign_name: current.name, before_daily: current.daily_budget, after_daily: after.daily_budget }, 'updateCampaignBudget: applied successfully');
      return { success: true, campaign_name: current.name, before: { daily_budget: current.daily_budget, lifetime_budget: current.lifetime_budget }, after: { daily_budget: after.daily_budget, lifetime_budget: after.lifetime_budget } };
    } catch (error) {
      logger.error({ error: error.message, campaign_id }, 'updateCampaignBudget failed');
      return { success: false, error: error.message };
    }
  },

  // ============================================================
  // CUSTOM FB API QUERY (direct executor — no LLM, Claude builds params)
  // ============================================================

  async customFbQuery({ endpoint, method, fields, params }, { accessToken, adAccountId }) {
    if (!endpoint || typeof endpoint !== 'string') {
      return { success: false, error: 'endpoint обязателен' };
    }

    const actId = adAccountId?.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const resolvedMethod = method || 'GET';

    // Replace 'account' prefix with actual act_id
    const resolvedEndpoint = endpoint.replace(/^account\b\/?/, `${actId}/`);

    // Validate endpoint: must be alphanumeric with slashes, underscores, dots (FB API IDs and paths)
    if (!/^[\w./,-]+$/.test(resolvedEndpoint)) {
      logger.warn({ endpoint: resolvedEndpoint }, 'customFbQuery: invalid endpoint characters');
      return { success: false, error: 'Недопустимые символы в endpoint' };
    }

    const apiParams = { ...(params || {}) };
    if (fields) apiParams.fields = fields;

    // Serialize time_range if it's an object
    if (apiParams.time_range && typeof apiParams.time_range === 'object') {
      apiParams.time_range = JSON.stringify(apiParams.time_range);
    }
    // Serialize filtering if it's an object/array
    if (apiParams.filtering && typeof apiParams.filtering === 'object') {
      apiParams.filtering = JSON.stringify(apiParams.filtering);
    }

    logger.info({ endpoint: resolvedEndpoint, method: resolvedMethod, fields, hasParams: !!params }, 'customFbQuery: executing');

    try {
      const result = await fbGraph(resolvedMethod, resolvedEndpoint, accessToken, apiParams);
      const data = result.data || result;
      logger.info({ endpoint: resolvedEndpoint, method: resolvedMethod, resultCount: Array.isArray(data) ? data.length : 1 }, 'customFbQuery: success');
      return {
        success: true,
        data,
        source: 'custom_fb_query',
      };
    } catch (error) {
      logger.error({ error: error.message, endpoint: resolvedEndpoint, method: resolvedMethod }, 'customFbQuery failed');
      return { success: false, error: error.message, endpoint: resolvedEndpoint };
    }
  },

  // ============================================================
  // DIRECT FB CAMPAIGN MANAGEMENT (без привязки к directions)
  // ============================================================

  /**
   * Pause a Facebook campaign directly via FB Graph API
   * Works with any campaign, not just direction-linked ones
   */
  async pauseCampaign({ campaign_id, reason }, { accessToken, adAccountId }) {
    // Get current status before change
    let campaignInfo = null;
    try {
      campaignInfo = await fbGraph('GET', campaign_id, accessToken, { fields: 'name,status,effective_status' });
    } catch (e) {
      return { success: false, error: `Не удалось получить информацию о кампании ${campaign_id}: ${e.message}` };
    }

    if (campaignInfo.status === 'PAUSED') {
      return {
        success: true,
        message: `Кампания "${campaignInfo.name}" уже на паузе`,
        campaign: { id: campaign_id, name: campaignInfo.name, status: 'PAUSED' }
      };
    }

    try {
      await fbGraph('POST', campaign_id, accessToken, { status: 'PAUSED' });
    } catch (e) {
      return { success: false, error: `Не удалось поставить кампанию на паузу: ${e.message}` };
    }

    // Verify
    let afterStatus = null;
    try {
      const after = await fbGraph('GET', campaign_id, accessToken, { fields: 'status' });
      afterStatus = after.status;
    } catch (e) { /* ignore */ }

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Campaign paused directly: ${campaignInfo.name} (${campaign_id})`,
      context: { campaign_id, reason, before: campaignInfo.status, after: afterStatus, source: 'chat_assistant' }
    });

    return {
      success: true,
      message: `Кампания "${campaignInfo.name}" поставлена на паузу в Facebook Ads Manager`,
      campaign: { id: campaign_id, name: campaignInfo.name, before: campaignInfo.status, after: afterStatus || 'PAUSED' }
    };
  },

  /**
   * Resume a Facebook campaign directly via FB Graph API
   * Works with any campaign, not just direction-linked ones
   */
  async resumeCampaign({ campaign_id }, { accessToken, adAccountId }) {
    // Get current status before change
    let campaignInfo = null;
    try {
      campaignInfo = await fbGraph('GET', campaign_id, accessToken, { fields: 'name,status,effective_status' });
    } catch (e) {
      return { success: false, error: `Не удалось получить информацию о кампании ${campaign_id}: ${e.message}` };
    }

    if (campaignInfo.status === 'ACTIVE') {
      return {
        success: true,
        message: `Кампания "${campaignInfo.name}" уже активна`,
        campaign: { id: campaign_id, name: campaignInfo.name, status: 'ACTIVE', effective_status: campaignInfo.effective_status }
      };
    }

    try {
      await fbGraph('POST', campaign_id, accessToken, { status: 'ACTIVE' });
    } catch (e) {
      return { success: false, error: `Не удалось включить кампанию: ${e.message}` };
    }

    // Verify
    let afterStatus = null;
    try {
      const after = await fbGraph('GET', campaign_id, accessToken, { fields: 'status,effective_status' });
      afterStatus = after.status;
    } catch (e) { /* ignore */ }

    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Campaign resumed directly: ${campaignInfo.name} (${campaign_id})`,
      context: { campaign_id, before: campaignInfo.status, after: afterStatus, source: 'chat_assistant' }
    });

    return {
      success: true,
      message: `Кампания "${campaignInfo.name}" включена в Facebook Ads Manager`,
      campaign: { id: campaign_id, name: campaignInfo.name, before: campaignInfo.status, after: afterStatus || 'ACTIVE' }
    };
  },

  // ============================================================
  // AI LAUNCH — proxy to agent-service auto-launch-v2
  // ============================================================

  /**
   * AI Launch: GPT-4o выбирает лучшие креативы, паузит старые адсеты,
   * создаёт новые для ВСЕХ активных направлений пользователя.
   * Proxy to agent-service /api/campaign-builder/auto-launch-v2
   */
  async aiLaunch({ start_mode }, { userAccountId, adAccountDbId }) {
    logger.info({
      handler: 'aiLaunch',
      start_mode,
      proxy: 'agent-service/auto-launch-v2',
    }, 'aiLaunch: proxying to agent-service');

    try {
      const payload = {
        user_account_id: userAccountId,
        account_id: adAccountDbId || null,
        start_mode: start_mode || 'now',
      };

      logger.info({ handler: 'aiLaunch', payload_start_mode: payload.start_mode }, 'aiLaunch: sending payload');

      const res = await axios.post(
        `${AGENT_SERVICE_URL}/campaign-builder/auto-launch-v2`,
        payload,
        { timeout: 180_000 }
      );

      const data = res.data;

      return {
        success: data.success,
        message: data.message,
        total_directions: data.results?.length || 0,
        results: data.results?.map(r => ({
          direction: r.direction_name,
          direction_id: r.direction_id,
          status: r.status,
          mode: r.mode,
          reasoning: r.reasoning,
          ads_created: r.ads_created,
          adset_name: r.adset_name,
          daily_budget_cents: r.daily_budget_cents,
          error: r.error,
        })),
      };
    } catch (error) {
      const errMsg = error.response?.data?.error || error.response?.data?.message || error.message;
      logger.error({ handler: 'aiLaunch', error: errMsg }, 'aiLaunch: proxy call failed');
      return { success: false, error: `Ошибка AI запуска: ${errMsg}` };
    }
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
  },

  /**
   * Генерирует детальный отчёт для fast path execution
   */
  generateDetailedFastPathReport(executionResults, proposals, successCount) {
    const ACTION_LABELS = {
      updateBudget: '💰 Изменение бюджета',
      pauseAdSet: '⏸️ Пауза группы',
      pauseAd: '⏸️ Пауза объявления',
      enableAdSet: '▶️ Включение группы',
      enableAd: '▶️ Включение объявления',
      createAdSet: '➕ Создание группы',
      launchNewCreatives: '🚀 Запуск креативов',
      review: '👀 Требует внимания'
    };

    const lines = [];
    const total = executionResults.length;
    const failCount = total - successCount;

    // Заголовок
    if (failCount === 0) {
      lines.push(`✅ Brain Mini: все ${total} действий выполнены успешно`);
    } else {
      lines.push(`⚠️ Brain Mini: ${successCount}/${total} действий выполнено`);
    }
    lines.push('');

    // Группируем по direction_name
    const grouped = new Map();
    for (let i = 0; i < executionResults.length; i++) {
      const r = executionResults[i];
      const p = proposals[i];
      const dirName = p?.direction_name || r?.proposal?.direction_name || 'Общие';
      if (!grouped.has(dirName)) grouped.set(dirName, []);
      grouped.get(dirName).push({ result: r, proposal: p });
    }

    for (const [dirName, items] of grouped) {
      if (grouped.size > 1 || dirName !== 'Общие') {
        lines.push(`📁 ${dirName}`);
      }

      for (const { result: r, proposal: p } of items) {
        const action = p?.action || r?.proposal?.action || 'unknown';
        const label = ACTION_LABELS[action] || action;
        const icon = r.success ? '✓' : '✗';
        const entityName = p?.entity_name || r?.proposal?.entity_name || '';

        // Основная строка: действие + название сущности
        lines.push(`  ${icon} ${label}`);
        if (entityName) {
          lines.push(`    ${entityName}`);
        }

        // Детали бюджета
        const params = p?.suggested_action_params || {};
        if (action === 'updateBudget' && params.current_budget_cents && params.new_budget_cents) {
          const current = `$${(params.current_budget_cents / 100).toFixed(2)}`;
          const next = `$${(params.new_budget_cents / 100).toFixed(2)}`;
          const pct = params.increase_percent
            ? `+${params.increase_percent}%`
            : params.decrease_percent
              ? `-${params.decrease_percent}%`
              : '';
          lines.push(`    ${current} → ${next}${pct ? ` (${pct})` : ''}`);
        }

        // Причина
        if (p?.reason) {
          lines.push(`    Причина: ${p.reason}`);
        }

        // Ошибка
        if (r.error) {
          lines.push(`    ❌ ${r.error}`);
        }

        lines.push('');
      }
    }

    return lines.join('\n').trim();
  }
};
