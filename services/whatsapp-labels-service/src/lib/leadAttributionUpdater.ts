/**
 * Обновление leads с рекламной атрибуцией, извлечённой из wwebjs.
 *
 * При recovery пропущенных сообщений — если в wwebjs сообщении найдены
 * ad-метаданные (sourceId, sourceUrl) — обновляем лид в БД.
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
 * Обновить атрибуцию лида на основе данных из wwebjs.
 *
 * @param contactPhone — телефон контакта (без @c.us)
 * @param userAccountId — ID аккаунта владельца
 * @param attribution — извлечённая атрибуция
 */
export async function updateLeadAttribution(
  contactPhone: string,
  userAccountId: string,
  attribution: AdAttribution
): Promise<void> {
  if (attribution.pattern === 'none') return;

  const db = getSupabase();

  // Ищем лид по телефону (chat_id может быть в формате @s.whatsapp.net или @c.us)
  const lead = await findLead(db, contactPhone, userAccountId);

  if (!lead) {
    // Лид ещё не создан (chatbot-service создаёт после pushToChatbot) — retry через 5 сек
    log.info({ contactPhone, userAccountId }, 'Lead not found, retrying in 5s...');
    await new Promise(r => setTimeout(r, 5000));

    const retryLead = await findLead(db, contactPhone, userAccountId);
    if (!retryLead) {
      log.warn({ contactPhone, userAccountId }, 'Lead still not found after retry');
      return;
    }
    await applyAttribution(db, retryLead, attribution);
    return;
  }

  await applyAttribution(db, lead, attribution);
}

async function findLead(
  db: SupabaseClient,
  contactPhone: string,
  userAccountId: string
): Promise<{ id: string; source_id: string | null; creative_id: string | null } | null> {
  // Пробуем все форматы chat_id (в БД хранится без суффикса, но на всякий случай проверяем все)
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

async function applyAttribution(
  db: SupabaseClient,
  lead: { id: string; source_id: string | null; creative_id: string | null },
  attribution: AdAttribution
): Promise<void> {
  // Не перезаписываем существующую атрибуцию
  if (lead.source_id) {
    log.debug({ leadId: lead.id, existingSourceId: lead.source_id }, 'Lead already has source_id, skipping');
    return;
  }

  const update: Record<string, any> = {
    ad_attribution_source: getAttributionSource(attribution.pattern),
  };

  if (attribution.sourceId) {
    update.source_id = attribution.sourceId;
  }

  // Резолвим creative_id/direction_id если есть sourceId
  if (attribution.sourceId) {
    const resolved = await resolveCreative(db, attribution.sourceId, lead.id);
    if (resolved.creativeId) update.creative_id = resolved.creativeId;
    if (resolved.directionId) update.direction_id = resolved.directionId;
  }

  // Fallback: резолвим по sourceUrl
  if (!update.creative_id && attribution.sourceUrl) {
    const resolved = await resolveCreativeByUrl(db, attribution.sourceUrl, lead.id);
    if (resolved.creativeId) update.creative_id = resolved.creativeId;
    if (resolved.directionId) update.direction_id = resolved.directionId;
  }

  const { error } = await db
    .from('leads')
    .update(update)
    .eq('id', lead.id);

  if (error) {
    log.error({ leadId: lead.id, error: error.message }, 'Failed to update lead attribution');
    return;
  }

  log.info({
    leadId: lead.id,
    sourceId: attribution.sourceId,
    sourceUrl: attribution.sourceUrl,
    pattern: attribution.pattern,
    creativeId: update.creative_id || null,
    directionId: update.direction_id || null,
    attributionSource: update.ad_attribution_source,
  }, 'Lead attribution updated from wwebjs');
}

function getAttributionSource(pattern: AdAttribution['pattern']): string {
  switch (pattern) {
    case 'ctwa_context': return 'wwebjs_recovery';
    case 'url_match': return 'wwebjs_url_match';
    case 'unattributed': return 'wwebjs_unattributed';
    default: return 'wwebjs_unknown';
  }
}

/**
 * Упрощённый creative resolver — lookup в ad_creative_mapping по ad_id.
 * Аналог creativeResolver.ts из agent-service, но без Fastify зависимости.
 */
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
    log.debug({ sourceId, creativeId: data.user_creative_id, directionId: data.direction_id }, 'Resolved creative via ad_creative_mapping');
    return { creativeId: data.user_creative_id, directionId: data.direction_id };
  }

  return { creativeId: null, directionId: null };
}

/**
 * Fallback: ищем креатив по URL в title user_creatives.
 */
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
    log.debug({ sourceUrl, creativeId: data.id, directionId: data.direction_id }, 'Resolved creative via URL matching');
    return { creativeId: data.id, directionId: data.direction_id };
  }

  return { creativeId: null, directionId: null };
}
