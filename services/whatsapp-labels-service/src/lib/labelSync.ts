import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { pino } from 'pino';
import { initSession, destroySession, getSession, checkSessionAlive } from './sessionManager.js';

const log = pino({ name: 'label-sync' });

const SYNC_DELAY_MS = parseInt(process.env.WWEBJS_SYNC_DELAY_MS || '15000', 10);

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

interface LeadToSync {
  id: number;
  chat_id: string;
  name: string | null;
}

interface UserAccount {
  id: string;
  label_mapping_label_id: string | null; // lead label ID
  label_mapping_paid_label_id: string | null; // paid label ID
}

/**
 * Get all user accounts that have wwebjs labels enabled.
 * A user is "enabled" if they have configured which label to use.
 * Supports both new (wwebjs_label_id_lead) and legacy (wwebjs_label_id) fields.
 */
async function getEnabledAccounts(): Promise<UserAccount[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from('user_accounts')
    .select('id, wwebjs_label_id, wwebjs_label_id_lead, wwebjs_label_id_paid')
    .or('wwebjs_label_id.not.is.null,wwebjs_label_id_lead.not.is.null');

  if (error) {
    log.error({ error: error.message }, 'Failed to fetch enabled accounts');
    return [];
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    // Обратная совместимость: новое поле приоритетнее старого
    label_mapping_label_id: row.wwebjs_label_id_lead || row.wwebjs_label_id,
    label_mapping_paid_label_id: row.wwebjs_label_id_paid || null,
  }));
}

/**
 * Get qualified leads that haven't been labeled yet.
 */
async function getUnlabeledQualifiedLeads(userAccountId: string): Promise<LeadToSync[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from('leads')
    .select('id, chat_id, name')
    .eq('user_account_id', userAccountId)
    .eq('source_type', 'whatsapp')
    .not('chat_id', 'is', null)
    .eq('is_qualified', true)
    .or('whatsapp_label_synced.is.null,whatsapp_label_synced.eq.false')
    .order('created_at', { ascending: false });

  if (error) {
    log.error({ userAccountId, error: error.message }, 'Failed to fetch qualified leads');
    return [];
  }

  return (data || []) as LeadToSync[];
}

/**
 * Get paid leads that haven't been labeled yet.
 */
async function getUnlabeledPaidLeads(userAccountId: string): Promise<LeadToSync[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from('leads')
    .select('id, chat_id, name')
    .eq('user_account_id', userAccountId)
    .eq('source_type', 'whatsapp')
    .not('chat_id', 'is', null)
    .eq('is_paid', true)
    .or('whatsapp_paid_label_synced.is.null,whatsapp_paid_label_synced.eq.false')
    .order('created_at', { ascending: false });

  if (error) {
    log.error({ userAccountId, error: error.message }, 'Failed to fetch paid leads');
    return [];
  }

  return (data || []) as LeadToSync[];
}

/**
 * Convert chat_id (phone number) to wwebjs chat ID format.
 * chat_id in DB: "77768712233" or "77768712233@s.whatsapp.net"
 * wwebjs expects: "77768712233@c.us"
 */
function toChatId(chatId: string): string {
  // Strip any existing suffix
  const phone = chatId.replace(/@.*$/, '').replace(/\D/g, '');
  return `${phone}@c.us`;
}

/**
 * Mark lead as synced in DB.
 */
async function markSynced(leadId: number): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from('leads')
    .update({
      whatsapp_label_synced: true,
      whatsapp_label_synced_at: new Date().toISOString(),
    })
    .eq('id', leadId);

  if (error) {
    log.error({ leadId, error: error.message }, 'Failed to mark lead as synced');
  }
}

/**
 * Mark lead paid label as synced in DB.
 */
async function markPaidSynced(leadId: number): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from('leads')
    .update({
      whatsapp_paid_label_synced: true,
      whatsapp_paid_label_synced_at: new Date().toISOString(),
    })
    .eq('id', leadId);

  if (error) {
    log.error({ leadId, error: error.message }, 'Failed to mark lead paid as synced');
  }
}

