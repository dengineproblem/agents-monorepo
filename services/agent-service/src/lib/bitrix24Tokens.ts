/**
 * Bitrix24 Token Management
 *
 * Handles token storage, retrieval, and automatic refresh for Bitrix24 integration
 * Token lifetime is 1 hour (vs 24 hours in AmoCRM), so refresh happens more frequently
 *
 * @module lib/bitrix24Tokens
 */

import { supabase } from './supabase.js';
import { refreshAccessToken, Bitrix24TokenResponse } from '../adapters/bitrix24.js';

/**
 * User account with Bitrix24 credentials
 */
interface UserAccountWithBitrix24 {
  id: string;
  bitrix24_domain: string | null;
  bitrix24_access_token: string | null;
  bitrix24_refresh_token: string | null;
  bitrix24_token_expires_at: string | null;
  bitrix24_member_id: string | null;
  bitrix24_user_id: number | null;
  bitrix24_entity_type: string | null;
  bitrix24_qualification_fields: any[] | null;
  bitrix24_client_id?: string | null;
  bitrix24_client_secret?: string | null;
}

/**
 * Bitrix24 OAuth credentials (client_id and client_secret)
 */
export interface Bitrix24Credentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Get valid Bitrix24 access token for user
 * Automatically refreshes token if expired (1 hour lifetime)
 *
 * Supports both legacy mode (credentials in user_accounts) and
 * multi-account mode (credentials in ad_accounts)
 *
 * @param userAccountId - User account UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Valid access token and domain
 * @throws Error if user doesn't have Bitrix24 connected or refresh fails
 */
export async function getValidBitrix24Token(
  userAccountId: string,
  accountId?: string | null
): Promise<{ accessToken: string; domain: string; entityType: string; resolvedAccountId?: string }> {
  // Helper function to get token from ad_account
  const getTokenFromAdAccount = async (adAccountId: string) => {
    const { data: adAccount, error: adError } = await supabase
      .from('ad_accounts')
      .select('id, bitrix24_domain, bitrix24_access_token, bitrix24_refresh_token, bitrix24_token_expires_at, bitrix24_entity_type, bitrix24_client_id, bitrix24_client_secret')
      .eq('id', adAccountId)
      .eq('user_account_id', userAccountId)
      .single();

    if (adError || !adAccount) {
      return null;
    }

    const account = adAccount as UserAccountWithBitrix24;

    if (!account.bitrix24_domain || !account.bitrix24_access_token || !account.bitrix24_refresh_token) {
      return null;
    }

    const domain = account.bitrix24_domain;
    const entityType = account.bitrix24_entity_type || 'deal';
    const expiresAt = account.bitrix24_token_expires_at
      ? new Date(account.bitrix24_token_expires_at)
      : new Date(0);

    const now = new Date();
    const bufferTime = 5 * 60 * 1000;

    if (expiresAt.getTime() > now.getTime() + bufferTime) {
      return {
        accessToken: account.bitrix24_access_token,
        domain,
        entityType,
        resolvedAccountId: adAccountId
      };
    }

    // Token expired - refresh it
    if (!account.bitrix24_client_id || !account.bitrix24_client_secret) {
      throw new Error('Bitrix24 OAuth credentials not configured for ad_account');
    }

    const tokens = await refreshAccessToken(
      domain,
      account.bitrix24_refresh_token,
      account.bitrix24_client_id,
      account.bitrix24_client_secret
    );

    await saveBitrix24TokensToAdAccount(adAccountId, domain, tokens);

    return {
      accessToken: tokens.access_token,
      domain,
      entityType,
      resolvedAccountId: adAccountId
    };
  };

  // If accountId is provided, get credentials from ad_accounts
  if (accountId) {
    const result = await getTokenFromAdAccount(accountId);
    if (result) {
      return result;
    }
    throw new Error('Bitrix24 is not connected for this ad account');
  }

  // Try legacy mode first: get credentials from user_accounts
  const { data: userAccount, error } = await supabase
    .from('user_accounts')
    .select('id, bitrix24_domain, bitrix24_access_token, bitrix24_refresh_token, bitrix24_token_expires_at, bitrix24_entity_type, bitrix24_client_id, bitrix24_client_secret')
    .eq('id', userAccountId)
    .single();

  if (error || !userAccount) {
    throw new Error(`Failed to fetch user account: ${error?.message || 'Not found'}`);
  }

  const account = userAccount as UserAccountWithBitrix24;

  // Check if Bitrix24 is connected in user_accounts (legacy mode)
  if (account.bitrix24_domain && account.bitrix24_access_token && account.bitrix24_refresh_token) {
    const domain = account.bitrix24_domain;
    const entityType = account.bitrix24_entity_type || 'deal';
    const expiresAt = account.bitrix24_token_expires_at
      ? new Date(account.bitrix24_token_expires_at)
      : new Date(0);

    const now = new Date();
    const bufferTime = 5 * 60 * 1000;

    if (expiresAt.getTime() > now.getTime() + bufferTime) {
      return {
        accessToken: account.bitrix24_access_token,
        domain,
        entityType
      };
    }

    // Token expired - refresh it
    if (!account.bitrix24_client_id || !account.bitrix24_client_secret) {
      throw new Error('Bitrix24 OAuth credentials not configured. Please reconnect Bitrix24.');
    }

    try {
      const tokens = await refreshAccessToken(
        domain,
        account.bitrix24_refresh_token,
        account.bitrix24_client_id,
        account.bitrix24_client_secret
      );

      await saveBitrix24Tokens(userAccountId, domain, tokens);

      return {
        accessToken: tokens.access_token,
        domain,
        entityType
      };
    } catch (error: any) {
      throw new Error(`Failed to refresh Bitrix24 token: ${error.message}`);
    }
  }

  // Fallback: no token in user_accounts, try to find in any ad_account for this user
  const { data: adAccounts } = await supabase
    .from('ad_accounts')
    .select('id, bitrix24_domain, bitrix24_access_token')
    .eq('user_account_id', userAccountId)
    .not('bitrix24_access_token', 'is', null);

  if (adAccounts && adAccounts.length > 0) {
    // Try each ad_account until we find a valid one
    for (const aa of adAccounts) {
      try {
        const result = await getTokenFromAdAccount(aa.id);
        if (result) {
          return result;
        }
      } catch {
        // Try next ad_account
        continue;
      }
    }
  }

  throw new Error('Bitrix24 is not connected for this user account or any ad_account');
}

