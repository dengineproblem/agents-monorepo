#!/usr/bin/env tsx
/**
 * CAPI Backfill Script
 *
 * Одноразовый скрипт для отправки исторических событий в Meta Conversions API.
 *
 * Логика:
 * 1. Находит ad_account с подключённым Bitrix24
 * 2. Загружает CAPI настройки (lead_forms канал, crm source)
 * 3. Берёт лидов из БД, синхронизирует с Битриксом по телефону
 * 4. Запрашивает историю стадий сделок через crm.stagehistory.list
 * 5. Матчит переходы на L1/L2/L3 стадии
 * 6. Отправляет события в Meta CAPI с event_time = дата реального перехода
 *
 * Запуск:
 *   cd services/agent-service
 *   npx tsx src/scripts/capiBackfill.ts <userAccountId> [--dry-run] [--days=7]
 */

import dotenv from 'dotenv';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serviceDir = resolve(__dirname, '../..');

dotenv.config({ path: resolve(serviceDir, '.env.local') });
dotenv.config({ path: resolve(serviceDir, '.env') });

// ============================================================================
// Config
// ============================================================================

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const AD_ACCOUNT_ID = positional[0];
const DRY_RUN = args.includes('--dry-run');
const DAYS_BACK = parseInt(args.find((a) => a.startsWith('--days='))?.split('=')[1] || '7', 10);

if (!AD_ACCOUNT_ID) {
  console.error('Usage: npx tsx src/scripts/capiBackfill.ts <adAccountId> [--dry-run] [--days=7]');
  process.exit(1);
}

const CAPI_BASE_URL = process.env.META_CAPI_URL || 'https://graph.facebook.com/v20.0';

// CRM dataset event names (same as metaCapiClient.ts)
const CRM_LEVEL_EVENTS: Record<number, string> = {
  1: 'Contact',
  2: 'Schedule',
  3: 'StartTrial',
};

// ============================================================================
// Types
// ============================================================================

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

interface CapiSettings {
  id: string;
  account_id: string | null;
  channel: string;
  pixel_id: string;
  capi_access_token: string | null;
  capi_source: string;
  capi_crm_type: string | null;
  capi_interest_fields: CapiFieldConfig[];
  capi_qualified_fields: CapiFieldConfig[];
  capi_scheduled_fields: CapiFieldConfig[];
}

interface StageHistoryEntry {
  ID: string;
  TYPE_ID: string;
  OWNER_ID: string;
  CREATED_TIME: string; // ISO date
  STAGE_ID: string;
  CATEGORY_ID: string;
}

interface BackfillEvent {
  leadId: number;
  dealId: number;
  phone: string;
  email: string | null;
  leadgenId: string | null;
  firstName: string | null;
  lastName: string | null;
  level: 1 | 2 | 3;
  eventName: string;
  eventTime: Date;
  stageId: string;
  categoryId: string;
}

// ============================================================================
// Helpers
// ============================================================================

