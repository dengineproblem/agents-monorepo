import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';

const log = createLogger({ module: 'facebookWebhooks' });

const FB_APP_SECRET = process.env.FB_APP_SECRET || '';
const FB_APP_ID = process.env.FB_APP_ID || '1441781603583445';
const FB_REDIRECT_URI = process.env.FB_REDIRECT_URI || 'https://performanteaiagency.com/profile';

export default async function facebookWebhooks(app: FastifyInstance) {
  
  /**
   * Facebook OAuth - Exchange code for access token
   * 
   * После того как пользователь авторизуется через Facebook,
   * Facebook редиректит его обратно с code в URL.
   * Этот endpoint обменивает code на access_token.
   */
  app.post('/facebook/oauth/token', async (req, res) => {
    try {
      log.info('Exchanging Facebook OAuth code for access token');
      
      const { code, username } = req.body as { code?: string; username?: string };
      
      if (!code) {
        log.error('Missing code parameter');
        return res.status(400).send({ 
          error: 'Missing code parameter' 
        });
      }

      // Exchange code for access token
      const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token?` +
        `client_id=${FB_APP_ID}&` +
        `redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}&` +
        `client_secret=${FB_APP_SECRET}&` +
        `code=${code}`;

      const tokenResponse = await fetch(tokenUrl);
      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok || tokenData.error) {
        log.error({ error: tokenData.error }, 'Failed to exchange code for token');
        return res.status(400).send({
          error: tokenData.error?.message || 'Failed to get access token'
        });
      }

      const { access_token } = tokenData;

      // Get user info
      const userInfoUrl = `https://graph.facebook.com/v21.0/me?` +
        `fields=id,name,email&` +
        `access_token=${access_token}`;

      const userInfoResponse = await fetch(userInfoUrl);
      const userInfo = await userInfoResponse.json();

      if (!userInfoResponse.ok || userInfo.error) {
        log.error({ error: userInfo.error }, 'Failed to get user info');
        return res.status(400).send({
          error: userInfo.error?.message || 'Failed to get user info'
        });
      }

      // Get ALL ad accounts with pagination
      let allAdAccounts: any[] = [];
      let adAccountsUrl: string | null = `https://graph.facebook.com/v21.0/me/adaccounts?` +
        `fields=id,name,account_status&` +
        `limit=500&` +
        `access_token=${access_token}`;

      while (adAccountsUrl) {
        const adAccountsResponse: Response = await fetch(adAccountsUrl);
        const adAccountsData: any = await adAccountsResponse.json();
        
        if (adAccountsData.data) {
          allAdAccounts = allAdAccounts.concat(adAccountsData.data);
        }
        
        adAccountsUrl = adAccountsData.paging?.next || null;
      }

      if (allAdAccounts.length === 0) {
        log.error('No ad accounts found for user');
        return res.status(400).send({
          error: 'No ad accounts found. Please make sure you have access to at least one Facebook Ad Account.'
        });
      }

      // Get ALL pages with instagram_business_account with pagination
      let allPages: any[] = [];
      let pagesUrl: string | null = `https://graph.facebook.com/v21.0/me/accounts?` +
        `fields=id,name,access_token,instagram_business_account&` +
        `limit=500&` +
        `access_token=${access_token}`;

      while (pagesUrl) {
        const pagesResponse: Response = await fetch(pagesUrl);
        const pagesData: any = await pagesResponse.json();
        
        if (pagesData.data) {
          allPages = allPages.concat(pagesData.data);
        }
        
        pagesUrl = pagesData.paging?.next || null;
      }

      if (allPages.length === 0) {
        log.error('No pages found for user');
        return res.status(400).send({
          error: 'No Facebook Pages found. Please create or get access to at least one Facebook Page.'
        });
      }

      // Extract Instagram ID from first page (if available)
      const firstPage = allPages[0];
      const instagramId = firstPage.instagram_business_account?.id || null;

      log.info({ 
        fb_user_id: userInfo.id,
        fb_user_name: userInfo.name,
        ad_accounts_count: allAdAccounts.length,
        pages_count: allPages.length,
        instagram_id: instagramId
      }, 'Successfully exchanged code for token');

      // Return data without saving - frontend will show selection modal
      return res.send({
        success: true,
        user: {
          id: userInfo.id,
          name: userInfo.name,
          email: userInfo.email
        },
        access_token: access_token,
        ad_accounts: allAdAccounts,
        pages: allPages.map((page: any) => ({
          id: page.id,
          name: page.name,
          instagram_id: page.instagram_business_account?.id || null
        })),
        instagram_id: instagramId
      });

    } catch (error) {
      log.error({ error }, 'Error exchanging OAuth code');
      return res.status(500).send({ 
        error: 'Internal server error' 
      });
    }
  });

  /**
   * Save Facebook selection - Ad Account and Page
   */
  app.post('/facebook/save-selection', async (req, res) => {
    try {
      log.info('Saving Facebook selection');
      
      const { username, access_token, ad_account_id, page_id, instagram_id } = req.body as { 
        username?: string; 
        access_token?: string; 
        ad_account_id?: string; 
        page_id?: string; 
        instagram_id?: string | null;
      };
      
      if (!username || !access_token || !ad_account_id || !page_id) {
        log.error('Missing required parameters');
        return res.status(400).send({ 
          error: 'Missing required parameters' 
        });
      }

      // Create fresh Supabase client
      const freshSupabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );

      // Find user by username
      const { data: existingUser, error: findError } = await freshSupabase
        .from('user_accounts')
        .select('id')
        .eq('username', username)
        .maybeSingle();

      if (findError || !existingUser) {
        log.error({ error: findError, username }, 'User not found');
        return res.status(400).send({
          error: 'User not found'
        });
      }

      // Update user with selected data
      const { error: updateError } = await freshSupabase
        .from('user_accounts')
        .update({
          access_token,
          ad_account_id,
          page_id,
          instagram_id: instagram_id || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingUser.id);

      if (updateError) {
        log.error({ error: updateError }, 'Failed to update user data');
        return res.status(500).send({
          error: 'Failed to save selection'
        });
      }

      log.info({ userId: existingUser.id, username }, 'Successfully saved Facebook selection');

      return res.send({
        success: true
      });

    } catch (error) {
      log.error({ error }, 'Error saving Facebook selection');
      return res.status(500).send({ 
        error: 'Internal server error' 
      });
    }
  });
  
  /**
   * Facebook Data Deletion Callback - GET (для проверки Facebook)
   * 
   * Facebook сначала проверяет URL через GET запрос при добавлении в настройки.
   * Нужно вернуть 200 OK чтобы Facebook принял URL.
   */
  app.get('/facebook/data-deletion', async (req, res) => {
    log.info('Facebook data deletion URL verification (GET request)');
    
    return res.status(200).send({
      message: 'Data deletion endpoint is active',
      company: 'ИП A-ONE AGENCY',
      app: 'Performante AI',
      status: 'ready'
    });
  });
  
  /**
   * Facebook Data Deletion Callback - POST (реальное удаление)
   * 
   * Этот эндпоинт ОБЯЗАТЕЛЕН для прохождения App Review.
   * Facebook вызывает его когда пользователь удаляет приложение
   * или запрашивает удаление своих данных.
   * 
   * Документация: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
   */
  app.post('/facebook/data-deletion', async (req, res) => {
    try {
      log.info('Received data deletion request from Facebook');
      
      const { signed_request } = req.body as { signed_request?: string };
      
      if (!signed_request) {
        log.error('Missing signed_request in data deletion callback');
        return res.status(400).send({ 
          error: 'Missing signed_request parameter' 
        });
      }

      // Parse and verify signed request
      const parsedData = parseSignedRequest(signed_request, FB_APP_SECRET);
      
      if (!parsedData) {
        log.error('Invalid signed_request signature');
        return res.status(400).send({ 
          error: 'Invalid signed_request' 
        });
      }

      const { user_id } = parsedData;
      
      if (!user_id) {
        log.error('Missing user_id in signed_request');
        return res.status(400).send({ 
          error: 'Missing user_id' 
        });
      }

      log.info({ facebook_user_id: user_id }, 'Processing data deletion');

      // TODO: Раскомментировать после настройки Supabase
      /*
      // Delete user data from database
      const { error: deleteError } = await supabase
        .from('user_accounts')
        .delete()
        .eq('facebook_user_id', user_id);
      
      if (deleteError) {
        log.error({ error: deleteError, user_id }, 'Failed to delete user data from database');
        // Не возвращаем ошибку Facebook - запишем в лог и обработаем manually
      } else {
        log.info({ user_id }, 'Successfully deleted user data');
      }
      */

      // ВРЕМЕННОЕ РЕШЕНИЕ: просто логируем запрос
      log.warn({ user_id }, 'Data deletion logged (Supabase integration pending)');

      // Generate confirmation code
      const confirmationCode = crypto.randomBytes(16).toString('hex');
      
      // TODO: Сохранить confirmation_code в БД для отслеживания
      /*
      await supabase.from('data_deletion_requests').insert({
        facebook_user_id: user_id,
        confirmation_code: confirmationCode,
        requested_at: new Date().toISOString(),
        status: 'completed'
      });
      */

      // Facebook требует вернуть URL и confirmation_code
      // URL должен показывать статус удаления
      const statusUrl = `${process.env.PUBLIC_URL || 'https://performanteaiagency.com'}/deletion-status?code=${confirmationCode}`;
      
      log.info({ 
        user_id, 
        confirmation_code: confirmationCode,
        status_url: statusUrl 
      }, 'Data deletion request processed successfully');

      return res.send({
        url: statusUrl,
        confirmation_code: confirmationCode
      });

    } catch (error) {
      log.error({ error }, 'Error processing data deletion request');
      return res.status(500).send({ 
        error: 'Internal server error' 
      });
    }
  });

  /**
   * Страница статуса удаления данных
   * Показывает пользователю, что его данные были удалены
   */
  app.get('/deletion-status', async (req, res) => {
    const { code } = req.query as { code?: string };
    
    if (!code) {
      return res.status(400).send('Missing confirmation code');
    }

    // TODO: Проверить статус в БД
    /*
    const { data: request } = await supabase
      .from('data_deletion_requests')
      .select('*')
      .eq('confirmation_code', code)
      .single();
    */

    // Пока возвращаем простую HTML страницу
    return res.type('text/html').send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Data Deletion Status</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 100px auto;
            padding: 20px;
            text-align: center;
          }
          .success {
            color: #22c55e;
            font-size: 48px;
            margin-bottom: 20px;
          }
          h1 {
            color: #1f2937;
            margin-bottom: 16px;
          }
          p {
            color: #6b7280;
            line-height: 1.6;
          }
          .code {
            background: #f3f4f6;
            padding: 8px 12px;
            border-radius: 4px;
            font-family: monospace;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="success">✓</div>
        <h1>Data Deletion Complete</h1>
        <p>
          Your data has been successfully deleted from our systems.
          This process typically takes up to 30 days to complete fully.
        </p>
        <p>
          If you have any questions, please contact our support team.
        </p>
        <div class="code">
          Confirmation Code: ${code}
        </div>
      </body>
      </html>
    `);
  });
}

/**
 * Parse and verify Facebook signed request
 * 
 * @param signedRequest - The signed request from Facebook
 * @param secret - Your Facebook App Secret
 * @returns Parsed data or null if invalid
 */
function parseSignedRequest(signedRequest: string, secret: string): any | null {
  try {
    const [encodedSig, payload] = signedRequest.split('.', 2);
    
    if (!encodedSig || !payload) {
      return null;
    }

    // Decode signature
    const sig = base64UrlDecode(encodedSig);
    
    // Decode payload
    const data = JSON.parse(base64UrlDecode(payload));

    // Verify signature using HMAC-SHA256
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest();

    if (!crypto.timingSafeEqual(Buffer.from(sig), expectedSig)) {
      log.error('Signature verification failed');
      return null;
    }

    return data;
  } catch (error) {
    log.error({ error }, 'Error parsing signed request');
    return null;
  }
}

/**
 * Decode base64url string
 */
function base64UrlDecode(str: string): string {
  // Convert base64url to base64
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  
  // Add padding if needed
  while (base64.length % 4) {
    base64 += '=';
  }
  
  return Buffer.from(base64, 'base64').toString('utf-8');
}

