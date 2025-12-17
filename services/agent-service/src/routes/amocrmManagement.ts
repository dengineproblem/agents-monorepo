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
import { getValidAmoCRMToken, saveAmoCRMTokens, saveAmoCRMTokensToAdAccount } from '../lib/amocrmTokens.js';
import {
  registerAmoCRMWebhook,
  getWebhookStatus,
  unregisterAmoCRMWebhook
} from '../lib/amocrmWebhook.js';
import { refreshAccessToken } from '../adapters/amocrm.js';
import { supabase } from '../lib/supabase.js';

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

  /**
   * POST /amocrm/force-refresh-token
   *
   * Принудительно обновить access_token AmoCRM
   *
   * Query params:
   *   - userAccountId: UUID аккаунта пользователя
   *   - accountId: UUID ad_account (опционально, для мультиаккаунта)
   *
   * Returns:
   *   - success: boolean
   *   - message: string
   *   - expiresAt: string - когда истечёт новый токен
   */
  app.post('/amocrm/force-refresh-token', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userAccountId, accountId } = request.query as { userAccountId?: string; accountId?: string };

      if (!userAccountId) {
        return reply.code(400).send({
          success: false,
          error: 'validation_error',
          message: 'userAccountId is required'
        });
      }

      // Check if multi-account mode
      const { data: userAccountCheck } = await supabase
        .from('user_accounts')
        .select('multi_account_enabled')
        .eq('id', userAccountId)
        .single();

      const isMultiAccountMode = userAccountCheck?.multi_account_enabled && accountId;

      let subdomain: string;
      let refreshToken: string;
      let clientId: string | undefined;
      let clientSecret: string | undefined;

      let migrateToAdAccount = false;

      if (isMultiAccountMode) {
        // Get credentials from ad_accounts
        const { data: adAccount, error: adError } = await supabase
          .from('ad_accounts')
          .select('amocrm_subdomain, amocrm_refresh_token, amocrm_client_id, amocrm_client_secret')
          .eq('id', accountId)
          .eq('user_account_id', userAccountId)
          .single();

        if (adError || !adAccount) {
          return reply.code(404).send({
            success: false,
            error: 'not_found',
            message: `Ad account not found: ${adError?.message || 'Not found'}`
          });
        }

        if (!adAccount.amocrm_subdomain || !adAccount.amocrm_refresh_token) {
          // Try to get tokens from user_accounts (migration from legacy)
          app.log.info({ userAccountId, accountId }, 'No AmoCRM tokens in ad_accounts, trying to migrate from user_accounts');

          const { data: legacyAccount } = await supabase
            .from('user_accounts')
            .select('amocrm_subdomain, amocrm_refresh_token, amocrm_client_id, amocrm_client_secret')
            .eq('id', userAccountId)
            .single();

          if (!legacyAccount?.amocrm_subdomain || !legacyAccount?.amocrm_refresh_token) {
            return reply.code(400).send({
              success: false,
              error: 'not_connected',
              message: 'AmoCRM is not connected for this ad account (and no legacy tokens found)'
            });
          }

          // Use legacy tokens and mark for migration
          subdomain = legacyAccount.amocrm_subdomain;
          refreshToken = legacyAccount.amocrm_refresh_token;
          clientId = legacyAccount.amocrm_client_id || undefined;
          clientSecret = legacyAccount.amocrm_client_secret || undefined;
          migrateToAdAccount = true;

          app.log.info({ userAccountId, accountId, subdomain }, 'Found legacy tokens, will migrate to ad_accounts');
        } else {
          subdomain = adAccount.amocrm_subdomain;
          refreshToken = adAccount.amocrm_refresh_token;
          clientId = adAccount.amocrm_client_id || undefined;
          clientSecret = adAccount.amocrm_client_secret || undefined;
        }
      } else {
        // Get credentials from user_accounts (legacy)
        const { data: userAccount, error: userError } = await supabase
          .from('user_accounts')
          .select('amocrm_subdomain, amocrm_refresh_token, amocrm_client_id, amocrm_client_secret')
          .eq('id', userAccountId)
          .single();

        if (userError || !userAccount) {
          return reply.code(404).send({
            success: false,
            error: 'not_found',
            message: `User account not found: ${userError?.message || 'Not found'}`
          });
        }

        if (!userAccount.amocrm_subdomain || !userAccount.amocrm_refresh_token) {
          return reply.code(400).send({
            success: false,
            error: 'not_connected',
            message: 'AmoCRM is not connected for this user account'
          });
        }

        subdomain = userAccount.amocrm_subdomain;
        refreshToken = userAccount.amocrm_refresh_token;
        clientId = userAccount.amocrm_client_id || undefined;
        clientSecret = userAccount.amocrm_client_secret || undefined;
      }

      // Refresh the token
      app.log.info({ userAccountId, accountId, subdomain }, 'Force refreshing AmoCRM token');

      const tokens = await refreshAccessToken(refreshToken, subdomain, clientId, clientSecret);

      // Save new tokens
      if (isMultiAccountMode || migrateToAdAccount) {
        await saveAmoCRMTokensToAdAccount(accountId!, subdomain, tokens, clientId, clientSecret);
        if (migrateToAdAccount) {
          app.log.info({ userAccountId, accountId, subdomain }, 'Migrated AmoCRM tokens from user_accounts to ad_accounts');
        }
      } else {
        await saveAmoCRMTokens(userAccountId, subdomain, tokens, clientId, clientSecret);
      }

      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

      app.log.info({ userAccountId, accountId, subdomain, expiresAt }, 'AmoCRM token refreshed successfully');

      return {
        success: true,
        message: 'Token refreshed successfully',
        expiresAt
      };

    } catch (error: any) {
      app.log.error({ error: error.message }, 'Error refreshing AmoCRM token');

      // Check for specific error types
      if (error.message?.includes('revoked') || error.message?.includes('invalid_grant')) {
        return reply.code(401).send({
          success: false,
          error: 'token_revoked',
          message: 'Refresh token has been revoked. User must re-authorize AmoCRM.',
          details: error.message
        });
      }

      return reply.code(500).send({
        success: false,
        error: 'refresh_failed',
        message: error.message
      });
    }
  });
}







