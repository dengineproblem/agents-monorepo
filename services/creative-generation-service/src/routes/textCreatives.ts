import { FastifyPluginAsync } from 'fastify';
import { generateText } from '../services/openai';
import { buildTextCreativePrompt, buildEditTextPrompt, TextCreativeType, TEXT_TYPE_LABELS } from '../services/textPrompts';
import { supabase } from '../db/supabase';
import { addOnboardingTag } from '../lib/onboardingTags';
import { logTextGenerationError } from '../lib/errorLogger';

interface GenerateTextCreativeRequest {
  user_id: string;
  text_type: TextCreativeType;
  user_prompt: string;
  account_id?: string; // UUID рекламного аккаунта для мультиаккаунтности
}

interface GenerateTextCreativeResponse {
  success: boolean;
  text?: string;
  generation_id?: string;
  error?: string;
}

interface EditTextCreativeRequest {
  user_id: string;
  text_type: TextCreativeType;
  original_text: string;
  edit_instructions: string;
  account_id?: string; // UUID рекламного аккаунта для мультиаккаунтности
}

interface EditTextCreativeResponse {
  success: boolean;
  text?: string;
  error?: string;
}

export const textCreativesRoutes: FastifyPluginAsync = async (app) => {

  // POST /generate-text-creative - Генерация текстового креатива
  app.post<{ Body: GenerateTextCreativeRequest; Reply: GenerateTextCreativeResponse }>(
    '/generate-text-creative',
    async (request, reply) => {
      const { user_id, text_type, user_prompt, account_id } = request.body;

      try {
        app.log.info(`[Generate Text Creative] Request from user: ${user_id}, type: ${text_type}, account: ${account_id || 'legacy'}`);

        // Валидация типа текста
        const validTypes: TextCreativeType[] = ['storytelling', 'direct_offer', 'expert_video', 'telegram_post', 'threads_post', 'reference'];
        if (!validTypes.includes(text_type)) {
          return reply.status(400).send({
            success: false,
            error: `Invalid text_type. Must be one of: ${validTypes.join(', ')}`
          });
        }

        // user_prompt может быть пустым - генерация на основе контекста
        const safeUserPrompt = user_prompt?.trim() || '';

        // 1. Получаем prompt1 из user_accounts (и multi_account_enabled для определения режима)
        app.log.info(`[Generate Text Creative] Fetching prompt1 for user: ${user_id}`);
        const { data: userAccount, error: userError } = await supabase
          .from('user_accounts')
          .select('id, prompt1, multi_account_enabled')
          .eq('id', user_id)
          .single();

        if (userError || !userAccount) {
          app.log.error(`[Generate Text Creative] User not found: ${userError?.message}`);
          return reply.status(404).send({
            success: false,
            error: 'User not found'
          });
        }

        // Определяем prompt1: в мультиаккаунтном режиме берём из ad_accounts
        let prompt1 = userAccount.prompt1 || '';
        const isMultiAccountMode = userAccount.multi_account_enabled === true;

        if (isMultiAccountMode && account_id) {
          const { data: adAccount, error: adError } = await supabase
            .from('ad_accounts')
            .select('prompt1')
            .eq('id', account_id)
            .eq('user_account_id', user_id)
            .single();

          if (!adError && adAccount?.prompt1) {
            prompt1 = adAccount.prompt1;
            app.log.info(`[Generate Text Creative] Using prompt1 from ad_account: ${account_id}`);
          } else {
            app.log.warn(`[Generate Text Creative] Ad account prompt1 not found, using user_accounts fallback`);
          }
        }

        app.log.info(`[Generate Text Creative] prompt1 length: ${prompt1.length}`);

        // 2. Получаем 10 лучших транскрибаций (по score или по дате)
        app.log.info(`[Generate Text Creative] Fetching top transcriptions...`);
        const { data: transcriptions, error: transcriptionsError } = await supabase
          .from('creative_transcripts')
          .select(`
            id,
            text,
            creative_id,
            user_creatives!inner(user_id),
            creative_analysis(score)
          `)
          .eq('status', 'ready')
          .eq('user_creatives.user_id', user_id)
          .order('created_at', { ascending: false })
          .limit(20); // Берём больше, отсортируем в коде

        let topTranscriptions: Array<{ text: string; score: number | null }> = [];

        if (transcriptions && transcriptions.length > 0) {
          // Сортируем: сначала с score (по убыванию), потом без score (по дате)
          const sorted = transcriptions.sort((a: any, b: any) => {
            const scoreA = a.creative_analysis?.[0]?.score ?? -1;
            const scoreB = b.creative_analysis?.[0]?.score ?? -1;
            return scoreB - scoreA;
          });

          topTranscriptions = sorted.slice(0, 10).map((t: any) => ({
            text: t.text,
            score: t.creative_analysis?.[0]?.score ?? null
          }));

          app.log.info(`[Generate Text Creative] Found ${topTranscriptions.length} transcriptions`);
        } else {
          app.log.info(`[Generate Text Creative] No transcriptions found`);
        }

        // 3. Получаем 5 последних генераций этого пользователя
        app.log.info(`[Generate Text Creative] Fetching previous generations...`);
        const { data: previousGenerations, error: prevError } = await supabase
          .from('text_generation_history')
          .select('generated_text')
          .eq('user_id', user_id)
          .order('created_at', { ascending: false })
          .limit(5);

        const prevGens = previousGenerations || [];
        app.log.info(`[Generate Text Creative] Found ${prevGens.length} previous generations`);

        // 4. Собираем полный промпт
        const fullPrompt = buildTextCreativePrompt(
          text_type,
          prompt1,
          safeUserPrompt,
          topTranscriptions,
          prevGens
        );

        app.log.info(`[Generate Text Creative] Full prompt length: ${fullPrompt.length}`);

        // 5. Генерируем текст через OpenAI GPT-5
        app.log.info(`[Generate Text Creative] Generating with GPT-5...`);
        const generatedText = await generateText(
          '', // System prompt уже включен в fullPrompt
          fullPrompt,
          { model: 'gpt-5' } // GPT-5 для лучшего качества текстов
        );

        const trimmedText = generatedText.trim();

        if (trimmedText.length === 0) {
          app.log.error(`[Generate Text Creative] Generated text is empty!`);
          return reply.status(500).send({
            success: false,
            error: 'Generated text is empty'
          });
        }

        app.log.info(`[Generate Text Creative] Generated text length: ${trimmedText.length}`);

        // 6. Сохраняем в историю
        const transcriptIds = topTranscriptions.length > 0
          ? topTranscriptions.map((_, i) => transcriptions?.[i]?.id).filter(Boolean)
          : [];

        const { data: savedGeneration, error: saveError } = await supabase
          .from('text_generation_history')
          .insert({
            user_id,
            text_type,
            user_prompt: safeUserPrompt,
            generated_text: trimmedText,
            context_transcript_ids: transcriptIds
          })
          .select('id')
          .single();

        if (saveError) {
          app.log.warn(`[Generate Text Creative] Failed to save to history: ${saveError.message}`);
          // Не прерываем - генерация успешна, просто не сохранили в историю
        }

        app.log.info(`[Generate Text Creative] Successfully generated ${TEXT_TYPE_LABELS[text_type]}`);

        // Добавляем тег онбординга: сгенерировал текст
        addOnboardingTag(user_id, 'generated_text').catch(err => {
          app.log.warn({ err, userId: user_id }, 'Failed to add onboarding tag generated_text');
        });

        return {
          success: true,
          text: trimmedText,
          generation_id: savedGeneration?.id
        };

      } catch (error: any) {
        app.log.error(`[Generate Text Creative] Error:`, error);

        // Логируем в централизованную систему ошибок
        logTextGenerationError(user_id, error, 'generate_text_creative').catch(() => {});

        return reply.status(500).send({
          success: false,
          error: error.message || 'Failed to generate text creative'
        });
      }
    }
  );

  // POST /edit-text-creative - Редактирование текстового креатива
  app.post<{ Body: EditTextCreativeRequest; Reply: EditTextCreativeResponse }>(
    '/edit-text-creative',
    async (request, reply) => {
      const { user_id, text_type, original_text, edit_instructions, account_id } = request.body;

      try {
        app.log.info(`[Edit Text Creative] Request from user: ${user_id}, type: ${text_type}, account: ${account_id || 'legacy'}`);

        // Валидация
        const validTypes: TextCreativeType[] = ['storytelling', 'direct_offer', 'expert_video', 'telegram_post', 'threads_post', 'reference'];
        if (!validTypes.includes(text_type)) {
          return reply.status(400).send({
            success: false,
            error: `Invalid text_type. Must be one of: ${validTypes.join(', ')}`
          });
        }

        if (!original_text || original_text.trim().length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'original_text is required'
          });
        }

        if (!edit_instructions || edit_instructions.trim().length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'edit_instructions is required'
          });
        }

        // 1. Получаем prompt1 из user_accounts (и multi_account_enabled для определения режима)
        app.log.info(`[Edit Text Creative] Fetching prompt1 for user: ${user_id}`);
        const { data: userAccount, error: userError } = await supabase
          .from('user_accounts')
          .select('id, prompt1, multi_account_enabled')
          .eq('id', user_id)
          .single();

        if (userError || !userAccount) {
          app.log.error(`[Edit Text Creative] User not found: ${userError?.message}`);
          return reply.status(404).send({
            success: false,
            error: 'User not found'
          });
        }

        // Определяем prompt1: в мультиаккаунтном режиме берём из ad_accounts
        let prompt1 = userAccount.prompt1 || '';
        const isMultiAccountMode = userAccount.multi_account_enabled === true;

        if (isMultiAccountMode && account_id) {
          const { data: adAccount, error: adError } = await supabase
            .from('ad_accounts')
            .select('prompt1')
            .eq('id', account_id)
            .eq('user_account_id', user_id)
            .single();

          if (!adError && adAccount?.prompt1) {
            prompt1 = adAccount.prompt1;
            app.log.info(`[Edit Text Creative] Using prompt1 from ad_account: ${account_id}`);
          }
        }

        // 2. Получаем 10 лучших транскрибаций для контекста
        app.log.info(`[Edit Text Creative] Fetching top transcriptions...`);
        const { data: transcriptions } = await supabase
          .from('creative_transcripts')
          .select(`
            id,
            text,
            creative_id,
            user_creatives!inner(user_id),
            creative_analysis(score)
          `)
          .eq('status', 'ready')
          .eq('user_creatives.user_id', user_id)
          .order('created_at', { ascending: false })
          .limit(20);

        let topTranscriptions: Array<{ text: string; score: number | null }> = [];

        if (transcriptions && transcriptions.length > 0) {
          const sorted = transcriptions.sort((a: any, b: any) => {
            const scoreA = a.creative_analysis?.[0]?.score ?? -1;
            const scoreB = b.creative_analysis?.[0]?.score ?? -1;
            return scoreB - scoreA;
          });

          topTranscriptions = sorted.slice(0, 10).map((t: any) => ({
            text: t.text,
            score: t.creative_analysis?.[0]?.score ?? null
          }));
        }

        // 3. Собираем промпт для редактирования
        const fullPrompt = buildEditTextPrompt(
          text_type,
          prompt1,
          original_text,
          edit_instructions,
          topTranscriptions
        );

        app.log.info(`[Edit Text Creative] Full prompt length: ${fullPrompt.length}`);

        // 4. Генерируем отредактированный текст через GPT-5
        app.log.info(`[Edit Text Creative] Editing with GPT-5...`);
        const editedText = await generateText(
          '',
          fullPrompt,
          { model: 'gpt-5' }
        );

        const trimmedText = editedText.trim();

        if (trimmedText.length === 0) {
          app.log.error(`[Edit Text Creative] Edited text is empty!`);
          return reply.status(500).send({
            success: false,
            error: 'Edited text is empty'
          });
        }

        app.log.info(`[Edit Text Creative] Successfully edited ${TEXT_TYPE_LABELS[text_type]}`);

        return {
          success: true,
          text: trimmedText
        };

      } catch (error: any) {
        app.log.error(`[Edit Text Creative] Error:`, error);

        // Логируем в централизованную систему ошибок
        logTextGenerationError(user_id, error, 'edit_text_creative').catch(() => {});

        return reply.status(500).send({
          success: false,
          error: error.message || 'Failed to edit text creative'
        });
      }
    }
  );
};
