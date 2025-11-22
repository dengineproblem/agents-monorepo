/**
 * AmoCRM Temporary Credentials Management
 * 
 * For auto-created integrations via AmoCRM button.
 * Stores client_id and client_secret temporarily until OAuth flow completes.
 */

import { supabase } from './supabase.js';

interface TempCredentials {
  state: string;
  client_id: string;
  client_secret: string;
  user_account_id?: string;
  integration_name?: string;
  scopes?: string;
}

interface StoredCredentials {
  client_id: string;
  client_secret: string;
  user_account_id?: string;
  integration_name?: string;
  scopes?: string;
}

/**
 * Save temporary OAuth credentials
 * Credentials expire in 10 minutes
 */
export async function saveTempCredentials(credentials: TempCredentials): Promise<void> {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

  const { error } = await supabase
    .from('amocrm_oauth_temp_credentials')
    .insert({
      state: credentials.state,
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      user_account_id: credentials.user_account_id || null,
      integration_name: credentials.integration_name || null,
      scopes: credentials.scopes || null,
      expires_at: expiresAt.toISOString()
    });

  if (error) {
    throw new Error(`Failed to save temp credentials: ${error.message}`);
  }
}

/**
 * Retrieve temporary OAuth credentials by state
 * Returns null if not found or expired
 */
export async function getTempCredentials(state: string): Promise<StoredCredentials | null> {
  const { data, error } = await supabase
    .from('amocrm_oauth_temp_credentials')
    .select('client_id, client_secret, user_account_id, integration_name, scopes, expires_at')
    .eq('state', state)
    .single();

  if (error || !data) {
    return null;
  }

  // Check if expired
  const expiresAt = new Date(data.expires_at);
  if (expiresAt < new Date()) {
    // Delete expired entry
    await deleteTempCredentials(state);
    return null;
  }

  return {
    client_id: data.client_id,
    client_secret: data.client_secret,
    user_account_id: data.user_account_id,
    integration_name: data.integration_name,
    scopes: data.scopes
  };
}

/**
 * Delete temporary OAuth credentials after successful OAuth
 */
export async function deleteTempCredentials(state: string): Promise<void> {
  const { error } = await supabase
    .from('amocrm_oauth_temp_credentials')
    .delete()
    .eq('state', state);

  if (error) {
    // Log but don't throw - cleanup failure shouldn't break OAuth flow
    console.error('Failed to delete temp credentials:', error);
  }
}

/**
 * Cleanup all expired credentials
 * Should be called periodically (e.g., via cron)
 */
export async function cleanupExpiredCredentials(): Promise<number> {
  const { data, error } = await supabase
    .rpc('cleanup_expired_amocrm_oauth_credentials');

  if (error) {
    console.error('Failed to cleanup expired credentials:', error);
    return 0;
  }

  return data || 0;
}

/**
 * Extract user_account_id from state if it was encoded there
 * State format: base64(userAccountId|subdomain) or just random UUID
 */
export function extractUserAccountIdFromState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, 'base64').toString('utf-8');
    
    // Check if it contains pipe separator (old format)
    if (decoded.includes('|')) {
      const [userAccountId] = decoded.split('|');
      return userAccountId;
    }
    
    // Otherwise state is just a UUID (new format for auto-creation)
    // User account will be associated later or passed separately
    return null;
  } catch (error) {
    return null;
  }
}







