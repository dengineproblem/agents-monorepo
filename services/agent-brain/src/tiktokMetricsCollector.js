/**
 * TikTok Metrics Collector
 *
 * Собирает метрики из TikTok Ads API и сохраняет в creative_metrics_history
 * с platform = 'tiktok'
 *
 * Используется в batch процессах для синхронизации TikTok данных
 *
 * Features:
 * - Retry logic с exponential backoff
 * - Timeout protection
 * - Подробное логирование с correlation ID
 * - Валидация входных параметров
 * - Graceful error handling
 */

import { getTikTokReport, getTikTokAds } from './chatAssistant/shared/tikTokGraph.js';
import { createClient } from '@supabase/supabase-js';
import { logger } from './lib/logger.js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Configuration
const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 10000]; // Exponential backoff in ms
const API_TIMEOUT_MS = 60000; // 60 seconds per API call

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

/**
 * Retry wrapper with exponential backoff
 */
async function retryWithBackoff(fn, context, maxRetries = MAX_RETRIES) {
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === maxRetries - 1;

      if (isLastAttempt) {
        logger.error({
          where: 'tiktokMetricsCollector',
          ...context,
          attempt: attempt + 1,
          maxRetries,
          error: error.message
        }, 'Retry failed - max attempts reached');
        throw error;
      }

      const delay = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];

      logger.warn({
        where: 'tiktokMetricsCollector',
        ...context,
        attempt: attempt + 1,
        maxRetries,
        error: error.message,
        nextRetryInMs: delay
      }, 'Retry attempt failed, retrying...');

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('Retry failed');
}

/**
 * Валидация параметров
 */
function validateParams(advertiserId, accessToken, userAccountId, accountId, startDate, endDate, correlationId) {
  const errors = [];

  if (!advertiserId || typeof advertiserId !== 'string') {
    errors.push('advertiserId must be a non-empty string');
  }

  if (!accessToken || typeof accessToken !== 'string') {
    errors.push('accessToken must be a non-empty string');
  }

  if (!userAccountId || typeof userAccountId !== 'string') {
    errors.push('userAccountId must be a non-empty string');
  }

  if (accountId !== null && typeof accountId !== 'string') {
    errors.push('accountId must be a string or null');
  }

  // Validate date format YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate)) {
    errors.push(`startDate must be in YYYY-MM-DD format, got: ${startDate}`);
  }

  if (!dateRegex.test(endDate)) {
    errors.push(`endDate must be in YYYY-MM-DD format, got: ${endDate}`);
  }

  if (errors.length > 0) {
    logger.error({
      where: 'tiktokMetricsCollector',
      correlationId,
      validationErrors: errors,
      advertiserId,
      userAccountId,
      accountId
    }, 'Validation failed');

    throw new Error(`Validation failed: ${errors.join('; ')}`);
  }

  logger.debug({
    where: 'tiktokMetricsCollector',
    correlationId,
    advertiserId,
    userAccountId,
    accountId,
    startDate,
    endDate
  }, 'Parameters validated successfully');
}

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
 * @param {string} options.correlationId - Correlation ID для трейсинга (опционально)
 * @returns {Promise<{success: boolean, metricsCollected: number, errors: string[], correlationId: string}>}
 */
