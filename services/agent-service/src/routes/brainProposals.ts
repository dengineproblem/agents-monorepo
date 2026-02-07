/**
 * Brain Proposals API Routes
 *
 * Handles pending brain proposals for semi-auto mode
 * - GET /brain-proposals/pending - get pending proposals
 * - POST /brain-proposals/:id/approve - approve and execute selected proposals
 * - POST /brain-proposals/:id/reject - reject proposals
 *
 * @module routes/brainProposals
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

const logger = createLogger({ module: 'brainProposalsRoutes' });

// =====================================================
// Schemas
// =====================================================

const ApproveBodySchema = z.object({
  stepIndices: z.array(z.number().int().min(0))
});

const QuerySchema = z.object({
  accountId: z.string().uuid().optional()
});

// =====================================================
// Types
// =====================================================

interface Proposal {
  action: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  entity_type: 'adset' | 'ad' | 'campaign';
  entity_id: string;
  entity_name?: string;
  health_score?: number;
  hs_class?: string;
  reason?: string;
  confidence?: number;
  suggested_action_params?: Record<string, any>;
  metrics?: Record<string, any>;
}

interface PendingProposal {
  id: string;
  ad_account_id: string;
  user_account_id: string;
  proposals: Proposal[];
  context: {
    summary?: any;
    adset_analysis?: any;
  };
  proposals_count: number;
  status: 'pending' | 'partial' | 'approved' | 'rejected' | 'expired';
  notification_id?: string;
  created_at: string;
  expires_at: string;
  processed_at?: string;
  executed_indices: number[];
}

// =====================================================
// Helpers
// =====================================================

/**
 * Маппинг proposal.action в actions формат для /agent/actions
 */
function mapProposalToAction(proposal: Proposal): { type: string; params: Record<string, any> } | null {
  const { action, entity_id, entity_type, suggested_action_params } = proposal;

  switch (action) {
    case 'pause_adset':
    case 'pauseAdSet':
      return {
        type: 'PauseAdset',
        params: { adsetId: entity_id }
      };

    case 'pause_ad':
    case 'pauseAd':
      return {
        type: 'PauseAd',
        params: { adId: entity_id }
      };

    case 'resume_adset':
    case 'resumeAdSet':
      return {
        type: 'ResumeAdset',
        params: { adsetId: entity_id }
      };

    case 'resume_ad':
    case 'resumeAd':
      return {
        type: 'ResumeAd',
        params: { adId: entity_id }
      };

    case 'update_budget':
    case 'updateBudget':
    case 'increase_budget':
    case 'decrease_budget':
      if (suggested_action_params?.new_budget_cents) {
        return {
          type: 'SetAdsetBudget',
          params: {
            adsetId: entity_id,
            dailyBudgetUsd: suggested_action_params.new_budget_cents / 100
          }
        };
      }
      return null;

    case 'pause_campaign':
    case 'pauseCampaign':
      return {
        type: 'PauseCampaign',
        params: { campaignId: entity_id }
      };

    case 'resume_campaign':
    case 'resumeCampaign':
      return {
        type: 'ResumeCampaign',
        params: { campaignId: entity_id }
      };

    default:
      logger.warn({ action, entity_id }, 'Unknown proposal action, skipping');
      return null;
  }
}

/**
 * Выполнить actions через /agent/actions endpoint
 * Использует глобальную ссылку на Fastify app для inject
 */
let fastifyApp: FastifyInstance | null = null;

function setFastifyApp(app: FastifyInstance) {
  fastifyApp = app;
}

