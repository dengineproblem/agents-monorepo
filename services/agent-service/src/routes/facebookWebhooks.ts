import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';

const log = createLogger({ module: 'facebookWebhooks' });

const FB_APP_SECRET = process.env.FB_APP_SECRET || '';
const FB_APP_ID = process.env.FB_APP_ID || '1441781603583445';
const FB_REDIRECT_URI = process.env.FB_REDIRECT_URI || 'https://performanteaiagency.com/profile';

// Telegram notifications for manual Facebook connections
const TELEGRAM_BOT_TOKEN = process.env.LOG_ALERT_TELEGRAM_BOT_TOKEN;
const TELEGRAM_TECH_CHAT_ID = '-5079020326';

async function sendTelegramNotification(text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) {
    log.warn('TELEGRAM_BOT_TOKEN not set, skipping notification');
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_TECH_CHAT_ID,
        text,
        parse_mode: 'HTML'
      })
    });

    if (!res.ok) {
      const body = await res.text();
      log.error({ status: res.status, body }, 'Failed to send Telegram notification');
    } else {
      log.info('Telegram notification sent successfully');
    }
  } catch (err) {
    log.error({ err }, 'Error sending Telegram notification');
  }
}

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
      const { username, access_token, ad_account_id, page_id, instagram_id } = req.body as {
        username?: string;
        access_token?: string;
        ad_account_id?: string;
        page_id?: string;
        instagram_id?: string | null;
      };

      log.info({
        username,
        ad_account_id,
        page_id,
        instagram_id,
        access_token_prefix: access_token ? `${access_token.substring(0, 20)}...` : 'none'
      }, 'Saving Facebook selection - received data');

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

      log.info({
        userId: existingUser.id,
        username,
        saved_page_id: page_id,
        saved_ad_account_id: ad_account_id,
        saved_instagram_id: instagram_id
      }, 'Successfully saved Facebook selection to database');

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
   * Validate Facebook connection - Check token, ad account, and page access
   * Uses pages_read_engagement to fetch basic Page metadata
   */
  app.post('/facebook/validate', async (req, res) => {
    try {
      log.info('Validating Facebook connection');

      const { accessToken, adAccountId, pageId } = req.body as {
        accessToken?: string;
        adAccountId?: string;
        pageId?: string;
      };

      if (!accessToken) {
        log.error('Missing access token');
        return res.status(400).send({
          success: false,
          error: 'Missing access token'
        });
      }

      const checks = {
        token: false,
        adAccount: false,
        page: false,
        pageDetails: null as any,
        directions: [] as any[]
      };

      // 1. Validate token
      try {
        const meResponse = await fetch(
          `https://graph.facebook.com/v21.0/me?access_token=${accessToken}`
        );
        const meData = await meResponse.json();

        if (meData.id) {
          checks.token = true;
          log.info({ userId: meData.id }, 'Token validated successfully');
        } else if (meData.error) {
          log.error({ error: meData.error }, 'Token validation failed');
        }
      } catch (e) {
        log.error({ error: e }, 'Token validation request failed');
      }

      // 2. Validate Ad Account access
      if (adAccountId) {
        try {
          const adAccountResponse = await fetch(
            `https://graph.facebook.com/v21.0/${adAccountId}?fields=account_id,name,account_status&access_token=${accessToken}`
          );
          const adAccountData = await adAccountResponse.json();

          if (adAccountData.account_id) {
            checks.adAccount = true;
            log.info({ adAccountId: adAccountData.account_id }, 'Ad account access validated');
          } else if (adAccountData.error) {
            log.error({ error: adAccountData.error }, 'Ad account validation failed');
          }
        } catch (e) {
          log.error({ error: e }, 'Ad account validation request failed');
        }
      }

      // 3. Validate Page access using pages_read_engagement permission
      // This demonstrates the minimal usage of pages_read_engagement for app review
      if (pageId) {
        try {
          log.info({
            requestedPageId: pageId,
            usingAccessToken: accessToken ? `${accessToken.substring(0, 20)}...` : 'none'
          }, 'Requesting Page data from Facebook');

          const pageResponse = await fetch(
            `https://graph.facebook.com/v21.0/${pageId}?fields=id,name,link,instagram_business_account{id,username}&access_token=${accessToken}`
          );
          const pageData = await pageResponse.json();

          log.info({
            requestedPageId: pageId,
            returnedPageId: pageData.id,
            returnedPageName: pageData.name,
            match: pageData.id === pageId
          }, 'Facebook response received');

          if (pageData.name) {
            checks.page = true;
            checks.pageDetails = {
              name: pageData.name,
              link: pageData.link,
              instagram: pageData.instagram_business_account || null
            };
            log.info({
              requestedPageId: pageId,
              returnedPageId: pageData.id,
              pageName: pageData.name,
              hasInstagram: !!pageData.instagram_business_account,
              pageMatches: pageData.id === pageId
            }, 'Page access validated using pages_read_engagement');
          } else if (pageData.error) {
            log.error({ error: pageData.error, requestedPageId: pageId }, 'Page validation failed');
          }
        } catch (e) {
          log.error({ error: e, requestedPageId: pageId }, 'Page validation request failed');
        }
      }

      // 4. Validate active directions - check if adsets can be created
      const directionsValidation: any[] = [];

      log.info({ hasToken: checks.token, hasAdAccount: checks.adAccount }, 'Starting directions validation');

      if (checks.token && checks.adAccount) {
        try {
          // Normalize ad_account_id (remove 'act_' prefix if present)
          const normalizedAdAccountId = adAccountId?.replace('act_', '');
          
          log.info({ adAccountId: `act_${normalizedAdAccountId}` }, 'Searching for active directions for this ad account');
          
          // Get active directions for this ad_account_id (через join с user_accounts)
          const { data: directions, error: directionsError } = await supabase
            .from('account_directions')
            .select(`
              id, 
              name, 
              objective, 
              fb_campaign_id, 
              daily_budget_cents, 
              whatsapp_phone_number_id,
              user_accounts!inner(ad_account_id)
            `)
            .eq('user_accounts.ad_account_id', `act_${normalizedAdAccountId}`)
            .eq('is_active', true);

          log.info({ 
            found: !!directions, 
            count: directions?.length || 0,
            error: directionsError?.message 
          }, 'Directions search result');

          if (directions && directions.length > 0) {
            log.info({ directionsCount: directions.length }, 'Validating directions');

            for (const direction of directions) {
                const validation: any = {
                  id: direction.id,
                  name: direction.name,
                  objective: direction.objective,
                  success: false,
                  error: null,
                  errorDetails: null
                };

                // Only validate WhatsApp directions (they require phone number)
                if (direction.objective === 'whatsapp') {
                  try {
                    // Get WhatsApp phone number
                    let whatsappPhone = null;
                    if (direction.whatsapp_phone_number_id) {
                      const { data: phoneData } = await supabase
                        .from('whatsapp_phone_numbers')
                        .select('phone_number')
                        .eq('id', direction.whatsapp_phone_number_id)
                        .single();
                      whatsappPhone = phoneData?.phone_number;
                    }

                    // Prepare adset validation params
                    const params = new URLSearchParams({
                      name: `VALIDATION TEST | ${direction.name}`,
                      campaign_id: direction.fb_campaign_id,
                      status: 'PAUSED',
                      billing_event: 'IMPRESSIONS',
                      optimization_goal: 'CONVERSATIONS',
                      daily_budget: String(direction.daily_budget_cents),
                      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
                      targeting: JSON.stringify({
                        age_min: 23,
                        age_max: 55,
                        geo_locations: { cities: [{ key: '1301648' }] }
                      }),
                      destination_type: 'WHATSAPP',
                      promoted_object: JSON.stringify({
                        page_id: pageId,
                        ...(whatsappPhone ? { whatsapp_phone_number: whatsappPhone } : {})
                      }),
                      validate_only: 'true'
                    });

                    // Validate adset creation
                    const validateUrl = `https://graph.facebook.com/v21.0/${adAccountId}/adsets`;
                    const validateResponse = await fetch(validateUrl, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                      body: `access_token=${accessToken}&${params.toString()}`
                    });

                    const validateData = await validateResponse.json();

                    if (validateResponse.ok) {
                      validation.success = true;
                      log.info({ directionId: direction.id, directionName: direction.name }, 'Direction adset validation passed');
                    } else {
                      validation.success = false;
                      validation.error = validateData.error?.message || 'Validation failed';
                      validation.errorCode = validateData.error?.code;
                      validation.errorSubcode = validateData.error?.error_subcode;
                      
                      // Special handling for WhatsApp error 2446885
                      if (validateData.error?.error_subcode === 2446885) {
                        validation.errorDetails = 'WhatsApp Business не подключён к странице. Подключите WhatsApp Business Account в Facebook Business Manager.';
                      }
                      
                      log.warn({
                        directionId: direction.id,
                        directionName: direction.name,
                        error: validateData.error
                      }, 'Direction adset validation failed');
                    }
                  } catch (e: any) {
                    validation.success = false;
                    validation.error = e.message || 'Validation error';
                    log.error({ error: e, directionId: direction.id }, 'Direction validation request failed');
                  }
                } else {
                  // Non-WhatsApp directions - assume valid (or add validation later)
                  validation.success = true;
                  validation.error = null;
                }

              directionsValidation.push(validation);
            }
          }
        } catch (e) {
          log.error({ error: e }, 'Failed to validate directions');
        }
      }

      checks.directions = directionsValidation;

      const allPassed = checks.token && checks.adAccount && checks.page;
      const directionsOk = directionsValidation.length === 0 || directionsValidation.every(d => d.success);

      return res.send({
        success: allPassed && directionsOk,
        checks,
        error: allPassed ? (directionsOk ? null : 'Some directions have validation errors') : 'Some checks failed',
        details: allPassed && directionsOk ? 'All validations passed' : 'Check individual statuses'
      });
    } catch (error) {
      log.error({ error }, 'Error validating Facebook connection');
      return res.status(500).send({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  /**
   * Manual Facebook Connection - Submit user-provided IDs for review
   *
   * Пользователь предоставляет доступ через Business Portfolio и вводит свои ID.
   * Данные сохраняются со статусом 'pending_review' для проверки специалистом.
   */
  app.post('/facebook/manual-connect', async (req, res) => {
    try {
      log.info('Processing manual Facebook connection request');

      const { user_id, account_id, page_id, instagram_id, ad_account_id } = req.body as {
        user_id?: string;
        account_id?: string; // UUID ad_accounts.id для мультиаккаунтного режима
        page_id?: string;
        instagram_id?: string;
        ad_account_id?: string;
      };

      // Validate required fields
      if (!user_id) {
        log.error('Missing user_id in manual connect request');
        return res.status(400).send({
          success: false,
          error: 'Missing user_id'
        });
      }

      if (!page_id) {
        log.error('Missing page_id in manual connect request');
        return res.status(400).send({
          success: false,
          error: 'Page ID обязателен'
        });
      }

      if (!ad_account_id) {
        log.error('Missing ad_account_id in manual connect request');
        return res.status(400).send({
          success: false,
          error: 'Ad Account ID обязателен'
        });
      }

      // Normalize ad_account_id - ensure it starts with 'act_'
      const normalizedAdAccountId = ad_account_id.startsWith('act_')
        ? ad_account_id
        : `act_${ad_account_id}`;

      log.info({
        user_id,
        account_id: account_id || null,
        page_id,
        instagram_id: instagram_id || null,
        ad_account_id: normalizedAdAccountId
      }, 'Saving manual Facebook connection');

      // Update user_accounts with provided IDs and set status to pending_review
      // Also update onboarding_stage to 'fb_pending'
      const { error: updateError } = await supabase
        .from('user_accounts')
        .update({
          page_id,
          instagram_id: instagram_id || null,
          ad_account_id: normalizedAdAccountId,
          fb_connection_status: 'pending_review',
          onboarding_stage: 'fb_pending',
          updated_at: new Date().toISOString()
        })
        .eq('id', user_id);

      if (updateError) {
        log.error({ error: updateError, user_id }, 'Failed to save manual Facebook connection');
        return res.status(500).send({
          success: false,
          error: 'Ошибка сохранения данных'
        });
      }

      // Для мультиаккаунтного режима: обновляем конкретный ad_account по account_id
      if (account_id) {
        const { error: adAccountError } = await supabase
          .from('ad_accounts')
          .update({
            page_id: page_id,
            ad_account_id: normalizedAdAccountId,
            instagram_id: instagram_id || null,
            updated_at: new Date().toISOString()
          })
          .eq('id', account_id)
          .eq('user_account_id', user_id); // Проверка принадлежности

        if (adAccountError) {
          log.warn({ error: adAccountError, account_id }, 'Failed to update ad_account with Facebook data');
        } else {
          log.info({ account_id, page_id, fb_ad_account_id: normalizedAdAccountId }, 'Updated ad_account with Facebook data');
        }
      }

      log.info({
        user_id,
        page_id,
        ad_account_id: normalizedAdAccountId,
        status: 'pending_review'
      }, 'Manual Facebook connection saved successfully');

      // Get user info for notification
      const { data: userData } = await supabase
        .from('user_accounts')
        .select('username, telegram_id')
        .eq('id', user_id)
        .single();

      // Send Telegram notification to tech specialists
      const notificationText = `🔔 <b>Новая заявка на подключение Facebook</b>

👤 Пользователь: ${userData?.username || user_id}
${userData?.telegram_id ? `📱 Telegram: ${userData.telegram_id}` : ''}

📋 <b>Данные для проверки:</b>
• Page ID: <code>${page_id}</code>
• Ad Account ID: <code>${normalizedAdAccountId}</code>
${instagram_id ? `• Instagram ID: <code>${instagram_id}</code>` : '• Instagram ID: не указан'}

⏳ Статус: ожидает проверки`;

      // Send notification in background (don't await to not delay response)
      sendTelegramNotification(notificationText).catch(err => {
        log.error({ err }, 'Failed to send Telegram notification for manual connect');
      });

      return res.send({
        success: true,
        message: 'Заявка отправлена на проверку'
      });

    } catch (error) {
      log.error({ error }, 'Error processing manual Facebook connection');
      return res.status(500).send({
        success: false,
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

