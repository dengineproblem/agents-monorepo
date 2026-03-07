import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { supabase } from '../lib/supabase.js';

// Берём последнее событие с ctwa_clid
const { data } = await supabase
  .from('capi_events_log')
  .select('dialog_analysis_id, event_name, created_at, request_payload, ctwa_clid, pixel_id')
  .not('ctwa_clid', 'is', null)
  .order('created_at', { ascending: false })
  .limit(3);

data?.forEach(r => {
  const payload = r.request_payload as Record<string, unknown> | null;
  const eventData = (payload?.data as Record<string, unknown>[])?.[0] ?? {};
  const userData = eventData.user_data as Record<string, unknown> ?? {};

  console.log(`\n=== ${r.created_at?.slice(0, 16)} | pixel: ${r.pixel_id} ===`);
  console.log('event_name (actual):', eventData.event_name);
  console.log('action_source:', eventData.action_source);
  console.log('messaging_channel:', eventData.messaging_channel);
  console.log('user_data:');
  console.log('  page_id:', userData.page_id ?? 'MISSING!');
  console.log('  ctwa_clid (prefix):', (userData.ctwa_clid as string)?.slice(0, 20) ?? 'MISSING!');
  console.log('  has ph:', Array.isArray(userData.ph) && userData.ph.length > 0);
  console.log('  has country:', !!userData.country);
  console.log('custom_data:', eventData.custom_data);
});
