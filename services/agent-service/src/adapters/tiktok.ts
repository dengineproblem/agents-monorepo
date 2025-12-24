/**
 * TikTok Marketing API Adapter
 *
 * Низкоуровневый wrapper для TikTok Business API v1.3
 * Аналог facebook.ts для работы с TikTok Ads
 *
 * Особенности TikTok API:
 * - Access token передаётся в header "Access-Token", НЕ в query params
 * - Статусы: ENABLE / DISABLE (не ACTIVE / PAUSED как в FB)
 * - Budget в валюте аккаунта (не в центах)
 * - Иерархия: Campaign → AdGroup → Ad (не Campaign → AdSet → Ad)
 */

import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { createLogger } from '../lib/logger.js';
import { resolveTikTokError } from '../lib/tiktokErrors.js';

const TIKTOK_API_VERSION = process.env.TIKTOK_API_VERSION || 'v1.3';
const TIKTOK_BASE_URL = `https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}`;
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

const log = createLogger({ module: 'tiktokAdapter' });

// ============================================================
// CORE API WRAPPER
// ============================================================

/**
 * Универсальный wrapper для TikTok API
 *
 * КРИТИЧНО: Access-Token передаётся в header, не в query params!
 *
 * @param method - HTTP метод (GET или POST)
 * @param endpoint - Endpoint без версии (например: 'campaign/get/')
 * @param accessToken - TikTok access token
 * @param params - Параметры запроса
 * @param options - Дополнительные опции
 */
export async function tikTokGraph(
  method: 'GET' | 'POST',
  endpoint: string,
  accessToken: string,
  params: Record<string, any> = {},
  options: { timeout?: number; skipRetry?: boolean } = {}
): Promise<any> {
  const { timeout = DEFAULT_TIMEOUT, skipRetry = false } = options;
  const url = `${TIKTOK_BASE_URL}/${endpoint}`;

  log.debug({
    method,
    endpoint,
    params: JSON.stringify(params).substring(0, 500)
  }, 'TikTok API request');

  let lastError: any;

  for (let attempt = 1; attempt <= (skipRetry ? 1 : MAX_RETRIES); attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      let response;

      if (method === 'GET') {
        // GET: параметры в query string
        const queryParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null) {
            queryParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
          }
        }

        response = await axios.get(`${url}?${queryParams.toString()}`, {
          headers: {
            'Access-Token': accessToken,
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        });
      } else {
        // POST: параметры в body
        response = await axios.post(url, params, {
          headers: {
            'Access-Token': accessToken,
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        });
      }

      clearTimeout(timeoutId);

      const data = response.data;

      log.debug({
        endpoint,
        code: data.code,
        message: data.message
      }, 'TikTok API response');

      // TikTok возвращает code: 0 при успехе
      if (data.code !== 0) {
        const error: any = new Error(data.message || `TikTok API error: code ${data.code}`);
        error.tiktok = {
          code: data.code,
          message: data.message,
          request_id: data.request_id,
          endpoint,
          method
        };
        error.resolution = resolveTikTokError(error.tiktok);

        log.error({
          msg: error.resolution?.msgCode || 'tiktok_api_error',
          meta: error.tiktok,
          resolution: error.resolution
        }, 'TikTok API error');

        throw error;
      }

      return data;

    } catch (error: any) {
      lastError = error;

      // Проверяем, нужен ли retry
      const isNetworkError = error.code === 'ECONNRESET' ||
                             error.code === 'ETIMEDOUT' ||
                             error.code === 'ECONNABORTED' ||
                             error.name === 'AbortError';

      const isRateLimitError = error.tiktok?.code === 40100; // Rate limit

      if ((isNetworkError || isRateLimitError) && attempt < MAX_RETRIES && !skipRetry) {
        log.warn({
          attempt,
          endpoint,
          error: error.message
        }, `TikTok API error, retrying in ${RETRY_DELAY}ms...`);

        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
        continue;
      }

      // Обогащаем ошибку информацией
      if (!error.tiktok) {
        error.tiktok = {
          endpoint,
          method,
          error: error.message
        };
      }

      throw error;
    }
  }

  throw lastError;
}

// ============================================================
// CAMPAIGN OPERATIONS
// ============================================================

/**
 * Получить список кампаний
 */
