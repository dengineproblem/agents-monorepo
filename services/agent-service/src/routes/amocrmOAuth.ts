/**
 * AmoCRM OAuth Routes
 *
 * Handles OAuth2 authentication flow for AmoCRM integration
 *
 * @module routes/amocrmOAuth
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { exchangeCodeForToken, getAccountInfo } from '../adapters/amocrm.js';
import {
  saveAmoCRMTokens,
  disconnectAmoCRM,
  getAmoCRMStatus
} from '../lib/amocrmTokens.js';
import {
  getTempCredentials,
  deleteTempCredentials
} from '../lib/amocrmTempCredentials.js';

const AMOCRM_CLIENT_ID = process.env.AMOCRM_CLIENT_ID;
const AMOCRM_REDIRECT_URI = process.env.AMOCRM_REDIRECT_URI;

/**
 * Query parameters for /auth endpoint
 */
const AuthQuerySchema = z.object({
  userAccountId: z.string().uuid(),
  subdomain: z.string().min(1).max(100)
});

/**
 * Query parameters for /callback endpoint
 */
const CallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1), // Contains userAccountId and subdomain
  referer: z.string().optional(),
  client_id: z.string().optional()
});

/**
 * Query parameters for /status endpoint
 */
const StatusQuerySchema = z.object({
  userAccountId: z.string().uuid()
});

/**
 * Query parameters for /disconnect endpoint
 */
const DisconnectQuerySchema = z.object({
  userAccountId: z.string().uuid()
});

