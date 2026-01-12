/**
 * TUS Resumable Upload Endpoint
 *
 * Обеспечивает resumable upload для видео с поддержкой продолжения
 * загрузки после обрыва соединения.
 *
 * После завершения upload запускает обработку видео аналогично /process-video.
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { Server } from '@tus/server';
import { FileStore } from '@tus/file-store';
import path from 'path';
import fs from 'fs/promises';
import { supabase } from '../lib/supabase.js';
import { processVideoTranscription, extractVideoThumbnail } from '../lib/transcription.js';
import {
  uploadVideo,
  uploadImage,
  createWhatsAppCreative,
  createInstagramCreative,
  createWebsiteLeadsCreative,
  createLeadFormVideoCreative
} from '../adapters/facebook.js';
import { onCreativeCreated } from '../lib/onboardingHelper.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'tusUpload' });

// Директория для хранения TUS uploads
const TUS_UPLOAD_DIR = '/var/tmp/tus-uploads';

// Создаём директорию если не существует
async function ensureUploadDir() {
  try {
    await fs.mkdir(TUS_UPLOAD_DIR, { recursive: true });
  } catch (err) {
    log.error({ err }, 'Failed to create TUS upload directory');
  }
}

function normalizeAdAccountId(adAccountId: string): string {
  if (!adAccountId) return '';
  const id = String(adAccountId).trim();
  return id.startsWith('act_') ? id : `act_${id}`;
}

/**
 * Обработка завершённого upload - аналогично /process-video
 */
