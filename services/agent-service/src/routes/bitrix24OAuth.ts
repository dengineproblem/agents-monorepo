/**
 * Bitrix24 OAuth Routes
 *
 * Handles OAuth2 authentication flow for Bitrix24 integration
 *
 * @module routes/bitrix24OAuth
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { exchangeCodeForToken, getAccountInfo, registerCRMWebhooks } from '../adapters/bitrix24.js';
import {
  saveBitrix24Tokens,
  saveBitrix24TokensToAdAccount,
  disconnectBitrix24,
  getBitrix24Status,
  setBitrix24EntityType
} from '../lib/bitrix24Tokens.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import { supabase } from '../lib/supabase.js';
import { shouldFilterByAccountId } from '../lib/multiAccountHelper.js';

const BITRIX24_CLIENT_ID = process.env.BITRIX24_CLIENT_ID;
const BITRIX24_CLIENT_SECRET = process.env.BITRIX24_CLIENT_SECRET;
const BITRIX24_REDIRECT_URI = process.env.BITRIX24_REDIRECT_URI;
const APP_URL = process.env.APP_URL || 'https://api.performanteaiagency.com';

/**
 * Query parameters for /auth endpoint
 */
const AuthQuerySchema = z.object({
  userAccountId: z.string().uuid(),
  domain: z.string().min(1).max(100),
  entityType: z.enum(['lead', 'deal', 'both']).optional().default('deal'),
  accountId: z.string().uuid().optional() // For multi-account mode
});

/**
 * Query parameters for /callback endpoint
 */
const CallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  domain: z.string().optional(),
  member_id: z.string().optional(),
  scope: z.string().optional()
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

/**
 * Body for /entity-type endpoint
 */
const EntityTypeBodySchema = z.object({
  userAccountId: z.string().uuid(),
  entityType: z.enum(['lead', 'deal', 'both'])
});

