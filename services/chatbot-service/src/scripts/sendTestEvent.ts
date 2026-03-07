import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { supabase } from '../lib/supabase.js';
import crypto from 'crypto';

const DIRECTION_ID = 'eb18b168-4b14-4957-91b6-f6b965b2673b';
const TEST_EVENT_CODE = 'TEST3141';
const GRAPH_TOKEN = 'EAANh7hHlJ58BQ6U6aHJThoLDtW35CID3on9bSGhrtiqB5wH1tamHIlDripWQly7QNHdYuSdH8JmJzSwcaKrZALj081rdeGyncVoXlvfqDFeInamFloYIdu9rSdie2La6rZAiGFIzLntAb7j76nCZB8xiwcwEZAtfSAo73YFNHZACO2JZCN91vKezbiOzz12afV4nMdoMZAg70tgWDNlaRfFmBbxofjQLFaAuXQZD';

const { data: dir } = await supabase
  .from('account_directions')
  .select('user_account_id')
  .eq('id', DIRECTION_ID)
  .single();

const { data: capi } = await supabase
  .from('capi_settings')
  .select('pixel_id, capi_access_token')
  .eq('user_account_id', dir!.user_account_id)
  .eq('channel', 'whatsapp')
  .eq('is_active', true)
  .maybeSingle();

const { data: user } = await supabase
  .from('user_accounts')
  .select('page_id')
  .eq('id', dir!.user_account_id)
  .single();

// Самый свежий диалог с ctwa_clid
const { data: dialog } = await supabase
  .from('dialog_analysis')
  .select('id, contact_phone, ctwa_clid, created_at')
  .eq('direction_id', DIRECTION_ID)
  .not('ctwa_clid', 'is', null)
  .order('created_at', { ascending: false })
  .limit(1)
  .single();

const eventTime = Math.floor(Date.now() / 1000);
const hashedPhone = crypto.createHash('sha256').update(dialog!.contact_phone.replace(/\D/g, '')).digest('hex');

// Тест 1: наш токен + v24
console.log('\n=== Тест 1: НАШ токен + v24 ===');
const payload1 = {
  data: [{
    event_name: 'Purchase',
    event_time: eventTime,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: {
      ctwa_clid: dialog!.ctwa_clid,
      page_id: user!.page_id,
    },
    custom_data: { currency: 'KZT', value: 1 },
  }],
  test_event_code: TEST_EVENT_CODE,
};

const res1 = await fetch(`https://graph.facebook.com/v24.0/${capi!.pixel_id}/events?access_token=${capi!.capi_access_token}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload1),
});
console.log('Response:', JSON.stringify(await res1.json(), null, 2));

// Тест 2: GRAPH токен + v24
console.log('\n=== Тест 2: GRAPH токен + v24 ===');
const payload2 = {
  data: [{
    event_name: 'Purchase',
    event_time: eventTime,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: {
      ctwa_clid: dialog!.ctwa_clid,
      page_id: user!.page_id,
    },
    custom_data: { currency: 'KZT', value: 1 },
  }],
  test_event_code: TEST_EVENT_CODE,
};

const res2 = await fetch(`https://graph.facebook.com/v24.0/${capi!.pixel_id}/events?access_token=${GRAPH_TOKEN}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload2),
});
console.log('Response:', JSON.stringify(await res2.json(), null, 2));

// Тест 3: GRAPH токен + v24 + НАШ токен v20 для сравнения
console.log('\n=== Тест 3: НАШ токен + v20 (текущий) ===');
const res3 = await fetch(`https://graph.facebook.com/v20.0/${capi!.pixel_id}/events?access_token=${capi!.capi_access_token}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload1),
});
console.log('Response:', JSON.stringify(await res3.json(), null, 2));

console.log('\nDB token prefix:', capi!.capi_access_token.slice(0, 10));
console.log('Graph token prefix:', GRAPH_TOKEN.slice(0, 10));
