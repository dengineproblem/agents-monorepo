/**
 * AmoCRM Management Routes
 * 
 * API endpoints для управления интеграцией AmoCRM:
 * - Проверка статуса вебхука
 * - Ручная регистрация вебхука
 * - Синхронизация воронок
 * 
 * @module routes/amocrmManagement
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getValidAmoCRMToken } from '../lib/amocrmTokens.js';
import { 
  registerAmoCRMWebhook, 
  getWebhookStatus,
  unregisterAmoCRMWebhook
} from '../lib/amocrmWebhook.js';

/**
 * Query schema for userAccountId
 */
const UserAccountIdSchema = z.object({
  userAccountId: z.string().uuid()
});

export default async function amocrmManagementRoutes(app: FastifyInstance) {
  /**
   * GET /amocrm/webhook-status
   * 
   * Проверить статус регистрации вебхука AmoCRM для пользователя
   * 
   * Query params:
   *   - userAccountId: UUID аккаунта пользователя
   * 
   * Returns:
   *   - success: boolean
   *   - registered: boolean - зарегистрирован ли вебхук
   *   - webhookUrl: string | undefined - URL вебхука (если зарегистрирован)
   */
  app.get('/amocrm/webhook-status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = UserAccountIdSchema.safeParse(request.query);
      
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }
      
      const { userAccountId } = parsed.data;
      
      // Get valid AmoCRM token
      const { accessToken, subdomain } = await getValidAmoCRMToken(userAccountId);
      
      // Check webhook status
      const status = await getWebhookStatus(subdomain, accessToken, userAccountId);
      
      return { 
        success: true, 
        ...status 
      };
      
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error checking webhook status');
      
      return reply.code(500).send({
        success: false,
        error: 'Failed to check webhook status',
        message: error.message
      });
    }
  });

  /**
   * POST /amocrm/register-webhook
   * 
   * Зарегистрировать вебхук AmoCRM вручную
   * 
   * Query params:
   *   - userAccountId: UUID аккаунта пользователя
   * 
   * Returns:
   *   - success: boolean
   *   - message: string
   */
  app.post('/amocrm/register-webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = UserAccountIdSchema.safeParse(request.query);
      
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }
      
      const { userAccountId } = parsed.data;
      
      // Get valid AmoCRM token
      const { accessToken, subdomain } = await getValidAmoCRMToken(userAccountId);
      
      // Register webhook
      await registerAmoCRMWebhook(userAccountId, subdomain, accessToken);
      
      app.log.info({ userAccountId, subdomain }, 'Webhook registered manually');
      
      return { 
        success: true, 
        message: 'Webhook registered successfully' 
      };
      
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error registering webhook');
      
      return reply.code(500).send({
        success: false,
        error: 'Failed to register webhook',
        message: error.message
      });
    }
  });

  /**
   * POST /amocrm/unregister-webhook
   * 
   * Отменить регистрацию вебхука AmoCRM
   * 
   * Query params:
   *   - userAccountId: UUID аккаунта пользователя
   * 
   * Returns:
   *   - success: boolean
   *   - message: string
   */
  app.post('/amocrm/unregister-webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = UserAccountIdSchema.safeParse(request.query);
      
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }
      
      const { userAccountId } = parsed.data;
      
      // Get valid AmoCRM token
      const { accessToken, subdomain } = await getValidAmoCRMToken(userAccountId);
      
      // Unregister webhook
      await unregisterAmoCRMWebhook(subdomain, accessToken, userAccountId);
      
      app.log.info({ userAccountId, subdomain }, 'Webhook unregistered');
      
      return { 
        success: true, 
        message: 'Webhook unregistered successfully' 
      };
      
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error unregistering webhook');
      
      return reply.code(500).send({
        success: false,
        error: 'Failed to unregister webhook',
        message: error.message
      });
    }
  });
}






