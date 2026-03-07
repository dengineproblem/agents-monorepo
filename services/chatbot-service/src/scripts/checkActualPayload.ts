import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { supabase } from '../lib/supabase.js';

const { data } = await supabase
  .from('capi_events_log')
  .select('dialog_analysis_id, event_name, created_at, request_payload, ctwa_clid')
  .order('created_at', { ascending: false })
  .limit(15);

console.log('created_at       | logged_event  | actual_sent  | action_source       | has_ctwa_clid | ctwa_prefix');
console.log('─'.repeat(110));

data?.forEach(r => {
  const payload = r.request_payload as Record<string, unknown> | null;
  const eventData = (payload?.data as Record<string, unknown>[])?.[0] ?? {};
  const actualEventName = eventData.event_name as string ?? 'NO_PAYLOAD';
  const actionSource = eventData.action_source as string ?? '?';
  const userData = eventData.user_data as Record<string, unknown> ?? {};
  const ctwaInPayload = userData.ctwa_clid as string | undefined;
  const hasCtwa = r.ctwa_clid ? 'YES' : 'no';
  const hasCtwaPayload = ctwaInPayload ? 'YES' : 'no';

  console.log(
    `${r.created_at?.slice(0, 16)} | ` +
    `${(r.event_name ?? '?').padEnd(13)} | ` +
    `${actualEventName.padEnd(12)} | ` +
    `${actionSource.padEnd(20)} | ` +
    `log:${hasCtwa}/pay:${hasCtwaPayload} | ` +
    `${ctwaInPayload?.slice(0, 15) ?? 'none'}`
  );
});
