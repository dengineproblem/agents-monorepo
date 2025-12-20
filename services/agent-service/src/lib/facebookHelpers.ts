/**
 * Facebook API Helper Functions
 *
 * Shared utilities for Facebook Graph API operations
 */

import { createLogger } from './logger.js';

const log = createLogger({ module: 'facebookHelpers' });

const FB_API_VERSION = process.env.FB_API_VERSION || 'v20.0';

/**
 * Get Page Access Token from User Access Token
 *
 * @param pageId - Facebook Page ID
 * @param userAccessToken - User Access Token
 * @returns Page Access Token or null if not found
 */
export async function getPageAccessToken(pageId: string, userAccessToken: string): Promise<string | null> {
  try {
    const accountsUrl = `https://graph.facebook.com/${FB_API_VERSION}/me/accounts?access_token=${encodeURIComponent(userAccessToken)}&fields=id,access_token&limit=100`;

    const accountsResponse = await fetch(accountsUrl);
    const accountsData = await accountsResponse.json();

    if (accountsData.error) {
      log.error({ error: accountsData.error, pageId }, 'Failed to get /me/accounts');
      return null;
    }

    // Find the page and get its access token
    const page = accountsData.data?.find((p: any) => p.id === pageId);
    if (!page?.access_token) {
      log.warn({ pageId }, 'Page not found in /me/accounts');
      return null;
    }

    return page.access_token;
  } catch (error) {
    log.error({ error, pageId }, 'Error getting Page Access Token');
    return null;
  }
}

/**
 * Subscribe a Facebook Page to leadgen webhook events
 *
 * This is required for receiving lead form submissions via webhook.
 *
 * @param pageId - Facebook Page ID
 * @param pageAccessToken - Page Access Token (NOT User Access Token)
 * @returns true if subscription successful, false otherwise
 */
export async function subscribePageToLeadgen(pageId: string, pageAccessToken: string): Promise<boolean> {
  try {
    const subscribeUrl = `https://graph.facebook.com/${FB_API_VERSION}/${pageId}/subscribed_apps`;

    const subscribeResponse = await fetch(subscribeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: pageAccessToken,
        subscribed_fields: 'leadgen'
      }).toString()
    });

    const subscribeData = await subscribeResponse.json();

    if (subscribeData.error) {
      log.error({ error: subscribeData.error, pageId }, 'Failed to subscribe page to leadgen');
      return false;
    }

    if (subscribeData.success) {
      log.info({ pageId }, 'Successfully subscribed page to leadgen webhook');
      return true;
    }

    log.warn({ pageId, response: subscribeData }, 'Unexpected response from leadgen subscription');
    return false;

  } catch (error) {
    log.error({ error, pageId }, 'Error subscribing page to leadgen');
    return false;
  }
}
