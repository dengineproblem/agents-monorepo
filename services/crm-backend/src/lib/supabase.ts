import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { Agent } from 'undici';

// Load environment variables
dotenv.config();

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

// Custom fetch with timeout and keep-alive
const agent = new Agent({
  keepAliveTimeout: 60000, // 60 seconds
  keepAliveMaxTimeout: 600000, // 10 minutes
  connect: {
    timeout: 30000 // 30 seconds connection timeout
  }
});

const fetchWithTimeout = async (url: RequestInfo | URL, options: RequestInit = {}): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      // @ts-ignore - undici agent
      dispatcher: agent
    });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: fetchWithTimeout as unknown as typeof fetch
  }
});

