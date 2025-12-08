/**
 * Admin Settings Routes
 *
 * API для настроек админ-панели
 *
 * @module routes/adminSettings
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'adminSettings' });

// In-memory settings (в реальном приложении можно хранить в БД)
let adminSettings = {
  notifications: {
    messages_enabled: true,
    registrations_enabled: true,
    system_enabled: true,
    errors_enabled: true,
    daily_limit: 100,
    weekly_limit: 500,
    cooldown_minutes: 5,
  },
};

export default async function adminSettingsRoutes(app: FastifyInstance) {

  /**
   * GET /admin/settings
   * Получить текущие настройки
   */
  app.get('/admin/settings', async (req, res) => {
    try {
      return res.send(adminSettings);
    } catch (err) {
      log.error({ error: String(err) }, 'Error fetching settings');
      return res.status(500).send({ error: 'Failed to fetch settings' });
    }
  });

  /**
   * PUT /admin/settings
   * Обновить настройки
   */
  app.put('/admin/settings', async (req, res) => {
    try {
      const { notifications } = req.body as any;

      if (notifications) {
        adminSettings.notifications = {
          ...adminSettings.notifications,
          ...notifications,
        };
      }

      log.info({ settings: adminSettings }, 'Settings updated');

      return res.send({ success: true, settings: adminSettings });
    } catch (err) {
      log.error({ error: String(err) }, 'Error updating settings');
      return res.status(500).send({ error: 'Failed to update settings' });
    }
  });

  /**
   * GET /admin/cron/status
   * Получить статус CRON задач
   */
  app.get('/admin/cron/status', async (req, res) => {
    try {
      // TODO: Реализовать получение реального статуса из cron задач
      const crons = [
        {
          name: 'Creative Test Checker',
          status: 'running' as const,
          lastRun: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        },
        {
          name: 'WhatsApp Monitor',
          status: 'running' as const,
          lastRun: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        },
        {
          name: 'Competitor Crawler',
          status: 'running' as const,
          lastRun: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          name: 'User Scoring',
          status: 'running' as const,
          lastRun: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          name: 'Engagement Notifications',
          status: 'running' as const,
          lastRun: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        },
      ];

      return res.send({ crons });
    } catch (err) {
      log.error({ error: String(err) }, 'Error fetching cron status');
      return res.status(500).send({ error: 'Failed to fetch cron status' });
    }
  });
}
