/**
 * AmoCRM Token Management
 *
 * Handles token storage, retrieval, and automatic refresh for AmoCRM integration
 *
 * @module lib/amocrmTokens
 */

import { supabase } from './supabase.js';
import { refreshAccessToken, AmoCRMTokenResponse } from '../adapters/amocrm.js';

/**
 * User account with AmoCRM credentials
 */
interface UserAccountWithAmoCRM {
  id: string;
  amocrm_subdomain: string | null;
  amocrm_access_token: string | null;
  amocrm_refresh_token: string | null;
  amocrm_token_expires_at: string | null;
}

/**
 * Get valid AmoCRM access token for user
 * Automatically refreshes token if expired
 *
 * @param userAccountId - User account UUID
 * @returns Valid access token and subdomain
 * @throws Error if user doesn't have AmoCRM connected or refresh fails
 */
export async function getValidAmoCRMToken(
  userAccountId: string
): Promise<{ accessToken: string; subdomain: string }> {
  // Fetch user's AmoCRM credentials
  const { data: userAccount, error } = await supabase
    .from('user_accounts')
    .select('id, amocrm_subdomain, amocrm_access_token, amocrm_refresh_token, amocrm_token_expires_at')
    .eq('id', userAccountId)
    .single();

  if (error || !userAccount) {
    throw new Error(`Failed to fetch user account: ${error?.message || 'Not found'}`);
  }

  const account = userAccount as UserAccountWithAmoCRM;

  // Check if AmoCRM is connected
  if (!account.amocrm_subdomain || !account.amocrm_access_token || !account.amocrm_refresh_token) {
    throw new Error('AmoCRM is not connected for this user account');
  }

  const subdomain = account.amocrm_subdomain;
  const expiresAt = account.amocrm_token_expires_at
    ? new Date(account.amocrm_token_expires_at)
    : new Date(0);

  // Check if token is still valid (with 5 minute buffer)
  const now = new Date();
  const bufferTime = 5 * 60 * 1000; // 5 minutes in milliseconds

  if (expiresAt.getTime() > now.getTime() + bufferTime) {
    // Token is still valid
    return {
      accessToken: account.amocrm_access_token,
      subdomain
    };
  }

  // Token expired or about to expire - refresh it
  try {
    const tokens = await refreshAccessToken(account.amocrm_refresh_token, subdomain);

    // Save new tokens to database
    await saveAmoCRMTokens(userAccountId, subdomain, tokens);

    return {
      accessToken: tokens.access_token,
      subdomain
    };
  } catch (error: any) {
    throw new Error(`Failed to refresh AmoCRM token: ${error.message}`);
  }
}

/**
 * Save AmoCRM tokens to database
 *
 * @param userAccountId - User account UUID
 * @param subdomain - AmoCRM subdomain
 * @param tokens - Token response from AmoCRM
 */
export async function saveAmoCRMTokens(
  userAccountId: string,
  subdomain: string,
  tokens: AmoCRMTokenResponse
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  const { error } = await supabase
    .from('user_accounts')
    .update({
      amocrm_subdomain: subdomain,
      amocrm_access_token: tokens.access_token,
      amocrm_refresh_token: tokens.refresh_token,
      amocrm_token_expires_at: expiresAt.toISOString()
    })
    .eq('id', userAccountId);

  if (error) {
    throw new Error(`Failed to save AmoCRM tokens: ${error.message}`);
  }
}

/**
 * Disconnect AmoCRM from user account
 *
 * @param userAccountId - User account UUID
 */
export async function disconnectAmoCRM(userAccountId: string): Promise<void> {
  const { error } = await supabase
    .from('user_accounts')
    .update({
      amocrm_subdomain: null,
      amocrm_access_token: null,
      amocrm_refresh_token: null,
      amocrm_token_expires_at: null
    })
    .eq('id', userAccountId);

  if (error) {
    throw new Error(`Failed to disconnect AmoCRM: ${error.message}`);
  }
}

/**
 * Check if user has AmoCRM connected
 *
 * @param userAccountId - User account UUID
 * @returns True if AmoCRM is connected
 */
export async function isAmoCRMConnected(userAccountId: string): Promise<boolean> {
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('amocrm_subdomain, amocrm_access_token, amocrm_refresh_token')
    .eq('id', userAccountId)
    .single();

  if (!userAccount) {
    return false;
  }

  const account = userAccount as UserAccountWithAmoCRM;

  return !!(
    account.amocrm_subdomain &&
    account.amocrm_access_token &&
    account.amocrm_refresh_token
  );
}

/**
 * Get AmoCRM connection status for user
 *
 * @param userAccountId - User account UUID
 * @returns Connection status object
 */
export async function getAmoCRMStatus(userAccountId: string): Promise<{
  connected: boolean;
  subdomain?: string;
  tokenExpiresAt?: string;
}> {
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('amocrm_subdomain, amocrm_access_token, amocrm_refresh_token, amocrm_token_expires_at')
    .eq('id', userAccountId)
    .single();

  if (!userAccount) {
    return { connected: false };
  }

  const account = userAccount as UserAccountWithAmoCRM;

  const connected = !!(
    account.amocrm_subdomain &&
    account.amocrm_access_token &&
    account.amocrm_refresh_token
  );

  return {
    connected,
    subdomain: account.amocrm_subdomain || undefined,
    tokenExpiresAt: account.amocrm_token_expires_at || undefined
  };
}
