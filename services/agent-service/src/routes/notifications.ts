/**
 * Notifications API Routes
 *
 * Handles user notifications (in-app and telegram)
 *
 * @module routes/notifications
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger({ module: 'notificationsRoutes' });

// =====================================================
// Schemas
// =====================================================

const QuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  unreadOnly: z.coerce.boolean().default(false)
});

// =====================================================
// Routes
// =====================================================

export default async function notificationsRoutes(app: FastifyInstance) {
  /**
   * GET /notifications
   *
   * Получить список уведомлений пользователя
   */
  app.get('/notifications', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.headers['x-user-id'] as string;

    if (!userId) {
      return reply.code(401).send({ error: 'User ID required' });
    }

    const query = QuerySchema.safeParse(request.query);
    const { limit, offset, unreadOnly } = query.success
      ? query.data
      : { limit: 20, offset: 0, unreadOnly: false };

    try {
      let queryBuilder = supabase
        .from('user_notifications')
        .select('*', { count: 'exact' })
        .eq('user_account_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (unreadOnly) {
        queryBuilder = queryBuilder.eq('is_read', false);
      }

      const { data, error, count } = await queryBuilder;

      if (error) {
        logger.error({ error: error.message, userId }, 'Failed to fetch notifications');
        return reply.code(500).send({ error: error.message });
      }

      return reply.send({
        notifications: data || [],
        total: count || 0,
        limit,
        offset
      });
    } catch (err) {
      logger.error({ error: String(err), userId }, 'Exception in GET /notifications');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /notifications/unread-count
   *
   * Количество непрочитанных уведомлений
   */
  app.get('/notifications/unread-count', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.headers['x-user-id'] as string;

    if (!userId) {
      return reply.code(401).send({ error: 'User ID required' });
    }

    try {
      const { count, error } = await supabase
        .from('user_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_account_id', userId)
        .eq('is_read', false);

      if (error) {
        logger.error({ error: error.message, userId }, 'Failed to count unread notifications');
        return reply.code(500).send({ error: error.message });
      }

      return reply.send({ unreadCount: count || 0 });
    } catch (err) {
      logger.error({ error: String(err), userId }, 'Exception in GET /notifications/unread-count');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /notifications/:id/read
   *
   * Отметить уведомление как прочитанное
   */
  app.patch('/notifications/:id/read', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const userId = request.headers['x-user-id'] as string;

    if (!userId) {
      return reply.code(401).send({ error: 'User ID required' });
    }

    try {
      const { error } = await supabase
        .from('user_notifications')
        .update({ is_read: true })
        .eq('id', id)
        .eq('user_account_id', userId);

      if (error) {
        logger.error({ error: error.message, id, userId }, 'Failed to mark notification as read');
        return reply.code(500).send({ error: error.message });
      }

      return reply.send({ success: true });
    } catch (err) {
      logger.error({ error: String(err), id, userId }, 'Exception in PATCH /notifications/:id/read');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /notifications/mark-all-read
   *
   * Отметить все уведомления как прочитанные
   */
  app.post('/notifications/mark-all-read', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.headers['x-user-id'] as string;

    if (!userId) {
      return reply.code(401).send({ error: 'User ID required' });
    }

    try {
      // Сначала считаем сколько нужно обновить
      const { count } = await supabase
        .from('user_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_account_id', userId)
        .eq('is_read', false);

      // Обновляем
      const { error } = await supabase
        .from('user_notifications')
        .update({ is_read: true })
        .eq('user_account_id', userId)
        .eq('is_read', false);

      if (error) {
        logger.error({ error: error.message, userId }, 'Failed to mark all notifications as read');
        return reply.code(500).send({ error: error.message });
      }

      logger.info({ userId, markedCount: count }, 'All notifications marked as read');

      return reply.send({ success: true, markedCount: count || 0 });
    } catch (err) {
      logger.error({ error: String(err), userId }, 'Exception in POST /notifications/mark-all-read');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * DELETE /notifications/:id
   *
   * Удалить уведомление
   */
  app.delete('/notifications/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const userId = request.headers['x-user-id'] as string;

    if (!userId) {
      return reply.code(401).send({ error: 'User ID required' });
    }

    try {
      const { error } = await supabase
        .from('user_notifications')
        .delete()
        .eq('id', id)
        .eq('user_account_id', userId);

      if (error) {
        logger.error({ error: error.message, id, userId }, 'Failed to delete notification');
        return reply.code(500).send({ error: error.message });
      }

      return reply.send({ success: true });
    } catch (err) {
      logger.error({ error: String(err), id, userId }, 'Exception in DELETE /notifications/:id');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
