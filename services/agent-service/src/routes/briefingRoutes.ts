/**
 * Routes для работы с брифингом клиентов AI-таргетолог
 */

import { type FastifyRequest, FastifyPluginAsync } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { generatePrompt1, generatePrompt2, generatePrompt4, type BriefingData } from '../lib/openaiPromptGenerator.js';
import { createLogger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import {
  searchPageByInstagram,
  fetchCompetitorCreatives,
} from '../lib/searchApi.js';

const log = createLogger({ module: 'briefingRoutes' });

/**
 * Синхронизирует конкурентов из брифа в раздел конкурентов
 * Добавляет Instagram аккаунты как конкурентов с автоматическим сбором креативов
 */
async function syncCompetitorsFromBriefing(
  userId: string,
  instagramHandles: string[],
  reqLog: typeof log,
  accountId?: string | null  // UUID рекламного аккаунта для мультиаккаунтности
): Promise<void> {
  reqLog.info({ userId, handles: instagramHandles }, 'Начинаем синхронизацию конкурентов из брифа');

  for (const handle of instagramHandles) {
    try {
      // 1. Ищем страницу по Instagram handle
      const pages = await searchPageByInstagram(handle, 'KZ');

      if (pages.length === 0) {
        reqLog.warn({ handle }, 'Страница не найдена по Instagram handle');
        continue;
      }

      const page = pages[0];
      const pageId = page.page_id;
      const pageName = page.page_name || handle;

      // 2. Проверяем, существует ли конкурент глобально
      let competitorId: string;
      const { data: existingCompetitor } = await supabase
        .from('competitors')
        .select('id')
        .eq('fb_page_id', pageId)
        .single();

      if (existingCompetitor) {
        competitorId = existingCompetitor.id;
      } else {
        // Создаем нового конкурента
        const { data: newCompetitor, error: createError } = await supabase
          .from('competitors')
          .insert({
            fb_page_id: pageId,
            fb_page_url: `https://instagram.com/${handle}`,
            name: pageName,
            avatar_url: page.avatar_url,
            country_code: 'KZ',
            status: 'pending',
          })
          .select('id')
          .single();

        if (createError) {
          reqLog.warn({ err: createError, handle }, 'Ошибка создания конкурента');
          continue;
        }
        competitorId = newCompetitor.id;
      }

      // 3. Проверяем связь пользователь-конкурент
      const { data: existingLink } = await supabase
        .from('user_competitors')
        .select('id, is_active')
        .eq('user_account_id', userId)
        .eq('competitor_id', competitorId)
        .single();

      if (existingLink) {
        if (!existingLink.is_active) {
          // Реактивируем связь
          await supabase
            .from('user_competitors')
            .update({ is_active: true })
            .eq('id', existingLink.id);
        }
        // Если уже активен - пропускаем
      } else {
        // Создаем связь
        await supabase
          .from('user_competitors')
          .insert({
            user_account_id: userId,
            account_id: accountId || null,  // UUID для мультиаккаунтности
            competitor_id: competitorId,
            display_name: pageName,
          });
      }

      // 4. Запускаем сбор креативов (async, не блокируем)
      fetchCompetitorCreatives(handle, 'KZ', { targetPageId: pageId, limit: 50 })
        .then(async (creatives) => {
          if (creatives.length > 0) {
            // Сохраняем креативы
            for (const creative of creatives.slice(0, 10)) { // Берем первые 10
              await supabase
                .from('competitor_creatives')
                .upsert({
                  competitor_id: competitorId,
                  fb_ad_archive_id: creative.fb_ad_archive_id,
                  media_type: creative.media_type,
                  media_urls: creative.media_urls,
                  thumbnail_url: creative.thumbnail_url,
                  body_text: creative.body_text,
                  headline: creative.headline,
                  cta_type: creative.cta_type,
                  platforms: creative.platforms,
                  first_shown_date: creative.first_shown_date,
                  is_active: creative.is_active,
                  is_top10: true,
                  last_seen_at: new Date().toISOString(),
                }, { onConflict: 'fb_ad_archive_id' });
            }

            // Обновляем статус конкурента
            await supabase
              .from('competitors')
              .update({
                status: 'active',
                last_crawled_at: new Date().toISOString(),
                creatives_count: creatives.length,
              })
              .eq('id', competitorId);
          }
          reqLog.info({ handle, competitorId, creativesCount: creatives.length }, 'Креативы конкурента собраны');
        })
        .catch(err => reqLog.warn({ err, handle }, 'Ошибка сбора креативов конкурента'));

      reqLog.info({ handle, competitorId }, 'Конкурент из брифа добавлен');

    } catch (err) {
      reqLog.warn({ err, handle }, 'Ошибка обработки конкурента из брифа');
    }
  }
}

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
    competitor_instagrams: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 5,
    },
    // Настройки рекламы для Brain Mini
    plan_daily_budget: { type: 'number', minimum: 0 }, // Плановый дневной бюджет в рублях
    default_cpl_target: { type: 'number', minimum: 0 }, // Целевой CPL в рублях
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
        // 1. Проверяем существование пользователя и режим мультиаккаунтности
        const { data: user, error: userError } = await supabase
          .from('user_accounts')
          .select('id, username, multi_account_enabled, ad_account_id, page_id, instagram_id, instagram_username, access_token, business_id')
          .eq('id', user_id)
          .single();

        if (userError || !user) {
          reqLog.error({ user_id, error: userError }, 'Пользователь не найден');
          return reply.status(404).send({
            success: false,
            error: 'Пользователь не найден',
          });
        }

        const isMultiAccountMode = user.multi_account_enabled === true;

        // 2. Генерируем prompt1, prompt2 и prompt4 через OpenAI
        reqLog.info('Начинаем генерацию промптов через OpenAI');
        let generatedPrompt1: string;
        let generatedPrompt2: string;
        let generatedPrompt4: string;

        try {
          // Генерируем все промпты параллельно для ускорения
          // prompt2 — для LLM-агента квалификации лидов (Meta CAPI)
          [generatedPrompt1, generatedPrompt2, generatedPrompt4] = await Promise.all([
            generatePrompt1(briefingData),
            generatePrompt2(briefingData),
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

        // 3. Сохраняем промпты и создаём ad_account (если нужно)
        let createdAdAccountId: string | null = null;

        if (isMultiAccountMode) {
          // МУЛЬТИАККАУНТНЫЙ РЕЖИМ: создаём ad_account и сохраняем туда
          reqLog.info({ user_id }, 'Мультиаккаунтный режим: создаём ad_account');

          const adAccountData: Record<string, unknown> = {
            user_account_id: user_id,
            name: briefingData.business_name,
            prompt1: generatedPrompt1,
            prompt2: generatedPrompt2,  // ✅ НОВОЕ: prompt2 для квалификации лидов (Meta CAPI)
            prompt4: generatedPrompt4,
            is_active: true,
            connection_status: 'pending',
            // Копируем FB credentials из user_accounts если есть
            ad_account_id: user.ad_account_id || null,
            page_id: user.page_id || null,
            instagram_id: user.instagram_id || null,
            instagram_username: user.instagram_username || briefingData.instagram_url || null,
            access_token: user.access_token || null,
            business_id: user.business_id || null,
            // Настройки бюджета для Brain Mini (конвертируем рубли в центы)
            plan_daily_budget_cents: briefingData.plan_daily_budget
              ? Math.round(briefingData.plan_daily_budget * 100)
              : null,
            default_cpl_target_cents: briefingData.default_cpl_target
              ? Math.round(briefingData.default_cpl_target * 100)
              : null,
          };

          const { data: newAdAccount, error: adAccountError } = await supabase
            .from('ad_accounts')
            .insert(adAccountData)
            .select('id')
            .single();

          if (adAccountError) {
            reqLog.error({ error: adAccountError, user_id }, 'Ошибка создания ad_account');
            return reply.status(500).send({
              success: false,
              error: 'Ошибка при создании рекламного аккаунта',
            });
          }

          createdAdAccountId = newAdAccount.id;
          reqLog.info({ user_id, adAccountId: createdAdAccountId }, 'ad_account создан успешно');

        } else {
          // LEGACY РЕЖИМ: обновляем user_accounts как раньше
          const { error: updateError } = await supabase
            .from('user_accounts')
            .update({
              prompt1: generatedPrompt1,
              prompt2: generatedPrompt2,  // ✅ НОВОЕ: prompt2 для квалификации лидов (Meta CAPI)
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

          // Обновляем бюджетные настройки в ad_accounts (если есть)
          if (briefingData.plan_daily_budget || briefingData.default_cpl_target) {
            const updateData: Record<string, unknown> = {};
            if (briefingData.plan_daily_budget) {
              updateData.plan_daily_budget_cents = Math.round(briefingData.plan_daily_budget * 100);
            }
            if (briefingData.default_cpl_target) {
              updateData.default_cpl_target_cents = Math.round(briefingData.default_cpl_target * 100);
            }

            const { error: adAccountUpdateError } = await supabase
              .from('ad_accounts')
              .update(updateData)
              .eq('user_account_id', user_id);

            if (adAccountUpdateError) {
              reqLog.warn({ error: adAccountUpdateError, user_id }, 'Ошибка обновления бюджета в ad_accounts (legacy)');
            } else {
              reqLog.info({ user_id, ...updateData }, 'Бюджетные настройки обновлены в ad_accounts (legacy)');
            }
          }
        }

        // 4. Сохраняем ответы брифа в user_briefing_responses (с account_id для мультиаккаунта)
        const briefingRecord: Record<string, unknown> = {
          user_id,
          account_id: createdAdAccountId, // UUID или null для legacy
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
          competitor_instagrams: briefingData.competitor_instagrams || [],
          // Бюджетные настройки (сохраняем в рублях как есть)
          plan_daily_budget: briefingData.plan_daily_budget || null,
          default_cpl_target: briefingData.default_cpl_target || null,
        };

        // Для мультиаккаунтного режима вставляем новую запись, для legacy - upsert по user_id
        if (isMultiAccountMode) {
          const { error: briefingError } = await supabase
            .from('user_briefing_responses')
            .insert(briefingRecord);

          if (briefingError) {
            reqLog.error({ error: briefingError, user_id, account_id: createdAdAccountId }, 'Ошибка сохранения брифа для мультиаккаунта');
          } else {
            reqLog.info({ user_id, account_id: createdAdAccountId }, 'Бриф сохранён для мультиаккаунта');
          }
        } else {
          const { error: briefingError } = await supabase
            .from('user_briefing_responses')
            .upsert(briefingRecord, { onConflict: 'user_id' });

          if (briefingError) {
            reqLog.error({ error: briefingError, user_id }, 'Ошибка при сохранении ответов брифа');
          } else {
            reqLog.info({ user_id }, 'Ответы брифа успешно сохранены');
          }
        }

        // 5. Синхронизируем конкурентов в раздел конкурентов (async, не блокируем)
        if (briefingData.competitor_instagrams && briefingData.competitor_instagrams.length > 0) {
          syncCompetitorsFromBriefing(user_id, briefingData.competitor_instagrams, reqLog, createdAdAccountId)
            .catch(err => reqLog.warn({ err, user_id }, 'Ошибка синхронизации конкурентов из брифа'));
        }

        reqLog.info({
          user_id,
          prompt1_length: generatedPrompt1.length,
          prompt4_length: generatedPrompt4.length,
          isMultiAccountMode,
          createdAdAccountId,
        }, 'Промпты успешно сгенерированы и сохранены');

        return reply.send({
          success: true,
          prompt1: generatedPrompt1,
          prompt4: generatedPrompt4,
          message: 'Промпты успешно созданы',
          adAccountId: createdAdAccountId, // Возвращаем ID созданного аккаунта для мультиаккаунтного режима
        });
      } catch (error: any) {
        reqLog.error({
          error: error instanceof Error ? error.message : String(error),
          user_id,
        }, 'Неожиданная ошибка при обработке брифа');

        logErrorToAdmin({
          user_account_id: user_id,
          error_type: 'api',
          raw_error: error.message || String(error),
          stack_trace: error.stack,
          action: 'briefing_generate_prompt',
          endpoint: '/briefing/generate-prompt',
          severity: 'warning'
        }).catch(() => {});

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
      } catch (error: any) {
        reqLog.error({
          error: error instanceof Error ? error.message : String(error),
          user_id,
        }, 'Неожиданная ошибка при получении брифа');

        logErrorToAdmin({
          user_account_id: user_id,
          error_type: 'api',
          raw_error: error.message || String(error),
          stack_trace: error.stack,
          action: 'briefing_get',
          endpoint: '/briefing/:user_id',
          severity: 'warning'
        }).catch(() => {});

        return reply.status(500).send({
          success: false,
          error: 'Внутренняя ошибка сервера',
        });
      }
    }
  );
};

