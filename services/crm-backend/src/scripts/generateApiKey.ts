/**
 * Generate an API key for external agent access to CRM.
 *
 * Usage:
 *   npx tsx src/scripts/generateApiKey.ts <user_account_id> [name]
 *
 * Example:
 *   npx tsx src/scripts/generateApiKey.ts 123e4567-e89b-12d3-a456-426614174000 "My Agent"
 */
import { randomBytes, createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const userAccountId = process.argv[2];
  const name = process.argv[3] || 'API Key';

  if (!userAccountId) {
    console.error('Usage: npx tsx src/scripts/generateApiKey.ts <user_account_id> [name]');
    process.exit(1);
  }

  // Verify user exists
  const { data: user, error: userError } = await supabase
    .from('user_accounts')
    .select('id, username')
    .eq('id', userAccountId)
    .maybeSingle();

  if (userError || !user) {
    console.error('User account not found:', userAccountId);
    process.exit(1);
  }

  // Generate random key
  const rawKey = `crm_${randomBytes(32).toString('hex')}`;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  // Store hashed key
  const { error: insertError } = await supabase
    .from('crm_api_keys')
    .insert({
      key_hash: keyHash,
      name,
      user_account_id: userAccountId,
      role: 'admin',
    });

  if (insertError) {
    console.error('Failed to create API key:', insertError.message);
    process.exit(1);
  }

  console.log('');
  console.log('API key created successfully!');
  console.log(`User: ${user.username} (${user.id})`);
  console.log(`Name: ${name}`);
  console.log('');
  console.log('API Key (save it, it will NOT be shown again):');
  console.log('');
  console.log(`  ${rawKey}`);
  console.log('');
  console.log('Usage:');
  console.log(`  curl -H "Authorization: Bearer ${rawKey}" https://your-domain/api/crm/health`);
  console.log('');
}

main();