function hashForCapi(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function hashPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  return hashForCapi(cleaned);
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

/** Check if a stage transition matches a CAPI level config */
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

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { supabase } = await import('../lib/supabase.js');
  const { getValidBitrix24Token } = await import('../lib/bitrix24Tokens.js');
  const { bitrix24Request, findByPhone, getDeal } = await import('../adapters/bitrix24.js');

  // ----------------------------------------------------------
  // Step 1: Resolve ad_account → user_account
  // ----------------------------------------------------------
  const { data: adAccount, error: adError } = await supabase
    .from('ad_accounts')
    .select('id, user_account_id, name, ad_account_id, bitrix24_domain, bitrix24_entity_type, access_token')
    .eq('id', AD_ACCOUNT_ID)
    .single();

  if (adError || !adAccount) {
    console.error('Ad account not found:', adError?.message);
    process.exit(1);
  }

  const accountId = adAccount.id;
  const USER_ACCOUNT_ID = adAccount.user_account_id;

  console.log('='.repeat(70));
  console.log('CAPI BACKFILL SCRIPT');
  console.log(`Ad Account:   ${adAccount.name} (${accountId})`);
  console.log(`User Account: ${USER_ACCOUNT_ID}`);
  console.log(`Bitrix24:     ${adAccount.bitrix24_domain} (${adAccount.bitrix24_entity_type})`);
  console.log(`Days back:    ${DAYS_BACK}`);
  console.log(`Dry run:      ${DRY_RUN}`);
  console.log('='.repeat(70));

  if (!adAccount.bitrix24_domain) {
    console.error('Bitrix24 not connected on this ad_account');
    process.exit(1);
  }

  // ----------------------------------------------------------
  // Step 2: Get CAPI settings
  // ----------------------------------------------------------
  console.log('\n--- Step 2: Loading CAPI settings ---');

  // Try with account_id first, then without (legacy)
  let { data: capiSettingsRows, error: capiError } = await supabase
    .from('capi_settings')
    .select('*')
    .eq('user_account_id', USER_ACCOUNT_ID)
    .eq('account_id', accountId)
    .eq('is_active', true);

  if (!capiSettingsRows?.length) {
    const { data: legacyRows } = await supabase
      .from('capi_settings')
      .select('*')
      .eq('user_account_id', USER_ACCOUNT_ID)
      .eq('is_active', true);

    capiSettingsRows = legacyRows || [];
  }

  // Find the lead_forms channel with crm source
  const settings = capiSettingsRows!.find(
    (s: any) => s.capi_source === 'crm' && s.capi_crm_type === 'bitrix24',
  ) as CapiSettings | undefined;

  if (!settings) {
    console.error('No CAPI settings with source=crm, type=bitrix24 found');
    console.log('Available settings:', capiSettingsRows!.map((s: any) => ({
      channel: s.channel,
      source: s.capi_source,
      crmType: s.capi_crm_type,
    })));
    process.exit(1);
  }

  console.log(`CAPI settings found:`);
  console.log(`  Channel:  ${settings.channel}`);
  console.log(`  Pixel:    ${settings.pixel_id}`);
  console.log(`  Source:    ${settings.capi_source}`);
  console.log(`  CRM type: ${settings.capi_crm_type}`);
  console.log(`  L1 configs: ${settings.capi_interest_fields?.length || 0}`);
  console.log(`  L2 configs: ${settings.capi_qualified_fields?.length || 0}`);
  console.log(`  L3 configs: ${settings.capi_scheduled_fields?.length || 0}`);

  // Collect all stage configs for matching
  const levelConfigs: { level: 1 | 2 | 3; configs: CapiFieldConfig[] }[] = [
    { level: 1, configs: (settings.capi_interest_fields || []).filter(isStageConfig) },
    { level: 2, configs: (settings.capi_qualified_fields || []).filter(isStageConfig) },
    { level: 3, configs: (settings.capi_scheduled_fields || []).filter(isStageConfig) },
  ];

  // Print stage matching config
  for (const lc of levelConfigs) {
    for (const cfg of lc.configs) {
      console.log(`  L${lc.level}: stage=${cfg.status_id}, pipeline=${cfg.pipeline_id || 'any'}, entity=${cfg.entity_type || 'any'}`);
    }
  }

  // ----------------------------------------------------------
  // Step 3: Get pixel access token
  // ----------------------------------------------------------
  console.log('\n--- Step 3: Resolving pixel access token ---');

  // CAPI access token: setting-level → ad_account-level → user_account-level
  let pixelAccessToken = settings.capi_access_token;
  if (!pixelAccessToken) {
    pixelAccessToken = adAccount.access_token || null;
  }
  if (!pixelAccessToken) {
    const { data: uaData } = await supabase
      .from('user_accounts')
      .select('access_token')
      .eq('id', USER_ACCOUNT_ID)
      .single();
    pixelAccessToken = uaData?.access_token || null;
  }

  if (!pixelAccessToken) {
    console.error('No access token found for CAPI pixel');
    process.exit(1);
  }
  console.log(`Access token: ${pixelAccessToken.slice(0, 20)}...`);

  // ----------------------------------------------------------
  // Step 4: Get Bitrix24 token
  // ----------------------------------------------------------
  console.log('\n--- Step 4: Getting Bitrix24 token ---');

  const { accessToken: b24Token, domain: b24Domain } = await getValidBitrix24Token(USER_ACCOUNT_ID, accountId);
  console.log(`Bitrix24 domain: ${b24Domain}`);
  console.log(`Token: ${b24Token.slice(0, 20)}...`);

  // ----------------------------------------------------------
  // Step 5: Get leads from DB
  // ----------------------------------------------------------
  console.log('\n--- Step 5: Loading leads from DB ---');

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - DAYS_BACK);

  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('id, phone, chat_id, email, name, bitrix24_deal_id, bitrix24_contact_id, leadgen_id, direction_id, created_at')
    .eq('user_account_id', USER_ACCOUNT_ID)
    .gte('created_at', cutoffDate.toISOString())
    .order('created_at', { ascending: false });

  if (leadsError) {
    console.error('Error loading leads:', leadsError.message);
    process.exit(1);
  }

  console.log(`Found ${leads?.length || 0} leads in the last ${DAYS_BACK} days`);

  if (!leads?.length) {
    console.log('No leads to process. Exiting.');
    process.exit(0);
  }

  // ----------------------------------------------------------
  // Step 6: Sync leads with Bitrix24 (find deals by phone)
  // ----------------------------------------------------------
  console.log('\n--- Step 6: Syncing leads with Bitrix24 ---');

  let syncedCount = 0;
  let alreadyLinkedCount = 0;
  let notFoundCount = 0;

  for (const lead of leads) {
    if (lead.bitrix24_deal_id) {
      alreadyLinkedCount++;
      continue;
    }

    const rawPhone = lead.phone || lead.chat_id;
    if (!rawPhone) {
      console.log(`  Lead #${lead.id}: no phone, skipping`);
      continue;
    }

    const phone = normalizePhone(rawPhone);
    if (!phone) continue;

    try {
      // Search Bitrix24 for contact/deal by phone
      const found = await findByPhone(b24Domain, b24Token, [phone], 'CONTACT');
      const contactIds = found?.CONTACT || [];

      if (!contactIds.length) {
        notFoundCount++;
        continue;
      }

      // Get deals for the first contact
      const contactId = contactIds[0];
      const deals = await bitrix24Request<any[]>({
        domain: b24Domain,
        accessToken: b24Token,
        method: 'crm.deal.list',
        params: {
          filter: { CONTACT_ID: contactId },
          select: ['ID', 'STAGE_ID', 'CATEGORY_ID', 'DATE_CREATE', 'DATE_MODIFY'],
          order: { DATE_CREATE: 'DESC' },
        },
      });

      if (!deals?.length) {
        notFoundCount++;
        continue;
      }

      const deal = deals[0];
      const dealId = parseInt(deal.ID, 10);

      // Update lead in DB
      if (!DRY_RUN) {
        await supabase
          .from('leads')
          .update({
            bitrix24_deal_id: dealId,
            bitrix24_contact_id: parseInt(String(contactId), 10),
            bitrix24_entity_type: 'deal',
          })
          .eq('id', lead.id);
      }

      lead.bitrix24_deal_id = dealId;
      lead.bitrix24_contact_id = parseInt(String(contactId), 10);
      syncedCount++;
      console.log(`  Lead #${lead.id}: linked to deal ${dealId}`);

      await sleep(500); // Bitrix24 rate limit: 2 req/sec
    } catch (err: any) {
      console.error(`  Lead #${lead.id}: sync error: ${err.message}`);
    }
  }

  console.log(`\nSync results: ${syncedCount} linked, ${alreadyLinkedCount} already linked, ${notFoundCount} not found in Bitrix24`);

  // ----------------------------------------------------------
  // Step 7: Get deal stage history from Bitrix24
  // ----------------------------------------------------------
  console.log('\n--- Step 7: Fetching deal stage history from Bitrix24 ---');

  const linkedLeads = leads.filter((l) => l.bitrix24_deal_id);
  console.log(`Processing ${linkedLeads.length} linked leads`);

  const eventsToSend: BackfillEvent[] = [];
  const cutoffUnix = Math.floor(cutoffDate.getTime() / 1000);

  for (const lead of linkedLeads) {
    const dealId = lead.bitrix24_deal_id!;
    const rawPhone = lead.phone || lead.chat_id || '';
    const phone = normalizePhone(rawPhone);

    if (!phone) {
      console.log(`  Lead #${lead.id} (deal ${dealId}): no phone, skipping`);
      continue;
    }

    try {
      // Fetch stage history for this deal
      const history = await bitrix24Request<StageHistoryEntry[]>({
        domain: b24Domain,
        accessToken: b24Token,
        method: 'crm.stagehistory.list',
        params: {
          entityTypeId: 2, // 2 = deals
          filter: {
            OWNER_ID: dealId,
          },
          order: { CREATED_TIME: 'ASC' },
        },
      });

      // crm.stagehistory.list returns { items: [...] } not direct array
      const items: StageHistoryEntry[] = Array.isArray(history) ? history : (history as any)?.items || [];

      if (!items.length) {
        console.log(`  Lead #${lead.id} (deal ${dealId}): no stage history`);
        continue;
      }

      console.log(`  Lead #${lead.id} (deal ${dealId}): ${items.length} stage transitions`);

      // Track which levels we already found for this lead (send only first occurrence)
      const matchedLevels = new Set<number>();

      for (const entry of items) {
        const transitionTime = new Date(entry.CREATED_TIME);
        const transitionUnix = Math.floor(transitionTime.getTime() / 1000);

        // Skip if older than our window
        if (transitionUnix < cutoffUnix) continue;

        // Check against all level configs
        for (const lc of levelConfigs) {
          if (matchedLevels.has(lc.level)) continue; // already matched this level

          for (const config of lc.configs) {
            if (matchesStageTransition(entry.STAGE_ID, entry.CATEGORY_ID, config)) {
              matchedLevels.add(lc.level);
              // Split "Имя Фамилия" into fn/ln
              const nameParts = (lead.name || '').trim().split(/\s+/);
              const firstName = nameParts[0] || null;
              const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

              eventsToSend.push({
                leadId: lead.id,
                dealId,
                phone,
                email: lead.email || null,
                leadgenId: lead.leadgen_id || null,
                firstName,
                lastName,
                level: lc.level,
                eventName: CRM_LEVEL_EVENTS[lc.level],
                eventTime: transitionTime,
                stageId: entry.STAGE_ID,
                categoryId: entry.CATEGORY_ID,
              });
              console.log(`    → L${lc.level} (${CRM_LEVEL_EVENTS[lc.level]}) at ${transitionTime.toISOString()} [stage=${entry.STAGE_ID}]`);
              break;
            }
          }
        }
      }

      await sleep(500); // Rate limit
    } catch (err: any) {
      console.error(`  Lead #${lead.id} (deal ${dealId}): history error: ${err.message}`);
    }
  }

  console.log(`\nTotal events to send: ${eventsToSend.length}`);

  if (!eventsToSend.length) {
    console.log('No events to send. Exiting.');
    process.exit(0);
  }

  // Print summary
  const byLevel = { 1: 0, 2: 0, 3: 0 };
  for (const evt of eventsToSend) {
    byLevel[evt.level]++;
  }
  console.log(`  L1 (Contact):    ${byLevel[1]}`);
  console.log(`  L2 (Schedule):   ${byLevel[2]}`);
  console.log(`  L3 (StartTrial): ${byLevel[3]}`);

  if (DRY_RUN) {
    console.log('\n--- DRY RUN: не отправляем, только показываем ---');
    for (const evt of eventsToSend) {
      console.log(`  Lead #${evt.leadId} | Deal ${evt.dealId} | L${evt.level} ${evt.eventName} | ${evt.eventTime.toISOString()} | phone=${evt.phone}`);
    }
    process.exit(0);
  }

  // ----------------------------------------------------------
  // Step 8: Send events to Meta CAPI
  // ----------------------------------------------------------
  console.log('\n--- Step 8: Sending events to Meta CAPI ---');

  let sentCount = 0;
  let errorCount = 0;

  for (const evt of eventsToSend) {
    const eventTime = Math.floor(evt.eventTime.getTime() / 1000);
    const eventId = `backfill_v2_${evt.dealId}_L${evt.level}_${eventTime}`;

    // Build user_data with maximum parameters for better EMQ
    const userData: Record<string, unknown> = {
      ph: [hashPhone(evt.phone)],
      country: [hashForCapi('kz')],
    };

    if (evt.email) {
      userData.em = [hashForCapi(evt.email)];
    }

    if (evt.firstName) {
      userData.fn = [hashForCapi(evt.firstName)];
    }

    if (evt.lastName) {
      userData.ln = [hashForCapi(evt.lastName)];
    }

    if (evt.leadId) {
      userData.external_id = String(evt.leadId);
    }

    if (evt.leadgenId) {
      const numericLeadId = Number(evt.leadgenId);
      if (Number.isFinite(numericLeadId)) {
        userData.lead_id = numericLeadId;
      }
    }

    const eventPayload = {
      event_name: evt.eventName,
      event_time: eventTime,
      event_id: eventId,
      action_source: 'system_generated',
      user_data: userData,
      custom_data: {
        event_level: evt.level,
      },
    };

    try {
      const url = `${CAPI_BASE_URL}/${settings.pixel_id}/events`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: [eventPayload],
          access_token: pixelAccessToken,
        }),
      });

      const responseData = await response.json() as any;

      if (!response.ok) {
        console.error(`  ✗ Lead #${evt.leadId} L${evt.level}: ${response.status} ${JSON.stringify(responseData.error || responseData)}`);
        errorCount++;
      } else {
        console.log(`  ✓ Lead #${evt.leadId} L${evt.level} ${evt.eventName} | event_time=${evt.eventTime.toISOString()} | events_received=${responseData.events_received}`);
        sentCount++;

        // Log to capi_events_log
        await supabase.from('capi_events_log').insert({
          lead_id: String(evt.leadId),
          user_account_id: USER_ACCOUNT_ID,
          event_name: evt.eventName,
          event_level: evt.level,
          pixel_id: settings.pixel_id,
          event_time: evt.eventTime.toISOString(),
          event_id: eventId,
          contact_phone: evt.phone,
          capi_status: 'success',
          capi_response: responseData,
          request_payload: { data: [eventPayload] },
        });
      }

      await sleep(200); // Don't hammer Meta API
    } catch (err: any) {
      console.error(`  ✗ Lead #${evt.leadId} L${evt.level}: ${err.message}`);
      errorCount++;
    }
  }

  // ----------------------------------------------------------
  // Summary
  // ----------------------------------------------------------
  console.log('\n' + '='.repeat(70));
  console.log('BACKFILL COMPLETE');
  console.log(`  Total events:  ${eventsToSend.length}`);
  console.log(`  Sent:          ${sentCount}`);
  console.log(`  Errors:        ${errorCount}`);
  console.log('='.repeat(70));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
