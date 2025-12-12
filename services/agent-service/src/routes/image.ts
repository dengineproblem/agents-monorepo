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
import { onCreativeCreated, onCreativeGenerated } from '../lib/onboardingHelper.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

const ProcessImageSchema = z.object({
  user_id: z.string().uuid(),
  account_id: z.string().uuid().optional(), // UUID из ad_accounts (для мультиаккаунтности)
  title: z.string().optional(),
  description: z.string().optional(),
  client_question: z.string().optional(),
  site_url: z.string().url().optional(),
  utm: z.string().optional(),
  direction_id: z.string().uuid().optional(), // Направление бизнеса (опционально для legacy)
  page_access_token: z.string().optional() // Опционально: токен страницы как в n8n
});

type ProcessImageBody = z.infer<typeof ProcessImageSchema>;

const CreateImageCreativeSchema = z.object({
  user_id: z.string().uuid(),
  account_id: z.string().uuid().optional(), // UUID FK из ad_accounts.id (для мультиаккаунтности)
  creative_id: z.string().uuid(), // ID из generated_creatives
  direction_id: z.string().uuid()
});

type CreateImageCreativeBody = z.infer<typeof CreateImageCreativeSchema>;

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

      app.log.info(`Processing image for user_id: ${body.user_id}, account_id: ${body.account_id || 'null'}, direction_id: ${body.direction_id || 'null'}`);

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

        ACCESS_TOKEN = body.page_access_token || adAccount.access_token;
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

        ACCESS_TOKEN = body.page_access_token || userAccount.access_token;
        fbAdAccountId = userAccount.ad_account_id;
        pageId = userAccount.page_id;
        instagramId = userAccount.instagram_id;
        instagramUsername = userAccount.instagram_username;
      }

      const normalizedAdAccountId = normalizeAdAccountId(fbAdAccountId);

      app.log.info('Creating creative record in database...');

      // Создаем запись креатива в БД со статусом 'processing'
      const { data: creative, error: createError } = await supabase
        .from('user_creatives')
        .insert({
          user_id: body.user_id,
          account_id: body.account_id || null, // UUID FK для мультиаккаунтности
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
            pageId: pageId,
            instagramId: instagramId,
            message: description,
            clientQuestion: clientQuestion
          });
          fbCreativeId = whatsappCreative.id;
        } else if (objective === 'instagram_traffic') {
          const instagramCreative = await createInstagramImageCreative(normalizedAdAccountId, ACCESS_TOKEN, {
            imageHash: fbImage.hash,
            pageId: pageId,
            instagramId: instagramId,
            instagramUsername: instagramUsername || '',
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
            pageId: pageId,
            instagramId: instagramId,
            message: description,
            siteUrl: siteUrl,
            utm: utm || undefined
          });
          fbCreativeId = websiteCreative.id;
        }

        app.log.info(`Creative created with ID: ${fbCreativeId}, updating record...`);

        // Обновляем запись креатива - новый стандарт: один креатив = один objective
        const updateData: any = {
          fb_image_hash: fbImage.hash,
          status: 'ready',
          fb_creative_id: fbCreativeId,
          // Старые поля для обратной совместимости (deprecated)
          ...(objective === 'whatsapp' && { fb_creative_id_whatsapp: fbCreativeId }),
          ...(objective === 'instagram_traffic' && { fb_creative_id_instagram_traffic: fbCreativeId }),
          ...(objective === 'site_leads' && { fb_creative_id_site_leads: fbCreativeId })
        };

        const { error: updateError } = await supabase
          .from('user_creatives')
          .update(updateData)
          .eq('id', creative.id);

        if (updateError) {
          app.log.error(`Failed to update creative: ${updateError.message}`);
          throw updateError;
        }

        app.log.info('Image processing completed successfully');

        // Обновляем этап онбординга
        onCreativeCreated(body.user_id).catch(err => {
          app.log.warn({ err, userId: body.user_id }, 'Failed to update onboarding stage');
        });
        onCreativeGenerated(body.user_id, 'image').catch(err => {
          app.log.warn({ err, userId: body.user_id }, 'Failed to add onboarding tag');
        });

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

        logErrorToAdmin({
          user_account_id: body.user_id,
          error_type: 'api',
          raw_error: processingError.message || String(processingError),
          stack_trace: processingError.stack,
          action: 'process_image_upload',
          endpoint: '/process-image',
          request_data: { direction_id: body.direction_id, has_fb_error: !!processingError.fb },
          severity: 'warning'
        }).catch(() => {});

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

      logErrorToAdmin({
        user_account_id: (request.body as any)?.user_id || (request.body as any)?.id,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'process_image',
        endpoint: '/process-image',
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

  /**
   * POST /create-image-creative
   * Создаёт FB креатив из generated_creative
   * Использует единственное 9:16 изображение - Meta сама кропнет до 4:5 для Feed плейсментов
   */
  app.post<{ Body: CreateImageCreativeBody }>('/create-image-creative', async (request, reply) => {
    try {
      const body = CreateImageCreativeSchema.parse(request.body);
      const { user_id, account_id, creative_id, direction_id } = body;

      app.log.info({ user_id, account_id, creative_id, direction_id }, 'Creating image creative from generated_creative');

      // 1. Загружаем креатив из generated_creatives
      const { data: creative, error: creativeError } = await supabase
        .from('generated_creatives')
        .select('*')
        .eq('id', creative_id)
        .eq('user_id', user_id)
        .single();

      if (creativeError || !creative) {
        app.log.error({ creativeError }, 'Generated creative not found');
        return reply.status(404).send({
          success: false,
          error: 'Generated creative not found'
        });
      }

      // 2. Проверяем наличие 4K версии (9:16)
      if (!creative.image_url_4k) {
        app.log.error({ has_4k: !!creative.image_url_4k }, '4K version not available');
        return reply.status(400).send({
          success: false,
          error: '4K version is required. Please upscale the image first.',
          details: { has_image_url_4k: !!creative.image_url_4k }
        });
      }

      // 3. Загружаем direction для получения objective
      const { data: direction, error: directionError } = await supabase
        .from('account_directions')
        .select('objective')
        .eq('id', direction_id)
        .single();

      if (directionError || !direction) {
        app.log.error({ directionError }, 'Direction not found');
        return reply.status(404).send({
          success: false,
          error: 'Direction not found'
        });
      }

      const objective = direction.objective as 'whatsapp' | 'instagram_traffic' | 'site_leads';
      app.log.info({ objective }, 'Direction objective loaded');

      // 4. Загружаем настройки из default_ad_settings
      const { data: defaultSettings } = await supabase
        .from('default_ad_settings')
        .select('*')
        .eq('direction_id', direction_id)
        .maybeSingle();

      const description = defaultSettings?.description || 'Узнайте подробности!';
      const clientQuestion = defaultSettings?.client_question || 'Здравствуйте! Хочу узнать подробнее.';
      const siteUrl = defaultSettings?.site_url || null;
      const utm = defaultSettings?.utm_tag || null;

      // 5. Проверяем флаг мультиаккаунтности и загружаем FB credentials
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('id, multi_account_enabled, access_token, ad_account_id, page_id, instagram_id, instagram_username')
        .eq('id', user_id)
        .single();

      if (userError || !userAccount) {
        return reply.status(404).send({
          success: false,
          error: 'User account not found'
        });
      }

      let ACCESS_TOKEN: string;
      let fbAdAccountId: string;
      let pageId: string;
      let instagramId: string;
      let instagramUsername: string | null = null;

      if (userAccount.multi_account_enabled) {
        // Мультиаккаунт включён — требуем account_id
        if (!account_id) {
          return reply.status(400).send({
            success: false,
            error: 'account_id is required when multi_account_enabled is true'
          });
        }

        const { data: adAccount, error: adError } = await supabase
          .from('ad_accounts')
          .select('id, access_token, ad_account_id, page_id, instagram_id, instagram_username')
          .eq('id', account_id)
          .eq('user_account_id', user_id)
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
        if (!userAccount.access_token || !userAccount.ad_account_id || !userAccount.page_id || !userAccount.instagram_id) {
          return reply.status(400).send({
            success: false,
            error: 'User account incomplete (missing access_token, ad_account_id, page_id, or instagram_id)'
          });
        }

        ACCESS_TOKEN = userAccount.access_token;
        fbAdAccountId = userAccount.ad_account_id;
        pageId = userAccount.page_id;
        instagramId = userAccount.instagram_id;
        instagramUsername = userAccount.instagram_username;
      }

      const normalizedAdAccountId = normalizeAdAccountId(fbAdAccountId);

      // 6. Скачиваем и загружаем 9:16 изображение в Facebook
      // Meta сама кропнет 9:16 до 4:5 для Feed плейсментов (текст в центре сохранится)
      app.log.info('Downloading and uploading 9:16 image to Facebook');

      const imageResponse = await fetch(creative.image_url_4k);
      if (!imageResponse.ok) {
        throw new Error('Failed to download 9:16 4K image');
      }
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      app.log.info({ sizeKB: Math.round(imageBuffer.length / 1024) }, '9:16 4K image downloaded');

      const fbImage = await uploadImage(normalizedAdAccountId, ACCESS_TOKEN, imageBuffer);
      app.log.info({ hash: fbImage.hash }, 'Image uploaded to Facebook');

      // 7. Создаём креатив в зависимости от objective
      app.log.info({ objective }, 'Creating creative in Facebook');

      let fbCreativeId = '';

      if (objective === 'whatsapp') {
        const result = await createWhatsAppImageCreative(normalizedAdAccountId, ACCESS_TOKEN, {
          imageHash: fbImage.hash,
          pageId: pageId,
          instagramId: instagramId,
          message: description,
          clientQuestion: clientQuestion
        });
        fbCreativeId = result.id;
      } else if (objective === 'instagram_traffic') {
        const result = await createInstagramImageCreative(normalizedAdAccountId, ACCESS_TOKEN, {
          imageHash: fbImage.hash,
          pageId: pageId,
          instagramId: instagramId,
          instagramUsername: instagramUsername || '',
          message: description
        });
        fbCreativeId = result.id;
      } else if (objective === 'site_leads') {
        if (!siteUrl) {
          return reply.status(400).send({
            success: false,
            error: 'site_url is required for site_leads objective. Please configure it in direction settings.'
          });
        }
        const result = await createWebsiteLeadsImageCreative(normalizedAdAccountId, ACCESS_TOKEN, {
          imageHash: fbImage.hash,
          pageId: pageId,
          instagramId: instagramId,
          message: description,
          siteUrl: siteUrl,
          utm: utm || undefined
        });
        fbCreativeId = result.id;
      } else {
        return reply.status(400).send({
          success: false,
          error: `Unknown objective: ${objective}`
        });
      }

      app.log.info({ fbCreativeId, objective }, 'Creative created in Facebook');

      // 8. Создаём запись в user_creatives
      const { data: userCreative, error: insertError } = await supabase
        .from('user_creatives')
        .insert({
          user_id,
          account_id: account_id || null, // UUID FK для мультиаккаунтности
          direction_id,
          title: creative.offer || 'Image Creative',
          status: 'ready',
          media_type: 'image',
          fb_image_hash: fbImage.hash,
          // Новый стандарт: один креатив = один objective
          fb_creative_id: fbCreativeId,
          // Связь с generated_creative для получения текстов (offer, bullets, profits)
          generated_creative_id: creative_id,
          // URL изображения для миниатюр
          image_url: creative.image_url_4k || creative.image_url,
          // Старые поля для обратной совместимости (deprecated)
          ...(objective === 'whatsapp' && { fb_creative_id_whatsapp: fbCreativeId }),
          ...(objective === 'instagram_traffic' && { fb_creative_id_instagram_traffic: fbCreativeId }),
          ...(objective === 'site_leads' && { fb_creative_id_site_leads: fbCreativeId })
        })
        .select()
        .single();

      if (insertError) {
        app.log.error({ insertError }, 'Failed to create user_creative record');
      }

      // 9. Обновляем статус в generated_creatives
      await supabase
        .from('generated_creatives')
        .update({ status: 'uploaded_to_fb' })
        .eq('id', creative_id);

      app.log.info({
        fbCreativeId,
        userCreativeId: userCreative?.id,
        objective
      }, 'Image creative process completed');

      // Обновляем этап онбординга
      onCreativeCreated(user_id).catch(err => {
        app.log.warn({ err, userId: user_id }, 'Failed to update onboarding stage');
      });
      onCreativeGenerated(user_id, 'image').catch(err => {
        app.log.warn({ err, userId: user_id }, 'Failed to add onboarding tag');
      });

      return reply.send({
        success: true,
        fb_creative_id: fbCreativeId,
        user_creative_id: userCreative?.id,
        objective,
        image_hash: fbImage.hash
      });

    } catch (error: any) {
      app.log.error({ err: error, fb: error?.fb }, 'Error creating image creative');

      const body = request.body as CreateImageCreativeBody;
      logErrorToAdmin({
        user_account_id: body?.user_id,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'create_image_creative',
        endpoint: '/create-image-creative',
        request_data: { creative_id: body?.creative_id, direction_id: body?.direction_id, has_fb_error: !!error.fb },
        severity: 'warning'
      }).catch(() => {});

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors
        });
      }

      if (error.fb) {
        return reply.status(500).send({
          success: false,
          error: error.message || 'Facebook API error',
          facebook_error: error.fb,
          resolution: error.resolution
        });
      }

      return reply.status(500).send({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  });
};

