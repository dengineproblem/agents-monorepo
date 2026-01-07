import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import { shouldFilterByAccountId } from '../lib/multiAccountHelper.js';

const log = createLogger({ module: 'autopilotRoutes' });

export async function autopilotRoutes(app: FastifyInstance) {
  /**
   * GET /api/autopilot/executions
   * Получить историю выполнений агента brain
   * Поддерживает мультиаккаунтность через accountId (UUID FK к ad_accounts.id)
   */
  app.get('/autopilot/executions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userAccountId, accountId, limit = '10' } = request.query as {
        userAccountId?: string;
        accountId?: string; // UUID FK к ad_accounts.id
        limit?: string;
      };

      if (!userAccountId) {
        return reply.code(400).send({
          success: false,
          error: 'userAccountId is required',
        });
      }

      const limitNum = Math.min(parseInt(limit, 10) || 10, 50);

      log.info({ userAccountId, accountId, limit: limitNum }, 'Fetching brain executions');

      let query = supabase
        .from('brain_executions')
        .select('id, user_account_id, account_id, plan_json, actions_json, report_text, status, duration_ms, created_at')
        .eq('user_account_id', userAccountId);

      // Фильтр по account_id ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
      if (await shouldFilterByAccountId(supabase, userAccountId, accountId)) {
        query = query.eq('account_id', accountId);
      }

      const { data: executions, error } = await query
        .order('created_at', { ascending: false })
        .limit(limitNum);

      if (error) {
        log.error({ err: error, userAccountId }, 'Error fetching brain executions');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }

      return reply.send({
        success: true,
        executions: executions || [],
      });
    } catch (error: any) {
      log.error({ err: error }, 'Error fetching brain executions');

      logErrorToAdmin({
        user_account_id: (request.query as any)?.userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'autopilot_get_executions',
        endpoint: '/autopilot/executions',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/autopilot/reports
   * Получить отчёты по кампаниям
   */
  app.get('/autopilot/reports', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { telegramId, userAccountId, accountId, limit = '10' } = request.query as {
        telegramId?: string;
        userAccountId?: string;
        accountId?: string; // UUID FK к ad_accounts.id
        limit?: string;
      };

      if (!telegramId) {
        return reply.code(400).send({
          success: false,
          error: 'telegramId is required',
        });
      }

      const limitNum = Math.min(parseInt(limit, 10) || 10, 50);

      log.info({ telegramId, userAccountId, accountId, limit: limitNum }, 'Fetching campaign reports');

      let query = supabase
        .from('campaign_reports')
        .select('id, telegram_id, account_id, report_data, created_at')
        .eq('telegram_id', telegramId);

      let resolvedUserAccountId = userAccountId;

      if (!resolvedUserAccountId && accountId) {
        const { data: adAccount, error: adAccountError } = await supabase
          .from('ad_accounts')
          .select('user_account_id')
          .eq('id', accountId)
          .maybeSingle();

        if (adAccountError) {
          log.warn({ err: adAccountError, accountId }, 'Failed to resolve userAccountId for reports');
        } else {
          resolvedUserAccountId = adAccount?.user_account_id || null;
        }
      }

      if (resolvedUserAccountId && await shouldFilterByAccountId(supabase, resolvedUserAccountId, accountId)) {
        query = query.eq('account_id', accountId);
      }

      const { data: reports, error } = await query
        .order('created_at', { ascending: false })
        .limit(limitNum);

      if (error) {
        log.error({ err: error, telegramId }, 'Error fetching campaign reports');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }

      return reply.send({
        success: true,
        reports: reports || [],
      });
    } catch (error: any) {
      log.error({ err: error }, 'Error fetching campaign reports');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'autopilot_get_reports',
        endpoint: '/autopilot/reports',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/autopilot/status
   * Получить статус автопилота и последнее выполнение
   * Поддерживает мультиаккаунтность через accountId (UUID FK к ad_accounts.id)
   */
  app.get('/autopilot/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userAccountId, accountId } = request.query as {
        userAccountId?: string;
        accountId?: string; // UUID FK к ad_accounts.id
      };

      if (!userAccountId) {
        return reply.code(400).send({
          success: false,
          error: 'userAccountId is required',
        });
      }

      log.info({ userAccountId, accountId }, 'Fetching autopilot status');

      let autopilotEnabled = false;

      // Проверяем режим мультиаккаунтности (см. MULTI_ACCOUNT_GUIDE.md)
      const useMultiAccount = await shouldFilterByAccountId(supabase, userAccountId, accountId);

      if (useMultiAccount && accountId) {
        // Multi-account режим: берём статус из ad_accounts
        const { data: adAccount, error: adError } = await supabase
          .from('ad_accounts')
          .select('autopilot')
          .eq('id', accountId)
          .single();

        if (!adError && adAccount) {
          autopilotEnabled = !!adAccount.autopilot;
        }
      } else {
        // Legacy режим: берём из user_accounts
        const { data: userAccount, error: userError } = await supabase
          .from('user_accounts')
          .select('autopilot')
          .eq('id', userAccountId)
          .single();

        if (userError) {
          log.error({ err: userError, userAccountId }, 'Error fetching user account');
          return reply.code(500).send({
            success: false,
            error: userError.message,
          });
        }
        autopilotEnabled = !!userAccount?.autopilot;
      }

      // Получаем последнее выполнение
      let execQuery = supabase
        .from('brain_executions')
        .select('id, actions_json, report_text, status, duration_ms, created_at')
        .eq('user_account_id', userAccountId);

      // Фильтр по account_id ТОЛЬКО в multi-account режиме
      if (useMultiAccount && accountId) {
        execQuery = execQuery.eq('account_id', accountId);
      }

      const { data: lastExecution, error: execError } = await execQuery
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (execError) {
        log.error({ err: execError, userAccountId }, 'Error fetching last execution');
      }

      // Считаем статистику за последние 7 дней
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      let statsQuery = supabase
        .from('brain_executions')
        .select('status, actions_json')
        .eq('user_account_id', userAccountId)
        .gte('created_at', weekAgo.toISOString());

      // Фильтр по account_id ТОЛЬКО в multi-account режиме
      if (useMultiAccount && accountId) {
        statsQuery = statsQuery.eq('account_id', accountId);
      }

      const { data: weekStats, error: statsError } = await statsQuery;

      let stats = {
        totalExecutions: 0,
        successfulExecutions: 0,
        totalActions: 0,
      };

      if (!statsError && weekStats) {
        stats.totalExecutions = weekStats.length;
        stats.successfulExecutions = weekStats.filter(e => e.status === 'success').length;
        stats.totalActions = weekStats.reduce((sum, e) => {
          const actions = e.actions_json as any[];
          return sum + (Array.isArray(actions) ? actions.length : 0);
        }, 0);
      }

      return reply.send({
        success: true,
        autopilotEnabled,
        lastExecution: lastExecution || null,
        weekStats: stats,
      });
    } catch (error: any) {
      log.error({ err: error }, 'Error fetching autopilot status');

      logErrorToAdmin({
        user_account_id: (request.query as any)?.userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'autopilot_get_status',
        endpoint: '/autopilot/status',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });
}
