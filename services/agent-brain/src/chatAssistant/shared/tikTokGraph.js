/**
 * TikTok Marketing API utility with retry support and circuit breaker
 * Shared across all agents that need TikTok API access
 *
 * Аналог fbGraph.js для Facebook
 */

import { withRetry, isRetryableError } from './retryUtils.js';
import { withCircuitBreaker, CircuitOpenError } from './circuitBreaker.js';
import { logger } from '../../lib/logger.js';

const TIKTOK_API_VERSION = process.env.TIKTOK_API_VERSION || 'v1.3';
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const DEFAULT_TIMEOUT = 25000;  // 25 seconds
const DEFAULT_MAX_RETRIES = 2;

// Circuit breaker name for TikTok API
const TIKTOK_CIRCUIT_NAME = 'tiktok-marketing-api';

/**
 * Check if TikTok error is retryable
 * @param {Error} error
 * @returns {boolean}
 */
function isTikTokRetryable(error) {
  // TikTok specific rate limiting error codes
  // Code 40100: Rate limit exceeded
  // Code 50000: Internal server error (temporary)
  const tikTokErrorCode = error?.tikTokError?.code;

  if (tikTokErrorCode === 40100 || tikTokErrorCode === 50000) {
    return true;
  }

  // Use generic retryable check for network errors
  return isRetryableError(error);
}

/**
 * Execute a TikTok Marketing API call with circuit breaker and retry
 * @param {string} method - HTTP method (GET, POST)
 * @param {string} endpoint - API endpoint (e.g., 'campaign/get/')
 * @param {string} accessToken - TikTok access token
 * @param {object} params - Query/body parameters
 * @param {object} options - { timeout, maxRetries, skipCircuitBreaker }
 * @returns {Promise<object>} API response
 */
export async function tikTokGraph(method, endpoint, accessToken, params = {}, options = {}) {
  const {
    timeout = DEFAULT_TIMEOUT,
    maxRetries = DEFAULT_MAX_RETRIES,
    skipCircuitBreaker = false
  } = options;

  // Extract first segment of endpoint for operation name
  const endpointSegment = endpoint.split('/')[0] || endpoint;
  const operationName = `tt:${method}:${endpointSegment}`;

  // Inner function: retry with backoff
  const retryableFn = () => withRetry(
    () => tikTokGraphInternal(method, endpoint, accessToken, params),
    {
      maxRetries,
      timeoutMs: timeout,
      operationName,
      shouldRetry: isTikTokRetryable
    }
  );

  // Wrap with circuit breaker (unless explicitly skipped)
  if (skipCircuitBreaker) {
    return retryableFn();
  }

  try {
    return await withCircuitBreaker(TIKTOK_CIRCUIT_NAME, retryableFn, {
      failureThreshold: 5,
      timeout: 60000,  // 1 minute before trying HALF_OPEN
      successThreshold: 2
    });
  } catch (error) {
    // Transform CircuitOpenError to a more user-friendly message
    if (error instanceof CircuitOpenError) {
      logger.warn({
        circuit: error.circuitName,
        retryAfterMs: error.retryAfterMs,
        endpoint
      }, 'TikTok API circuit breaker is open');

      const waitSec = Math.ceil(error.retryAfterMs / 1000);
      const friendlyError = new Error(
        `TikTok API временно недоступен из-за повторяющихся ошибок. ` +
        `Попробуйте через ${waitSec} сек.`
      );
      friendlyError.isCircuitOpen = true;
      friendlyError.retryAfterMs = error.retryAfterMs;
      throw friendlyError;
    }
    throw error;
  }
}

/**
 * Internal TikTok Marketing API call (without retry)
 * @private
 */
async function tikTokGraphInternal(method, endpoint, accessToken, params = {}) {
  // Build URL with version
  const url = `${TIKTOK_API_BASE}/${TIKTOK_API_VERSION}/${endpoint}`;

  // Headers - TikTok requires Access-Token header
  const headers = {
    'Access-Token': accessToken,
    'Content-Type': 'application/json'
  };

  let finalUrl = url;
  let body = undefined;

  if (method === 'GET') {
    // For GET requests, add params to URL
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        usp.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
    }
    const queryString = usp.toString();
    if (queryString) {
      finalUrl = `${url}?${queryString}`;
    }
  } else {
    // For POST requests, send as JSON body
    body = JSON.stringify(params);
  }

  logger.debug({
    method,
    endpoint,
    params: Object.keys(params)
  }, 'TikTok API request');

  const res = await fetch(finalUrl, {
    method,
    headers,
    body
  });

  const json = await res.json();

  // TikTok API returns code: 0 for success
  if (json.code !== 0) {
    const error = new Error(json.message || `TikTok API error: code ${json.code}`);
    error.status = res.status;
    error.tikTokError = {
      code: json.code,
      message: json.message,
      request_id: json.request_id
    };

    logger.error({
      code: json.code,
      message: json.message,
      request_id: json.request_id,
      endpoint
    }, 'TikTok API error');

    throw error;
  }

  return json;
}

