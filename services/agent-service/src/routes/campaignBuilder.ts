/**
 * Routes для Campaign Builder Agent
 * 
 * Webhook для автоматического запуска рекламы с фронтенда
 */

import { type FastifyRequest, FastifyPluginAsync } from 'fastify';
import { supabase } from '../lib/supabase.js';
import {
  buildCampaignAction,
  convertActionToEnvelope,
  getActiveCampaigns,
  pauseActiveCampaigns,
  getAvailableCreatives,
  getOptimizationGoal,
  getBillingEvent,
  createAdSetInCampaign,
  createAdsInAdSet,
  type CampaignBuilderInput,
  type CampaignObjective,
  pauseAdSetsForCampaign,
} from '../lib/campaignBuilder.js';
import {
  getDirectionSettings,
  buildTargeting,
  getWhatsAppPhoneNumber
} from '../lib/settingsHelpers.js';
import { createLogger } from '../lib/logger.js';
import { resolveFacebookError } from '../lib/facebookErrors.js';
import {
  getAvailableAdSet,
  activateAdSet,
  incrementAdsCount,
  hasAvailableAdSets
} from '../lib/directionAdSets.js';
import { getCredentials } from '../lib/adAccountHelper.js';
import { eventLogger } from '../lib/eventLogger.js';
import { onAdsLaunched } from '../lib/onboardingHelper.js';

const baseLog = createLogger({ module: 'campaignBuilderRoutes' });

function getWorkflowLogger(request: FastifyRequest, workflow: string) {
  const parent = (request?.log as any) ?? baseLog;
  const child = parent.child({ module: 'campaignBuilderRoutes', workflow });
  if (request) {
    (request as any).log = child;
  }
  return child;
}

// ========================================
// REQUEST SCHEMAS
// ========================================

const autoLaunchRequestSchema = {
  type: 'object',
  required: ['objective'],
  properties: {
    user_account_id: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' }, // Алиас для обратной совместимости
    objective: { type: 'string', enum: ['whatsapp', 'instagram_traffic', 'site_leads'] },
    campaign_name: { type: 'string' },
    requested_budget_cents: { type: 'number', minimum: 500 }, // Минимум $5
    additional_context: { type: 'string' },
    auto_activate: { type: 'boolean', default: false },
  },
  anyOf: [
    { required: ['user_account_id'] },
    { required: ['userId'] }
  ]
};

// ========================================
// ROUTES
// ========================================

