/**
 * Reports & Targetolog Journal API Routes
 *
 * GET /campaign-reports — отчёты по кампаниям
 * GET /targetolog-actions — журнал действий таргетолога
 *
 * @module routes/reportsRoutes
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'reportsRoutes' });

export default async function reportsRoutes(app: FastifyInstance) {

  // ----------------------------------------
  // GET /campaign-reports
  // ----------------------------------------
  app.get('/campaign-reports', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'Missing x-user-id header' });
      }

      const { platform, accountId } = req.query as {
        platform?: string;
        accountId?: string;
      };

      let query = supabase
        .from('campaign_reports')
        .select('*')
        .eq('telegram_id', userId);

      if (platform) {
        query = query.eq('platform', platform);
      }

      if (accountId) {
        query = query.eq('account_id', accountId);
      } else {
        query = query.is('account_id', null);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false });

      if (error) {
        log.error({ error, userId }, 'Failed to fetch campaign reports');
        return reply.status(500).send({ error: 'Failed to fetch campaign reports' });
      }

      return data || [];

    } catch (error: any) {
      log.error({ error }, 'Error fetching campaign reports');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // GET /targetolog-actions
  // ----------------------------------------
  app.get('/targetolog-actions', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'Missing x-user-id header' });
      }

      const { limit: limitParam } = req.query as { limit?: string };
      const limitNum = limitParam ? parseInt(limitParam, 10) : 50;

      const { data, error } = await supabase
        .from('targetolog_actions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limitNum);

      if (error) {
        log.error({ error, userId }, 'Failed to fetch targetolog actions');
        return reply.status(500).send({ error: 'Failed to fetch targetolog actions' });
      }

      return data || [];

    } catch (error: any) {
      log.error({ error }, 'Error fetching targetolog actions');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });
}
