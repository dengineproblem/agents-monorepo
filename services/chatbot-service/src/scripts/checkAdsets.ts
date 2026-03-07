/**
 * Проверяем promoted_object активных адсетов для CTWA направления
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { supabase } from '../lib/supabase.js';

const DIRECTION_ID = 'eb18b168-4b14-4957-91b6-f6b965b2673b';

// 1. Получаем direction и access_token
const { data: dir } = await supabase
  .from('account_directions')
  .select('id, name, user_account_id, account_id')
  .eq('id', DIRECTION_ID)
  .single();

const { data: userAccount } = await supabase
  .from('user_accounts')
  .select('access_token, page_id, multi_account_enabled')
  .eq('id', dir!.user_account_id)
  .single();

// 2. Получаем fb_adset_id из dialog_analysis (последние записи с adset_id)
const { data: dialogs } = await supabase
  .from('dialog_analysis')
  .select('fb_adset_id, fb_campaign_id, created_at')
  .eq('direction_id', DIRECTION_ID)
  .not('fb_adset_id', 'is', null)
  .order('created_at', { ascending: false })
  .limit(5);

console.log('Последние fb_adset_id из диалогов:');
const adsetIds = [...new Set(dialogs?.map(d => d.fb_adset_id).filter(Boolean))];
adsetIds.forEach(id => console.log(' -', id));

// 3. Запрашиваем promoted_object через Graph API
const token = userAccount!.access_token;
console.log('\npage_id из БД:', userAccount?.page_id);

for (const adsetId of adsetIds.slice(0, 5)) {
  const url = `https://graph.facebook.com/v20.0/${adsetId}?fields=id,name,status,promoted_object,destination_type,optimization_goal&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json() as Record<string, unknown>;
  console.log(`\nAdset ${adsetId}:`);
  if (data.error) {
    console.log('  Ошибка:', (data.error as Record<string, unknown>).message);
  } else {
    console.log('  name:', data.name);
    console.log('  status:', data.status);
    console.log('  destination_type:', data.destination_type);
    console.log('  optimization_goal:', data.optimization_goal);
    console.log('  promoted_object:', JSON.stringify(data.promoted_object, null, 2));
  }
}
