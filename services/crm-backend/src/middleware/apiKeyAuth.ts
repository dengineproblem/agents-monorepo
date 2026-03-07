import { FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { supabase } from '../lib/supabase.js';

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Global onRequest hook: if Authorization: Bearer <key> is present,
 * validates the API key and sets x-user-id + role so that
 * consultantAuthMiddleware works transparently.
 */
export async function apiKeyAuthHook(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return;

  // Skip if x-user-id is already set (normal browser auth)
  if (request.headers['x-user-id']) return;

  const token = authHeader.slice(7);
  const keyHash = hashKey(token);

  const { data: apiKey, error } = await supabase
    .from('crm_api_keys')
    .select('id, user_account_id, role, is_active, expires_at')
    .eq('key_hash', keyHash)
    .maybeSingle();

  if (error || !apiKey) {
    return reply.status(401).send({ error: 'Invalid API key' });
  }

  if (!apiKey.is_active) {
    return reply.status(401).send({ error: 'API key is disabled' });
  }

  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    return reply.status(401).send({ error: 'API key has expired' });
  }

  // Inject user identity so downstream middleware works
  (request.headers as Record<string, string>)['x-user-id'] = apiKey.user_account_id;

  // Update last_used_at (fire and forget)
  supabase
    .from('crm_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKey.id)
    .then();
}
