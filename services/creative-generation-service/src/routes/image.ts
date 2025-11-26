import { FastifyPluginAsync } from 'fastify';
import { generateCreativeImage, upscaleImageTo4K, adaptImageToAspectRatio } from '../services/gemini-image';
import { supabase, logSupabaseError } from '../db/supabase';
import { GenerateCreativeRequest, GenerateCreativeResponse } from '../types';

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
      offer, 
      bullets, 
      profits, 
      cta,
      direction_id,
      style_id,
      reference_image,
      reference_image_type,
      reference_image_prompt
    } = request.body;

    try {
      app.log.info(`[Generate Creative] Request from user: ${user_id}`);
      
      // ====== ШАГ 1: Проверяем лимит генераций и загружаем prompt4 ======
      const { data: user, error: userError } = await supabase
        .from('user_accounts')
        .select('id, creative_generations_available, prompt4')
        .eq('id', user_id)
        .single();

      if (userError || !user) {
        logSupabaseError('Get user account', userError);
        return reply.status(404).send({ 
          success: false, 
          error: 'User not found' 
        });
      }

      // Проверка лимита
      if (!user.creative_generations_available || user.creative_generations_available <= 0) {
        app.log.warn(`[Generate Creative] No generations available for user: ${user_id}`);
        return reply.status(403).send({ 
          success: false, 
          error: 'No generations available',
          generations_remaining: 0
        });
      }

      app.log.info(`[Generate Creative] Generations available: ${user.creative_generations_available}`);

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
        user.prompt4 || 'Современный профессиональный дизайн',
        selectedStyle,
        reference_image,
        reference_image_type,
        reference_image_prompt
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
          direction_id: direction_id || null,
          offer,
          bullets,
          profits,
          cta,
          style_id: selectedStyle,
          image_url: publicUrlData.publicUrl,
          status: 'generated'
        })
        .select()
        .single();

      if (creativeError || !creative) {
        logSupabaseError('Create generated_creative record', creativeError);
        throw new Error(`Failed to create generated_creative record: ${creativeError?.message}`);
      }

      app.log.info(`[Generate Creative] Generated creative record created: ${creative.id}`);

      // ====== ШАГ 5: Уменьшаем счетчик генераций ======
      const newGenerationsCount = user.creative_generations_available - 1;
      
      const { error: updateError } = await supabase
        .from('user_accounts')
        .update({ 
          creative_generations_available: newGenerationsCount 
        })
        .eq('id', user_id);

      if (updateError) {
        logSupabaseError('Update generations count', updateError);
        // Не критичная ошибка, продолжаем
      } else {
        app.log.info(`[Generate Creative] Generations remaining: ${newGenerationsCount}`);
      }

      // ====== ШАГ 6: Возвращаем результат ======
      const response: GenerateCreativeResponse = {
        success: true,
        creative_id: creative.id,
        image_url: publicUrlData.publicUrl,
        generations_remaining: newGenerationsCount
      };

      app.log.info('[Generate Creative] Successfully completed');
      return response;

    } catch (error: any) {
      app.log.error('[Generate Creative] Error:', error);
      
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
   * Upscale изображения с 2K до 4K перед финальным использованием
   * Используется при скачивании или создании креатива
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

      // Проверяем, не был ли уже upscale (обе версии)
      if (creative.image_url_4k && creative.image_url_4k_4x5) {
        app.log.info(`[Upscale to 4K] Both 4K versions already exist`);
        return {
          success: true,
          image_url_4k: creative.image_url_4k,
          image_url_4k_4x5: creative.image_url_4k_4x5
        };
      }

      // Загружаем оригинальное изображение из storage
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

      app.log.info('[Upscale to 4K] Original image loaded, starting upscale...');

      // Формируем промпт из данных креатива (только заполненные поля)
      const promptParts: string[] = [`Рекламный креатив для Instagram Reels/Stories (9:16):`];

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

      // Параллельно генерируем обе версии: 9:16 4K и 4:5 4K
      app.log.info('[Upscale to 4K] Starting parallel generation of 9:16 and 4:5 versions...');

      const [upscaled9x16Image, adapted4x5Image] = await Promise.all([
        // 1. Upscale 9:16 версии до 4K
        creative.image_url_4k
          ? null // Уже есть, пропускаем
          : upscaleImageTo4K(base64Image, originalPrompt, '9:16'),
        // 2. Адаптация под 4:5 и upscale до 4K
        creative.image_url_4k_4x5
          ? null // Уже есть, пропускаем
          : adaptImageToAspectRatio(base64Image, originalPrompt, '4:5')
      ]);

      let publicUrl9x16 = creative.image_url_4k;
      let publicUrl4x5 = creative.image_url_4k_4x5;

      // Сохраняем 9:16 4K версию (если генерировали)
      if (upscaled9x16Image) {
        const imageBuffer9x16 = Buffer.from(upscaled9x16Image, 'base64');
        const fileName4K = imagePath.replace('.png', '_4k.png');

        app.log.info(`[Upscale to 4K] Uploading 9:16 4K version: ${fileName4K}`);

        const { error: uploadError9x16 } = await supabase.storage
          .from('creo')
          .upload(fileName4K, imageBuffer9x16, {
            contentType: 'image/png',
            upsert: false,
            cacheControl: '3600'
          });

        if (uploadError9x16) {
          logSupabaseError('Upload 9:16 4K image', uploadError9x16);
          throw new Error(`Failed to upload 9:16 4K image: ${uploadError9x16.message}`);
        }

        const { data: urlData9x16 } = supabase.storage
          .from('creo')
          .getPublicUrl(fileName4K);

        publicUrl9x16 = urlData9x16?.publicUrl || null;
        app.log.info(`[Upscale to 4K] 9:16 4K version uploaded: ${publicUrl9x16}`);
      }

      // Сохраняем 4:5 4K версию (если генерировали)
      if (adapted4x5Image) {
        const imageBuffer4x5 = Buffer.from(adapted4x5Image, 'base64');
        const fileName4x5 = imagePath.replace('.png', '_4k_4x5.png');

        app.log.info(`[Upscale to 4K] Uploading 4:5 4K version: ${fileName4x5}`);

        const { error: uploadError4x5 } = await supabase.storage
          .from('creo')
          .upload(fileName4x5, imageBuffer4x5, {
            contentType: 'image/png',
            upsert: false,
            cacheControl: '3600'
          });

        if (uploadError4x5) {
          logSupabaseError('Upload 4:5 4K image', uploadError4x5);
          throw new Error(`Failed to upload 4:5 4K image: ${uploadError4x5.message}`);
        }

        const { data: urlData4x5 } = supabase.storage
          .from('creo')
          .getPublicUrl(fileName4x5);

        publicUrl4x5 = urlData4x5?.publicUrl || null;
        app.log.info(`[Upscale to 4K] 4:5 4K version uploaded: ${publicUrl4x5}`);
      }

      // Обновляем запись в БД с обоими URL
      const updateData: Record<string, string | null> = {};
      if (publicUrl9x16 && !creative.image_url_4k) {
        updateData.image_url_4k = publicUrl9x16;
      }
      if (publicUrl4x5 && !creative.image_url_4k_4x5) {
        updateData.image_url_4k_4x5 = publicUrl4x5;
      }

      if (Object.keys(updateData).length > 0) {
        const { error: updateError } = await supabase
          .from('generated_creatives')
          .update(updateData)
          .eq('id', creative_id);

        if (updateError) {
          logSupabaseError('Update creative with 4K URLs', updateError);
          // Не критично, продолжаем
        }
      }

      app.log.info('[Upscale to 4K] Successfully completed both versions');

      return {
        success: true,
        image_url_4k: publicUrl9x16,
        image_url_4k_4x5: publicUrl4x5
      };

    } catch (error: any) {
      app.log.error('[Upscale to 4K] Error:', error);

      return reply.status(500).send({
        success: false,
        error: 'Failed to upscale image to 4K',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // Healthcheck эндпоинт
  app.get('/health', async (request, reply) => {
    return {
      status: 'ok',
      service: 'creative-generation-service',
      timestamp: new Date().toISOString()
    };
  });
};

