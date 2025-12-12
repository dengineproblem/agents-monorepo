import { FastifyPluginAsync } from 'fastify';
import { generateText } from '../services/openai';
import { SYSTEM_PROMPTS } from '../services/prompts';
import { supabase } from '../db/supabase';
import { GenerateTextRequest, GenerateTextResponse } from '../types';
import { logTextGenerationError } from '../lib/errorLogger';

export const textsRoutes: FastifyPluginAsync = async (app) => {
  
  // POST /generate-offer - Генерация заголовка
  app.post<{ Body: GenerateTextRequest }>('/generate-offer', async (request, reply) => {
    const { user_id, prompt, existing_bullets, existing_benefits, existing_cta } = request.body;
    
    try {
      app.log.info(`[Generate Offer] Request from user: ${user_id}`);
      app.log.info(`[Generate Offer] Request body: ${JSON.stringify(request.body)}`);
      
      // Получаем prompt4 из user_accounts (не используется для offer, но загружаем для консистентности)
      app.log.info(`[Generate Offer] Querying Supabase for user_id: ${user_id}`);
      const { data: user, error } = await supabase
        .from('user_accounts')
        .select('id, prompt4')
        .eq('id', user_id)
        .single();
      
      app.log.info(`[Generate Offer] Supabase response - data: ${JSON.stringify(user)}`);
      app.log.info(`[Generate Offer] Supabase response - error: ${JSON.stringify(error)}`);
      
      if (error || !user) {
        app.log.error(`[Generate Offer] User not found. Error: ${error?.message}, Details: ${error?.details}, Hint: ${error?.hint}, Code: ${error?.code}, User ID: ${user_id}`);
        return reply.status(404).send({
          success: false,
          error: 'User not found',
          details: error?.message || 'User does not exist in database'
        });
      }
      
      // Формируем полный промпт с контекстом существующих элементов
      const fullPrompt = `${prompt}
${existing_bullets || ''} - текущие буллеты
${existing_benefits || ''} - текущие выгоды
${existing_cta || ''} - текущие cta`;
      
      app.log.info('[Generate Offer] Generating with OpenAI...');
      app.log.info(`[Generate Offer] System prompt length: ${SYSTEM_PROMPTS.offer.length}`);
      app.log.info(`[Generate Offer] User prompt: ${fullPrompt}`);
      
      // Добавляем временную метку для уникальности каждого запроса
      const uniquePrompt = `${fullPrompt}\n\n[Запрос #${Date.now()}. Будь креативным и ОТЛИЧНЫМ от предыдущих вариантов!]`;
      app.log.info(`[Generate Offer] Final unique prompt: ${uniquePrompt}`);
      
      const offer = await generateText(SYSTEM_PROMPTS.offer, uniquePrompt);
      
      app.log.info('[Generate Offer] ===== РЕЗУЛЬТАТ ГЕНЕРАЦИИ =====');
      app.log.info(`[Generate Offer] Raw offer: ${offer}`);
      app.log.info(`[Generate Offer] Offer length: ${offer.length}`);
      app.log.info(`[Generate Offer] Offer type: ${typeof offer}`);
      app.log.info(`[Generate Offer] Trimmed offer: ${offer.trim()}`);
      app.log.info(`[Generate Offer] Trimmed length: ${offer.trim().length}`);
      
      if (offer.trim().length === 0) {
        app.log.error('[Generate Offer] ❌ ERROR: Generated offer is empty!');
        app.log.error(`[Generate Offer] User ID: ${user_id}`);
        app.log.error(`[Generate Offer] User prompt: ${prompt}`);
      }
      
      app.log.info('[Generate Offer] Successfully generated');
      return {
        success: true,
        offer: offer.trim()
      };
      
    } catch (error: any) {
      app.log.error('[Generate Offer] Error:', error);

      // Логируем в централизованную систему ошибок
      logTextGenerationError(user_id, error, 'generate_offer').catch(() => {});

      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to generate offer'
      });
    }
  });

  // POST /generate-bullets - Генерация буллетов
  app.post<{ Body: GenerateTextRequest }>('/generate-bullets', async (request, reply) => {
    const { user_id, prompt, existing_offer, existing_benefits, existing_cta } = request.body;
    
    try {
      app.log.info(`[Generate Bullets] Request from user: ${user_id}`);
      
      const { data: user, error } = await supabase
        .from('user_accounts')
        .select('id')
        .eq('id', user_id)
        .single();
      
      if (error || !user) {
        app.log.error(`[Generate Bullets] User not found: ${error?.message || 'Unknown error'}`);
        return reply.status(404).send({
          success: false,
          error: 'User not found'
        });
      }
      
      const fullPrompt = `${prompt}
${existing_offer || ''} - текущий оффер
${existing_benefits || ''} - текущие выгоды
${existing_cta || ''} - текущие cta`;
      
      app.log.info('[Generate Bullets] Generating with OpenAI...');
      app.log.info(`[Generate Bullets] System prompt length: ${SYSTEM_PROMPTS.bullets.length}`);
      app.log.info(`[Generate Bullets] User prompt: ${fullPrompt}`);
      
      const uniquePrompt = `${fullPrompt}\n\n[Запрос #${Date.now()}. Генерируй НОВЫЕ уникальные буллеты!]`;
      app.log.info(`[Generate Bullets] Final unique prompt: ${uniquePrompt}`);
      
      const bullets = await generateText(SYSTEM_PROMPTS.bullets, uniquePrompt);
      
      app.log.info('[Generate Bullets] ===== РЕЗУЛЬТАТ ГЕНЕРАЦИИ =====');
      app.log.info(`[Generate Bullets] Raw bullets: ${bullets}`);
      app.log.info(`[Generate Bullets] Bullets length: ${bullets.length}`);
      app.log.info(`[Generate Bullets] Bullets type: ${typeof bullets}`);
      app.log.info(`[Generate Bullets] Trimmed bullets: ${bullets.trim()}`);
      app.log.info(`[Generate Bullets] Trimmed length: ${bullets.trim().length}`);
      
      if (bullets.trim().length === 0) {
        app.log.error('[Generate Bullets] ❌ ERROR: Generated bullets are empty!');
        app.log.error(`[Generate Bullets] User ID: ${user_id}`);
        app.log.error(`[Generate Bullets] User prompt: ${prompt}`);
      }
      
      app.log.info('[Generate Bullets] Successfully generated');
      return {
        success: true,
        bullets: bullets.trim()
      };
      
    } catch (error: any) {
      app.log.error('[Generate Bullets] Error:', error);

      // Логируем в централизованную систему ошибок
      logTextGenerationError(user_id, error, 'generate_bullets').catch(() => {});

      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to generate bullets'
      });
    }
  });

  // POST /generate-profits - Генерация выгоды
  app.post<{ Body: GenerateTextRequest }>('/generate-profits', async (request, reply) => {
    const { user_id, prompt, existing_offer, existing_bullets, existing_cta } = request.body;
    
    try {
      app.log.info(`[Generate Profits] Request from user: ${user_id}`);
      
      const { data: user, error } = await supabase
        .from('user_accounts')
        .select('id')
        .eq('id', user_id)
        .single();
      
      if (error || !user) {
        app.log.error(`[Generate Profits] User not found: ${error?.message || 'Unknown error'}`);
        return reply.status(404).send({
          success: false,
          error: 'User not found'
        });
      }
      
      const fullPrompt = `${prompt}
${existing_offer || ''} - текущий оффер
${existing_bullets || ''} - текущие буллеты
${existing_cta || ''} - текущие cta`;
      
      app.log.info('[Generate Profits] Generating with OpenAI...');
      app.log.info(`[Generate Profits] System prompt length: ${SYSTEM_PROMPTS.profits.length}`);
      app.log.info(`[Generate Profits] User prompt: ${fullPrompt}`);
      
      const uniquePrompt = `${fullPrompt}\n\n[Запрос #${Date.now()}. Предложи НОВУЮ уникальную выгоду!]`;
      app.log.info(`[Generate Profits] Final unique prompt: ${uniquePrompt}`);
      
      const profits = await generateText(SYSTEM_PROMPTS.profits, uniquePrompt);
      
      app.log.info('[Generate Profits] ===== РЕЗУЛЬТАТ ГЕНЕРАЦИИ =====');
      app.log.info(`[Generate Profits] Raw profits: ${profits}`);
      app.log.info(`[Generate Profits] Profits length: ${profits.length}`);
      app.log.info(`[Generate Profits] Trimmed profits: ${profits.trim()}`);
      app.log.info(`[Generate Profits] Trimmed length: ${profits.trim().length}`);
      
      if (profits.trim().length === 0) {
        app.log.error('[Generate Profits] ❌ ERROR: Generated profits are empty!');
      }
      
      app.log.info('[Generate Profits] Successfully generated');
      return {
        success: true,
        profits: profits.trim()
      };
      
    } catch (error: any) {
      app.log.error('[Generate Profits] Error:', error);

      // Логируем в централизованную систему ошибок
      logTextGenerationError(user_id, error, 'generate_profits').catch(() => {});

      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to generate profits'
      });
    }
  });

  // POST /generate-cta - Генерация CTA
  app.post<{ Body: GenerateTextRequest }>('/generate-cta', async (request, reply) => {
    const { user_id, prompt, existing_offer, existing_bullets, existing_benefits } = request.body;
    
    try {
      app.log.info(`[Generate CTA] Request from user: ${user_id}`);
      
      const { data: user, error } = await supabase
        .from('user_accounts')
        .select('id')
        .eq('id', user_id)
        .single();
      
      if (error || !user) {
        app.log.error(`[Generate CTA] User not found: ${error?.message || 'Unknown error'}`);
        return reply.status(404).send({
          success: false,
          error: 'User not found'
        });
      }
      
      const fullPrompt = `${prompt}
${existing_offer || ''} - текущий оффер
${existing_bullets || ''} - текущие буллеты
${existing_benefits || ''} - текущие выгоды`;
      
      app.log.info('[Generate CTA] Generating with OpenAI...');
      app.log.info(`[Generate CTA] System prompt length: ${SYSTEM_PROMPTS.cta.length}`);
      app.log.info(`[Generate CTA] User prompt: ${fullPrompt}`);
      
      const uniquePrompt = `${fullPrompt}\n\n[Запрос #${Date.now()}. Создай НОВЫЙ оригинальный CTA!]`;
      app.log.info(`[Generate CTA] Final unique prompt: ${uniquePrompt}`);
      
      const cta = await generateText(SYSTEM_PROMPTS.cta, uniquePrompt);
      
      app.log.info('[Generate CTA] ===== РЕЗУЛЬТАТ ГЕНЕРАЦИИ =====');
      app.log.info(`[Generate CTA] Raw cta: ${cta}`);
      app.log.info(`[Generate CTA] CTA length: ${cta.length}`);
      app.log.info(`[Generate CTA] Trimmed cta: ${cta.trim()}`);
      app.log.info(`[Generate CTA] Trimmed length: ${cta.trim().length}`);
      
      if (cta.trim().length === 0) {
        app.log.error('[Generate CTA] ❌ ERROR: Generated CTA is empty!');
      }
      
      app.log.info('[Generate CTA] Successfully generated');
      return {
        success: true,
        cta: cta.trim()
      };
      
    } catch (error: any) {
      app.log.error('[Generate CTA] Error:', error);

      // Логируем в централизованную систему ошибок
      logTextGenerationError(user_id, error, 'generate_cta').catch(() => {});

      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to generate CTA'
      });
    }
  });
};