/**
 * Apply a WhatsApp label to a chat. Returns true only if label is verified present.
 */
async function applyLabel(session: any, lead: LeadToSync, labelId: string): Promise<boolean> {
  const chatId = toChatId(lead.chat_id);
  const chat = await session.client.getChatById(chatId);

  if (!chat) {
    log.warn({ leadId: lead.id, chatId }, 'Chat not found');
    return false;
  }

  const currentLabels = await chat.getLabels();
  const currentLabelIds = currentLabels.map((l: any) => l.id);

  if (!currentLabelIds.includes(labelId)) {
    const newLabelIds = [...currentLabelIds, labelId];
    log.info({ leadId: lead.id, chatId, newLabelIds }, 'Calling changeLabels');
    const result = await chat.changeLabels(newLabelIds);
    log.info({ leadId: lead.id, chatId, labelId, result: JSON.stringify(result) }, 'changeLabels response');

    // Verify label was actually applied by re-reading labels
    await new Promise(r => setTimeout(r, 500));
    const verifyLabels = await chat.getLabels();
    const verifyLabelIds = verifyLabels.map((l: any) => l.id);
    if (!verifyLabelIds.includes(labelId)) {
      log.error({ leadId: lead.id, chatId, labelId, verifyLabelIds }, 'Label NOT verified after changeLabels — session may be stale');
      return false;
    }
    log.info({ leadId: lead.id, chatId, labelId }, 'Label verified present');
  } else {
    log.info({ leadId: lead.id, chatId, labelId }, 'Label already present');
  }

  return true;
}

/**
 * Sync labels for a single user account.
 * Two passes: first qualified leads (lead label), then paid leads (paid label).
 * Returns count of successfully labeled leads.
 */
async function syncAccountLabels(account: UserAccount): Promise<number> {
  const qualifiedLeads = await getUnlabeledQualifiedLeads(account.id);
  const paidLeads = account.label_mapping_paid_label_id
    ? await getUnlabeledPaidLeads(account.id)
    : [];

  if (qualifiedLeads.length === 0 && paidLeads.length === 0) {
    log.info({ userAccountId: account.id }, 'No leads to sync');
    return 0;
  }

  log.info({
    userAccountId: account.id,
    qualifiedCount: qualifiedLeads.length,
    paidCount: paidLeads.length,
  }, 'Starting label sync');

  let session;
  try {
    session = await initSession(account.id);
  } catch (err: any) {
    log.error({ userAccountId: account.id, err: err.message }, 'Failed to init session');
    return 0;
  }

  if (!session.ready) {
    log.warn({ userAccountId: account.id }, 'Session not ready (needs QR scan?) — skipping');
    await destroySession(account.id);
    return 0;
  }

  // Verify session is truly connected before proceeding
  const { alive, state } = await checkSessionAlive(account.id);
  if (!alive) {
    log.error({ userAccountId: account.id, waState: state }, 'Session marked ready but not CONNECTED — aborting sync');
    await destroySession(account.id);
    return 0;
  }

  // Wait for wwebjs to fully sync with WhatsApp servers.
  // Without this delay, ready fires before the push channel is established,
  // and changeLabels() executes locally but never reaches WhatsApp servers.
  log.info({ userAccountId: account.id, syncDelayMs: SYNC_DELAY_MS }, 'Waiting for session sync');
  await new Promise(r => setTimeout(r, SYNC_DELAY_MS));

  // Re-verify connection after sync delay (session may have dropped during wait)
  const postSyncCheck = await checkSessionAlive(account.id);
  if (!postSyncCheck.alive) {
    log.error({ userAccountId: account.id, waState: postSyncCheck.state }, 'Session lost connection during sync delay — aborting');
    await destroySession(account.id);
    return 0;
  }

  // Sanity check: getChats() forces a real round-trip to WhatsApp servers.
  // If session is stale (e.g. linked device expired), this will reveal it.
  try {
    const chats = await session.client.getChats();
    log.info({ userAccountId: account.id, chatCount: chats.length }, 'Session sanity check passed — chats loaded from server');
    if (chats.length === 0) {
      log.warn({ userAccountId: account.id }, 'getChats() returned 0 chats — session may be stale');
    }
  } catch (err: any) {
    log.error({ userAccountId: account.id, err: err.message }, 'getChats() failed — session is dead, aborting');
    await destroySession(account.id);
    return 0;
  }

  let syncedCount = 0;

  // Pass 1: qualified leads → lead label
  if (account.label_mapping_label_id && qualifiedLeads.length > 0) {
    const labelId = account.label_mapping_label_id;
    log.info({ userAccountId: account.id, labelId, count: qualifiedLeads.length }, 'Pass 1: syncing qualified lead labels');

    for (const lead of qualifiedLeads) {
      try {
        const ok = await applyLabel(session, lead, labelId);
        if (ok) {
          await markSynced(lead.id);
          syncedCount++;
        }
        await new Promise(r => setTimeout(r, 1000));
      } catch (err: any) {
        log.error({ leadId: lead.id, err: err.message }, 'Failed to label qualified lead');
      }
    }
  }

  // Pass 2: paid leads → paid label
  if (account.label_mapping_paid_label_id && paidLeads.length > 0) {
    const paidLabelId = account.label_mapping_paid_label_id;
    log.info({ userAccountId: account.id, paidLabelId, count: paidLeads.length }, 'Pass 2: syncing paid lead labels');

    for (const lead of paidLeads) {
      try {
        const ok = await applyLabel(session, lead, paidLabelId);
        if (ok) {
          await markPaidSynced(lead.id);
          syncedCount++;
        }
        await new Promise(r => setTimeout(r, 1000));
      } catch (err: any) {
        log.error({ leadId: lead.id, err: err.message }, 'Failed to label paid lead');
      }
    }
  }

  // Destroy session to free RAM
  await destroySession(account.id);

  log.info({ userAccountId: account.id, syncedCount, qualifiedTotal: qualifiedLeads.length, paidTotal: paidLeads.length }, 'Label sync complete');
  return syncedCount;
}

