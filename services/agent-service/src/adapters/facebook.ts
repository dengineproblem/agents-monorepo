import crypto from 'node:crypto';
import FormData from 'form-data';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import axios from 'axios';

const FB_API_VERSION = process.env.FB_API_VERSION || 'v20.0';
const FB_APP_SECRET = process.env.FB_APP_SECRET || '';
const FB_VALIDATE_ONLY = String(process.env.FB_VALIDATE_ONLY || 'false').toLowerCase() === 'true';

function appsecret_proof(token: string) {
  return crypto.createHmac('sha256', FB_APP_SECRET).update(token).digest('hex');
}

export async function graph(method: 'GET'|'POST'|'DELETE', path: string, token: string, params: Record<string, any> = {}) {
  const usp = new URLSearchParams();
  usp.set('access_token', token);
  if (FB_APP_SECRET) usp.set('appsecret_proof', appsecret_proof(token));
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) usp.set(k, String(v));
  if (FB_VALIDATE_ONLY && (method === 'POST' || method === 'DELETE')) {
    usp.set('execution_options', '["validate_only"]');
  }

  const url = method === 'GET'
    ? `https://graph.facebook.com/${FB_API_VERSION}/${path}?${usp.toString()}`
    : `https://graph.facebook.com/${FB_API_VERSION}/${path}`;

  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : usp.toString(),
  });

  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const g = json?.error || {};
    const err: any = new Error(g?.message || text || `HTTP ${res.status}`);
    err.fb = {
      status: res.status,
      method, path,
      params: params,
      type: g?.type, code: g?.code, error_subcode: g?.error_subcode, fbtrace_id: g?.fbtrace_id
    };
    throw err;
  }
  return json;
}

/**
 * Загрузка видео в Facebook Ad Account с поддержкой больших файлов (>100 МБ)
 * Использует chunked upload через graph-video.facebook.com
 */
