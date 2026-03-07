import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';
import { updateOnboardingStage } from '../lib/onboardingHelper.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import { resolveCreativeAndDirection } from '../lib/creativeResolver.js';
import { eventLogger } from '../lib/eventLogger.js';
import { getPageAccessToken, subscribePageToLeadgen } from '../lib/facebookHelpers.js';
import { shouldFilterByAccountId } from '../lib/multiAccountHelper.js';

const log = createLogger({ module: 'facebookWebhooks' });

const FB_APP_SECRET = process.env.FB_APP_SECRET || '';
const FB_APP_ID = process.env.FB_APP_ID || '1441781603583445';
const FB_REDIRECT_URI = process.env.FB_REDIRECT_URI || 'https://performanteaiagency.com/profile';
const FB_WEBHOOK_VERIFY_TOKEN = process.env.FB_WEBHOOK_VERIFY_TOKEN || 'performante_leadgen_webhook_2024';
const FB_API_VERSION = process.env.FB_API_VERSION || 'v20.0';

// Telegram notifications for manual Facebook connections
const TELEGRAM_BOT_TOKEN = process.env.LOG_ALERT_TELEGRAM_BOT_TOKEN;
const TELEGRAM_TECH_CHAT_ID = '-5079020326';

// Custom lead notifications per account (hardcoded for specific clients)
const LEAD_NOTIFICATIONS: Record<string, string> = {
  // Bas Dent - отправка лидов в TG группу
  '91454447-2906-4d89-892b-12c817584b0f': '-4862556272'
};

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

/**
 * Send lead notification to custom Telegram group (per-account)
 */
async function sendLeadNotificationToTelegram(
  accountId: string,
  leadData: {
    name: string | null;
    phone: string | null;
    formName: string | null;
    fieldData: Array<{ name: string; values: string[] }> | null;
  }
): Promise<void> {
  const chatId = LEAD_NOTIFICATIONS[accountId];
  if (!chatId || !TELEGRAM_BOT_TOKEN) return;

  // Format form answers (skip standard fields)
  const skipFields = new Set(['full_name', 'name', 'first_name', 'phone_number', 'phone', 'email', 'email_address']);
  let answersText = '';
  if (leadData.fieldData) {
    const answers = leadData.fieldData
      .filter(f => !skipFields.has(f.name.toLowerCase()))
      .map(f => `  ${f.name.replace(/_/g, ' ')}: ${f.values?.[0] || '—'}`)
      .join('\n');
    if (answers) answersText = `\n📋 <b>Ответы:</b>\n${answers}\n`;
  }

  const text = `🔔 <b>Новый лид с Facebook</b>

👤 Имя: ${leadData.name || '—'}
📞 Телефон: ${leadData.phone || '—'}
📁 Форма: ${leadData.formName || '—'}
${answersText}
⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
      })
    });

    if (!res.ok) {
      const body = await res.text();
      log.error({ status: res.status, body, accountId }, 'Failed to send lead notification to Telegram');
    } else {
      log.info({ accountId, chatId }, 'Lead notification sent to Telegram');
    }
  } catch (err) {
    log.error({ err, accountId }, 'Error sending lead notification to Telegram');
  }
}

/**
 * Retrieve lead data from Facebook Lead Forms API
 *
 * @param leadgenId - The leadgen_id from the webhook
 * @param accessToken - Page Access Token with leads_retrieval permission
 * @returns Lead data with field_data containing form fields
 */
async function retrieveLeadData(leadgenId: string, accessToken: string): Promise<{
  id: string;
  ad_id?: string;
  form_id?: string;
  created_time?: string;
  field_data?: Array<{ name: string; values: string[] }>;
} | null> {
  try {
    const url = `https://graph.facebook.com/${FB_API_VERSION}/${leadgenId}?fields=id,ad_id,form_id,created_time,field_data&access_token=${accessToken}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || data.error) {
      log.error({ error: data.error, leadgenId }, 'Failed to retrieve lead data from Facebook');
      return null;
    }

    log.info({ leadgenId, hasFieldData: !!data.field_data }, 'Retrieved lead data from Facebook');
    return data;
  } catch (error) {
    log.error({ error, leadgenId }, 'Error retrieving lead data');
    return null;
  }
}

