/**
 * Routes для работы с брифингом клиентов AI-таргетолог
 */

import { type FastifyRequest, FastifyPluginAsync } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { generatePrompt1, generatePrompt4, type BriefingData } from '../lib/openaiPromptGenerator.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'briefingRoutes' });

// ========================================
// REQUEST SCHEMAS
// ========================================

const generatePromptRequestSchema = {
  type: 'object',
  required: ['user_id', 'business_name', 'business_niche'],
  properties: {
    user_id: { type: 'string', format: 'uuid' },
    business_name: { type: 'string', minLength: 1 },
    business_niche: { type: 'string', minLength: 1 },
    instagram_url: { type: 'string' },
    website_url: { type: 'string' },
    target_audience: { type: 'string' },
    geography: { type: 'string' },
    main_services: { type: 'string' },
    competitive_advantages: { type: 'string' },
    price_segment: { type: 'string', enum: ['эконом', 'средний', 'премиум', ''] },
    main_pains: { type: 'string' },
    main_promises: { type: 'string' },
    social_proof: { type: 'string' },
    guarantees: { type: 'string' },
    tone_of_voice: { type: 'string' },
  },
};

// ========================================
// ROUTES
// ========================================

export const briefingRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /briefing/generate-prompt
   * 
   * Принимает ответы на бриф, генерирует prompt1 через OpenAI,
   * сохраняет в user_briefing_responses и обновляет user_accounts.prompt1
   * 
   * @body BriefingData
   * @returns { success: true, prompt1: string }
   */
  fastify.post(
    '/generate-prompt',
    {
      schema: {
        body: generatePromptRequestSchema,
      },
    },
    async (request: FastifyRequest<{ Body: BriefingData & { user_id: string } }>, reply) => {
      const reqLog = (request as any).log || log;
      const { user_id, ...briefingData } = request.body;

      reqLog.info({
        user_id,
        business_name: briefingData.business_name,
        business_niche: briefingData.business_niche,
      }, 'Получен запрос на генерацию промпта');

      try {
        // 1. Проверяем существование пользователя
        const { data: user, error: userError } = await supabase
          .from('user_accounts')
          .select('id, username')
          .eq('id', user_id)
          .single();

        if (userError || !user) {
          reqLog.error({ user_id, error: userError }, 'Пользователь не найден');
          return reply.status(404).send({
            success: false,
            error: 'Пользователь не найден',
          });
        }

        // 2. Генерируем prompt1 и prompt4 через OpenAI
        reqLog.info('Начинаем генерацию промптов через OpenAI');
        let generatedPrompt1: string;
        let generatedPrompt4: string;
        
        try {
          // Генерируем оба промпта параллельно для ускорения
          [generatedPrompt1, generatedPrompt4] = await Promise.all([
            generatePrompt1(briefingData),
            generatePrompt4(briefingData),
          ]);
        } catch (openaiError) {
          reqLog.error({
            error: openaiError instanceof Error ? openaiError.message : String(openaiError),
          }, 'Ошибка при генерации промптов через OpenAI');
          return reply.status(500).send({
            success: false,
            error: 'Ошибка при генерации промптов. Попробуйте позже.',
          });
        }

        // 3. Сохраняем ответы брифа в user_briefing_responses
        const briefingRecord = {
          user_id,
          business_name: briefingData.business_name,
          business_niche: briefingData.business_niche,
          instagram_url: briefingData.instagram_url,
          website_url: briefingData.website_url,
          target_audience: briefingData.target_audience,
          geography: briefingData.geography,
          main_services: briefingData.main_services,
          competitive_advantages: briefingData.competitive_advantages,
          price_segment: briefingData.price_segment,
          main_pains: briefingData.main_pains,
          main_promises: briefingData.main_promises,
          social_proof: briefingData.social_proof,
          guarantees: briefingData.guarantees,
          tone_of_voice: briefingData.tone_of_voice,
        };

        const { error: briefingError } = await supabase
          .from('user_briefing_responses')
          .upsert(briefingRecord, {
            onConflict: 'user_id',
          });

        if (briefingError) {
          reqLog.error({
            error: briefingError,
            user_id,
          }, 'Ошибка при сохранении ответов брифа');
          // Не прерываем выполнение - промпт уже сгенерирован
        } else {
          reqLog.info({ user_id }, 'Ответы брифа успешно сохранены');
        }

        // 4. Обновляем prompt1 и prompt4 в user_accounts
        const { error: updateError } = await supabase
          .from('user_accounts')
          .update({
            prompt1: generatedPrompt1,
            prompt4: generatedPrompt4,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user_id);

        if (updateError) {
          reqLog.error({
            error: updateError,
            user_id,
          }, 'Ошибка при обновлении промптов в user_accounts');
          return reply.status(500).send({
            success: false,
            error: 'Ошибка при сохранении промптов',
          });
        }

        reqLog.info({
          user_id,
          prompt1_length: generatedPrompt1.length,
          prompt4_length: generatedPrompt4.length,
        }, 'Промпты успешно сгенерированы и сохранены');

        return reply.send({
          success: true,
          prompt1: generatedPrompt1,
          prompt4: generatedPrompt4,
          message: 'Промпты успешно созданы',
        });
      } catch (error) {
        reqLog.error({
          error: error instanceof Error ? error.message : String(error),
          user_id,
        }, 'Неожиданная ошибка при обработке брифа');
        return reply.status(500).send({
          success: false,
          error: 'Внутренняя ошибка сервера',
        });
      }
    }
  );

  /**
   * GET /briefing/:user_id
   * 
   * Получить сохраненные ответы брифа для пользователя
   * 
   * @params user_id
   * @returns { success: true, briefing: BriefingData | null }
   */
  fastify.get(
    '/:user_id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['user_id'],
          properties: {
            user_id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { user_id: string } }>, reply) => {
      const reqLog = (request as any).log || log;
      const { user_id } = request.params;

      reqLog.info({ user_id }, 'Запрос ответов брифа');

      try {
        const { data: briefing, error } = await supabase
          .from('user_briefing_responses')
          .select('*')
          .eq('user_id', user_id)
          .maybeSingle();

        if (error) {
          reqLog.error({ error, user_id }, 'Ошибка при получении брифа');
          return reply.status(500).send({
            success: false,
            error: 'Ошибка при получении данных',
          });
        }

        return reply.send({
          success: true,
          briefing: briefing || null,
        });
      } catch (error) {
        reqLog.error({
          error: error instanceof Error ? error.message : String(error),
          user_id,
        }, 'Неожиданная ошибка при получении брифа');
        return reply.status(500).send({
          success: false,
          error: 'Внутренняя ошибка сервера',
        });
      }
    }
  );
};

