/**
 * User Creatives API Routes
 *
 * CRUD для user_creatives, получение generated_creatives,
 * транскриптов, метрик, тестов и bulk-запросов.
 *
 * @module routes/userCreatives
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { shouldFilterByAccountId } from '../lib/multiAccountHelper.js';

const log = createLogger({ module: 'userCreativesRoutes' });

export default async function userCreativesRoutes(app: FastifyInstance) {

  // ----------------------------------------
  // GET /user-creatives
  // ----------------------------------------
  app.get('/user-creatives', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const { userId: queryUserId, accountId, status } = req.query as {
        userId?: string;
        accountId?: string;
        status?: string;
      };

      const effectiveUserId = userId || queryUserId;
      if (!effectiveUserId) {
        return reply.status(400).send({ error: 'Missing userId or x-user-id' });
      }

      const statusArray = status
        ? status.split(',').map(s => s.trim()).filter(Boolean)
        : ['ready', 'partial_ready', 'uploaded'];

      let query = supabase
        .from('user_creatives')
        .select('*')
        .eq('user_id', effectiveUserId)
        .in('status', statusArray)
        .order('created_at', { ascending: false });

      if (accountId && await shouldFilterByAccountId(supabase, effectiveUserId, accountId)) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;

      if (error) {
        log.error({ error, userId: effectiveUserId }, 'Failed to fetch user creatives');
        return reply.status(500).send({ error: 'Failed to fetch user creatives' });
      }

      return data || [];

    } catch (error: any) {
      log.error({ error }, 'Error fetching user creatives');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // POST /user-creatives
  // ----------------------------------------
  app.post('/user-creatives', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'Missing x-user-id header' });
      }

      const body = req.body as Record<string, unknown>;

      // IDOR protection: force user_id from header
      const data = { ...body, user_id: userId };

      const { data: inserted, error } = await supabase
        .from('user_creatives')
        .insert(data)
        .select('*')
        .single();

      if (error) {
        log.error({ error, userId }, 'Failed to insert user creative');
        return reply.status(500).send({ error: 'Failed to create user creative' });
      }

      return inserted;

    } catch (error: any) {
      log.error({ error }, 'Error creating user creative');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // PATCH /user-creatives/:id
  // ----------------------------------------
  app.patch('/user-creatives/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'Missing x-user-id header' });
      }

      const { id } = req.params as { id: string };
      const body = req.body as Record<string, unknown>;

      // IDOR protection: ensure ownership via user_id
      const { data: updated, error } = await supabase
        .from('user_creatives')
        .update(body)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        log.error({ error, userId, id }, 'Failed to update user creative');
        return reply.status(500).send({ error: 'Failed to update user creative' });
      }

      if (!updated) {
        return reply.status(404).send({ error: 'User creative not found or not owned by user' });
      }

      return updated;

    } catch (error: any) {
      log.error({ error }, 'Error updating user creative');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // DELETE /user-creatives/:id
  // ----------------------------------------
  app.delete('/user-creatives/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'Missing x-user-id header' });
      }

      const { id } = req.params as { id: string };

      // IDOR protection: ensure ownership via user_id
      const { error } = await supabase
        .from('user_creatives')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) {
        log.error({ error, userId, id }, 'Failed to delete user creative');
        return reply.status(500).send({ error: 'Failed to delete user creative' });
      }

      return { success: true };

    } catch (error: any) {
      log.error({ error }, 'Error deleting user creative');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // GET /user-creatives/:id/generated
  // ----------------------------------------
  app.get('/user-creatives/:id/generated', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'Missing x-user-id header' });
      }

      const { id } = req.params as { id: string };

      // Get user_creative with IDOR protection
      const { data: creative, error: creativeError } = await supabase
        .from('user_creatives')
        .select('generated_creative_id, carousel_data')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (creativeError || !creative) {
        return reply.status(404).send({ error: 'User creative not found or not owned by user' });
      }

      let generated = null;
      if (creative.generated_creative_id) {
        const { data: genData, error: genError } = await supabase
          .from('generated_creatives')
          .select('id, offer, bullets, profits, carousel_data, creative_type')
          .eq('id', creative.generated_creative_id)
          .single();

        if (genError) {
          log.error({ error: genError, generatedCreativeId: creative.generated_creative_id }, 'Failed to fetch generated creative');
        } else {
          generated = genData;
        }
      }

      return { creative, generated };

    } catch (error: any) {
      log.error({ error }, 'Error fetching generated creative data');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // GET /user-creatives/:id/transcript
  // ----------------------------------------
  app.get('/user-creatives/:id/transcript', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'Missing x-user-id header' });
      }

      const { id } = req.params as { id: string };

      const { data, error } = await supabase
        .from('creative_transcripts')
        .select('text, created_at')
        .eq('creative_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        log.error({ error, creativeId: id }, 'Failed to fetch creative transcript');
        return reply.status(500).send({ error: 'Failed to fetch creative transcript' });
      }

      return data || null;

    } catch (error: any) {
      log.error({ error }, 'Error fetching creative transcript');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // GET /user-creatives/metrics
  // ----------------------------------------
  app.get('/user-creatives/metrics', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const {
        userId: queryUserId,
        userCreativeIds,
        adIds,
        dateFrom,
        dateTo,
        accountId,
        source,
      } = req.query as {
        userId?: string;
        userCreativeIds?: string;
        adIds?: string;
        dateFrom?: string;
        dateTo?: string;
        accountId?: string;
        source?: string;
      };

      const effectiveUserId = userId || queryUserId;
      if (!effectiveUserId) {
        return reply.status(400).send({ error: 'Missing userId or x-user-id' });
      }

      let query = supabase
        .from('creative_metrics_history')
        .select('*')
        .eq('user_account_id', effectiveUserId);

      if (userCreativeIds) {
        const ids = userCreativeIds.split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length > 0) {
          query = query.in('user_creative_id', ids);
        }
      }

      if (adIds) {
        const ids = adIds.split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length > 0) {
          query = query.in('ad_id', ids);
        }
      }

      if (dateFrom) {
        query = query.gte('date', dateFrom);
      }

      if (dateTo) {
        query = query.lte('date', dateTo);
      }

      if (source) {
        query = query.eq('source', source);
      }

      if (accountId && await shouldFilterByAccountId(supabase, effectiveUserId, accountId)) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;

      if (error) {
        log.error({ error, userId: effectiveUserId }, 'Failed to fetch creative metrics');
        return reply.status(500).send({ error: 'Failed to fetch creative metrics' });
      }

      return data || [];

    } catch (error: any) {
      log.error({ error }, 'Error fetching creative metrics');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // GET /user-creatives/tests
  // ----------------------------------------
  app.get('/user-creatives/tests', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const { userId: queryUserId, creativeIds } = req.query as {
        userId?: string;
        creativeIds?: string;
      };

      const effectiveUserId = userId || queryUserId;
      if (!effectiveUserId) {
        return reply.status(400).send({ error: 'Missing userId or x-user-id' });
      }

      if (!creativeIds) {
        return reply.status(400).send({ error: 'Missing creativeIds parameter' });
      }

      const ids = creativeIds.split(',').map(s => s.trim()).filter(Boolean);

      const { data, error } = await supabase
        .from('creative_tests')
        .select('user_creative_id, status, started_at, completed_at, impressions, created_at')
        .in('user_creative_id', ids)
        .order('created_at', { ascending: false });

      if (error) {
        log.error({ error, userId: effectiveUserId }, 'Failed to fetch creative tests');
        return reply.status(500).send({ error: 'Failed to fetch creative tests' });
      }

      return data || [];

    } catch (error: any) {
      log.error({ error }, 'Error fetching creative tests');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // GET /user-creatives/by-ids
  // ----------------------------------------
  app.get('/user-creatives/by-ids', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const { userId: queryUserId, ids: idsParam } = req.query as {
        userId?: string;
        ids?: string;
      };

      const effectiveUserId = userId || queryUserId;
      if (!effectiveUserId) {
        return reply.status(400).send({ error: 'Missing userId or x-user-id' });
      }

      if (!idsParam) {
        return reply.status(400).send({ error: 'Missing ids parameter' });
      }

      const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean);

      const { data, error } = await supabase
        .from('user_creatives')
        .select('id, title, created_at, media_type, image_url, thumbnail_url, carousel_data, generated_creative_id, fb_video_id, direction_id')
        .eq('user_id', effectiveUserId)
        .in('id', ids);

      if (error) {
        log.error({ error, userId: effectiveUserId }, 'Failed to fetch user creatives by ids');
        return reply.status(500).send({ error: 'Failed to fetch user creatives by ids' });
      }

      return data || [];

    } catch (error: any) {
      log.error({ error }, 'Error fetching user creatives by ids');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // GET /user-creatives/generated-bulk
  // ----------------------------------------
  app.get('/user-creatives/generated-bulk', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { generatedIds } = req.query as { generatedIds?: string };

      if (!generatedIds) {
        return reply.status(400).send({ error: 'Missing generatedIds parameter' });
      }

      const ids = generatedIds.split(',').map(s => s.trim()).filter(Boolean);

      const { data, error } = await supabase
        .from('generated_creatives')
        .select('id, carousel_data')
        .in('id', ids);

      if (error) {
        log.error({ error }, 'Failed to fetch generated creatives bulk');
        return reply.status(500).send({ error: 'Failed to fetch generated creatives' });
      }

      return data || [];

    } catch (error: any) {
      log.error({ error }, 'Error fetching generated creatives bulk');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });
}
