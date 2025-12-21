import { FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import { createWriteStream, promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import path from 'path';
import { z } from 'zod';
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

const ProcessVideoSchema = z.object({
  user_id: z.string().uuid(),
  account_id: z.string().uuid().optional(), // UUID FK из ad_accounts.id (для мультиаккаунтности)
  title: z.string().optional(),
  description: z.string().optional(),
  language: z.string().default('ru'),
  client_question: z.string().optional(),
  site_url: z.string().url().optional(),
  utm: z.string().optional(),
  direction_id: z.string().uuid().optional() // Направление бизнеса (опционально для legacy)
});

type ProcessVideoBody = z.infer<typeof ProcessVideoSchema>;

function normalizeAdAccountId(adAccountId: string): string {
  if (!adAccountId) return '';
  const id = String(adAccountId).trim();
  return id.startsWith('act_') ? id : `act_${id}`;
}

export const videoRoutes: FastifyPluginAsync = async (app) => {
  await app.register(multipart, {
    limits: {
      fileSize: 500 * 1024 * 1024,
    }
  });

  app.post('/process-video', async (request, reply) => {
    let videoPath: string | null = null;

    try {
      const parts = request.parts();
      
      let bodyData: Partial<ProcessVideoBody> = {};

      // ИСПРАВЛЕНИЕ: Пишем файл на диск потоком, НЕ загружая в память!
      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'file') {
          // Используем /var/tmp вместо /tmp (обычно это реальный диск, а не tmpfs)
          videoPath = path.join('/var/tmp', `video_${randomUUID()}.mp4`);
          
          app.log.info(`Streaming video to disk: ${videoPath}`);
          
          // Потоковая запись на диск (без загрузки в память!)
          await pipeline(part.file, createWriteStream(videoPath));
          
          app.log.info(`Video saved to disk: ${videoPath}`);
        } else if (part.type === 'field') {
          (bodyData as any)[part.fieldname] = part.value;
        }
      }

      if (!videoPath) {
        return reply.status(400).send({
          success: false,
          error: 'Video file is required'
        });
      }

      const body = ProcessVideoSchema.parse(bodyData);

      app.log.info(`Processing video for user_id: ${body.user_id}, account_id: ${body.account_id || 'null'}, direction_id: ${body.direction_id || 'null'}`);

      // Проверяем флаг мультиаккаунтности
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('id, multi_account_enabled, access_token, ad_account_id, page_id, instagram_id, instagram_username, whatsapp_phone_number')
        .eq('id', body.user_id)
        .single();

      if (userError || !userAccount) {
        return reply.status(404).send({
          success: false,
          error: 'User account not found',
          details: userError?.message
        });
      }

      let ACCESS_TOKEN: string;
      let fbAdAccountId: string;
      let pageId: string;
      let instagramId: string;
      let instagramUsername: string | null = null;
      let whatsappPhoneNumber: string | null = null;

      if (userAccount.multi_account_enabled) {
        // Мультиаккаунт включён — требуем account_id
        if (!body.account_id) {
          return reply.status(400).send({
            success: false,
            error: 'account_id is required when multi_account_enabled is true'
          });
        }

        app.log.info(`Multi-account mode: fetching ad_account ${body.account_id}`);

        const { data: adAccount, error: adError } = await supabase
          .from('ad_accounts')
          .select('id, access_token, ad_account_id, page_id, instagram_id, instagram_username')
          .eq('id', body.account_id)
          .eq('user_account_id', body.user_id)
          .single();

        if (adError || !adAccount) {
          return reply.status(404).send({
            success: false,
            error: 'Ad account not found',
            details: adError?.message
          });
        }

        if (!adAccount.access_token || !adAccount.ad_account_id || !adAccount.page_id || !adAccount.instagram_id) {
          return reply.status(400).send({
            success: false,
            error: 'Ad account incomplete',
            message: 'Missing required fields: access_token, ad_account_id, page_id, or instagram_id'
          });
        }

        ACCESS_TOKEN = adAccount.access_token;
        fbAdAccountId = adAccount.ad_account_id;
        pageId = adAccount.page_id;
        instagramId = adAccount.instagram_id;
        instagramUsername = adAccount.instagram_username;
      } else {
        // Мультиаккаунт выключен — используем user_accounts
        app.log.info('Single-account mode: using user_accounts credentials');

        if (!userAccount.access_token || !userAccount.ad_account_id || !userAccount.page_id || !userAccount.instagram_id) {
          return reply.status(400).send({
            success: false,
            error: 'User account incomplete',
            message: 'Missing required fields: access_token, ad_account_id, page_id, or instagram_id'
          });
        }

        ACCESS_TOKEN = userAccount.access_token;
        fbAdAccountId = userAccount.ad_account_id;
        pageId = userAccount.page_id;
        instagramId = userAccount.instagram_id;
        instagramUsername = userAccount.instagram_username;
        whatsappPhoneNumber = userAccount.whatsapp_phone_number;
      }

      const normalizedAdAccountId = normalizeAdAccountId(fbAdAccountId);

      app.log.info({
        user_id: body.user_id,
        account_id: body.account_id,
        fb_ad_account_id: fbAdAccountId,
        normalized_ad_account_id: normalizedAdAccountId,
        has_instagram: !!instagramId,
        token_preview: ACCESS_TOKEN.substring(0, 30)
      });

      app.log.info('Starting transcription...');

      let transcription;
      try {
        transcription = await processVideoTranscription(videoPath, body.language);
        app.log.info('Transcription completed successfully');
      } catch (transcriptionError: any) {
        app.log.warn(`Transcription failed: ${transcriptionError.message}, continuing without transcript`);
        transcription = {
          text: 'Транскрипция недоступна',
          language: body.language
        };
      }

      app.log.info('Creating creative record...');

      const { data: creative, error: creativeError } = await supabase
        .from('user_creatives')
        .insert({
          user_id: body.user_id,
          account_id: body.account_id || null, // UUID FK для мультиаккаунтности
          title: body.title || 'Untitled Creative',
          status: 'processing',
          direction_id: body.direction_id || null // Сохраняем direction_id (null для legacy)
        })
        .select()
        .single();

      if (creativeError || !creative) {
        throw new Error(`Failed to create creative record: ${creativeError?.message}`);
      }

      app.log.info(`Creative record created: ${creative.id}, reading video file for upload...`);

      // Читаем файл с диска в буфер ТОЛЬКО для загрузки в Facebook
      // (Facebook API требует buffer/stream, но это уже после сохранения на диск)
      const videoBuffer = await fs.readFile(videoPath);

      app.log.info(`Video file read (${Math.round(videoBuffer.length / 1024 / 1024)}MB), uploading to Facebook...`);

      const fbVideo = await uploadVideo(normalizedAdAccountId, ACCESS_TOKEN, videoBuffer);

      app.log.info(`Video uploaded to Facebook: ${fbVideo.id}, waiting for processing...`);

      // Ждем 3 секунды, чтобы Facebook обработал видео
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Извлекаем первый кадр видео для обложки
      app.log.info('Extracting thumbnail from first frame...');
      const thumbnailBuffer = await extractVideoThumbnail(videoPath);

      app.log.info('Uploading thumbnail to Facebook...');
      const thumbnailResult = await uploadImage(normalizedAdAccountId, ACCESS_TOKEN, thumbnailBuffer);
      
      app.log.info(`Thumbnail uploaded with hash: ${thumbnailResult.hash}, loading direction settings...`);

      // ===================================================
      // СОХРАНЯЕМ THUMBNAIL В SUPABASE STORAGE
      // ===================================================
      let thumbnailUrl: string | null = null;
      try {
        const thumbnailFileName = `video-thumbnails/${body.user_id}/${creative.id}_${Date.now()}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from('creo')
          .upload(thumbnailFileName, thumbnailBuffer, {
            contentType: 'image/jpeg',
            upsert: false,
            cacheControl: '3600'
          });

        if (uploadError) {
          app.log.warn(`Failed to upload thumbnail to Supabase Storage: ${uploadError.message}`);
        } else {
          const { data: publicUrlData } = supabase.storage
            .from('creo')
            .getPublicUrl(thumbnailFileName);

          if (publicUrlData?.publicUrl) {
            thumbnailUrl = publicUrlData.publicUrl;
            app.log.info(`Thumbnail saved to Supabase Storage: ${thumbnailUrl}`);
          }
        }
      } catch (storageErr: any) {
        app.log.warn(`Failed to save thumbnail to storage: ${storageErr.message}`);
        // Не прерываем - это не критично
      }

      // ===================================================
      // ЗАГРУЗКА НАСТРОЕК И OBJECTIVE ИЗ НАПРАВЛЕНИЯ
      // ===================================================
      let description = 'Напишите нам, чтобы узнать подробности';
      let clientQuestion = 'Здравствуйте! Хочу узнать об этом подробнее.';
      let siteUrl = null;
      let utm = null;
      let leadFormId: string | null = null;
      let objective: 'whatsapp' | 'instagram_traffic' | 'site_leads' | 'lead_forms' = 'whatsapp'; // default

      if (body.direction_id) {
        // Загружаем direction для получения objective
        const { data: direction } = await supabase
          .from('account_directions')
          .select('objective')
          .eq('id', body.direction_id)
          .maybeSingle();

        if (direction?.objective) {
          objective = direction.objective as 'whatsapp' | 'instagram_traffic' | 'site_leads' | 'lead_forms';
          app.log.info({ direction_id: body.direction_id, objective }, 'Loaded objective from direction');
        }

        // Загружаем настройки из default_ad_settings
        const { data: defaultSettings } = await supabase
          .from('default_ad_settings')
          .select('*')
          .eq('direction_id', body.direction_id)
          .maybeSingle();

        if (defaultSettings) {
          description = defaultSettings.description || description;
          clientQuestion = defaultSettings.client_question || clientQuestion;
          siteUrl = defaultSettings.site_url;
          utm = defaultSettings.utm_tag;
          leadFormId = defaultSettings.lead_form_id;

          app.log.info({
            direction_id: body.direction_id,
            objective,
            description,
            clientQuestion,
            siteUrl,
            utm
          }, 'Using settings from direction for video creative');
        } else {
          app.log.warn({
            direction_id: body.direction_id
          }, 'No default settings found for direction, using fallback');
        }
      } else {
        app.log.warn('No direction_id provided for video, using fallback settings');
      }

      // ===================================================
      // СОЗДАЁМ ОДИН КРЕАТИВ В СООТВЕТСТВИИ С OBJECTIVE
      // ===================================================
      app.log.info(`Creating video creative with objective: ${objective}...`);

      let fbCreativeId = '';

      try {
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
            app.log.error('site_leads objective requires site_url in direction settings');
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
            app.log.error('lead_forms objective requires lead_form_id in direction settings');
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

        app.log.info(`Creative created with ID: ${fbCreativeId}, saving transcription...`);

        const { error: transcriptError } = await supabase
          .from('creative_transcripts')
          .insert({
            creative_id: creative.id,
            lang: body.language,
            source: 'whisper',
            text: transcription.text,
            duration_sec: transcription.duration ? Math.round(transcription.duration) : null,
            status: 'ready'
          });

        if (transcriptError) {
          app.log.error(`Failed to save transcription: ${transcriptError.message}`);
        }

        // Обновляем запись креатива - новый стандарт: один креатив = один objective
        const updateData: any = {
          fb_video_id: fbVideo.id,
          status: 'ready',
          fb_creative_id: fbCreativeId,
          // Thumbnail URL для превью видео
          ...(thumbnailUrl && { thumbnail_url: thumbnailUrl }),
          // Старые поля для обратной совместимости (deprecated)
          ...(objective === 'whatsapp' && { fb_creative_id_whatsapp: fbCreativeId }),
          ...(objective === 'instagram_traffic' && { fb_creative_id_instagram_traffic: fbCreativeId }),
          ...(objective === 'site_leads' && { fb_creative_id_site_leads: fbCreativeId }),
          ...(objective === 'lead_forms' && { fb_creative_id_lead_forms: fbCreativeId })
        };

        const { error: updateError } = await supabase
          .from('user_creatives')
          .update(updateData)
          .eq('id', creative.id);

        if (updateError) {
          throw new Error(`Failed to update creative record: ${updateError.message}`);
        }

        app.log.info('Video processing completed successfully');
      } catch (creativesError: any) {
        // При ошибке создания креативов помечаем креатив как failed
        app.log.error(`Failed to create creatives: ${creativesError.message}`);

        logErrorToAdmin({
          user_account_id: body.user_id,
          error_type: 'api',
          raw_error: creativesError.message || String(creativesError),
          stack_trace: creativesError.stack,
          action: 'create_video_creatives',
          endpoint: '/process-video',
          request_data: { direction_id: body.direction_id, objective, creative_id: creative.id },
          severity: 'warning'
        }).catch(() => {});

        const { error: failedUpdateError } = await supabase
          .from('user_creatives')
          .update({
            fb_video_id: fbVideo.id,
            status: 'failed'
          })
          .eq('id', creative.id);

        if (failedUpdateError) {
          app.log.error(`Failed to mark creative as failed: ${failedUpdateError.message}`);
        } else {
          app.log.info(`Creative ${creative.id} marked as failed`);
        }

        throw creativesError;
      }

      // Обновляем этап онбординга
      onCreativeCreated(body.user_id).catch(err => {
        app.log.warn({ err, userId: body.user_id }, 'Failed to update onboarding stage');
      });

      return reply.send({
        success: true,
        message: 'Video processed and creative created successfully',
        data: {
          creative_id: creative.id,
          fb_video_id: fbVideo.id,
          fb_creative_id: fbCreativeId,
          objective: objective,
          transcription: {
            text: transcription.text,
            language: transcription.language,
            source: 'whisper',
            duration_sec: transcription.duration ? Math.round(transcription.duration) : null
          }
        }
      });

    } catch (error: any) {
      app.log.error({
        message: error.message,
        stack: error.stack,
        fb_error: error.response?.data,
        status: error.response?.status
      }, 'Error processing video');

      logErrorToAdmin({
        user_account_id: (request.body as any)?.user_id,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'process_video',
        endpoint: '/process-video',
        request_data: { has_fb_error: !!error.fb },
        severity: 'warning'
      }).catch(() => {});

      if (error.fb) {
        return reply.status(500).send({
          success: false,
          error: error.message,
          facebook_error: error.fb
        });
      }

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors
        });
      }

      return reply.status(500).send({
        success: false,
        error: error.message || 'Internal server error'
      });

    } finally {
      if (videoPath) {
        try {
          await fs.unlink(videoPath);
          app.log.info('Temporary video file deleted');
        } catch (err: any) {
          app.log.error('Failed to delete video file:', err?.message || err);
        }
      }
    }
  });

  // ===================================================
  // POST /re-transcribe - Перетранскрибация видео
  // ===================================================
  app.post('/re-transcribe', async (request, reply) => {
    let videoPath: string | null = null;

    try {
      const body = z.object({
        creative_id: z.string().uuid(),
        user_id: z.string().uuid(),
        language: z.string().default('ru'),
      }).parse(request.body);

      app.log.info({ creative_id: body.creative_id, user_id: body.user_id }, 'Re-transcribe request');

      // Получаем креатив и проверяем владельца
      const { data: creative, error: creativeError } = await supabase
        .from('user_creatives')
        .select('id, user_id, account_id, fb_video_id, media_type')
        .eq('id', body.creative_id)
        .eq('user_id', body.user_id)
        .single();

      if (creativeError || !creative) {
        return reply.status(404).send({
          success: false,
          error: 'Creative not found or access denied'
        });
      }

      // Проверяем что это видео
      if (creative.media_type && creative.media_type !== 'video') {
        return reply.status(400).send({
          success: false,
          error: 'Only video creatives can be re-transcribed'
        });
      }

      if (!creative.fb_video_id) {
        return reply.status(400).send({
          success: false,
          error: 'Creative has no associated video'
        });
      }

      // Получаем access_token
      let accessToken: string;

      const { data: userAccount } = await supabase
        .from('user_accounts')
        .select('access_token, multi_account_enabled')
        .eq('id', body.user_id)
        .single();

      if (!userAccount) {
        return reply.status(404).send({
          success: false,
          error: 'User account not found'
        });
      }

      if (userAccount.multi_account_enabled && creative.account_id) {
        const { data: adAccount } = await supabase
          .from('ad_accounts')
          .select('access_token')
          .eq('id', creative.account_id)
          .eq('user_account_id', body.user_id)
          .single();

        if (!adAccount?.access_token) {
          return reply.status(400).send({
            success: false,
            error: 'Ad account access token not found'
          });
        }
        accessToken = adAccount.access_token;
      } else {
        if (!userAccount.access_token) {
          return reply.status(400).send({
            success: false,
            error: 'User account access token not found'
          });
        }
        accessToken = userAccount.access_token;
      }

      // Получаем URL видео из Facebook
      app.log.info({ fb_video_id: creative.fb_video_id }, 'Fetching video URL from Facebook');

      const FB_API_VERSION = process.env.FB_API_VERSION || 'v20.0';
      const videoInfoUrl = `https://graph.facebook.com/${FB_API_VERSION}/${creative.fb_video_id}?fields=source&access_token=${accessToken}`;

      const videoInfoResponse = await fetch(videoInfoUrl);
      const videoInfo = await videoInfoResponse.json() as { source?: string; error?: any };

      if (!videoInfoResponse.ok || !videoInfo.source) {
        app.log.error({ error: videoInfo.error }, 'Failed to get video URL from Facebook');
        return reply.status(500).send({
          success: false,
          error: 'Failed to get video URL from Facebook',
          details: videoInfo.error?.message
        });
      }

      const videoUrl = videoInfo.source;
      app.log.info({ videoUrl: videoUrl.substring(0, 100) + '...' }, 'Got video URL, downloading...');

      // Скачиваем видео
      // SECURITY: Используем fetch вместо curl exec для предотвращения command injection
      videoPath = path.join('/var/tmp', `retranscribe_${randomUUID()}.mp4`);

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 300000); // 5 min timeout

        const response = await fetch(videoUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; VideoDownloader/1.0)'
          }
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`Failed to download video: HTTP ${response.status}`);
        }

        if (!response.body) {
          throw new Error('No response body');
        }

        // Stream video to disk using pipeline
        const { Readable } = await import('stream');
        const nodeStream = Readable.fromWeb(response.body as any);
        await pipeline(nodeStream, createWriteStream(videoPath));

        const stats = await fs.stat(videoPath);
        if (stats.size === 0) {
          throw new Error('Downloaded empty video file');
        }

        app.log.info({ videoPath, fileSize: stats.size }, 'Video downloaded successfully');
      } catch (downloadError: any) {
        app.log.error({ error: downloadError.message }, 'Failed to download video');

        logErrorToAdmin({
          user_account_id: body.user_id,
          error_type: 'api',
          raw_error: downloadError.message || String(downloadError),
          stack_trace: downloadError.stack,
          action: 're_transcribe_download',
          endpoint: '/re-transcribe',
          request_data: { creative_id: body.creative_id },
          severity: 'warning'
        }).catch(() => {});

        return reply.status(500).send({
          success: false,
          error: 'Failed to download video for re-transcription'
        });
      }

      // Транскрибируем
      app.log.info('Starting re-transcription...');
      const transcription = await processVideoTranscription(videoPath, body.language);
      app.log.info({ textLength: transcription.text.length }, 'Re-transcription completed');

      // Обновляем или создаём запись в creative_transcripts
      const { data: existingTranscript } = await supabase
        .from('creative_transcripts')
        .select('id')
        .eq('creative_id', body.creative_id)
        .maybeSingle();

      if (existingTranscript) {
        // Обновляем существующую запись
        const { error: updateError } = await supabase
          .from('creative_transcripts')
          .update({
            lang: body.language,
            source: 'whisper',
            text: transcription.text,
            duration_sec: transcription.duration ? Math.round(transcription.duration) : null,
            status: 'ready',
            updated_at: new Date().toISOString()
          })
          .eq('id', existingTranscript.id);

        if (updateError) {
          app.log.error({ error: updateError }, 'Failed to update transcript');
        }
      } else {
        // Создаём новую запись
        const { error: insertError } = await supabase
          .from('creative_transcripts')
          .insert({
            creative_id: body.creative_id,
            lang: body.language,
            source: 'whisper',
            text: transcription.text,
            duration_sec: transcription.duration ? Math.round(transcription.duration) : null,
            status: 'ready'
          });

        if (insertError) {
          app.log.error({ error: insertError }, 'Failed to insert transcript');
        }
      }

      app.log.info({ creative_id: body.creative_id }, 'Re-transcription saved successfully');

      return reply.send({
        success: true,
        message: 'Re-transcription completed successfully',
        data: {
          creative_id: body.creative_id,
          transcription: {
            text: transcription.text,
            language: transcription.language,
            duration_sec: transcription.duration ? Math.round(transcription.duration) : null
          }
        }
      });

    } catch (error: any) {
      app.log.error({ error: error.message, stack: error.stack }, 'Re-transcribe error');

      logErrorToAdmin({
        user_account_id: (request.body as any)?.user_id,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 're_transcribe',
        endpoint: '/re-transcribe',
        request_data: { creative_id: (request.body as any)?.creative_id },
        severity: 'warning'
      }).catch(() => {});

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors
        });
      }

      return reply.status(500).send({
        success: false,
        error: error.message || 'Internal server error'
      });

    } finally {
      if (videoPath) {
        try {
          await fs.unlink(videoPath);
          app.log.info('Temporary video file deleted');
        } catch (err: any) {
          app.log.warn({ error: err.message }, 'Failed to delete temp video file');
        }
      }
    }
  });
};
