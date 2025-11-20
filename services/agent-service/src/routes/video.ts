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
  createWebsiteLeadsCreative
} from '../adapters/facebook.js';

const ProcessVideoSchema = z.object({
  user_id: z.string().uuid(),
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

      app.log.info(`Processing video for user_id: ${body.user_id}, direction_id: ${body.direction_id || 'null (legacy)'}`);
      app.log.info(`Fetching user account data for user_id: ${body.user_id}`);
      
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('id, access_token, ad_account_id, page_id, instagram_id, instagram_username, whatsapp_phone_number')
        .eq('id', body.user_id)
        .single();

      if (userError || !userAccount) {
        return reply.status(404).send({
          success: false,
          error: 'User account not found',
          details: userError?.message
        });
      }

      if (!userAccount.access_token || !userAccount.ad_account_id || !userAccount.page_id || !userAccount.instagram_id) {
        return reply.status(400).send({
          success: false,
          error: 'User account incomplete',
          message: 'Missing required fields: access_token, ad_account_id, page_id, or instagram_id'
        });
      }

      const normalizedAdAccountId = normalizeAdAccountId(userAccount.ad_account_id);

      app.log.info({
        user_id: body.user_id,
        ad_account_id: userAccount.ad_account_id,
        normalized_ad_account_id: normalizedAdAccountId,
        has_instagram: !!userAccount.instagram_id,
        token_preview: userAccount.access_token.substring(0, 30)
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

      const fbVideo = await uploadVideo(normalizedAdAccountId, userAccount.access_token, videoBuffer);

      app.log.info(`Video uploaded to Facebook: ${fbVideo.id}, waiting for processing...`);

      // Ждем 3 секунды, чтобы Facebook обработал видео
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Извлекаем первый кадр видео для обложки
      app.log.info('Extracting thumbnail from first frame...');
      const thumbnailBuffer = await extractVideoThumbnail(videoPath);
      
      app.log.info('Uploading thumbnail to Facebook...');
      const thumbnailResult = await uploadImage(normalizedAdAccountId, userAccount.access_token, thumbnailBuffer);
      
      app.log.info(`Thumbnail uploaded with hash: ${thumbnailResult.hash}, loading direction settings...`);

      // ===================================================
      // ПОЛУЧАЕМ НАСТРОЙКИ ИЗ НАПРАВЛЕНИЯ (default_ad_settings)
      // ===================================================
      let description = 'Напишите нам, чтобы узнать подробности';
      let clientQuestion = 'Здравствуйте! Хочу узнать об этом подробнее.';
      let siteUrl = null;
      let utm = null;

      if (body.direction_id) {
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

          app.log.info({
            direction_id: body.direction_id,
            description,
            clientQuestion,
            siteUrl
          }, 'Using settings from direction');
        } else {
          app.log.warn({
            direction_id: body.direction_id
          }, 'No default settings found for direction, using fallback');
        }
      } else {
        app.log.warn('No direction_id provided, using fallback settings');
      }

      app.log.info('Creating creatives with direction settings...');
      
      let whatsappCreative: { id: string } = { id: '' };
      let instagramCreative: { id: string } = { id: '' };
      let websiteCreative: { id: string } = { id: '' };
      
      try {
        [whatsappCreative, instagramCreative, websiteCreative] = await Promise.all([
          createWhatsAppCreative(normalizedAdAccountId, userAccount.access_token, {
            videoId: fbVideo.id,
            pageId: userAccount.page_id,
            instagramId: userAccount.instagram_id,
            message: description,
            clientQuestion: clientQuestion,
            whatsappPhoneNumber: userAccount.whatsapp_phone_number || undefined,
            thumbnailHash: thumbnailResult.hash
          }),

          createInstagramCreative(normalizedAdAccountId, userAccount.access_token, {
            videoId: fbVideo.id,
            pageId: userAccount.page_id,
            instagramId: userAccount.instagram_id,
            instagramUsername: userAccount.instagram_username || '',
            message: description,
            thumbnailHash: thumbnailResult.hash
          }),

          siteUrl ? createWebsiteLeadsCreative(normalizedAdAccountId, userAccount.access_token, {
            videoId: fbVideo.id,
            pageId: userAccount.page_id,
            instagramId: userAccount.instagram_id,
            message: description,
            siteUrl: siteUrl,
            utm: utm,
            thumbnailHash: thumbnailResult.hash
          }) : Promise.resolve({ id: '' })
        ]);

        app.log.info('All creatives created successfully, saving transcription...');

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

        const { error: updateError } = await supabase
          .from('user_creatives')
          .update({
            fb_video_id: fbVideo.id,
            fb_creative_id_whatsapp: whatsappCreative.id,
            fb_creative_id_instagram_traffic: instagramCreative.id,
            fb_creative_id_site_leads: websiteCreative.id || null,
            status: 'ready'
          })
          .eq('id', creative.id);

        if (updateError) {
          throw new Error(`Failed to update creative record: ${updateError.message}`);
        }

        app.log.info('Video processing completed successfully');
      } catch (creativesError: any) {
        // При ошибке создания креативов помечаем креатив как failed
        app.log.error(`Failed to create creatives: ${creativesError.message}`);
        
        await supabase
          .from('user_creatives')
          .update({
            fb_video_id: fbVideo.id,
            status: 'failed',
            error_message: creativesError.message
          })
          .eq('id', creative.id);
        
        throw creativesError;
      }

      return reply.send({
        success: true,
        message: 'Video processed and creatives created successfully',
        data: {
          creative_id: creative.id,
          fb_video_id: fbVideo.id,
          fb_creative_id_whatsapp: whatsappCreative.id,
          fb_creative_id_instagram_traffic: instagramCreative.id,
          fb_creative_id_site_leads: websiteCreative.id || null,
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
};
