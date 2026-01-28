import { FastifyPluginAsync } from 'fastify';
import { generateCreativeImage, upscaleImageTo4K, expandTo9x16, extractTextFromImage } from '../services/gemini-image';
import { supabase, logSupabaseError } from '../db/supabase';
import { GenerateCreativeRequest, GenerateCreativeResponse } from '../types';
import { addOnboardingTag } from '../lib/onboardingTags';
import { logImageGenerationError } from '../lib/errorLogger';

export const imageRoutes: FastifyPluginAsync = async (app) => {
  
  /**
   * POST /generate-creative
   * 
   * КЛЮЧЕВОЙ ЭНДПОИНТ - генерирует финальный креатив 1080x1920 с текстом
   * через OpenAI DALL-E 3
   * ВНИМАНИЕ: DALL-E 3 генерирует только фон, текст накладывается отдельно
   */
  app.post<{ Body: GenerateCreativeRequest }>('/generate-creative', async (request, reply) => {
    const {
      user_id,
      account_id,  // UUID рекламного аккаунта для мультиаккаунтности, NULL для legacy
      offer,
      bullets,
      profits,
      cta,
      direction_id,
      style_id,
      style_prompt,  // Промпт для freestyle стиля
      reference_image,
      reference_image_type,
      reference_image_prompt
    } = request.body;

    try {
      app.log.info(`[Generate Creative] Request from user: ${user_id}`);
      
      // ====== ШАГ 1: Проверяем лимит генераций и загружаем prompt4 ======
      const { data: user, error: userError } = await supabase
        .from('user_accounts')
        .select('id, creative_generations_available, prompt4, multi_account_enabled')
        .eq('id', user_id)
        .single();

      if (userError || !user) {
        logSupabaseError('Get user account', userError);
        return reply.status(404).send({ 
          success: false, 
          error: 'User not found' 
        });
      }

      // ====== Месячный лимит генераций: 20 в месяц ======
      const MONTHLY_LIMIT = 20;
      const isMultiAccountMode = user.multi_account_enabled === true;

      // Подсчёт генераций за текущий месяц
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { count: generationsThisMonth, error: countError } = await supabase
        .from('generated_creatives')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user_id)
        .gte('created_at', startOfMonth.toISOString());

      if (countError) {
        logSupabaseError('Count monthly generations', countError);
      }

      const generationsUsed = generationsThisMonth || 0;
      const generationsRemaining = Math.max(0, MONTHLY_LIMIT - generationsUsed);

      app.log.info(`[Generate Creative] Monthly generations: ${generationsUsed}/${MONTHLY_LIMIT}, remaining: ${generationsRemaining}`);

      // Проверяем месячный лимит генераций
      if (generationsRemaining <= 0) {
        app.log.warn(`[Generate Creative] Monthly limit exceeded for user: ${user_id}`);
        return reply.status(403).send({
          success: false,
          error: 'Лимит генераций исчерпан. Доступно 20 генераций в месяц.',
          generations_used: generationsUsed,
          generations_limit: MONTHLY_LIMIT,
          generations_remaining: 0
        });
      }

      // Определяем prompt4: в мультиаккаунтном режиме берём из ad_accounts
      let userPrompt4 = user.prompt4 || '';

      if (isMultiAccountMode && account_id) {
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

      if (!userPrompt4) {
        userPrompt4 = 'Современный профессиональный дизайн';
      }

      // ====== ШАГ 2: Генерируем изображение через Gemini 3 Pro Image Preview ======
      const selectedStyle = style_id || 'modern_performance';
      app.log.info('[Generate Creative] Generating creative image with Gemini 3 Pro Image Preview...');
      app.log.info(`[Generate Creative] Style: ${selectedStyle}`);
      app.log.info(`[Generate Creative] Texts: offer="${offer}", bullets="${bullets}", profits="${profits}"`);
      if (reference_image) {
        app.log.info(`[Generate Creative] Using reference image (type: ${reference_image_type})`);
        if (reference_image_prompt) {
          app.log.info(`[Generate Creative] Reference prompt: "${reference_image_prompt}"`);
        }
      }

      const base64Image = await generateCreativeImage(
        offer,
        bullets,
        profits,
        userPrompt4,
        selectedStyle,
        reference_image,
        reference_image_type,
        reference_image_prompt,
        style_prompt  // Для freestyle стиля
      );

      app.log.info(`[Generate Creative] Image generated, base64 length: ${base64Image.length}`);
      
      // Конвертируем base64 в Buffer
      const imageBuffer = Buffer.from(base64Image, 'base64');
      
      app.log.info(`[Generate Creative] Image downloaded, size: ${imageBuffer.length} bytes`);

      // ====== ШАГ 3: Загружаем изображение в Supabase Storage ======
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(7);
      const fileName = `creatives/${user_id}/${timestamp}_${randomSuffix}.png`;
      
      app.log.info(`[Generate Creative] Uploading to Supabase Storage: ${fileName}`);
      
      const { error: uploadError } = await supabase.storage
        .from('creo')
        .upload(fileName, imageBuffer, {
          contentType: 'image/png',
          upsert: false,
          cacheControl: '3600' // Кеширование на 1 час
        });

      if (uploadError) {
        logSupabaseError('Upload to storage', uploadError);
        throw new Error(`Failed to upload image: ${uploadError.message}`);
      }

      // Получаем публичный URL
      const { data: publicUrlData } = supabase.storage
        .from('creo')
        .getPublicUrl(fileName);

      if (!publicUrlData?.publicUrl) {
        throw new Error('Failed to get public URL for uploaded image');
      }

      app.log.info(`[Generate Creative] Image uploaded: ${publicUrlData.publicUrl}`);

      // ====== ШАГ 4: Создаем запись в generated_creatives ======
      const { data: creative, error: creativeError } = await supabase
        .from('generated_creatives')
        .insert({
          user_id,
          account_id: account_id || null,  // UUID для мультиаккаунтности, NULL для legacy
          direction_id: direction_id || null,
          offer,
          bullets,
          profits,
          cta,
          style_id: selectedStyle,
          image_url: publicUrlData.publicUrl,
          status: 'generated',
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (creativeError || !creative) {
        logSupabaseError('Create generated_creative record', creativeError);
        throw new Error(`Failed to create generated_creative record: ${creativeError?.message}`);
      }

      app.log.info(`[Generate Creative] Generated creative record created: ${creative.id}`);

      // Добавляем тег онбординга: сгенерировал изображение
      addOnboardingTag(user_id, 'generated_image').catch(err => {
        app.log.warn({ err, userId: user_id }, 'Failed to add onboarding tag generated_image');
      });

      // ====== ШАГ 5: Возвращаем результат с обновлённым счётчиком ======
      const newGenerationsUsed = generationsUsed + 1;
      const newGenerationsRemaining = Math.max(0, MONTHLY_LIMIT - newGenerationsUsed);

      const response: GenerateCreativeResponse = {
        success: true,
        creative_id: creative.id,
        image_url: publicUrlData.publicUrl,
        generations_used: newGenerationsUsed,
        generations_limit: MONTHLY_LIMIT,
        generations_remaining: newGenerationsRemaining
      };

      app.log.info(`[Generate Creative] Successfully completed. Used: ${newGenerationsUsed}/${MONTHLY_LIMIT}`);
      return response;

    } catch (error: any) {
      app.log.error('[Generate Creative] Error:', error);

      // Логируем в централизованную систему ошибок
      logImageGenerationError(user_id, error, 'generate_creative_image').catch(() => {});

      // Определяем тип ошибки для более информативного сообщения
      let errorMessage = 'Failed to generate creative';

      if (error.message?.includes('OpenAI')) {
        errorMessage = 'AI image generation failed. Please try again.';
      } else if (error.message?.includes('upload')) {
        errorMessage = 'Failed to save generated image. Please try again.';
      } else if (error.message?.includes('storage')) {
        errorMessage = 'Storage service unavailable. Please try again later.';
      }

      return reply.status(500).send({
        success: false,
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  /**
   * POST /upscale-to-4k
   *
   * Расширяет изображение 4:5 до 9:16 в 4K качестве
   * Новый подход: генерируем в 4:5, расширяем до 9:16 (достраиваем фон снизу)
   * Meta сама кропнет 9:16 до 4:5 для Feed плейсментов
   */
  app.post<{
    Body: {
      creative_id: string;
      user_id: string;
    };
  }>('/upscale-to-4k', async (request, reply) => {
    const { creative_id, user_id } = request.body;

    try {
      app.log.info(`[Upscale to 4K] Request for creative: ${creative_id}, user: ${user_id}`);

      // Получаем креатив из БД
      const { data: creative, error: creativeError } = await supabase
        .from('generated_creatives')
        .select('*')
        .eq('id', creative_id)
        .eq('user_id', user_id)
        .single();

      if (creativeError || !creative) {
        logSupabaseError('Get creative for upscale', creativeError);
        return reply.status(404).send({
          success: false,
          error: 'Creative not found'
        });
      }

      // Проверяем, не был ли уже upscale (только image_url_4k нужен теперь)
      if (creative.image_url_4k) {
        app.log.info(`[Upscale to 4K] 4K 9:16 version already exists`);
        return {
          success: true,
          image_url_4k: creative.image_url_4k
        };
      }

      // Загружаем оригинальное изображение из storage (4:5 формат)
      const imagePath = creative.image_url.split('/creo/')[1];
      const { data: imageData, error: downloadError } = await supabase.storage
        .from('creo')
        .download(imagePath);

      if (downloadError || !imageData) {
        logSupabaseError('Download image for upscale', downloadError);
        throw new Error('Failed to download original image');
      }

      // Конвертируем в base64
      const arrayBuffer = await imageData.arrayBuffer();
      const base64Image = Buffer.from(arrayBuffer).toString('base64');

      app.log.info('[Upscale to 4K] Original 4:5 image loaded, starting expansion to 9:16...');

      // Формируем промпт из данных креатива (только заполненные поля)
      const promptParts: string[] = [`Рекламный креатив для Instagram (4:5 → 9:16):`];

      if (creative.offer && creative.offer.trim()) {
        promptParts.push(`Offer: ${creative.offer}`);
      }
      if (creative.bullets && creative.bullets.trim()) {
        promptParts.push(`Bullets: ${creative.bullets}`);
      }
      if (creative.profits && creative.profits.trim()) {
        promptParts.push(`Profits: ${creative.profits}`);
      }
      promptParts.push(`Style: ${creative.style_id}`);

      const originalPrompt = promptParts.join('\n');

      // Расширяем 4:5 до 9:16 4K (достраиваем фон снизу)
      app.log.info('[Upscale to 4K] Expanding 4:5 to 9:16 4K...');
      const expanded9x16Image = await expandTo9x16(base64Image, originalPrompt);

      // Сохраняем 9:16 4K версию
      const imageBuffer9x16 = Buffer.from(expanded9x16Image, 'base64');
      const fileName4K = imagePath.replace('.png', '_4k.png');

      app.log.info(`[Upscale to 4K] Uploading 9:16 4K version: ${fileName4K}`);

      const { error: uploadError } = await supabase.storage
        .from('creo')
        .upload(fileName4K, imageBuffer9x16, {
          contentType: 'image/png',
          upsert: true, // Перезаписываем если существует
          cacheControl: '3600'
        });

      if (uploadError) {
        logSupabaseError('Upload 9:16 4K image', uploadError);
        throw new Error(`Failed to upload 9:16 4K image: ${uploadError.message}`);
      }

      const { data: urlData } = supabase.storage
        .from('creo')
        .getPublicUrl(fileName4K);

      const publicUrl9x16 = urlData?.publicUrl || null;
      app.log.info(`[Upscale to 4K] 9:16 4K version uploaded: ${publicUrl9x16}`);

      // Обновляем запись в БД
      const { error: updateError } = await supabase
        .from('generated_creatives')
        .update({ image_url_4k: publicUrl9x16 })
        .eq('id', creative_id);

      if (updateError) {
        logSupabaseError('Update creative with 4K URL', updateError);
        // Не критично, продолжаем
      }

      app.log.info('[Upscale to 4K] Successfully completed');

      return {
        success: true,
        image_url_4k: publicUrl9x16
      };

    } catch (error: any) {
      app.log.error('[Upscale to 4K] Error:', error);

      // Логируем в централизованную систему ошибок
      logImageGenerationError(user_id, error, 'upscale_to_4k').catch(() => {});

      return reply.status(500).send({
        success: false,
        error: 'Failed to upscale image to 4K',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  /**
   * POST /ocr
   *
   * Извлекает текст из изображения с помощью Gemini Vision
   * Используется для анализа креативов конкурентов
   */
  app.post<{
    Body: {
      image_url: string;
      image_type?: 'url' | 'base64';
    };
  }>('/ocr', async (request, reply) => {
    const { image_url, image_type = 'url' } = request.body;

    try {
      app.log.info(`[OCR] Request for image: ${image_url.substring(0, 100)}...`);

      if (!image_url) {
        return reply.status(400).send({
          success: false,
          error: 'image_url is required'
        });
      }

      const extractedText = await extractTextFromImage(image_url, image_type);

      app.log.info(`[OCR] Extracted ${extractedText.length} characters`);

      return {
        success: true,
        text: extractedText
      };

    } catch (error: any) {
      app.log.error('[OCR] Error:', error);

      // Логируем в централизованную систему ошибок
      logImageGenerationError('unknown', error, 'ocr').catch(() => {});

      return reply.status(500).send({
        success: false,
        error: 'Failed to extract text from image',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  /**
   * GET /generations-stats
   *
   * Возвращает статистику генераций пользователя за текущий месяц
   */
  app.get<{
    Querystring: {
      user_id: string;
    };
  }>('/generations-stats', async (request, reply) => {
    const { user_id } = request.query;

    if (!user_id) {
      return reply.status(400).send({
        success: false,
        error: 'user_id is required'
      });
    }

    try {
      const MONTHLY_LIMIT = 20;

      // Подсчёт генераций за текущий месяц
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { count, error: countError } = await supabase
        .from('generated_creatives')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user_id)
        .gte('created_at', startOfMonth.toISOString());

      if (countError) {
        logSupabaseError('Count monthly generations', countError);
      }

      const generationsUsed = count || 0;
      const generationsRemaining = Math.max(0, MONTHLY_LIMIT - generationsUsed);

      return {
        success: true,
        generations_used: generationsUsed,
        generations_limit: MONTHLY_LIMIT,
        generations_remaining: generationsRemaining
      };

    } catch (error: any) {
      app.log.error('[Generations Stats] Error:', error);

      return reply.status(500).send({
        success: false,
        error: 'Failed to get generations stats',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });
};

