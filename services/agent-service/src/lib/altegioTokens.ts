/**
 * Altegio Token Management
 *
 * Unlike AmoCRM/Bitrix24, Altegio uses Partner Token + User Token scheme:
 * - Partner Token: obtained from Altegio Marketplace (does not expire)
 * - User Token: obtained when company connects (can be revoked by user)
 *
 * Supports both legacy mode (user_accounts) and multi-account mode (ad_accounts)
 *
 * @module lib/altegioTokens
 */

import { supabase } from './supabase.js';
import { createAltegioClient, AltegioClient as AltegioApiClient } from '../adapters/altegio.js';

// ============================================================================
// Environment variables
// ============================================================================

// Partner token from Altegio Marketplace - shared across all users
const ALTEGIO_PARTNER_TOKEN = process.env.ALTEGIO_PARTNER_TOKEN || '';

// ============================================================================
// Types
// ============================================================================

export interface AltegioCredentials {
  companyId: number;
  partnerToken: string;
  userToken: string;
  companyName?: string;
}

// ============================================================================
// Token Management Functions
// ============================================================================

/**
 * Get Altegio credentials for a user account
 *
 * Supports both legacy mode (credentials in user_accounts) and
 * multi-account mode (credentials in ad_accounts)
 *
 * @param userAccountId - UUID of the user account
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Altegio credentials or null if not connected
 */
export async function getAltegioCredentials(
  userAccountId: string,
  accountId?: string | null
): Promise<AltegioCredentials | null> {
  // First check if multi-account mode is enabled
  const { data: userAccountCheck } = await supabase
    .from('user_accounts')
    .select('multi_account_enabled')
    .eq('id', userAccountId)
    .single();

  const isMultiAccountMode = userAccountCheck?.multi_account_enabled && accountId;

  if (isMultiAccountMode) {
    // Multi-account mode: get credentials from ad_accounts
    const { data: adAccount, error: adError } = await supabase
      .from('ad_accounts')
      .select('altegio_company_id, altegio_partner_token, altegio_user_token, altegio_company_name')
      .eq('id', accountId)
      .eq('user_account_id', userAccountId)
      .single();

    if (adError || !adAccount) {
      console.error('Error getting Altegio credentials from ad_accounts:', adError);
      return null;
    }

    // Check if Altegio is connected
    if (!adAccount.altegio_company_id || !adAccount.altegio_user_token) {
      return null;
    }

    // Use stored partner token or global one
    const partnerToken = adAccount.altegio_partner_token || ALTEGIO_PARTNER_TOKEN;

    if (!partnerToken) {
      console.error('No Altegio partner token available');
      return null;
    }

    return {
      companyId: adAccount.altegio_company_id,
      partnerToken,
      userToken: adAccount.altegio_user_token,
      companyName: adAccount.altegio_company_name,
    };
  }

  // Legacy mode: get credentials from user_accounts
  const { data: account, error } = await supabase
    .from('user_accounts')
    .select('altegio_company_id, altegio_partner_token, altegio_user_token, altegio_company_name')
    .eq('id', userAccountId)
    .single();

  if (error || !account) {
    console.error('Error getting Altegio credentials:', error);
    return null;
  }

  // Check if Altegio is connected
  if (!account.altegio_company_id || !account.altegio_user_token) {
    return null;
  }

  // Use stored partner token or global one
  const partnerToken = account.altegio_partner_token || ALTEGIO_PARTNER_TOKEN;

  if (!partnerToken) {
    console.error('No Altegio partner token available');
    return null;
  }

  return {
    companyId: account.altegio_company_id,
    partnerToken,
    userToken: account.altegio_user_token,
    companyName: account.altegio_company_name,
  };
}

/**
 * Get an authenticated Altegio API client for a user account
 *
 * @param userAccountId - UUID of the user account
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Altegio client or null if not connected
 */
export async function getAltegioClient(
  userAccountId: string,
  accountId?: string | null
): Promise<{ client: AltegioApiClient; companyId: number } | null> {
  const credentials = await getAltegioCredentials(userAccountId, accountId);

  if (!credentials) {
    return null;
  }

  const client = createAltegioClient(credentials.partnerToken, credentials.userToken);

  return {
    client,
    companyId: credentials.companyId,
  };
}

/**
 * Save Altegio credentials for a user account (legacy mode)
 *
 * @param userAccountId - UUID of the user account
 * @param companyId - Altegio company ID
 * @param userToken - User token from Altegio
 * @param companyName - Optional company name
 */