async function processCompletedUpload(uploadId: string, metadata: Record<string, string>) {
  const videoPath = path.join(TUS_UPLOAD_DIR, uploadId);
  const startTime = Date.now();
  let creativeId: string | null = null;

  log.info({ uploadId, metadata }, '[TUS] Starting processing of completed upload');

  try {
    const userId = metadata.user_id;
    const accountId = metadata.account_id;
    const directionId = metadata.direction_id;
    const title = metadata.title || metadata.filename || 'Untitled';
    const language = metadata.language || 'ru';

    // Валидация обязательных полей
    if (!userId) {
      throw new Error('user_id is required in metadata');
    }

    // Проверяем существование и размер файла
    let fileStats;
    try {
      fileStats = await fs.stat(videoPath);
      if (fileStats.size === 0) {
        throw new Error('Uploaded file is empty');
      }
      log.info({
        uploadId,
        fileSizeMB: Math.round(fileStats.size / 1024 / 1024),
        filePath: videoPath
      }, '[TUS] File validated successfully');
    } catch (statError: any) {
      throw new Error(`File not found or inaccessible: ${statError.message}`);
    }

    log.info({ uploadId, userId, accountId, directionId }, '[TUS] Fetching user account data...');

    // Проверяем флаг мультиаккаунтности
    const { data: userAccount, error: userError } = await supabase
      .from('user_accounts')
      .select('id, multi_account_enabled, access_token, ad_account_id, page_id, instagram_id, instagram_username, whatsapp_phone_number')
      .eq('id', userId)
      .single();

    if (userError || !userAccount) {
      throw new Error(`User account not found: ${userError?.message}`);
    }

    let ACCESS_TOKEN: string;
    let fbAdAccountId: string;
    let pageId: string;
    let instagramId: string;
    let instagramUsername: string | null = null;
    let whatsappPhoneNumber: string | null = null;

    if (userAccount.multi_account_enabled) {
      if (!accountId) {
        throw new Error('account_id is required when multi_account_enabled is true');
      }

      const { data: adAccount, error: adError } = await supabase
        .from('ad_accounts')
        .select('id, access_token, ad_account_id, page_id, instagram_id, instagram_username, whatsapp_phone_number')
        .eq('id', accountId)
        .eq('user_account_id', userId)
        .single();

      if (adError || !adAccount) {
        throw new Error(`Ad account not found: ${adError?.message}`);
      }

      if (!adAccount.access_token || !adAccount.ad_account_id || !adAccount.page_id || !adAccount.instagram_id) {
        throw new Error('Ad account incomplete');
      }

      ACCESS_TOKEN = adAccount.access_token;
      fbAdAccountId = adAccount.ad_account_id;
      pageId = adAccount.page_id;
      instagramId = adAccount.instagram_id;
      instagramUsername = adAccount.instagram_username;
      whatsappPhoneNumber = adAccount.whatsapp_phone_number;
      log.info({ uploadId, adAccountId: fbAdAccountId }, '[TUS] Using multi-account credentials');
    } else {
      if (!userAccount.access_token || !userAccount.ad_account_id || !userAccount.page_id || !userAccount.instagram_id) {
        throw new Error('User account incomplete');
      }

      ACCESS_TOKEN = userAccount.access_token;
      fbAdAccountId = userAccount.ad_account_id;
      pageId = userAccount.page_id;
      instagramId = userAccount.instagram_id;
      instagramUsername = userAccount.instagram_username;
      whatsappPhoneNumber = userAccount.whatsapp_phone_number;
      log.info({ uploadId, adAccountId: fbAdAccountId }, '[TUS] Using single account credentials');
    }

    const normalizedAdAccountId = normalizeAdAccountId(fbAdAccountId);

    // Транскрипция
    log.info({ uploadId, language }, '[TUS] Starting transcription...');
    const transcriptionStartTime = Date.now();
    let transcription;
    try {
      transcription = await processVideoTranscription(videoPath, language);
      log.info({
        uploadId,
        durationMs: Date.now() - transcriptionStartTime,
        textLength: transcription.text?.length
      }, '[TUS] Transcription completed');
    } catch (transcriptionError: any) {
      log.warn({
        err: transcriptionError,
        uploadId,
        durationMs: Date.now() - transcriptionStartTime
      }, '[TUS] Transcription failed, continuing without transcript');
      transcription = {
        text: 'Транскрипция недоступна',
        language: language
      };
    }

    // Создаём запись креатива
    log.info({ uploadId, userId, title }, '[TUS] Creating creative record...');
    const { data: creative, error: creativeError } = await supabase
      .from('user_creatives')
      .insert({
        user_id: userId,
        account_id: accountId || null,
        title: title,
        status: 'processing',
        direction_id: directionId || null,
        media_type: 'video',
        tus_upload_id: uploadId // Уникальный ID для отслеживания статуса
      })
      .select()
      .single();

    if (creativeError || !creative) {
      throw new Error(`Failed to create creative record: ${creativeError?.message}`);
    }

    creativeId = creative.id;
    log.info({ uploadId, creativeId: creative.id }, '[TUS] Creative record created, uploading to Facebook...');

    // Upload на Facebook (streaming)
    log.info({ uploadId, adAccountId: normalizedAdAccountId }, '[TUS] Starting Facebook video upload...');
    const fbUploadStartTime = Date.now();
    const fbVideo = await uploadVideo(normalizedAdAccountId, ACCESS_TOKEN, videoPath);

    log.info({
      uploadId,
      videoId: fbVideo.id,
      durationMs: Date.now() - fbUploadStartTime
    }, '[TUS] Video uploaded to Facebook successfully');

    // Ждём обработки Facebook
    log.info({ uploadId }, '[TUS] Waiting for Facebook to process video...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Извлекаем thumbnail
    log.info({ uploadId }, '[TUS] Extracting thumbnail from video...');
    const thumbnailStartTime = Date.now();
    const thumbnailBuffer = await extractVideoThumbnail(videoPath);
    log.info({
      uploadId,
      thumbnailSizeKB: Math.round(thumbnailBuffer.length / 1024),
      durationMs: Date.now() - thumbnailStartTime
    }, '[TUS] Thumbnail extracted');

    log.info({ uploadId }, '[TUS] Uploading thumbnail to Facebook...');
    const thumbnailResult = await uploadImage(normalizedAdAccountId, ACCESS_TOKEN, thumbnailBuffer);
    log.info({ uploadId, thumbnailHash: thumbnailResult.hash }, '[TUS] Thumbnail uploaded to Facebook');

    // Сохраняем thumbnail в Supabase
    let thumbnailUrl: string | null = null;
    try {
      const thumbnailFileName = `video-thumbnails/${userId}/${creative.id}_${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('creo')
        .upload(thumbnailFileName, thumbnailBuffer, {
          contentType: 'image/jpeg',
          upsert: false,
          cacheControl: '3600'
        });

      if (!uploadError) {
        const { data: publicUrlData } = supabase.storage
          .from('creo')
          .getPublicUrl(thumbnailFileName);
        thumbnailUrl = publicUrlData?.publicUrl || null;
      }
    } catch (storageErr) {
      log.warn({ err: storageErr }, 'Failed to save thumbnail to storage');
    }

    // Загружаем настройки направления
    let description = 'Напишите нам, чтобы узнать подробности';
    let clientQuestion = 'Здравствуйте! Хочу узнать об этом подробнее.';
    let siteUrl = null;
    let utm = null;
    let leadFormId: string | null = null;
    let objective: 'whatsapp' | 'instagram_traffic' | 'site_leads' | 'lead_forms' = 'whatsapp';

    if (directionId) {
      const { data: direction } = await supabase
        .from('account_directions')
        .select('objective')
        .eq('id', directionId)
        .maybeSingle();

      if (direction?.objective) {
        objective = direction.objective as typeof objective;
      }

      const { data: defaultSettings } = await supabase
        .from('default_ad_settings')
        .select('*')
        .eq('direction_id', directionId)
        .maybeSingle();

      if (defaultSettings) {
        description = defaultSettings.description || description;
        clientQuestion = defaultSettings.client_question || clientQuestion;
        siteUrl = defaultSettings.site_url;
        utm = defaultSettings.utm_tag;
        leadFormId = defaultSettings.lead_form_id;
      }
    }

    // Создаём креатив в Facebook
    let fbCreativeId = '';

    if (objective === 'whatsapp') {
      const whatsappCreative = await createWhatsAppCreative(normalizedAdAccountId, ACCESS_TOKEN, {
        videoId: fbVideo.id,
        pageId: pageId,
        instagramId: instagramId,
        message: description,
        clientQuestion: clientQuestion,
        whatsappPhoneNumber: whatsappPhoneNumber || undefined,
        thumbnailHash: thumbnailResult.hash
      });
      fbCreativeId = whatsappCreative.id;
    } else if (objective === 'instagram_traffic') {
      const instagramCreative = await createInstagramCreative(normalizedAdAccountId, ACCESS_TOKEN, {
        videoId: fbVideo.id,
        pageId: pageId,
        instagramId: instagramId,
        instagramUsername: instagramUsername || '',
        message: description,
        thumbnailHash: thumbnailResult.hash
      });
      fbCreativeId = instagramCreative.id;
    } else if (objective === 'site_leads') {
      if (!siteUrl) {
        throw new Error('site_url is required for site_leads objective');
      }
      const websiteCreative = await createWebsiteLeadsCreative(normalizedAdAccountId, ACCESS_TOKEN, {
        videoId: fbVideo.id,
        pageId: pageId,
        instagramId: instagramId,
        message: description,
        siteUrl: siteUrl,
        utm: utm,
        thumbnailHash: thumbnailResult.hash
      });
      fbCreativeId = websiteCreative.id;
    } else if (objective === 'lead_forms') {
      if (!leadFormId) {
        throw new Error('lead_form_id is required for lead_forms objective');
      }
      const leadFormCreative = await createLeadFormVideoCreative(normalizedAdAccountId, ACCESS_TOKEN, {
        videoId: fbVideo.id,
        pageId: pageId,
        instagramId: instagramId,
        message: description,
        leadFormId: leadFormId,
        thumbnailHash: thumbnailResult.hash
      });
      fbCreativeId = leadFormCreative.id;
    }

    // Сохраняем транскрипцию
    await supabase
      .from('creative_transcripts')
      .insert({
        creative_id: creative.id,
        lang: language,
        source: 'whisper',
        text: transcription.text,
        duration_sec: transcription.duration ? Math.round(transcription.duration) : null,
        status: 'ready'
      });

    // Обновляем креатив
    const updateData: Record<string, string | null> = {
      fb_video_id: fbVideo.id,
      status: 'ready',
      fb_creative_id: fbCreativeId
    };
    if (thumbnailUrl) updateData.thumbnail_url = thumbnailUrl;
    // Сохраняем fb_creative_id в соответствующее поле по типу objective
    if (objective === 'whatsapp') updateData.fb_creative_id_whatsapp = fbCreativeId;
    else if (objective === 'instagram_traffic') updateData.fb_creative_id_instagram_traffic = fbCreativeId;
    else if (objective === 'site_leads') updateData.fb_creative_id_site_leads = fbCreativeId;
    else if (objective === 'lead_forms') updateData.fb_creative_id_lead_forms = fbCreativeId;

    await supabase
      .from('user_creatives')
      .update(updateData)
      .eq('id', creative.id);

    // Обновляем онбординг
    onCreativeCreated(userId).catch(err => {
      log.warn({ err, userId }, '[TUS] Failed to update onboarding stage');
    });

    const totalDurationMs = Date.now() - startTime;
    log.info({
      uploadId,
      creativeId: creative.id,
      fbVideoId: fbVideo.id,
      fbCreativeId,
      objective,
      totalDurationMs,
      totalDurationSec: Math.round(totalDurationMs / 1000)
    }, '[TUS] ✅ Upload processing completed successfully');

    return {
      success: true,
      creative_id: creative.id,
      fb_video_id: fbVideo.id,
      fb_creative_id: fbCreativeId
    };

  } catch (error: any) {
    const totalDurationMs = Date.now() - startTime;
    log.error({
      err: error,
      uploadId,
      creativeId,
      totalDurationMs,
      errorMessage: error.message
    }, '[TUS] ❌ Upload processing failed');

    // Обновляем статус креатива на 'error' если он был создан
    if (creativeId) {
      try {
        await supabase
          .from('user_creatives')
          .update({
            status: 'error',
            error_text: error.message || 'Unknown error during processing'
          })
          .eq('id', creativeId);
        log.info({ creativeId }, '[TUS] Creative status updated to error');
      } catch (updateErr) {
        log.warn({ err: updateErr, creativeId }, '[TUS] Failed to update creative status to error');
      }
    }

    logErrorToAdmin({
      user_account_id: metadata.user_id,
      error_type: 'api',
      raw_error: error.message || String(error),
      stack_trace: error.stack,
      action: 'tus_upload_processing',
      endpoint: '/tus',
      request_data: { uploadId, metadata, creativeId },
      severity: 'warning'
    }).catch(() => {});

    throw error;
  } finally {
    // Удаляем временный файл
    try {
      await fs.unlink(videoPath);
      // Также удаляем .json файл метаданных TUS
      await fs.unlink(`${videoPath}.json`).catch(() => {});
      log.info({ videoPath }, 'Temporary TUS file deleted');
    } catch (err) {
      log.warn({ err, videoPath }, 'Failed to delete temporary TUS file');
    }
  }
}

// Создаём TUS server
const tusServer = new Server({
  path: '/tus',
  datastore: new FileStore({ directory: TUS_UPLOAD_DIR }),
  maxSize: 512 * 1024 * 1024, // 512 MB
  // Учитываем X-Forwarded-* headers от nginx для правильного формирования URL
  respectForwardedHeaders: true,
  // Кастомная генерация URL для учёта /api prefix на проде
  generateUrl: (req, { proto, host, path, id }) => {
    // В production nginx убирает /api из пути, но клиент ожидает /api/tus
    // Проверяем, приходит ли запрос через proxy (есть X-Forwarded-Proto)
    // ВАЖНО: req.headers это объект, а не Web API Headers, поэтому используем [] доступ
    const headers = req.headers as unknown as Record<string, string | string[] | undefined>;

    // Заголовки могут быть строкой или массивом - берём первое значение
    const getHeader = (name: string): string | undefined => {
      const val = headers[name];
      if (Array.isArray(val)) return val[0];
      return val;
    };

    const forwardedProto = getHeader('x-forwarded-proto');
    const forwardedHost = getHeader('x-forwarded-host') || getHeader('host');

    log.info({
      forwardedProto,
      forwardedHost,
      proto,
      host,
      path,
      id,
      allHeaders: Object.keys(headers).filter(k => k.toLowerCase().includes('forward') || k.toLowerCase() === 'host')
    }, '[TUS] generateUrl - generating Location URL');

    if (forwardedProto && forwardedHost) {
      // Production: формируем URL с /api prefix
      const url = `${forwardedProto}://${forwardedHost}/api/tus/${id}`;
      log.info({ url, mode: 'production' }, '[TUS] Generated URL for client');
      return url;
    }

    // Local development: используем стандартный URL
    const url = `${proto}://${host}${path}/${id}`;
    log.info({ url, mode: 'local' }, '[TUS] Generated URL for client');
    return url;
  },
  onUploadFinish: async (_req, upload) => {
    log.info({ uploadId: upload.id, size: upload.size }, 'TUS upload finished, starting processing');

    // Запускаем обработку асинхронно
    processCompletedUpload(upload.id, upload.metadata as Record<string, string>)
      .catch(err => {
        log.error({ err, uploadId: upload.id }, 'Failed to process completed upload');
      });

    return {};
  }
});