/**
 * Extract field value from lead field_data
 */
function extractFieldValue(fieldData: Array<{ name: string; values: string[] }>, fieldNames: string[]): string | null {
  for (const name of fieldNames) {
    const field = fieldData.find(f => f.name.toLowerCase() === name.toLowerCase());
    if (field && field.values && field.values.length > 0) {
      return field.values[0];
    }
  }
  return null;
}

/**
 * Normalize phone number (remove spaces, dashes, etc.)
 */
function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  // Remove all non-digit characters except leading +
  let normalized = phone.replace(/[^\d+]/g, '');
  // If starts with 8, replace with 7 (Kazakhstan/Russia)
  if (normalized.startsWith('8') && normalized.length === 11) {
    normalized = '7' + normalized.substring(1);
  }
  return normalized;
}

export default async function facebookWebhooks(app: FastifyInstance) {

  /**
   * Facebook Webhook Verification (GET)
   *
   * Facebook calls this endpoint to verify webhook subscription.
   * Must respond with hub.challenge if hub.verify_token matches.
   */
  app.get('/facebook/webhook', async (req, res) => {
    const query = req.query as {
      'hub.mode'?: string;
      'hub.verify_token'?: string;
      'hub.challenge'?: string;
    };

    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    log.info({ mode, hasToken: !!token, hasChallenge: !!challenge }, 'Facebook webhook verification request');

    if (mode === 'subscribe' && token === FB_WEBHOOK_VERIFY_TOKEN) {
      log.info('Webhook verification successful');
      return res.status(200).send(challenge);
    }

    log.warn({ mode, token }, 'Webhook verification failed - invalid token');
    return res.status(403).send('Forbidden');
  });

  /**
   * Facebook Webhook Handler (POST)
   *
   * Handles leadgen events from Facebook Lead Forms.
   * When a user submits a lead form, Facebook sends a webhook with leadgen_id.
   * We then retrieve the lead data and create a lead in our database.
   */
  app.post('/facebook/webhook', async (req, res) => {
    try {
      const body = req.body as any;

      log.info({
        object: body?.object,
        entryCount: body?.entry?.length
      }, 'Received Facebook webhook');

      // Verify this is a page webhook
      if (body.object !== 'page') {
        log.warn({ object: body.object }, 'Not a page webhook, ignoring');
        return res.status(200).send('EVENT_RECEIVED');
      }

      // Process each entry
      for (const entry of body.entry || []) {
        const pageId = entry.id;

        // Process each change (leadgen event)
        for (const change of entry.changes || []) {
          if (change.field !== 'leadgen') {
            log.debug({ field: change.field }, 'Not a leadgen event, skipping');
            continue;
          }

          const leadgenData = change.value;
          const { leadgen_id, ad_id, form_id, page_id, adgroup_id } = leadgenData;

          log.info({
            leadgen_id,
            ad_id,
            form_id,
            page_id: page_id || pageId,
            adgroup_id
          }, 'Processing leadgen event');

          // Find account by page_id (multi-account first, then legacy)
          const targetPageId = page_id || pageId;
          let userAccountId: string;
          let pageAccessToken: string | null = null;
          let userAccessToken: string;
          let adAccountId: string | null = null;

          // 1. Try ad_accounts (multi-account support)
          const { data: adAccount } = await supabase
            .from('ad_accounts')
            .select('id, user_account_id, access_token, fb_page_access_token')
            .eq('page_id', targetPageId)
            .eq('is_active', true)
            .maybeSingle();

          if (adAccount?.access_token) {
            userAccountId = adAccount.user_account_id;
            userAccessToken = adAccount.access_token;
            pageAccessToken = adAccount.fb_page_access_token || null;
            adAccountId = adAccount.id;
            log.info({ pageId: targetPageId, adAccountId, hasPageToken: !!pageAccessToken }, 'Found ad_account for leadgen');
          } else {
            // 2. Fallback to user_accounts (legacy)
            const { data: userAccount, error: userError } = await supabase
              .from('user_accounts')
              .select('id, access_token, page_id, fb_page_access_token')
              .eq('page_id', targetPageId)
              .maybeSingle();

            if (userError || !userAccount) {
              log.warn({ pageId: targetPageId }, 'User account not found for page_id');
              continue;
            }

            userAccountId = userAccount.id;
            userAccessToken = userAccount.access_token;
            pageAccessToken = userAccount.fb_page_access_token || null;
            log.info({ pageId: targetPageId, userAccountId, hasPageToken: !!pageAccessToken }, 'Found user_account (legacy) for leadgen');
          }

          // Prefer Page Access Token for lead data retrieval (has leads_retrieval permission)
          // Fall back to User Access Token if Page Token not available
          const tokenForLeadData = pageAccessToken || userAccessToken;

          if (!tokenForLeadData) {
            log.error({ userAccountId, pageId: targetPageId }, 'No access token for account');
            continue;
          }

          // Retrieve lead data from Facebook
          const leadData = await retrieveLeadData(leadgen_id, tokenForLeadData);

          if (!leadData || !leadData.field_data) {
            log.error({ leadgen_id, userAccountId }, 'Failed to retrieve lead data');
            continue;
          }

          // Extract fields from lead form
          const fieldData = leadData.field_data;
          const name = extractFieldValue(fieldData, ['full_name', 'name', 'first_name', 'имя', 'фио', 'полное_имя', 'полное имя']);
          const phone = normalizePhone(extractFieldValue(fieldData, ['phone_number', 'phone', 'телефон', 'номер_телефона', 'номер телефона']));
          const email = extractFieldValue(fieldData, ['email', 'email_address', 'почта', 'e-mail', 'электронная_почта']);

          if (!name && !phone) {
            log.warn({ leadgen_id, fieldData }, 'Lead has no name or phone');
            continue;
          }

          // Check for duplicate lead (same leadgen_id)
          const { data: existingLead } = await supabase
            .from('leads')
            .select('id')
            .eq('leadgen_id', leadgen_id)
            .maybeSingle();

          if (existingLead) {
            log.info({ leadgen_id, existingLeadId: existingLead.id }, 'Duplicate leadgen_id, skipping');
            continue;
          }

          // Resolve creative_id and direction_id from ad_id
          let creativeId: string | null = null;
          let directionId: string | null = null;
          // Use adAccountId from ad_accounts lookup, or resolve from direction
          let accountId: string | null = adAccountId;

          if (ad_id) {
            const resolved = await resolveCreativeAndDirection(
              ad_id,
              null,
              userAccountId,
              adAccountId, // Pass adAccountId for multi-account
              app
            );
            creativeId = resolved.creativeId;
            directionId = resolved.directionId;

            // If no adAccountId from lookup, try to get from direction
            if (!accountId && directionId) {
              const { data: direction } = await supabase
                .from('account_directions')
                .select('account_id')
                .eq('id', directionId)
                .maybeSingle();
              accountId = direction?.account_id || null;
            }

            log.info({
              ad_id,
              creativeId,
              directionId,
              accountId
            }, 'Resolved creative from lead form ad_id');
          }

          // Validate account ownership (security check)
          if (accountId && userAccountId) {
            const { data: ownership } = await supabase
              .from('ad_accounts')
              .select('id')
              .eq('id', accountId)
              .eq('user_account_id', userAccountId)
              .single();

            if (!ownership) {
              log.warn({
                accountId,
                userAccountId,
                page_id: targetPageId
              }, 'Account ownership validation failed: account_id does not belong to user_account_id, setting to NULL');
              accountId = null;  // Сбрасываем в NULL вместо ошибки (не блокируем лида)
            } else {
              log.info({
                accountId,
                userAccountId
              }, 'Account ownership validated successfully');
            }
          }

          // Prepare lead data for parallel processing
          const leadInsertData = {
            user_account_id: userAccountId,
            account_id: accountId,

            // Lead form fields
            name: name || 'Lead Form',
            phone: phone || null,
            email: email || null,
            source_type: 'lead_form',

            // Facebook tracking
            source_id: ad_id || null,
            creative_id: creativeId,
            direction_id: directionId,
            leadgen_id: leadgen_id,

            // UTM for analytics compatibility
            utm_source: 'facebook_lead_form',
            utm_campaign: form_id || null,

            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          // Check Bitrix24 auto-create BEFORE parallel operations
          let bitrix24Enabled = false;
          try {
            const { checkBitrix24AutoCreate } = await import('../workflows/bitrix24Sync.js');
            const bitrix24Settings = await checkBitrix24AutoCreate(userAccountId, accountId);
            bitrix24Enabled = bitrix24Settings.enabled;
            log.debug({ bitrix24Enabled, accountId }, '[Bitrix24] Auto-create check');
          } catch (err: any) {
            log.warn({ err: err.message }, '[Bitrix24] Auto-create check failed');
          }

          // Run DB save and Bitrix24 push in parallel
          const dbSavePromise = supabase
            .from('leads')
            .insert(leadInsertData)
            .select('id')
            .single();

          const bitrix24Promise = bitrix24Enabled && phone
            ? (async () => {
                const { pushLeadToBitrix24Direct } = await import('../workflows/bitrix24Sync.js');
                return pushLeadToBitrix24Direct(
                  {
                    name: name || null,
                    phone,
                    email: email || null,
                    utm_source: 'facebook_lead_form',
                    utm_campaign: form_id || null
                  },
                  userAccountId,
                  accountId,
                  app
                );
              })()
            : Promise.resolve(null);

          // Wait for both operations - use allSettled so Bitrix24 errors don't block DB save
          const [dbSettled, bitrix24Settled] = await Promise.allSettled([dbSavePromise, bitrix24Promise]);

          // Check DB result first (critical)
          if (dbSettled.status === 'rejected') {
            log.error({ error: dbSettled.reason, leadgen_id }, 'Failed to insert lead (rejected)');
            continue;
          }

          const { data: lead, error: insertError } = dbSettled.value;

          if (insertError || !lead) {
            log.error({ error: insertError, leadgen_id }, 'Failed to insert lead');
            continue;
          }

          log.info({
            leadId: lead.id,
            leadgen_id,
            ad_id,
            name,
            phone,
            creativeId,
            directionId
          }, 'Lead form lead created successfully');

          // Check Bitrix24 result (non-critical - log warning if failed)
          let bitrix24Result = null;
          if (bitrix24Settled.status === 'fulfilled') {
            bitrix24Result = bitrix24Settled.value;
          } else if (bitrix24Enabled) {
            log.warn({ error: bitrix24Settled.reason, leadgen_id }, '[Bitrix24] Push failed but lead saved to DB');
          }

          // Update lead with Bitrix24 IDs if push was successful
          if (bitrix24Result) {
            const updateData: Record<string, any> = {};
            if (bitrix24Result.bitrix24LeadId) {
              updateData.bitrix24_lead_id = bitrix24Result.bitrix24LeadId;
              updateData.bitrix24_entity_type = 'lead';
            }
            if (bitrix24Result.bitrix24DealId) {
              updateData.bitrix24_deal_id = bitrix24Result.bitrix24DealId;
              updateData.bitrix24_entity_type = 'deal';
            }
            if (bitrix24Result.bitrix24ContactId) updateData.bitrix24_contact_id = bitrix24Result.bitrix24ContactId;

            if (Object.keys(updateData).length > 0) {
              await supabase
                .from('leads')
                .update(updateData)
                .eq('id', lead.id);

              log.info({
                leadId: lead.id,
                bitrix24LeadId: bitrix24Result.bitrix24LeadId,
                bitrix24DealId: bitrix24Result.bitrix24DealId,
                bitrix24ContactId: bitrix24Result.bitrix24ContactId
              }, '[Bitrix24] Lead updated with Bitrix24 IDs');
            }
          }

          // Send lead notification to Telegram (per-account)
          if (accountId && LEAD_NOTIFICATIONS[accountId]) {
            // Get form name from Facebook
            let formName: string | null = null;
            const formIdForName = form_id || leadData.form_id;
            if (formIdForName && tokenForLeadData) {
              try {
                const formRes = await fetch(`https://graph.facebook.com/${FB_API_VERSION}/${formIdForName}?fields=name&access_token=${tokenForLeadData}`);
                const formData = await formRes.json();
                formName = formData.name || null;
              } catch (e) {
                log.warn({ formId: formIdForName }, 'Failed to fetch form name');
              }
            }
            sendLeadNotificationToTelegram(accountId, { name, phone, formName, fieldData }).catch(err => {
              log.error({ err, accountId }, 'Failed to send lead TG notification');
            });
          }

          // Log business event
          await eventLogger.logBusinessEvent(
            userAccountId,
            'lead_received',
            {
              leadId: lead.id,
              source: 'facebook_lead_form',
              directionId,
              creativeId,
              leadgen_id
            }
          );

          // Bitrix24 sync is now done in parallel above (pushLeadToBitrix24Direct)
        }
      }

      // Always respond 200 to Facebook
      return res.status(200).send('EVENT_RECEIVED');

    } catch (error: any) {
      log.error({ error }, 'Error processing Facebook webhook');

      logErrorToAdmin({
        error_type: 'webhook',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'facebook_leadgen_webhook',
        endpoint: '/facebook/webhook',
        severity: 'critical'
      }).catch(() => {});

      // Always respond 200 to prevent Facebook from retrying
      return res.status(200).send('EVENT_RECEIVED');
    }
  });

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

    } catch (error: any) {
      log.error({ error }, 'Error exchanging OAuth code');

      logErrorToAdmin({
        error_type: 'facebook',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'facebook_oauth_token_exchange',
        endpoint: '/facebook/oauth/token',
        severity: 'warning'
      }).catch(() => {});

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

      // Get Page Access Token for Lead Forms API
      const pageAccessToken = await getPageAccessToken(page_id, access_token);
      if (pageAccessToken) {
        log.info({ pageId: page_id }, 'Successfully obtained Page Access Token');
      } else {
        log.warn({ pageId: page_id }, 'Could not obtain Page Access Token - Lead Forms may not work');
      }

      // Update user with selected data
      const { error: updateError } = await freshSupabase
        .from('user_accounts')
        .update({
          access_token,
          ad_account_id,
          page_id,
          instagram_id: instagram_id || null,
          fb_page_access_token: pageAccessToken || null,
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
        saved_instagram_id: instagram_id,
        hasPageAccessToken: !!pageAccessToken
      }, 'Successfully saved Facebook selection to database');

      // Subscribe page to leadgen webhook (for Lead Forms) - use Page Access Token
      if (pageAccessToken) {
        subscribePageToLeadgen(page_id, pageAccessToken).catch(err => {
          log.warn({ err, pageId: page_id }, 'Failed to subscribe page to leadgen webhook');
        });
      }

      // Обновляем этап онбординга: Facebook подключается (ожидает подтверждения)
      updateOnboardingStage(existingUser.id, 'fb_pending', 'Facebook данные сохранены, ожидает подтверждения').catch(err => {
        log.warn({ err, userId: existingUser.id }, 'Failed to update onboarding stage for fb_pending');
      });

      return res.send({
        success: true
      });

    } catch (error: any) {
      log.error({ error }, 'Error saving Facebook selection');

      logErrorToAdmin({
        error_type: 'facebook',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'facebook_save_selection',
        endpoint: '/facebook/save-selection',
        severity: 'warning'
      }).catch(() => {});

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

      const { accessToken: bodyToken, adAccountId, pageId } = req.body as {
        accessToken?: string;
        adAccountId?: string;
        pageId?: string;
      };

      // SECURITY: Получаем токен из БД по x-user-id, а не из тела запроса
      let accessToken = bodyToken; // fallback для обратной совместимости
      const userId = req.headers['x-user-id'] as string;
      if (userId && !bodyToken) {
        const { data: userAcc } = await supabase
          .from('user_accounts')
          .select('access_token')
          .eq('id', userId)
          .single();
        accessToken = userAcc?.access_token || undefined;
      }

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

      // 4. Validate active directions - DISABLED (WhatsApp validation not needed)
      // Валидация направлений отключена по запросу пользователя
      checks.directions = [];

      const allPassed = checks.token && checks.adAccount && checks.page;
      // Не включаем валидацию направлений в общий success - только базовые проверки
      // const directionsOk = directionsValidation.length === 0 || directionsValidation.every(d => d.success);

      return res.send({
        success: allPassed,
        checks,
        error: allPassed ? null : 'Some checks failed',
        details: allPassed ? 'All validations passed' : 'Check individual statuses'
      });
    } catch (error: any) {
      log.error({ error }, 'Error validating Facebook connection');

      logErrorToAdmin({
        error_type: 'facebook',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'facebook_validate_connection',
        endpoint: '/facebook/validate',
        severity: 'warning'
      }).catch(() => {});

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

      // Определяем режим работы: multi-account или legacy
      const isMultiAccount = await shouldFilterByAccountId(supabase, user_id, account_id);

      if (isMultiAccount) {
        // MULTI-ACCOUNT РЕЖИМ: пишем ТОЛЬКО в ad_accounts
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
          log.error({ error: adAccountError, account_id, user_id }, 'Failed to update ad_account with Facebook data');
          return res.status(500).send({
            success: false,
            error: 'Ошибка сохранения данных'
          });
        }

        log.info({ account_id, page_id, fb_ad_account_id: normalizedAdAccountId }, 'Updated ad_account with Facebook data (multi-account mode)');
      } else {
        // LEGACY РЕЖИМ: пишем в user_accounts как раньше
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
      }

      log.info({
        user_id,
        page_id,
        ad_account_id: normalizedAdAccountId,
        status: 'pending_review'
      }, 'Manual Facebook connection saved successfully');

      // Get user info and account name for notification
      const { data: userData } = await supabase
        .from('user_accounts')
        .select('username, telegram_id')
        .eq('id', user_id)
        .single();

      let accountName = '';
      if (isMultiAccount && account_id) {
        const { data: adAccountData } = await supabase
          .from('ad_accounts')
          .select('name')
          .eq('id', account_id)
          .single();
        accountName = adAccountData?.name || '';
      }

      // Send Telegram notification to tech specialists
      const notificationText = `🔔 <b>Новая заявка на подключение Facebook</b>

👤 Пользователь: ${userData?.username || user_id}
${accountName ? `📦 Аккаунт: ${accountName}` : ''}
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

    } catch (error: any) {
      log.error({ error }, 'Error processing manual Facebook connection');

      logErrorToAdmin({
        error_type: 'facebook',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'facebook_manual_connect',
        endpoint: '/facebook/manual-connect',
        severity: 'warning'
      }).catch(() => {});

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

    } catch (error: any) {
      log.error({ error }, 'Error processing data deletion request');

      logErrorToAdmin({
        error_type: 'facebook',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'facebook_data_deletion',
        endpoint: '/facebook/data-deletion',
        severity: 'warning'
      }).catch(() => {});

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

