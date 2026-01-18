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
  const requestId = randomUUID().substring(0, 8);

  log.info({
    requestId,
    method,
    endpoint,
    url,
    params: JSON.stringify(params).substring(0, 1000),
    timeout,
    skipRetry
  }, '[TikTok:API] >>> Отправка запроса');

  let lastError: any;
  const startTime = Date.now();

  for (let attempt = 1; attempt <= (skipRetry ? 1 : MAX_RETRIES); attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      log.debug({
        requestId,
        attempt,
        maxRetries: MAX_RETRIES
      }, '[TikTok:API] Попытка запроса');

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
      const duration = Date.now() - startTime;

      log.info({
        requestId,
        endpoint,
        code: data.code,
        message: data.message,
        request_id: data.request_id,
        duration_ms: duration,
        data_keys: data.data ? Object.keys(data.data) : null
      }, '[TikTok:API] <<< Ответ получен');

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
          requestId,
          endpoint,
          tiktok_code: data.code,
          tiktok_message: data.message,
          tiktok_request_id: data.request_id,
          resolution: error.resolution,
          duration_ms: duration
        }, '[TikTok:API] ❌ API вернул ошибку');

        throw error;
      }

      log.debug({
        requestId,
        endpoint,
        response_data: JSON.stringify(data.data || {}).substring(0, 500)
      }, '[TikTok:API] Детали ответа');

      return data;

    } catch (error: any) {
      lastError = error;
      const duration = Date.now() - startTime;

      // Проверяем, нужен ли retry
      const isNetworkError = error.code === 'ECONNRESET' ||
                             error.code === 'ETIMEDOUT' ||
                             error.code === 'ECONNABORTED' ||
                             error.name === 'AbortError';

      const isRateLimitError = error.tiktok?.code === 40100; // Rate limit

      log.warn({
        requestId,
        attempt,
        endpoint,
        error_message: error.message,
        error_code: error.code || error.tiktok?.code,
        is_network_error: isNetworkError,
        is_rate_limit: isRateLimitError,
        will_retry: (isNetworkError || isRateLimitError) && attempt < MAX_RETRIES && !skipRetry,
        duration_ms: duration
      }, '[TikTok:API] ⚠️ Ошибка запроса');

      if ((isNetworkError || isRateLimitError) && attempt < MAX_RETRIES && !skipRetry) {
        const delay = RETRY_DELAY * attempt;
        log.info({
          requestId,
          attempt,
          next_attempt: attempt + 1,
          delay_ms: delay
        }, `[TikTok:API] Повтор через ${delay}ms...`);

        await new Promise(resolve => setTimeout(resolve, delay));
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

      log.error({
        requestId,
        endpoint,
        method,
        error_message: error.message,
        error_stack: error.stack?.substring(0, 500),
        tiktok_meta: error.tiktok,
        duration_ms: duration
      }, '[TikTok:API] ❌ Финальная ошибка после всех попыток');

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
  log.info({
    advertiserId,
    page: options.page || 1,
    pageSize: options.pageSize || 100,
    hasFiltering: !!options.filtering
  }, '[TikTok:getCampaigns] Запрос списка кампаний');

  const params: any = {
    advertiser_id: advertiserId,
    page: options.page || 1,
    page_size: options.pageSize || 100,
    fields: ['campaign_id', 'campaign_name', 'operation_status', 'objective_type', 'budget', 'budget_mode', 'create_time']
  };

  if (options.filtering) {
    params.filtering = options.filtering;
  }

  const result = await tikTokGraph('GET', 'campaign/get/', accessToken, params);

  log.info({
    advertiserId,
    campaigns_count: result.data?.list?.length || 0,
    page_info: result.data?.page_info
  }, '[TikTok:getCampaigns] Кампании получены');

  return result;
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
  log.info({
    advertiserId,
    campaign_name: params.campaign_name,
    objective_type: params.objective_type,
    budget: params.budget,
    budget_mode: params.budget_mode,
    operation_status: params.operation_status || 'ENABLE'
  }, '[TikTok:createCampaign] Создание кампании');

  const result = await tikTokGraph('POST', 'campaign/create/', accessToken, {
    advertiser_id: advertiserId,
    campaign_name: params.campaign_name,
    objective_type: params.objective_type,
    budget: params.budget,
    budget_mode: params.budget_mode,
    operation_status: params.operation_status || 'ENABLE'
  });

  log.info({
    advertiserId,
    campaign_id: result.data.campaign_id,
    campaign_name: params.campaign_name
  }, '[TikTok:createCampaign] ✅ Кампания создана');

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
  log.info({
    advertiserId,
    campaignIds,
    new_status: status
  }, '[TikTok:updateCampaignStatus] Изменение статуса кампаний');

  const result = await tikTokGraph('POST', 'campaign/status/update/', accessToken, {
    advertiser_id: advertiserId,
    campaign_ids: campaignIds,
    operation_status: status
  });

  log.info({
    advertiserId,
    campaignIds,
    new_status: status
  }, '[TikTok:updateCampaignStatus] ✅ Статус кампаний обновлён');

  return result;
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
  log.info({
    advertiserId,
    campaignId,
    new_budget: budget
  }, '[TikTok:updateCampaignBudget] Изменение бюджета кампании');

  const result = await tikTokGraph('POST', 'campaign/update/', accessToken, {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    budget: budget
  });

  log.info({
    advertiserId,
    campaignId,
    new_budget: budget
  }, '[TikTok:updateCampaignBudget] ✅ Бюджет кампании обновлён');

  return result;
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
  log.info({
    advertiserId,
    campaignIds: options.campaignIds,
    page: options.page || 1,
    pageSize: options.pageSize || 100
  }, '[TikTok:getAdGroups] Запрос списка AdGroups');

  const params: any = {
    advertiser_id: advertiserId,
    page: options.page || 1,
    page_size: options.pageSize || 100,
    fields: ['adgroup_id', 'adgroup_name', 'campaign_id', 'operation_status', 'budget', 'bid_type', 'optimization_goal', 'create_time']
  };

  if (options.campaignIds && options.campaignIds.length > 0) {
    params.filtering = { campaign_ids: options.campaignIds };
  }

  const result = await tikTokGraph('GET', 'adgroup/get/', accessToken, params);

  log.info({
    advertiserId,
    adgroups_count: result.data?.list?.length || 0
  }, '[TikTok:getAdGroups] AdGroups получены');

  return result;
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
  log.info({
    advertiserId,
    campaign_id: params.campaign_id,
    adgroup_name: params.adgroup_name,
    budget: params.budget,
    budget_mode: params.budget_mode,
    optimization_goal: params.optimization_goal,
    bid_type: params.bid_type,
    location_ids: params.location_ids,
    age_groups: params.age_groups,
    gender: params.gender,
    operation_status: params.operation_status || 'ENABLE'
  }, '[TikTok:createAdGroup] Создание AdGroup');

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

  log.info({
    advertiserId,
    adgroup_id: result.data.adgroup_id,
    adgroup_name: params.adgroup_name,
    campaign_id: params.campaign_id
  }, '[TikTok:createAdGroup] ✅ AdGroup создана');

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
  log.info({
    advertiserId,
    adgroupIds,
    new_status: status
  }, '[TikTok:updateAdGroupStatus] Изменение статуса AdGroups');

  const result = await tikTokGraph('POST', 'adgroup/status/update/', accessToken, {
    advertiser_id: advertiserId,
    adgroup_ids: adgroupIds,
    operation_status: status
  });

  log.info({
    advertiserId,
    adgroupIds,
    new_status: status
  }, '[TikTok:updateAdGroupStatus] ✅ Статус AdGroups обновлён');

  return result;
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
  log.info({
    advertiserId,
    adgroupId,
    new_budget: budget
  }, '[TikTok:updateAdGroupBudget] Изменение бюджета AdGroup');

  const result = await tikTokGraph('POST', 'adgroup/update/', accessToken, {
    advertiser_id: advertiserId,
    adgroup_id: adgroupId,
    budget: budget
  });

  log.info({
    advertiserId,
    adgroupId,
    new_budget: budget
  }, '[TikTok:updateAdGroupBudget] ✅ Бюджет AdGroup обновлён');

  return result;
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
  log.info({
    advertiserId,
    adgroupIds: options.adgroupIds,
    page: options.page || 1,
    pageSize: options.pageSize || 100
  }, '[TikTok:getAds] Запрос списка Ads');

  const params: any = {
    advertiser_id: advertiserId,
    page: options.page || 1,
    page_size: options.pageSize || 100,
    fields: ['ad_id', 'ad_name', 'adgroup_id', 'campaign_id', 'operation_status', 'create_time']
  };

  if (options.adgroupIds && options.adgroupIds.length > 0) {
    params.filtering = { adgroup_ids: options.adgroupIds };
  }

  const result = await tikTokGraph('GET', 'ad/get/', accessToken, params);

  log.info({
    advertiserId,
    ads_count: result.data?.list?.length || 0
  }, '[TikTok:getAds] Ads получены');

  return result;
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
    page_id?: string;  // TikTok Instant Page ID for Lead Generation
  }
): Promise<{ ad_id: string }> {
  log.info({
    advertiserId,
    adgroup_id: params.adgroup_id,
    ad_name: params.ad_name,
    ad_format: params.ad_format,
    ad_text: params.ad_text?.substring(0, 100),
    video_id: params.video_id,
    has_image_ids: !!params.image_ids,
    call_to_action: params.call_to_action,
    landing_page_url: params.landing_page_url,
    page_id: params.page_id,  // Lead Generation Instant Page
    identity_id: params.identity_id,
    operation_status: params.operation_status || 'ENABLE'
  }, '[TikTok:createAd] Создание Ad');

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

  // Lead Generation: Instant Page
  if (params.page_id) body.page_id = params.page_id;

  const result = await tikTokGraph('POST', 'ad/create/', accessToken, body);

  log.info({
    advertiserId,
    ad_id: result.data.ad_id,
    ad_name: params.ad_name,
    adgroup_id: params.adgroup_id,
    page_id: params.page_id || null,
    has_lead_form: !!params.page_id
  }, '[TikTok:createAd] ✅ Ad создан');

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
  log.info({
    advertiserId,
    adIds,
    new_status: status
  }, '[TikTok:updateAdStatus] Изменение статуса Ads');

  const result = await tikTokGraph('POST', 'ad/status/update/', accessToken, {
    advertiser_id: advertiserId,
    ad_ids: adIds,
    operation_status: status
  });

  log.info({
    advertiserId,
    adIds,
    new_status: status
  }, '[TikTok:updateAdStatus] ✅ Статус Ads обновлён');

  return result;
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
  const isUrl = typeof videoSource === 'string' && videoSource.startsWith('http');
  const uploadType = isUrl ? 'UPLOAD_BY_URL' : 'UPLOAD_BY_FILE';
  const startTime = Date.now();

  log.info({
    advertiserId,
    upload_type: uploadType,
    source_type: isUrl ? 'url' : 'buffer',
    source_url: isUrl ? (videoSource as string).substring(0, 100) : undefined,
    buffer_size: Buffer.isBuffer(videoSource) ? videoSource.length : undefined
  }, '[TikTok:uploadVideo] Начало загрузки видео');

  // Если передан URL - используем upload по URL
  if (isUrl) {
    const result = await tikTokGraph('POST', 'file/video/ad/upload/', accessToken, {
      advertiser_id: advertiserId,
      upload_type: 'UPLOAD_BY_URL',
      video_url: videoSource
    });

    const duration = Date.now() - startTime;
    log.info({
      advertiserId,
      video_id: result.data.video_id,
      upload_type: 'UPLOAD_BY_URL',
      duration_ms: duration
    }, '[TikTok:uploadVideo] ✅ Видео загружено по URL');

    return { video_id: result.data.video_id };
  }

  // Иначе - загрузка файла
  const tmpPath = path.join(os.tmpdir(), `tt_video_${randomUUID()}.mp4`);

  if (Buffer.isBuffer(videoSource)) {
    fs.writeFileSync(tmpPath, videoSource);
    log.debug({
      advertiserId,
      tmp_path: tmpPath,
      file_size: videoSource.length
    }, '[TikTok:uploadVideo] Временный файл создан');
  } else {
    log.error({ advertiserId }, '[TikTok:uploadVideo] ❌ Неверный источник видео');
    throw new Error('Invalid video source: must be URL or Buffer');
  }

  try {
    const formData = new FormData();
    formData.append('advertiser_id', advertiserId);
    formData.append('upload_type', 'UPLOAD_BY_FILE');
    formData.append('video_file', fs.createReadStream(tmpPath));

    log.debug({ advertiserId }, '[TikTok:uploadVideo] Отправка файла...');

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
      log.error({
        advertiserId,
        code: response.data.code,
        message: response.data.message
      }, '[TikTok:uploadVideo] ❌ Ошибка загрузки');
      throw new Error(response.data.message || 'Video upload failed');
    }

    const duration = Date.now() - startTime;
    log.info({
      advertiserId,
      video_id: response.data.data.video_id,
      upload_type: 'UPLOAD_BY_FILE',
      duration_ms: duration
    }, '[TikTok:uploadVideo] ✅ Видео загружено из файла');

    return { video_id: response.data.data.video_id };

  } finally {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
      log.debug({ advertiserId, tmp_path: tmpPath }, '[TikTok:uploadVideo] Временный файл удалён');
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
  const isUrl = typeof imageSource === 'string' && imageSource.startsWith('http');
  const uploadType = isUrl ? 'UPLOAD_BY_URL' : 'UPLOAD_BY_FILE';
  const startTime = Date.now();

  log.info({
    advertiserId,
    upload_type: uploadType,
    source_type: isUrl ? 'url' : 'buffer',
    source_url: isUrl ? (imageSource as string).substring(0, 100) : undefined,
    buffer_size: Buffer.isBuffer(imageSource) ? imageSource.length : undefined
  }, '[TikTok:uploadImage] Начало загрузки изображения');

  // Если передан URL - используем upload по URL
  if (isUrl) {
    const result = await tikTokGraph('POST', 'file/image/ad/upload/', accessToken, {
      advertiser_id: advertiserId,
      upload_type: 'UPLOAD_BY_URL',
      image_url: imageSource
    });

    const duration = Date.now() - startTime;
    log.info({
      advertiserId,
      image_id: result.data.image_id,
      upload_type: 'UPLOAD_BY_URL',
      duration_ms: duration
    }, '[TikTok:uploadImage] ✅ Изображение загружено по URL');

    return { image_id: result.data.image_id };
  }

  // Загрузка файла
  const tmpPath = path.join(os.tmpdir(), `tt_image_${randomUUID()}.jpg`);

  if (Buffer.isBuffer(imageSource)) {
    fs.writeFileSync(tmpPath, imageSource);
    log.debug({
      advertiserId,
      tmp_path: tmpPath,
      file_size: imageSource.length
    }, '[TikTok:uploadImage] Временный файл создан');
  } else {
    log.error({ advertiserId }, '[TikTok:uploadImage] ❌ Неверный источник изображения');
    throw new Error('Invalid image source: must be URL or Buffer');
  }

  try {
    const formData = new FormData();
    formData.append('advertiser_id', advertiserId);
    formData.append('upload_type', 'UPLOAD_BY_FILE');
    formData.append('image_file', fs.createReadStream(tmpPath));

    log.debug({ advertiserId }, '[TikTok:uploadImage] Отправка файла...');

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
      log.error({
        advertiserId,
        code: response.data.code,
        message: response.data.message
      }, '[TikTok:uploadImage] ❌ Ошибка загрузки');
      throw new Error(response.data.message || 'Image upload failed');
    }

    const duration = Date.now() - startTime;
    log.info({
      advertiserId,
      image_id: response.data.data.image_id,
      upload_type: 'UPLOAD_BY_FILE',
      duration_ms: duration
    }, '[TikTok:uploadImage] ✅ Изображение загружено из файла');

    return { image_id: response.data.data.image_id };

  } finally {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
      log.debug({ advertiserId, tmp_path: tmpPath }, '[TikTok:uploadImage] Временный файл удалён');
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
  log.info({
    advertiserId,
    report_type: params.report_type,
    data_level: params.data_level,
    dimensions: params.dimensions,
    metrics: params.metrics,
    date_range: `${params.start_date} - ${params.end_date}`,
    page: params.page || 1,
    page_size: params.page_size || 100,
    has_filtering: !!params.filtering
  }, '[TikTok:getReport] Запрос отчёта');

  const result = await tikTokGraph('POST', 'report/integrated/get/', accessToken, {
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

  log.info({
    advertiserId,
    rows_count: result.data?.list?.length || 0,
    page_info: result.data?.page_info
  }, '[TikTok:getReport] ✅ Отчёт получен');

  return result;
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
  log.info({ advertiserId }, '[TikTok:getAdvertiserInfo] Запрос информации об аккаунте');

  const result = await tikTokGraph('GET', 'advertiser/info/', accessToken, {
    advertiser_ids: [advertiserId],
    fields: ['advertiser_id', 'name', 'company', 'status', 'currency', 'timezone', 'balance']
  });

  const info = result.data?.list?.[0];
  log.info({
    advertiserId,
    name: info?.name,
    company: info?.company,
    status: info?.status,
    currency: info?.currency,
    balance: info?.balance
  }, '[TikTok:getAdvertiserInfo] ✅ Информация получена');

  return result;
}

/**
 * Получить список пикселей
 */
export async function getPixels(
  advertiserId: string,
  accessToken: string
): Promise<any> {
  log.info({ advertiserId }, '[TikTok:getPixels] Запрос списка пикселей');

  const result = await tikTokGraph('GET', 'pixel/list/', accessToken, {
    advertiser_id: advertiserId,
    page: 1,
    page_size: 100
  });

  log.info({
    advertiserId,
    pixels_count: result.data?.pixels?.length || 0
  }, '[TikTok:getPixels] ✅ Пиксели получены');

  return result;
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
  log.info({ advertiserId }, '[TikTok:getIdentities] Запрос идентификаторов');

  const result = await tikTokGraph('GET', 'identity/get/', accessToken, {
    advertiser_id: advertiserId
  });

  log.info({
    advertiserId,
    identities_count: result.data?.identity_list?.length || 0
  }, '[TikTok:getIdentities] ✅ Идентификаторы получены');

  return result;
}

// ============================================================
// INSTANT PAGES (LEAD FORMS)
// ============================================================

export interface TikTokInstantPage {
  page_id: string;
  page_name: string;
  page_type: string;
  status: string;
  create_time?: string;
  modify_time?: string;
}

/**
 * Получить список Instant Pages (Lead Forms) для аккаунта
 *
 * Endpoint: page/list/
 * Документация: https://business-api.tiktok.com/portal/docs
 */
export async function getInstantPages(
  advertiserId: string,
  accessToken: string
): Promise<TikTokInstantPage[]> {
  log.info({ advertiserId }, '[TikTok:getInstantPages] Запрос списка Instant Pages');

  try {
    // Пробуем несколько возможных endpoints для Instant Pages
    // TikTok API может использовать разные пути в зависимости от версии
    let result;
    try {
      result = await tikTokGraph('GET', 'creative/instant_page/list/', accessToken, {
        advertiser_id: advertiserId,
        page_size: 100
      });
    } catch (e: any) {
      log.warn({ error: e.message }, '[TikTok:getInstantPages] creative/instant_page/list/ failed, trying page/list/');
      result = await tikTokGraph('GET', 'page/list/', accessToken, {
        advertiser_id: advertiserId,
        page_size: 100
      });
    }

    const pages = result.data?.page_info_list || [];

    log.info({
      advertiserId,
      pages_count: pages.length
    }, '[TikTok:getInstantPages] ✅ Instant Pages получены');

    return pages.map((p: any) => ({
      page_id: p.page_id,
      page_name: p.page_name || `Page ${p.page_id}`,
      page_type: p.page_type || 'UNKNOWN',
      status: p.status || 'ACTIVE',
      create_time: p.create_time,
      modify_time: p.modify_time
    }));
  } catch (error: any) {
    log.error({
      advertiserId,
      error: error.message
    }, '[TikTok:getInstantPages] Ошибка получения Instant Pages');

    // Возвращаем пустой массив вместо ошибки для graceful degradation
    return [];
  }
}

/**
 * Получить конкретную Instant Page по ID
 */
export async function getInstantPage(
  advertiserId: string,
  pageId: string,
  accessToken: string
): Promise<TikTokInstantPage | null> {
  log.info({ advertiserId, pageId }, '[TikTok:getInstantPage] Запрос Instant Page');

  try {
    const result = await tikTokGraph('GET', 'page/get/', accessToken, {
      advertiser_id: advertiserId,
      page_ids: [pageId]
    });

    const pages = result.data?.page_info_list || [];

    if (pages.length === 0) {
      log.warn({ advertiserId, pageId }, '[TikTok:getInstantPage] Instant Page не найдена');
      return null;
    }

    const p = pages[0];
    log.info({ advertiserId, pageId }, '[TikTok:getInstantPage] ✅ Instant Page получена');

    return {
      page_id: p.page_id,
      page_name: p.page_name || `Page ${p.page_id}`,
      page_type: p.page_type || 'UNKNOWN',
      status: p.status || 'ACTIVE',
      create_time: p.create_time,
      modify_time: p.modify_time
    };
  } catch (error: any) {
    log.error({
      advertiserId,
      pageId,
      error: error.message
    }, '[TikTok:getInstantPage] Ошибка получения Instant Page');
    return null;
  }
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
  getIdentities,

  // Instant Pages (Lead Forms)
  getInstantPages,
  getInstantPage
};

export default tt;
