/**
 * One-off script: backfill CAPI Qualified events for 11 leads
 * that reached "Записан" stage but CAPI wasn't sent due to
 * current_status_id INTEGER type bug.
 *
 * Usage: npx tsx src/scripts/backfillCapiQualified.ts
 * Run inside agent-service container after migration 215 is applied.
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE!;
const CHATBOT_SERVICE_URL = process.env.CHATBOT_SERVICE_URL || 'http://chatbot-service:8083';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

// 11 leads that reached "Записан" but CAPI was not sent
const LEADS_TO_BACKFILL = [
  { dealId: 878767, name: 'Аслан', pipeline: 'C29', stageId: 'C29:UC_0S7ZMI' },
  { dealId: 878717, name: 'Қайрат Шиликбаев', pipeline: 'C23', stageId: 'C23:FINAL_INVOICE' },
  { dealId: 878655, name: 'Polat Ussenov', pipeline: 'C17', stageId: 'C17:PREPAYMENT_INVOIC' },
  { dealId: 878431, name: 'Дина Серибай', pipeline: 'C19', stageId: 'C19:PREPARATION' },
  { dealId: 878109, name: 'Елена Амарова', pipeline: 'C19', stageId: 'C19:PREPARATION' },
  { dealId: 876455, name: 'Қалымжан', pipeline: 'C23', stageId: 'C23:FINAL_INVOICE' },
  { dealId: 876333, name: 'Olga Fedeneva', pipeline: 'C23', stageId: 'C23:FINAL_INVOICE' },
  { dealId: 875889, name: 'Әсекербаев Сальмен', pipeline: 'C23', stageId: 'C23:FINAL_INVOICE' },
  { dealId: 874285, name: 'Сауле Садриева', pipeline: 'C17', stageId: 'C17:PREPAYMENT_INVOIC' },
  { dealId: 873511, name: 'Асемгүль', pipeline: 'C19', stageId: 'C19:PREPARATION' },
  { dealId: 873223, name: 'Беркіналі Ұрманазиев', pipeline: 'C19', stageId: 'C19:PREPARATION' },
];

const USER_ACCOUNT_ID = '36f011b1-0ae7-4b9d-aaee-c979a295ed11';

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 10) {
    return '+' + digits;
  }
  return null;
}

async function main() {
  console.log(`Backfilling CAPI Qualified events for ${LEADS_TO_BACKFILL.length} leads...\n`);

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const entry of LEADS_TO_BACKFILL) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id, phone, direction_id, chat_id, fbc, fbp')
      .eq('user_account_id', USER_ACCOUNT_ID)
      .eq('bitrix24_deal_id', entry.dealId)
      .single();

    if (!lead) {
      console.log(`❌ ${entry.name} (deal ${entry.dealId}): lead not found in DB`);
      failed++;
      continue;
    }

    const contactPhone = normalizePhone(lead.phone || lead.chat_id);
    if (!contactPhone) {
      console.log(`⚠️  ${entry.name} (deal ${entry.dealId}, lead ${lead.id}): no phone`);
      skipped++;
      continue;
    }

    if (!lead.direction_id) {
      console.log(`⚠️  ${entry.name} (deal ${entry.dealId}, lead ${lead.id}): no direction_id`);
      skipped++;
      continue;
    }

    // Update lead status in DB
    const pipelineId = parseInt(entry.pipeline.replace('C', ''), 10);
    await supabase
      .from('leads')
      .update({
        current_status_id: entry.stageId,
        current_pipeline_id: pipelineId,
        is_qualified: true,
      })
      .eq('id', lead.id);

    // Send CAPI event: interest + qualified (Записан = L2)
    const correlationId = randomUUID();
    try {
      const response = await fetch(`${CHATBOT_SERVICE_URL}/capi/crm-event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': correlationId,
        },
        body: JSON.stringify({
          userAccountId: USER_ACCOUNT_ID,
          directionId: lead.direction_id,
          contactPhone,
          crmType: 'bitrix24',
          levels: { interest: true, qualified: true, scheduled: false },
          fbc: lead.fbc || undefined,
          fbp: lead.fbp || undefined,
        }),
      });

      const data = await response.json().catch(() => null);

      if (response.ok && data?.success !== false) {
        console.log(`✅ ${entry.name} (deal ${entry.dealId}, lead ${lead.id}): CAPI sent → ${contactPhone}, ${entry.pipeline}:${entry.stageId}`);
        success++;
      } else {
        console.log(`❌ ${entry.name} (deal ${entry.dealId}, lead ${lead.id}): CAPI failed — ${JSON.stringify(data)}`);
        failed++;
      }
    } catch (err: any) {
      console.log(`❌ ${entry.name} (deal ${entry.dealId}, lead ${lead.id}): error — ${err.message}`);
      failed++;
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nDone: ${success} sent, ${skipped} skipped, ${failed} failed`);
}

main().catch(console.error);