export async function saveAltegioCredentials(
  userAccountId: string,
  companyId: number,
  userToken: string,
  companyName?: string
): Promise<boolean> {
  const { error } = await supabase
    .from('user_accounts')
    .update({
      altegio_company_id: companyId,
      altegio_partner_token: ALTEGIO_PARTNER_TOKEN,
      altegio_user_token: userToken,
      altegio_company_name: companyName || null,
      altegio_connected_at: new Date().toISOString(),
    })
    .eq('id', userAccountId);

  if (error) {
    console.error('Error saving Altegio credentials:', error);
    return false;
  }

  return true;
}

/**
 * Save Altegio credentials to ad_accounts (multi-account mode)
 *
 * @param accountId - Ad account UUID
 * @param companyId - Altegio company ID
 * @param userToken - User token from Altegio
 * @param companyName - Optional company name
 */
export async function saveAltegioCredentialsToAdAccount(
  accountId: string,
  companyId: number,
  userToken: string,
  companyName?: string
): Promise<boolean> {
  const { error } = await supabase
    .from('ad_accounts')
    .update({
      altegio_company_id: companyId,
      altegio_partner_token: ALTEGIO_PARTNER_TOKEN,
      altegio_user_token: userToken,
      altegio_company_name: companyName || null,
      altegio_connected_at: new Date().toISOString(),
    })
    .eq('id', accountId);

  if (error) {
    console.error('Error saving Altegio credentials to ad_accounts:', error);
    return false;
  }

  return true;
}

/**
 * Remove Altegio credentials for a user account (disconnect)
 *
 * @param userAccountId - UUID of the user account
 * @param accountId - Optional ad_account UUID for multi-account mode
 */
export async function removeAltegioCredentials(
  userAccountId: string,
  accountId?: string | null
): Promise<boolean> {
  // Check if multi-account mode
  const { data: userAccountCheck } = await supabase
    .from('user_accounts')
    .select('multi_account_enabled')
    .eq('id', userAccountId)
    .single();

  const isMultiAccountMode = userAccountCheck?.multi_account_enabled && accountId;

  if (isMultiAccountMode) {
    const { error } = await supabase
      .from('ad_accounts')
      .update({
        altegio_company_id: null,
        altegio_partner_token: null,
        altegio_user_token: null,
        altegio_company_name: null,
        altegio_connected_at: null,
      })
      .eq('id', accountId);

    if (error) {
      console.error('Error removing Altegio credentials from ad_accounts:', error);
      return false;
    }

    return true;
  }

  // Legacy mode
  const { error } = await supabase
    .from('user_accounts')
    .update({
      altegio_company_id: null,
      altegio_partner_token: null,
      altegio_user_token: null,
      altegio_company_name: null,
      altegio_connected_at: null,
    })
    .eq('id', userAccountId);

  if (error) {
    console.error('Error removing Altegio credentials:', error);
    return false;
  }

  return true;
}

/**
 * Check if Altegio is connected for a user account
 *
 * @param userAccountId - UUID of the user account
 * @param accountId - Optional ad_account UUID for multi-account mode
 */
export async function isAltegioConnected(
  userAccountId: string,
  accountId?: string | null
): Promise<boolean> {
  const credentials = await getAltegioCredentials(userAccountId, accountId);
  return credentials !== null;
}

/**
 * Validate Altegio connection by making a test API call
 *
 * @param userAccountId - UUID of the user account
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns true if connection is valid
 */
export async function validateAltegioConnection(
  userAccountId: string,
  accountId?: string | null
): Promise<{ valid: boolean; error?: string }> {
  const result = await getAltegioClient(userAccountId, accountId);

  if (!result) {
    return { valid: false, error: 'Altegio not connected' };
  }

  try {
    // Try to get company info as a validation
    await result.client.getCompany(result.companyId);
    return { valid: true };
  } catch (error: any) {
    console.error('Altegio connection validation failed:', error);
    return { valid: false, error: error.message || 'Connection failed' };
  }
}

/**
 * Get the global partner token from environment
 * For use in connection flow
 */
export function getPartnerToken(): string {
  return ALTEGIO_PARTNER_TOKEN;
}

/**
 * Check if partner token is configured
 */
export function isPartnerTokenConfigured(): boolean {
  return !!ALTEGIO_PARTNER_TOKEN;
}