export async function getCampaigns(
  advertiserId: string,
  accessToken: string,
  options: {
    page?: number;
    pageSize?: number;
    filtering?: any;
  } = {}
): Promise<any> {
  const params: any = {
    advertiser_id: advertiserId,
    page: options.page || 1,
    page_size: options.pageSize || 100,
    fields: ['campaign_id', 'campaign_name', 'operation_status', 'objective_type', 'budget', 'budget_mode', 'create_time']
  };

  if (options.filtering) {
    params.filtering = options.filtering;
  }

  return tikTokGraph('GET', 'campaign/get/', accessToken, params);
}

/**
 * Создать кампанию
 */
export async function createCampaign(
  advertiserId: string,
  accessToken: string,
  params: {
    campaign_name: string;
    objective_type: 'TRAFFIC' | 'CONVERSIONS' | 'REACH' | 'VIDEO_VIEWS' | 'LEAD_GENERATION' | 'APP_PROMOTION';
    budget: number;
    budget_mode: 'BUDGET_MODE_DAY' | 'BUDGET_MODE_TOTAL';
    operation_status?: 'ENABLE' | 'DISABLE';
  }
): Promise<{ campaign_id: string }> {
  const result = await tikTokGraph('POST', 'campaign/create/', accessToken, {
    advertiser_id: advertiserId,
    campaign_name: params.campaign_name,
    objective_type: params.objective_type,
    budget: params.budget,
    budget_mode: params.budget_mode,
    operation_status: params.operation_status || 'ENABLE'
  });

  return { campaign_id: result.data.campaign_id };
}

/**
 * Обновить статус кампаний (batch)
 */
export async function updateCampaignStatus(
  advertiserId: string,
  accessToken: string,
  campaignIds: string[],
  status: 'ENABLE' | 'DISABLE'
): Promise<any> {
  return tikTokGraph('POST', 'campaign/status/update/', accessToken, {
    advertiser_id: advertiserId,
    campaign_ids: campaignIds,
    operation_status: status
  });
}

/**
 * Обновить бюджет кампании
 */
export async function updateCampaignBudget(
  advertiserId: string,
  accessToken: string,
  campaignId: string,
  budget: number
): Promise<any> {
  return tikTokGraph('POST', 'campaign/update/', accessToken, {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    budget: budget
  });
}

// ============================================================
// ADGROUP OPERATIONS (= AdSet в Facebook)
// ============================================================

/**
 * Получить список AdGroups
 */
export async function getAdGroups(
  advertiserId: string,
  accessToken: string,
  options: {
    campaignIds?: string[];
    page?: number;
    pageSize?: number;
  } = {}
): Promise<any> {
  const params: any = {
    advertiser_id: advertiserId,
    page: options.page || 1,
    page_size: options.pageSize || 100,
    fields: ['adgroup_id', 'adgroup_name', 'campaign_id', 'operation_status', 'budget', 'bid_type', 'optimization_goal', 'create_time']
  };

  if (options.campaignIds && options.campaignIds.length > 0) {
    params.filtering = { campaign_ids: options.campaignIds };
  }

  return tikTokGraph('GET', 'adgroup/get/', accessToken, params);
}

/**
 * Создать AdGroup
 */