export default async function bitrix24OAuthRoutes(app: FastifyInstance) {
  /**
   * GET /bitrix24/auth
   * External URL: /api/bitrix24/auth
   *
   * Initiates OAuth flow by redirecting user to Bitrix24 authorization page
   *
   * Query params:
   *   - userAccountId: UUID of user account
   *   - domain: Bitrix24 domain (e.g., "example.bitrix24.ru")
   *   - entityType: Optional - 'lead', 'deal', or 'both' (default: 'deal')
   *
   * Returns: Redirect to Bitrix24 OAuth page
   */
  app.get('/bitrix24/auth', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = AuthQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId, domain, entityType, accountId } = parsed.data;

      if (!BITRIX24_CLIENT_ID || !BITRIX24_REDIRECT_URI) {
        return reply.code(500).send({
          error: 'Bitrix24 OAuth not configured on server'
        });
      }

      // Encode state with userAccountId, domain, entityType, and optional accountId for multi-account mode
      const stateParts = [userAccountId, domain, entityType];
      if (accountId) {
        stateParts.push(accountId);
      }
      const state = Buffer.from(stateParts.join('|')).toString('base64');

      // Build OAuth URL
      const authUrl = new URL(`https://${domain}/oauth/authorize/`);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', BITRIX24_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', BITRIX24_REDIRECT_URI);
      authUrl.searchParams.set('state', state);

      app.log.info({
        userAccountId,
        accountId,
        domain,
        entityType,
        redirectUrl: authUrl.toString()
      }, 'Initiating Bitrix24 OAuth flow');

      // Redirect user to Bitrix24
      return reply.redirect(authUrl.toString());

    } catch (error: any) {
      app.log.error({ error }, 'Error initiating Bitrix24 OAuth');

      logErrorToAdmin({
        error_type: 'bitrix24',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'bitrix24_oauth_init',
        endpoint: '/bitrix24/auth',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /bitrix24/callback
   * External URL: /api/bitrix24/callback
   *
   * OAuth callback endpoint - receives authorization code from Bitrix24
   *
   * Query params:
   *   - code: Authorization code from Bitrix24
   *   - state: Base64-encoded userAccountId|domain|entityType
   *   - domain: Bitrix24 domain (provided by Bitrix24)
   *   - member_id: Portal member ID
   *
   * Returns: Success page or error
   */
  app.get('/bitrix24/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = CallbackQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { code, state, domain: callbackDomain } = parsed.data;

      let userAccountId: string;
      let domain: string;
      let entityType: 'lead' | 'deal' | 'both' = 'deal';
      let accountId: string | undefined;

      // Decode state
      try {
        const decoded = Buffer.from(state, 'base64').toString('utf-8');
        const parts = decoded.split('|');
        userAccountId = parts[0];
        domain = parts[1] || callbackDomain || '';
        entityType = (parts[2] as 'lead' | 'deal' | 'both') || 'deal';
        accountId = parts[3]; // Optional: ad_account UUID for multi-account mode

        if (!userAccountId || !domain) {
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
        domain,
        entityType,
        accountId,
        code: code.substring(0, 10) + '...'
      }, 'Received Bitrix24 OAuth callback');

      // Exchange code for tokens
      const tokens = await exchangeCodeForToken(
        domain,
        code,
        BITRIX24_CLIENT_ID,
        BITRIX24_CLIENT_SECRET,
        BITRIX24_REDIRECT_URI
      );

      // Save tokens to appropriate table based on multi-account mode
      // Используем shouldFilterByAccountId для проверки режима (см. MULTI_ACCOUNT_GUIDE.md)
      const useMultiAccount = await shouldFilterByAccountId(supabase, userAccountId, accountId);
      if (useMultiAccount) {
        // Multi-account mode: save to ad_accounts
        await saveBitrix24TokensToAdAccount(accountId!, domain, tokens);
        app.log.info({ userAccountId, accountId, domain }, 'Bitrix24 tokens saved to ad_accounts (multi-account mode)');
      } else {
        // Legacy mode: save to user_accounts
        await saveBitrix24Tokens(userAccountId, domain, tokens);
        // Also set entity type preference
        await setBitrix24EntityType(userAccountId, entityType);
      }

      // Verify connection by fetching account info
      try {
        const accountInfo = await getAccountInfo(domain, tokens.access_token);
        app.log.info({
          userAccountId,
          accountName: accountInfo?.NAME,
          accountId: accountInfo?.ID,
          memberId: tokens.member_id
        }, 'Bitrix24 connected successfully');
      } catch (error) {
        app.log.warn({ error }, 'Connected to Bitrix24 but failed to fetch account info');
      }

      // Register webhooks for real-time updates
      try {
        const webhookUrl = `${APP_URL}/api/webhooks/bitrix24`;
        await registerCRMWebhooks(domain, tokens.access_token, webhookUrl, userAccountId, entityType);
        app.log.info({ userAccountId, domain, entityType }, 'Bitrix24 webhooks registered successfully');
      } catch (error: any) {
        app.log.error({
          error: error.message,
          userAccountId,
          domain
        }, 'Failed to register Bitrix24 webhooks - user can register them manually later');
      }

      // Return success page
      return reply.type('text/html').send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Bitrix24 Connected</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #2FC6F6 0%, #1EBBF0 100%);
              color: #333;
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.1);
              text-align: center;
              max-width: 400px;
              width: 90%;
            }
            h1 {
              color: #333;
              margin-bottom: 16px;
              font-size: 24px;
            }
            p {
              color: #666;
              margin-bottom: 24px;
              line-height: 1.5;
            }
            .success-icon {
              font-size: 64px;
              margin-bottom: 16px;
            }
            .info {
              background: #f0f9ff;
              padding: 12px;
              border-radius: 6px;
              margin-bottom: 24px;
              font-size: 14px;
              color: #0369a1;
            }
            .btn {
              background: #1EBBF0;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 6px;
              font-size: 16px;
              cursor: pointer;
              transition: background 0.2s;
              text-decoration: none;
              display: inline-block;
              font-weight: 500;
            }
            .btn:hover {
              background: #0ea5e9;
            }
            .redirect-text {
              margin-top: 16px;
              font-size: 12px;
              color: #888;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✅</div>
            <h1>Bitrix24 подключен!</h1>
            <p>Ваш аккаунт Bitrix24 (${domain}) успешно подключен к системе.</p>

            <div class="info">
              Режим работы: ${entityType === 'lead' ? 'Лиды' : entityType === 'deal' ? 'Сделки' : 'Лиды и Сделки'}
            </div>

            <a href="https://app.performanteaiagency.com/profile?bitrix24_setup=true" class="btn">Вернуться в профиль</a>

            <div class="redirect-text">Автоматический переход через 3 секунды...</div>
          </div>
          <script>
            // Try to send message to parent window (if opened in popup)
            try {
              if (window.opener) {
                window.opener.postMessage({
                  type: 'bitrix24_connected',
                  domain: '${domain}',
                  entityType: '${entityType}'
                }, '*');

                // Close popup after short delay if successfully messaged
                setTimeout(() => window.close(), 2000);
              }
            } catch (e) {
              console.error('Error posting message:', e);
            }

            // Redirect to profile as fallback or main flow
            setTimeout(() => {
              window.location.href = 'https://app.performanteaiagency.com/profile?bitrix24_setup=true';
            }, 3000);
          </script>
        </body>
        </html>
      `);

    } catch (error: any) {
      app.log.error({ error }, 'Error in Bitrix24 OAuth callback');

      logErrorToAdmin({
        error_type: 'bitrix24',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'bitrix24_oauth_callback',
        endpoint: '/bitrix24/callback',
        severity: 'critical'
      }).catch(() => {});

      return reply.type('text/html').send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Bitrix24 Connection Error</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
              color: #333;
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.1);
              text-align: center;
              max-width: 400px;
              width: 90%;
            }
            h1 {
              color: #d9534f;
              margin-bottom: 16px;
              font-size: 24px;
            }
            p {
              color: #666;
              margin-bottom: 24px;
              line-height: 1.5;
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
              margin-bottom: 24px;
            }
            .btn {
              background: #d9534f;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 6px;
              font-size: 16px;
              cursor: pointer;
              transition: background 0.2s;
              text-decoration: none;
              display: inline-block;
              font-weight: 500;
            }
            .btn:hover {
              background: #c9302c;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="error-icon">❌</div>
            <h1>Ошибка подключения</h1>
            <p>Не удалось подключить Bitrix24. Попробуйте ещё раз.</p>
            <pre>${error.message}</pre>

            <a href="https://app.performanteaiagency.com/profile" class="btn">Вернуться в профиль</a>
          </div>
        </body>
        </html>
      `);
    }
  });

  /**
   * GET /bitrix24/status
   * External URL: /api/bitrix24/status
   *
   * Check Bitrix24 connection status for user
   *
   * Query params:
   *   - userAccountId: UUID of user account
   *
   * Returns: { connected: boolean, domain?: string, entityType?: string, ... }
   */
  app.get('/bitrix24/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = StatusQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId } = parsed.data;

      const status = await getBitrix24Status(userAccountId);

      return reply.send(status);

    } catch (error: any) {
      app.log.error({ error }, 'Error checking Bitrix24 status');

      logErrorToAdmin({
        user_account_id: (request.query as any)?.userAccountId,
        error_type: 'bitrix24',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'bitrix24_get_status',
        endpoint: '/bitrix24/status',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * DELETE /bitrix24/disconnect
   * External URL: /api/bitrix24/disconnect
   *
   * Disconnect Bitrix24 from user account
   *
   * Query params:
   *   - userAccountId: UUID of user account
   *
   * Returns: { success: true }
   */
  app.delete('/bitrix24/disconnect', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = DisconnectQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId } = parsed.data;

      await disconnectBitrix24(userAccountId);

      app.log.info({ userAccountId }, 'Bitrix24 disconnected');

      return reply.send({ success: true });

    } catch (error: any) {
      app.log.error({ error }, 'Error disconnecting Bitrix24');

      logErrorToAdmin({
        user_account_id: (request.query as any)?.userAccountId,
        error_type: 'bitrix24',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'bitrix24_disconnect',
        endpoint: '/bitrix24/disconnect',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * POST /bitrix24/entity-type
   * External URL: /api/bitrix24/entity-type
   *
   * Change entity type preference (lead, deal, or both)
   *
   * Body:
   *   - userAccountId: UUID of user account
   *   - entityType: 'lead', 'deal', or 'both'
   *
   * Returns: { success: true }
   */
  app.post('/bitrix24/entity-type', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = EntityTypeBodySchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId, entityType } = parsed.data;

      await setBitrix24EntityType(userAccountId, entityType);

      app.log.info({ userAccountId, entityType }, 'Bitrix24 entity type updated');

      return reply.send({ success: true });

    } catch (error: any) {
      app.log.error({ error }, 'Error setting Bitrix24 entity type');

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /bitrix24/connect
   * External URL: /api/bitrix24/connect
   *
   * HTML page for connecting Bitrix24
   *
   * Query params:
   *   - userAccountId: UUID of user account
   *
   * Returns: HTML page with connection form
   */
  app.get('/bitrix24/connect', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAccountId } = request.query as { userAccountId?: string };

    if (!userAccountId) {
      return reply.code(400).send({
        error: 'Missing userAccountId parameter'
      });
    }

    return reply.type('text/html').send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Connect Bitrix24</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #2FC6F6 0%, #1EBBF0 100%);
            padding: 20px;
            box-sizing: border-box;
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 500px;
            width: 100%;
          }
          h1 {
            color: #333;
            margin-bottom: 8px;
            font-size: 24px;
          }
          .subtitle {
            color: #666;
            margin-bottom: 32px;
            font-size: 14px;
          }
          .form-group {
            margin-bottom: 20px;
            text-align: left;
          }
          label {
            display: block;
            margin-bottom: 8px;
            color: #333;
            font-weight: 500;
          }
          input, select {
            width: 100%;
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 16px;
            box-sizing: border-box;
          }
          input:focus, select:focus {
            outline: none;
            border-color: #1EBBF0;
          }
          .help-text {
            font-size: 12px;
            color: #888;
            margin-top: 4px;
          }
          .btn {
            background: #1EBBF0;
            color: white;
            border: none;
            padding: 14px 28px;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
            transition: background 0.2s;
            width: 100%;
            font-weight: 500;
          }
          .btn:hover {
            background: #0ea5e9;
          }
          .btn:disabled {
            background: #ccc;
            cursor: not-allowed;
          }
          .bitrix-logo {
            width: 60px;
            height: 60px;
            margin-bottom: 16px;
          }
          .info-box {
            background: #f0f9ff;
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 24px;
            text-align: left;
          }
          .info-box h3 {
            margin: 0 0 8px 0;
            font-size: 14px;
            color: #0369a1;
          }
          .info-box ul {
            margin: 0;
            padding-left: 20px;
            color: #0369a1;
            font-size: 13px;
          }
          .info-box li {
            margin-bottom: 4px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <svg class="bitrix-logo" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="20" fill="#1EBBF0"/>
            <path d="M30 35h40v8H30zM30 50h40v8H30zM30 65h25v8H30z" fill="white"/>
          </svg>

          <h1>Подключение Bitrix24</h1>
          <p class="subtitle">Введите адрес вашего портала Bitrix24</p>

          <div class="info-box">
            <h3>Выберите тип сущностей для работы:</h3>
            <ul>
              <li><strong>Сделки</strong> — если вы работаете только со сделками</li>
              <li><strong>Лиды</strong> — если используете функционал лидов</li>
              <li><strong>Оба варианта</strong> — для полной интеграции</li>
            </ul>
          </div>

          <form id="connectForm">
            <div class="form-group">
              <label for="domain">Адрес портала Bitrix24</label>
              <input type="text" id="domain" name="domain" placeholder="example.bitrix24.ru" required>
              <div class="help-text">Например: mycompany.bitrix24.ru или mycompany.bitrix24.com</div>
            </div>

            <div class="form-group">
              <label for="entityType">Тип сущностей</label>
              <select id="entityType" name="entityType">
                <option value="deal">Сделки</option>
                <option value="lead">Лиды</option>
                <option value="both">Оба варианта (Лиды и Сделки)</option>
              </select>
            </div>

            <button type="submit" class="btn">Подключить Bitrix24</button>
          </form>
        </div>

        <script>
          document.getElementById('connectForm').addEventListener('submit', function(e) {
            e.preventDefault();

            const domain = document.getElementById('domain').value.trim();
            const entityType = document.getElementById('entityType').value;

            // Remove https:// or http:// if present
            const cleanDomain = domain.replace(/^https?:\\/\\//, '').replace(/\\/$/, '');

            // Validate domain format
            if (!cleanDomain.includes('bitrix24.')) {
              alert('Пожалуйста, введите корректный адрес Bitrix24 (например: example.bitrix24.ru)');
              return;
            }

            // Redirect to OAuth
            const authUrl = '/api/bitrix24/auth?userAccountId=${userAccountId}&domain=' +
              encodeURIComponent(cleanDomain) +
              '&entityType=' + entityType;

            window.location.href = authUrl;
          });
        </script>
      </body>
      </html>
    `);
  });
}
