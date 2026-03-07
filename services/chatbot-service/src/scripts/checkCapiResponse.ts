import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { supabase } from '../lib/supabase.js';

// Последние события с ctwa_clid (business_messaging Purchase)
const { data } = await supabase
  .from('capi_events_log')
  .select('created_at, event_name, event_level, capi_status, capi_response, capi_error, ctwa_clid, request_payload, pixel_id')
  .not('ctwa_clid', 'is', null)
  .order('created_at', { ascending: false })
  .limit(10);

data?.forEach(r => {
  const payload = r.request_payload as Record<string, unknown> | null;
  const eventData = (payload?.data as Record<string, unknown>[])?.[0] ?? {};
  const userData = eventData.user_data as Record<string, unknown> ?? {};
  const resp = r.capi_response as Record<string, unknown> | null;

  console.log(`\n${r.created_at?.slice(0, 16)} | L${r.event_level} | ${r.capi_status}`);
  console.log(`  actual_event: ${eventData.event_name} | action_source: ${eventData.action_source}`);
  console.log(`  ctwa_clid len: ${(r.ctwa_clid as string)?.length} | has page_id: ${!!userData.page_id} | has ph: ${!!userData.ph}`);
  console.log(`  response: ${JSON.stringify(resp)}`);
  if (r.capi_error) console.log(`  ERROR: ${r.capi_error}`);
});
