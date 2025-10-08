/**
 * Routes для Campaign Builder Agent
 * 
 * Webhook для автоматического запуска рекламы с фронтенда
 */

import { FastifyPluginAsync } from 'fastify';
import { supabase } from '../lib/supabase.js';
import {
  buildCampaignAction,
  convertActionToEnvelope,
  getActiveCampaigns,
  pauseActiveCampaigns,
  type CampaignBuilderInput,
  type CampaignObjective,
} from '../lib/campaignBuilder.js';

// ========================================
// REQUEST SCHEMAS
// ========================================

const autoLaunchRequestSchema = {
  type: 'object',
  required: ['user_account_id', 'objective'],
  properties: {
    user_account_id: { type: 'string', format: 'uuid' },
    objective: { type: 'string', enum: ['whatsapp', 'instagram_traffic', 'site_leads'] },
    campaign_name: { type: 'string' },
    requested_budget_cents: { type: 'number', minimum: 500 }, // Минимум $5
    additional_context: { type: 'string' },
    auto_activate: { type: 'boolean', default: false },
  },
};

// ========================================
// ROUTES
// ========================================

export const campaignBuilderRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/campaign-builder/auto-launch
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
      const body = request.body as {
        user_account_id: string;
        objective: CampaignObjective;
        campaign_name?: string;
        requested_budget_cents?: number;
        additional_context?: string;
        auto_activate?: boolean;
      };

      const { user_account_id, objective, campaign_name, requested_budget_cents, additional_context, auto_activate } =
        body;

      console.log('[CampaignBuilder API] Auto-launch request:', {
        user_account_id,
        objective,
        campaign_name,
        requested_budget_cents,
      });

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

        if (!userAccount.access_token) {
          return reply.status(400).send({
            success: false,
            error: 'User has no Facebook access token',
          });
        }

        // ===================================================
        // STEP 2: Проверяем и останавливаем активные кампании
        // ===================================================
        console.log('[CampaignBuilder API] Checking for active campaigns...');

        let pausedCampaigns: any[] = [];
        try {
          const activeCampaigns = await getActiveCampaigns(
            userAccount.ad_account_id,
            userAccount.access_token
          );

          if (activeCampaigns.length > 0) {
            console.log('[CampaignBuilder API] Found', activeCampaigns.length, 'active campaigns. Pausing...');
            
            const pauseResults = await pauseActiveCampaigns(activeCampaigns, userAccount.access_token);
            pausedCampaigns = pauseResults;

            const successCount = pauseResults.filter((r) => r.success).length;
            console.log('[CampaignBuilder API] Paused campaigns:', {
              total: activeCampaigns.length,
              success: successCount,
              failed: activeCampaigns.length - successCount,
            });
          } else {
            console.log('[CampaignBuilder API] No active campaigns found');
          }
        } catch (error: any) {
          console.error('[CampaignBuilder API] Error managing active campaigns:', error);
          // Не фейлим весь запрос, продолжаем создание новой кампании
          // но логируем ошибку
        }

        // ===================================================
        // STEP 3: Запускаем Campaign Builder LLM
        // ===================================================
        console.log('[CampaignBuilder API] Building campaign action...');
        
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
          
          // Применяем auto_activate из запроса
          action.params.auto_activate = auto_activate || false;
        } catch (error: any) {
          console.error('[CampaignBuilder API] Failed to build action:', error);
          return reply.status(400).send({
            success: false,
            error: error.message || 'Failed to build campaign action',
            stage: 'planning',
          });
        }

        console.log('[CampaignBuilder API] Action created:', {
          type: action.type,
          campaign_name: action.params.campaign_name,
          daily_budget: action.params.daily_budget_cents ? `$${action.params.daily_budget_cents / 100}` : 'N/A',
          creatives_count: action.params.user_creative_ids?.length || action.params.adsets?.length || 0,
          confidence: action.confidence,
        });

        // ===================================================
        // STEP 4: Выполняем action через систему actions
        // ===================================================
        console.log('[CampaignBuilder API] Executing action through actions system...');

        const envelope = convertActionToEnvelope(action, user_account_id, objective, userAccount.whatsapp_phone_number);
        
        // Вызываем POST /api/agent/actions через внутренний механизм
        let executionResult;
        try {
          const actionsResponse = await request.server.inject({
            method: 'POST',
            url: '/api/agent/actions',
            payload: envelope,
          });

          if (actionsResponse.statusCode !== 202) {
            throw new Error(`Actions API returned ${actionsResponse.statusCode}: ${actionsResponse.body}`);
          }

          executionResult = JSON.parse(actionsResponse.body);
          console.log('[CampaignBuilder API] Action executed:', executionResult);
        } catch (error: any) {
          console.error('[CampaignBuilder API] Failed to execute action:', error);
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

        console.log('[CampaignBuilder API] Execution result:', {
          execution_id: executionId,
          status: execution?.status,
          has_response: !!execution?.response_json,
          response_length: execution?.response_json?.length,
          attempts,
        });

        const campaignResult = execution?.response_json?.[0] || {};

        console.log('[CampaignBuilder API] Campaign created:', {
          execution_id: executionId,
          campaign_id: campaignResult.campaign_id,
          adset_id: campaignResult.adset_id,
        });

        // ===================================================
        // STEP 6: Возвращаем результат
        // ===================================================
        return reply.send({
          success: true,
          execution_id: executionId,
          campaign_id: campaignResult.campaign_id,
          adset_id: campaignResult.adset_id,
          ads: campaignResult.ads,
          paused_campaigns: pausedCampaigns.filter((c) => c.success).map((c) => ({
            campaign_id: c.campaign_id,
            name: c.name,
          })),
          paused_campaigns_count: pausedCampaigns.filter((c) => c.success).length,
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
      } catch (error: any) {
        console.error('[CampaignBuilder API] Unexpected error:', error);
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
      const body = request.body as CampaignBuilderInput;

      console.log('[CampaignBuilder API] Preview request:', {
        user_account_id: body.user_account_id,
        objective: body.objective,
      });

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
        console.error('[CampaignBuilder API] Preview error:', error);
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
    const { user_account_id, objective } = request.query as {
      user_account_id?: string;
      objective?: CampaignObjective;
    };

    if (!user_account_id) {
      return reply.status(400).send({
        success: false,
        error: 'user_account_id is required',
      });
    }

    try {
      const { getAvailableCreatives } = await import('../lib/campaignBuilder.js');
      const creatives = await getAvailableCreatives(user_account_id, objective);

      return reply.send({
        success: true,
        creatives,
        count: creatives.length,
      });
    } catch (error: any) {
      console.error('[CampaignBuilder API] Error fetching creatives:', error);
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
      console.error('[CampaignBuilder API] Error fetching budget:', error);
      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to fetch budget constraints',
      });
    }
  });
};