export const tusUploadRoutes: FastifyPluginAsync = async (app) => {
  // Создаём директорию при старте
  await ensureUploadDir();

  // Добавляем content type parser для TUS
  // TUS использует application/offset+octet-stream для PATCH запросов
  // Нужно пропустить парсинг тела и передать raw stream в TUS handler
  app.addContentTypeParser('application/offset+octet-stream', (_request, _payload, done) => {
    done(null);
  });

  // Endpoint для проверки статуса обработки после TUS upload
  // Фронтенд делает polling этого endpoint после успешного TUS upload
  app.get('/tus/processing-status', async (request: FastifyRequest<{
    Querystring: { user_id: string; title?: string; account_id?: string; upload_id?: string }
  }>, reply: FastifyReply) => {
    const { user_id, title, account_id, upload_id } = request.query;

    if (!user_id) {
      return reply.status(400).send({ error: 'user_id is required' });
    }

    // Если передан upload_id - ищем точно по нему (самый надёжный способ)
    if (upload_id) {
      const { data: creative, error } = await supabase
        .from('user_creatives')
        .select('id, status, error_text, fb_video_id, created_at')
        .eq('user_id', user_id)
        .eq('tus_upload_id', upload_id)
        .maybeSingle();

      if (error) {
        log.error({ err: error, user_id, upload_id }, '[TUS] Failed to get processing status by upload_id');
        return reply.status(500).send({ error: 'Failed to get status' });
      }

      if (!creative) {
        // Креатив ещё не создан - обработка продолжается
        return reply.send({ status: 'processing', message: 'Creative not yet created' });
      }

      if (creative.status === 'processing') {
        return reply.send({ status: 'processing', creative_id: creative.id });
      }

      if (creative.status === 'error') {
        return reply.send({
          status: 'error',
          creative_id: creative.id,
          error: creative.error_text || 'Unknown error'
        });
      }

      return reply.send({
        status: 'success',
        creative_id: creative.id,
        fb_video_id: creative.fb_video_id
      });
    }

    // Fallback: поиск по title (для обратной совместимости)
    if (!title) {
      return reply.status(400).send({ error: 'title or upload_id is required' });
    }

    // Ищем последний креатив с этим title, созданный в последние 5 минут
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    let query = supabase
      .from('user_creatives')
      .select('id, status, error_text, fb_video_id, created_at')
      .eq('user_id', user_id)
      .eq('title', title)
      .gte('created_at', fiveMinutesAgo)
      .order('created_at', { ascending: false })
      .limit(1);

    if (account_id) {
      query = query.eq('account_id', account_id);
    }

    const { data: creatives, error } = await query;

    if (error) {
      log.error({ err: error, user_id, title }, '[TUS] Failed to get processing status');
      return reply.status(500).send({ error: 'Failed to get status' });
    }

    if (!creatives || creatives.length === 0) {
      // Креатив ещё не создан - обработка продолжается
      return reply.send({ status: 'processing', message: 'Creative not yet created' });
    }

    const creative = creatives[0];

    if (creative.status === 'processing') {
      return reply.send({ status: 'processing', creative_id: creative.id });
    }

    if (creative.status === 'error') {
      return reply.send({
        status: 'error',
        creative_id: creative.id,
        error: creative.error_text || 'Unknown error'
      });
    }

    // ready, partial_ready, uploaded - все считаются успехом
    return reply.send({
      status: 'success',
      creative_id: creative.id,
      fb_video_id: creative.fb_video_id
    });
  });

  // Регистрируем TUS endpoints
  // TUS использует несколько HTTP методов на одном пути
  app.all('/tus', async (request: FastifyRequest, reply: FastifyReply) => {
    return handleTusRequest(request, reply);
  });

  app.all('/tus/*', async (request: FastifyRequest, reply: FastifyReply) => {
    return handleTusRequest(request, reply);
  });
};

