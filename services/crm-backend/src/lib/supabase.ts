import { createClient } from '@supabase/supabase-js';

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase credentials:', {
    url: SUPABASE_URL ? 'present' : 'MISSING',
    key: SUPABASE_SERVICE_KEY ? 'present' : 'MISSING'
  });
  throw new Error('Supabase credentials not configured');
}

console.log('Supabase initialized:', {
  url: SUPABASE_URL,
  key_prefix: SUPABASE_SERVICE_KEY.substring(0, 20) + '...'
});

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

