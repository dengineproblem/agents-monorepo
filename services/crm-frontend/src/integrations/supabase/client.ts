import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://ikywuvtavpnjlrjtalqi.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlreXd1dnRhdnBuamxyanRhbHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUxNDQ3NTMsImV4cCI6MjA2MDcyMDc1M30.YtgUhWBpQaPzvlU_IZxgGqPMocm8q1-2BVJi3KtD8GM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
