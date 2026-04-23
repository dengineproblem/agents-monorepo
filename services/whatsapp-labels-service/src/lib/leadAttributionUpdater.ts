/**
 * Обновление/создание leads с рекламной атрибуцией, извлечённой из wwebjs.
 *
 * При recovery пропущенных сообщений:
 * - Если лид уже есть в БД и без source_id — проставляем атрибуцию.
 * - Если лида нет — создаём (эквивалент processAdLead в evolutionWebhooks).
 *   Это нужно потому что chatbot-service `/process-message` пишет только в
 *   `dialog_analysis` и никогда не создаёт строки в `leads`.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { pino } from 'pino';
import type { AdAttribution } from './adAttribution.js';

const log = pino({ name: 'lead-attribution' });

let supabase: SupabaseClient;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );
  }
  return supabase;
}

/**
 * Обновить или создать лид на основе данных из wwebjs.
 */
export async function updateLeadAttribution(
  contactPhone: string,
  userAccountId: string,
  instanceName: string,
  attribution: AdAttribution
): Promise<void> {
  if (attribution.pattern === 'none') return;

  const db = getSupabase();
  const lead = await findLead(db, contactPhone, userAccountId);

  if (lead) {
    await applyAttribution(db, lead, attribution);
    return;
  }

  // Лида нет — создаём с данными из wwebjs и instance mapping
  await createLead(db, contactPhone, userAccountId, instanceName, attribution);
}

async function findLead(
  db: SupabaseClient,
  contactPhone: string,
  userAccountId: string
): Promise<{ id: string; source_id: string | null; creative_id: string | null } | null> {
  const candidates = [
    contactPhone,
    `${contactPhone}@s.whatsapp.net`,
    `${contactPhone}@c.us`,
  ];

  for (const chatId of candidates) {
    const { data } = await db
      .from('leads')
      .select('id, source_id, creative_id')
      .eq('user_account_id', userAccountId)
      .eq('chat_id', chatId)
      .maybeSingle();

    if (data) return data;
  }

  return null;
}

async function getInstanceMeta(
  db: SupabaseClient,
  instanceName: string
): Promise<{
  whatsappPhoneNumberId: string | null;
  businessPhone: string | null;
  accountId: string | null;
}> {
  const { data, error } = await db
    .from('whatsapp_phone_numbers')
    .select('id, phone_number, account_id')
    .eq('instance_name', instanceName)
    .maybeSingle();

  if (error || !data) {
    return { whatsappPhoneNumberId: null, businessPhone: null, accountId: null };
  }
  return {
    whatsappPhoneNumberId: data.id,
    businessPhone: data.phone_number,
    accountId: data.account_id,
  };
}

async function applyAttribution(
  db: SupabaseClient,
  lead: { id: string; source_id: string | null; creative_id: string | null },
  attribution: AdAttribution
): Promise<void> {
  if (lead.source_id) {
    log.debug({ leadId: lead.id, existingSourceId: lead.source_id }, 'Lead already has source_id, skipping');
    return;
  }

  const update: Record<string, any> = {};

  if (attribution.sourceId) update.source_id = attribution.sourceId;
  if (attribution.ctwaClid) update.ctwa_clid = attribution.ctwaClid;

  if (attribution.sourceId) {
    const resolved = await resolveCreative(db, attribution.sourceId, lead.id);
    if (resolved.creativeId) update.creative_id = resolved.creativeId;
    if (resolved.directionId) update.direction_id = resolved.directionId;
  }

  if (!update.creative_id && attribution.sourceUrl) {
    const resolved = await resolveCreativeByUrl(db, attribution.sourceUrl, lead.id);
    if (resolved.creativeId) update.creative_id = resolved.creativeId;
    if (resolved.directionId) update.direction_id = resolved.directionId;
  }

  const { error } = await db.from('leads').update(update).eq('id', lead.id);

  if (error) {
    log.error({ leadId: lead.id, error: error.message }, 'Failed to update lead attribution');
    return;
  }

  log.info({
    leadId: lead.id,
    sourceId: attribution.sourceId,
    ctwaClid: attribution.ctwaClid,
    pattern: attribution.pattern,
    creativeId: update.creative_id || null,
    directionId: update.direction_id || null,
  }, 'Lead attribution updated from wwebjs');
}

async function createLead(
  db: SupabaseClient,
  contactPhone: string,
  userAccountId: string,
  instanceName: string,
  attribution: AdAttribution
): Promise<void> {
  const { whatsappPhoneNumberId, businessPhone, accountId } = await getInstanceMeta(db, instanceName);

  if (!businessPhone) {
    log.warn({ contactPhone, userAccountId, instanceName }, 'Cannot create lead — instance not found in whatsapp_phone_numbers');
    return;
  }

  let creativeId: string | null = null;
  let directionId: string | null = null;

  if (attribution.sourceId) {
    const resolved = await resolveCreative(db, attribution.sourceId, '');
    creativeId = resolved.creativeId;
    directionId = resolved.directionId;
  }

  if (!creativeId && attribution.sourceUrl) {
    const resolved = await resolveCreativeByUrl(db, attribution.sourceUrl, '');
    creativeId = resolved.creativeId;
    directionId = resolved.directionId;
  }

  const now = new Date();
  const insert: Record<string, any> = {
    user_account_id: userAccountId,
    account_id: accountId,
    business_id: businessPhone,
    chat_id: contactPhone,
    source_id: attribution.sourceId,
    conversion_source: 'wwebjs_recovery',
    creative_url: attribution.sourceUrl || attribution.mediaUrl,
    creative_id: creativeId,
    direction_id: directionId,
    whatsapp_phone_number_id: whatsappPhoneNumberId,
    ctwa_clid: attribution.ctwaClid,
    funnel_stage: 'new_lead',
    status: 'active',
    created_at: now,
    updated_at: now,
  };

  const { data: newLead, error } = await db.from('leads').insert(insert).select().single();

  if (error) {
    log.error({ contactPhone, userAccountId, error: error.message }, 'Failed to create lead from wwebjs recovery');
    return;
  }

  log.info({
    leadId: newLead?.id,
    contactPhone,
    sourceId: attribution.sourceId,
    ctwaClid: attribution.ctwaClid,
    pattern: attribution.pattern,
    creativeId,
    directionId,
  }, 'Lead created from wwebjs recovery');
}

async function resolveCreative(
  db: SupabaseClient,
  sourceId: string,
  leadId: string
): Promise<{ creativeId: string | null; directionId: string | null }> {
  const { data, error } = await db
    .from('ad_creative_mapping')
    .select('user_creative_id, direction_id')
    .eq('ad_id', sourceId)
    .maybeSingle();

  if (error) {
    log.error({ sourceId, leadId, error: error.message }, 'Error looking up ad_creative_mapping');
    return { creativeId: null, directionId: null };
  }

  if (data) {
    return { creativeId: data.user_creative_id, directionId: data.direction_id };
  }

  return { creativeId: null, directionId: null };
}

async function resolveCreativeByUrl(
  db: SupabaseClient,
  sourceUrl: string,
  leadId: string
): Promise<{ creativeId: string | null; directionId: string | null }> {
  const { data, error } = await db
    .from('user_creatives')
    .select('id, direction_id')
    .ilike('title', `%${sourceUrl}%`)
    .maybeSingle();

  if (error) {
    log.error({ sourceUrl, leadId, error: error.message }, 'Error looking up user_creatives by URL');
    return { creativeId: null, directionId: null };
  }

  if (data) {
    return { creativeId: data.id, directionId: data.direction_id };
  }

  return { creativeId: null, directionId: null };
}