export async function createAdGroup(
  advertiserId: string,
  accessToken: string,
  params: {
    campaign_id: string;
    adgroup_name: string;
    budget: number;
    budget_mode: 'BUDGET_MODE_DAY' | 'BUDGET_MODE_TOTAL';
    schedule_type: 'SCHEDULE_START_END' | 'SCHEDULE_FROM_NOW';
    schedule_start_time?: string;
    schedule_end_time?: string;
    optimization_goal: 'CLICK' | 'CONVERT' | 'REACH' | 'VIDEO_VIEW' | 'LEAD_GENERATION';
    bid_type: 'BID_TYPE_NO_BID' | 'BID_TYPE_CUSTOM';
    bid_price?: number;
    billing_event: 'CPC' | 'CPM' | 'OCPM' | 'CPA';
    pacing: 'PACING_MODE_SMOOTH' | 'PACING_MODE_FAST';
    placement_type: 'PLACEMENT_TYPE_AUTOMATIC' | 'PLACEMENT_TYPE_NORMAL';
    placements?: string[];
    location_ids: number[];
    age_groups?: string[];
    gender?: 'GENDER_MALE' | 'GENDER_FEMALE' | 'GENDER_UNLIMITED';
    languages?: string[];
    operation_status?: 'ENABLE' | 'DISABLE';
    pixel_id?: string;
    identity_id?: string;
    identity_type?: 'AUTH_CODE' | 'TT_USER';
  }
): Promise<{ adgroup_id: string }> {
  const body: any = {
    advertiser_id: advertiserId,
    campaign_id: params.campaign_id,
    adgroup_name: params.adgroup_name,
    budget: params.budget,
    budget_mode: params.budget_mode,
    schedule_type: params.schedule_type,
    optimization_goal: params.optimization_goal,
    bid_type: params.bid_type,
    billing_event: params.billing_event,
    pacing: params.pacing,
    placement_type: params.placement_type,
    location_ids: params.location_ids,
    operation_status: params.operation_status || 'ENABLE'
  };

  // Optional fields
  if (params.schedule_start_time) body.schedule_start_time = params.schedule_start_time;
  if (params.schedule_end_time) body.schedule_end_time = params.schedule_end_time;
  if (params.bid_price) body.bid_price = params.bid_price;
  if (params.placements) body.placements = params.placements;
  if (params.age_groups) body.age_groups = params.age_groups;
  if (params.gender) body.gender = params.gender;
  if (params.languages) body.languages = params.languages;
  if (params.pixel_id) body.pixel_id = params.pixel_id;
  if (params.identity_id) body.identity_id = params.identity_id;
  if (params.identity_type) body.identity_type = params.identity_type;

  const result = await tikTokGraph('POST', 'adgroup/create/', accessToken, body);

  return { adgroup_id: result.data.adgroup_id };
}

/**
 * Обновить статус AdGroups (batch)
 */
export async function updateAdGroupStatus(
  advertiserId: string,
  accessToken: string,
  adgroupIds: string[],
  status: 'ENABLE' | 'DISABLE'
): Promise<any> {
  return tikTokGraph('POST', 'adgroup/status/update/', accessToken, {
    advertiser_id: advertiserId,
    adgroup_ids: adgroupIds,
    operation_status: status
  });
}

/**
 * Обновить бюджет AdGroup
 */
export async function updateAdGroupBudget(
  advertiserId: string,
  accessToken: string,
  adgroupId: string,
  budget: number
): Promise<any> {
  return tikTokGraph('POST', 'adgroup/update/', accessToken, {
    advertiser_id: advertiserId,
    adgroup_id: adgroupId,
    budget: budget
  });
}

// ============================================================
// AD OPERATIONS
// ============================================================

/**
 * Получить список Ads
 */
export async function getAds(
  advertiserId: string,
  accessToken: string,
  options: {
    adgroupIds?: string[];
    page?: number;
    pageSize?: number;
  } = {}
): Promise<any> {
  const params: any = {
    advertiser_id: advertiserId,
    page: options.page || 1,
    page_size: options.pageSize || 100,
    fields: ['ad_id', 'ad_name', 'adgroup_id', 'campaign_id', 'operation_status', 'create_time']
  };

  if (options.adgroupIds && options.adgroupIds.length > 0) {
    params.filtering = { adgroup_ids: options.adgroupIds };
  }

  return tikTokGraph('GET', 'ad/get/', accessToken, params);
}

/**
 * Создать Ad
 */
export async function createAd(
  advertiserId: string,
  accessToken: string,
  params: {
    adgroup_id: string;
    ad_name: string;
    ad_format: 'SINGLE_VIDEO' | 'SINGLE_IMAGE' | 'CAROUSEL';
    ad_text: string;
    video_id?: string;
    image_ids?: string[];
    call_to_action?: string;
    landing_page_url?: string;
    display_name?: string;
    avatar_icon_web_uri?: string;
    identity_id?: string;
    identity_type?: 'AUTH_CODE' | 'TT_USER';
    operation_status?: 'ENABLE' | 'DISABLE';
  }
): Promise<{ ad_id: string }> {
  const body: any = {
    advertiser_id: advertiserId,
    adgroup_id: params.adgroup_id,
    ad_name: params.ad_name,
    ad_format: params.ad_format,
    ad_text: params.ad_text,
    operation_status: params.operation_status || 'ENABLE'
  };

  // Video/Image
  if (params.video_id) body.video_id = params.video_id;
  if (params.image_ids) body.image_ids = params.image_ids;

  // Call to action
  if (params.call_to_action) body.call_to_action = params.call_to_action;
  if (params.landing_page_url) body.landing_page_url = params.landing_page_url;

  // Identity
  if (params.display_name) body.display_name = params.display_name;
  if (params.avatar_icon_web_uri) body.avatar_icon_web_uri = params.avatar_icon_web_uri;
  if (params.identity_id) body.identity_id = params.identity_id;
  if (params.identity_type) body.identity_type = params.identity_type;

  const result = await tikTokGraph('POST', 'ad/create/', accessToken, body);

  return { ad_id: result.data.ad_id };
}

