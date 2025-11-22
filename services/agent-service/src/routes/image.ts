import { FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import {
  uploadImage,
  createWhatsAppImageCreative,
  createInstagramImageCreative,
  createWebsiteLeadsImageCreative
} from '../adapters/facebook.js';

const ProcessImageSchema = z.object({
  user_id: z.string().uuid(),
  title: z.string().optional(),
  description: z.string().optional(),
  client_question: z.string().optional(),
  site_url: z.string().url().optional(),
  utm: z.string().optional(),
  direction_id: z.string().uuid().optional(), // Направление бизнеса (опционально для legacy)
  page_access_token: z.string().optional() // Опционально: токен страницы как в n8n
});

type ProcessImageBody = z.infer<typeof ProcessImageSchema>;

function normalizeAdAccountId(adAccountId: string): string {
  if (!adAccountId) return '';
  const id = String(adAccountId).trim();
  return id.startsWith('act_') ? id : `act_${id}`;
}

export const imageRoutes: FastifyPluginAsync = async (app) => {
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10 MB для изображений
    }
  });

  app.post('/process-image', async (request, reply) => {
    let imagePath: string | null = null;

    try {
      const parts = request.parts();
      
      let bodyData: Partial<ProcessImageBody> = {};
      let imageBuffer: Buffer | null = null;

      // Обрабатываем multipart данные
      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'file') {
          app.log.info('Receiving image file...');
          
          // Загружаем изображение в память (они небольшие, до 10 MB)
          imageBuffer = await part.toBuffer();
          
          app.log.info(`Image received: ${imageBuffer.length} bytes (${Math.round(imageBuffer.length / 1024)} KB)`);
        } else if (part.type === 'field') {
          (bodyData as any)[part.fieldname] = part.value;
        }
      }

      if (!imageBuffer) {
        return reply.status(400).send({
          success: false,
          error: 'Image file is required'
        });
      }

      // Алиасы полей для совместимости: id -> user_id
      if ((bodyData as any).id && !(bodyData as any).user_id) {
        (bodyData as any).user_id = (bodyData as any).id;
      }
      const body = ProcessImageSchema.parse(bodyData);

      app.log.info(`Processing image for user_id: ${body.user_id}, direction_id: ${body.direction_id || 'null (legacy)'}`);
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

      const ACCESS_TOKEN = body.page_access_token || userAccount.access_token;

      if (!ACCESS_TOKEN || !userAccount.ad_account_id || !userAccount.page_id || !userAccount.instagram_id) {
        return reply.status(400).send({
          success: false,
          error: 'User account incomplete',
          message: 'Missing required fields: access_token, ad_account_id, page_id, or instagram_id'
        });
      }

      const normalizedAdAccountId = normalizeAdAccountId(userAccount.ad_account_id);

      app.log.info('Creating creative record in database...');

      // Создаем запись креатива в БД со статусом 'processing'
      const { data: creative, error: createError } = await supabase
        .from('user_creatives')
        .insert({
          user_id: body.user_id,
          direction_id: body.direction_id || null,
          title: body.title || 'Untitled Image Creative',
          status: 'processing',
          media_type: 'image' // ВАЖНО: устанавливаем тип медиа
        })
        .select()
        .single();

      if (createError || !creative) {
        return reply.status(500).send({
          success: false,
          error: 'Failed to create creative record',
          details: createError?.message
        });
      }

      app.log.info(`Creative record created: ${creative.id}`);

      try {
        app.log.info(`Image buffer size: ${Math.round(imageBuffer.length / 1024 / 1024)}MB, uploading to Facebook...`);

        const fbImage = await uploadImage(normalizedAdAccountId, ACCESS_TOKEN, imageBuffer);

        app.log.info(`Image uploaded to Facebook: ${fbImage.hash}, loading direction settings...`);

        // ===================================================
        // ЗАГРУЗКА НАСТРОЕК И OBJECTIVE ИЗ НАПРАВЛЕНИЯ
        // ===================================================
        let description = body.description || 'Напишите нам, чтобы узнать подробности';
        let clientQuestion = body.client_question || 'Здравствуйте! Хочу узнать об этом подробнее.';
        let siteUrl = body.site_url || null;
        let utm = body.utm || null;
        let objective: 'whatsapp' | 'instagram_traffic' | 'site_leads' = 'whatsapp'; // default

        if (body.direction_id) {
          // Загружаем direction для получения objective
          const { data: direction } = await supabase
            .from('account_directions')
            .select('objective')
            .eq('id', body.direction_id)
            .maybeSingle();

          if (direction?.objective) {
            objective = direction.objective as 'whatsapp' | 'instagram_traffic' | 'site_leads';
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
            siteUrl = defaultSettings.site_url || siteUrl;
            utm = defaultSettings.utm_tag || utm;

            app.log.info({
              direction_id: body.direction_id,
              objective,
              description,
              clientQuestion,
              siteUrl,
              utm
            }, 'Using settings from direction for image creative');
          } else {
            app.log.warn({
              direction_id: body.direction_id
            }, 'No default settings found for direction, using fallback');
          }
        } else {
          app.log.warn('No direction_id provided for image, using fallback settings');
        }

        // ===================================================
        // СОЗДАЁМ ОДИН КРЕАТИВ В СООТВЕТСТВИИ С OBJECTIVE
        // ===================================================
        app.log.info(`Creating image creative with objective: ${objective}...`);

        let fbCreativeId = '';

        if (objective === 'whatsapp') {
          const whatsappCreative = await createWhatsAppImageCreative(normalizedAdAccountId, ACCESS_TOKEN, {
            imageHash: fbImage.hash,
            pageId: userAccount.page_id,
            instagramId: userAccount.instagram_id,
            message: description,
            clientQuestion: clientQuestion
          });
          fbCreativeId = whatsappCreative.id;
        } else if (objective === 'instagram_traffic') {
          const instagramCreative = await createInstagramImageCreative(normalizedAdAccountId, ACCESS_TOKEN, {
            imageHash: fbImage.hash,
            pageId: userAccount.page_id,
            instagramId: userAccount.instagram_id,
            instagramUsername: userAccount.instagram_username || '',
            message: description
          });
          fbCreativeId = instagramCreative.id;
        } else if (objective === 'site_leads') {
          if (!siteUrl) {
            app.log.error('site_leads objective requires site_url in direction settings');
            throw new Error('site_url is required for site_leads objective');
          }
          const websiteCreative = await createWebsiteLeadsImageCreative(normalizedAdAccountId, ACCESS_TOKEN, {
            imageHash: fbImage.hash,
            pageId: userAccount.page_id,
            instagramId: userAccount.instagram_id,
            message: description,
            siteUrl: siteUrl,
            utm: utm || undefined
          });
          fbCreativeId = websiteCreative.id;
        }

        app.log.info(`Creative created with ID: ${fbCreativeId}, updating record...`);

        // Обновляем запись креатива - заполняем только нужное поле в зависимости от objective
        const updateData: any = {
          fb_image_hash: fbImage.hash,
          status: 'ready'
        };

        if (objective === 'whatsapp') {
          updateData.fb_creative_id_whatsapp = fbCreativeId;
        } else if (objective === 'instagram_traffic') {
          updateData.fb_creative_id_instagram_traffic = fbCreativeId;
        } else if (objective === 'site_leads') {
          updateData.fb_creative_id_site_leads = fbCreativeId;
        }

        const { error: updateError } = await supabase
          .from('user_creatives')
          .update(updateData)
          .eq('id', creative.id);

        if (updateError) {
          app.log.error(`Failed to update creative: ${updateError.message}`);
          throw updateError;
        }

        app.log.info('Image processing completed successfully');

        return reply.send({
          success: true,
          message: 'Image processed and creative created successfully',
          data: {
            creative_id: creative.id,
            fb_image_hash: fbImage.hash,
            fb_creative_id: fbCreativeId,
            objective: objective,
            media_type: 'image',
            direction_id: body.direction_id || null
          }
        });

      } catch (processingError: any) {
        app.log.error({ err: processingError, fb: processingError?.fb }, 'Error during image processing');

        // Обновляем статус креатива на failed
        await supabase
          .from('user_creatives')
          .update({ status: 'failed' })
          .eq('id', creative.id);

        // Проверяем, является ли это ошибкой Facebook API
        if (processingError.fb) {
          return reply.status(500).send({
            success: false,
            error: processingError.message || 'Facebook API error',
            facebook_error: processingError.fb
          });
        }

        // Вернём как есть, чтобы фронт увидел причину
        return reply.status(500).send({
          success: false,
          error: processingError?.message || 'Internal error',
          stack: processingError?.stack,
          facebook_error: processingError?.fb
        });
      }

    } catch (error: any) {
      app.log.error('Unhandled error in /process-image:', error);

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
      // Cleanup: удаляем временный файл если был создан
      if (imagePath) {
        try {
          await fs.unlink(imagePath);
          app.log.info(`Temporary image file deleted: ${imagePath}`);
        } catch (unlinkError) {
          app.log.warn({ err: unlinkError as unknown, imagePath }, 'Failed to delete temporary file');
        }
      }
    }
  });
};