/**
 * Helper: Get TikTok campaigns
 */
export async function getTikTokCampaigns(advertiserId, accessToken, options = {}) {
  const result = await tikTokGraph('GET', 'campaign/get/', accessToken, {
    advertiser_id: advertiserId,
    page_size: options.pageSize || 100,
    ...options.filtering && { filtering: JSON.stringify(options.filtering) }
  });
  return result.data?.list || [];
}

/**
 * Helper: Get TikTok ad groups
 */
export async function getTikTokAdGroups(advertiserId, accessToken, options = {}) {
  const result = await tikTokGraph('GET', 'adgroup/get/', accessToken, {
    advertiser_id: advertiserId,
    page_size: options.pageSize || 100,
    ...options.campaignIds && { filtering: JSON.stringify({ campaign_ids: options.campaignIds }) }
  });
  return result.data?.list || [];
}

/**
 * Helper: Get TikTok ads
 */
export async function getTikTokAds(advertiserId, accessToken, options = {}) {
  const filtering = {};
  if (options.campaignIds) filtering.campaign_ids = options.campaignIds;
  if (options.adgroupIds) filtering.adgroup_ids = options.adgroupIds;

  const result = await tikTokGraph('GET', 'ad/get/', accessToken, {
    advertiser_id: advertiserId,
    page_size: options.pageSize || 100,
    ...Object.keys(filtering).length > 0 && { filtering: JSON.stringify(filtering) }
  });
  return result.data?.list || [];
}

/**
 * Helper: Update campaign status
 */
export async function updateTikTokCampaignStatus(advertiserId, accessToken, campaignIds, status) {
  return tikTokGraph('POST', 'campaign/status/update/', accessToken, {
    advertiser_id: advertiserId,
    campaign_ids: Array.isArray(campaignIds) ? campaignIds : [campaignIds],
    operation_status: status  // 'ENABLE' or 'DISABLE'
  });
}

/**
 * Helper: Update ad group status
 */
export async function updateTikTokAdGroupStatus(advertiserId, accessToken, adgroupIds, status) {
  return tikTokGraph('POST', 'adgroup/status/update/', accessToken, {
    advertiser_id: advertiserId,
    adgroup_ids: Array.isArray(adgroupIds) ? adgroupIds : [adgroupIds],
    operation_status: status
  });
}

/**
 * Helper: Update ad status
 */
export async function updateTikTokAdStatus(advertiserId, accessToken, adIds, status) {
  return tikTokGraph('POST', 'ad/status/update/', accessToken, {
    advertiser_id: advertiserId,
    ad_ids: Array.isArray(adIds) ? adIds : [adIds],
    operation_status: status
  });
}

/**
 * Helper: Get advertiser info
 */
export async function getTikTokAdvertiserInfo(advertiserId, accessToken) {
  const result = await tikTokGraph('GET', 'advertiser/info/', accessToken, {
    advertiser_ids: JSON.stringify([advertiserId])
  });
  return result.data?.list?.[0] || null;
}

/**
 * Helper: Get report data
 */
export async function getTikTokReport(advertiserId, accessToken, options) {
  const {
    dataLevel = 'AUCTION_CAMPAIGN',
    dimensions = ['campaign_id'],
    metrics = ['spend', 'impressions', 'clicks', 'conversions'],
    startDate,
    endDate,
    filtering
  } = options;

  return tikTokGraph('POST', 'report/integrated/get/', accessToken, {
    advertiser_id: advertiserId,
    report_type: 'BASIC',
    data_level: dataLevel,
    dimensions,
    metrics,
    start_date: startDate,
    end_date: endDate,
    page_size: 500,
    ...filtering && { filtering }
  });
}

export default tikTokGraph;