/**
 * Main sync function — iterates over all enabled accounts sequentially.
 */
export async function runLabelSync(): Promise<void> {
  log.info('Starting label sync for all accounts');

  const accounts = await getEnabledAccounts();
  if (accounts.length === 0) {
    log.info('No accounts with wwebjs labels enabled');
    return;
  }

  log.info({ accountCount: accounts.length }, 'Processing accounts');

  let totalSynced = 0;
  for (const account of accounts) {
    try {
      const count = await syncAccountLabels(account);
      totalSynced += count;
    } catch (err: any) {
      log.error({ userAccountId: account.id, err: err.message }, 'Account sync failed');
      // Ensure session is cleaned up
      await destroySession(account.id).catch(() => {});
    }
  }

  log.info({ totalSynced, accountCount: accounts.length }, 'Label sync finished');
}

/**
 * Sync labels for a single account (used for manual trigger via API).
 */
export async function syncSingleAccount(userAccountId: string): Promise<{ synced: number; total: number }> {
  const db = getSupabase();
  const { data } = await db
    .from('user_accounts')
    .select('id, wwebjs_label_id, wwebjs_label_id_lead, wwebjs_label_id_paid')
    .eq('id', userAccountId)
    .single();

  const leadLabelId = data?.wwebjs_label_id_lead || data?.wwebjs_label_id;
  if (!leadLabelId) {
    throw new Error('Account not configured for wwebjs labels');
  }

  const qualifiedLeads = await getUnlabeledQualifiedLeads(userAccountId);
  const paidLeads = data?.wwebjs_label_id_paid ? await getUnlabeledPaidLeads(userAccountId) : [];
  const total = qualifiedLeads.length + paidLeads.length;

  const synced = await syncAccountLabels({
    id: data.id,
    label_mapping_label_id: leadLabelId,
    label_mapping_paid_label_id: data?.wwebjs_label_id_paid || null,
  });

  return { synced, total };
}
