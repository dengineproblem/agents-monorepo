import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load .env before accessing process.env
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing Supabase credentials:', {
    url: SUPABASE_URL ? 'present' : 'MISSING',
    key: SUPABASE_SERVICE_ROLE ? 'present' : 'MISSING'
  });
  throw new Error('Supabase credentials not configured');
}

console.log('Chatbot Service - Supabase initialized:', {
  url: SUPABASE_URL,
  key_prefix: SUPABASE_SERVICE_ROLE.substring(0, 20) + '...'
});

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});


