import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { supabase } from '../lib/supabase.js';

const { data, error } = await supabase
  .from('capi_events_log')
  .select('dialog_analysis_id, event_name, event_level, event_time, created_at, capi_status')
  .order('created_at', { ascending: false })
  .limit(50);

if (error) { console.error(error); process.exit(1); }

const now = Date.now() / 1000;
console.log('dialog_id        | L | event_name    | event_time (UTC)     | created_at (UTC)     | status | age_days');
console.log('─'.repeat(110));
data?.forEach(r => {
  const eventMs = r.event_time ? Number(r.event_time) : null;
  const eventDate = (eventMs && isFinite(eventMs)) ? new Date(eventMs < 1e12 ? eventMs * 1000 : eventMs).toISOString().slice(0, 19) : String(r.event_time);
  const createdDate = r.created_at ? new Date(r.created_at).toISOString().slice(0, 19) : 'null';
  const ageSec = eventMs ? (eventMs < 1e12 ? now - eventMs : now - eventMs / 1000) : null;
  const ageDays = ageSec ? (ageSec / 86400).toFixed(1) : '?';
  const dialogShort = r.dialog_analysis_id?.slice(0, 8) || 'null';
  console.log(`${dialogShort} | ${r.event_level} | ${r.event_name?.padEnd(13)} | ${eventDate} | ${createdDate} | ${r.capi_status} | ${ageDays}d`);
});
