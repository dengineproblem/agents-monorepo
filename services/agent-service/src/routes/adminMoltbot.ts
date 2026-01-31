/**
 * Admin Moltbot Chat Routes
 *
 * API для чата между админами и Moltbot AI агентом
 * - Отправка сообщений в Moltbot
 * - Получение ответов от Moltbot
 *
 * @module routes/adminMoltbot
 */

import { FastifyInstance } from 'fastify';
import { createLogger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

const log = createLogger({ module: 'adminMoltbot' });

// =====================================================
// Типы
// =====================================================

interface SendMessageBody {
  message: string;
  specialist?: string;
}

interface MoltbotResponse {
  response: string;
  specialist?: string;
  sessionId?: string;
}

// =====================================================
// Routes
// =====================================================

export default async function adminMoltbotRoutes(app: FastifyInstance) {

  /**
   * POST /admin/moltbot/chat
   * Отправляет сообщение в Moltbot и получает ответ
   */
  app.post('/admin/moltbot/chat', async (req, res) => {
    try {
      const { message, specialist = 'facebook-ads' } = req.body as SendMessageBody;
      const adminId = req.headers['x-user-id'] as string;

      if (!message || message.trim().length === 0) {
        return res.status(400).send({ error: 'Message is required' });
      }

      log.info({
        adminId,
        specialist,
        messageLength: message.length
      }, 'Admin sending message to Moltbot');

      // Используем admin ID как telegram chat ID для Moltbot
      const telegramChatId = `admin-${adminId}`;

      // Вызываем agent-brain который проксирует к Moltbot
      const agentBrainUrl = process.env.AGENT_BRAIN_URL || 'http://agent-brain:7080';

      const response = await fetch(`${agentBrainUrl}/api/moltbot/route`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          specialist,
          message,
          telegramChatId
        }),
        signal: AbortSignal.timeout(120000) // 2 минуты
      });

      if (!response.ok) {
        const errorText = await response.text();
        log.error({
          status: response.status,
          errorText,
          adminId
        }, 'Moltbot request failed');

        return res.status(response.status).send({
          error: `Moltbot error: ${errorText}`
        });
      }

      const result = await response.json() as MoltbotResponse;

      log.info({
        adminId,
        specialist,
        responseLength: result.response?.length || 0
      }, 'Received response from Moltbot');

      return res.send({
        success: true,
        response: result.response,
        specialist: result.specialist,
        sessionId: result.sessionId
      });

    } catch (err: any) {
      log.error({ error: String(err) }, 'Error sending message to Moltbot');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_moltbot_chat',
        endpoint: '/admin/moltbot/chat',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({
        error: err.message || 'Internal server error'
      });
    }
  });

  /**
   * GET /admin/moltbot/specialists
   * Получает список доступных specialist агентов
   */
  app.get('/admin/moltbot/specialists', async (_req, res) => {
    try {
      const specialists = [
        { id: 'facebook-ads', name: 'Facebook Ads', description: 'Управление Facebook/Instagram рекламой' },
        { id: 'creatives', name: 'Креативы', description: 'Генерация и анализ креативов' },
        { id: 'crm', name: 'CRM', description: 'Работа с лидами и воронкой' },
        { id: 'tiktok', name: 'TikTok', description: 'Управление TikTok рекламой' },
        { id: 'onboarding', name: 'Онбординг', description: 'Помощь в настройке аккаунта' }
      ];

      return res.send({ specialists });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error getting specialists list');
      return res.status(500).send({ error: 'Internal server error' });
    }
  });
}
