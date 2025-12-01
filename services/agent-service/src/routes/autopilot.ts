import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

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

      // Если указан accountId - фильтруем по нему
      if (accountId) {
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
      const { telegramId, limit = '10' } = request.query as { telegramId?: string; limit?: string };

      if (!telegramId) {
        return reply.code(400).send({
          success: false,
          error: 'telegramId is required',
        });
      }

      const limitNum = Math.min(parseInt(limit, 10) || 10, 50);

      log.info({ telegramId, limit: limitNum }, 'Fetching campaign reports');

      const { data: reports, error } = await supabase
        .from('campaign_reports')
        .select('id, telegram_id, report_data, created_at')
        .eq('telegram_id', telegramId)
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

      // Если указан accountId - берём статус из ad_accounts
      if (accountId) {
        const { data: adAccount, error: adError } = await supabase
          .from('ad_accounts')
          .select('autopilot')
          .eq('id', accountId)
          .single();

        if (!adError && adAccount) {
          autopilotEnabled = !!adAccount.autopilot;
        }
      } else {
        // Иначе из user_accounts (legacy)
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

      if (accountId) {
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

      if (accountId) {
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
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });
}
