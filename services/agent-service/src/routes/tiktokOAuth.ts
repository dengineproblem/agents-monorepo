import { FastifyInstance } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';

const log = createLogger({ module: 'tiktokOAuth' });

const TIKTOK_APP_ID = process.env.TIKTOK_APP_ID || '7527489318093668353';
const TIKTOK_APP_SECRET = process.env.TIKTOK_APP_SECRET || '';

/**
 * Parse base64url encoded state from TikTok OAuth
 */
function parseState(state: string): { user_id?: string; uid?: string; ts?: number } | null {
  if (!state || typeof state !== 'string') {
    return null;
  }

  try {
    // Decode from base64url to JSON
    const decoded = Buffer.from(decodeURIComponent(state), 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch (error) {
    log.error({ error, state }, 'Failed to parse state parameter');
    return null;
  }
}

export default async function tiktokOAuthRoutes(app: FastifyInstance) {
  
  /**
   * TikTok OAuth - Exchange auth_code for access token
   * 
   * После того как пользователь авторизуется через TikTok,
   * TikTok редиректит его обратно с auth_code в URL.
   * Этот endpoint обменивает auth_code на access_token.
   */
  app.post('/tiktok/oauth/exchange', async (req, res) => {
    try {
      log.info('Exchanging TikTok OAuth code for access token');
      
      const { code, auth_code, state } = req.body as { 
        code?: string; 
        auth_code?: string; 
        state?: string; 
      };
      
      const authCode = code || auth_code;
      
      if (!authCode) {
        log.error('Missing auth_code parameter');
        return res.status(400).send({ 
          success: false,
          error: 'Missing auth_code parameter' 
        });
      }

      if (!state) {
        log.error('Missing state parameter');
        return res.status(400).send({ 
          success: false,
          error: 'Missing state parameter' 
        });
      }

      if (!TIKTOK_APP_SECRET) {
        log.error('TIKTOK_APP_SECRET not configured');
        return res.status(500).send({ 
          success: false,
          error: 'TikTok OAuth not configured on server' 
        });
      }

      // Parse state to get user_id
      const stateData = parseState(state);
      const userId = stateData?.user_id || stateData?.uid;

      if (!userId) {
        log.error({ state, stateData }, 'Invalid state - no user_id found');
        return res.status(400).send({ 
          success: false,
          error: 'Invalid state parameter - no user_id' 
        });
      }

      log.info({ 
        authCodePrefix: authCode.substring(0, 10) + '...', 
        userId 
      }, 'Processing TikTok OAuth exchange');

      // Exchange auth_code for access_token
      const tokenUrl = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/';
      
      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app_id: TIKTOK_APP_ID,
          secret: TIKTOK_APP_SECRET,
          auth_code: authCode
        })
      });

      const tokenData = await tokenResponse.json();

      log.info({ 
        responseCode: tokenData.code, 
        hasData: !!tokenData.data 
      }, 'TikTok token exchange response');

      if (!tokenResponse.ok || tokenData.code !== 0) {
        const errorMsg = tokenData.message || 'Failed to get access token';
        log.error({ 
          error: tokenData, 
          httpStatus: tokenResponse.status 
        }, 'Failed to exchange code for token');
        return res.status(400).send({
          success: false,
          error: errorMsg
        });
      }

      const { access_token } = tokenData.data;

      if (!access_token) {
        log.error({ tokenData }, 'No access_token in response');
        return res.status(400).send({
          success: false,
          error: 'No access token received from TikTok'
        });
      }

      // Get advertiser accounts (business accounts)
      // Note: access_token must be in Access-Token header, not in query params!
      const advertiserUrl = new URL('https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/');
      advertiserUrl.searchParams.set('app_id', TIKTOK_APP_ID);
      advertiserUrl.searchParams.set('secret', TIKTOK_APP_SECRET);
      
      const advertiserResponse = await fetch(advertiserUrl.toString(), {
        method: 'GET',
        headers: {
          'Access-Token': access_token
        }
      });
      
      const advertiserText = await advertiserResponse.text();
      log.info({ 
        httpStatus: advertiserResponse.status,
        responsePreview: advertiserText.substring(0, 200)
      }, 'TikTok advertiser raw response');
      
      let advertiserData: any;
      try {
        advertiserData = JSON.parse(advertiserText);
      } catch (parseError: any) {
        log.error({ 
          error: parseError.message, 
          rawResponse: advertiserText.substring(0, 500)
        }, 'Failed to parse TikTok advertiser response');
        return res.status(400).send({
          success: false,
          error: 'Invalid response from TikTok API'
        });
      }

      log.info({ 
        responseCode: advertiserData.code,
        hasData: !!advertiserData.data 
      }, 'TikTok advertiser info response');

      if (!advertiserResponse.ok || advertiserData.code !== 0) {
        log.error({ error: advertiserData }, 'Failed to get advertiser info');
        return res.status(400).send({
          success: false,
          error: advertiserData.message || 'Failed to get advertiser info'
        });
      }

      const advertisers = advertiserData.data?.list || [];

      if (advertisers.length === 0) {
        log.warn({ userId }, 'No TikTok advertiser accounts found');
        return res.status(400).send({
          success: false,
          error: 'No TikTok advertiser accounts found. Please create a TikTok Ads account first.'
        });
      }

      // Use first advertiser account
      const firstAdvertiser = advertisers[0];
      const business_id = firstAdvertiser.advertiser_id;
      const account_name = firstAdvertiser.advertiser_name;

      log.info({
        userId,
        business_id,
        account_name,
        advertisers_count: advertisers.length
      }, 'TikTok advertiser account retrieved');

      // Get identity list for the advertiser to find TT_USER identity_id
      const identityUrl = new URL('https://business-api.tiktok.com/open_api/v1.3/identity/get/');
      identityUrl.searchParams.set('advertiser_id', business_id);
      identityUrl.searchParams.set('app_id', TIKTOK_APP_ID);
      identityUrl.searchParams.set('secret', TIKTOK_APP_SECRET);

      log.info({ business_id }, 'Fetching TikTok identity list');

      const identityResponse = await fetch(identityUrl.toString(), {
        method: 'GET',
        headers: {
          'Access-Token': access_token
        }
      });

      const identityText = await identityResponse.text();
      log.info({
        httpStatus: identityResponse.status,
        responsePreview: identityText.substring(0, 200)
      }, 'TikTok identity raw response');

      let identityData: any;
      try {
        identityData = JSON.parse(identityText);
      } catch (parseError: any) {
        log.error({
          error: parseError.message,
          rawResponse: identityText.substring(0, 500)
        }, 'Failed to parse TikTok identity response');
        // Continue without identity - will use account_name as fallback
        identityData = { code: -1, data: { list: [] } };
      }

      log.info({
        responseCode: identityData.code,
        hasData: !!identityData.data,
        identitiesCount: identityData.data?.list?.length || 0
      }, 'TikTok identity info response');

      // Find TT_USER identity_id
      let identity_id = '';

      if (identityData.code === 0 && identityData.data?.list) {
        const identities = identityData.data.list;

        log.info({
          identitiesCount: identities.length,
          identitiesPreview: JSON.stringify(identities.slice(0, 3), null, 2)
        }, 'TikTok identities list received');

        // Try to find TT_USER identity first
        const ttUserIdentity = identities.find((id: any) => id.identity_type === 'TT_USER');

        if (ttUserIdentity) {
          identity_id = ttUserIdentity.identity_id || '';

          log.info({
            identity_id,
            identity_type: ttUserIdentity.identity_type,
            fullIdentity: JSON.stringify(ttUserIdentity, null, 2),
            totalIdentities: identities.length
          }, 'TikTok TT_USER identity found');
        } else {
          log.warn({
            business_id,
            availableTypes: identities.map((id: any) => id.identity_type)
          }, 'No TT_USER identity found for advertiser');
        }
      } else {
        log.warn({
          error: identityData.message || 'Unknown error',
          code: identityData.code,
          fullResponse: JSON.stringify(identityData, null, 2)
        }, 'Failed to get TikTok identities');
      }

      log.info({
        userId,
        business_id,
        account_name,
        identity_id
      }, 'TikTok OAuth successful');

      // Save to database
      const freshSupabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );

      const { error: updateError } = await freshSupabase
        .from('user_accounts')
        .update({
          tiktok_access_token: access_token,
          tiktok_business_id: business_id,
          tiktok_account_id: identity_id, // TT_USER identity_id only
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (updateError) {
        log.error({ error: updateError, userId }, 'Failed to save TikTok tokens');
        return res.status(500).send({
          success: false,
          error: 'Failed to save TikTok connection'
        });
      }

      log.info({ 
        userId, 
        business_id 
      }, 'Successfully saved TikTok tokens to database');

      return res.send({
        success: true,
        access_token,
        business_id,
        account_id: account_name,
        identity_id: identity_id,
        advertisers: advertisers.map((adv: any) => ({
          id: adv.advertiser_id,
          name: adv.advertiser_name
        })),
        message: 'TikTok connected successfully'
      });

    } catch (error: any) {
      log.error({ error }, 'Error in TikTok OAuth flow');
      return res.status(500).send({ 
        success: false,
        error: error.message || 'Internal server error' 
      });
    }
  });
}

