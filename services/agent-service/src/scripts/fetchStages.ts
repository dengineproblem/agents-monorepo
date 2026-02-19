#!/usr/bin/env tsx
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serviceDir = resolve(__dirname, '../..');

dotenv.config({ path: resolve(serviceDir, '.env.local') });
dotenv.config({ path: resolve(serviceDir, '.env') });

const AD_ACCOUNT_ID = '91454447-2906-4d89-892b-12c817584b0f';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const { supabase } = await import('../lib/supabase.js');
  const { getValidBitrix24Token } = await import('../lib/bitrix24Tokens.js');
  const { bitrix24Request } = await import('../adapters/bitrix24.js');

  const { data: adAccount } = await supabase
    .from('ad_accounts')
    .select('user_account_id')
    .eq('id', AD_ACCOUNT_ID)
    .single();

  const { accessToken: token, domain } = await getValidBitrix24Token(adAccount!.user_account_id, AD_ACCOUNT_ID);

  // Get deals and their category/stage
  const dealIds = [882643, 882949, 882317, 884271, 882301, 882291, 882049, 881975, 881681, 881391, 881365, 881121, 881063, 880951, 880867, 880751, 880653, 883879];

  const allDeals: any[] = [];
  for (const id of dealIds) {
    const deal = await bitrix24Request({ domain, accessToken: token, method: 'crm.deal.get', params: { id } });
    if (deal) {
      allDeals.push({ ID: deal.ID, TITLE: deal.TITLE, STAGE_ID: deal.STAGE_ID, CATEGORY_ID: deal.CATEGORY_ID });
    }
    await sleep(200);
  }

  // Collect unique category IDs
  const catIds = [...new Set(allDeals.map(d => Number(d.CATEGORY_ID)))];
  console.log('Pipelines used:', catIds);

  // Fetch stage names per pipeline
  const stageMap: Record<string, string> = {};
  for (const catId of catIds) {
    const stages = await bitrix24Request<any[]>({ domain, accessToken: token, method: 'crm.dealcategory.stage.list', params: { id: catId } });
    if (stages && Array.isArray(stages)) {
      for (const s of stages) {
        stageMap[s.STATUS_ID] = s.NAME;
      }
    }
    await sleep(200);
  }

  console.log('\nStage names:');
  for (const [k, v] of Object.entries(stageMap)) {
    console.log(`  ${k} → ${v}`);
  }

  console.log('\nDeals with stages:');
  for (const d of allDeals) {
    const stageName = stageMap[d.STAGE_ID] || '???';
    console.log(`  Deal ${d.ID}: ${String(d.TITLE).substring(0, 40).padEnd(40)} | stage=${d.STAGE_ID} (${stageName}) | pipeline=${d.CATEGORY_ID}`);
  }
}

main().catch(console.error);
