/**
 * TikTok Metrics Collector
 *
 * Собирает метрики из TikTok Ads API и сохраняет в creative_metrics_history
 * с platform = 'tiktok'
 *
 * Используется в batch процессах для синхронизации TikTok данных
 */

import { getTikTokReport, getTikTokAds } from './chatAssistant/shared/tikTokGraph.js';
import { createClient } from '@supabase/supabase-js';
import { logger } from './lib/logger.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

/**
 * Собрать метрики TikTok для рекламного аккаунта
 *
 * @param {string} advertiserId - TikTok Advertiser ID
 * @param {string} accessToken - TikTok Access Token
 * @param {string} userAccountId - UUID пользователя в системе
 * @param {string|null} accountId - UUID рекламного аккаунта (для мультиаккаунтности, null для legacy)
 * @param {object} options - Опции
 * @param {string} options.startDate - Дата начала (YYYY-MM-DD)
 * @param {string} options.endDate - Дата конца (YYYY-MM-DD)
 * @returns {Promise<{success: boolean, metricsCollected: number, errors: string[]}>}
 */
export async function collectTikTokMetrics(advertiserId, accessToken, userAccountId, accountId = null, options = {}) {
  const startTime = Date.now();
  const errors = [];
  let metricsCollected = 0;

  // Default: yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const defaultDate = yesterday.toISOString().split('T')[0];

  const { startDate = defaultDate, endDate = defaultDate } = options;

  logger.info({
    where: 'tiktokMetricsCollector',
    advertiserId,
    userAccountId,
    accountId,
    startDate,
    endDate
  }, 'Starting TikTok metrics collection');

  try {
    // Step 1: Get report at AUCTION_AD level
    const reportResult = await getTikTokReport(advertiserId, accessToken, {
      dataLevel: 'AUCTION_AD',
      dimensions: ['ad_id', 'stat_time_day'],
      metrics: [
        'spend',
        'impressions',
        'reach',
        'clicks',
        'ctr',
        'cpm',
        'cpc',
        'conversion',           // Conversions (leads for lead gen campaigns)
        'cost_per_conversion',  // CPL
        'frequency',
        'video_play_actions',
        'video_watched_2s',
        'video_watched_6s',
        'video_views_p25',
        'video_views_p50',
        'video_views_p75',
        'video_views_p100',
        'average_video_play',   // Average watch time
        'average_video_play_per_user'
      ],
      startDate,
      endDate
    });

    const reportData = reportResult.data?.list || [];

    logger.info({
      where: 'tiktokMetricsCollector',
      advertiserId,
      reportRowsCount: reportData.length
    }, 'TikTok report data fetched');

    if (reportData.length === 0) {
      logger.info({
        where: 'tiktokMetricsCollector',
        advertiserId
      }, 'No TikTok report data found for the date range');
      return { success: true, metricsCollected: 0, errors: [] };
    }

    // Step 2: Get ads to map ad_id -> adgroup_id, campaign_id
    const ads = await getTikTokAds(advertiserId, accessToken, { pageSize: 500 });
    const adMap = new Map();
    for (const ad of ads) {
      adMap.set(ad.ad_id, {
        adgroup_id: ad.adgroup_id,
        campaign_id: ad.campaign_id,
        ad_name: ad.ad_name
      });
    }

    logger.info({
      where: 'tiktokMetricsCollector',
      advertiserId,
      adsCount: ads.length
    }, 'TikTok ads fetched for mapping');

    // Step 3: Transform and save metrics
    for (const row of reportData) {
      try {
        const adId = row.dimensions?.ad_id;
        const statDate = row.dimensions?.stat_time_day;

        if (!adId || !statDate) {
          logger.warn({
            where: 'tiktokMetricsCollector',
            row: JSON.stringify(row).slice(0, 200)
          }, 'Skipping row without ad_id or date');
          continue;
        }

        const adInfo = adMap.get(adId) || {};
        const metrics = row.metrics || {};

        // Map TikTok metrics to creative_metrics_history schema
        // TikTok returns spend in local currency (KZT), not cents
        const spendKzt = parseFloat(metrics.spend || '0');
        const impressions = parseInt(metrics.impressions || '0', 10);
        const reach = parseInt(metrics.reach || '0', 10);
        const clicks = parseInt(metrics.clicks || '0', 10);
        const conversions = parseInt(metrics.conversion || '0', 10); // Leads
        const ctr = parseFloat(metrics.ctr || '0');
        const cpm = parseFloat(metrics.cpm || '0');
        const cpl = parseFloat(metrics.cost_per_conversion || '0');
        const frequency = parseFloat(metrics.frequency || '0');

        // Video metrics
        const videoPlays = parseInt(metrics.video_play_actions || '0', 10);
        const video25 = parseInt(metrics.video_views_p25 || '0', 10);
        const video50 = parseInt(metrics.video_views_p50 || '0', 10);
        const video75 = parseInt(metrics.video_views_p75 || '0', 10);
        const video100 = parseInt(metrics.video_views_p100 || '0', 10);
        const avgWatchTime = parseFloat(metrics.average_video_play || '0'); // in seconds

        const metricsRecord = {
          user_account_id: userAccountId,
          account_id: accountId, // NULL for legacy, UUID for multi-account
          date: statDate,
          ad_id: adId,
          adset_id: adInfo.adgroup_id || null,
          campaign_id: adInfo.campaign_id || null,
          platform: 'tiktok',
          // Spend: store in KZT as-is (TikTok uses KZT)
          spend: spendKzt,
          impressions,
          reach,
          clicks,
          link_clicks: clicks, // TikTok doesn't separate link clicks
          leads: conversions,
          ctr,
          cpm,
          cpl: conversions > 0 ? cpl : null,
          frequency,
          // Video metrics
          video_views: videoPlays,
          video_views_25_percent: video25,
          video_views_50_percent: video50,
          video_views_75_percent: video75,
          video_views_95_percent: video100, // Using 100% as closest to 95%
          video_avg_watch_time_sec: avgWatchTime,
          source: 'tiktok_batch'
        };

        // Upsert to creative_metrics_history
        const { error: upsertError } = await supabase
          .from('creative_metrics_history')
          .upsert(metricsRecord, {
            onConflict: 'user_account_id,ad_id,date,platform',
            ignoreDuplicates: false
          });

        if (upsertError) {
          logger.warn({
            where: 'tiktokMetricsCollector',
            adId,
            date: statDate,
            error: upsertError.message
          }, 'Failed to upsert TikTok metrics');
          errors.push(`ad_id=${adId}: ${upsertError.message}`);
        } else {
          metricsCollected++;
        }
      } catch (rowError) {
        logger.warn({
          where: 'tiktokMetricsCollector',
          error: rowError.message
        }, 'Error processing TikTok report row');
        errors.push(rowError.message);
      }
    }

    const duration = Date.now() - startTime;

    logger.info({
      where: 'tiktokMetricsCollector',
      advertiserId,
      userAccountId,
      metricsCollected,
      errorsCount: errors.length,
      durationMs: duration
    }, 'TikTok metrics collection completed');

    return {
      success: errors.length === 0,
      metricsCollected,
      errors
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error({
      where: 'tiktokMetricsCollector',
      advertiserId,
      userAccountId,
      error: error.message,
      durationMs: duration
    }, 'TikTok metrics collection failed');

    return {
      success: false,
      metricsCollected,
      errors: [error.message]
    };
  }
}

/**
 * Собрать метрики TikTok для нескольких дней
 *
 * @param {string} advertiserId - TikTok Advertiser ID
 * @param {string} accessToken - TikTok Access Token
 * @param {string} userAccountId - UUID пользователя
 * @param {string|null} accountId - UUID рекламного аккаунта
 * @param {number} days - Количество дней (по умолчанию 7)
 * @returns {Promise<{success: boolean, totalMetrics: number, errors: string[]}>}
 */
export async function collectTikTokMetricsForDays(advertiserId, accessToken, userAccountId, accountId = null, days = 7) {
  logger.info({
    where: 'tiktokMetricsCollector',
    advertiserId,
    userAccountId,
    days
  }, 'Starting TikTok metrics collection for multiple days');

  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 1); // Yesterday
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days + 1);

  const result = await collectTikTokMetrics(
    advertiserId,
    accessToken,
    userAccountId,
    accountId,
    {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0]
    }
  );

  return {
    success: result.success,
    totalMetrics: result.metricsCollected,
    errors: result.errors
  };
}

export default {
  collectTikTokMetrics,
  collectTikTokMetricsForDays
};