export async function uploadVideo(adAccountId: string, token: string, videoBuffer: Buffer): Promise<{ id: string }> {
  const tmpPath = path.join('/var/tmp', `fb_video_${randomUUID()}.mp4`);
  const fileSize = videoBuffer.length;
  const fileSizeMB = Math.round(fileSize / 1024 / 1024);
  
  console.log(`[uploadVideo] Writing ${fileSizeMB}MB to ${tmpPath}`);
  fs.writeFileSync(tmpPath, videoBuffer);
  
  try {
    // Для файлов >50 МБ используем chunked upload через graph-video
    if (fileSize > 50 * 1024 * 1024) {
      console.log(`[uploadVideo] File size ${fileSizeMB}MB > 50MB, using chunked upload`);
      const videoId = await uploadVideoChunked(adAccountId, token, tmpPath, fileSize);
      fs.unlinkSync(tmpPath);
      return { id: videoId };
    }
    
    // Для маленьких файлов используем простой upload
    console.log(`[uploadVideo] Using simple upload for ${fileSizeMB}MB file`);
    const formData = new FormData();
    formData.append('source', fs.createReadStream(tmpPath));

    const url = `https://graph-video.facebook.com/${FB_API_VERSION}/${adAccountId}/advideos?access_token=${token}`;
    
    const response = await axios.post(url, formData, {
      headers: formData.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });
    
    console.log(`[uploadVideo] Upload successful, video ID: ${response.data.id}`);
    fs.unlinkSync(tmpPath);
    
    return response.data;
  } catch (error: any) {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
    
    console.error('[uploadVideo] Facebook API Error:', {
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
      path: `${adAccountId}/advideos`,
      type: g?.type,
      code: g?.code,
      error_subcode: g?.error_subcode,
      fbtrace_id: g?.fbtrace_id
    };
    throw err;
  }
}

/**
 * Chunked upload для больших видео
 * Протокол: start → transfer (loop) → finish
 */
async function uploadVideoChunked(adAccountId: string, token: string, filePath: string, fileSize: number): Promise<string> {
  const base = `https://graph-video.facebook.com/${FB_API_VERSION}`;
  const url = `${base}/${adAccountId}/advideos`;
  
  console.log(`[uploadVideoChunked] Starting chunked upload for ${Math.round(fileSize / 1024 / 1024)}MB file`);
  
  // 1) START phase
  const startFormData = new FormData();
  startFormData.append('access_token', token);
  startFormData.append('upload_phase', 'start');
  startFormData.append('file_size', String(fileSize));
  
  const startRes = await axios.post(url, startFormData, {
    headers: startFormData.getHeaders()
  });
  
  let { upload_session_id, start_offset, end_offset, video_id } = startRes.data;
  console.log(`[uploadVideoChunked] Session started: ${upload_session_id}, initial range: ${start_offset}-${end_offset}`);
  
  // 2) TRANSFER phase (loop)
  let chunkNumber = 0;
  while (start_offset !== end_offset) {
    chunkNumber++;
    const start = parseInt(start_offset, 10);
    const end = parseInt(end_offset, 10);
    const chunkSize = end - start;
    
    console.log(`[uploadVideoChunked] Uploading chunk #${chunkNumber}: ${start}-${end} (${Math.round(chunkSize / 1024 / 1024)}MB)`);
    
    // Читаем chunk из файла
    const chunk = fs.createReadStream(filePath, { 
      start, 
      end: end - 1  // end - 1 потому что end_offset не включается
    });
    
    const transferFormData = new FormData();
    transferFormData.append('access_token', token);
    transferFormData.append('upload_phase', 'transfer');
    transferFormData.append('upload_session_id', upload_session_id);
    transferFormData.append('start_offset', String(start));
    transferFormData.append('video_file_chunk', chunk, {
      filename: path.basename(filePath),
      contentType: 'application/octet-stream',
      knownLength: chunkSize
    });
    
    const transferRes = await axios.post(url, transferFormData, {
      headers: transferFormData.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    // Сервер возвращает следующий диапазон
    start_offset = transferRes.data.start_offset;
    end_offset = transferRes.data.end_offset;
    
    const progress = Math.round((start / fileSize) * 100);
    console.log(`[uploadVideoChunked] Chunk #${chunkNumber} uploaded, progress: ${progress}%`);
  }
  
  console.log(`[uploadVideoChunked] All chunks uploaded, finishing...`);
  
  // 3) FINISH phase
  const finishFormData = new FormData();
  finishFormData.append('access_token', token);
  finishFormData.append('upload_phase', 'finish');
  finishFormData.append('upload_session_id', upload_session_id);
  
  const finishRes = await axios.post(url, finishFormData, {
    headers: finishFormData.getHeaders()
  });
  
  const finalVideoId = finishRes.data.video_id || video_id;
  console.log(`[uploadVideoChunked] Upload completed, video ID: ${finalVideoId}`);
  
  return finalVideoId;
}

export async function createWhatsAppCreative(
  adAccountId: string,
  token: string,
  params: {
    videoId: string;
    pageId: string;
    instagramId: string;
    message: string;
    clientQuestion: string;
    whatsappPhoneNumber?: string;
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

  console.log("[WhatsApp Creative] callToAction:", JSON.stringify(callToAction));
  const objectStorySpec = {
    page_id: params.pageId,
    instagram_user_id: params.instagramId,
    video_data: {
      video_id: params.videoId,
      image_url: "https://dummyimage.com/1200x628/ffffff/ffffff.png",
      message: params.message,
      call_to_action: callToAction,
      page_welcome_message: pageWelcomeMessage
    }
  };

  return await graph('POST', `${adAccountId}/adcreatives`, token, {
    name: "Video CTWA – WhatsApp",
    object_story_spec: JSON.stringify(objectStorySpec)
  });
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
  }
): Promise<{ id: string }> {
  const objectStorySpec = {
    page_id: params.pageId,
    instagram_user_id: params.instagramId,
    video_data: {
      video_id: params.videoId,
      image_url: "https://dummyimage.com/1200x628/ffffff/ffffff.png",
      message: params.message,
      call_to_action: {
        type: "LEARN_MORE",
        value: {
          link: `https://www.instagram.com/${params.instagramUsername}`
        }
      }
    }
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
    instagramId: string;
    message: string;
    siteUrl: string;
    utm?: string;
  }
): Promise<{ id: string }> {
  const objectStorySpec = {
    page_id: params.pageId,
    instagram_user_id: params.instagramId,
    video_data: {
      video_id: params.videoId,
      image_url: "https://dummyimage.com/1200x628/ffffff/ffffff.png",
      message: params.message,
      call_to_action: {
        type: "SIGN_UP",
        value: { link: params.siteUrl }
      }
    }
  };

  const payload: any = {
    name: "Website Leads Creative",
    object_story_spec: JSON.stringify(objectStorySpec)
  };

  if (params.utm) {
    payload.url_tags = params.utm;
  }

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
export async function uploadImage(adAccountId: string, token: string, imageBuffer: Buffer): Promise<{ hash: string }> {
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
    const hash = firstKey ? images[firstKey]?.hash : undefined;
    if (!hash) throw new Error('No image hash returned from Facebook API');
    console.log('[uploadImage] Upload successful (multipart filename), hash:', hash);
    return { hash };
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
    throw err;
  } finally {
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }
}

/**
 * Создает WhatsApp креатив с изображением
 */
export async function createWhatsAppImageCreative(
  adAccountId: string,
  token: string,
  params: {
    imageHash: string;
    pageId: string;
    instagramId: string;
    message: string;
    clientQuestion: string;
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

  console.log("[WhatsApp Image Creative] callToAction:", JSON.stringify(callToAction));
  
  const objectStorySpec = {
    page_id: params.pageId,
    instagram_user_id: params.instagramId,
    link_data: {
      image_hash: params.imageHash,
      link: "https://dummyimage.com/1200x628/ffffff/ffffff.png", // Заглушка для валидации
      message: params.message,
      call_to_action: callToAction,
      page_welcome_message: pageWelcomeMessage
    }
  };

  return await graph('POST', `${adAccountId}/adcreatives`, token, {
    name: "Image CTWA – WhatsApp",
    object_story_spec: JSON.stringify(objectStorySpec)
  });
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
    instagramId: string;
    message: string;
    siteUrl: string;
    utm?: string;
  }
): Promise<{ id: string }> {
  const objectStorySpec = {
    page_id: params.pageId,
    instagram_user_id: params.instagramId,
    link_data: {
      image_hash: params.imageHash,
      message: params.message,
      call_to_action: {
        type: "SIGN_UP",
        value: { link: params.siteUrl }
      }
    }
  };

  const payload: any = {
    name: "Website Leads Image Creative",
    object_story_spec: JSON.stringify(objectStorySpec)
  };

  if (params.utm) {
    payload.url_tags = params.utm;
  }

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
