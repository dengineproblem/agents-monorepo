import crypto from 'node:crypto';
import FormData from 'form-data';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { createLogger } from '../lib/logger.js';
import { resolveFacebookError } from '../lib/facebookErrors.js';

const FB_API_VERSION = process.env.FB_API_VERSION || 'v20.0';
const FB_APP_SECRET = process.env.FB_APP_SECRET || '';
const FB_VALIDATE_ONLY = String(process.env.FB_VALIDATE_ONLY || 'false').toLowerCase() === 'true';
const log = createLogger({ module: 'facebookAdapter' });

// appsecret_proof закомментирован - он нужен ТОЛЬКО для OAuth, 
// но НЕ для обычных API запросов (конфликтует с токенами из Supabase)
// function appsecret_proof(token: string) {
//   return crypto.createHmac('sha256', FB_APP_SECRET).update(token).digest('hex');
// }

export async function graph(method: 'GET'|'POST'|'DELETE', path: string, token: string, params: Record<string, any> = {}) {
  console.log(`[graph] Вызов Facebook API: ${method} ${path}`);
  console.log('[graph] Параметры:', JSON.stringify(params, null, 2));

  const usp = new URLSearchParams();
  usp.set('access_token', token);
  // НЕ используем appsecret_proof - токены могут быть от других приложений
  // if (FB_APP_SECRET) usp.set('appsecret_proof', appsecret_proof(token));
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      // Для объектов используем JSON.stringify, для примитивов - String
      const value = typeof v === 'object' ? JSON.stringify(v) : String(v);
      usp.set(k, value);
    }
  }
  if (FB_VALIDATE_ONLY && (method === 'POST' || method === 'DELETE')) {
    usp.set('execution_options', '["validate_only"]');
  }

  const url = method === 'GET'
    ? `https://graph.facebook.com/${FB_API_VERSION}/${path}?${usp.toString()}`
    : `https://graph.facebook.com/${FB_API_VERSION}/${path}`;

  console.log('[graph] URL:', url.replace(/access_token=[^&]+/, 'access_token=HIDDEN'));
  console.log('[graph] Body:', usp.toString().replace(/access_token=[^&]+/, 'access_token=HIDDEN'));

  // Retry logic для сетевых ошибок (fetch failed, timeout)
  const MAX_RETRIES = 5;
  const RETRY_DELAY = 3000; // 3 секунды между попытками

  let res: Response;
  let lastError: any;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: method === 'GET' ? undefined : usp.toString(),
      });
      clearTimeout(timeout);
      break; // Успешно - выходим из цикла
    } catch (error: any) {
      clearTimeout(timeout);
      lastError = error;

      const isNetworkError = error.name === 'AbortError' ||
                             error.message?.includes('fetch failed') ||
                             error.code === 'ECONNRESET' ||
                             error.code === 'ETIMEDOUT';

      if (isNetworkError && attempt < MAX_RETRIES) {
        log.warn({
          method,
          path,
          attempt,
          error: error.message || error.name
        }, `Network error, retrying in ${RETRY_DELAY}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        continue;
      }

      if (error.name === 'AbortError') {
        log.error({
          msg: 'fb_fetch_timeout',
          method,
          path,
          timeout: 15000,
          attempts: attempt
        }, 'Facebook API request timeout after retries');
        throw new Error(`Facebook API timeout after 15s (${attempt} attempts): ${method} ${path}`);
      }
      throw error;
    }
  }

  if (!res!) {
    throw lastError || new Error(`Failed to fetch after ${MAX_RETRIES} attempts`);
  }

  const text = await res.text();
  console.log('[graph] Ответ от Facebook API:', text.substring(0, 500));

  let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    console.error('[graph] Ошибка от Facebook API:', json);
    const g = json?.error || {};
    const err: any = new Error(g?.message || text || `HTTP ${res.status}`);
    err.fb = {
      status: res.status,
      method, path,
      params: params,
      type: g?.type, code: g?.code, error_subcode: g?.error_subcode, fbtrace_id: g?.fbtrace_id
    };
    const resolution = resolveFacebookError(err.fb);
    log.error({
      msg: resolution.msgCode,
      meta: err.fb,
      resolution
    }, 'Graph API request failed');
    err.resolution = resolution;
    throw err;
  }
  console.log('[graph] Успешный ответ:', json);
  return json;
}

/**
 * Batch запрос к Facebook Graph API
 * Позволяет объединить до 50 запросов в один HTTP вызов
 *
 * @param token - Access token
 * @param requests - Массив запросов для batch
 * @returns Массив результатов (в том же порядке что и requests)
 */
export interface BatchRequest {
  method: 'GET' | 'POST' | 'DELETE';
  relative_url: string;
  body?: string;
}

export interface BatchResponse {
  code: number;
  headers?: Array<{ name: string; value: string }>;
  body: string;
}

export async function graphBatch(
  token: string,
  requests: BatchRequest[]
): Promise<BatchResponse[]> {
  const startTime = Date.now();

  if (requests.length === 0) {
    log.debug({ count: 0 }, '[graphBatch] Empty batch request, returning []');
    return [];
  }

  // Логируем типы запросов в batch
  const requestTypes = requests.reduce((acc, r) => {
    const key = `${r.method} ${r.relative_url.split('?')[0]}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (requests.length > 50) {
    log.info({
      totalCount: requests.length,
      chunks: Math.ceil(requests.length / 50),
      requestTypes
    }, '[graphBatch] Splitting large batch into chunks of 50');

    const results: BatchResponse[] = [];
    for (let i = 0; i < requests.length; i += 50) {
      const chunkIndex = Math.floor(i / 50) + 1;
      const totalChunks = Math.ceil(requests.length / 50);
      const chunk = requests.slice(i, i + 50);

      log.debug({
        chunkIndex,
        totalChunks,
        chunkSize: chunk.length
      }, '[graphBatch] Processing chunk');

      const chunkResults = await graphBatch(token, chunk);
      results.push(...chunkResults);

      // Небольшая задержка между chunks для снижения rate limit
      if (i + 50 < requests.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const duration = Date.now() - startTime;
    log.info({
      totalCount: requests.length,
      resultCount: results.length,
      durationMs: duration
    }, '[graphBatch] All chunks completed');

    return results;
  }

  log.info({
    count: requests.length,
    requestTypes
  }, '[graphBatch] Executing Facebook Batch API request');

  const url = `https://graph.facebook.com/${FB_API_VERSION}/`;
  const usp = new URLSearchParams();
  usp.set('access_token', token);
  usp.set('batch', JSON.stringify(requests));
  usp.set('include_headers', 'false');

  // Retry logic с exponential backoff
  const MAX_RETRIES = 5;
  const BASE_DELAY = 3000;

  let res: Response;
  let lastError: any;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 сек для batch

    try {
      log.debug({ attempt, maxRetries: MAX_RETRIES }, '[graphBatch] Sending request');

      res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: usp.toString(),
      });
      clearTimeout(timeout);

      // Проверяем HTTP статус
      if (!res.ok) {
        const errorText = await res.text();
        log.warn({
          status: res.status,
          statusText: res.statusText,
          errorText: errorText.substring(0, 500),
          attempt
        }, '[graphBatch] HTTP error response');

        // Rate limiting на уровне HTTP
        if (res.status === 400 || res.status === 429) {
          if (attempt < MAX_RETRIES) {
            const delay = BASE_DELAY * Math.pow(2, attempt - 1); // Exponential backoff
            log.warn({ attempt, delay }, '[graphBatch] Rate limited, waiting before retry');
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }

        throw new Error(`HTTP ${res.status}: ${errorText.substring(0, 200)}`);
      }

      break;
    } catch (error: any) {
      clearTimeout(timeout);
      lastError = error;

      const isNetworkError = error.name === 'AbortError' ||
                             error.message?.includes('fetch failed') ||
                             error.code === 'ECONNRESET' ||
                             error.code === 'ETIMEDOUT';

      if (isNetworkError && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, attempt - 1);
        log.warn({
          attempt,
          maxRetries: MAX_RETRIES,
          delay,
          error: error.message,
          errorCode: error.code
        }, '[graphBatch] Network error, retrying with exponential backoff');
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      log.error({
        attempt,
        error: error.message,
        errorCode: error.code,
        stack: error.stack
      }, '[graphBatch] Request failed after all retries');
      throw error;
    }
  }

  if (!res!) {
    log.error({ lastError: lastError?.message }, '[graphBatch] No response after retries');
    throw lastError || new Error(`Batch request failed after ${MAX_RETRIES} attempts`);
  }

  const text = await res.text();
  let json: BatchResponse[];

  try {
    json = JSON.parse(text);
  } catch (parseError) {
    log.error({
      text: text.substring(0, 500),
      parseError: (parseError as Error).message
    }, '[graphBatch] Failed to parse batch response as JSON');
    throw new Error(`Invalid batch response: ${text.substring(0, 200)}`);
  }

  if (!Array.isArray(json)) {
    log.error({
      responseType: typeof json,
      response: JSON.stringify(json).substring(0, 500)
    }, '[graphBatch] Batch response is not an array');
    throw new Error('Batch response is not an array');
  }

  // Детальная статистика по результатам
  const successCount = json.filter(r => r.code >= 200 && r.code < 300).length;
  const errorCount = json.filter(r => r.code >= 400).length;
  const rateLimitCount = json.filter(r => {
    if (r.code !== 400) return false;
    try {
      const body = JSON.parse(r.body);
      return body?.error?.code === 17 || body?.error?.code === 4;
    } catch { return false; }
  }).length;

  const duration = Date.now() - startTime;

  log.info({
    count: json.length,
    successCount,
    errorCount,
    rateLimitCount,
    durationMs: duration,
    avgTimePerRequest: Math.round(duration / json.length)
  }, '[graphBatch] Batch request completed');

  // Логируем ошибки для отладки
  if (errorCount > 0) {
    const errors = json
      .filter(r => r.code >= 400)
      .slice(0, 3) // Первые 3 ошибки
      .map((r, i) => {
        try {
          const body = JSON.parse(r.body);
          return {
            index: i,
            code: r.code,
            errorCode: body?.error?.code,
            errorSubcode: body?.error?.error_subcode,
            message: body?.error?.message?.substring(0, 200),
            errorUserTitle: body?.error?.error_user_title,
            errorUserMsg: body?.error?.error_user_msg?.substring(0, 300),
            blameFieldSpecs: body?.error?.error_data?.blame_field_specs,
          };
        } catch {
          return { index: i, code: r.code, body: r.body.substring(0, 100) };
        }
      });
    log.warn({ errorSamples: errors }, '[graphBatch] Some requests in batch failed');
  }

  return json;
}

/**
 * Парсит body из batch response
 */
export function parseBatchBody<T = any>(response: BatchResponse): { success: boolean; data?: T; error?: any } {
  try {
    const body = JSON.parse(response.body);
    if (response.code >= 200 && response.code < 300) {
      return { success: true, data: body };
    } else {
      return { success: false, error: body.error || body };
    }
  } catch {
    return { success: false, error: { message: response.body } };
  }
}

/**
 * Получить URL аватара Facebook страницы
 * @param pageId - ID страницы Facebook
 * @param accessToken - Access token с доступом к странице
 * @returns URL аватара или null
 */
export async function getPagePictureUrl(pageId: string, accessToken: string): Promise<string | null> {
  try {
    // Graph API возвращает redirect на картинку, нам нужен URL
    const result = await graph('GET', `${pageId}/picture`, accessToken, {
      redirect: 'false',
      type: 'small', // small (50x50), normal (100x100), large (200x200)
    });

    if (result?.data?.url) {
      return result.data.url;
    }

    return null;
  } catch (error: any) {
    log.warn({ err: error, pageId }, 'Failed to get page picture URL');
    return null;
  }
}

/**
 * Загрузка видео в Facebook Ad Account с поддержкой больших файлов (>100 МБ)
 * Использует chunked upload через graph-video.facebook.com
 *
 * ОПТИМИЗАЦИЯ: Принимает путь к файлу вместо Buffer для экономии памяти.
 * Файл читается потоком напрямую, без загрузки в память.
 */
export async function uploadVideo(adAccountId: string, token: string, filePath: string): Promise<{ id: string }> {
  const stats = await fs.promises.stat(filePath);
  const fileSize = stats.size;
  const fileSizeMB = Math.round(fileSize / 1024 / 1024);

  log.info({ adAccountId, fileSizeMB, filePath }, 'Starting video upload to Facebook (streaming mode)');

  try {
    // Для файлов >50 МБ используем chunked upload через graph-video
    if (fileSize > 50 * 1024 * 1024) {
      log.info({ adAccountId, fileSizeMB }, 'Using chunked upload for large video');
      const videoId = await uploadVideoChunked(adAccountId, token, filePath, fileSize);
      return { id: videoId };
    }

    // Для маленьких файлов используем простой upload с streaming
    log.info({ adAccountId, fileSizeMB }, 'Using simple upload for video (streaming)');
    const formData = new FormData();
    // ВАЖНО: Указываем filename с расширением .mp4, иначе Facebook не определит формат
    // TUS сохраняет файлы без расширения, поэтому нужно явно указать
    formData.append('source', fs.createReadStream(filePath), {
      filename: 'video.mp4',
      contentType: 'video/mp4'
    });

    const url = `https://graph-video.facebook.com/${FB_API_VERSION}/${adAccountId}/advideos?access_token=${token}`;

    const response = await axios.post(url, formData, {
      headers: formData.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 600000 // 10 минут для upload
    });

    log.info({ adAccountId, videoId: response.data.id }, 'Video uploaded successfully');

    return response.data;
  } catch (error: any) {
    // Подробное логирование ошибки
    console.error('[uploadVideo] Full error object:', JSON.stringify({
      message: error?.message,
      code: error?.code,
      response_status: error?.response?.status,
      response_data: error?.response?.data,
      response_headers: error?.response?.headers
    }, null, 2));

    const g = error?.response?.data?.error || {};
    const err: any = new Error(g?.message || error.message);
    err.fb = {
      status: error?.response?.status,
      method: 'POST',
      path: `${adAccountId}/advideos`,
      type: g?.type,
      code: g?.code,
      error_subcode: g?.error_subcode,
      fbtrace_id: g?.fbtrace_id
    };
    err.resolution = resolveFacebookError(err.fb);

    log.error({
      msg: err.resolution.msgCode,
      adAccountId,
      meta: err.fb,
      resolution: err.resolution,
      status: error?.response?.status,
      statusText: error?.response?.statusText,
      message: error?.message
    }, 'Facebook API error during video upload');

    throw err;
  }
}

/**
 * Helper для axios запросов с retry
 * ОПТИМИЗАЦИЯ: Увеличены maxRetries и baseDelay для большей надёжности
 */
async function axiosWithRetry<T>(
  requestFn: () => Promise<T>,
  options: { maxRetries?: number; baseDelay?: number; phase?: string } = {}
): Promise<T> {
  const { maxRetries = 7, baseDelay = 5000, phase = 'request' } = options;
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error: any) {
      lastError = error;

      const isRetryable =
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNABORTED' ||
        error.message?.includes('socket hang up') ||
        error.message?.includes('network') ||
        error.response?.status === 500 ||
        error.response?.status === 502 ||
        error.response?.status === 503 ||
        error.response?.status === 504;

      if (isRetryable && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
        log.warn({
          phase,
          attempt,
          maxRetries,
          delayMs: delay,
          error: error.message
        }, `Retrying ${phase} after error`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

/**
 * Chunked upload для больших видео
 * Протокол: start → transfer (loop) → finish
 */
async function uploadVideoChunked(adAccountId: string, token: string, filePath: string, fileSize: number): Promise<string> {
  const base = `https://graph-video.facebook.com/${FB_API_VERSION}`;
  const url = `${base}/${adAccountId}/advideos`;

  log.info({ adAccountId, fileSizeMB: Math.round(fileSize / 1024 / 1024) }, 'Starting chunked video upload');

  // 1) START phase с retry
  const startFormData = new FormData();
  startFormData.append('access_token', token);
  startFormData.append('upload_phase', 'start');
  startFormData.append('file_size', String(fileSize));

  const startRes = await axiosWithRetry(
    () => axios.post(url, startFormData, {
      headers: startFormData.getHeaders(),
      timeout: 120000 // ОПТИМИЗАЦИЯ: 2 минуты (было 60 сек)
    }),
    { phase: 'start' }
  );

  let { upload_session_id, start_offset, end_offset, video_id } = startRes.data;
  log.debug({ uploadSessionId: upload_session_id, start_offset, end_offset }, 'Chunked upload session started');

  // 2) TRANSFER phase (loop)
  let chunkNumber = 0;
  while (start_offset !== end_offset) {
    chunkNumber++;
    const start = parseInt(start_offset, 10);
    const end = parseInt(end_offset, 10);
    const chunkSize = end - start;

    log.debug({ chunkNumber, start, end, chunkSizeMB: Math.round(chunkSize / 1024 / 1024) }, 'Uploading video chunk');

    // Retry для каждого chunk
    const transferRes = await axiosWithRetry(
      () => {
        // Создаём новый stream для каждой попытки (stream нельзя переиспользовать)
        const chunk = fs.createReadStream(filePath, {
          start,
          end: end - 1
        });

        const transferFormData = new FormData();
        transferFormData.append('access_token', token);
        transferFormData.append('upload_phase', 'transfer');
        transferFormData.append('upload_session_id', upload_session_id);
        transferFormData.append('start_offset', String(start));
        // ВАЖНО: Указываем filename с расширением .mp4
        // TUS сохраняет файлы без расширения, path.basename вернёт ID без расширения
        const basename = path.basename(filePath);
        const filename = basename.includes('.') ? basename : `${basename}.mp4`;
        transferFormData.append('video_file_chunk', chunk, {
          filename,
          contentType: 'video/mp4',
          knownLength: chunkSize
        });

        return axios.post(url, transferFormData, {
          headers: transferFormData.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 600000 // ОПТИМИЗАЦИЯ: 10 минут для chunk (было 5 минут)
        });
      },
      { phase: `transfer-chunk-${chunkNumber}` }
    );

    // Сервер возвращает следующий диапазон
    start_offset = transferRes.data.start_offset;
    end_offset = transferRes.data.end_offset;

    const progress = Math.round((start / fileSize) * 100);
    log.debug({ chunkNumber, progress }, 'Chunk uploaded');
  }

  log.info({ uploadSessionId: upload_session_id }, 'All video chunks uploaded, finishing');

  // 3) FINISH phase с retry
  const finishFormData = new FormData();
  finishFormData.append('access_token', token);
  finishFormData.append('upload_phase', 'finish');
  finishFormData.append('upload_session_id', upload_session_id);

  const finishRes = await axiosWithRetry(
    () => axios.post(url, finishFormData, {
      headers: finishFormData.getHeaders(),
      timeout: 120000 // ОПТИМИЗАЦИЯ: 2 минуты (было 60 сек)
    }),
    { phase: 'finish' }
  );

  const finalVideoId = finishRes.data.video_id || video_id;
  log.info({ adAccountId, videoId: finalVideoId }, 'Chunked video upload completed');

  return finalVideoId;
}

/**
 * Создает WhatsApp креатив с видео
 *
 * ВАЖНО: Facebook постепенно отключает поддержку page_welcome_message через API.
 * Для некоторых аккаунтов работает, для некоторых нет (error_subcode: 1815166).
 * Используем fallback: сначала пробуем с page_welcome_message, если не работает - без него.
 */
export async function createWhatsAppCreative(
  adAccountId: string,
  token: string,
  params: {
    videoId: string;
    pageId: string;
    instagramId?: string;
    message: string;
    clientQuestion: string;
    whatsappPhoneNumber?: string;
    thumbnailHash?: string;
    imageUrl?: string; // Для импортированных видео
  }
): Promise<{ id: string }> {
  const pageWelcomeMessage = JSON.stringify({
    type: "VISUAL_EDITOR",
    version: 2,
    landing_screen_type: "welcome_message",
    media_type: "text",
    text_format: {
      customer_action_type: "autofill_message",
      message: {
        autofill_message: { content: params.clientQuestion },
        text: "Здравствуйте! Чем можем помочь?"
      }
    }
  });

  const callToAction: any = { type: "WHATSAPP_MESSAGE" };
  if (params.whatsappPhoneNumber) {
    callToAction.value = {
      whatsapp_number: params.whatsappPhoneNumber
    };
  }

  log.debug({ adAccountId, callToAction }, 'WhatsApp creative callToAction');

  // Пробуем сначала с page_welcome_message
  const videoDataWithWelcome: any = {
    video_id: params.videoId,
    message: params.message,
    call_to_action: callToAction,
    page_welcome_message: pageWelcomeMessage
  };

  // Добавляем image_hash или image_url если есть thumbnail
  if (params.thumbnailHash) {
    videoDataWithWelcome.image_hash = params.thumbnailHash;
  } else if (params.imageUrl) {
    videoDataWithWelcome.image_url = params.imageUrl;
  }

  const objectStorySpecWithWelcome: any = {
    page_id: params.pageId,
    video_data: videoDataWithWelcome
  };

  // Instagram ID опционален - без него реклама будет показываться от имени страницы
  if (params.instagramId) {
    objectStorySpecWithWelcome.instagram_user_id = params.instagramId;
  }
  log.info({ fn: 'createWhatsAppCreative', pageId: params.pageId, hasInstagramId: !!params.instagramId }, '[FB Creative] Building WhatsApp video creative');

  try {
    return await graph('POST', `${adAccountId}/adcreatives`, token, {
      name: "Video CTWA – WhatsApp",
      object_story_spec: JSON.stringify(objectStorySpecWithWelcome)
    });
  } catch (error: any) {
    // Если ошибка 1815166 (Invalid creative's object story spec) или 1487194 (Permissions error) - пробуем без page_welcome_message
    const isWelcomeMessageError = error?.fb?.error_subcode === 1815166 || error?.fb?.error_subcode === 1487194;
    if (isWelcomeMessageError) {
      log.warn({
        adAccountId,
        error_subcode: error?.fb?.error_subcode,
        msg: 'page_welcome_message not supported, retrying without it'
      }, 'WhatsApp creative: page_welcome_message не поддерживается для этого аккаунта, создаем без него');

      const videoDataWithoutWelcome: any = {
        video_id: params.videoId,
        message: params.message,
        call_to_action: callToAction
        // page_welcome_message убран
      };

      if (params.thumbnailHash) {
        videoDataWithoutWelcome.image_hash = params.thumbnailHash;
      } else if (params.imageUrl) {
        videoDataWithoutWelcome.image_url = params.imageUrl;
      }

      const objectStorySpecWithoutWelcome: any = {
        page_id: params.pageId,
        video_data: videoDataWithoutWelcome
      };

      if (params.instagramId) {
        objectStorySpecWithoutWelcome.instagram_user_id = params.instagramId;
      }

      return await graph('POST', `${adAccountId}/adcreatives`, token, {
        name: "Video CTWA – WhatsApp",
        object_story_spec: JSON.stringify(objectStorySpecWithoutWelcome)
      });
    }

    // Другие ошибки пробрасываем дальше
    throw error;
  }
}

export async function createInstagramCreative(
  adAccountId: string,
  token: string,
  params: {
    videoId: string;
    pageId: string;
    instagramId: string;
    instagramUsername: string;
    message: string;
    thumbnailHash?: string;
    imageUrl?: string; // Для импортированных видео
  }
): Promise<{ id: string }> {
  const videoData: any = {
    video_id: params.videoId,
    message: params.message,
    call_to_action: {
      type: "LEARN_MORE",
      value: {
        link: `https://www.instagram.com/${params.instagramUsername}`
      }
    }
  };

  // Добавляем image_hash или image_url если есть thumbnail
  if (params.thumbnailHash) {
    videoData.image_hash = params.thumbnailHash;
  } else if (params.imageUrl) {
    videoData.image_url = params.imageUrl;
  }
  
  const objectStorySpec = {
    page_id: params.pageId,
    instagram_user_id: params.instagramId,
    video_data: videoData
  };

  return await graph('POST', `${adAccountId}/adcreatives`, token, {
    name: "Instagram Profile Creative",
    object_story_spec: JSON.stringify(objectStorySpec)
  });
}

export async function createWebsiteLeadsCreative(
  adAccountId: string,
  token: string,
  params: {
    videoId: string;
    pageId: string;
    instagramId?: string | null;
    message: string;
    siteUrl: string;
    utm?: string;
    thumbnailHash?: string;
    imageUrl?: string; // Для импортированных видео
  }
): Promise<{ id: string }> {
  log.info({
    fn: 'createWebsiteLeadsCreative',
    adAccountId,
    pageId: params.pageId,
    hasInstagramId: !!params.instagramId,
    siteUrl: params.siteUrl,
    hasUtm: !!params.utm
  }, '[FB Creative] Building Website Leads video creative');

  const videoData: any = {
    video_id: params.videoId,
    message: params.message,
    call_to_action: {
      type: "SIGN_UP",
      value: {
        link: params.siteUrl
      }
    }
  };

  // Добавляем image_hash или image_url если есть thumbnail
  if (params.thumbnailHash) {
    videoData.image_hash = params.thumbnailHash;
  } else if (params.imageUrl) {
    videoData.image_url = params.imageUrl;
  }

  const objectStorySpec: any = {
    page_id: params.pageId,
    video_data: videoData
  };
  if (params.instagramId) {
    objectStorySpec.instagram_user_id = params.instagramId;
  }

  const payload: any = {
    name: "Website Leads Creative",
    url_tags: params.utm || "utm_source=facebook&utm_campaign={{campaign.name}}&utm_medium={{ad.id}}",
    object_story_spec: objectStorySpec
  };

  console.log('[createWebsiteLeadsCreative] Payload перед отправкой:');
  console.log(JSON.stringify(payload, null, 2));

  try {
    const result = await graph('POST', `${adAccountId}/adcreatives`, token, payload);
    console.log('[createWebsiteLeadsCreative] Успешный ответ:', result);
    return result;
  } catch (error) {
    console.error('[createWebsiteLeadsCreative] Ошибка при создании креатива:', error);
    throw error;
  }
}

/**
 * Создает App Installs видео креатив
 * Для objective OUTCOME_APP_PROMOTION (app installs)
 */
export async function createAppInstallsVideoCreative(
  adAccountId: string,
  token: string,
  params: {
    videoId: string;
    pageId: string;
    instagramId?: string | null;
    message: string;
    appStoreUrl: string;
    thumbnailHash?: string;
    imageUrl?: string;
  }
): Promise<{ id: string }> {
  log.info({
    fn: 'createAppInstallsVideoCreative',
    adAccountId,
    pageId: params.pageId,
    hasInstagramId: !!params.instagramId,
    appStoreUrl: params.appStoreUrl
  }, '[FB Creative] Building App Installs video creative');

  const videoData: any = {
    video_id: params.videoId,
    message: params.message,
    call_to_action: {
      type: "INSTALL_MOBILE_APP",
      value: {
        link: params.appStoreUrl
      }
    }
  };

  if (params.thumbnailHash) {
    videoData.image_hash = params.thumbnailHash;
  } else if (params.imageUrl) {
    videoData.image_url = params.imageUrl;
  }

  const objectStorySpec: any = {
    page_id: params.pageId,
    video_data: videoData
  };
  if (params.instagramId) {
    objectStorySpec.instagram_user_id = params.instagramId;
  }

  return await graph('POST', `${adAccountId}/adcreatives`, token, {
    name: "App Installs Video Creative",
    object_story_spec: objectStorySpec
  });
}

/**
 * Создает Lead Form видео креатив
 * Для Facebook Instant Forms (lead_gen_form_id)
 */
export async function createLeadFormVideoCreative(
  adAccountId: string,
  token: string,
  params: {
    videoId: string;
    pageId: string;
    instagramId?: string | null;
    message: string;
    leadFormId: string;
    thumbnailHash?: string;
    imageUrl?: string; // Для импортированных видео
  }
): Promise<{ id: string }> {
  log.info({ fn: 'createLeadFormVideoCreative', pageId: params.pageId, hasInstagramId: !!params.instagramId, leadFormId: params.leadFormId }, '[FB Creative] Building Lead Form video creative');

  const videoData: any = {
    video_id: params.videoId,
    message: params.message,
    call_to_action: {
      type: "LEARN_MORE",
      value: {
        lead_gen_form_id: params.leadFormId
      }
    }
  };

  if (params.thumbnailHash) {
    videoData.image_hash = params.thumbnailHash;
  } else if (params.imageUrl) {
    videoData.image_url = params.imageUrl;
  }

  const objectStorySpec: any = {
    page_id: params.pageId,
    video_data: videoData
  };
  if (params.instagramId) {
    objectStorySpec.instagram_user_id = params.instagramId;
  }

  const payload: any = {
    name: "Lead Form Video Creative",
    object_story_spec: objectStorySpec
  };

  return await graph('POST', `${adAccountId}/adcreatives`, token, payload);
}

/**
 * Создает Lookalike Audience 3% от seed аудитории
 * @param adAccountId - ID рекламного аккаунта (без act_ префикса)
 * @param seedAudienceId - ID исходной Custom Audience (например, IG Engagers 365d)
 * @param country - Код страны (например, 'KZ')
 * @param token - Access token
 * @returns { id: string } - ID созданной LAL аудитории
 */
/**
 * Загрузка изображения в Facebook Ad Account
 * @returns { hash: string } - Hash изображения для использования в креативах
 */
export async function uploadImage(adAccountId: string, token: string, imageBuffer: Buffer): Promise<{ hash: string; url?: string }> {
  // Multipart загрузка как в n8n: поле 'filename' с бинарным файлом
  const tmpPath = path.join('/var/tmp', `fb_image_${randomUUID()}.jpg`);
  fs.writeFileSync(tmpPath, imageBuffer);
  try {
    const formData = new FormData();
    formData.append('filename', fs.createReadStream(tmpPath), {
      filename: path.basename(tmpPath),
      contentType: 'image/jpeg'
    });

    const url = `https://graph.facebook.com/${FB_API_VERSION}/${adAccountId}/adimages`;

    const response = await axios.post(url, formData, {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${token}`
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    const images = (response.data && response.data.images) || {};
    const firstKey = Object.keys(images)[0];
    const imageData = firstKey ? images[firstKey] : undefined;
    const hash = imageData?.hash;
    const imageUrl = imageData?.url;
    if (!hash) throw new Error('No image hash returned from Facebook API');
    log.info({ adAccountId, hash, imageUrl }, 'Image uploaded successfully');
    return { hash, url: imageUrl };
  } catch (error: any) {
    console.error('[uploadImage] Facebook API Error (multipart):', {
      status: error?.response?.status,
      statusText: error?.response?.statusText,
      data: error?.response?.data,
      message: error?.message
    });
    const g = error?.response?.data?.error || {};
    const err: any = new Error(g?.message || error.message);
    err.fb = {
      status: error?.response?.status,
      method: 'POST',
      path: `${adAccountId}/adimages`,
      type: g?.type,
      code: g?.code,
      error_subcode: g?.error_subcode,
      fbtrace_id: g?.fbtrace_id
    };
    err.resolution = resolveFacebookError(err.fb);
    throw err;
  } finally {
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }
}

/**
 * Создает WhatsApp креатив с изображением
 *
 * ВАЖНО: Facebook постепенно отключает поддержку page_welcome_message через API.
 * Для некоторых аккаунтов работает, для некоторых нет (error_subcode: 1815166).
 * Используем fallback: сначала пробуем с page_welcome_message, если не работает - без него.
 */
export async function createWhatsAppImageCreative(
  adAccountId: string,
  token: string,
  params: {
    imageHash: string;
    pageId: string;
    instagramId?: string | null;
    message: string;
    clientQuestion: string;
  }
): Promise<{ id: string }> {
  log.info({ fn: 'createWhatsAppImageCreative', pageId: params.pageId, hasInstagramId: !!params.instagramId }, '[FB Creative] Building WhatsApp image creative');

  const pageWelcomeMessage = JSON.stringify({
    type: "VISUAL_EDITOR",
    version: 2,
    landing_screen_type: "welcome_message",
    media_type: "text",
    text_format: {
      customer_action_type: "autofill_message",
      message: {
        autofill_message: { content: params.clientQuestion },
        text: "Здравствуйте! Чем можем помочь?"
      }
    }
  });

  // Для WhatsApp кампаний (OUTCOME_ENGAGEMENT) ОБЯЗАТЕЛЕН тип WHATSAPP_MESSAGE
  // LEARN_MORE несовместим с целью WhatsApp (error_subcode: 1487891)
  const callToAction: any = { type: "WHATSAPP_MESSAGE" };

  log.debug({ adAccountId, callToAction }, 'WhatsApp image creative callToAction');

  // Пробуем сначала с page_welcome_message
  const objectStorySpecWithWelcome: any = {
    page_id: params.pageId,
    link_data: {
      image_hash: params.imageHash,
      link: "https://www.facebook.com/",
      message: params.message,
      call_to_action: callToAction,
      page_welcome_message: pageWelcomeMessage
    }
  };
  if (params.instagramId) {
    objectStorySpecWithWelcome.instagram_user_id = params.instagramId;
  }

  try {
    return await graph('POST', `${adAccountId}/adcreatives`, token, {
      name: "Image CTWA – WhatsApp",
      object_story_spec: JSON.stringify(objectStorySpecWithWelcome)
    });
  } catch (error: any) {
    // Если ошибка 1815166 (Invalid creative's object story spec) или 1487194 (Permissions error) - пробуем без page_welcome_message
    const isWelcomeMessageError = error?.fb?.error_subcode === 1815166 || error?.fb?.error_subcode === 1487194;
    if (isWelcomeMessageError) {
      log.warn({
        adAccountId,
        error_subcode: error?.fb?.error_subcode,
        msg: 'page_welcome_message not supported, retrying without it'
      }, 'WhatsApp creative: page_welcome_message не поддерживается для этого аккаунта, создаем без него');

      const objectStorySpecWithoutWelcome: any = {
        page_id: params.pageId,
        link_data: {
          image_hash: params.imageHash,
          link: "https://www.facebook.com/",
          message: params.message,
          call_to_action: callToAction
          // page_welcome_message убран
        }
      };
      if (params.instagramId) {
        objectStorySpecWithoutWelcome.instagram_user_id = params.instagramId;
      }

      try {
        return await graph('POST', `${adAccountId}/adcreatives`, token, {
          name: "Image CTWA – WhatsApp",
          object_story_spec: JSON.stringify(objectStorySpecWithoutWelcome)
        });
      } catch (retryError: any) {
        // Если снова ошибка 1487194 - пробуем без instagram_user_id
        if (retryError?.fb?.error_subcode === 1487194) {
          log.warn({
            adAccountId,
            msg: 'instagram_user_id causing permissions error, retrying without it'
          }, 'WhatsApp creative: instagram_user_id вызывает ошибку прав, создаем без него (только Facebook)');

          const objectStorySpecWithoutInstagram = {
            page_id: params.pageId,
            // instagram_user_id убран - креатив покажется только в Facebook
            link_data: {
              image_hash: params.imageHash,
              link: "https://www.facebook.com/",
              message: params.message,
              call_to_action: callToAction
            }
          };

          return await graph('POST', `${adAccountId}/adcreatives`, token, {
            name: "Image CTWA – WhatsApp",
            object_story_spec: JSON.stringify(objectStorySpecWithoutInstagram)
          });
        }
        throw retryError;
      }
    }

    // Другие ошибки пробрасываем дальше
    throw error;
  }
}

/**
 * Создает Instagram Traffic креатив с изображением
 */
export async function createInstagramImageCreative(
  adAccountId: string,
  token: string,
  params: {
    imageHash: string;
    pageId: string;
    instagramId: string;
    instagramUsername: string;
    message: string;
  }
): Promise<{ id: string }> {
  const landingLink = `https://www.instagram.com/${params.instagramUsername}`;
  const objectStorySpec = {
    page_id: params.pageId,
    instagram_user_id: params.instagramId,
    link_data: {
      image_hash: params.imageHash,
      message: params.message,
      link: landingLink,
      call_to_action: {
        type: "LEARN_MORE",
        value: { link: landingLink }
      }
    }
  };

  return await graph('POST', `${adAccountId}/adcreatives`, token, {
    name: "Instagram Profile Image Creative",
    object_story_spec: JSON.stringify(objectStorySpec)
  });
}

/**
 * Создает Website Leads креатив с изображением
 */
export async function createWebsiteLeadsImageCreative(
  adAccountId: string,
  token: string,
  params: {
    imageHash: string;
    pageId: string;
    instagramId?: string | null;
    message: string;
    siteUrl: string;
    utm?: string;
  }
): Promise<{ id: string }> {
  log.info({ fn: 'createWebsiteLeadsImageCreative', pageId: params.pageId, hasInstagramId: !!params.instagramId, siteUrl: params.siteUrl }, '[FB Creative] Building Website Leads image creative');

  const objectStorySpec: any = {
    page_id: params.pageId,
    link_data: {
      image_hash: params.imageHash,
      message: params.message,
      link: params.siteUrl,
      call_to_action: {
        type: "SIGN_UP",
        value: {
          link: params.siteUrl
        }
      }
    }
  };
  if (params.instagramId) {
    objectStorySpec.instagram_user_id = params.instagramId;
  }

  const payload: any = {
    name: "Website Leads Image Creative",
    url_tags: params.utm || "utm_source=facebook&utm_campaign={{campaign.name}}&utm_medium={{ad.id}}",
    object_story_spec: objectStorySpec
  };

  return await graph('POST', `${adAccountId}/adcreatives`, token, payload);
}

/**
 * Создает App Installs креатив с изображением
 */
export async function createAppInstallsImageCreative(
  adAccountId: string,
  token: string,
  params: {
    imageHash: string;
    pageId: string;
    instagramId?: string | null;
    message: string;
    appStoreUrl: string;
  }
): Promise<{ id: string }> {
  log.info({
    fn: 'createAppInstallsImageCreative',
    pageId: params.pageId,
    hasInstagramId: !!params.instagramId,
    appStoreUrl: params.appStoreUrl
  }, '[FB Creative] Building App Installs image creative');

  const objectStorySpec: any = {
    page_id: params.pageId,
    link_data: {
      image_hash: params.imageHash,
      message: params.message,
      link: params.appStoreUrl,
      call_to_action: {
        type: "INSTALL_MOBILE_APP",
        value: {
          link: params.appStoreUrl
        }
      }
    }
  };
  if (params.instagramId) {
    objectStorySpec.instagram_user_id = params.instagramId;
  }

  const payload: any = {
    name: "App Installs Image Creative",
    object_story_spec: objectStorySpec
  };

  return await graph('POST', `${adAccountId}/adcreatives`, token, payload);
}

/**
 * Создает Lead Form креатив с изображением
 * Для Facebook Instant Forms (lead_gen_form_id)
 */
export async function createLeadFormImageCreative(
  adAccountId: string,
  token: string,
  params: {
    imageHash: string;
    pageId: string;
    instagramId?: string | null;
    message: string;
    leadFormId: string;
    link: string;  // Required by Facebook API for link_data structure
  }
): Promise<{ id: string }> {
  log.info({ fn: 'createLeadFormImageCreative', pageId: params.pageId, hasInstagramId: !!params.instagramId, leadFormId: params.leadFormId }, '[FB Creative] Building Lead Form image creative');

  // Note: link is required for image creatives with lead forms (link_data structure)
  // For video creatives, link is not required (video_data structure)

  const linkData: any = {
    image_hash: params.imageHash,
    message: params.message,
    link: params.link,
    call_to_action: {
      type: "LEARN_MORE",
      value: {
        lead_gen_form_id: params.leadFormId
      }
    }
  };

  const objectStorySpec: any = {
    page_id: params.pageId,
    link_data: linkData
  };
  if (params.instagramId) {
    objectStorySpec.instagram_user_id = params.instagramId;
  }

  const payload: any = {
    name: "Lead Form Image Creative",
    object_story_spec: objectStorySpec
  };

  return await graph('POST', `${adAccountId}/adcreatives`, token, payload);
}

// ============================================
// MULTI-FORMAT IMAGE CREATIVES (asset_feed_spec)
// Для автоматического показа разных форматов в разных плейсментах
// ============================================

/**
 * Создает WhatsApp креатив с несколькими форматами изображений
 * ВАЖНО: CTWA (Click-to-WhatsApp) креативы НЕ поддерживают asset_feed_spec + asset_customization_rules
 * с link_data в object_story_spec (ошибка 1885374). Используем только 4:5 формат который работает везде.
 *
 * Для полноценной multi-format поддержки WhatsApp нужно создавать отдельные креативы
 * для разных плейсментов и использовать их в разных ad sets.
 */
export async function createWhatsAppImageCreativeMultiFormat(
  adAccountId: string,
  token: string,
  params: {
    imageHash9x16: string;  // для Stories/Reels (не используется для CTWA)
    imageHash4x5: string;   // для Feed (используется как основной)
    pageId: string;
    instagramId?: string | null;
    message: string;
    clientQuestion: string;
  }
): Promise<{ id: string }> {
  log.info({ fn: 'createWhatsAppImageCreativeMultiFormat', pageId: params.pageId, hasInstagramId: !!params.instagramId }, '[FB Creative] Building WhatsApp multi-format image creative');
  // Для CTWA используем стандартный подход без asset_feed_spec
  // 4:5 формат работает во всех плейсментах (хоть и не оптимально для Stories)
  log.warn('WhatsApp CTWA не поддерживает multi-format (asset_feed_spec), используем 4:5 формат для всех плейсментов');

  return await createWhatsAppImageCreative(adAccountId, token, {
    imageHash: params.imageHash4x5, // Используем 4:5 для всех плейсментов
    pageId: params.pageId,
    instagramId: params.instagramId,
    message: params.message,
    clientQuestion: params.clientQuestion
  });
}

/**
 * Создает Instagram Traffic креатив с несколькими форматами изображений
 */
export async function createInstagramImageCreativeMultiFormat(
  adAccountId: string,
  token: string,
  params: {
    imageHash9x16: string;
    imageHash4x5: string;
    pageId: string;
    instagramId: string;
    instagramUsername: string;
    message: string;
  }
): Promise<{ id: string }> {
  const landingLink = `https://www.instagram.com/${params.instagramUsername}`;

  const objectStorySpec = {
    page_id: params.pageId,
    instagram_user_id: params.instagramId,
    link_data: {
      image_hash: params.imageHash4x5,
      link: landingLink,
      message: params.message,
      call_to_action: {
        type: "LEARN_MORE",
        value: { link: landingLink }
      }
    }
  };

  const payload = {
    name: "Instagram Profile Image Creative (Multi-Format)",
    object_story_spec: JSON.stringify(objectStorySpec),
    asset_feed_spec: JSON.stringify({
      images: [
        { hash: params.imageHash4x5, adlabels: [{ name: "feed_image" }] },
        { hash: params.imageHash9x16, adlabels: [{ name: "story_image" }] }
      ]
    }),
    asset_customization_rules: JSON.stringify([
      {
        customization_spec: {
          publisher_platforms: ["facebook", "instagram"],
          facebook_positions: ["feed"],
          instagram_positions: ["stream"]
        },
        image_label: { name: "feed_image" }
      },
      {
        customization_spec: {
          publisher_platforms: ["facebook", "instagram"],
          facebook_positions: ["story"],
          instagram_positions: ["story", "reels"]
        },
        image_label: { name: "story_image" }
      }
    ])
  };

  log.debug({ adAccountId, instagramUsername: params.instagramUsername }, 'Creating Instagram multi-format image creative');
  return await graph('POST', `${adAccountId}/adcreatives`, token, payload);
}

/**
 * Создает Website Leads креатив с несколькими форматами изображений
 */
export async function createWebsiteLeadsImageCreativeMultiFormat(
  adAccountId: string,
  token: string,
  params: {
    imageHash9x16: string;
    imageHash4x5: string;
    pageId: string;
    instagramId?: string | null;
    message: string;
    siteUrl: string;
    utm?: string;
  }
): Promise<{ id: string }> {
  log.info({ fn: 'createWebsiteLeadsImageCreativeMultiFormat', pageId: params.pageId, hasInstagramId: !!params.instagramId, siteUrl: params.siteUrl }, '[FB Creative] Building Website Leads multi-format image creative');

  const objectStorySpec: any = {
    page_id: params.pageId,
    link_data: {
      image_hash: params.imageHash4x5,
      link: params.siteUrl,
      message: params.message,
      call_to_action: {
        type: "SIGN_UP",
        value: { link: params.siteUrl }
      }
    }
  };
  if (params.instagramId) {
    objectStorySpec.instagram_user_id = params.instagramId;
  }

  const payload: any = {
    name: "Website Leads Image Creative (Multi-Format)",
    url_tags: params.utm || "utm_source=facebook&utm_campaign={{campaign.name}}&utm_medium={{ad.id}}",
    object_story_spec: JSON.stringify(objectStorySpec),
    asset_feed_spec: JSON.stringify({
      images: [
        { hash: params.imageHash4x5, adlabels: [{ name: "feed_image" }] },
        { hash: params.imageHash9x16, adlabels: [{ name: "story_image" }] }
      ]
    }),
    asset_customization_rules: JSON.stringify([
      {
        customization_spec: {
          publisher_platforms: ["facebook", "instagram"],
          facebook_positions: ["feed"],
          instagram_positions: ["stream"]
        },
        image_label: { name: "feed_image" }
      },
      {
        customization_spec: {
          publisher_platforms: ["facebook", "instagram"],
          facebook_positions: ["story"],
          instagram_positions: ["story", "reels"]
        },
        image_label: { name: "story_image" }
      }
    ])
  };

  log.debug({ adAccountId, siteUrl: params.siteUrl }, 'Creating Website Leads multi-format image creative');
  return await graph('POST', `${adAccountId}/adcreatives`, token, payload);
}

// ============================================
// CAROUSEL CREATIVES
// ============================================

interface CarouselCardParams {
  imageHash: string;
  text: string;
  link?: string;
}

/**
 * Создаёт WhatsApp carousel creative
 * Каждая карточка карусели ведёт на WhatsApp
 *
 * ВАЖНО: Facebook постепенно отключает поддержку page_welcome_message через API.
 * Для некоторых аккаунтов работает, для некоторых нет (error_subcode: 1815166).
 * Используем fallback: сначала пробуем с page_welcome_message, если не работает - без него.
 */
export async function createWhatsAppCarouselCreative(
  adAccountId: string,
  token: string,
  params: {
    cards: CarouselCardParams[];
    pageId: string;
    instagramId?: string | null;
    message: string;
    clientQuestion: string;
  }
): Promise<{ id: string }> {
  log.info({ fn: 'createWhatsAppCarouselCreative', pageId: params.pageId, hasInstagramId: !!params.instagramId, cardsCount: params.cards.length }, '[FB Creative] Building WhatsApp carousel creative');
  // Для CTWA карусели используем WhatsApp API link
  const whatsappLink = "https://api.whatsapp.com/send";

  // page_welcome_message с вопросом клиента (autofill в WhatsApp)
  const pageWelcomeMessage = JSON.stringify({
    type: "VISUAL_EDITOR",
    version: 2,
    landing_screen_type: "welcome_message",
    media_type: "text",
    text_format: {
      customer_action_type: "autofill_message",
      message: {
        autofill_message: { content: params.clientQuestion },
        text: "Здравствуйте! Чем можем помочь?"
      }
    }
  });

  // Создаём child_attachments для каждой карточки
  const childAttachments = params.cards.map((card) => ({
    image_hash: card.imageHash,
    name: card.text.substring(0, 50), // Facebook ограничивает name до 50 символов
    description: card.text,
    link: whatsappLink,
    call_to_action: {
      type: "WHATSAPP_MESSAGE",
      value: { app_destination: "WHATSAPP" }
    }
  }));

  log.debug({ adAccountId, cardsCount: params.cards.length }, 'Creating WhatsApp carousel creative');

  // Пробуем сначала с page_welcome_message
  const objectStorySpecWithWelcome: any = {
    page_id: params.pageId,
    link_data: {
      message: params.message,
      link: whatsappLink,
      multi_share_optimized: true,
      child_attachments: childAttachments,
      call_to_action: {
        type: "WHATSAPP_MESSAGE",
        value: { app_destination: "WHATSAPP" }
      },
      page_welcome_message: pageWelcomeMessage
    }
  };
  if (params.instagramId) {
    objectStorySpecWithWelcome.instagram_user_id = params.instagramId;
  }

  try {
    return await graph('POST', `${adAccountId}/adcreatives`, token, {
      name: "Carousel CTWA – WhatsApp",
      object_story_spec: JSON.stringify(objectStorySpecWithWelcome)
    });
  } catch (error: any) {
    // Если ошибка 1815166 (Invalid creative's object story spec) - пробуем без page_welcome_message
    if (error?.fb?.error_subcode === 1815166) {
      log.warn({
        adAccountId,
        error_subcode: 1815166,
        msg: 'page_welcome_message not supported, retrying without it'
      }, 'WhatsApp carousel creative: page_welcome_message не поддерживается для этого аккаунта, создаем без него');

      const objectStorySpecWithoutWelcome: any = {
        page_id: params.pageId,
        link_data: {
          message: params.message,
          link: whatsappLink,
          multi_share_optimized: true,
          child_attachments: childAttachments,
          call_to_action: {
            type: "WHATSAPP_MESSAGE",
            value: { app_destination: "WHATSAPP" }
          }
          // page_welcome_message убран
        }
      };
      if (params.instagramId) {
        objectStorySpecWithoutWelcome.instagram_user_id = params.instagramId;
      }

      return await graph('POST', `${adAccountId}/adcreatives`, token, {
        name: "Carousel CTWA – WhatsApp",
        object_story_spec: JSON.stringify(objectStorySpecWithoutWelcome)
      });
    }

    // Другие ошибки пробрасываем дальше
    throw error;
  }
}

/**
 * Создаёт Instagram Traffic carousel creative
 * Каждая карточка ведёт на профиль Instagram
 */
export async function createInstagramCarouselCreative(
  adAccountId: string,
  token: string,
  params: {
    cards: CarouselCardParams[];
    pageId: string;
    instagramId: string;
    instagramUsername: string;
    message: string;
  }
): Promise<{ id: string }> {
  const landingLink = `https://www.instagram.com/${params.instagramUsername}`;

  const childAttachments = params.cards.map((card) => ({
    image_hash: card.imageHash,
    name: card.text.substring(0, 50),
    description: card.text,
    link: card.link || landingLink,
    call_to_action: {
      type: "LEARN_MORE",
      value: { link: card.link || landingLink }
    }
  }));

  const objectStorySpec = {
    page_id: params.pageId,
    instagram_user_id: params.instagramId,
    link_data: {
      message: params.message,
      link: landingLink,
      multi_share_optimized: true,
      child_attachments: childAttachments,
      call_to_action: {
        type: "LEARN_MORE",
        value: { link: landingLink }
      }
    }
  };

  const payload = {
    name: "Instagram Profile Carousel Creative",
    object_story_spec: JSON.stringify(objectStorySpec)
  };

  log.debug({ adAccountId, cardsCount: params.cards.length }, 'Creating Instagram carousel creative');
  return await graph('POST', `${adAccountId}/adcreatives`, token, payload);
}

/**
 * Создаёт Website Leads carousel creative
 * Каждая карточка ведёт на сайт
 */
export async function createWebsiteLeadsCarouselCreative(
  adAccountId: string,
  token: string,
  params: {
    cards: CarouselCardParams[];
    pageId: string;
    instagramId?: string | null;
    message: string;
    siteUrl: string;
    utm?: string;
  }
): Promise<{ id: string }> {
  log.info({ fn: 'createWebsiteLeadsCarouselCreative', pageId: params.pageId, hasInstagramId: !!params.instagramId, cardsCount: params.cards.length, siteUrl: params.siteUrl }, '[FB Creative] Building Website Leads carousel creative');

  const childAttachments = params.cards.map((card) => ({
    image_hash: card.imageHash,
    name: card.text.substring(0, 50),
    description: card.text,
    link: card.link || params.siteUrl,
    call_to_action: {
      type: "SIGN_UP",
      value: { link: card.link || params.siteUrl }
    }
  }));

  const objectStorySpec: any = {
    page_id: params.pageId,
    link_data: {
      message: params.message,
      link: params.siteUrl,
      multi_share_optimized: true,
      child_attachments: childAttachments,
      call_to_action: {
        type: "SIGN_UP",
        value: { link: params.siteUrl }
      }
    }
  };
  if (params.instagramId) {
    objectStorySpec.instagram_user_id = params.instagramId;
  }

  const payload: any = {
    name: "Website Leads Carousel Creative",
    url_tags: params.utm || "utm_source=facebook&utm_campaign={{campaign.name}}&utm_medium={{ad.id}}",
    object_story_spec: JSON.stringify(objectStorySpec)
  };

  log.debug({ adAccountId, cardsCount: params.cards.length }, 'Creating Website Leads carousel creative');
  return await graph('POST', `${adAccountId}/adcreatives`, token, payload);
}

/**
 * Создаёт App Installs carousel creative
 * Каждая карточка ведёт в App Store / Google Play
 */
export async function createAppInstallsCarouselCreative(
  adAccountId: string,
  token: string,
  params: {
    cards: CarouselCardParams[];
    pageId: string;
    instagramId?: string | null;
    message: string;
    appStoreUrl: string;
  }
): Promise<{ id: string }> {
  log.info({
    fn: 'createAppInstallsCarouselCreative',
    pageId: params.pageId,
    hasInstagramId: !!params.instagramId,
    cardsCount: params.cards.length,
    appStoreUrl: params.appStoreUrl
  }, '[FB Creative] Building App Installs carousel creative');

  const childAttachments = params.cards.map((card) => ({
    image_hash: card.imageHash,
    name: card.text.substring(0, 50),
    description: card.text,
    link: card.link || params.appStoreUrl,
    call_to_action: {
      type: "INSTALL_MOBILE_APP",
      value: { link: card.link || params.appStoreUrl }
    }
  }));

  const objectStorySpec: any = {
    page_id: params.pageId,
    link_data: {
      message: params.message,
      link: params.appStoreUrl,
      multi_share_optimized: true,
      child_attachments: childAttachments,
      call_to_action: {
        type: "INSTALL_MOBILE_APP",
        value: { link: params.appStoreUrl }
      }
    }
  };
  if (params.instagramId) {
    objectStorySpec.instagram_user_id = params.instagramId;
  }

  const payload: any = {
    name: "App Installs Carousel Creative",
    object_story_spec: JSON.stringify(objectStorySpec)
  };

  log.debug({ adAccountId, cardsCount: params.cards.length }, 'Creating App Installs carousel creative');
  return await graph('POST', `${adAccountId}/adcreatives`, token, payload);
}

/**
 * Создаёт Lead Form carousel creative
 * Каждая карточка открывает лид форму
 */
export async function createLeadFormCarouselCreative(
  adAccountId: string,
  token: string,
  params: {
    cards: CarouselCardParams[];
    pageId: string;
    instagramId?: string | null;
    message: string;
    leadFormId: string;
  }
): Promise<{ id: string }> {
  log.info({ fn: 'createLeadFormCarouselCreative', pageId: params.pageId, hasInstagramId: !!params.instagramId, cardsCount: params.cards.length, leadFormId: params.leadFormId }, '[FB Creative] Building Lead Form carousel creative');

  const childAttachments = params.cards.map((card) => ({
    image_hash: card.imageHash,
    name: card.text.substring(0, 50),
    description: card.text,
    call_to_action: {
      type: "LEARN_MORE",
      value: {
        lead_gen_form_id: params.leadFormId
      }
    }
  }));

  const objectStorySpec: any = {
    page_id: params.pageId,
    link_data: {
      message: params.message,
      multi_share_optimized: true,
      child_attachments: childAttachments,
      call_to_action: {
        type: "LEARN_MORE",
        value: {
          lead_gen_form_id: params.leadFormId
        }
      }
    }
  };
  if (params.instagramId) {
    objectStorySpec.instagram_user_id = params.instagramId;
  }

  const payload: any = {
    name: "Lead Form Carousel Creative",
    object_story_spec: JSON.stringify(objectStorySpec)
  };

  log.debug({ adAccountId, cardsCount: params.cards.length, leadFormId: params.leadFormId }, 'Creating Lead Form carousel creative');
  return await graph('POST', `${adAccountId}/adcreatives`, token, payload);
}

export async function createLookalikeAudience(
  adAccountId: string,
  seedAudienceId: string,
  country: string,
  token: string
): Promise<{ id: string }> {
  const normalizedAccountId = adAccountId.startsWith('act_') 
    ? adAccountId.slice(4) 
    : adAccountId;

  const lookalike_spec = {
    country: country.toUpperCase(),
    ratio: 0.03 // 3%
  };

  const params = {
    name: `LAL 3% ${country.toUpperCase()} - ${Date.now()}`,
    origin_audience_id: seedAudienceId,
    lookalike_spec: JSON.stringify(lookalike_spec)
  };

  return await graph('POST', `act_${normalizedAccountId}/customaudiences`, token, params);
}

export const fb = {
  pauseCampaign: (id: string, t: string) => graph('POST', `${id}`, t, { status: 'PAUSED' }),
  resumeCampaign:(id: string, t: string) => graph('POST', `${id}`, t, { status: 'ACTIVE' }),
  pauseAdset:    (id: string, t: string) => graph('POST', `${id}`, t, { status: 'PAUSED' }),
  resumeAdset:   (id: string, t: string) => graph('POST', `${id}`, t, { status: 'ACTIVE' }),
  pauseAd:       (id: string, t: string) => graph('POST', `${id}`, t, { status: 'PAUSED' }),
  resumeAd:      (id: string, t: string) => graph('POST', `${id}`, t, { status: 'ACTIVE' }),
  setAdsetBudgetUsd: (adsetId: string, usd: number, t: string) => {
    const cents = Math.max(0, Math.round(usd * 100));
    return graph('POST', `${adsetId}`, t, { daily_budget: cents });
  },
  // createLookalikeAudience - оставлена в коде выше на будущее, но не экспортируем
};
