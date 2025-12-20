/**
 * Altegio Token Management
 *
 * Unlike AmoCRM/Bitrix24, Altegio uses Partner Token + User Token scheme:
 * - Partner Token: obtained from Altegio Marketplace (does not expire)
 * - User Token: obtained when company connects (can be revoked by user)
 *
 * No automatic token refresh needed.
 *
 * @module lib/altegioTokens
 */

import { supabase } from './supabase.js';
import { createAltegioClient, AltegioClient } from '../adapters/altegio.js';

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
 * @param userAccountId - UUID of the user account
 * @returns Altegio credentials or null if not connected
 */
export async function getAltegioCredentials(
  userAccountId: string
): Promise<AltegioCredentials | null> {
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
 * @returns Altegio client or null if not connected
 */
export async function getAltegioClient(
  userAccountId: string
): Promise<{ client: AltegioClient; companyId: number } | null> {
  const credentials = await getAltegioCredentials(userAccountId);

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
 * Save Altegio credentials for a user account
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
 * Remove Altegio credentials for a user account (disconnect)
 *
 * @param userAccountId - UUID of the user account
 */
export async function removeAltegioCredentials(
  userAccountId: string
): Promise<boolean> {
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
 */
export async function isAltegioConnected(userAccountId: string): Promise<boolean> {
  const credentials = await getAltegioCredentials(userAccountId);
  return credentials !== null;
}

/**
 * Validate Altegio connection by making a test API call
 *
 * @param userAccountId - UUID of the user account
 * @returns true if connection is valid
 */
export async function validateAltegioConnection(
  userAccountId: string
): Promise<{ valid: boolean; error?: string }> {
  const result = await getAltegioClient(userAccountId);

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
