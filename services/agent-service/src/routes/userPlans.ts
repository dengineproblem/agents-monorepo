/**
 * User Plans API Routes
 *
 * Проксирует запросы к Supabase для работы с направлениями и планами.
 * Таблицы: user_directions, planned_metrics
 *
 * @module routes/userPlans
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'userPlansRoutes' });

export default async function userPlansRoutes(app: FastifyInstance) {

  // ----------------------------------------
  // GET /user-plans/directions
  // ----------------------------------------
  app.get('/user-plans/directions', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.headers['x-user-id'] || (request.query as any).userId) as string;
    if (!userId) return reply.status(400).send({ error: 'Missing userId' });

    const { data: directions, error: dirError } = await supabase
      .from('user_directions')
      .select('*')
      .eq('user_id', userId);

    if (dirError) {
      log.error({ error: dirError, userId }, 'Failed to fetch directions');
      return reply.status(500).send({ error: 'Failed to fetch directions' });
    }

    if (!directions || directions.length === 0) {
      return reply.send({ directions: [] });
    }

    const directionIds = directions.map((d: any) => d.id);

    const { data: metrics, error: metError } = await supabase
      .from('planned_metrics')
      .select('*')
      .in('user_direction_id', directionIds);

    if (metError) {
      log.error({ error: metError, userId }, 'Failed to fetch metrics');
      return reply.status(500).send({ error: 'Failed to fetch metrics' });
    }

    return reply.send({ directions, metrics: metrics || [] });
  });

  // ----------------------------------------
  // POST /user-plans/directions
  // ----------------------------------------
  app.post('/user-plans/directions', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.headers['x-user-id'] as string;
    if (!userId) return reply.status(401).send({ error: 'Missing x-user-id header' });

    const { main_direction, sub_direction } = request.body as any;

    const { data, error } = await supabase
      .from('user_directions')
      .insert({ user_id: userId, main_direction, sub_direction: sub_direction || null })
      .select()
      .single();

    if (error) {
      log.error({ error, userId }, 'Failed to create direction');
      return reply.status(500).send({ error: 'Failed to create direction' });
    }

    return reply.send(data);
  });

  // ----------------------------------------
  // DELETE /user-plans/directions/:id
  // ----------------------------------------
  app.delete('/user-plans/directions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.headers['x-user-id'] as string;
    if (!userId) return reply.status(401).send({ error: 'Missing x-user-id header' });

    const { id } = request.params as { id: string };
    const directionId = parseInt(id);

    // Каскадное удаление: сначала метрики, потом направление
    await supabase.from('planned_metrics').delete().eq('user_direction_id', directionId);

    const { error } = await supabase
      .from('user_directions')
      .delete()
      .eq('id', directionId)
      .eq('user_id', userId);

    if (error) {
      log.error({ error, userId, directionId }, 'Failed to delete direction');
      return reply.status(500).send({ error: 'Failed to delete direction' });
    }

    return reply.send({ success: true });
  });

  // ----------------------------------------
  // POST /user-plans/metrics
  // ----------------------------------------
  app.post('/user-plans/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.headers['x-user-id'] as string;
    if (!userId) return reply.status(401).send({ error: 'Missing x-user-id header' });

    const { user_direction_id, metric_type, planned_daily_value } = request.body as any;

    const { data, error } = await supabase
      .from('planned_metrics')
      .upsert({
        user_direction_id,
        metric_type,
        planned_daily_value,
      })
      .select();

    if (error) {
      log.error({ error, userId }, 'Failed to upsert metric');
      return reply.status(500).send({ error: 'Failed to upsert metric' });
    }

    return reply.send(data);
  });

  // ----------------------------------------
  // DELETE /user-plans/metrics
  // ----------------------------------------
  app.delete('/user-plans/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.headers['x-user-id'] as string;
    if (!userId) return reply.status(401).send({ error: 'Missing x-user-id header' });

    const { directionIds } = request.body as { directionIds: number[] };

    if (!directionIds || directionIds.length === 0) {
      return reply.status(400).send({ error: 'Missing directionIds' });
    }

    const { error } = await supabase
      .from('planned_metrics')
      .delete()
      .in('user_direction_id', directionIds);

    if (error) {
      log.error({ error, userId }, 'Failed to delete metrics');
      return reply.status(500).send({ error: 'Failed to delete metrics' });
    }

    return reply.send({ success: true });
  });

  // ----------------------------------------
  // PUT /user-plans/save-all
  // Full save: delete existing + create new
  // ----------------------------------------
  app.put('/user-plans/save-all', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.headers['x-user-id'] as string;
    if (!userId) return reply.status(401).send({ error: 'Missing x-user-id header' });

    const { plans } = request.body as { plans: Array<{
      mainDirection: string;
      subDirection?: string | null;
      monthlyLeadsPlan: number;
      monthlySpendPlan: number;
    }> };

    // 1. Get existing directions
    const { data: existing } = await supabase
      .from('user_directions')
      .select('id')
      .eq('user_id', userId);

    // 2. Delete existing metrics + directions
    if (existing && existing.length > 0) {
      const ids = existing.map((d: any) => d.id);
      await supabase.from('planned_metrics').delete().in('user_direction_id', ids);
      await supabase.from('user_directions').delete().eq('user_id', userId);
    }

    // 3. Create new directions + metrics
    const created = [];
    for (const plan of plans) {
      const { data: dir, error: dirErr } = await supabase
        .from('user_directions')
        .insert({
          user_id: userId,
          main_direction: plan.mainDirection,
          sub_direction: plan.subDirection || null,
        })
        .select()
        .single();

      if (dirErr || !dir) {
        log.error({ error: dirErr, userId }, 'Failed to create direction');
        return reply.status(500).send({ error: 'Failed to create direction' });
      }

      // Create leads metric
      await supabase.from('planned_metrics').insert({
        user_direction_id: (dir as any).id,
        metric_type: 'leads',
        planned_daily_value: plan.monthlyLeadsPlan || 0,
      });

      // Create spend metric
      await supabase.from('planned_metrics').insert({
        user_direction_id: (dir as any).id,
        metric_type: 'spend',
        planned_daily_value: plan.monthlySpendPlan || 0,
      });

      created.push(dir);
    }

    return reply.send({ success: true, count: created.length });
  });
}
