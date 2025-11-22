import { FastifyPluginAsync } from 'fastify';
import { generateCreativeImage } from '../services/gemini-image'; // Gemini для изображений!
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
      app.log.info('[Generate Creative] Generating creative image with Gemini 3 Pro Image Preview...');
      app.log.info(`[Generate Creative] Texts: offer="${offer}", bullets="${bullets}", profits="${profits}", cta="${cta}"`);
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
        cta,
        user.prompt4 || 'Современный профессиональный дизайн',
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
  
  // Healthcheck эндпоинт
  app.get('/health', async (request, reply) => {
    return { 
      status: 'ok',
      service: 'creative-generation-service',
      timestamp: new Date().toISOString()
    };
  });
};