export const campaignBuilderRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/campaign-builder/auto-launch-v2
   * 
   * Автоматический запуск рекламы для ВСЕХ активных направлений:
   * 1. Находит ВСЕ активные направления пользователя
   * 2. Для каждого направления создаёт ad sets в существующей кампании
   * 3. Использует креативы, бюджет и objective направления
   * 
   * @returns { success: true, results: [...] }
   */
  fastify.post(
    '/auto-launch-v2',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            user_account_id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            account_id: { type: 'string', format: 'uuid' }, // UUID из ad_accounts (для мультиаккаунтности)
          },
          anyOf: [
            { required: ['user_account_id'] },
            { required: ['userId'] }
          ]
        }
      }
    },
    async (request, reply) => {
      const log = getWorkflowLogger(request as FastifyRequest, 'autoLaunchV2');
      const body = request.body as {
        user_account_id?: string;
        userId?: string;
        account_id?: string;
      };

      const user_account_id = body.user_account_id || body.userId;
      const account_id = body.account_id;

      if (!user_account_id) {
        return reply.status(400).send({
          success: false,
          error: 'user_account_id or userId is required',
        });
      }

      log.info({ userAccountId: user_account_id, accountId: account_id }, 'Auto-launch request for all directions');

      try {
        // Получаем credentials (с поддержкой мультиаккаунтности)
        let credentials;
        try {
          credentials = await getCredentials(user_account_id, account_id);
        } catch (credError: any) {
          return reply.status(400).send({
            success: false,
            error: credError.message,
          });
        }

        if (!credentials.fbAccessToken || !credentials.fbAdAccountId) {
          return reply.status(400).send({
            success: false,
            error: 'Missing required Facebook credentials',
          });
        }

        // Находим активные направления (с учётом account_id для мультиаккаунта)
        let directionsQuery = supabase
          .from('account_directions')
          .select('*')
          .eq('user_account_id', user_account_id)
          .eq('is_active', true);

        // Если мультиаккаунт - фильтруем по account_id (UUID FK на ad_accounts.id)
        if (credentials.isMultiAccountMode && account_id) {
          directionsQuery = directionsQuery.eq('account_id', account_id);
        }

        const { data: directions, error: directionsError } = await directionsQuery;

        if (directionsError) {
          log.error({ err: directionsError, userAccountId: user_account_id }, 'Failed to fetch directions');
          return reply.status(500).send({
            success: false,
            error: 'Failed to fetch directions',
          });
        }

        const activeDirections = directions || [];

        if (activeDirections.length === 0) {
          log.warn({ userAccountId: user_account_id, accountId: account_id }, 'No active directions found');
          return reply.status(400).send({
            success: false,
            error: 'No active directions found',
            hint: credentials.isMultiAccountMode
              ? 'Create a direction for this ad account first'
              : 'Create a direction first or check that directions are active',
          });
        }

        log.info({ userAccountId: user_account_id, directionCount: activeDirections.length }, 'Found active directions');

        // ===================================================
        // STEP 2: Пауза активных ad set'ов направлений (игнорируем тестовые кампании)
        // ===================================================
        log.info({ userAccountId: user_account_id }, 'Pausing active ad sets for directions...');

        try {
          const activeCampaigns = await getActiveCampaigns(
            credentials.fbAdAccountId!,
            credentials.fbAccessToken!
          );

          const directionCampaigns = activeDirections
            .map((direction: any) => direction.fb_campaign_id)
            .filter((campaignId: string | null) => Boolean(campaignId));

          const campaignIdsForDirections = new Set(directionCampaigns);

          const campaignIdsToPause = activeCampaigns
            .filter((campaign: any) => campaignIdsForDirections.has(campaign.campaign_id))
            .map((campaign: any) => campaign.campaign_id);

          if (campaignIdsToPause.length > 0) {
            log.info({ count: campaignIdsToPause.length }, 'Found campaigns with ad sets to pause');
            for (const campaignId of campaignIdsToPause) {
              try {
                await pauseAdSetsForCampaign(campaignId, credentials.fbAccessToken!);
                log.info({ campaignId }, 'Paused ad sets for campaign');
              } catch (pauseError: any) {
                log.warn({ campaignId, err: pauseError }, 'Failed to pause ad sets for campaign');
              }
            }
          } else {
            log.info('No campaigns found for pausing');
          }
        } catch (error: any) {
          log.error({ err: error, userAccountId: user_account_id, adAccountName: credentials.adAccountName }, 'Error pausing ad sets');
        }

        const results: any[] = [];

        // Обрабатываем каждое направление
        for (const direction of activeDirections) {
          log.info({
            directionId: direction.id,
            directionName: direction.name,
            objective: direction.objective,
            userAccountId: user_account_id,
            adAccountName: credentials.adAccountName
          }, 'Processing direction');

          // Получаем креативы для этого направления (используем objective направления)
          const creatives = await getAvailableCreatives(user_account_id, direction.objective, direction.id, account_id);

          if (creatives.length === 0) {
            log.warn({ directionId: direction.id, directionName: direction.name }, 'No creatives for direction');
            results.push({
              direction_id: direction.id,
              direction_name: direction.name,
              skipped: true,
              reason: 'No ready creatives for this direction',
            });
            continue;
          }

          log.info({ directionId: direction.id, creativeCount: creatives.length }, 'Found creatives for direction');

          // ===================================================
          // ПОПЫТКА 1: LLM ПОДХОД (primary)
          // ===================================================
          let llmSuccess = false;
          try {
            log.info({ 
              directionId: direction.id, 
              mode: 'llm_primary' 
            }, 'Attempting LLM-based launch');

            // Вызываем AI для анализа и выбора креативов
            const action = await buildCampaignAction({
              user_account_id,
              direction_id: direction.id,
              objective: direction.objective,
              campaign_name: direction.name,
              requested_budget_cents: direction.daily_budget_cents,
            });

            // ВСЕГДА включаем adsets - игнорируем что вернула LLM
            action.params.auto_activate = true;

            log.info({ 
              directionId: direction.id,
              action: action.type,
              creativesSelected: action.params.user_creative_ids?.length,
              reasoning: action.reasoning,
              auto_activate: true // ВСЕГДА true
            }, 'LLM selected creatives for direction');

            // Выполняем action через систему actions
            const envelope = {
              idempotencyKey: `ai-autolaunch-v2-${direction.id}-${Date.now()}`,
              account: {
                userAccountId: user_account_id,
                accessToken: credentials.fbAccessToken,
                adAccountId: credentials.fbAdAccountId,
                ...(credentials.whatsappPhoneNumber && { whatsappPhoneNumber: credentials.whatsappPhoneNumber }),
              },
              actions: [action],
              source: 'ai-campaign-builder-v2',
            };

            const actionsResponse = await request.server.inject({
              method: 'POST',
              url: '/agent/actions',
              payload: envelope,
            });

            if (actionsResponse.statusCode === 202) {
              const executionResult = JSON.parse(actionsResponse.body);

              // Получаем результат выполнения action из БД
              let actionResult: any = null;
              if (executionResult.executionId && executionResult.executionId !== 'no-actions-needed') {
                const { data: actionData } = await supabase
                  .from('agent_actions')
                  .select('result_json')
                  .eq('execution_id', executionResult.executionId)
                  .eq('action_idx', 0)
                  .single();
                actionResult = actionData?.result_json;
              }

              // Формируем результат с данными adsets для UI
              const resultEntry: any = {
                direction_id: direction.id,
                direction_name: direction.name,
                campaign_id: direction.fb_campaign_id,
                success: true,
                mode: 'llm',
                action: action.type,
                creatives_count: action.params.user_creative_ids?.length,
                reasoning: action.reasoning,
                execution_id: executionResult.executionId,
                status: 'success',
              };

              // Добавляем данные из результата action для отображения в UI
              if (actionResult) {
                if (actionResult.adsets && Array.isArray(actionResult.adsets)) {
                  // Direction.CreateMultipleAdSets - берём первый adset для отображения
                  const firstAdset = actionResult.adsets[0];
                  if (firstAdset) {
                    resultEntry.adset_id = firstAdset.adset_id;
                    resultEntry.adset_name = firstAdset.adset_name;
                    resultEntry.ads_created = actionResult.total_ads || firstAdset.ads_created;
                    resultEntry.ads = firstAdset.ads || [];
                  }
                  resultEntry.total_adsets = actionResult.total_adsets;
                  resultEntry.all_adsets = actionResult.adsets;
                } else if (actionResult.adset_id) {
                  // Одиночный adset
                  resultEntry.adset_id = actionResult.adset_id;
                  resultEntry.adset_name = actionResult.adset_name;
                  resultEntry.ads_created = actionResult.ads_created;
                  resultEntry.ads = actionResult.ads || [];
                }
              }

              results.push(resultEntry);

              // Log business event for analytics
              await eventLogger.logBusinessEvent(
                user_account_id,
                'creative_launched',
                {
                  directionId: direction.id,
                  directionName: direction.name,
                  executionId: executionResult.executionId,
                  creativesCount: action.params.user_creative_ids?.length,
                  mode: 'llm'
                },
                account_id
              );

              // Обновляем этап онбординга
              onAdsLaunched(user_account_id).catch(err => {
                log.warn({ err, userId: user_account_id }, 'Failed to update onboarding stage');
              });

              llmSuccess = true;
              log.info({
                directionId: direction.id,
                executionId: executionResult.executionId,
                actionResult: actionResult ? 'loaded' : 'not found'
              }, 'LLM launch successful');
            } else {
              log.error({
                statusCode: actionsResponse.statusCode,
                body: actionsResponse.body,
                action: action.type,
                directionId: direction.id
              }, 'Actions API error - full response');
              throw new Error(`Actions API returned ${actionsResponse.statusCode}: ${actionsResponse.body}`);
            }
          } catch (llmError: any) {
            log.warn({ 
              err: llmError, 
              directionId: direction.id,
              message: llmError.message 
            }, 'LLM launch failed, falling back to deterministic approach');
          }

          // ===================================================
          // ПОПЫТКА 2: ДЕТЕРМИНИСТИЧЕСКИЙ ПОДХОД (fallback)
          // ===================================================
          if (!llmSuccess) {
            log.info({ 
              directionId: direction.id, 
              mode: 'deterministic_fallback' 
            }, 'Using deterministic approach');

            try {
            // Получаем дефолтные настройки направления
            const defaultSettings = await getDirectionSettings(direction.id);
            log.info({
              directionId: direction.id,
              hasDefaultSettings: Boolean(defaultSettings),
              userAccountId: user_account_id,
              adAccountName: credentials.adAccountName
            }, 'Default settings status');

            // Строим таргетинг (используем objective направления)
            const targeting = buildTargeting(defaultSettings, direction.objective);

            // Получаем optimization_goal и billing_event (используем objective направления)
            const optimization_goal = getOptimizationGoal(direction.objective);
            const billing_event = getBillingEvent(direction.objective);

            // Формируем promoted_object в зависимости от objective направления
            let promoted_object;

            if (direction.objective === 'whatsapp') {
              // Всегда включаем номер из направления (если есть)
              // Если получим ошибку 2446885, createAdSetInCampaign автоматически повторит без номера
              const whatsapp_phone_number = await getWhatsAppPhoneNumber(direction, user_account_id, supabase) || undefined;
              promoted_object = {
                page_id: credentials.fbPageId,
                ...(whatsapp_phone_number && { whatsapp_phone_number })
              };
            } else if (direction.objective === 'instagram_traffic') {
              // Для Instagram ТОЛЬКО page_id (как в рабочем n8n workflow)
              // Ссылка уже в креативе в call_to_action
              promoted_object = {
                page_id: credentials.fbPageId
              };
            } else if (direction.objective === 'site_leads') {
              // Для site_leads (OFFSITE_CONVERSIONS) promoted_object содержит pixel_id и custom_event_type
              // link НЕ нужен в promoted_object — он уже в креативе
              promoted_object = {
                ...(defaultSettings?.pixel_id && { pixel_id: defaultSettings.pixel_id }),
                custom_event_type: 'LEAD'
              };
            }

            // Создаём Ad Set в существующей кампании или используем pre-created
            let adsetId: string;

            if (credentials.defaultAdsetMode === 'use_existing') {
              // РЕЖИМ: использовать pre-created ad set
              const hasAvailable = await hasAvailableAdSets(direction.id);
              
              if (!hasAvailable) {
                log.warn({
                  directionId: direction.id,
                  directionName: direction.name
                }, 'No available pre-created ad sets; skipping direction in auto-launch');
                
                results.push({
                  direction_id: direction.id,
                  direction_name: direction.name,
                  skipped: true,
                  reason: 'No available pre-created ad sets'
                });
                continue;
              }

              // Получить доступный ad set
              const availableAdSet = await getAvailableAdSet(direction.id);
              
              if (!availableAdSet) {
                log.warn({ directionId: direction.id }, 'No ad set available (race condition?)');
                results.push({
                  direction_id: direction.id,
                  direction_name: direction.name,
                  skipped: true,
                  reason: 'No ad set available (race condition)'
                });
                continue;
              }

              // Активировать
              await activateAdSet(
                availableAdSet.id,
                availableAdSet.fb_adset_id,
                credentials.fbAccessToken!
              );

              adsetId = availableAdSet.fb_adset_id;

              log.info({
                directionId: direction.id,
                adsetId,
                mode: 'use_existing',
                userAccountId: user_account_id,
                adAccountName: credentials.adAccountName
              }, 'Using pre-created ad set in auto-launch');

            } else {
              // РЕЖИМ: создать новый ad set через API
              const adset = await createAdSetInCampaign({
                campaignId: direction.fb_campaign_id,
                adAccountId: credentials.fbAdAccountId!,
                accessToken: credentials.fbAccessToken!,
                name: `${direction.name} - ${new Date().toISOString().split('T')[0]}`,
                dailyBudget: direction.daily_budget_cents,
                targeting,
                optimization_goal,
                billing_event,
                promoted_object,
                start_mode: (request.body as any)?.start_mode || 'midnight_almaty',
              });

              adsetId = adset.id;

              log.info({
                directionId: direction.id,
                adsetId,
                mode: 'api_create',
                userAccountId: user_account_id,
                adAccountName: credentials.adAccountName
              }, 'Ad set created for direction');
            }

            // Создаём Ads с креативами (максимум 5)
            const creativesToUse = creatives.slice(0, 5);
            const ads = await createAdsInAdSet({
              adsetId,
              adAccountId: credentials.fbAdAccountId!,
              creatives: creativesToUse,
              accessToken: credentials.fbAccessToken!,
              objective: direction.objective, // Используем objective направления
              userId: user_account_id,
              directionId: direction.id,
              campaignId: direction.fb_campaign_id,
            });

            log.info({ directionId: direction.id, adsetId, adsCount: ads.length, userAccountId: user_account_id }, 'Ads created for direction');

            // Log business event for analytics
            await eventLogger.logBusinessEvent(
              user_account_id,
              'creative_launched',
              {
                directionId: direction.id,
                directionName: direction.name,
                adsetId,
                adsCount: ads.length,
                mode: 'deterministic'
              },
              account_id
            );

            // Обновляем этап онбординга
            onAdsLaunched(user_account_id).catch(err => {
              log.warn({ err, userId: user_account_id }, 'Failed to update onboarding stage');
            });

            // Инкрементировать счетчик для use_existing режима
            if (credentials.defaultAdsetMode === 'use_existing') {
              const newCount = await incrementAdsCount(adsetId, ads.length);
              log.info({
                directionId: direction.id,
                adsetId,
                adsAdded: ads.length,
                newAdsCount: newCount
              }, 'Incremented ads count for pre-created ad set in auto-launch');
            }

            results.push({
              direction_id: direction.id,
              direction_name: direction.name,
              campaign_id: direction.fb_campaign_id,
              adset_id: adsetId,
              adset_name: `${direction.name} - Ad Set`,
              daily_budget_cents: direction.daily_budget_cents,
              ads_created: ads.length,
              ads: ads, // Массив созданных объявлений с деталями
              creatives_used: creativesToUse.map(c => c.user_creative_id),
              mode: 'deterministic',
              status: 'success',
            });
          } catch (error: any) {
            const resolution = error?.fb ? resolveFacebookError(error.fb) : undefined;
            log.error({ err: error, directionId: direction.id, directionName: direction.name, resolution }, 'Failed to create ad set for direction');
            
            // Парсим ошибку Facebook API для более понятного сообщения
            let errorMessage = error.message;
            let errorDetails = null;
            
            if (error.message && error.message.includes('locations that are currently restricted')) {
              errorMessage = 'Выбранные гео-локации заблокированы для вашего рекламного аккаунта';
              errorDetails = 'Проверьте настройки таргетинга в разделе "Настройки рекламы" для этого направления';
            } else if (error.message && error.message.includes('Invalid parameter')) {
              errorMessage = 'Некорректные параметры таргетинга';
              errorDetails = error.message;
            } else if (error.message && error.message.includes('Unauthorized')) {
              errorMessage = 'Ошибка авторизации Facebook';
              errorDetails = 'Проверьте токен доступа в настройках аккаунта';
            }
            
            results.push({
              direction_id: direction.id,
              direction_name: direction.name,
              campaign_id: direction.fb_campaign_id,
              error: errorMessage,
              error_details: errorDetails,
              mode: 'deterministic',
              status: 'failed',
            });
          }
          } // закрываем проверку !llmSuccess
        }

        // ===================================================
        // STEP 3: Возвращаем результаты
        // ===================================================
        log.info({ userAccountId: user_account_id, totalDirections: results.length }, 'Auto-launch-v2 completed');

        return reply.send({
          success: true,
          message: `Processed ${results.length} direction(s)`,
          results,
        });
      } catch (error: any) {
        log.error({ err: error, userAccountId: user_account_id }, 'Unexpected error in auto-launch-v2');
        return reply.status(500).send({
          success: false,
          error: error.message || 'Internal server error',
        });
      }
    }
  );

  /**
   * POST /api/campaign-builder/manual-launch
   * 
   * Ручной запуск рекламы с выбранными креативами и настройками:
   * 1. Пользователь выбирает направление
   * 2. Пользователь выбирает креативы (один или несколько)
   * 3. Опционально переопределяет настройки (бюджет, таргетинг)
   * 4. Система создает Ad Set в существующей Campaign направления
   * 
   * @body {
   *   user_account_id: string,
   *   direction_id: string,
   *   creative_ids: string[],  // Массив ID креативов из user_creatives
   *   daily_budget_cents?: number,  // Опционально, иначе из направления
   *   targeting?: object  // Опционально, иначе из default_ad_settings
   * }
   * @returns { success: true, adset_id, ads_created, ads: [...] }
   */
  fastify.post(
    '/manual-launch',
    {
      schema: {
        body: {
          type: 'object',
          required: ['user_account_id', 'direction_id', 'creative_ids'],
          properties: {
            user_account_id: { type: 'string', format: 'uuid' },
            account_id: { type: 'string', format: 'uuid' }, // UUID из ad_accounts (для мультиаккаунтности)
            direction_id: { type: 'string', format: 'uuid' },
            creative_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1 },
            daily_budget_cents: { type: 'number', minimum: 500 },
            targeting: { type: 'object' },
            start_mode: { type: 'string', enum: ['now', 'midnight_almaty'] },
          },
        },
      },
    },
    async (request: any, reply: any) => {
      const log = getWorkflowLogger(request as FastifyRequest, 'manualLaunch');
      const { user_account_id, account_id, direction_id, creative_ids, daily_budget_cents, targeting, start_mode } = request.body;

      log.info({
        userAccountId: user_account_id,
        accountId: account_id,
        directionId: direction_id,
      }, 'Manual launch request');

      try {
        // Получаем credentials (с поддержкой мультиаккаунтности)
        let credentials;
        try {
          credentials = await getCredentials(user_account_id, account_id);
        } catch (credError: any) {
          return reply.status(400).send({
            success: false,
            error: credError.message,
          });
        }

        if (!credentials.fbAccessToken || !credentials.fbAdAccountId || !credentials.fbPageId) {
          return reply.status(400).send({
            success: false,
            error: 'Missing required Facebook credentials (access_token, ad_account_id, or page_id)',
          });
        }

        // Получаем направление
        const { data: direction, error: directionError } = await supabase
          .from('account_directions')
          .select('*')
          .eq('id', direction_id)
          .eq('user_account_id', user_account_id)
          .eq('is_active', true)
          .single();

        if (directionError || !direction) {
          return reply.status(404).send({
            success: false,
            error: 'Direction not found or inactive',
          });
        }

        // Проверяем, что у направления есть fb_campaign_id
        if (!direction.fb_campaign_id) {
          return reply.status(400).send({
            success: false,
            error: 'Direction does not have associated Facebook Campaign',
          });
        }

        // Получаем выбранные креативы
        const { data: creatives, error: creativesError } = await supabase
          .from('user_creatives')
          .select('*')
          .in('id', creative_ids)
          .eq('user_id', user_account_id)
          .eq('direction_id', direction_id)
          .eq('is_active', true)
          .eq('status', 'ready');

        if (creativesError || !creatives || creatives.length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'No valid creatives found',
          });
        }

        if (creatives.length !== creative_ids.length) {
          log.warn({ missingCreatives: creative_ids.length - creatives.length }, 'Some creatives not found or inactive');
        }

        log.info({ creativeCount: creatives.length }, 'Found creatives for manual launch');

        // Получаем дефолтные настройки направления (если не переопределены)
        const defaultSettings = await getDirectionSettings(direction_id);
        const finalBudget = daily_budget_cents || direction.daily_budget_cents;
        const finalTargeting = targeting || buildTargeting(defaultSettings, direction.objective);

        // Получаем optimization_goal и billing_event
        const optimization_goal = getOptimizationGoal(direction.objective);
        const billing_event = getBillingEvent(direction.objective);

        // Формируем promoted_object
        let promoted_object;
        if (direction.objective === 'whatsapp') {
          // Всегда включаем номер из направления (если есть)
          // Если получим ошибку 2446885, createAdSetInCampaign автоматически повторит без номера
          const whatsapp_phone_number = await getWhatsAppPhoneNumber(direction, user_account_id, supabase) || credentials.whatsappPhoneNumber || undefined;
          promoted_object = {
            page_id: credentials.fbPageId,
            ...(whatsapp_phone_number && { whatsapp_phone_number })
          };
        } else if (direction.objective === 'instagram_traffic') {
          // Для Instagram ТОЛЬКО page_id (как в рабочем n8n workflow)
          // Ссылка уже в креативе в call_to_action
          promoted_object = {
            page_id: credentials.fbPageId
          };
        } else if (direction.objective === 'site_leads') {
          // Для Site Leads используем pixel_id и custom_event_type (как в n8n)
          // link НЕ добавляем - это вызывает ошибку "Invalid keys \"link\""
          if (direction.pixel_id || defaultSettings?.pixel_id) {
            promoted_object = {
              pixel_id: String(direction.pixel_id || defaultSettings.pixel_id),
              custom_event_type: 'LEAD'
            };
          } else {
            promoted_object = {
              custom_event_type: 'LEAD'
            };
          }
        }

        // Создаём Ad Set или используем pre-created
        let adsetId: string;

        if (credentials.defaultAdsetMode === 'use_existing') {
          // РЕЖИМ: использовать pre-created ad set
          const availableAdSet = await getAvailableAdSet(direction.id);

          if (!availableAdSet) {
            log.warn({
              directionId: direction.id,
              directionName: direction.name,
              userAccountId: user_account_id
            }, 'No available pre-created ad sets for manual launch');

            return reply.status(400).send({
              success: false,
              error: 'No available pre-created ad sets',
              message: 'Please create ad sets in Facebook Ads Manager and link them to this direction in settings.',
            });
          }

          // Активировать
          await activateAdSet(
            availableAdSet.id,
            availableAdSet.fb_adset_id,
            credentials.fbAccessToken!
          );

          adsetId = availableAdSet.fb_adset_id;

          log.info({
            adsetId,
            mode: 'use_existing',
            directionId: direction.id
          }, 'Using pre-created ad set for manual launch');

        } else {
          // РЕЖИМ: создать новый ad set через API
          const adset = await createAdSetInCampaign({
            campaignId: direction.fb_campaign_id,
            adAccountId: credentials.fbAdAccountId!,
            accessToken: credentials.fbAccessToken!,
            name: `${direction.name} - Ручной запуск - ${new Date().toISOString().split('T')[0]}`,
            dailyBudget: finalBudget,
            targeting: finalTargeting,
            optimization_goal,
            billing_event,
            promoted_object,
            start_mode: start_mode || 'now', // Используем переданный режим или "Сейчас" по умолчанию
          });

          adsetId = adset.id;

          log.info({
            adsetId,
            mode: 'api_create',
            start_mode: start_mode || 'now'
          }, 'Manual launch ad set created');
        }

        // Создаём Ads с выбранными креативами
        const creativesForAds = creatives.map(c => ({
          user_creative_id: c.id,
          title: c.title,
          fb_creative_id_whatsapp: c.fb_creative_id_whatsapp,
          fb_creative_id_instagram_traffic: c.fb_creative_id_instagram_traffic,
          fb_creative_id_site_leads: c.fb_creative_id_site_leads,
          created_at: c.created_at,
        }));

        const ads = await createAdsInAdSet({
          adsetId,
          adAccountId: credentials.fbAdAccountId!,
          creatives: creativesForAds,
          accessToken: credentials.fbAccessToken!,
          objective: direction.objective,
          userId: user_account_id,
          directionId: direction.id,
          campaignId: direction.fb_campaign_id,
        });

        log.info({ adsCount: ads.length }, 'Manual launch ads created');

        // Log business event for analytics
        await eventLogger.logBusinessEvent(
          user_account_id,
          'creative_launched',
          {
            directionId: direction.id,
            directionName: direction.name,
            adsetId,
            adsCount: ads.length,
            mode: 'manual'
          },
          account_id
        );

        // Обновляем этап онбординга
        onAdsLaunched(user_account_id).catch(err => {
          log.warn({ err, userId: user_account_id }, 'Failed to update onboarding stage');
        });

        // Инкрементировать счетчик для use_existing режима
        if (credentials.defaultAdsetMode === 'use_existing') {
          const newCount = await incrementAdsCount(adsetId, ads.length);
          log.info({
            adsetId,
            adsAdded: ads.length,
            newAdsCount: newCount
          }, 'Incremented ads count for pre-created ad set in manual launch');
        }

        return reply.send({
          success: true,
          message: `Реклама запущена: создано ${ads.length} объявлений`,
          direction_id: direction.id,
          direction_name: direction.name,
          campaign_id: direction.fb_campaign_id,
          adset_id: adsetId,
          adset_name: `${direction.name} - Ad Set`,
          ads_created: ads.length,
          ads: ads.map(ad => ({
            ad_id: ad.ad_id,
            name: ad.name,
          })),
        });
      } catch (error: any) {
        log.error({ err: error, userAccountId: request.body?.user_account_id }, 'Manual launch failed');
        
        // Парсим ошибку для понятного сообщения
        let errorMessage = error.message;
        if (error.message && error.message.includes('locations that are currently restricted')) {
          errorMessage = 'Выбранные гео-локации заблокированы для вашего рекламного аккаунта';
        } else if (error.message && error.message.includes('Invalid parameter')) {
          errorMessage = 'Некорректные параметры таргетинга или настроек';
        }
        
        return reply.status(500).send({
          success: false,
          error: errorMessage,
          error_details: error.message,
        });
      }
    }
  );

  /**
   * POST /api/campaign-builder/auto-launch (LEGACY)
   * 
   * Автоматический запуск рекламной кампании:
   * 1. LLM анализирует доступные креативы с их скорингом
   * 2. Формирует оптимальный план кампании
   * 3. Создает кампанию с выбранными креативами
   * 
   * @returns { success: true, campaign_id, adset_id, ads, plan }
   */
  fastify.post(
    '/auto-launch',
    {
      schema: {
        body: autoLaunchRequestSchema,
      },
    },
    async (request, reply) => {
      const log = getWorkflowLogger(request as FastifyRequest, 'legacyAutoLaunch');
      const body = request.body as {
        user_account_id?: string;
        userId?: string; // Алиас для обратной совместимости
        objective: CampaignObjective;
        campaign_name?: string;
        requested_budget_cents?: number;
        additional_context?: string;
        auto_activate?: boolean;
      };

      // Поддержка обоих вариантов: user_account_id и userId
      const user_account_id = body.user_account_id || body.userId;
      
      if (!user_account_id) {
        return reply.status(400).send({
          success: false,
          error: 'user_account_id or userId is required',
        });
      }

      const { objective, campaign_name, requested_budget_cents, additional_context, auto_activate } = body;

      log.info({
        userAccountId: user_account_id,
        objective,
        campaign_name,
        requested_budget_cents,
      }, 'Campaign Builder API auto-launch request');

      try {
        // ===================================================
        // STEP 1: Получаем данные пользователя
        // ===================================================
        const { data: userAccount, error: userError } = await supabase
          .from('user_accounts')
          .select('*')
          .eq('id', user_account_id)
          .single();

        if (userError || !userAccount) {
          return reply.status(404).send({
            success: false,
            error: 'User account not found',
          });
        }

        // Проверяем, что пользователь НЕ в мультиаккаунт режиме
        // Для мультиаккаунта используйте auto-launch-v2
        if (userAccount.multi_account_enabled) {
          return reply.status(400).send({
            success: false,
            error: 'Legacy auto-launch is not supported for multi-account mode. Use /campaign-builder/auto-launch-v2 with ad_account_id instead.',
          });
        }

        if (!userAccount.access_token) {
          return reply.status(400).send({
            success: false,
            error: 'User has no Facebook access token',
          });
        }

        // ===================================================
        // STEP 2: Пауза активных ad set'ов направлений (игнорируем тестовые кампании)
        // ===================================================
        log.info({ userAccountId: userAccount.id }, 'Pausing active ad sets for directions...');

        try {
          // Получаем все активные направления пользователя
          const { data: activeDirections, error: directionsError } = await supabase
            .from('account_directions')
            .select('*')
            .eq('user_account_id', user_account_id)
            .eq('is_active', true);

          if (directionsError) {
            log.error({ err: directionsError, userAccountId: user_account_id }, 'Failed to fetch active directions for pausing');
            // Продолжаем, даже если не удалось получить направления, чтобы не блокировать автозапуск
          }

          const activeCampaigns = await getActiveCampaigns(
            userAccount.ad_account_id,
            userAccount.access_token
          );

          const directionCampaignIds = (activeDirections || [])
            .map((direction: any) => direction.fb_campaign_id)
            .filter((campaignId: string | null) => Boolean(campaignId));

          const campaignIdsForDirections = new Set(directionCampaignIds);

          const campaignIdsToPause = activeCampaigns
            .filter((campaign: any) => campaignIdsForDirections.has(campaign.campaign_id))
            .map((campaign: any) => campaign.campaign_id);

          if (campaignIdsToPause.length > 0) {
            log.info({ count: campaignIdsToPause.length }, 'Found campaigns with ad sets to pause');
            for (const campaignId of campaignIdsToPause) {
              try {
                await pauseAdSetsForCampaign(campaignId, userAccount.access_token);
                log.info({ campaignId }, 'Paused ad sets for campaign');
              } catch (pauseError: any) {
                log.warn({ campaignId, err: pauseError }, 'Failed to pause ad sets for campaign');
              }
            }
          } else {
            log.info('No campaigns found for pausing');
          }
        } catch (error: any) {
          log.error({ err: error, userAccountId: userAccount.id, userAccountName: userAccount.username }, 'Error pausing ad sets');
        }

        // ===================================================
        // STEP 3: Определяем режим работы
        // ===================================================

        // Проверяем есть ли активные направления
        const { data: activeDirections } = await supabase
          .from('account_directions')
          .select('*')
          .eq('user_account_id', user_account_id)
          .eq('is_active', true)
          .eq('objective', objective);

        const hasDirections = activeDirections && activeDirections.length > 0;

        if (hasDirections) {
          // НОВЫЙ РЕЖИМ: Работа с directions
          log.info({ 
            directionCount: activeDirections.length,
            mode: 'directions' 
          }, 'Using directions mode');

          const results = [];

          for (const direction of activeDirections) {
            log.info({
              directionId: direction.id,
              directionName: direction.name,
              objective: direction.objective,
            }, 'Processing direction with AI');

            try {
              // Запускаем AI для каждого направления
              const action = await buildCampaignAction({
                user_account_id,
                direction_id: direction.id,
                objective: direction.objective,
                campaign_name: direction.name,
                requested_budget_cents: direction.daily_budget_cents,
              });

              action.params.auto_activate = auto_activate || false;

              log.info({ 
                directionId: direction.id,
                action: action.type,
                creativesSelected: action.params.user_creative_ids?.length 
              }, 'AI selected creatives for direction');

              // Выполняем action
              const envelope = {
                idempotencyKey: `ai-autolaunch-${direction.id}-${Date.now()}`,
                account: {
                  userAccountId: user_account_id,
                  accessToken: userAccount.access_token,
                  adAccountId: userAccount.ad_account_id,
                  whatsappPhoneNumber: userAccount.whatsapp_phone_number,
                },
                actions: [action],
                source: 'ai-campaign-builder',
              };

              const actionsResponse = await request.server.inject({
                method: 'POST',
                url: '/agent/actions',
                payload: envelope,
              });

              if (actionsResponse.statusCode === 202) {
                const executionResult = JSON.parse(actionsResponse.body);
                results.push({
                  direction_id: direction.id,
                  direction_name: direction.name,
                  success: true,
                  action: action.type,
                  creatives_count: action.params.user_creative_ids?.length,
                  reasoning: action.reasoning,
                  execution_id: executionResult.executionId,
                });
              } else {
                throw new Error(`Failed to execute: ${actionsResponse.statusCode}`);
              }
            } catch (error: any) {
              log.error({ 
                err: error, 
                directionId: direction.id 
              }, 'Failed to process direction');
              
              results.push({
                direction_id: direction.id,
                direction_name: direction.name,
                success: false,
                error: error.message,
              });
            }
          }

          return reply.send({
            success: true,
            mode: 'directions',
            results,
          });
        } else {
          // LEGACY РЕЖИМ: Без directions (старая логика)
          log.info({ mode: 'legacy' }, 'Using legacy mode without directions');

          const input: CampaignBuilderInput = {
            user_account_id,
            objective,
            campaign_name,
            requested_budget_cents,
            additional_context,
          };

          let action;
          try {
            action = await buildCampaignAction(input);
            action.params.auto_activate = auto_activate || false;
          } catch (error: any) {
            log.error({ err: error }, 'Failed to build campaign action');
            return reply.status(400).send({
              success: false,
              error: error.message || 'Failed to build campaign action',
              stage: 'planning',
            });
          }

          log.info({ action }, 'Action created from LLM');

        // ===================================================
        // STEP 4: Выполняем action через систему actions
        // ===================================================
        log.info({ userAccountId: userAccount.id }, 'Executing action through actions system...');

        const envelope = convertActionToEnvelope(action, user_account_id, objective, userAccount.whatsapp_phone_number) as any;
        // Добавляем accessToken и adAccountId для корректной работы actions API
        envelope.account.accessToken = userAccount.access_token;
        envelope.account.adAccountId = userAccount.ad_account_id;

        // Вызываем POST /agent/actions через внутренний механизм
        let executionResult;
        try {
          const actionsResponse = await request.server.inject({
            method: 'POST',
            url: '/agent/actions',
            payload: envelope,
          });

          if (actionsResponse.statusCode !== 202) {
            throw new Error(`Actions API returned ${actionsResponse.statusCode}: ${actionsResponse.body}`);
          }

          executionResult = JSON.parse(actionsResponse.body);
          log.info({ executionResult }, 'Action executed successfully');
        } catch (error: any) {
          log.error({ err: error, userAccountId: userAccount.id, userAccountName: userAccount.username }, 'Failed to execute action');
          return reply.status(500).send({
            success: false,
            error: error.message || 'Failed to execute action',
            stage: 'execution',
            action, // Возвращаем action, чтобы пользователь видел что хотели создать
          });
        }

        // ===================================================
        // STEP 5: Получаем результат выполнения из БД
        // ===================================================
        const executionId = executionResult.executionId;
        
        // Ждем пока execution запишется в БД (может занять время из-за Facebook API)
        let execution;
        let attempts = 0;
        const maxAttempts = 20; // 20 секунд максимум
        
        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const { data } = await supabase
            .from('agent_executions')
            .select('response_json, status')
            .eq('id', executionId)
            .single();
          
          if (data?.response_json && data.response_json.length > 0) {
            execution = data;
            break;
          }
          
          if (data?.status === 'completed' || data?.status === 'failed') {
            execution = data;
            break;
          }
          
          attempts++;
        }

        log.info({
          campaignId: executionResult.campaign_id,
          adsetId: executionResult.adset_id,
          adsCreated: executionResult.ads?.length,
        }, 'Execution result summary');

        const campaignResult = execution?.response_json?.[0] || {};

        log.info({
          campaignId: executionResult.campaign_id,
          name: executionResult.action?.campaign_name,
          status: executionResult.status,
        }, 'Campaign created');

        // ===================================================
        // STEP 6: Возвращаем результат
        // ===================================================
        return reply.send({
          success: true,
          execution_id: executionId,
          campaign_id: campaignResult.campaign_id,
          adset_id: campaignResult.adset_id,
          ads: campaignResult.ads,
          action: {
            type: action.type,
            campaign_name: action.params.campaign_name,
            objective: action.params.objective,
            daily_budget_cents: action.params.daily_budget_cents,
            daily_budget_usd: action.params.daily_budget_cents ? action.params.daily_budget_cents / 100 : undefined,
            selected_creatives: action.params.user_creative_ids,
            adsets_count: action.params.adsets?.length,
            reasoning: action.reasoning,
            estimated_cpl: action.estimated_cpl,
            confidence: action.confidence,
          },
          status: auto_activate ? 'ACTIVE' : 'PAUSED',
          message: campaignResult.message || `Campaign created successfully`,
        });
        }
      } catch (error: any) {
        log.error({ err: error, userAccountId: user_account_id }, 'Unexpected error in auto-launch API');
        return reply.status(500).send({
          success: false,
          error: error.message || 'Internal server error',
          stage: 'unknown',
        });
      }
    }
  );

  /**
   * POST /api/campaign-builder/preview
   * 
   * Предпросмотр плана кампании БЕЗ создания
   * Полезно для фронтенда, чтобы показать пользователю что будет создано
   * 
   * @returns { plan, available_creatives, budget_constraints }
   */
  fastify.post(
    '/preview',
    {
      schema: {
        body: autoLaunchRequestSchema,
      },
    },
    async (request, reply) => {
      const log = getWorkflowLogger(request as FastifyRequest, 'preview');
      const body = request.body as CampaignBuilderInput;

      log.info({
        userAccountId: body.user_account_id,
        objective: body.objective,
      }, 'Preview request');

      try {
        const action = await buildCampaignAction(body);

        return reply.send({
          success: true,
          action: {
            type: action.type,
            campaign_name: action.params.campaign_name,
            objective: action.params.objective,
            daily_budget_cents: action.params.daily_budget_cents,
            daily_budget_usd: action.params.daily_budget_cents ? action.params.daily_budget_cents / 100 : undefined,
            selected_creatives: action.params.user_creative_ids,
            adsets_count: action.params.adsets?.length,
            reasoning: action.reasoning,
            estimated_cpl: action.estimated_cpl,
            confidence: action.confidence,
          },
        });
      } catch (error: any) {
        log.error({ err: error, userAccountId: body.user_account_id }, 'Preview error');
        return reply.status(400).send({
          success: false,
          error: error.message || 'Failed to generate preview',
        });
      }
    }
  );

  /**
   * GET /api/campaign-builder/available-creatives
   * 
   * Получить список доступных креативов с их скорингом
   * Полезно для фронтенда, чтобы показать пользователю что доступно
   * 
   * @query user_account_id - UUID пользователя
   * @query objective - whatsapp|instagram_traffic|site_leads (optional)
   */
  fastify.get('/available-creatives', async (request, reply) => {
    const log = getWorkflowLogger(request as FastifyRequest, 'availableCreatives');
    const { user_account_id, objective, account_id } = request.query as {
      user_account_id?: string;
      objective?: CampaignObjective;
      account_id?: string;
    };

    if (!user_account_id) {
      return reply.status(400).send({
        success: false,
        error: 'user_account_id is required',
      });
    }

    try {
      const { getAvailableCreatives } = await import('../lib/campaignBuilder.js');
      const creatives = await getAvailableCreatives(user_account_id, objective, undefined, account_id);

      return reply.send({
        success: true,
        creatives,
        count: creatives.length,
      });
    } catch (error: any) {
      log.error({ err: error, userAccountId: user_account_id }, 'Error fetching creatives for preview');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to fetch creatives',
      });
    }
  });

  /**
   * GET /api/campaign-builder/budget-constraints
   * 
   * Получить бюджетные ограничения пользователя
   * 
   * @query user_account_id - UUID пользователя
   */
  fastify.get('/budget-constraints', async (request, reply) => {
    const log = getWorkflowLogger(request as FastifyRequest, 'budgetConstraints');
    const { user_account_id } = request.query as { user_account_id?: string };

    if (!user_account_id) {
      return reply.status(400).send({
        success: false,
        error: 'user_account_id is required',
      });
    }

    try {
      const { getBudgetConstraints } = await import('../lib/campaignBuilder.js');
      const constraints = await getBudgetConstraints(user_account_id);

      return reply.send({
        success: true,
        constraints: {
          plan_daily_budget_cents: constraints.plan_daily_budget_cents,
          plan_daily_budget_usd: constraints.plan_daily_budget_cents / 100,
          available_budget_cents: constraints.available_budget_cents,
          available_budget_usd: constraints.available_budget_cents / 100,
          default_cpl_target_cents: constraints.default_cpl_target_cents,
          default_cpl_target_usd: constraints.default_cpl_target_cents / 100,
          min_budget_per_campaign_cents: constraints.min_budget_per_campaign_cents,
          min_budget_per_campaign_usd: constraints.min_budget_per_campaign_cents / 100,
          max_budget_per_campaign_cents: constraints.max_budget_per_campaign_cents,
          max_budget_per_campaign_usd: constraints.max_budget_per_campaign_cents / 100,
        },
      });
    } catch (error: any) {
      log.error({ err: error, userAccountId: user_account_id }, 'Error fetching budget for preview');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to fetch budget constraints',
      });
    }
  });
};

