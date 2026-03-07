#!/usr/bin/env tsx
/**
 * Lead Stage Analysis Script
 *
 * Берёт телефоны из CSV файла (UTF-16 или UTF-8, tab-separated),
 * ищет лидов в БД, проверяет историю этапов в Bitrix24,
 * выводит статистику: сколько лидов были на этапе "записан" (L2).
 *
 * Usage:
 *   npx tsx src/scripts/leadStageAnalysis.ts <path-to-csv>
 *
 * Example:
 *   npx tsx src/scripts/leadStageAnalysis.ts ~/Downloads/Имплантация-длинная_Leads_2026-02-16_2026-02-17.csv
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serviceDir = resolve(__dirname, '../..');

dotenv.config({ path: resolve(serviceDir, '.env.local') });
dotenv.config({ path: resolve(serviceDir, '.env') });

// Ad account Bas Dent
const AD_ACCOUNT_ID = '91454447-2906-4d89-892b-12c817584b0f';

interface StageHistoryEntry {
  ID: string;
  TYPE_ID: string;
  OWNER_ID: string;
  CREATED_TIME: string;
  STAGE_ID: string;
  CATEGORY_ID: string;
}

interface CapiFieldConfig {
  field_id?: string | number | null;
  field_name?: string | null;
  field_type?: string | null;
  enum_id?: string | number | null;
  enum_value?: string | null;
  entity_type?: string | null;
  pipeline_id?: string | number | null;
  status_id?: string | number | null;
}

function parseCsvFile(filePath: string): { phones: string[]; names: string[] } {
  const raw = readFileSync(filePath);

  // Detect encoding: UTF-16LE BOM = 0xFF 0xFE
  let content: string;
  if (raw[0] === 0xff && raw[1] === 0xfe) {
    content = raw.toString('utf16le');
  } else {
    content = raw.toString('utf8');
  }

  // Remove BOM
  content = content.replace(/^\uFEFF/, '');

  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    throw new Error('CSV file has no data rows');
  }

  const headers = lines[0].split('\t').map((h) => h.trim());
  const phoneIdx = headers.indexOf('phone_number');
  const nameIdx = headers.indexOf('full_name');

  if (phoneIdx === -1) {
    throw new Error(`Column "phone_number" not found in CSV. Headers: ${headers.join(', ')}`);
  }

  const phones: string[] = [];
  const names: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const phone = (cols[phoneIdx] || '').trim().replace(/^p:/, '');
    const name = nameIdx !== -1 ? (cols[nameIdx] || '').trim().replace(/^"|"$/g, '') : '';

    if (phone) {
      phones.push(phone);
      names.push(name);
    }
  }

  return { phones, names };
}

function normalizePhone(rawPhone: string): string {
  const cleaned = rawPhone
    .replace('@s.whatsapp.net', '')
    .replace('@c.us', '')
    .replace('@lid', '')
    .replace(/\D/g, '');

  if (cleaned.length === 11 && cleaned.startsWith('8')) {
    return `7${cleaned.slice(1)}`;
  }
  return cleaned;
}

function normalizeEnumId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function isStageConfig(config: CapiFieldConfig): boolean {
  const fieldType = String(config.field_type || '').trim().toLowerCase();
  return fieldType === 'pipeline_stage' || fieldType === 'stage';
}

function matchesStageTransition(
  stageId: string,
  categoryId: string,
  config: CapiFieldConfig,
): boolean {
  if (!isStageConfig(config)) return false;
  const configStatusId = normalizeEnumId(config.status_id);
  const configPipelineId = normalizeEnumId(config.pipeline_id);
  if (!configStatusId) return false;
  if (normalizeEnumId(stageId) !== configStatusId) return false;
  if (configPipelineId && normalizeEnumId(categoryId) !== configPipelineId) return false;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // Parse CSV from CLI argument
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: npx tsx src/scripts/leadStageAnalysis.ts <path-to-csv>');
    process.exit(1);
  }

  const resolvedPath = resolve(csvPath);
  console.log(`Reading CSV: ${resolvedPath}\n`);

  const { phones: CSV_PHONES, names: CSV_NAMES } = parseCsvFile(resolvedPath);

  if (CSV_PHONES.length === 0) {
    console.error('No phone numbers found in CSV');
    process.exit(1);
  }

  const { supabase } = await import('../lib/supabase.js');
  const { getValidBitrix24Token } = await import('../lib/bitrix24Tokens.js');
  const { bitrix24Request, findByPhone } = await import('../adapters/bitrix24.js');

  // Step 1: Resolve ad_account
  const { data: adAccount } = await supabase
    .from('ad_accounts')
    .select('id, name, user_account_id, bitrix24_domain, bitrix24_entity_type')
    .eq('id', AD_ACCOUNT_ID)
    .single();

  if (!adAccount) {
    console.error('Ad account not found');
    process.exit(1);
  }

  const USER_ACCOUNT_ID = adAccount.user_account_id;
  console.log(`Ad Account: ${adAccount.name} (${AD_ACCOUNT_ID})`);
  console.log(`Bitrix24: ${adAccount.bitrix24_domain}`);
  console.log(`Total CSV phones: ${CSV_PHONES.length}\n`);

  // Step 2: Load CAPI settings for L2 (Schedule) stages
  const { data: capiSettings } = await supabase
    .from('capi_settings')
    .select('*')
    .eq('account_id', AD_ACCOUNT_ID)
    .eq('channel', 'lead_forms')
    .eq('capi_source', 'crm')
    .single();

  // NB: field mapping matches capiBackfill.ts
  const l1Configs: CapiFieldConfig[] = (capiSettings?.capi_interest_fields || []).filter(isStageConfig);
  const l2Configs: CapiFieldConfig[] = (capiSettings?.capi_qualified_fields || []).filter(isStageConfig);
  const l3Configs: CapiFieldConfig[] = (capiSettings?.capi_scheduled_fields || []).filter(isStageConfig);

  console.log(`L1 (Contact) configs: ${l1Configs.length}`);
  console.log(`L2 (Schedule) configs: ${l2Configs.length}`);
  console.log(`L3 (StartTrial) configs: ${l3Configs.length}`);
  l2Configs.forEach((c) => console.log(`  L2: stage=${c.status_id}, pipeline=${c.pipeline_id}`));
  console.log('');

  // Step 3: Get Bitrix24 token
  const { accessToken: token, domain } = await getValidBitrix24Token(USER_ACCOUNT_ID, AD_ACCOUNT_ID);

  // Step 4: Normalize CSV phones and find leads in DB
  const phoneCandidates = CSV_PHONES.flatMap((p) => {
    const norm = normalizePhone(p);
    return [p, norm, `+${norm}`, `${norm}@s.whatsapp.net`];
  });

  // Search leads in DB by phone or chat_id
  const { data: dbLeads } = await supabase
    .from('leads')
    .select('id, chat_id, phone, name, bitrix24_deal_id, leadgen_id')
    .eq('user_account_id', USER_ACCOUNT_ID)
    .or(`phone.in.(${phoneCandidates.map((p) => `"${p}"`).join(',')}),chat_id.in.(${phoneCandidates.map((p) => `"${p}"`).join(',')})`)
    .order('created_at', { ascending: false })
    .limit(500);

  console.log(`--- DB Lookup ---`);
  console.log(`Found ${dbLeads?.length || 0} lead records in DB\n`);

  // Match CSV phones to DB leads
  interface MatchedLead {
    csvIndex: number;
    csvPhone: string;
    csvName: string;
    leadId: number;
    dealId: number | null;
    leadgenId: string | null;
  }

  const matched: MatchedLead[] = [];
  const notFoundInDB: { phone: string; name: string }[] = [];

  for (let i = 0; i < CSV_PHONES.length; i++) {
    const csvPhone = CSV_PHONES[i];
    const norm = normalizePhone(csvPhone);
    const csvName = CSV_NAMES[i] || '';

    const lead = (dbLeads || []).find((l) => {
      const lPhone = normalizePhone(l.phone || '');
      const lChat = normalizePhone(l.chat_id || '');
      return lPhone === norm || lChat === norm;
    });

    if (lead) {
      matched.push({
        csvIndex: i,
        csvPhone,
        csvName,
        leadId: lead.id,
        dealId: lead.bitrix24_deal_id ? Number(lead.bitrix24_deal_id) : null,
        leadgenId: lead.leadgen_id,
      });
    } else {
      notFoundInDB.push({ phone: csvPhone, name: csvName });
    }
  }

  console.log(`Matched in DB: ${matched.length}`);
  console.log(`Not found in DB: ${notFoundInDB.length}`);
  if (notFoundInDB.length > 0) {
    console.log('  Not found:');
    notFoundInDB.forEach((nf) => console.log(`    ${nf.name} (${nf.phone})`));
  }
  console.log('');

  // Step 5: For leads without deal_id, try to sync via Bitrix24
  const needsSync = matched.filter((m) => !m.dealId);
  if (needsSync.length > 0) {
    console.log(`--- Syncing ${needsSync.length} leads with Bitrix24 ---`);
    for (const m of needsSync) {
      const norm = normalizePhone(m.csvPhone);
      try {
        const contactResult = await findByPhone(domain, token, [norm]);
        const contactIds = contactResult?.CONTACT || [];
        if (contactIds.length > 0) {
          const contactId = contactIds[0];
          const dealsResp = await bitrix24Request({ domain, accessToken: token, method: 'crm.deal.list', params: {
            filter: { CONTACT_ID: contactId },
            select: ['ID', 'CATEGORY_ID', 'STAGE_ID'],
            order: { ID: 'DESC' },
          }});
          if (dealsResp?.length > 0) {
            m.dealId = Number(dealsResp[0].ID);
            // Update in DB
            await supabase.from('leads').update({ bitrix24_deal_id: m.dealId }).eq('id', m.leadId);
            console.log(`  Synced lead #${m.leadId} → deal ${m.dealId}`);
          }
        }
        await sleep(200);
      } catch (e: any) {
        console.log(`  Failed to sync ${m.csvName}: ${e.message}`);
      }
    }
    console.log('');
  }

  // Step 6: Fetch deal stage history
  const withDeal = matched.filter((m) => m.dealId);
  const withoutDeal = matched.filter((m) => !m.dealId);

  console.log(`--- Stage History Analysis ---`);
  console.log(`Leads with deals: ${withDeal.length}`);
  console.log(`Leads without deals: ${withoutDeal.length}\n`);

  interface LeadAnalysis {
    csvName: string;
    csvPhone: string;
    leadId: number;
    dealId: number;
    leadgenId: string | null;
    wasL1: boolean;
    wasL2: boolean;
    wasL3: boolean;
    l1Date: string | null;
    l2Date: string | null;
    l3Date: string | null;
    l1Stage: string | null;
    l2Stage: string | null;
    l3Stage: string | null;
    totalTransitions: number;
    currentStage: string | null;
  }

  const results: LeadAnalysis[] = [];

  for (const m of withDeal) {
    try {
      const historyResp = await bitrix24Request({ domain, accessToken: token, method: 'crm.stagehistory.list', params: {
        entityTypeId: 2, // deal
        filter: { OWNER_ID: m.dealId },
        order: { CREATED_TIME: 'ASC' },
      }});

      const items: StageHistoryEntry[] = historyResp?.items || [];
      const analysis: LeadAnalysis = {
        csvName: m.csvName,
        csvPhone: m.csvPhone,
        leadId: m.leadId,
        dealId: m.dealId!,
        leadgenId: m.leadgenId,
        wasL1: false,
        wasL2: false,
        wasL3: false,
        l1Date: null,
        l2Date: null,
        l3Date: null,
        l1Stage: null,
        l2Stage: null,
        l3Stage: null,
        totalTransitions: items.length,
        currentStage: items.length > 0 ? items[items.length - 1].STAGE_ID : null,
      };

      for (const entry of items) {
        // Check L2 (Schedule)
        if (!analysis.wasL2) {
          for (const cfg of l2Configs) {
            if (matchesStageTransition(entry.STAGE_ID, entry.CATEGORY_ID, cfg)) {
              analysis.wasL2 = true;
              analysis.l2Date = entry.CREATED_TIME;
              analysis.l2Stage = entry.STAGE_ID;
              break;
            }
          }
        }
        // Check L1 (Contact)
        if (!analysis.wasL1) {
          for (const cfg of l1Configs) {
            if (matchesStageTransition(entry.STAGE_ID, entry.CATEGORY_ID, cfg)) {
              analysis.wasL1 = true;
              analysis.l1Date = entry.CREATED_TIME;
              analysis.l1Stage = entry.STAGE_ID;
              break;
            }
          }
        }
        // Check L3 (StartTrial)
        if (!analysis.wasL3) {
          for (const cfg of l3Configs) {
            if (matchesStageTransition(entry.STAGE_ID, entry.CATEGORY_ID, cfg)) {
              analysis.wasL3 = true;
              analysis.l3Date = entry.CREATED_TIME;
              analysis.l3Stage = entry.STAGE_ID;
              break;
            }
          }
        }
      }

      results.push(analysis);
      await sleep(150);
    } catch (e: any) {
      console.log(`  Error fetching history for deal ${m.dealId}: ${e.message}`);
    }
  }

  // Step 7: Output statistics
  const totalCSV = CSV_PHONES.length;
  const totalInDB = matched.length;
  const totalWithDeal = withDeal.length;
  const totalL1 = results.filter((r) => r.wasL1).length;
  const totalL2 = results.filter((r) => r.wasL2).length;
  const totalL3 = results.filter((r) => r.wasL3).length;
  const withLeadgenId = results.filter((r) => r.leadgenId).length;

  console.log('======================================================================');
  console.log('СТАТИСТИКА');
  console.log('======================================================================');
  console.log(`Всего лидов в CSV:              ${totalCSV}`);
  console.log(`Найдено в БД:                   ${totalInDB}`);
  console.log(`Привязаны к сделкам Bitrix24:    ${totalWithDeal}`);
  console.log(`Имеют leadgen_id (Meta):         ${withLeadgenId}`);
  console.log('----------------------------------------------------------------------');
  console.log(`Были на L1 (Contact):            ${totalL1} из ${totalWithDeal} (${((totalL1 / totalWithDeal) * 100).toFixed(1)}%)`);
  console.log(`Были на L2 (Schedule/Записан):   ${totalL2} из ${totalWithDeal} (${((totalL2 / totalWithDeal) * 100).toFixed(1)}%)`);
  console.log(`Были на L3 (StartTrial):         ${totalL3} из ${totalWithDeal} (${((totalL3 / totalWithDeal) * 100).toFixed(1)}%)`);
  console.log('======================================================================');

  // Detail: leads that WERE at L2
  if (totalL2 > 0) {
    console.log('\n--- Лиды, которые были на этапе "Записан" (L2) ---');
    results.filter((r) => r.wasL2).forEach((r) => {
      console.log(`  ✓ ${r.csvName.padEnd(35)} | deal ${r.dealId} | ${r.l2Date} | stage=${r.l2Stage} | leadgen=${r.leadgenId || 'нет'}`);
    });
  }

  // Detail: leads that were NOT at L2
  console.log(`\n--- Лиды, которые НЕ были на этапе "Записан" (L2) ---`);
  results.filter((r) => !r.wasL2).forEach((r) => {
    console.log(`  ✗ ${r.csvName.padEnd(35)} | deal ${r.dealId} | current=${r.currentStage} | transitions=${r.totalTransitions}`);
  });

  if (withoutDeal.length > 0) {
    console.log(`\n--- Лиды в БД, но без сделки в Bitrix24 ---`);
    withoutDeal.forEach((m) => {
      console.log(`  ? ${m.csvName.padEnd(35)} | lead #${m.leadId} | ${m.csvPhone}`);
    });
  }

  if (notFoundInDB.length > 0) {
    console.log(`\n--- Лиды из CSV, не найденные в БД ---`);
    notFoundInDB.forEach((nf) => {
      console.log(`  ✗ ${nf.name.padEnd(35)} | ${nf.phone}`);
    });
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