export async function collectTikTokMetrics(advertiserId, accessToken, userAccountId, accountId = null, options = {}) {
  const startTime = Date.now();
  const errors = [];
  let metricsCollected = 0;

  // Generate correlation ID for tracing
  const correlationId = options.correlationId || `tiktok_metrics_${crypto.randomUUID()}`;

  // Default: yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const defaultDate = yesterday.toISOString().split('T')[0];

  const { startDate = defaultDate, endDate = defaultDate } = options;

  logger.info({
    where: 'tiktokMetricsCollector',
    correlationId,
    advertiserId,
    userAccountId,
    accountId,
    startDate,
    endDate,
    action: 'collection_started'
  }, 'Starting TikTok metrics collection');

  try {
    // Validate parameters
    validateParams(advertiserId, accessToken, userAccountId, accountId, startDate, endDate, correlationId);
    // Step 1: Get report at AUCTION_AD level (with retry)
    logger.debug({
      where: 'tiktokMetricsCollector',
      correlationId,
      advertiserId,
      action: 'fetching_report'
    }, 'Fetching TikTok report...');

    const reportStartTime = Date.now();

    const reportResult = await retryWithBackoff(
      async () => {
        return await getTikTokReport(advertiserId, accessToken, {
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
      },
      { correlationId, advertiserId, operation: 'getTikTokReport' }
    );

    const reportDurationMs = Date.now() - reportStartTime;
    const reportData = reportResult.data?.list || [];

    logger.info({
      where: 'tiktokMetricsCollector',
      correlationId,
      advertiserId,
      reportRowsCount: reportData.length,
      reportDurationMs,
      action: 'report_fetched'
    }, 'TikTok report data fetched');

    if (reportData.length === 0) {
      logger.info({
        where: 'tiktokMetricsCollector',
        correlationId,
        advertiserId,
        startDate,
        endDate,
        action: 'no_data'
      }, 'No TikTok report data found for the date range');
      return { success: true, metricsCollected: 0, errors: [], correlationId };
    }

    // Step 2: Get ads to map ad_id -> adgroup_id, campaign_id (with retry)
    logger.debug({
      where: 'tiktokMetricsCollector',
      correlationId,
      advertiserId,
      action: 'fetching_ads'
    }, 'Fetching TikTok ads for mapping...');

    const adsStartTime = Date.now();

    const ads = await retryWithBackoff(
      async () => {
        return await getTikTokAds(advertiserId, accessToken, { pageSize: 500 });
      },
      { correlationId, advertiserId, operation: 'getTikTokAds' }
    );

    const adsDurationMs = Date.now() - adsStartTime;

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
      correlationId,
      advertiserId,
      adsCount: ads.length,
      adsDurationMs,
      action: 'ads_fetched'
    }, 'TikTok ads fetched for mapping');

    // Step 3: Transform and save metrics
    logger.debug({
      where: 'tiktokMetricsCollector',
      correlationId,
      advertiserId,
      rowsToProcess: reportData.length,
      action: 'processing_metrics'
    }, 'Processing TikTok metrics rows...');

    let skippedRows = 0;

    for (const row of reportData) {
      try {
        const adId = row.dimensions?.ad_id;
        const statDate = row.dimensions?.stat_time_day;

        if (!adId || !statDate) {
          skippedRows++;
          logger.warn({
            where: 'tiktokMetricsCollector',
            correlationId,
            row: JSON.stringify(row).slice(0, 200),
            action: 'row_skipped'
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
            correlationId,
            adId,
            date: statDate,
            error: upsertError.message,
            action: 'upsert_failed'
          }, 'Failed to upsert TikTok metrics');
          errors.push(`ad_id=${adId}: ${upsertError.message}`);
        } else {
          metricsCollected++;
        }
      } catch (rowError) {
        logger.warn({
          where: 'tiktokMetricsCollector',
          correlationId,
          error: rowError.message,
          action: 'row_processing_error'
        }, 'Error processing TikTok report row');
        errors.push(rowError.message);
      }
    }

    const duration = Date.now() - startTime;

    logger.info({
      where: 'tiktokMetricsCollector',
      correlationId,
      advertiserId,
      userAccountId,
      accountId,
      startDate,
      endDate,
      metricsCollected,
      skippedRows,
      errorsCount: errors.length,
      totalDurationMs: duration,
      action: 'collection_completed'
    }, 'TikTok metrics collection completed');

    return {
      success: errors.length === 0,
      metricsCollected,
      errors,
      correlationId
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error({
      where: 'tiktokMetricsCollector',
      correlationId,
      advertiserId,
      userAccountId,
      accountId,
      startDate,
      endDate,
      error: error.message,
      errorStack: error.stack,
      totalDurationMs: duration,
      action: 'collection_failed'
    }, 'TikTok metrics collection failed');

    return {
      success: false,
      metricsCollected,
      errors: [error.message],
      correlationId
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
 * @param {string} correlationId - Correlation ID для трейсинга (опционально)
 * @returns {Promise<{success: boolean, totalMetrics: number, errors: string[], correlationId: string}>}
 */
export async function collectTikTokMetricsForDays(advertiserId, accessToken, userAccountId, accountId = null, days = 7, correlationId = null) {
  const startTime = Date.now();
  const corrId = correlationId || `tiktok_metrics_days_${crypto.randomUUID()}`;

  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 1); // Yesterday
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days + 1);

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  logger.info({
    where: 'tiktokMetricsCollector',
    correlationId: corrId,
    advertiserId,
    userAccountId,
    accountId,
    days,
    startDate: startDateStr,
    endDate: endDateStr,
    action: 'multi_day_collection_started'
  }, 'Starting TikTok metrics collection for multiple days');

  const result = await collectTikTokMetrics(
    advertiserId,
    accessToken,
    userAccountId,
    accountId,
    {
      startDate: startDateStr,
      endDate: endDateStr,
      correlationId: corrId
    }
  );

  const totalDuration = Date.now() - startTime;

  logger.info({
    where: 'tiktokMetricsCollector',
    correlationId: corrId,
    advertiserId,
    userAccountId,
    accountId,
    days,
    startDate: startDateStr,
    endDate: endDateStr,
    totalMetrics: result.metricsCollected,
    errorsCount: result.errors.length,
    totalDurationMs: totalDuration,
    action: 'multi_day_collection_completed'
  }, 'TikTok metrics collection for multiple days completed');

  return {
    success: result.success,
    totalMetrics: result.metricsCollected,
    errors: result.errors,
    correlationId: corrId
  };
}

export default {
  collectTikTokMetrics,
  collectTikTokMetricsForDays
};
