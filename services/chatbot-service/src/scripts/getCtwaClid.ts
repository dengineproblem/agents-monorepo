import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { supabase } from '../lib/supabase.js';

const DIRECTION_ID = 'eb18b168-4b14-4957-91b6-f6b965b2673b';

const { data } = await supabase
  .from('dialog_analysis')
  .select('id, contact_phone, ctwa_clid, created_at')
  .eq('direction_id', DIRECTION_ID)
  .not('ctwa_clid', 'is', null)
  .order('created_at', { ascending: false })
  .limit(5);

data?.forEach(r => {
  console.log(`\ncreated: ${r.created_at?.slice(0, 16)}`);
  console.log(`ctwa_clid (len=${r.ctwa_clid?.length}): ${r.ctwa_clid}`);
  console.log(`phone: ${r.contact_phone}`);
});
