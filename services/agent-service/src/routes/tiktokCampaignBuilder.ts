/**
 * TikTok Campaign Builder Routes
 *
 * REST API для создания и управления рекламой в TikTok
 * Аналог campaignBuilder.ts для Facebook
 */

import { type FastifyRequest, FastifyPluginAsync } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { getTikTokCredentials, getTikTokDirectionSettings } from '../lib/tiktokSettings.js';
import { resolveTikTokError } from '../lib/tiktokErrors.js';
import { tt } from '../adapters/tiktok.js';
import {
  workflowCreateTikTokCampaignWithCreative,
  type TikTokObjectiveType
} from '../workflows/tiktok/createCampaignWithCreative.js';
import {
  workflowCreateAdInDirection,
  getAvailableTikTokAdGroup,
  hasAvailableTikTokAdGroups,
  activateTikTokAdGroup,
  deactivateTikTokAdGroupWithAds
} from '../workflows/tiktok/createAdGroupInDirection.js';
import { eventLogger } from '../lib/eventLogger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

const baseLog = createLogger({ module: 'tiktokCampaignBuilder' });

function isTikTokCreativeEligible(creative: any) {
  const mediaType = creative?.media_type ? String(creative.media_type).toLowerCase() : null;
  if (mediaType && mediaType !== 'video') {
    return false;
  }
  return Boolean(creative?.tiktok_video_id || creative?.media_url);
}

function getWorkflowLogger(request: FastifyRequest, workflow: string) {
  const parent = (request?.log as any) ?? baseLog;
  const child = parent.child({ module: 'tiktokCampaignBuilder', workflow });
  if (request) {
    (request as any).log = child;
  }
  return child;
}

// ========================================
// ROUTES
// ========================================

