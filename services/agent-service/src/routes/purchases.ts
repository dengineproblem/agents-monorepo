/**
 * Purchases API Routes
 *
 * Проксирует запросы к Supabase для работы с покупками,
 * CAPI-событиями, ad creative mapping и creative analysis.
 *
 * @module routes/purchases
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { shouldFilterByAccountId } from '../lib/multiAccountHelper.js';

const log = createLogger({ module: 'purchasesRoutes' });

export default async function purchasesRoutes(app: FastifyInstance) {

  // ----------------------------------------
  // GET /purchases
  // ----------------------------------------
  app.get('/purchases', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const { userAccountId, accountId, limit = '10000' } = req.query as {
        userAccountId?: string;
        accountId?: string;
        limit?: string;
      };

      const effectiveUserId = userId || userAccountId;
      if (!effectiveUserId) {
        return reply.status(400).send({ error: 'Missing userAccountId or x-user-id' });
      }

      let query = supabase
        .from('purchases')
        .select('*')
        .eq('user_account_id', effectiveUserId)
        .order('created_at', { ascending: false })
        .limit(parseInt(limit));

      if (accountId && await shouldFilterByAccountId(supabase, effectiveUserId, accountId)) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;

      if (error) {
        log.error({ error, userId: effectiveUserId }, 'Failed to fetch purchases');
        return reply.status(500).send({ error: 'Failed to fetch purchases' });
      }

      return data || [];

    } catch (error: any) {
      log.error({ error }, 'Error fetching purchases');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // POST /purchases
  // ----------------------------------------
  app.post('/purchases', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'Missing x-user-id header' });
      }

      const body = req.body as Record<string, unknown>;

      // IDOR protection: force user_account_id from header
      const data = { ...body, user_account_id: userId };

      const { data: inserted, error } = await supabase
        .from('purchases')
        .insert(data)
        .select();

      if (error) {
        log.error({ error, userId }, 'Failed to insert purchase');
        return reply.status(500).send({ error: 'Failed to create purchase' });
      }

      return inserted;

    } catch (error: any) {
      log.error({ error }, 'Error creating purchase');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // PATCH /purchases/:id
  // ----------------------------------------
  app.patch('/purchases/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'Missing x-user-id header' });
      }

      const { id } = req.params as { id: string };
      const body = req.body as Record<string, unknown>;

      // IDOR protection: ensure ownership via user_account_id
      const { data: updated, error } = await supabase
        .from('purchases')
        .update(body)
        .eq('id', id)
        .eq('user_account_id', userId)
        .select();

      if (error) {
        log.error({ error, userId, id }, 'Failed to update purchase');
        return reply.status(500).send({ error: 'Failed to update purchase' });
      }

      if (!updated || updated.length === 0) {
        return reply.status(404).send({ error: 'Purchase not found or not owned by user' });
      }

      return updated;

    } catch (error: any) {
      log.error({ error }, 'Error updating purchase');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // GET /capi-events
  // ----------------------------------------
  app.get('/capi-events', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const { userAccountId, leadIds } = req.query as {
        userAccountId?: string;
        leadIds?: string;
      };

      const effectiveUserId = userId || userAccountId;
      if (!effectiveUserId) {
        return reply.status(400).send({ error: 'Missing userAccountId or x-user-id' });
      }

      let query = supabase
        .from('capi_events_log')
        .select('lead_id, contact_phone, event_level, capi_status')
        .eq('user_account_id', effectiveUserId);

      if (leadIds) {
        const ids = leadIds.split(',').map(Number).filter(n => !isNaN(n));
        if (ids.length > 0) {
          query = query.in('lead_id', ids);
        }
      }

      const { data, error } = await query;

      if (error) {
        log.error({ error, userId: effectiveUserId }, 'Failed to fetch capi events');
        return reply.status(500).send({ error: 'Failed to fetch capi events' });
      }

      return data || [];

    } catch (error: any) {
      log.error({ error }, 'Error fetching capi events');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // GET /ad-creative-mapping
  // ----------------------------------------
  app.get('/ad-creative-mapping', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const { userAccountId, userCreativeIds } = req.query as {
        userAccountId?: string;
        userCreativeIds?: string;
      };

      const effectiveUserId = userId || userAccountId;
      if (!effectiveUserId) {
        return reply.status(400).send({ error: 'Missing userAccountId or x-user-id' });
      }

      if (!userCreativeIds) {
        return reply.status(400).send({ error: 'Missing userCreativeIds parameter' });
      }

      const ids = userCreativeIds.split(',').map(s => s.trim()).filter(Boolean);

      const { data, error } = await supabase
        .from('ad_creative_mapping')
        .select('ad_id, user_creative_id')
        .eq('user_id', effectiveUserId)
        .in('user_creative_id', ids);

      if (error) {
        log.error({ error, userId: effectiveUserId }, 'Failed to fetch ad creative mapping');
        return reply.status(500).send({ error: 'Failed to fetch ad creative mapping' });
      }

      return data || [];

    } catch (error: any) {
      log.error({ error }, 'Error fetching ad creative mapping');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // GET /creative-analysis-results
  // ----------------------------------------
  app.get('/creative-analysis-results', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const { userAccountId, creativeIds } = req.query as {
        userAccountId?: string;
        creativeIds?: string;
      };

      const effectiveUserId = userId || userAccountId;
      if (!effectiveUserId) {
        return reply.status(400).send({ error: 'Missing userAccountId or x-user-id' });
      }

      let query = supabase
        .from('creative_analysis')
        .select('*')
        .eq('user_account_id', effectiveUserId);

      if (creativeIds) {
        const ids = creativeIds.split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length > 0) {
          query = query.in('creative_id', ids);
        }
      }

      const { data, error } = await query;

      if (error) {
        log.error({ error, userId: effectiveUserId }, 'Failed to fetch creative analysis results');
        return reply.status(500).send({ error: 'Failed to fetch creative analysis results' });
      }

      return data || [];

    } catch (error: any) {
      log.error({ error }, 'Error fetching creative analysis results');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });
}
