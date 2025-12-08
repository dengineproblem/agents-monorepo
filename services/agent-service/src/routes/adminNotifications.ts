/**
 * Admin Notifications Routes
 *
 * API для уведомлений в админ-панели
 *
 * @module routes/adminNotifications
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'adminNotifications' });

export default async function adminNotificationsRoutes(app: FastifyInstance) {

  /**
   * GET /admin/notifications
   * Получить список уведомлений
   */
  app.get('/admin/notifications', async (req, res) => {
    try {
      const { limit = '50' } = req.query as { limit?: string };

      const { data: notifications, error } = await supabase
        .from('admin_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(parseInt(limit));

      if (error) throw error;

      return res.send({ notifications: notifications || [] });
    } catch (err) {
      log.error({ error: String(err) }, 'Error fetching notifications');
      return res.status(500).send({ error: 'Failed to fetch notifications' });
    }
  });

  /**
   * GET /admin/notifications/unread-count
   * Получить количество непрочитанных уведомлений
   */
  app.get('/admin/notifications/unread-count', async (req, res) => {
    try {
      const { count } = await supabase
        .from('admin_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('is_read', false);

      return res.send({ count: count || 0 });
    } catch (err) {
      log.error({ error: String(err) }, 'Error fetching unread count');
      return res.send({ count: 0 });
    }
  });

  /**
   * POST /admin/notifications/:id/read
   * Отметить уведомление как прочитанное
   */
  app.post('/admin/notifications/:id/read', async (req, res) => {
    try {
      const { id } = req.params as { id: string };

      const { error } = await supabase
        .from('admin_notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;

      return res.send({ success: true });
    } catch (err) {
      log.error({ error: String(err) }, 'Error marking notification as read');
      return res.status(500).send({ error: 'Failed to mark as read' });
    }
  });

  /**
   * POST /admin/notifications/mark-all-read
   * Отметить все уведомления как прочитанные
   */
  app.post('/admin/notifications/mark-all-read', async (req, res) => {
    try {
      const { error } = await supabase
        .from('admin_notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq('is_read', false);

      if (error) throw error;

      return res.send({ success: true });
    } catch (err) {
      log.error({ error: String(err) }, 'Error marking all as read');
      return res.status(500).send({ error: 'Failed to mark all as read' });
    }
  });
}
