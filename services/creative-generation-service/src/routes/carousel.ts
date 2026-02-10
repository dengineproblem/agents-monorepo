import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  GenerateCarouselTextsRequest,
  GenerateCarouselTextsResponse,
  RegenerateCarouselCardTextRequest,
  RegenerateCarouselCardTextResponse,
  GenerateCarouselRequest,
  GenerateCarouselResponse,
  RegenerateCarouselCardRequest,
  RegenerateCarouselCardResponse,
  UpscaleCarouselRequest,
  UpscaleCarouselResponse,
  CarouselCard
} from '../types';
import { generateCarouselTexts, regenerateCarouselCardText } from '../services/carouselTextGenerator';
import { generateCarouselImages, regenerateCarouselCard, upscaleCarouselTo4K } from '../services/gemini-carousel';
import { generateCarouselCardPrompt } from '../services/carouselPromptGenerator';
import { getSupabaseClient } from '../db/supabase';
import { addOnboardingTag } from '../lib/onboardingTags';
import { logCarouselGenerationError } from '../lib/errorLogger';

export default async function carouselRoutes(fastify: FastifyInstance) {

  // ============================================
  // POST /generate-carousel-texts
  // Генерация текстов для карусели
  // ============================================
  fastify.post<{ Body: GenerateCarouselTextsRequest }>(
    '/generate-carousel-texts',
    async (request: FastifyRequest<{ Body: GenerateCarouselTextsRequest }>, reply: FastifyReply) => {
      try {
        const { user_id, account_id, carousel_idea, cards_count, openai_api_key } = request.body as any;

        console.log('[Carousel Texts] Request:', { user_id, account_id, cards_count, idea_length: carousel_idea?.length || 0 });

        // Валидация (carousel_idea может быть пустой - модель сама придумает)
        if (!user_id || !cards_count) {
          return reply.status(400).send({
            success: false,
            error: 'Missing required fields: user_id, cards_count'
          });
        }

        if (cards_count < 2 || cards_count > 10) {
          return reply.status(400).send({
            success: false,
            error: 'cards_count must be between 2 and 10'
          });
        }

        // Получаем данные пользователя
        const supabase = getSupabaseClient();
        const { data: user, error: userError } = await supabase
          .from('user_accounts')
          .select('prompt1, multi_account_enabled')
          .eq('id', user_id)
          .single();

        if (userError || !user) {
          console.error('[Carousel Texts] User not found:', userError);
          return reply.status(404).send({
            success: false,
            error: 'User not found'
          });
        }

        // Определяем prompt1: в мультиаккаунтном режиме берём из ad_accounts
        let userPrompt1 = user.prompt1 || '';
        const isMultiAccountMode = user.multi_account_enabled === true;

        if (isMultiAccountMode && account_id) {
          const { data: adAccount, error: adError } = await supabase
            .from('ad_accounts')
            .select('prompt1')
            .eq('id', account_id)
            .eq('user_account_id', user_id)
            .single();

          if (adError || !adAccount) {
            console.error('[Carousel Texts] Ad account not found:', adError);
            return reply.status(404).send({
              success: false,
              error: 'Ad account not found or prompt1 not configured'
            });
          }

          userPrompt1 = adAccount.prompt1 || '';
        }

        if (!userPrompt1) {
          return reply.status(400).send({
            success: false,
            error: 'Промпт не настроен. Пожалуйста, настройте prompt1 в вашем профиле.'
          });
        }

        // Генерируем тексты
        const texts = await generateCarouselTexts(carousel_idea, cards_count, userPrompt1, openai_api_key);

        const response: GenerateCarouselTextsResponse = {
          success: true,
          texts
        };

        return reply.send(response);

      } catch (error: any) {
        console.error('[Carousel Texts] Error:', error);

        // Логируем в централизованную систему ошибок
        const { user_id } = request.body;
        logCarouselGenerationError(user_id, error, 'generate_carousel_texts').catch(() => {});

        return reply.status(500).send({
          success: false,
          error: error.message || 'Failed to generate carousel texts'
        });
      }
    }
  );

  // ============================================
  // POST /regenerate-carousel-card-text
  // Перегенерация текста одной карточки
  // ============================================
  fastify.post<{ Body: RegenerateCarouselCardTextRequest }>(
    '/regenerate-carousel-card-text',
    async (request: FastifyRequest<{ Body: RegenerateCarouselCardTextRequest }>, reply: FastifyReply) => {
      try {
        const { user_id, account_id, carousel_id, card_index, existing_texts, openai_api_key } = request.body as any;

        console.log('[Carousel Card Text] Request:', { user_id, account_id, carousel_id, card_index });

        // Валидация
        if (!user_id || !carousel_id || card_index === undefined || !existing_texts) {
          return reply.status(400).send({
            success: false,
            error: 'Missing required fields'
          });
        }

        // Получаем данные пользователя
        const supabase = getSupabaseClient();
        const { data: user, error: userError } = await supabase
          .from('user_accounts')
          .select('prompt1, multi_account_enabled')
          .eq('id', user_id)
          .single();

        if (userError || !user) {
          return reply.status(404).send({
            success: false,
            error: 'User not found'
          });
        }

        // Определяем prompt1: в мультиаккаунтном режиме берём из ad_accounts
        let userPrompt1 = user.prompt1 || '';
        const isMultiAccountMode = user.multi_account_enabled === true;

        if (isMultiAccountMode && account_id) {
          const { data: adAccount, error: adError } = await supabase
            .from('ad_accounts')
            .select('prompt1')
            .eq('id', account_id)
            .eq('user_account_id', user_id)
            .single();

          if (!adError && adAccount?.prompt1) {
            userPrompt1 = adAccount.prompt1;
          }
        }

        if (!userPrompt1) {
          userPrompt1 = 'Информация о бизнесе не указана';
        }

        // Перегенерируем текст карточки
        const text = await regenerateCarouselCardText(card_index, existing_texts, userPrompt1, openai_api_key);

        const response: RegenerateCarouselCardTextResponse = {
          success: true,
          text
        };

        return reply.send(response);

      } catch (error: any) {
        console.error('[Carousel Card Text] Error:', error);

        // Логируем в централизованную систему ошибок
        const { user_id } = request.body;
        logCarouselGenerationError(user_id, error, 'regenerate_carousel_card_text').catch(() => {});

        return reply.status(500).send({
          success: false,
          error: error.message || 'Failed to regenerate card text'
        });
      }
    }
  );

  // ============================================
  // POST /generate-carousel
  // Генерация полной карусели (изображения)
  // ============================================
  fastify.post<{ Body: GenerateCarouselRequest }>(
    '/generate-carousel',
    async (request: FastifyRequest<{ Body: GenerateCarouselRequest }>, reply: FastifyReply) => {
      try {
        const { user_id, account_id, carousel_texts, visual_style, style_prompt, custom_prompts, reference_images, direction_id, openai_api_key, gemini_api_key } = request.body as any;

        console.log('[Generate Carousel] Request:', {
          user_id,
          account_id,
          cards_count: carousel_texts.length,
          visual_style: visual_style || 'clean_minimal',
          direction_id
        });

        // Валидация
        if (!user_id || !carousel_texts || carousel_texts.length < 2 || carousel_texts.length > 10) {
          return reply.status(400).send({
            success: false,
            error: 'Invalid carousel_texts: must have 2-10 cards'
          });
        }

        // Получаем данные пользователя
        const supabase = getSupabaseClient();
        const { data: user, error: userError } = await supabase
          .from('user_accounts')
          .select('id, prompt4, creative_generations_available, multi_account_enabled')
          .eq('id', user_id)
          .single();

        if (userError || !user) {
          return reply.status(404).send({
            success: false,
            error: 'User not found'
          });
        }

        const cardsCount = carousel_texts.length;
        const isMultiAccountMode = user.multi_account_enabled === true;

        // ВРЕМЕННО: Лимит генераций отключён - безлимитные генерации для всех
        // TODO: Вернуть проверку лимитов позже
        // if (!isMultiAccountMode && user.creative_generations_available < cardsCount) {
        //   return reply.status(403).send({
        //     success: false,
        //     error: `Not enough generations. Need ${cardsCount}, have ${user.creative_generations_available}`
        //   });
        // }

        // Определяем prompt4: в мультиаккаунтном режиме берём из ad_accounts
        // Для freestyle стиля prompt4 не используется
        const selectedStyle = visual_style || 'clean_minimal';
        let userPrompt4 = selectedStyle === 'freestyle' ? '' : (user.prompt4 || '');

        if (selectedStyle !== 'freestyle' && isMultiAccountMode && account_id) {
          const { data: adAccount, error: adError } = await supabase
            .from('ad_accounts')
            .select('prompt4')
            .eq('id', account_id)
            .eq('user_account_id', user_id)
            .single();

          if (!adError && adAccount?.prompt4) {
            userPrompt4 = adAccount.prompt4;
          }
        }

        if (!userPrompt4 && selectedStyle !== 'freestyle') {
          userPrompt4 = 'Информация о бизнесе не указана';
        }

        // Генерируем изображения для всех карточек
        const images = await generateCarouselImages(
          carousel_texts,
          userPrompt4,
          selectedStyle,
          custom_prompts,
          reference_images,
          style_prompt,  // Для freestyle стиля
          openai_api_key,
          gemini_api_key
        );

        // Загружаем изображения в Supabase Storage
        const uploadedCards: CarouselCard[] = [];

        for (let i = 0; i < images.length; i++) {
          const base64Image = images[i];
          const imageBuffer = Buffer.from(base64Image, 'base64');

          // Уникальное имя файла
          const timestamp = Date.now();
          const randomStr = Math.random().toString(36).substring(7);
          const fileName = `creatives/${user_id}/carousel_${timestamp}_card${i + 1}_${randomStr}.png`;

          console.log(`[Generate Carousel] Uploading card ${i + 1}/${images.length} to Storage...`);

          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('creo')
            .upload(fileName, imageBuffer, {
              contentType: 'image/png',
              upsert: false
            });

          if (uploadError) {
            console.error(`[Generate Carousel] Upload error for card ${i + 1}:`, uploadError);
            throw new Error(`Failed to upload card ${i + 1}: ${uploadError.message}`);
          }

          // Получаем публичный URL
          const { data: urlData } = supabase.storage
            .from('creo')
            .getPublicUrl(fileName);

          const imageUrl = urlData.publicUrl;

          uploadedCards.push({
            order: i,
            text: carousel_texts[i],
            image_url: imageUrl,
            custom_prompt: custom_prompts?.[i] || undefined,
            reference_image_url: reference_images?.[i] ? 'user_provided' : undefined
          });
        }

        // Создаем запись в БД
        const { data: carouselRecord, error: insertError } = await supabase
          .from('generated_creatives')
          .insert({
            user_id,
            direction_id: direction_id || null,
            creative_type: 'carousel',
            carousel_data: uploadedCards,
            visual_style: visual_style || 'clean_minimal',
            status: 'generated'
          })
          .select()
          .single();

        if (insertError) {
          console.error('[Generate Carousel] DB insert error:', insertError);
          throw new Error(`Failed to save carousel: ${insertError.message}`);
        }

        // Декрементируем счетчик генераций (только для не-мультиаккаунтного режима)
        let generationsRemaining = user.creative_generations_available;

        if (!isMultiAccountMode) {
          generationsRemaining = user.creative_generations_available - cardsCount;

          const { error: updateError } = await supabase
            .from('user_accounts')
            .update({
              creative_generations_available: generationsRemaining
            })
            .eq('id', user_id);

          if (updateError) {
            console.error('[Generate Carousel] Failed to decrement generations:', updateError);
          }
        } else {
          console.log('[Generate Carousel] Multi-account mode - skipping generation counter decrement');
        }

        const response: GenerateCarouselResponse = {
          success: true,
          carousel_id: carouselRecord.id,
          carousel_data: uploadedCards,
          generations_remaining: generationsRemaining
        };

        console.log('[Generate Carousel] Success:', { carousel_id: carouselRecord.id });

        // Добавляем тег онбординга: сгенерировал карусель
        addOnboardingTag(user_id, 'generated_carousel').catch(err => {
          console.warn('[Generate Carousel] Failed to add onboarding tag:', err);
        });

        return reply.send(response);

      } catch (error: any) {
        console.error('[Generate Carousel] Error:', error);

        // Логируем в централизованную систему ошибок
        const { user_id } = request.body;
        logCarouselGenerationError(user_id, error, 'generate_carousel').catch(() => {});

        return reply.status(500).send({
          success: false,
          error: error.message || 'Failed to generate carousel'
        });
      }
    }
  );

  // ============================================
  // POST /regenerate-carousel-card
  // Перегенерация одной карточки карусели
  // ============================================
  fastify.post<{ Body: RegenerateCarouselCardRequest }>(
    '/regenerate-carousel-card',
    async (request: FastifyRequest<{ Body: RegenerateCarouselCardRequest }>, reply: FastifyReply) => {
      try {
        const { user_id, account_id, carousel_id, card_index, custom_prompt, style_prompt, reference_image, reference_images, text, change_options, openai_api_key, gemini_api_key } = request.body as any;

        // Собираем все референсы в один массив (reference_images приоритетнее)
        let contentReferenceImages: string[] | undefined;
        if (reference_images && reference_images.length > 0) {
          contentReferenceImages = reference_images;
        } else if (reference_image) {
          contentReferenceImages = [reference_image];
        }

        console.log('[Regenerate Card] Request:', {
          user_id,
          account_id,
          carousel_id,
          card_index,
          has_custom_prompt: !!custom_prompt,
          custom_prompt_length: custom_prompt?.length || 0,
          reference_images_count: contentReferenceImages?.length || 0,
          change_options: change_options || 'all (default)'
        });

        // Валидация
        if (!user_id || !carousel_id || card_index === undefined || !text) {
          return reply.status(400).send({
            success: false,
            error: 'Missing required fields'
          });
        }

        // Получаем данные пользователя
        const supabase = getSupabaseClient();
        const { data: user, error: userError } = await supabase
          .from('user_accounts')
          .select('id, prompt4, creative_generations_available, multi_account_enabled')
          .eq('id', user_id)
          .single();

        if (userError || !user) {
          return reply.status(404).send({
            success: false,
            error: 'User not found'
          });
        }

        const isMultiAccountMode = user.multi_account_enabled === true;

        // ВРЕМЕННО: Лимит генераций отключён - безлимитные генерации для всех
        // TODO: Вернуть проверку лимитов позже
        // if (!isMultiAccountMode && user.creative_generations_available < 1) {
        //   return reply.status(403).send({
        //     success: false,
        //     error: 'Not enough generations available'
        //   });
        // }

        // Получаем карусель из БД
        const { data: carousel, error: carouselError } = await getSupabaseClient()
          .from('generated_creatives')
          .select('*')
          .eq('id', carousel_id)
          .eq('user_id', user_id)
          .eq('creative_type', 'carousel')
          .single();

        if (carouselError || !carousel) {
          return reply.status(404).send({
            success: false,
            error: 'Carousel not found'
          });
        }

        const carouselData = carousel.carousel_data as CarouselCard[];

        if (card_index < 0 || card_index >= carouselData.length) {
          return reply.status(400).send({
            success: false,
            error: 'Invalid card_index'
          });
        }

        // Определяем prompt4: в мультиаккаунтном режиме берём из ad_accounts
        // Для freestyle стиля prompt4 не используется
        const visualStyle = carousel.visual_style || 'clean_minimal';
        let userPrompt4 = visualStyle === 'freestyle' ? '' : (user.prompt4 || '');

        if (visualStyle !== 'freestyle' && isMultiAccountMode && account_id) {
          const { data: adAccount, error: adError } = await supabase
            .from('ad_accounts')
            .select('prompt4')
            .eq('id', account_id)
            .eq('user_account_id', user_id)
            .single();

          if (!adError && adAccount?.prompt4) {
            userPrompt4 = adAccount.prompt4;
          }
        }

        if (!userPrompt4 && visualStyle !== 'freestyle') {
          userPrompt4 = 'Информация о бизнесе не указана';
        }

        // Извлекаем существующие изображения для консистентности
        const existingImagesUrls = carouselData.map(card => card.image_url).filter(url => url) as string[];

        // Загружаем существующие изображения (нужны для референса)
        const existingImages: string[] = [];
        for (const url of existingImagesUrls) {
          try {
            const response = await fetch(url);
            const buffer = await response.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');
            existingImages.push(base64);
          } catch (e) {
            console.warn('[Regenerate Card] Failed to fetch existing image:', url);
          }
        }

        // Перегенерируем карточку с использованием сохраненного visual_style
        const newImage = await regenerateCarouselCard(
          text,
          card_index,
          existingImages,
          userPrompt4,
          visualStyle,
          custom_prompt,
          contentReferenceImages,
          style_prompt,  // Для freestyle стиля
          change_options,  // Что именно менять при перегенерации
          openai_api_key,
          gemini_api_key
        );

        // Загружаем новое изображение в Storage
        const imageBuffer = Buffer.from(newImage, 'base64');
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(7);
        const fileName = `creatives/${user_id}/carousel_${timestamp}_card${card_index + 1}_regen_${randomStr}.png`;

        const { error: uploadError } = await supabase.storage
          .from('creo')
          .upload(fileName, imageBuffer, {
            contentType: 'image/png',
            upsert: false
          });

        if (uploadError) {
          throw new Error(`Failed to upload regenerated card: ${uploadError.message}`);
        }

        const { data: urlData } = supabase.storage
          .from('creo')
          .getPublicUrl(fileName);

        const newImageUrl = urlData.publicUrl;

        // Обновляем carousel_data
        carouselData[card_index].image_url = newImageUrl;
        carouselData[card_index].text = text;
        if (custom_prompt) {
          carouselData[card_index].custom_prompt = custom_prompt;
        }
        if (reference_image) {
          carouselData[card_index].reference_image_url = 'user_provided';
        }
        // Сбрасываем 4K версию
        delete carouselData[card_index].image_url_4k;

        // Обновляем БД
        const { error: updateCarouselError } = await supabase
          .from('generated_creatives')
          .update({ carousel_data: carouselData })
          .eq('id', carousel_id);

        if (updateCarouselError) {
          console.error('[Regenerate Card] Failed to update carousel:', updateCarouselError);
        }

        // Декрементируем счетчик (только для не-мультиаккаунтного режима)
        let generationsRemaining = user.creative_generations_available;

        if (!isMultiAccountMode) {
          generationsRemaining = user.creative_generations_available - 1;

          const { error: updateCounterError } = await supabase
            .from('user_accounts')
            .update({
              creative_generations_available: generationsRemaining
            })
            .eq('id', user_id);

          if (updateCounterError) {
            console.error('[Regenerate Card] Failed to decrement counter:', updateCounterError);
          }
        } else {
          console.log('[Regenerate Card] Multi-account mode - skipping generation counter decrement');
        }

        const response: RegenerateCarouselCardResponse = {
          success: true,
          card_data: carouselData[card_index],
          generations_remaining: generationsRemaining
        };

        return reply.send(response);

      } catch (error: any) {
        console.error('[Regenerate Card] Error:', error);

        // Логируем в централизованную систему ошибок
        const { user_id } = request.body;
        logCarouselGenerationError(user_id, error, 'regenerate_carousel_card').catch(() => {});

        return reply.status(500).send({
          success: false,
          error: error.message || 'Failed to regenerate card'
        });
      }
    }
  );

  // ============================================
  // POST /upscale-carousel-to-4k
  // Upscale всех карточек карусели до 4K
  // ============================================
  fastify.post<{ Body: UpscaleCarouselRequest }>(
    '/upscale-carousel-to-4k',
    async (request: FastifyRequest<{ Body: UpscaleCarouselRequest }>, reply: FastifyReply) => {
      try {
        const { user_id, carousel_id, gemini_api_key } = request.body as any;

        console.log('[Upscale Carousel] Request:', { user_id, carousel_id });

        // Валидация
        if (!user_id || !carousel_id) {
          return reply.status(400).send({
            success: false,
            error: 'Missing required fields'
          });
        }

        // Получаем карусель из БД
        const supabase = getSupabaseClient();
        const { data: carousel, error: carouselError } = await supabase
          .from('generated_creatives')
          .select('*')
          .eq('id', carousel_id)
          .eq('user_id', user_id)
          .eq('creative_type', 'carousel')
          .single();

        if (carouselError || !carousel) {
          return reply.status(404).send({
            success: false,
            error: 'Carousel not found'
          });
        }

        const carouselData = carousel.carousel_data as CarouselCard[];

        // Загружаем существующие 2K изображения
        const images2K: string[] = [];
        const prompts: string[] = [];

        for (const card of carouselData) {
          if (!card.image_url) continue;

          const response = await fetch(card.image_url);
          const buffer = await response.arrayBuffer();
          const base64 = Buffer.from(buffer).toString('base64');
          images2K.push(base64);

          // Создаем простой промпт для upscale (сохраняем стиль)
          prompts.push(`Premium минималистичный рекламный креатив с текстом: "${card.text}"`);
        }

        // Upscale всех изображений
        const images4K = await upscaleCarouselTo4K(images2K, prompts, gemini_api_key);

        // Загружаем 4K версии в Storage
        console.log('[Upscale Carousel] Uploading 4K images to Storage...');
        for (let i = 0; i < images4K.length; i++) {
          console.log(`[Upscale Carousel] Uploading card ${i + 1}/${images4K.length} to Storage...`);
          const base64Image = images4K[i];
          const imageBuffer = Buffer.from(base64Image, 'base64');
          console.log(`[Upscale Carousel] Image size: ${(imageBuffer.length / 1024 / 1024).toFixed(2)} MB`);

          const timestamp = Date.now();
          const randomStr = Math.random().toString(36).substring(7);
          const fileName = `creatives/${user_id}/carousel_${timestamp}_card${i + 1}_4k_${randomStr}.png`;

          const { error: uploadError } = await supabase.storage
            .from('creo')
            .upload(fileName, imageBuffer, {
              contentType: 'image/png',
              upsert: false
            });

          if (uploadError) {
            console.error(`[Upscale Carousel] Upload error for card ${i + 1}:`, uploadError);
            continue;
          }

          const { data: urlData } = supabase.storage
            .from('creo')
            .getPublicUrl(fileName);

          carouselData[i].image_url_4k = urlData.publicUrl;
          console.log(`[Upscale Carousel] Card ${i + 1}/${images4K.length} uploaded successfully`);
        }
        console.log('[Upscale Carousel] All 4K images uploaded to Storage');

        // Обновляем БД
        const { error: updateError } = await supabase
          .from('generated_creatives')
          .update({ carousel_data: carouselData })
          .eq('id', carousel_id);

        if (updateError) {
          console.error('[Upscale Carousel] Failed to update carousel:', updateError);
        }

        const response: UpscaleCarouselResponse = {
          success: true,
          carousel_data: carouselData
        };

        console.log('[Upscale Carousel] Success');
        return reply.send(response);

      } catch (error: any) {
        console.error('[Upscale Carousel] Error:', error);

        // Логируем в централизованную систему ошибок
        const { user_id } = request.body;
        logCarouselGenerationError(user_id, error, 'upscale_carousel_to_4k').catch(() => {});

        return reply.status(500).send({
          success: false,
          error: error.message || 'Failed to upscale carousel'
        });
      }
    }
  );
}