export default async function amocrmOAuthRoutes(app: FastifyInstance) {
  /**
   * GET /amocrm/auth
   * External URL: /api/amocrm/auth (nginx adds /api/ prefix)
   *
   * Initiates OAuth flow by redirecting user to AmoCRM authorization page
   *
   * Query params:
   *   - userAccountId: UUID of user account
   *   - subdomain: AmoCRM subdomain (e.g., "amo" from amo.amocrm.ru)
   *
   * Returns: Redirect to AmoCRM OAuth page
   */
  app.get('/amocrm/auth', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = AuthQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId, subdomain } = parsed.data;

      if (!AMOCRM_CLIENT_ID || !AMOCRM_REDIRECT_URI) {
        return reply.code(500).send({
          error: 'AmoCRM OAuth not configured on server'
        });
      }

      // Encode state with userAccountId and subdomain (separated by |)
      const state = Buffer.from(`${userAccountId}|${subdomain}`).toString('base64');

      // Build OAuth URL
      const authUrl = new URL(`https://${subdomain}.amocrm.ru/oauth`);
      authUrl.searchParams.set('client_id', AMOCRM_CLIENT_ID);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('mode', 'post_message');

      app.log.info({
        userAccountId,
        subdomain,
        redirectUrl: authUrl.toString()
      }, 'Initiating AmoCRM OAuth flow');

      // Redirect user to AmoCRM
      return reply.redirect(authUrl.toString());

    } catch (error: any) {
      app.log.error({ error }, 'Error initiating AmoCRM OAuth');
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /amocrm/callback
   * External URL: /api/amocrm/callback (nginx adds /api/ prefix)
   *
   * OAuth callback endpoint - receives authorization code from AmoCRM
   *
   * Query params:
   *   - code: Authorization code from AmoCRM
   *   - state: Base64-encoded userAccountId|subdomain
   *   - referer: (optional) Referer URL
   *   - client_id: (optional) Client ID
   *
   * Returns: Success page or error
   */
  app.get('/amocrm/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = CallbackQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { code, state } = parsed.data;

      let userAccountId: string;
      let subdomain: string;
      let clientId: string | undefined;
      let clientSecret: string | undefined;
      let isAutoCreated = false;

      // Try to get credentials from temporary storage (auto-created integration)
      const tempCreds = await getTempCredentials(state);

      if (tempCreds) {
        // Auto-created integration via button
        app.log.info({ state }, 'Found auto-created integration credentials');
        
        clientId = tempCreds.client_id;
        clientSecret = tempCreds.client_secret;
        isAutoCreated = true;

        // For auto-created integrations, we need userAccountId from query or temp storage
        // Since AmoCRM doesn't pass it in callback, it must be in temp storage or state
        if (tempCreds.user_account_id) {
          userAccountId = tempCreds.user_account_id;
        } else {
          // Try to decode from state as fallback
          try {
            const decoded = Buffer.from(state, 'base64').toString('utf-8');
            const parts = decoded.split('|');
            if (parts.length >= 1) {
              userAccountId = parts[0];
            } else {
              throw new Error('user_account_id not found in temp storage or state');
            }
          } catch (error) {
            app.log.error({ error, state }, 'Failed to extract userAccountId for auto-created integration');
            return reply.code(400).send({
              error: 'missing_user_account',
              message: 'Cannot determine user account for auto-created integration'
            });
          }
        }

        // Extract subdomain from state (we encode it as userAccountId|subdomain)
        try {
          const decoded = Buffer.from(state, 'base64').toString('utf-8');
          const parts = decoded.split('|');
          if (parts.length >= 2) {
            subdomain = parts[1];
            app.log.info({ subdomain }, 'Extracted subdomain from state');
          } else {
            throw new Error('State does not contain subdomain');
          }
        } catch (error) {
          // Fallback: try to extract from referer
          app.log.warn({ error, state }, 'Failed to extract subdomain from state, trying referer');
          const referer = (request.query as any).referer as string | undefined;
          if (referer) {
            // Referer может быть как "performanteaiagency.amocrm.ru" так и "https://performanteaiagency.amocrm.ru"
            const match = referer.match(/([^.\/]+)\.amocrm\.ru/);
            subdomain = match ? match[1] : 'amo';
          } else {
            subdomain = 'amo';
          }
        }

        app.log.info({
          userAccountId,
          subdomain,
          integrationName: tempCreds.integration_name
        }, 'Processing auto-created AmoCRM integration');

      } else {
        // Traditional flow with pre-configured integration
        try {
          const decoded = Buffer.from(state, 'base64').toString('utf-8');
          [userAccountId, subdomain] = decoded.split('|');

          if (!userAccountId || !subdomain) {
            throw new Error('Invalid state format');
          }
        } catch (error) {
          app.log.error({ error, state }, 'Failed to decode OAuth state');
          return reply.code(400).send({
            error: 'invalid_state',
            message: 'Invalid OAuth state parameter'
          });
        }

        app.log.info({
          userAccountId,
          subdomain,
          code: code.substring(0, 10) + '...'
        }, 'Received AmoCRM OAuth callback (pre-configured integration)');
      }

      // Exchange code for tokens (with optional credentials for auto-created integrations)
      const tokens = await exchangeCodeForToken(code, subdomain, clientId, clientSecret);

      // Save tokens to database
      await saveAmoCRMTokens(userAccountId, subdomain, tokens);

      // Delete temporary credentials if this was an auto-created integration
      if (isAutoCreated) {
        await deleteTempCredentials(state);
        app.log.info({ state }, 'Deleted temporary credentials after successful OAuth');
      }

      // Verify connection by fetching account info
      try {
        const accountInfo = await getAccountInfo(subdomain, tokens.access_token);
        app.log.info({
          userAccountId,
          accountName: accountInfo.name,
          accountId: accountInfo.id,
          isAutoCreated
        }, 'AmoCRM connected successfully');
      } catch (error) {
        app.log.warn({ error }, 'Connected to AmoCRM but failed to fetch account info');
      }

      // Return success page (or redirect to frontend)
      return reply.type('text/html').send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>AmoCRM Connected</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.1);
              text-align: center;
              max-width: 400px;
            }
            h1 {
              color: #333;
              margin-bottom: 16px;
            }
            p {
              color: #666;
              margin-bottom: 24px;
            }
            .success-icon {
              font-size: 64px;
              margin-bottom: 16px;
            }
            button {
              background: #667eea;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 6px;
              font-size: 16px;
              cursor: pointer;
              transition: background 0.2s;
            }
            button:hover {
              background: #5568d3;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✅</div>
            <h1>AmoCRM подключен!</h1>
            <p>Ваш аккаунт AmoCRM (${subdomain}.amocrm.ru) успешно подключен к системе.</p>
            <button onclick="window.close()">Закрыть окно</button>
          </div>
          <script>
            // Try to send message to parent window (if opened in popup)
            if (window.opener) {
              window.opener.postMessage({
                type: 'amocrm_connected',
                subdomain: '${subdomain}'
              }, '*');
            }
          </script>
        </body>
        </html>
      `);

    } catch (error: any) {
      app.log.error({ error }, 'Error in AmoCRM OAuth callback');

      return reply.type('text/html').send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>AmoCRM Connection Error</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.1);
              text-align: center;
              max-width: 400px;
            }
            h1 {
              color: #d9534f;
              margin-bottom: 16px;
            }
            p {
              color: #666;
              margin-bottom: 24px;
            }
            .error-icon {
              font-size: 64px;
              margin-bottom: 16px;
            }
            pre {
              background: #f5f5f5;
              padding: 12px;
              border-radius: 6px;
              text-align: left;
              overflow-x: auto;
              font-size: 12px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="error-icon">❌</div>
            <h1>Ошибка подключения</h1>
            <p>Не удалось подключить AmoCRM. Попробуйте ещё раз.</p>
            <pre>${error.message}</pre>
          </div>
        </body>
        </html>
      `);
    }
  });

  /**
   * GET /amocrm/status
   * External URL: /api/amocrm/status (nginx adds /api/ prefix)
   *
   * Check AmoCRM connection status for user
   *
   * Query params:
   *   - userAccountId: UUID of user account
   *
   * Returns: { connected: boolean, subdomain?: string, tokenExpiresAt?: string }
   */
  app.get('/amocrm/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = StatusQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId } = parsed.data;

      const status = await getAmoCRMStatus(userAccountId);

      return reply.send(status);

    } catch (error: any) {
      app.log.error({ error }, 'Error checking AmoCRM status');
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * DELETE /amocrm/disconnect
   * External URL: /api/amocrm/disconnect (nginx adds /api/ prefix)
   *
   * Disconnect AmoCRM from user account
   *
   * Query params:
   *   - userAccountId: UUID of user account
   *
   * Returns: { success: true }
   */
  app.delete('/amocrm/disconnect', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = DisconnectQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId } = parsed.data;

      await disconnectAmoCRM(userAccountId);

      app.log.info({ userAccountId }, 'AmoCRM disconnected');

      return reply.send({ success: true });

    } catch (error: any) {
      app.log.error({ error }, 'Error disconnecting AmoCRM');
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });
}
