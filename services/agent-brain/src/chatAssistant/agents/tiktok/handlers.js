/**
 * TikTokAdsAgent Handlers
 * Tool execution handlers for TikTok advertising operations
 *
 * Аналог handlers.js для Facebook
 */

import { tikTokGraph } from '../../shared/tikTokGraph.js';
import { getDateRange } from '../../shared/dateUtils.js';
import { supabase } from '../../../lib/supabaseClient.js';
import { attachRefs, buildEntityMap } from '../../shared/entityLinker.js';
import { logger } from '../../../lib/logger.js';

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

/**
 * Parse TikTok metrics from report data
 */
function parseMetrics(metrics) {
  return {
    spend: parseFloat(metrics.spend || 0),
    impressions: parseInt(metrics.impressions || 0),
    clicks: parseInt(metrics.clicks || 0),
    conversions: parseInt(metrics.conversions || metrics.total_complete_payment_rate || 0),
    cpc: parseFloat(metrics.cpc || 0),
    cpm: parseFloat(metrics.cpm || 0),
    ctr: parseFloat(metrics.ctr || 0),
    video_views: parseInt(metrics.video_views || metrics.video_play_actions || 0)
  };
}

export const tikTokHandlers = {
  // ============================================================
  // READ HANDLERS - Campaigns & AdGroups
  // ============================================================

  async getTikTokCampaigns({ period, date_from, date_to, status }, { tikTokAccessToken, tikTokAdvertiserId }) {
    const dateRange = getDateRangeWithDates({ date_from, date_to, period });

    // Get campaigns
    const campaignsResult = await tikTokGraph('GET', 'campaign/get/', tikTokAccessToken, {
      advertiser_id: tikTokAdvertiserId,
      page_size: 100
    });

    const campaigns = campaignsResult.data?.list || [];

    // Filter by status if needed
    const filteredCampaigns = status && status !== 'all'
      ? campaigns.filter(c => c.status === status)
      : campaigns;

    // Get metrics for campaigns
    const campaignIds = filteredCampaigns.map(c => c.campaign_id);
    let metricsMap = {};

    if (campaignIds.length > 0) {
      try {
        const reportResult = await tikTokGraph('POST', 'report/integrated/get/', tikTokAccessToken, {
          advertiser_id: tikTokAdvertiserId,
          report_type: 'BASIC',
          data_level: 'AUCTION_CAMPAIGN',
          dimensions: JSON.stringify(['campaign_id']),
          metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversions', 'cpc', 'cpm', 'ctr']),
          start_date: dateRange.since,
          end_date: dateRange.until,
          page_size: 100,
          filtering: JSON.stringify([{
            field_name: 'campaign_ids',
            filter_type: 'IN',
            filter_value: JSON.stringify(campaignIds)
          }])
        });

        if (reportResult.data?.list) {
          for (const row of reportResult.data.list) {
            metricsMap[row.dimensions.campaign_id] = row.metrics;
          }
        }
      } catch (err) {
        logger.warn({ error: err }, 'Failed to get TikTok campaign metrics');
      }
    }

    // Format response
    const formattedCampaigns = filteredCampaigns.map(c => {
      const metrics = metricsMap[c.campaign_id] || {};
      const parsed = parseMetrics(metrics);

      return {
        id: c.campaign_id,
        name: c.campaign_name,
        status: c.status,
        objective: c.objective_type,
        budget: c.budget,
        budget_mode: c.budget_mode,
        ...parsed,
        cpl: parsed.conversions > 0 ? (parsed.spend / parsed.conversions).toFixed(2) : null
      };
    });

    // Add entity refs for entity linking
    const campaignsWithRefs = attachRefs(formattedCampaigns, 'tc');
    const entityMap = buildEntityMap(formattedCampaigns, 'tc');

    return {
      success: true,
      platform: 'tiktok',
      period: { start: dateRange.since, end: dateRange.until },
      campaigns: campaignsWithRefs,
      total: formattedCampaigns.length,
      _entityMap: entityMap
    };
  },

  async getTikTokCampaignDetails({ campaign_id }, { tikTokAccessToken, tikTokAdvertiserId }) {
    // Get campaign info
    const campaignResult = await tikTokGraph('GET', 'campaign/get/', tikTokAccessToken, {
      advertiser_id: tikTokAdvertiserId,
      filtering: JSON.stringify({ campaign_ids: [campaign_id] })
    });

    const campaign = campaignResult.data?.list?.[0];
    if (!campaign) {
      return { success: false, error: 'Campaign not found' };
    }

    // Get ad groups
    const adGroupsResult = await tikTokGraph('GET', 'adgroup/get/', tikTokAccessToken, {
      advertiser_id: tikTokAdvertiserId,
      filtering: JSON.stringify({ campaign_ids: [campaign_id] }),
      page_size: 100
    });

    const adGroups = adGroupsResult.data?.list || [];

    // Get ads
    const adGroupIds = adGroups.map(ag => ag.adgroup_id);
    let ads = [];

    if (adGroupIds.length > 0) {
      const adsResult = await tikTokGraph('GET', 'ad/get/', tikTokAccessToken, {
        advertiser_id: tikTokAdvertiserId,
        filtering: JSON.stringify({ adgroup_ids: adGroupIds }),
        page_size: 100
      });
      ads = adsResult.data?.list || [];
    }

    return {
      success: true,
      platform: 'tiktok',
      campaign: {
        id: campaign.campaign_id,
        name: campaign.campaign_name,
        status: campaign.status,
        objective: campaign.objective_type,
        budget: campaign.budget,
        budget_mode: campaign.budget_mode,
        created_time: campaign.create_time,
        adgroups: adGroups.map(ag => ({
          id: ag.adgroup_id,
          name: ag.adgroup_name,
          status: ag.status,
          budget: ag.budget,
          optimization_goal: ag.optimization_goal
        })),
        ads: ads.map(ad => ({
          id: ad.ad_id,
          name: ad.ad_name,
          status: ad.status,
          video_id: ad.video_id
        }))
      }
    };
  },

  async getTikTokAdGroups({ campaign_id, period, date_from, date_to }, { tikTokAccessToken, tikTokAdvertiserId }) {
    const dateRange = getDateRangeWithDates({ date_from, date_to, period });

    // Get ad groups
    const result = await tikTokGraph('GET', 'adgroup/get/', tikTokAccessToken, {
      advertiser_id: tikTokAdvertiserId,
      filtering: JSON.stringify({ campaign_ids: [campaign_id] }),
      page_size: 100
    });

    const adGroups = result.data?.list || [];
    const adGroupIds = adGroups.map(ag => ag.adgroup_id);

    // Get metrics
    let metricsMap = {};
    if (adGroupIds.length > 0) {
      try {
        const reportResult = await tikTokGraph('POST', 'report/integrated/get/', tikTokAccessToken, {
          advertiser_id: tikTokAdvertiserId,
          report_type: 'BASIC',
          data_level: 'AUCTION_ADGROUP',
          dimensions: JSON.stringify(['adgroup_id']),
          metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversions', 'cpc', 'cpm', 'ctr']),
          start_date: dateRange.since,
          end_date: dateRange.until,
          page_size: 100
        });

        if (reportResult.data?.list) {
          for (const row of reportResult.data.list) {
            metricsMap[row.dimensions.adgroup_id] = row.metrics;
          }
        }
      } catch (err) {
        logger.warn({ error: err }, 'Failed to get TikTok adgroup metrics');
      }
    }

    const formattedAdGroups = adGroups.map(ag => {
      const metrics = metricsMap[ag.adgroup_id] || {};
      const parsed = parseMetrics(metrics);

      return {
        id: ag.adgroup_id,
        name: ag.adgroup_name,
        status: ag.status,
        budget: ag.budget,
        optimization_goal: ag.optimization_goal,
        ...parsed,
        cpl: parsed.conversions > 0 ? (parsed.spend / parsed.conversions).toFixed(2) : null
      };
    });

    return {
      success: true,
      platform: 'tiktok',
      campaign_id,
      adgroups: formattedAdGroups
    };
  },

  async getTikTokAds({ campaign_id, adgroup_id, period, date_from, date_to }, { tikTokAccessToken, tikTokAdvertiserId }) {
    const dateRange = getDateRangeWithDates({ date_from, date_to, period });

    // Build filtering
    const filtering = {};
    if (campaign_id) filtering.campaign_ids = [campaign_id];
    if (adgroup_id) filtering.adgroup_ids = [adgroup_id];

    // Get ads
    const result = await tikTokGraph('GET', 'ad/get/', tikTokAccessToken, {
      advertiser_id: tikTokAdvertiserId,
      filtering: Object.keys(filtering).length > 0 ? JSON.stringify(filtering) : undefined,
      page_size: 100
    });

    const ads = result.data?.list || [];
    const adIds = ads.map(ad => ad.ad_id);

    // Get metrics
    let metricsMap = {};
    if (adIds.length > 0) {
      try {
        const reportResult = await tikTokGraph('POST', 'report/integrated/get/', tikTokAccessToken, {
          advertiser_id: tikTokAdvertiserId,
          report_type: 'BASIC',
          data_level: 'AUCTION_AD',
          dimensions: JSON.stringify(['ad_id']),
          metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversions', 'cpc', 'cpm', 'ctr', 'video_play_actions']),
          start_date: dateRange.since,
          end_date: dateRange.until,
          page_size: 100
        });

        if (reportResult.data?.list) {
          for (const row of reportResult.data.list) {
            metricsMap[row.dimensions.ad_id] = row.metrics;
          }
        }
      } catch (err) {
        logger.warn({ error: err }, 'Failed to get TikTok ad metrics');
      }
    }

    const formattedAds = ads.map(ad => {
      const metrics = metricsMap[ad.ad_id] || {};
      const parsed = parseMetrics(metrics);

      return {
        id: ad.ad_id,
        name: ad.ad_name,
        status: ad.status,
        adgroup_id: ad.adgroup_id,
        video_id: ad.video_id,
        ...parsed,
        cpl: parsed.conversions > 0 ? (parsed.spend / parsed.conversions).toFixed(2) : null
      };
    });

    // Add entity refs
    const adsWithRefs = attachRefs(formattedAds, 'ta');

    return {
      success: true,
      platform: 'tiktok',
      ads: adsWithRefs,
      total: formattedAds.length
    };
  },

  async getTikTokSpendReport({ period, date_from, date_to, group_by }, { tikTokAccessToken, tikTokAdvertiserId }) {
    const dateRange = getDateRangeWithDates({ date_from, date_to, period });

    // Determine dimensions based on group_by
    const dimensions = group_by === 'day' ? ['stat_time_day'] : ['campaign_id'];
    const dataLevel = group_by === 'adgroup' ? 'AUCTION_ADGROUP' : 'AUCTION_CAMPAIGN';

    const result = await tikTokGraph('POST', 'report/integrated/get/', tikTokAccessToken, {
      advertiser_id: tikTokAdvertiserId,
      report_type: 'BASIC',
      data_level: dataLevel,
      dimensions: JSON.stringify(dimensions),
      metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversions']),
      start_date: dateRange.since,
      end_date: dateRange.until,
      page_size: 500
    });

    const rows = result.data?.list || [];

    // Calculate totals
    let totalSpend = 0;
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalConversions = 0;

    const breakdown = rows.map(row => {
      const metrics = parseMetrics(row.metrics);
      totalSpend += metrics.spend;
      totalImpressions += metrics.impressions;
      totalClicks += metrics.clicks;
      totalConversions += metrics.conversions;

      return {
        ...row.dimensions,
        ...metrics
      };
    });

    return {
      success: true,
      platform: 'tiktok',
      period: { start: dateRange.since, end: dateRange.until },
      group_by: group_by || 'campaign',
      total: {
        spend: totalSpend.toFixed(2),
        impressions: totalImpressions,
        clicks: totalClicks,
        conversions: totalConversions,
        cpl: totalConversions > 0 ? (totalSpend / totalConversions).toFixed(2) : null
      },
      breakdown
    };
  },

  // ============================================================
  // READ HANDLERS - Account & Insights
  // ============================================================

  async getTikTokAccountStatus({}, { tikTokAccessToken, tikTokAdvertiserId }) {
    const result = await tikTokGraph('GET', 'advertiser/info/', tikTokAccessToken, {
      advertiser_ids: JSON.stringify([tikTokAdvertiserId])
    });

    const advertiser = result.data?.list?.[0];
    if (!advertiser) {
      return { success: false, error: 'Advertiser not found' };
    }

    return {
      success: true,
      platform: 'tiktok',
      account: {
        id: advertiser.advertiser_id,
        name: advertiser.advertiser_name,
        status: advertiser.status,
        balance: advertiser.balance,
        currency: advertiser.currency,
        timezone: advertiser.timezone,
        can_advertise: advertiser.status === 'STATUS_ENABLE'
      }
    };
  },

  async getTikTokAdvertiserInfo({}, { tikTokAccessToken, tikTokAdvertiserId }) {
    const result = await tikTokGraph('GET', 'advertiser/info/', tikTokAccessToken, {
      advertiser_ids: JSON.stringify([tikTokAdvertiserId])
    });

    const advertiser = result.data?.list?.[0];

    return {
      success: true,
      platform: 'tiktok',
      advertiser: advertiser || null
    };
  },

  async getTikTokDirections({ status, period, date_from, date_to }, { userAccountId, tikTokAccessToken, tikTokAdvertiserId }) {
    // Get directions from Supabase
    let query = supabase
      .from('account_directions')
      .select('*')
      .eq('user_account_id', userAccountId)
      .eq('platform', 'tiktok');

    if (status && status !== 'all') {
      query = query.eq('is_active', status === 'active');
    }

    const { data: directions, error } = await query;

    if (error) {
      return { success: false, error: error.message };
    }

    // Get metrics for directions with TikTok campaigns
    const dateRange = getDateRangeWithDates({ date_from, date_to, period });
    const campaignIds = directions
      .filter(d => d.tiktok_campaign_id)
      .map(d => d.tiktok_campaign_id);

    let metricsMap = {};
    if (campaignIds.length > 0) {
      try {
        const reportResult = await tikTokGraph('POST', 'report/integrated/get/', tikTokAccessToken, {
          advertiser_id: tikTokAdvertiserId,
          report_type: 'BASIC',
          data_level: 'AUCTION_CAMPAIGN',
          dimensions: JSON.stringify(['campaign_id']),
          metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversions']),
          start_date: dateRange.since,
          end_date: dateRange.until,
          page_size: 100
        });

        if (reportResult.data?.list) {
          for (const row of reportResult.data.list) {
            metricsMap[row.dimensions.campaign_id] = row.metrics;
          }
        }
      } catch (err) {
        logger.warn({ error: err }, 'Failed to get TikTok direction metrics');
      }
    }

    const formattedDirections = directions.map(d => {
      const metrics = metricsMap[d.tiktok_campaign_id] || {};
      const parsed = parseMetrics(metrics);

      return {
        id: d.id,
        name: d.name,
        is_active: d.is_active,
        objective: d.tiktok_objective,
        daily_budget: d.tiktok_daily_budget,
        tiktok_campaign_id: d.tiktok_campaign_id,
        ...parsed,
        cpl: parsed.conversions > 0 ? (parsed.spend / parsed.conversions).toFixed(2) : null
      };
    });

    return {
      success: true,
      platform: 'tiktok',
      directions: formattedDirections,
      total: formattedDirections.length
    };
  },

  // ============================================================
  // WRITE HANDLERS - Campaigns
  // ============================================================

  async pauseTikTokCampaign({ campaign_id, reason, dry_run }, { tikTokAccessToken, tikTokAdvertiserId }) {
    if (dry_run) {
      return {
        success: true,
        dry_run: true,
        action: 'pause_campaign',
        campaign_id,
        reason,
        message: 'Would pause TikTok campaign'
      };
    }

    await tikTokGraph('POST', 'campaign/status/update/', tikTokAccessToken, {
      advertiser_id: tikTokAdvertiserId,
      campaign_ids: JSON.stringify([campaign_id]),
      status: 'DISABLE'
    });

    return {
      success: true,
      action: 'pause_campaign',
      campaign_id,
      new_status: 'DISABLE',
      reason
    };
  },

  async resumeTikTokCampaign({ campaign_id }, { tikTokAccessToken, tikTokAdvertiserId }) {
    await tikTokGraph('POST', 'campaign/status/update/', tikTokAccessToken, {
      advertiser_id: tikTokAdvertiserId,
      campaign_ids: JSON.stringify([campaign_id]),
      status: 'ENABLE'
    });

    return {
      success: true,
      action: 'resume_campaign',
      campaign_id,
      new_status: 'ENABLE'
    };
  },

  // ============================================================
  // WRITE HANDLERS - AdGroups
  // ============================================================

  async pauseTikTokAdGroup({ adgroup_id, reason, dry_run }, { tikTokAccessToken, tikTokAdvertiserId }) {
    if (dry_run) {
      return {
        success: true,
        dry_run: true,
        action: 'pause_adgroup',
        adgroup_id,
        message: 'Would pause TikTok ad group'
      };
    }

    await tikTokGraph('POST', 'adgroup/status/update/', tikTokAccessToken, {
      advertiser_id: tikTokAdvertiserId,
      adgroup_ids: JSON.stringify([adgroup_id]),
      status: 'DISABLE'
    });

    return {
      success: true,
      action: 'pause_adgroup',
      adgroup_id,
      new_status: 'DISABLE',
      reason
    };
  },

  async resumeTikTokAdGroup({ adgroup_id }, { tikTokAccessToken, tikTokAdvertiserId }) {
    await tikTokGraph('POST', 'adgroup/status/update/', tikTokAccessToken, {
      advertiser_id: tikTokAdvertiserId,
      adgroup_ids: JSON.stringify([adgroup_id]),
      status: 'ENABLE'
    });

    return {
      success: true,
      action: 'resume_adgroup',
      adgroup_id,
      new_status: 'ENABLE'
    };
  },

  async updateTikTokAdGroupBudget({ adgroup_id, new_budget, dry_run }, { tikTokAccessToken, tikTokAdvertiserId }) {
    if (dry_run) {
      return {
        success: true,
        dry_run: true,
        action: 'update_adgroup_budget',
        adgroup_id,
        new_budget,
        message: `Would update TikTok ad group budget to $${new_budget}`
      };
    }

    await tikTokGraph('POST', 'adgroup/update/', tikTokAccessToken, {
      advertiser_id: tikTokAdvertiserId,
      adgroup_id,
      budget: new_budget
    });

    return {
      success: true,
      action: 'update_adgroup_budget',
      adgroup_id,
      new_budget_usd: new_budget
    };
  },

  // ============================================================
  // WRITE HANDLERS - Ads
  // ============================================================

  async pauseTikTokAd({ ad_id, reason, dry_run }, { tikTokAccessToken, tikTokAdvertiserId }) {
    if (dry_run) {
      return {
        success: true,
        dry_run: true,
        action: 'pause_ad',
        ad_id,
        message: 'Would pause TikTok ad'
      };
    }

    await tikTokGraph('POST', 'ad/status/update/', tikTokAccessToken, {
      advertiser_id: tikTokAdvertiserId,
      ad_ids: JSON.stringify([ad_id]),
      status: 'DISABLE'
    });

    return {
      success: true,
      action: 'pause_ad',
      ad_id,
      new_status: 'DISABLE',
      reason
    };
  },

  async resumeTikTokAd({ ad_id }, { tikTokAccessToken, tikTokAdvertiserId }) {
    await tikTokGraph('POST', 'ad/status/update/', tikTokAccessToken, {
      advertiser_id: tikTokAdvertiserId,
      ad_ids: JSON.stringify([ad_id]),
      status: 'ENABLE'
    });

    return {
      success: true,
      action: 'resume_ad',
      ad_id,
      new_status: 'ENABLE'
    };
  },

  // ============================================================
  // WRITE HANDLERS - Directions
  // ============================================================

  async pauseTikTokDirection({ direction_id, reason, dry_run }, { tikTokAccessToken, tikTokAdvertiserId, userAccountId }) {
    // Get direction
    const { data: direction, error } = await supabase
      .from('account_directions')
      .select('*')
      .eq('id', direction_id)
      .eq('user_account_id', userAccountId)
      .single();

    if (error || !direction) {
      return { success: false, error: 'Direction not found' };
    }

    if (dry_run) {
      return {
        success: true,
        dry_run: true,
        action: 'pause_direction',
        direction_id,
        direction_name: direction.name,
        tiktok_campaign_id: direction.tiktok_campaign_id,
        message: 'Would pause TikTok direction and its campaign'
      };
    }

    // Pause TikTok campaign if exists
    if (direction.tiktok_campaign_id) {
      await tikTokGraph('POST', 'campaign/status/update/', tikTokAccessToken, {
        advertiser_id: tikTokAdvertiserId,
        campaign_ids: JSON.stringify([direction.tiktok_campaign_id]),
        status: 'DISABLE'
      });
    }

    // Update direction in DB
    await supabase
      .from('account_directions')
      .update({ is_active: false })
      .eq('id', direction_id);

    return {
      success: true,
      action: 'pause_direction',
      direction_id,
      direction_name: direction.name,
      reason
    };
  },

  async resumeTikTokDirection({ direction_id }, { tikTokAccessToken, tikTokAdvertiserId, userAccountId }) {
    const { data: direction, error } = await supabase
      .from('account_directions')
      .select('*')
      .eq('id', direction_id)
      .eq('user_account_id', userAccountId)
      .single();

    if (error || !direction) {
      return { success: false, error: 'Direction not found' };
    }

    // Resume TikTok campaign if exists
    if (direction.tiktok_campaign_id) {
      await tikTokGraph('POST', 'campaign/status/update/', tikTokAccessToken, {
        advertiser_id: tikTokAdvertiserId,
        campaign_ids: JSON.stringify([direction.tiktok_campaign_id]),
        status: 'ENABLE'
      });
    }

    // Update direction in DB
    await supabase
      .from('account_directions')
      .update({ is_active: true })
      .eq('id', direction_id);

    return {
      success: true,
      action: 'resume_direction',
      direction_id,
      direction_name: direction.name
    };
  },

  async updateTikTokDirectionBudget({ direction_id, new_budget, dry_run }, { tikTokAccessToken, tikTokAdvertiserId, userAccountId }) {
    const { data: direction, error } = await supabase
      .from('account_directions')
      .select('*')
      .eq('id', direction_id)
      .eq('user_account_id', userAccountId)
      .single();

    if (error || !direction) {
      return { success: false, error: 'Direction not found' };
    }

    if (dry_run) {
      return {
        success: true,
        dry_run: true,
        action: 'update_direction_budget',
        direction_id,
        direction_name: direction.name,
        current_budget: direction.tiktok_daily_budget,
        new_budget,
        message: `Would update direction budget from $${direction.tiktok_daily_budget} to $${new_budget}`
      };
    }

    // Update in Supabase
    await supabase
      .from('account_directions')
      .update({ tiktok_daily_budget: new_budget })
      .eq('id', direction_id);

    return {
      success: true,
      action: 'update_direction_budget',
      direction_id,
      direction_name: direction.name,
      old_budget: direction.tiktok_daily_budget,
      new_budget
    };
  },

  // ============================================================
  // MEDIA HANDLERS
  // ============================================================

  async uploadTikTokVideo({ video_url, video_name }, { tikTokAccessToken, tikTokAdvertiserId }) {
    const result = await tikTokGraph('POST', 'file/video/ad/upload/', tikTokAccessToken, {
      advertiser_id: tikTokAdvertiserId,
      video_url,
      file_name: video_name || 'video'
    });

    return {
      success: true,
      action: 'upload_video',
      video_id: result.data?.video_id,
      video_url
    };
  },

  async getTikTokVideos({ video_ids }, { tikTokAccessToken, tikTokAdvertiserId }) {
    const params = {
      advertiser_id: tikTokAdvertiserId,
      page_size: 100
    };

    if (video_ids && video_ids.length > 0) {
      params.video_ids = JSON.stringify(video_ids);
    }

    const result = await tikTokGraph('GET', 'file/video/ad/get/', tikTokAccessToken, params);

    return {
      success: true,
      videos: result.data?.list || [],
      total: result.data?.page_info?.total_number || 0
    };
  },

  // ============================================================
  // ROI & ANALYTICS HANDLERS
  // ============================================================

  async getTikTokROIReport({ period, date_from, date_to, direction_id }, { tikTokAccessToken, tikTokAdvertiserId, userAccountId }) {
    const dateRange = getDateRangeWithDates({ date_from, date_to, period });

    // Get report from TikTok
    const result = await tikTokGraph('POST', 'report/integrated/get/', tikTokAccessToken, {
      advertiser_id: tikTokAdvertiserId,
      report_type: 'BASIC',
      data_level: 'AUCTION_CAMPAIGN',
      dimensions: JSON.stringify(['campaign_id']),
      metrics: JSON.stringify(['spend', 'conversions', 'complete_payment_amount', 'impressions', 'clicks']),
      start_date: dateRange.since,
      end_date: dateRange.until,
      page_size: 100
    });

    const rows = result.data?.list || [];

    // Calculate ROI metrics
    let totalSpend = 0;
    let totalRevenue = 0;
    let totalConversions = 0;

    const campaigns = rows.map(row => {
      const spend = parseFloat(row.metrics.spend || 0);
      const revenue = parseFloat(row.metrics.complete_payment_amount || 0);
      const conversions = parseInt(row.metrics.conversions || 0);

      totalSpend += spend;
      totalRevenue += revenue;
      totalConversions += conversions;

      const roi = spend > 0 ? ((revenue - spend) / spend * 100) : 0;
      const roas = spend > 0 ? (revenue / spend) : 0;

      return {
        campaign_id: row.dimensions.campaign_id,
        spend,
        revenue,
        conversions,
        roi: roi.toFixed(2),
        roas: roas.toFixed(2),
        cpl: conversions > 0 ? (spend / conversions).toFixed(2) : null
      };
    });

    const totalRoi = totalSpend > 0 ? ((totalRevenue - totalSpend) / totalSpend * 100) : 0;
    const totalRoas = totalSpend > 0 ? (totalRevenue / totalSpend) : 0;

    return {
      success: true,
      platform: 'tiktok',
      period: { start: dateRange.since, end: dateRange.until },
      total: {
        spend: totalSpend.toFixed(2),
        revenue: totalRevenue.toFixed(2),
        conversions: totalConversions,
        roi: totalRoi.toFixed(2),
        roas: totalRoas.toFixed(2)
      },
      campaigns
    };
  },

  async compareTikTokWithFacebook({ period, date_from, date_to, metrics }, { tikTokAccessToken, tikTokAdvertiserId, accessToken, adAccountId }) {
    const dateRange = getDateRangeWithDates({ date_from, date_to, period });
    const requestedMetrics = metrics || ['spend', 'impressions', 'clicks', 'conversions'];

    // Get TikTok metrics
    let tikTokData = { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
    try {
      const ttResult = await tikTokGraph('POST', 'report/integrated/get/', tikTokAccessToken, {
        advertiser_id: tikTokAdvertiserId,
        report_type: 'BASIC',
        data_level: 'AUCTION_ADVERTISER',
        dimensions: JSON.stringify(['advertiser_id']),
        metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversions']),
        start_date: dateRange.since,
        end_date: dateRange.until,
        page_size: 1
      });

      if (ttResult.data?.list?.[0]) {
        const m = ttResult.data.list[0].metrics;
        tikTokData = parseMetrics(m);
      }
    } catch (err) {
      logger.warn({ error: err }, 'Failed to get TikTok comparison data');
    }

    // Note: Facebook data would need fbGraph import
    // For now, return TikTok-only comparison structure
    return {
      success: true,
      period: { start: dateRange.since, end: dateRange.until },
      comparison: {
        tiktok: {
          spend: tikTokData.spend.toFixed(2),
          impressions: tikTokData.impressions,
          clicks: tikTokData.clicks,
          conversions: tikTokData.conversions,
          ctr: tikTokData.clicks > 0 && tikTokData.impressions > 0
            ? ((tikTokData.clicks / tikTokData.impressions) * 100).toFixed(2)
            : '0',
          cpm: tikTokData.impressions > 0
            ? ((tikTokData.spend / tikTokData.impressions) * 1000).toFixed(2)
            : '0',
          cpl: tikTokData.conversions > 0
            ? (tikTokData.spend / tikTokData.conversions).toFixed(2)
            : null
        },
        facebook: {
          message: 'Facebook comparison requires fbGraph import - implement if needed'
        }
      }
    };
  }
};

export default tikTokHandlers;
