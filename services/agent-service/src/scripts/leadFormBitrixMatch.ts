#!/usr/bin/env tsx
/**
 * Lead Form → Bitrix24 Match Script
 *
 * Вытаскивает лидов напрямую из Facebook Lead Forms API,
 * ищет их в Bitrix24 по телефону, проверяет историю этапов.
 *
 * Usage:
 *   npx tsx src/scripts/leadFormBitrixMatch.ts
 *
 * Конфигурация — константы ниже.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serviceDir = resolve(__dirname, '../..');

dotenv.config({ path: resolve(serviceDir, '.env.local') });
dotenv.config({ path: resolve(serviceDir, '.env') });

// ==================== CONFIG ====================
const AD_ACCOUNT_ID = '91454447-2906-4d89-892b-12c817584b0f'; // Bas Dent internal UUID
const FB_PAGE_ID = '237286886145586';
const FB_API_VERSION = process.env.FB_API_VERSION || 'v20.0';

// Дата-диапазон (UTC+5 Астана)
const DATE_FROM = '2026-02-17';
const DATE_TO = '2026-02-20'; // включительно — до конца дня 20-го

// Названия форм (substring match, case-insensitive)
const TARGET_FORMS = ['имплантация-длинная', 'гнатология-copy'];
// ================================================

interface StageHistoryEntry {
  ID: string;
  TYPE_ID: string;
  OWNER_ID: string;
  CREATED_TIME: string;
  STAGE_ID: string;
  CATEGORY_ID: string;
}


interface FBLead {
  id: string;
  created_time: string;
  field_data: Array<{ name: string; values: string[] }>;
  ad_id?: string;
  form_id?: string;
}

interface FBForm {
  id: string;
  name: string;
  status: string;
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


function extractFieldValue(fieldData: Array<{ name: string; values: string[] }>, fieldNames: string[]): string | null {
  for (const name of fieldNames) {
    const field = fieldData.find(f => f.name.toLowerCase() === name.toLowerCase());
    if (field && field.values && field.values.length > 0) {
      return field.values[0];
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fbGet(path: string, token: string, params: Record<string, string> = {}): Promise<any> {
  const usp = new URLSearchParams({ access_token: token, ...params });
  const url = `https://graph.facebook.com/${FB_API_VERSION}/${path}?${usp.toString()}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    throw new Error(`FB API error: ${JSON.stringify(data.error)}`);
  }
  return data;
}

async function fetchAllPages(path: string, token: string, params: Record<string, string> = {}): Promise<any[]> {
  const all: any[] = [];
  let url: string | null = null;

  // First request
  const usp = new URLSearchParams({ access_token: token, limit: '500', ...params });
  url = `https://graph.facebook.com/${FB_API_VERSION}/${path}?${usp.toString()}`;

  while (url) {
    const res: Response = await fetch(url);
    const data: any = await res.json();
    if (data.error) {
      throw new Error(`FB API error: ${JSON.stringify(data.error)}`);
    }
    if (data.data) {
      all.push(...data.data);
    }
    url = data.paging?.next || null;
    if (url) await sleep(200);
  }

  return all;
}

async function main() {
  const { supabase } = await import('../lib/supabase.js');
  const { getValidBitrix24Token } = await import('../lib/bitrix24Tokens.js');
  const { bitrix24Request, findByPhone } = await import('../adapters/bitrix24.js');

  // Step 1: Get FB access token from ad_accounts
  const { data: adAccount } = await supabase
    .from('ad_accounts')
    .select('id, name, user_account_id, access_token, ad_account_id, bitrix24_domain')
    .eq('id', AD_ACCOUNT_ID)
    .single();

  if (!adAccount?.access_token) {
    console.error('Ad account not found or no access_token');
    process.exit(1);
  }

  const fbToken = adAccount.access_token;
  const USER_ACCOUNT_ID = adAccount.user_account_id;

  console.log(`Ad Account: ${adAccount.name}`);
  console.log(`FB Account: ${adAccount.ad_account_id}`);
  console.log(`Период: ${DATE_FROM} — ${DATE_TO}`);
  console.log(`Формы: ${TARGET_FORMS.join(', ')}\n`);

  // Step 2: Get page access token for lead retrieval
  let pageToken = fbToken; // try user token first
  try {
    const pageData = await fbGet(`${FB_PAGE_ID}`, fbToken, { fields: 'access_token' });
    if (pageData.access_token) {
      pageToken = pageData.access_token;
      console.log('Получен Page Access Token\n');
    }
  } catch (e: any) {
    console.log(`Не удалось получить Page Token, используем User Token: ${e.message}\n`);
  }

  // Step 3: List all lead forms for the page
  console.log('--- Загружаю лидформы ---');
  const forms: FBForm[] = await fetchAllPages(`${FB_PAGE_ID}/leadgen_forms`, pageToken, {
    fields: 'id,name,status',
  });

  console.log(`Всего форм: ${forms.length}`);
  forms.forEach(f => console.log(`  ${f.name} (${f.id}) [${f.status}]`));
  console.log('');

  // Step 4: Filter target forms
  const targetForms = forms.filter(f =>
    TARGET_FORMS.some(t => f.name.toLowerCase().includes(t.toLowerCase()))
  );

  if (targetForms.length === 0) {
    console.error('Целевые формы не найдены!');
    console.log('Доступные формы:', forms.map(f => f.name).join(', '));
    process.exit(1);
  }

  console.log(`Целевые формы: ${targetForms.map(f => `${f.name} (${f.id})`).join(', ')}\n`);

  // Step 5: Fetch leads from each form with date filter
  // Convert dates to timestamps (UTC+5 → UTC)
  const fromTs = Math.floor(new Date(`${DATE_FROM}T00:00:00+05:00`).getTime() / 1000);
  const toTs = Math.floor(new Date(`${DATE_TO}T23:59:59+05:00`).getTime() / 1000);

  interface FormLead {
    formName: string;
    formId: string;
    leadgenId: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    createdTime: string;
    adId: string | null;
  }

  const allLeads: FormLead[] = [];

  for (const form of targetForms) {
    console.log(`--- Загружаю лидов: ${form.name} ---`);

    const leads: FBLead[] = await fetchAllPages(`${form.id}/leads`, pageToken, {
      fields: 'id,created_time,field_data,ad_id',
      filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: fromTs }]),
    });

    // Filter by end date (API only supports GREATER_THAN)
    const filtered = leads.filter(l => {
      const ts = Math.floor(new Date(l.created_time).getTime() / 1000);
      return ts <= toTs;
    });

    console.log(`  Получено: ${leads.length}, после фильтра дат: ${filtered.length}`);

    for (const lead of filtered) {
      const name = extractFieldValue(lead.field_data, ['full_name', 'name', 'first_name', 'имя', 'фио']);
      const phone = extractFieldValue(lead.field_data, ['phone_number', 'phone', 'телефон', 'номер_телефона']);
      const email = extractFieldValue(lead.field_data, ['email', 'email_address', 'почта']);

      allLeads.push({
        formName: form.name,
        formId: form.id,
        leadgenId: lead.id,
        name,
        phone,
        email,
        createdTime: lead.created_time,
        adId: lead.ad_id || null,
      });
    }
  }

  console.log(`\nВсего лидов из FB: ${allLeads.length}\n`);

  if (allLeads.length === 0) {
    console.log('Нет лидов за указанный период');
    process.exit(0);
  }

  // Вывести список лидов из FB
  console.log('--- Лиды из Facebook ---');
  allLeads.forEach((l, i) => {
    console.log(`  ${i + 1}. ${(l.name || '—').padEnd(30)} | ${(l.phone || '—').padEnd(15)} | ${l.formName} | ${l.createdTime}`);
  });
  console.log('');

  // Step 6: Load ALL pipeline stages from Bitrix24, find "запись" by name
  const { accessToken: b24Token, domain } = await getValidBitrix24Token(USER_ACCOUNT_ID, AD_ACCOUNT_ID);
  console.log(`Bitrix24: ${domain}\n`);

  // Get all deal categories (pipelines)
  const categories = await bitrix24Request({
    domain, accessToken: b24Token, method: 'crm.dealcategory.list', params: {
      select: ['ID', 'NAME'],
    },
  });

  // Get stages for default pipeline (0) + all custom pipelines
  const categoryIds = [0, ...(categories || []).map((c: any) => Number(c.ID))];
  const allStages: Array<{ statusId: string; categoryId: number; name: string }> = [];

  // Default pipeline stages
  const defaultStages = await bitrix24Request({
    domain, accessToken: b24Token, method: 'crm.status.list', params: {
      filter: { ENTITY_ID: 'DEAL_STAGE' },
    },
  });
  for (const s of (defaultStages || [])) {
    allStages.push({ statusId: s.STATUS_ID, categoryId: 0, name: s.NAME });
  }

  // Custom pipeline stages
  for (const catId of categoryIds.filter(id => id > 0)) {
    try {
      const stages = await bitrix24Request({
        domain, accessToken: b24Token, method: 'crm.dealcategory.stage.list', params: { id: catId },
      });
      for (const s of (stages || [])) {
        allStages.push({ statusId: s.STATUS_ID, categoryId: catId, name: s.NAME });
      }
      await sleep(100);
    } catch (e: any) {
      console.log(`  Ошибка загрузки этапов воронки ${catId}: ${e.message}`);
    }
  }

  // Find "запись" stages by name across all pipelines
  const RECORD_KEYWORDS = ['запис', 'записан', 'запись'];
  const recordStageIds = new Set<string>();

  console.log('--- Все этапы с "запись" в названии ---');
  for (const stage of allStages) {
    const nameLower = stage.name.toLowerCase();
    if (RECORD_KEYWORDS.some(kw => nameLower.includes(kw))) {
      recordStageIds.add(stage.statusId);
      console.log(`  ✓ ${stage.name} (${stage.statusId}) — воронка ${stage.categoryId}`);
    }
  }
  console.log(`Всего этапов "запись": ${recordStageIds.size}\n`);

  // Step 8: For each lead, find in Bitrix24 by phone → get deal → check stage history
  interface LeadResult {
    formName: string;
    name: string;
    phone: string;
    createdTime: string;
    // Bitrix24 match
    contactId: number | null;
    dealId: number | null;
    dealStage: string | null;
    dealCategory: string | null;
    // Stage analysis
    wasL2: boolean;
    l2Date: string | null;
    l2Stage: string | null;
    l2StageName: string | null;
    totalTransitions: number;
    currentStage: string | null;
    currentStageName: string | null;
  }

  const results: LeadResult[] = [];
  const noPhone: FormLead[] = [];
  const notFoundInB24: FormLead[] = [];

  for (const lead of allLeads) {
    if (!lead.phone) {
      noPhone.push(lead);
      continue;
    }

    const norm = normalizePhone(lead.phone);
    if (!norm) {
      noPhone.push(lead);
      continue;
    }

    try {
      // Find contact in Bitrix24
      const contactResult = await findByPhone(domain, b24Token, [norm]);
      const contactIds = contactResult?.CONTACT || [];

      if (contactIds.length === 0) {
        notFoundInB24.push(lead);
        await sleep(200);
        continue;
      }

      const contactId = contactIds[0];

      // Find deals for contact
      const dealsResp = await bitrix24Request({
        domain, accessToken: b24Token, method: 'crm.deal.list', params: {
          filter: { CONTACT_ID: contactId },
          select: ['ID', 'CATEGORY_ID', 'STAGE_ID', 'TITLE'],
          order: { ID: 'DESC' },
        },
      });

      if (!dealsResp?.length) {
        notFoundInB24.push(lead);
        await sleep(200);
        continue;
      }

      const deal = dealsResp[0];
      const dealId = Number(deal.ID);

      // Fetch stage history
      const historyResp = await bitrix24Request({
        domain, accessToken: b24Token, method: 'crm.stagehistory.list', params: {
          entityTypeId: 2,
          filter: { OWNER_ID: dealId },
          order: { CREATED_TIME: 'ASC' },
        },
      });

      const items: StageHistoryEntry[] = historyResp?.items || [];

      const curStageId = items.length > 0 ? items[items.length - 1].STAGE_ID : deal.STAGE_ID;
      const curStageMeta = allStages.find(s => s.statusId === curStageId);

      const result: LeadResult = {
        formName: lead.formName,
        name: lead.name || '—',
        phone: lead.phone,
        createdTime: lead.createdTime,
        contactId,
        dealId,
        dealStage: deal.STAGE_ID,
        dealCategory: deal.CATEGORY_ID,
        wasL2: false,
        l2Date: null,
        l2Stage: null,
        l2StageName: null,
        totalTransitions: items.length,
        currentStage: curStageId,
        currentStageName: curStageMeta?.name || curStageId,
      };

      // Check full history: was the lead EVER on a "запись" stage?
      for (const entry of items) {
        if (!result.wasL2 && recordStageIds.has(entry.STAGE_ID)) {
          result.wasL2 = true;
          result.l2Date = entry.CREATED_TIME;
          result.l2Stage = entry.STAGE_ID;
          const stageMeta = allStages.find(s => s.statusId === entry.STAGE_ID);
          result.l2StageName = stageMeta?.name || entry.STAGE_ID;
        }
      }

      // Also check current deal stage (in case stagehistory is incomplete)
      if (!result.wasL2 && recordStageIds.has(deal.STAGE_ID)) {
        result.wasL2 = true;
        result.l2Stage = deal.STAGE_ID;
        const stageMeta = allStages.find(s => s.statusId === deal.STAGE_ID);
        result.l2StageName = stageMeta?.name || deal.STAGE_ID;
      }

      results.push(result);
      await sleep(200);
    } catch (e: any) {
      console.log(`  Ошибка для ${lead.name} (${lead.phone}): ${e.message}`);
      notFoundInB24.push(lead);
      await sleep(300);
    }
  }

  // Step 9: Statistics per form
  const formNames = [...new Set(allLeads.map(l => l.formName))];

  console.log('======================================================================');
  console.log('СТАТИСТИКА');
  console.log('======================================================================');

  for (const formName of formNames) {
    const formLeads = allLeads.filter(l => l.formName === formName);
    const formResults = results.filter(r => r.formName === formName);
    const formL2 = formResults.filter(r => r.wasL2);
    const formNotFound = notFoundInB24.filter(l => l.formName === formName);

    const pctFound = formLeads.length ? ((formResults.length / formLeads.length) * 100).toFixed(1) : '0';
    const pctL2 = formResults.length ? ((formL2.length / formResults.length) * 100).toFixed(1) : '0';
    const pctL2ofAll = formLeads.length ? ((formL2.length / formLeads.length) * 100).toFixed(1) : '0';

    console.log(`\n--- ${formName} ---`);
    console.log(`  Лидов из FB:                ${formLeads.length}`);
    console.log(`  Найдено в Битрикс24:        ${formResults.length} (${pctFound}%)`);
    console.log(`  Не найдено в Битрикс24:     ${formNotFound.length}`);
    console.log(`  Были на этапе "Запись":      ${formL2.length} из ${formResults.length} (${pctL2}%) | от всех лидов: ${pctL2ofAll}%`);
  }

  // Total
  const totalFB = allLeads.length;
  const totalMatched = results.length;
  const totalL2 = results.filter(r => r.wasL2).length;
  const totalNotFound = notFoundInB24.length;

  console.log('\n----------------------------------------------------------------------');
  console.log('ИТОГО (все формы)');
  console.log('----------------------------------------------------------------------');
  console.log(`  Лидов из FB:                ${totalFB}`);
  console.log(`  Найдено в Битрикс24:        ${totalMatched} (${totalFB ? ((totalMatched / totalFB) * 100).toFixed(1) : 0}%)`);
  console.log(`  Не найдено в Битрикс24:     ${totalNotFound}`);
  console.log(`  Без телефона:               ${noPhone.length}`);
  console.log(`  Были на "Запись":            ${totalL2} из ${totalMatched} (${totalMatched ? ((totalL2 / totalMatched) * 100).toFixed(1) : 0}%)`);
  console.log(`  Конверсия FB→Запись:         ${totalL2} из ${totalFB} (${totalFB ? ((totalL2 / totalFB) * 100).toFixed(1) : 0}%)`);
  console.log('======================================================================');

  // Detail: leads who were at "Запись"
  if (totalL2 > 0) {
    console.log('\n--- Лиды, побывавшие на этапе "Запись" ---');
    results.filter(r => r.wasL2).forEach(r => {
      console.log(`  ✓ ${r.name.padEnd(30)} | ${r.phone.padEnd(15)} | deal ${r.dealId} | ${r.l2StageName} | ${r.l2Date || ''} | сейчас: ${r.currentStageName} | ${r.formName}`);
    });
  }

  // Detail: leads matched in B24 but NOT at "Запись"
  const notL2 = results.filter(r => !r.wasL2);
  if (notL2.length > 0) {
    console.log(`\n--- В Битрикс24, но НЕ были на "Запись" ---`);
    notL2.forEach(r => {
      console.log(`  ✗ ${r.name.padEnd(30)} | ${r.phone.padEnd(15)} | deal ${r.dealId} | сейчас: ${r.currentStageName} | ${r.formName}`);
    });
  }

  // Detail: not found in B24
  if (notFoundInB24.length > 0) {
    console.log(`\n--- Не найдены в Битрикс24 ---`);
    notFoundInB24.forEach(l => {
      console.log(`  ? ${(l.name || '—').padEnd(30)} | ${(l.phone || '—').padEnd(15)} | ${l.formName} | ${l.createdTime}`);
    });
  }

  if (noPhone.length > 0) {
    console.log(`\n--- Без телефона ---`);
    noPhone.forEach(l => {
      console.log(`  ! ${(l.name || '—').padEnd(30)} | ${l.formName} | ${l.createdTime}`);
    });
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
