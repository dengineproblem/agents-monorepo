/**
 * Диагностика CAPI — проверяем конфигурацию и формат события
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { supabase } from '../lib/supabase.js';

const DIRECTION_ID = 'eb18b168-4b14-4957-91b6-f6b965b2673b';

async function main() {
  // 1. direction
  const { data: dir } = await supabase
    .from('account_directions')
    .select('id, name, user_account_id, account_id, conversion_channel, objective')
    .eq('id', DIRECTION_ID)
    .single();
  console.log('\n=== Direction ===');
  console.log(JSON.stringify(dir, null, 2));

  // 2. capi_settings
  const { data: capi } = await supabase
    .from('capi_settings')
    .select('pixel_id, capi_access_token, channel, is_active, account_id')
    .eq('user_account_id', dir!.user_account_id)
    .eq('channel', 'whatsapp')
    .eq('is_active', true)
    .maybeSingle();
  console.log('\n=== capi_settings ===');
  console.log({ ...capi, capi_access_token: capi?.capi_access_token?.slice(0, 20) + '...' });

  // 3. page_id из user_accounts
  const { data: user } = await supabase
    .from('user_accounts')
    .select('page_id, multi_account_enabled')
    .eq('id', dir!.user_account_id)
    .single();
  console.log('\n=== user_accounts ===');
  console.log(user);

  // 4. Последний диалог с ctwa_clid
  const { data: dialog } = await supabase
    .from('dialog_analysis')
    .select('id, contact_phone, ctwa_clid, capi_interest_sent, capi_qualified_sent')
    .eq('direction_id', DIRECTION_ID)
    .not('ctwa_clid', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  console.log('\n=== Последний диалог с ctwa_clid ===');
  console.log({ ...dialog, ctwa_clid: dialog?.ctwa_clid?.slice(0, 30) + '...' });

  // 5. Симулируем payload который ушёл бы в Meta
  if (dialog && capi && user) {
    const payload = {
      data: [{
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: `test_${dialog.id}_L1`,
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        user_data: {
          ph: ['<hashed_phone>'],
          page_id: user.page_id,
          ctwa_clid: dialog.ctwa_clid,
        },
        custom_data: { currency: 'KZT', value: 1 },
      }],
    };
    console.log('\n=== Пример payload в Meta ===');
    console.log(JSON.stringify(payload, null, 2));
    console.log('\n=== Ключевые параметры ===');
    console.log(`pixel_id: ${capi.pixel_id}`);
    console.log(`page_id: ${user.page_id}`);
    console.log(`ctwa_clid prefix: ${dialog.ctwa_clid?.slice(0, 15)}...`);
    console.log(`page_id в payload: ${user.page_id ? '✓' : '✗ NULL!'}`);
  }

  // 6. Проверяем события в capi_events_log
  const { data: logs } = await supabase
    .from('capi_events_log')
    .select('event_name, event_level, capi_status, created_at')
    .eq('direction_id', DIRECTION_ID)
    .order('created_at', { ascending: false })
    .limit(10);
  console.log('\n=== Последние события capi_events_log ===');
  logs?.forEach(l => console.log(`  ${l.created_at?.slice(0, 16)} L${l.event_level} ${l.event_name} → ${l.capi_status}`));
}

main().catch(e => { console.error(e); process.exit(1); });
