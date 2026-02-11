import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

export const supabase = createClient(config.supabaseUrl, config.supabaseServiceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});