/**
 * Обновить статус Ads (batch)
 */
export async function updateAdStatus(
  advertiserId: string,
  accessToken: string,
  adIds: string[],
  status: 'ENABLE' | 'DISABLE'
): Promise<any> {
  return tikTokGraph('POST', 'ad/status/update/', accessToken, {
    advertiser_id: advertiserId,
    ad_ids: adIds,
    operation_status: status
  });
}

// ============================================================
// MEDIA UPLOAD
// ============================================================

/**
 * Загрузить видео в TikTok Ads
 *
 * @param advertiserId - ID рекламного аккаунта
 * @param accessToken - Access token
 * @param videoSource - URL видео или Buffer
 */
export async function uploadVideo(
  advertiserId: string,
  accessToken: string,
  videoSource: string | Buffer
): Promise<{ video_id: string }> {
  log.info({ advertiserId }, 'Uploading video to TikTok');

  // Если передан URL - используем upload по URL
  if (typeof videoSource === 'string' && videoSource.startsWith('http')) {
    const result = await tikTokGraph('POST', 'file/video/ad/upload/', accessToken, {
      advertiser_id: advertiserId,
      upload_type: 'UPLOAD_BY_URL',
      video_url: videoSource
    });

    log.info({ advertiserId, videoId: result.data.video_id }, 'Video uploaded via URL');
    return { video_id: result.data.video_id };
  }

  // Иначе - загрузка файла
  const tmpPath = path.join(os.tmpdir(), `tt_video_${randomUUID()}.mp4`);

  if (Buffer.isBuffer(videoSource)) {
    fs.writeFileSync(tmpPath, videoSource);
  } else {
    throw new Error('Invalid video source: must be URL or Buffer');
  }

  try {
    const formData = new FormData();
    formData.append('advertiser_id', advertiserId);
    formData.append('upload_type', 'UPLOAD_BY_FILE');
    formData.append('video_file', fs.createReadStream(tmpPath));

    const response = await axios.post(
      `${TIKTOK_BASE_URL}/file/video/ad/upload/`,
      formData,
      {
        headers: {
          'Access-Token': accessToken,
          ...formData.getHeaders()
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      }
    );

    if (response.data.code !== 0) {
      throw new Error(response.data.message || 'Video upload failed');
    }

    log.info({ advertiserId, videoId: response.data.data.video_id }, 'Video uploaded via file');
    return { video_id: response.data.data.video_id };

  } finally {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  }
}

/**
 * Загрузить изображение в TikTok Ads
 */
export async function uploadImage(
  advertiserId: string,
  accessToken: string,
  imageSource: string | Buffer
): Promise<{ image_id: string }> {
  log.info({ advertiserId }, 'Uploading image to TikTok');

  // Если передан URL - используем upload по URL
  if (typeof imageSource === 'string' && imageSource.startsWith('http')) {
    const result = await tikTokGraph('POST', 'file/image/ad/upload/', accessToken, {
      advertiser_id: advertiserId,
      upload_type: 'UPLOAD_BY_URL',
      image_url: imageSource
    });

    log.info({ advertiserId, imageId: result.data.image_id }, 'Image uploaded via URL');
    return { image_id: result.data.image_id };
  }

  // Загрузка файла
  const tmpPath = path.join(os.tmpdir(), `tt_image_${randomUUID()}.jpg`);

  if (Buffer.isBuffer(imageSource)) {
    fs.writeFileSync(tmpPath, imageSource);
  } else {
    throw new Error('Invalid image source: must be URL or Buffer');
  }

  try {
    const formData = new FormData();
    formData.append('advertiser_id', advertiserId);
    formData.append('upload_type', 'UPLOAD_BY_FILE');
    formData.append('image_file', fs.createReadStream(tmpPath));

    const response = await axios.post(
      `${TIKTOK_BASE_URL}/file/image/ad/upload/`,
      formData,
      {
        headers: {
          'Access-Token': accessToken,
          ...formData.getHeaders()
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      }
    );

    if (response.data.code !== 0) {
      throw new Error(response.data.message || 'Image upload failed');
    }

    log.info({ advertiserId, imageId: response.data.data.image_id }, 'Image uploaded via file');
    return { image_id: response.data.data.image_id };

  } finally {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  }
}

// ============================================================
// REPORTS
// ============================================================

/**
 * Получить интегрированный отчёт
 */
export async function getReport(
  advertiserId: string,
  accessToken: string,
  params: {
    report_type: 'BASIC' | 'AUDIENCE' | 'PLAYABLE_MATERIAL' | 'CATALOG';
    data_level: 'AUCTION_ADVERTISER' | 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD';
    dimensions: string[];
    metrics: string[];
    start_date: string; // YYYY-MM-DD
    end_date: string;   // YYYY-MM-DD
    page?: number;
    page_size?: number;
    filtering?: any;
  }
): Promise<any> {
  return tikTokGraph('POST', 'report/integrated/get/', accessToken, {
    advertiser_id: advertiserId,
    service_type: 'AUCTION',
    report_type: params.report_type,
    data_level: params.data_level,
    dimensions: params.dimensions,
    metrics: params.metrics,
    start_date: params.start_date,
    end_date: params.end_date,
    page: params.page || 1,
    page_size: params.page_size || 100,
    filtering: params.filtering
  });
}

// ============================================================
// ACCOUNT INFO
// ============================================================

/**
 * Получить информацию об аккаунте
 */
export async function getAdvertiserInfo(
  advertiserId: string,
  accessToken: string
): Promise<any> {
  return tikTokGraph('GET', 'advertiser/info/', accessToken, {
    advertiser_ids: [advertiserId],
    fields: ['advertiser_id', 'name', 'company', 'status', 'currency', 'timezone', 'balance']
  });
}

/**
 * Получить список пикселей
 */
export async function getPixels(
  advertiserId: string,
  accessToken: string
): Promise<any> {
  return tikTokGraph('GET', 'pixel/list/', accessToken, {
    advertiser_id: advertiserId,
    page: 1,
    page_size: 100
  });
}

// ============================================================
// IDENTITY
// ============================================================

/**
 * Получить identity для аккаунта
 */
export async function getIdentities(
  advertiserId: string,
  accessToken: string
): Promise<any> {
  return tikTokGraph('GET', 'identity/get/', accessToken, {
    advertiser_id: advertiserId
  });
}

// ============================================================
// CONVENIENCE OBJECT (like fb object in facebook.ts)
// ============================================================

export const tt = {
  // Campaign
  getCampaigns,
  createCampaign,
  pauseCampaign: (advertiserId: string, token: string, campaignId: string) =>
    updateCampaignStatus(advertiserId, token, [campaignId], 'DISABLE'),
  resumeCampaign: (advertiserId: string, token: string, campaignId: string) =>
    updateCampaignStatus(advertiserId, token, [campaignId], 'ENABLE'),
  updateCampaignBudget,

  // AdGroup
  getAdGroups,
  createAdGroup,
  pauseAdGroup: (advertiserId: string, token: string, adgroupId: string) =>
    updateAdGroupStatus(advertiserId, token, [adgroupId], 'DISABLE'),
  resumeAdGroup: (advertiserId: string, token: string, adgroupId: string) =>
    updateAdGroupStatus(advertiserId, token, [adgroupId], 'ENABLE'),
  updateAdGroupBudget,

  // Ad
  getAds,
  createAd,
  pauseAd: (advertiserId: string, token: string, adId: string) =>
    updateAdStatus(advertiserId, token, [adId], 'DISABLE'),
  resumeAd: (advertiserId: string, token: string, adId: string) =>
    updateAdStatus(advertiserId, token, [adId], 'ENABLE'),

  // Media
  uploadVideo,
  uploadImage,

  // Reports
  getReport,

  // Account
  getAdvertiserInfo,
  getPixels,
  getIdentities
};

export default tt;
