import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import {
  uploadImage,
  createWhatsAppCarouselCreative,
  createInstagramCarouselCreative,
  createWebsiteLeadsCarouselCreative
} from '../adapters/facebook.js';

const CreateCarouselCreativeSchema = z.object({
  user_id: z.string().uuid(),
  carousel_id: z.string().uuid(),
  direction_id: z.string().uuid()
});

type CreateCarouselCreativeBody = z.infer<typeof CreateCarouselCreativeSchema>;

interface CarouselCard {
  order: number;
  text: string;
  image_url?: string;
  image_url_4k?: string;
}

function normalizeAdAccountId(adAccountId: string): string {
  if (!adAccountId) return '';
  const id = String(adAccountId).trim();
  return id.startsWith('act_') ? id : `act_${id}`;
}

export const carouselCreativeRoutes: FastifyPluginAsync = async (app) => {

  /**
   * POST /create-carousel-creative
   * Загружает карусель в Facebook и создаёт ad creative
   */
  app.post('/create-carousel-creative', async (request, reply) => {
    try {
      const body = CreateCarouselCreativeSchema.parse(request.body);
      const { user_id, carousel_id, direction_id } = body;

      app.log.info({
        user_id,
        carousel_id,
        direction_id
      }, 'Creating carousel creative in Facebook');

      // 1. Загружаем карусель из generated_creatives
      const { data: carousel, error: carouselError } = await supabase
        .from('generated_creatives')
        .select('*')
        .eq('id', carousel_id)
        .eq('user_id', user_id)
        .eq('creative_type', 'carousel')
        .single();

      if (carouselError || !carousel) {
        app.log.error({ carouselError }, 'Carousel not found');
        return reply.status(404).send({
          success: false,
          error: 'Carousel not found'
        });
      }

      const carouselData = carousel.carousel_data as CarouselCard[];
      if (!carouselData || carouselData.length === 0) {
        return reply.status(400).send({
          success: false,
          error: 'Carousel has no cards'
        });
      }

      // 2. Загружаем direction для получения objective
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
      app.log.info({ objective }, 'Direction objective');

      // 3. Загружаем настройки из default_ad_settings
      const { data: defaultSettings } = await supabase
        .from('default_ad_settings')
        .select('*')
        .eq('direction_id', direction_id)
        .maybeSingle();

      const description = defaultSettings?.description || 'Смотрите нашу карусель!';
      const clientQuestion = defaultSettings?.client_question || 'Здравствуйте! Хочу узнать подробнее.';
      const siteUrl = defaultSettings?.site_url || null;
      const utm = defaultSettings?.utm_tag || null;

      // 4. Загружаем user_account для Facebook credentials
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('id, access_token, ad_account_id, page_id, instagram_id, instagram_username')
        .eq('id', user_id)
        .single();

      if (userError || !userAccount) {
        return reply.status(404).send({
          success: false,
          error: 'User account not found'
        });
      }

      const ACCESS_TOKEN = userAccount.access_token;
      if (!ACCESS_TOKEN || !userAccount.ad_account_id || !userAccount.page_id || !userAccount.instagram_id) {
        return reply.status(400).send({
          success: false,
          error: 'User account incomplete (missing access_token, ad_account_id, page_id, or instagram_id)'
        });
      }

      const normalizedAdAccountId = normalizeAdAccountId(userAccount.ad_account_id);

      // 5. Для каждой карточки: скачиваем изображение и загружаем в Facebook
      app.log.info({ cardsCount: carouselData.length }, 'Uploading carousel images to Facebook');

      const cardParams: Array<{ imageHash: string; text: string }> = [];

      for (let i = 0; i < carouselData.length; i++) {
        const card = carouselData[i];
        // Предпочитаем 4K версию, если есть
        const imageUrl = card.image_url_4k || card.image_url;

        if (!imageUrl) {
          app.log.error({ cardIndex: i }, 'Card has no image URL');
          return reply.status(400).send({
            success: false,
            error: `Card ${i + 1} has no image`
          });
        }

        app.log.info({ cardIndex: i, imageUrl: imageUrl.substring(0, 50) }, 'Downloading image from Supabase');

        // Скачиваем изображение
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          app.log.error({ cardIndex: i, status: imageResponse.status }, 'Failed to download image');
          return reply.status(500).send({
            success: false,
            error: `Failed to download image for card ${i + 1}`
          });
        }

        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        app.log.info({ cardIndex: i, sizeKB: Math.round(imageBuffer.length / 1024) }, 'Image downloaded');

        // Загружаем в Facebook
        app.log.info({ cardIndex: i }, 'Uploading image to Facebook');
        const fbImage = await uploadImage(normalizedAdAccountId, ACCESS_TOKEN, imageBuffer);
        app.log.info({ cardIndex: i, imageHash: fbImage.hash }, 'Image uploaded to Facebook');

        cardParams.push({
          imageHash: fbImage.hash,
          text: card.text
        });
      }

      // 6. Создаём carousel creative в зависимости от objective
      app.log.info({ objective, cardsCount: cardParams.length }, 'Creating carousel creative in Facebook');

      let fbCreativeId = '';

      if (objective === 'whatsapp') {
        const result = await createWhatsAppCarouselCreative(normalizedAdAccountId, ACCESS_TOKEN, {
          cards: cardParams,
          pageId: userAccount.page_id,
          instagramId: userAccount.instagram_id,
          message: description,
          clientQuestion: clientQuestion
        });
        fbCreativeId = result.id;
      } else if (objective === 'instagram_traffic') {
        const result = await createInstagramCarouselCreative(normalizedAdAccountId, ACCESS_TOKEN, {
          cards: cardParams,
          pageId: userAccount.page_id,
          instagramId: userAccount.instagram_id,
          instagramUsername: userAccount.instagram_username || '',
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
        const result = await createWebsiteLeadsCarouselCreative(normalizedAdAccountId, ACCESS_TOKEN, {
          cards: cardParams,
          pageId: userAccount.page_id,
          instagramId: userAccount.instagram_id,
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

      app.log.info({ fbCreativeId, objective }, 'Carousel creative created in Facebook');

      // 7. Создаём запись в user_creatives
      const { data: userCreative, error: insertError } = await supabase
        .from('user_creatives')
        .insert({
          user_id,
          direction_id,
          title: `Carousel - ${carouselData.length} cards`,
          status: 'ready',
          media_type: 'carousel',
          // Новый стандарт: один креатив = один objective
          fb_creative_id: fbCreativeId,
          // Связь с generated_creative для получения текстов карусели
          generated_creative_id: carousel_id,
          // Данные карусели для отображения миниатюр и текстов
          carousel_data: carouselData,
          // Старые поля для обратной совместимости (deprecated)
          ...(objective === 'whatsapp' && { fb_creative_id_whatsapp: fbCreativeId }),
          ...(objective === 'instagram_traffic' && { fb_creative_id_instagram_traffic: fbCreativeId }),
          ...(objective === 'site_leads' && { fb_creative_id_site_leads: fbCreativeId })
        })
        .select()
        .single();

      if (insertError) {
        app.log.error({ insertError }, 'Failed to create user_creative record');
        // Не фейлим - креатив уже создан в Facebook
      }

      // 8. Обновляем статус в generated_creatives
      await supabase
        .from('generated_creatives')
        .update({ status: 'uploaded_to_fb' })
        .eq('id', carousel_id);

      app.log.info({
        fbCreativeId,
        userCreativeId: userCreative?.id,
        objective
      }, 'Carousel creative process completed');

      return reply.send({
        success: true,
        fb_creative_id: fbCreativeId,
        user_creative_id: userCreative?.id,
        objective,
        cards_count: carouselData.length
      });

    } catch (error: any) {
      app.log.error({ err: error, fb: error?.fb }, 'Error creating carousel creative');

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors
        });
      }

      // Проверяем Facebook API ошибки
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