async function handleTusRequest(request: FastifyRequest, reply: FastifyReply) {
  // Преобразуем Fastify request/reply в Node.js req/res для TUS
  const req = request.raw;
  const res = reply.raw;

  // Логируем входящий запрос (кроме OPTIONS)
  if (request.method !== 'OPTIONS') {
    // Для POST (создание upload) логируем metadata
    if (request.method === 'POST') {
      const metadata = request.headers['upload-metadata'];
      log.info({
        method: request.method,
        url: request.url,
        uploadLength: request.headers['upload-length'],
        metadata: metadata ? String(metadata).substring(0, 500) : null,
        forwardedProto: request.headers['x-forwarded-proto'],
        forwardedHost: request.headers['x-forwarded-host'],
        host: request.headers['host'],
        origin: request.headers['origin']
      }, '[TUS] POST - Creating new upload');
    } else if (request.method === 'PATCH') {
      // Для PATCH логируем прогресс
      log.info({
        method: request.method,
        url: request.url,
        uploadOffset: request.headers['upload-offset'],
        contentLength: request.headers['content-length']
      }, '[TUS] PATCH - Uploading chunk');
    } else {
      // HEAD, GET, DELETE
      log.info({
        method: request.method,
        url: request.url
      }, '[TUS] Request');
    }
  }

  // Устанавливаем необходимые заголовки для TUS
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, HEAD, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Upload-Length, Upload-Offset, Tus-Resumable, Upload-Metadata, Upload-Defer-Length, Upload-Concat, Location');
  res.setHeader('Access-Control-Expose-Headers', 'Upload-Offset, Location, Upload-Length, Tus-Version, Tus-Resumable, Tus-Max-Size, Tus-Extension, Upload-Metadata, Upload-Defer-Length, Upload-Concat');

  // Обрабатываем OPTIONS preflight
  if (request.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Передаём запрос TUS серверу с обработкой ошибок
  try {
    await tusServer.handle(req, res);

    // Логируем успешный ответ для POST (Location header)
    if (request.method === 'POST' && res.statusCode === 201) {
      const location = res.getHeader('Location');
      log.info({
        statusCode: res.statusCode,
        location
      }, '[TUS] POST successful - upload created');
    }
  } catch (err: any) {
    log.error({
      err,
      method: request.method,
      url: request.url,
      statusCode: res.statusCode
    }, '[TUS] Error handling request');
    throw err;
  }
}

export default tusUploadRoutes;