async function executeActions(
  actions: Array<{ type: string; params: Record<string, any> }>,
  userAccountId: string,
  accountId: string
): Promise<{ success: boolean; executionId?: string; error?: string }> {
  const startTime = Date.now();
  const idempotencyKey = `brain-proposals-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  logger.info({
    actionsCount: actions.length,
    userAccountId,
    accountId,
    idempotencyKey,
    actionTypes: actions.map(a => a.type)
  }, '[executeActions] Starting execution');

  try {
    // Если есть ссылка на Fastify - используем inject (более надёжно)
    if (fastifyApp) {
      logger.debug('[executeActions] Using Fastify inject');

      const response = await fastifyApp.inject({
        method: 'POST',
        url: '/agent/actions',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          idempotencyKey,
          source: 'brain_proposals',
          account: {
            userAccountId,
            accountId
          },
          actions
        }
      });

      const result = JSON.parse(response.payload);

      // 200 OK or 202 Accepted are both success
      if (response.statusCode < 200 || response.statusCode >= 300) {
        logger.error({
          statusCode: response.statusCode,
          error: result.error || result.message,
          duration: Date.now() - startTime
        }, '[executeActions] Inject failed');
        return { success: false, error: result.error || result.message || 'Execution failed' };
      }

      logger.info({
        executionId: result.executionId,
        duration: Date.now() - startTime
      }, '[executeActions] Inject success');
      return { success: true, executionId: result.executionId };
    }

    // Fallback на HTTP (для тестирования)
    const port = process.env.PORT || 8082;
    const host = process.env.HOST || '127.0.0.1';
    const url = `http://${host}:${port}/agent/actions`;

    logger.debug({ url }, '[executeActions] Using HTTP fallback');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey,
        source: 'brain_proposals',
        account: {
          userAccountId,
          accountId
        },
        actions
      })
    });

    const result = await response.json();

    if (!response.ok) {
      logger.error({
        statusCode: response.status,
        error: result.error || result.message,
        duration: Date.now() - startTime
      }, '[executeActions] HTTP request failed');
      return { success: false, error: result.error || result.message || 'Execution failed' };
    }

    logger.info({
      executionId: result.executionId,
      duration: Date.now() - startTime
    }, '[executeActions] HTTP success');
    return { success: true, executionId: result.executionId };
  } catch (err: any) {
    logger.error({
      error: String(err),
      stack: err.stack,
      duration: Date.now() - startTime
    }, '[executeActions] Exception');
    return { success: false, error: err.message || String(err) };
  }
}

// =====================================================
// Routes
// =====================================================