/**
 * Save Bitrix24 tokens to database (user_accounts - legacy mode)
 *
 * @param userAccountId - User account UUID
 * @param domain - Bitrix24 domain
 * @param tokens - Token response from Bitrix24
 */
export async function saveBitrix24Tokens(
  userAccountId: string,
  domain: string,
  tokens: Bitrix24TokenResponse
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  const updateData: any = {
    bitrix24_domain: domain,
    bitrix24_access_token: tokens.access_token,
    bitrix24_refresh_token: tokens.refresh_token,
    bitrix24_token_expires_at: expiresAt.toISOString(),
    bitrix24_member_id: tokens.member_id,
    bitrix24_user_id: tokens.user_id,
    bitrix24_connected_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('user_accounts')
    .update(updateData)
    .eq('id', userAccountId);

  if (error) {
    throw new Error(`Failed to save Bitrix24 tokens: ${error.message}`);
  }
}

/**
 * Save Bitrix24 tokens to ad_accounts (multi-account mode)
 *
 * @param accountId - Ad account UUID
 * @param domain - Bitrix24 domain
 * @param tokens - Token response from Bitrix24
 */
export async function saveBitrix24TokensToAdAccount(
  accountId: string,
  domain: string,
  tokens: Bitrix24TokenResponse
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  const updateData: any = {
    bitrix24_domain: domain,
    bitrix24_access_token: tokens.access_token,
    bitrix24_refresh_token: tokens.refresh_token,
    bitrix24_token_expires_at: expiresAt.toISOString(),
    bitrix24_member_id: tokens.member_id,
    bitrix24_user_id: tokens.user_id,
    bitrix24_connected_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('ad_accounts')
    .update(updateData)
    .eq('id', accountId);

  if (error) {
    throw new Error(`Failed to save Bitrix24 tokens to ad_accounts: ${error.message}`);
  }
}

/**
 * Set entity type preference for Bitrix24 integration
 *
 * @param userAccountId - User account UUID
 * @param entityType - 'lead', 'deal', or 'both'
 */
export async function setBitrix24EntityType(
  userAccountId: string,
  entityType: 'lead' | 'deal' | 'both'
): Promise<void> {
  const { error } = await supabase
    .from('user_accounts')
    .update({ bitrix24_entity_type: entityType })
    .eq('id', userAccountId);

  if (error) {
    throw new Error(`Failed to set Bitrix24 entity type: ${error.message}`);
  }
}

/**
 * Disconnect Bitrix24 from user account
 *
 * @param userAccountId - User account UUID
 */
export async function disconnectBitrix24(userAccountId: string): Promise<void> {
  const { error } = await supabase
    .from('user_accounts')
    .update({
      bitrix24_domain: null,
      bitrix24_access_token: null,
      bitrix24_refresh_token: null,
      bitrix24_token_expires_at: null,
      bitrix24_member_id: null,
      bitrix24_user_id: null,
      bitrix24_entity_type: null,
      bitrix24_qualification_fields: null,
      bitrix24_connected_at: null
    })
    .eq('id', userAccountId);

  if (error) {
    throw new Error(`Failed to disconnect Bitrix24: ${error.message}`);
  }

  // Also delete pipeline stages for this user
  await supabase
    .from('bitrix24_pipeline_stages')
    .delete()
    .eq('user_account_id', userAccountId);
}

/**
 * Check if user has Bitrix24 connected
 *
 * @param userAccountId - User account UUID
 * @returns True if Bitrix24 is connected
 */
export async function isBitrix24Connected(userAccountId: string): Promise<boolean> {
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('bitrix24_domain, bitrix24_access_token, bitrix24_refresh_token')
    .eq('id', userAccountId)
    .single();

  if (!userAccount) {
    return false;
  }

  const account = userAccount as UserAccountWithBitrix24;

  return !!(
    account.bitrix24_domain &&
    account.bitrix24_access_token &&
    account.bitrix24_refresh_token
  );
}

/**
 * Get Bitrix24 connection status for user
 *
 * @param userAccountId - User account UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Connection status object
 */
export async function getBitrix24Status(userAccountId: string, accountId?: string | null): Promise<{
  connected: boolean;
  domain?: string;
  memberId?: string;
  entityType?: string;
  tokenExpiresAt?: string;
  connectedAt?: string;
}> {
  // First check if multi-account mode is enabled
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('id, multi_account_enabled, bitrix24_domain, bitrix24_access_token, bitrix24_refresh_token, bitrix24_token_expires_at, bitrix24_member_id, bitrix24_user_id, bitrix24_entity_type, bitrix24_qualification_fields, bitrix24_connected_at')
    .eq('id', userAccountId)
    .single();

  if (!userAccount) {
    return { connected: false };
  }

  // If accountId is provided, check ad_accounts; otherwise check user_accounts
  if (accountId) {
    // Check ad_accounts
    const { data: adAccount } = await supabase
      .from('ad_accounts')
      .select('bitrix24_domain, bitrix24_access_token, bitrix24_refresh_token, bitrix24_token_expires_at, bitrix24_member_id, bitrix24_entity_type, bitrix24_connected_at')
      .eq('id', accountId)
      .eq('user_account_id', userAccountId)
      .single();

    if (!adAccount) {
      return { connected: false };
    }

    const connected = !!(
      adAccount.bitrix24_domain &&
      adAccount.bitrix24_access_token &&
      adAccount.bitrix24_refresh_token
    );

    return {
      connected,
      domain: adAccount.bitrix24_domain || undefined,
      memberId: adAccount.bitrix24_member_id || undefined,
      entityType: adAccount.bitrix24_entity_type || undefined,
      tokenExpiresAt: adAccount.bitrix24_token_expires_at || undefined,
      connectedAt: adAccount.bitrix24_connected_at || undefined
    };
  }

  // Legacy mode: check user_accounts
  const account = userAccount as UserAccountWithBitrix24;

  const connected = !!(
    account.bitrix24_domain &&
    account.bitrix24_access_token &&
    account.bitrix24_refresh_token
  );

  return {
    connected,
    domain: account.bitrix24_domain || undefined,
    memberId: account.bitrix24_member_id || undefined,
    entityType: account.bitrix24_entity_type || undefined,
    tokenExpiresAt: account.bitrix24_token_expires_at || undefined,
    connectedAt: (account as any).bitrix24_connected_at || undefined
  };
}

/**
 * Get Bitrix24 qualification fields for user
 *
 * @param userAccountId - User account UUID
 * @returns Array of qualification field configs
 */
export async function getBitrix24QualificationFields(
  userAccountId: string
): Promise<any[]> {
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('bitrix24_qualification_fields')
    .eq('id', userAccountId)
    .single();

  if (!userAccount) {
    return [];
  }

  return (userAccount as any).bitrix24_qualification_fields || [];
}

/**
 * Set Bitrix24 qualification fields for user
 *
 * @param userAccountId - User account UUID
 * @param fields - Array of qualification field configs (max 3)
 */
export async function setBitrix24QualificationFields(
  userAccountId: string,
  fields: any[]
): Promise<void> {
  if (fields.length > 3) {
    throw new Error('Maximum 3 qualification fields allowed');
  }

  const { error } = await supabase
    .from('user_accounts')
    .update({ bitrix24_qualification_fields: fields })
    .eq('id', userAccountId);

  if (error) {
    throw new Error(`Failed to set qualification fields: ${error.message}`);
  }
}

/**
 * Get Bitrix24 OAuth credentials from database
 * Returns credentials from ad_accounts (multi-account) or user_accounts (legacy)
 *
 * @param userAccountId - User account UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Credentials object or null if not configured
 */
export async function getBitrix24Credentials(
  userAccountId: string,
  accountId?: string | null
): Promise<Bitrix24Credentials | null> {
  // First check if multi-account mode is enabled
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('multi_account_enabled, bitrix24_client_id, bitrix24_client_secret')
    .eq('id', userAccountId)
    .single();

  if (!userAccount) {
    return null;
  }

  // If accountId is provided, read from ad_accounts; otherwise read from user_accounts
  if (accountId) {
    // Read from ad_accounts
    const { data: adAccount } = await supabase
      .from('ad_accounts')
      .select('bitrix24_client_id, bitrix24_client_secret')
      .eq('id', accountId)
      .eq('user_account_id', userAccountId)
      .single();

    if (adAccount?.bitrix24_client_id && adAccount?.bitrix24_client_secret) {
      return {
        clientId: adAccount.bitrix24_client_id,
        clientSecret: adAccount.bitrix24_client_secret
      };
    }
    return null;
  }

  // Legacy mode: read from user_accounts
  if (userAccount.bitrix24_client_id && userAccount.bitrix24_client_secret) {
    return {
      clientId: userAccount.bitrix24_client_id,
      clientSecret: userAccount.bitrix24_client_secret
    };
  }

  return null;
}

/**
 * Save Bitrix24 OAuth credentials to database
 *
 * @param userAccountId - User account UUID
 * @param credentials - OAuth credentials (clientId, clientSecret)
 * @param accountId - Optional ad_account UUID for multi-account mode
 */
export async function saveBitrix24Credentials(
  userAccountId: string,
  credentials: Bitrix24Credentials,
  accountId?: string | null
): Promise<void> {
  // If accountId is provided, save to ad_accounts; otherwise save to user_accounts
  if (accountId) {
    // Save to ad_accounts
    const { error } = await supabase
      .from('ad_accounts')
      .update({
        bitrix24_client_id: credentials.clientId,
        bitrix24_client_secret: credentials.clientSecret
      })
      .eq('id', accountId)
      .eq('user_account_id', userAccountId);

    if (error) {
      throw new Error(`Failed to save Bitrix24 credentials to ad_accounts: ${error.message}`);
    }
  } else {
    // Legacy mode: save to user_accounts
    const { error } = await supabase
      .from('user_accounts')
      .update({
        bitrix24_client_id: credentials.clientId,
        bitrix24_client_secret: credentials.clientSecret
      })
      .eq('id', userAccountId);

    if (error) {
      throw new Error(`Failed to save Bitrix24 credentials: ${error.message}`);
    }
  }
}