export const tiktokCampaignBuilderRoutes: FastifyPluginAsync = async (fastify) => {

  /**
   * POST /api/tiktok-campaign-builder/auto-launch
   *
   * Автоматический запуск рекламы для ВСЕХ активных TikTok направлений
   */
  fastify.post(
    '/auto-launch',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            user_account_id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            account_id: {
              oneOf: [
                { type: 'string', format: 'uuid' },
                { type: 'null' }
              ]
            }
          },
          anyOf: [
            { required: ['user_account_id'] },
            { required: ['userId'] }
          ]
        }
      }
    },
    async (request, reply) => {
      const log = getWorkflowLogger(request, 'tiktokAutoLaunch');
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
          error: 'user_account_id or userId is required'
        });
      }

      log.info({ userAccountId: user_account_id, accountId: account_id }, 'TikTok auto-launch request');

      try {
        // Получаем TikTok credentials
        const creds = await getTikTokCredentials(user_account_id, account_id);
        if (!creds) {
          return reply.status(400).send({
            success: false,
            error: 'TikTok credentials not found. Please connect TikTok account first.'
          });
        }

        // Находим активные TikTok направления
        let directionsQuery = supabase
          .from('account_directions')
          .select('*')
          .eq('user_account_id', user_account_id)
          .eq('is_active', true)
          .eq('platform', 'tiktok');  // Только TikTok направления

        if (account_id) {
          directionsQuery = directionsQuery.eq('account_id', account_id);
        }

        const { data: directions, error: directionsError } = await directionsQuery;

        if (directionsError) {
          log.error({ error: directionsError }, 'Failed to fetch TikTok directions');
          return reply.status(500).send({
            success: false,
            error: 'Failed to fetch directions'
          });
        }

        const activeDirections = directions || [];

        if (activeDirections.length === 0) {
          log.warn({ userAccountId: user_account_id }, 'No active TikTok directions found');
          return reply.status(400).send({
            success: false,
            error: 'No active TikTok directions found',
            hint: 'Create a TikTok direction first or check that directions are active'
          });
        }

        log.info({ directionCount: activeDirections.length }, 'Found active TikTok directions');

        const results: any[] = [];

        // Обрабатываем каждое направление
        for (const direction of activeDirections) {
          log.info({
            directionId: direction.id,
            directionName: direction.name
          }, 'Processing TikTok direction');

          try {
            // Получаем креативы для направления
            const { data: creatives, error: creativesError } = await supabase
              .from('user_creatives')
              .select('*')
              .eq('user_id', user_account_id)
              .eq('direction_id', direction.id)
              .eq('is_active', true)
              .eq('status', 'ready')
              .limit(20);  // Берем больше, фильтруем ниже

            if (creativesError || !creatives || creatives.length === 0) {
              log.warn({ directionId: direction.id }, 'No creatives for TikTok direction');
              results.push({
                direction_id: direction.id,
                direction_name: direction.name,
                skipped: true,
                reason: 'No ready creatives for this direction'
              });
              continue;
            }

            const eligibleCreatives = creatives.filter(isTikTokCreativeEligible).slice(0, 5);
            if (eligibleCreatives.length === 0) {
              log.warn({ directionId: direction.id }, 'No eligible TikTok video creatives found');
              results.push({
                direction_id: direction.id,
                direction_name: direction.name,
                skipped: true,
                reason: 'No eligible TikTok video creatives for this direction'
              });
              continue;
            }

            // Проверяем режим работы: use_existing или create_new
            const useExisting = direction.tiktok_adgroup_mode === 'use_existing';

            if (useExisting) {
              // Режим pre-created AdGroups
              const hasAvailable = await hasAvailableTikTokAdGroups(direction.id);

              if (!hasAvailable) {
                log.warn({ directionId: direction.id }, 'No available pre-created TikTok ad groups');
                results.push({
                  direction_id: direction.id,
                  direction_name: direction.name,
                  skipped: true,
                  reason: 'No available pre-created ad groups'
                });
                continue;
              }

              // Используем workflow для добавления в существующий AdGroup
              const result = await workflowCreateAdInDirection(
                {
                  user_creative_ids: eligibleCreatives.map(c => c.id),
                  direction_id: direction.id,
                  auto_activate: true
                },
                {
                  user_account_id,
                  ad_account_id: account_id
                }
              );

              results.push({
                direction_id: direction.id,
                direction_name: direction.name,
                success: true,
                mode: 'use_existing',
                adgroup_id: result.adgroup_id,
                tiktok_adgroup_id: result.tiktok_adgroup_id,
                ads_created: result.ads_count,
                ads: result.ads
              });

            } else {
              // Режим создания новой кампании
              const result = await workflowCreateTikTokCampaignWithCreative(
                {
                  user_creative_ids: eligibleCreatives.map(c => c.id),
                  objective: (direction.tiktok_objective || 'traffic') as TikTokObjectiveType,
                  campaign_name: direction.name,
                  daily_budget: direction.tiktok_daily_budget || 2500,
                  auto_activate: true,
                  // Lead Generation: передаём Instant Page ID
                  ...(direction.tiktok_instant_page_id && { page_id: direction.tiktok_instant_page_id })
                },
                {
                  user_account_id,
                  ad_account_id: account_id,
                  advertiser_id: creds.advertiserId,
                  access_token: creds.accessToken,
                  identity_id: creds.identityId
                }
              );

              results.push({
                direction_id: direction.id,
                direction_name: direction.name,
                success: true,
                mode: 'create_new',
                campaign_id: result.campaign_id,
                adgroup_id: result.adgroup_id,
                ads_created: result.ads_count,
                ads: result.ads
              });
            }

            // Log business event
            await eventLogger.logBusinessEvent(
              user_account_id,
              'tiktok_creative_launched',
              {
                directionId: direction.id,
                directionName: direction.name,
                creativesCount: eligibleCreatives.length,
                platform: 'tiktok'
              },
              account_id
            );

          } catch (error: any) {
            const resolution = error?.tiktok ? resolveTikTokError(error.tiktok) : undefined;
            log.error({ error, directionId: direction.id, resolution }, 'Failed to launch TikTok ads for direction');

            logErrorToAdmin({
              user_account_id,
              error_type: error?.tiktok ? 'tiktok' : 'api',
              error_code: error?.tiktok?.code?.toString(),
              raw_error: error.message || String(error),
              stack_trace: error.stack,
              action: 'tiktok_auto_launch',
              endpoint: '/tiktok-campaign-builder/auto-launch',
              request_data: { direction_id: direction.id },
              severity: 'warning'
            }).catch(() => {});

            results.push({
              direction_id: direction.id,
              direction_name: direction.name,
              success: false,
              error: resolution?.userMessageRu || error.message,
              status: 'failed'
            });
          }
        }

        log.info({ resultsCount: results.length }, 'TikTok auto-launch completed');

        return reply.send({
          success: true,
          message: `Processed ${results.length} TikTok direction(s)`,
          results
        });

      } catch (error: any) {
        log.error({ error }, 'Unexpected error in TikTok auto-launch');
        return reply.status(500).send({
          success: false,
          error: error.message || 'Internal server error'
        });
      }
    }
  );

  /**
   * POST /api/tiktok-campaign-builder/manual-launch
   *
   * Ручной запуск рекламы с выбранными креативами
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
            account_id: {
              oneOf: [
                { type: 'string', format: 'uuid' },
                { type: 'null' }
              ]
            },
            direction_id: { type: 'string', format: 'uuid' },
            creative_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1 },
            daily_budget: { type: 'number', minimum: 2500 },  // TikTok minimum daily budget (KZT)
            objective: { type: 'string', enum: ['traffic', 'conversions', 'reach', 'video_views', 'lead_generation'] }
          }
        }
      }
    },
    async (request, reply) => {
      const log = getWorkflowLogger(request, 'tiktokManualLaunch');
      const body = request.body as {
        user_account_id: string;
        account_id?: string;
        direction_id: string;
        creative_ids: string[];
        daily_budget?: number;
        objective?: TikTokObjectiveType;
      };

      const { user_account_id, account_id, direction_id, creative_ids, daily_budget, objective } = body;

      log.info({
        userAccountId: user_account_id,
        directionId: direction_id,
        creativesCount: creative_ids.length
      }, 'TikTok manual launch request');

      try {
        // Получаем TikTok credentials
        const creds = await getTikTokCredentials(user_account_id, account_id);
        if (!creds) {
          return reply.status(400).send({
            success: false,
            error: 'TikTok credentials not found. Please connect TikTok account first.'
          });
        }

        // Получаем направление
        const { data: direction, error: directionError } = await supabase
          .from('account_directions')
          .select('*')
          .eq('id', direction_id)
          .eq('user_account_id', user_account_id)
          .eq('platform', 'tiktok')
          .eq('is_active', true)
          .single();

        if (directionError || !direction) {
          return reply.status(404).send({
            success: false,
            error: 'Direction not found, inactive, or not TikTok'
          });
        }

        // Определяем режим работы
        const useExisting = direction.tiktok_adgroup_mode === 'use_existing';

        if (useExisting) {
          // Режим pre-created AdGroups
          const result = await workflowCreateAdInDirection(
            {
              user_creative_ids: creative_ids,
              direction_id,
              auto_activate: true
            },
            {
              user_account_id,
              ad_account_id: account_id
            }
          );

          // Log business event
          await eventLogger.logBusinessEvent(
            user_account_id,
            'tiktok_creative_launched',
            {
              directionId: direction_id,
              directionName: direction.name,
              creativesCount: creative_ids.length,
              mode: 'manual',
              platform: 'tiktok'
            },
            account_id
          );

          return reply.send({
            success: true,
            message: `TikTok ads launched: ${result.ads_count} ad(s) created`,
            direction_id,
            direction_name: direction.name,
            adgroup_id: result.adgroup_id,
            tiktok_adgroup_id: result.tiktok_adgroup_id,
            ads_created: result.ads_count,
            ads: result.ads,
            mode: 'use_existing'
          });

        } else {
          // Режим создания новой кампании
          const finalObjective = objective || direction.tiktok_objective || 'traffic';
          const finalBudget = daily_budget || direction.tiktok_daily_budget || 2500;

          const result = await workflowCreateTikTokCampaignWithCreative(
            {
              user_creative_ids: creative_ids,
              objective: finalObjective as TikTokObjectiveType,
              campaign_name: `${direction.name} - Manual ${new Date().toISOString().replace('T', ' ').slice(0, 16)}`,
              daily_budget: finalBudget,
              auto_activate: true,
              // Lead Generation: передаём Instant Page ID
              ...(direction.tiktok_instant_page_id && { page_id: direction.tiktok_instant_page_id })
            },
            {
              user_account_id,
              ad_account_id: account_id,
              advertiser_id: creds.advertiserId,
              access_token: creds.accessToken,
              identity_id: creds.identityId
            }
          );

          // Log business event
          await eventLogger.logBusinessEvent(
            user_account_id,
            'tiktok_creative_launched',
            {
              directionId: direction_id,
              directionName: direction.name,
              creativesCount: creative_ids.length,
              mode: 'manual',
              platform: 'tiktok'
            },
            account_id
          );

          return reply.send({
            success: true,
            message: `TikTok campaign created: ${result.ads_count} ad(s)`,
            direction_id,
            direction_name: direction.name,
            campaign_id: result.campaign_id,
            adgroup_id: result.adgroup_id,
            ads_created: result.ads_count,
            ads: result.ads,
            mode: 'create_new'
          });
        }

      } catch (error: any) {
        log.error({ error }, 'TikTok manual launch failed');

        logErrorToAdmin({
          user_account_id,
          error_type: error?.tiktok ? 'tiktok' : 'api',
          error_code: error?.tiktok?.code?.toString(),
          raw_error: error.message || String(error),
          stack_trace: error.stack,
          action: 'tiktok_manual_launch',
          endpoint: '/tiktok-campaign-builder/manual-launch',
          request_data: { direction_id, creative_ids },
          severity: 'warning'
        }).catch(() => {});

        const resolution = error?.tiktok ? resolveTikTokError(error.tiktok) : undefined;

        return reply.status(500).send({
          success: false,
          error: resolution?.userMessageRu || error.message,
          error_details: error.message
        });
      }
    }
  );

  /**
   * POST /api/tiktok-campaign-builder/create-campaign
   *
   * Создание новой кампании напрямую (без direction)
   */
  fastify.post(
    '/create-campaign',
    {
      schema: {
        body: {
          type: 'object',
          required: ['user_account_id', 'creative_ids', 'campaign_name'],
          properties: {
            user_account_id: { type: 'string', format: 'uuid' },
            account_id: { type: 'string', format: 'uuid' },
            creative_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1 },
            campaign_name: { type: 'string', minLength: 1 },
            objective: { type: 'string', enum: ['traffic', 'conversions', 'reach', 'video_views', 'lead_generation'] },
            daily_budget: { type: 'number', minimum: 2500 },
            auto_activate: { type: 'boolean' },
            page_id: { type: 'string' }  // TikTok Instant Page ID for Lead Generation
          }
        }
      }
    },
    async (request, reply) => {
      const log = getWorkflowLogger(request, 'tiktokCreateCampaign');
      const body = request.body as {
        user_account_id: string;
        account_id?: string;
        creative_ids: string[];
        campaign_name: string;
        objective?: TikTokObjectiveType;
        daily_budget?: number;
        auto_activate?: boolean;
        page_id?: string;  // TikTok Instant Page ID for Lead Generation
      };

      log.info({
        userAccountId: body.user_account_id,
        campaignName: body.campaign_name,
        creativesCount: body.creative_ids.length
      }, 'TikTok create campaign request');

      try {
        const creds = await getTikTokCredentials(body.user_account_id, body.account_id);
        if (!creds) {
          return reply.status(400).send({
            success: false,
            error: 'TikTok credentials not found'
          });
        }

        const result = await workflowCreateTikTokCampaignWithCreative(
          {
            user_creative_ids: body.creative_ids,
            objective: body.objective || 'traffic',
            campaign_name: body.campaign_name,
            daily_budget: body.daily_budget || 2500,
            auto_activate: body.auto_activate ?? true,
            // Lead Generation: передаём Instant Page ID
            ...(body.page_id && { page_id: body.page_id })
          },
          {
            user_account_id: body.user_account_id,
            ad_account_id: body.account_id,
            advertiser_id: creds.advertiserId,
            access_token: creds.accessToken,
            identity_id: creds.identityId
          }
        );

        return reply.send(result);

      } catch (error: any) {
        log.error({ error }, 'TikTok create campaign failed');

        const resolution = error?.tiktok ? resolveTikTokError(error.tiktok) : undefined;

        return reply.status(500).send({
          success: false,
          error: resolution?.userMessageRu || error.message
        });
      }
    }
  );

  /**
   * GET /api/tiktok-campaign-builder/campaigns
   *
   * Получить список кампаний пользователя
   */
  fastify.get('/campaigns', async (request, reply) => {
    const log = getWorkflowLogger(request, 'tiktokGetCampaigns');
    const query = request.query as {
      user_account_id?: string;
      account_id?: string;
    };

    if (!query.user_account_id) {
      return reply.status(400).send({
        success: false,
        error: 'user_account_id is required'
      });
    }

    try {
      const creds = await getTikTokCredentials(query.user_account_id, query.account_id);
      if (!creds) {
        return reply.status(400).send({
          success: false,
          error: 'TikTok credentials not found'
        });
      }

      const campaigns = await tt.getCampaigns(creds.advertiserId, creds.accessToken);

      const campaignList = campaigns?.data?.list || [];
      const pageInfo = campaigns?.data?.page_info || campaigns?.page_info || {};
      log.info({
        advertiserId: creds.advertiserId,
        campaignsCount: campaignList.length,
        pageInfo
      }, 'TikTok campaigns fetched');

      return reply.send({
        success: true,
        campaigns: campaignList,
        total: pageInfo.total_number || campaignList.length
      });

    } catch (error: any) {
      log.error({ error }, 'Failed to get TikTok campaigns');
      return reply.status(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/tiktok-campaign-builder/pause-campaign
   *
   * Поставить кампанию на паузу
   */
  fastify.post('/pause-campaign', async (request, reply) => {
    const log = getWorkflowLogger(request, 'tiktokPauseCampaign');
    const body = request.body as {
      user_account_id: string;
      account_id?: string;
      campaign_id: string;
    };

    if (!body.user_account_id || !body.campaign_id) {
      return reply.status(400).send({
        success: false,
        error: 'user_account_id and campaign_id are required'
      });
    }

    try {
      const creds = await getTikTokCredentials(body.user_account_id, body.account_id);
      if (!creds) {
        return reply.status(400).send({
          success: false,
          error: 'TikTok credentials not found'
        });
      }

      await tt.pauseCampaign(creds.advertiserId, creds.accessToken, body.campaign_id);

      log.info({ campaignId: body.campaign_id }, 'TikTok campaign paused');

      return reply.send({
        success: true,
        message: 'Campaign paused successfully',
        campaign_id: body.campaign_id
      });

    } catch (error: any) {
      log.error({ error }, 'Failed to pause TikTok campaign');
      return reply.status(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/tiktok-campaign-builder/resume-campaign
   *
   * Возобновить кампанию
   */
  fastify.post('/resume-campaign', async (request, reply) => {
    const log = getWorkflowLogger(request, 'tiktokResumeCampaign');
    const body = request.body as {
      user_account_id: string;
      account_id?: string;
      campaign_id: string;
    };

    if (!body.user_account_id || !body.campaign_id) {
      return reply.status(400).send({
        success: false,
        error: 'user_account_id and campaign_id are required'
      });
    }

    try {
      const creds = await getTikTokCredentials(body.user_account_id, body.account_id);
      if (!creds) {
        return reply.status(400).send({
          success: false,
          error: 'TikTok credentials not found'
        });
      }

      await tt.resumeCampaign(creds.advertiserId, creds.accessToken, body.campaign_id);

      log.info({ campaignId: body.campaign_id }, 'TikTok campaign resumed');

      return reply.send({
        success: true,
        message: 'Campaign resumed successfully',
        campaign_id: body.campaign_id
      });

    } catch (error: any) {
      log.error({ error }, 'Failed to resume TikTok campaign');
      return reply.status(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/tiktok-campaign-builder/report
   *
   * Получить отчёт по кампаниям
   */
  fastify.get('/report', async (request, reply) => {
    const log = getWorkflowLogger(request, 'tiktokGetReport');
    const query = request.query as {
      user_account_id?: string;
      account_id?: string;
      campaign_ids?: string;
      start_date?: string;
      end_date?: string;
    };

    if (!query.user_account_id) {
      return reply.status(400).send({
        success: false,
        error: 'user_account_id is required'
      });
    }

    try {
      const creds = await getTikTokCredentials(query.user_account_id, query.account_id);
      if (!creds) {
        return reply.status(400).send({
          success: false,
          error: 'TikTok credentials not found'
        });
      }

      const campaignIds = query.campaign_ids?.split(',').filter(Boolean);
      const endDate = query.end_date || new Date().toISOString().split('T')[0];
      const startDate = query.start_date || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const report = await tt.getReport(
        creds.advertiserId,
        creds.accessToken,
        {
          report_type: 'BASIC',
          data_level: 'AUCTION_CAMPAIGN',
          dimensions: ['campaign_id'],
          start_date: startDate,
          end_date: endDate,
          metrics: ['spend', 'impressions', 'clicks', 'conversions', 'cpc', 'cpm', 'ctr'],
          filtering: campaignIds && campaignIds.length > 0 ? { campaign_ids: campaignIds } : undefined
        }
      );

      return reply.send({
        success: true,
        report: report.data,
        period: { start_date: startDate, end_date: endDate }
      });

    } catch (error: any) {
      log.error({ error }, 'Failed to get TikTok report');
      return reply.status(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/tiktok-campaign-builder/available-creatives
   *
   * Получить список креативов, готовых для TikTok
   */
  fastify.get('/available-creatives', async (request, reply) => {
    const log = getWorkflowLogger(request, 'tiktokAvailableCreatives');
    const query = request.query as {
      user_account_id?: string;
      direction_id?: string;
    };

    if (!query.user_account_id) {
      return reply.status(400).send({
        success: false,
        error: 'user_account_id is required'
      });
    }

    try {
      let creativesQuery = supabase
        .from('user_creatives')
        .select('id, title, description, media_url, tiktok_video_id, media_type, created_at, updated_at')
        .eq('user_id', query.user_account_id)
        .eq('is_active', true)
        .eq('status', 'ready')
        .order('created_at', { ascending: false });

      if (query.direction_id) {
        creativesQuery = creativesQuery.eq('direction_id', query.direction_id);
      }

      const { data: creatives, error } = await creativesQuery;

      if (error) {
        throw error;
      }

      const eligibleCreatives = (creatives || []).filter(isTikTokCreativeEligible);

      return reply.send({
        success: true,
        creatives: eligibleCreatives,
        count: eligibleCreatives.length
      });

    } catch (error: any) {
      log.error({ error }, 'Failed to get available creatives');
      return reply.status(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/tiktok-campaign-builder/advertiser-info
   *
   * Получить информацию о рекламном аккаунте TikTok
   */
  fastify.get('/advertiser-info', async (request, reply) => {
    const log = getWorkflowLogger(request, 'tiktokAdvertiserInfo');
    const query = request.query as {
      user_account_id?: string;
      account_id?: string;
    };

    if (!query.user_account_id) {
      return reply.status(400).send({
        success: false,
        error: 'user_account_id is required'
      });
    }

    try {
      const creds = await getTikTokCredentials(query.user_account_id, query.account_id);
      if (!creds) {
        return reply.status(400).send({
          success: false,
          error: 'TikTok credentials not found'
        });
      }

      const info = await tt.getAdvertiserInfo(creds.advertiserId, creds.accessToken);

      return reply.send({
        success: true,
        advertiser: info
      });

    } catch (error: any) {
      log.error({ error }, 'Failed to get advertiser info');
      return reply.status(500).send({
        success: false,
        error: error.message
      });
    }
  });
};

export default tiktokCampaignBuilderRoutes;