export default async function brainProposalsRoutes(app: FastifyInstance) {
  // Сохраняем ссылку на Fastify для inject
  setFastifyApp(app);
  logger.info('[brainProposalsRoutes] Routes registered, Fastify app reference set');

  /**
   * GET /brain-proposals/pending
   *
   * Получить pending proposals для пользователя
   * Query: accountId (опционально) - фильтр по конкретному аккаунту
   */
  app.get('/brain-proposals/pending', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const userId = request.headers['x-user-id'] as string;

    logger.info({ userId, query: request.query }, '[GET /brain-proposals/pending] Request received');

    if (!userId) {
      logger.warn('[GET /brain-proposals/pending] Missing user ID');
      return reply.code(401).send({ error: 'User ID required' });
    }

    const query = QuerySchema.safeParse(request.query);
    const accountId = query.success ? query.data.accountId : undefined;

    try {
      let queryBuilder = supabase
        .from('pending_brain_proposals')
        .select(`
          id,
          ad_account_id,
          user_account_id,
          proposals,
          context,
          proposals_count,
          status,
          notification_id,
          created_at,
          expires_at,
          processed_at,
          executed_indices
        `)
        .eq('user_account_id', userId)
        .in('status', ['pending', 'partial'])
        .order('created_at', { ascending: false });

      if (accountId) {
        queryBuilder = queryBuilder.eq('ad_account_id', accountId);
      }

      const { data, error } = await queryBuilder;

      if (error) {
        logger.error({ error: error.message, userId }, 'Failed to fetch pending proposals');
        return reply.code(500).send({ error: error.message });
      }

      // Получаем названия аккаунтов для UI
      const accountIds = [...new Set((data || []).map(p => p.ad_account_id))];
      let accountNames: Record<string, string> = {};

      if (accountIds.length > 0) {
        const { data: accounts } = await supabase
          .from('ad_accounts')
          .select('id, name')
          .in('id', accountIds);

        if (accounts) {
          accountNames = Object.fromEntries(accounts.map(a => [a.id, a.name]));
        }
      }

      // Добавляем названия аккаунтов к proposals
      const enrichedData = (data || []).map(p => ({
        ...p,
        ad_account_name: accountNames[p.ad_account_id] || 'Unknown'
      }));

      logger.info({
        userId,
        count: enrichedData.length,
        duration: Date.now() - startTime
      }, '[GET /brain-proposals/pending] Success');

      return reply.send({
        proposals: enrichedData,
        count: enrichedData.length
      });
    } catch (err: any) {
      logger.error({
        error: String(err),
        userId,
        duration: Date.now() - startTime
      }, '[GET /brain-proposals/pending] Exception');

      logErrorToAdmin({
        user_account_id: userId,
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'brain_proposals_pending',
        endpoint: '/brain-proposals/pending',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /brain-proposals/:id
   *
   * Получить конкретный proposal по ID
   */
  app.get('/brain-proposals/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const { id } = request.params as { id: string };
    const userId = request.headers['x-user-id'] as string;

    logger.info({ proposalId: id, userId }, '[GET /brain-proposals/:id] Request received');

    if (!userId) {
      logger.warn({ proposalId: id }, '[GET /brain-proposals/:id] Missing user ID');
      return reply.code(401).send({ error: 'User ID required' });
    }

    try {
      const { data, error } = await supabase
        .from('pending_brain_proposals')
        .select('*')
        .eq('id', id)
        .eq('user_account_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          logger.warn({ proposalId: id, userId }, '[GET /brain-proposals/:id] Not found');
          return reply.code(404).send({ error: 'Proposal not found' });
        }
        logger.error({ error: error.message, id, userId }, '[GET /brain-proposals/:id] DB error');
        return reply.code(500).send({ error: error.message });
      }

      // Получаем название аккаунта
      const { data: account } = await supabase
        .from('ad_accounts')
        .select('name')
        .eq('id', data.ad_account_id)
        .single();

      logger.info({
        proposalId: id,
        userId,
        status: data.status,
        proposalsCount: data.proposals_count,
        duration: Date.now() - startTime
      }, '[GET /brain-proposals/:id] Success');

      return reply.send({
        ...data,
        ad_account_name: account?.name || 'Unknown'
      });
    } catch (err: any) {
      logger.error({
        error: String(err),
        id,
        userId,
        duration: Date.now() - startTime
      }, '[GET /brain-proposals/:id] Exception');

      logErrorToAdmin({
        user_account_id: userId,
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'brain_proposals_get',
        endpoint: '/brain-proposals/:id',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /brain-proposals/:id/approve
   *
   * Одобрить и выполнить выбранные proposals
   * Body: { stepIndices: number[] }
   */
  app.post('/brain-proposals/:id/approve', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const { id } = request.params as { id: string };
    const userId = request.headers['x-user-id'] as string;

    logger.info({ proposalId: id, userId, body: request.body }, '[POST /brain-proposals/:id/approve] Request received');

    if (!userId) {
      logger.warn({ proposalId: id }, '[POST /approve] Missing user ID');
      return reply.code(401).send({ error: 'User ID required' });
    }

    const body = ApproveBodySchema.safeParse(request.body);
    if (!body.success) {
      logger.warn({ proposalId: id, issues: body.error.flatten() }, '[POST /approve] Invalid body');
      return reply.code(400).send({ error: 'Invalid body', issues: body.error.flatten() });
    }

    const { stepIndices } = body.data;
    logger.info({ proposalId: id, stepIndices, stepsCount: stepIndices.length }, '[POST /approve] Processing');

    try {
      // 1. Получаем proposal
      const { data: proposal, error: fetchError } = await supabase
        .from('pending_brain_proposals')
        .select('*')
        .eq('id', id)
        .eq('user_account_id', userId)
        .single();

      if (fetchError || !proposal) {
        logger.warn({ proposalId: id, error: fetchError?.message }, '[POST /approve] Proposal not found');
        return reply.code(404).send({ error: 'Proposal not found' });
      }

      logger.debug({
        proposalId: id,
        status: proposal.status,
        proposalsCount: proposal.proposals?.length,
        executedIndices: proposal.executed_indices
      }, '[POST /approve] Proposal fetched');

      if (proposal.status !== 'pending' && proposal.status !== 'partial') {
        logger.warn({ proposalId: id, status: proposal.status }, '[POST /approve] Already processed');
        return reply.code(400).send({
          error: 'Proposal already processed',
          status: proposal.status
        });
      }

      // Проверяем что proposal не истёк
      if (new Date(proposal.expires_at) < new Date()) {
        logger.warn({ proposalId: id, expiresAt: proposal.expires_at }, '[POST /approve] Expired');
        await supabase
          .from('pending_brain_proposals')
          .update({ status: 'expired' })
          .eq('id', id);

        return reply.code(400).send({ error: 'Proposal expired' });
      }

      const proposals = proposal.proposals as Proposal[];

      // 2. Валидируем индексы
      const validIndices = stepIndices.filter(idx =>
        idx >= 0 &&
        idx < proposals.length &&
        !proposal.executed_indices.includes(idx)
      );

      if (validIndices.length === 0) {
        return reply.code(400).send({ error: 'No valid steps to execute' });
      }

      // 3. Конвертируем proposals в actions
      const actions: Array<{ type: string; params: Record<string, any> }> = [];
      const executedDetails: Array<{ index: number; action: string; entity_id: string; success: boolean }> = [];

      for (const idx of validIndices) {
        const prop = proposals[idx];
        const action = mapProposalToAction(prop);

        if (action) {
          actions.push(action);
          executedDetails.push({
            index: idx,
            action: prop.action,
            entity_id: prop.entity_id,
            success: false // will be updated after execution
          });
        }
      }

      if (actions.length === 0) {
        return reply.code(400).send({ error: 'No executable actions found' });
      }

      logger.info({
        proposalId: id,
        userId,
        actionsCount: actions.length,
        indices: validIndices
      }, 'Executing brain proposals');

      // 4. Выполняем actions
      const execResult = await executeActions(actions, userId, proposal.ad_account_id);

      // 5. Обновляем executed_indices
      const newExecutedIndices = [...proposal.executed_indices, ...validIndices];
      const allExecuted = newExecutedIndices.length === proposals.length;
      const newStatus = allExecuted ? 'approved' : 'partial';

      await supabase
        .from('pending_brain_proposals')
        .update({
          status: newStatus,
          executed_indices: newExecutedIndices,
          processed_at: allExecuted ? new Date().toISOString() : null
        })
        .eq('id', id);

      // 6. Помечаем уведомление как прочитанное
      if (proposal.notification_id) {
        await supabase
          .from('user_notifications')
          .update({ is_read: true })
          .eq('id', proposal.notification_id);
      }

      // 7. Логируем выполнение в brain_executions
      await supabase.from('brain_executions').insert({
        user_account_id: userId,
        account_id: proposal.ad_account_id,
        execution_mode: 'semi_auto_approved',
        status: execResult.success ? 'success' : 'partial_failure',
        actions_json: actions,
        plan_json: { proposals: validIndices.map(i => proposals[i]) },
        report_text: `Approved ${validIndices.length} proposals from pending_brain_proposals ${id}`
      });

      logger.info({
        proposalId: id,
        userId,
        executionId: execResult.executionId,
        success: execResult.success,
        newStatus,
        executedCount: validIndices.length,
        duration: Date.now() - startTime
      }, '[POST /approve] Completed');

      return reply.send({
        success: execResult.success,
        executionId: execResult.executionId,
        executedCount: validIndices.length,
        totalProposals: proposals.length,
        remainingCount: proposals.length - newExecutedIndices.length,
        status: newStatus,
        error: execResult.error
      });
    } catch (err: any) {
      logger.error({
        error: String(err),
        stack: err.stack,
        id,
        userId,
        duration: Date.now() - startTime
      }, '[POST /approve] Exception');

      logErrorToAdmin({
        user_account_id: userId,
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'brain_proposals_approve',
        endpoint: '/brain-proposals/:id/approve',
        severity: 'critical'
      }).catch(() => {});

      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /brain-proposals/:id/reject
   *
   * Отклонить все proposals
   */
  app.post('/brain-proposals/:id/reject', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const { id } = request.params as { id: string };
    const userId = request.headers['x-user-id'] as string;

    logger.info({ proposalId: id, userId }, '[POST /brain-proposals/:id/reject] Request received');

    if (!userId) {
      logger.warn({ proposalId: id }, '[POST /reject] Missing user ID');
      return reply.code(401).send({ error: 'User ID required' });
    }

    try {
      const { data: proposal, error: fetchError } = await supabase
        .from('pending_brain_proposals')
        .select('id, status, notification_id')
        .eq('id', id)
        .eq('user_account_id', userId)
        .single();

      if (fetchError || !proposal) {
        logger.warn({ proposalId: id, error: fetchError?.message }, '[POST /reject] Not found');
        return reply.code(404).send({ error: 'Proposal not found' });
      }

      if (proposal.status !== 'pending' && proposal.status !== 'partial') {
        logger.warn({ proposalId: id, status: proposal.status }, '[POST /reject] Already processed');
        return reply.code(400).send({
          error: 'Proposal already processed',
          status: proposal.status
        });
      }

      // Обновляем статус
      const { error: updateError } = await supabase
        .from('pending_brain_proposals')
        .update({
          status: 'rejected',
          processed_at: new Date().toISOString()
        })
        .eq('id', id);

      if (updateError) {
        logger.error({ error: updateError.message, id, userId }, '[POST /reject] Update failed');
        return reply.code(500).send({ error: updateError.message });
      }

      // Помечаем уведомление как прочитанное
      if (proposal.notification_id) {
        await supabase
          .from('user_notifications')
          .update({ is_read: true })
          .eq('id', proposal.notification_id);
      }

      logger.info({
        proposalId: id,
        userId,
        duration: Date.now() - startTime
      }, '[POST /reject] Completed');

      return reply.send({ success: true });
    } catch (err: any) {
      logger.error({
        error: String(err),
        stack: err.stack,
        id,
        userId,
        duration: Date.now() - startTime
      }, '[POST /reject] Exception');

      logErrorToAdmin({
        user_account_id: userId,
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'brain_proposals_reject',
        endpoint: '/brain-proposals/:id/reject',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /brain-proposals/count
   *
   * Количество pending/partial proposals для пользователя (для badge)
   */
  app.get('/brain-proposals/count', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const userId = request.headers['x-user-id'] as string;

    if (!userId) {
      return reply.code(401).send({ error: 'User ID required' });
    }

    try {
      const { count, error } = await supabase
        .from('pending_brain_proposals')
        .select('*', { count: 'exact', head: true })
        .eq('user_account_id', userId)
        .in('status', ['pending', 'partial']);

      if (error) {
        logger.error({ error: error.message, userId }, '[GET /count] DB error');
        return reply.code(500).send({ error: error.message });
      }

      logger.debug({ userId, count, duration: Date.now() - startTime }, '[GET /count] Success');
      return reply.send({ count: count || 0 });
    } catch (err: any) {
      logger.error({ error: String(err), userId, duration: Date.now() - startTime }, '[GET /count] Exception');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
