import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
// Поддерживаем оба варианта для совместимости
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials:', {
    url: supabaseUrl ? 'present' : 'MISSING',
    key: supabaseServiceKey ? 'present' : 'MISSING'
  });
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set in environment variables');
}

console.log('Creative Service - Supabase initialized:', {
  url: supabaseUrl,
  key_prefix: supabaseServiceKey.substring(0, 20) + '...'
});

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Вспомогательная функция для логирования ошибок Supabase
export function logSupabaseError(context: string, error: any) {
  console.error(`[Supabase Error - ${context}]:`, {
    message: error?.message || 'Unknown error',
    details: error?.details || 'No details',
    hint: error?.hint || 'No hint',
    code: error?.code || 'No code'
  });
}

