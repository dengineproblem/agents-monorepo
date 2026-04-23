import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { pino } from 'pino';
import { initSession, destroySession, getSession, checkSessionAlive } from './sessionManager.js';

const log = pino({ name: 'label-sync' });

const SYNC_DELAY_MS = parseInt(process.env.WWEBJS_SYNC_DELAY_MS || '15000', 10);
const FLUSH_DELAY_MS = parseInt(process.env.WWEBJS_FLUSH_DELAY_MS || '45000', 10);

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
 * Queue a WhatsApp label onto a chat.
 * Note: this only submits the action to wwebjs's local app-state queue.
 * The actual server propagation happens asynchronously; verification must be
 * done at the end of the sync via getChatsByLabelId (see syncAccountLabels).
 */
async function queueLabel(session: any, lead: LeadToSync, labelId: string): Promise<{ status: 'queued' | 'already' | 'not_found'; chatId: string }> {
  const chatId = toChatId(lead.chat_id);
  const chat = await session.client.getChatById(chatId);

  if (!chat) {
    log.warn({ leadId: lead.id, chatId }, 'Chat not found');
    return { status: 'not_found', chatId };
  }

  const currentLabels = await chat.getLabels();
  const currentLabelIds = currentLabels.map((l: any) => l.id);

  if (currentLabelIds.includes(labelId)) {
    return { status: 'already', chatId };
  }

  const newLabelIds = [...currentLabelIds, labelId];
  await chat.changeLabels(newLabelIds);
  log.info({ leadId: lead.id, chatId, labelId }, 'changeLabels queued');
  return { status: 'queued', chatId };
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

  // Map: chatId → { leadId, isPaid } for post-flush verification.
  const queuedLead: Map<string, { leadId: number; isPaid: boolean }> = new Map();
  const queuedPaid: Map<string, { leadId: number }> = new Map();

  // Pass 1: qualified leads → lead label (queue only)
  if (account.label_mapping_label_id && qualifiedLeads.length > 0) {
    const labelId = account.label_mapping_label_id;
    log.info({ userAccountId: account.id, labelId, count: qualifiedLeads.length }, 'Pass 1: queuing qualified lead labels');

    for (const lead of qualifiedLeads) {
      try {
        const res = await queueLabel(session, lead, labelId);
        if (res.status === 'queued' || res.status === 'already') {
          queuedLead.set(res.chatId, { leadId: lead.id, isPaid: false });
        }
        await new Promise(r => setTimeout(r, 1000));
      } catch (err: any) {
        log.error({ leadId: lead.id, err: err.message }, 'Failed to queue qualified lead');
      }
    }
  }

  // Pass 2: paid leads → paid label (queue only)
  if (account.label_mapping_paid_label_id && paidLeads.length > 0) {
    const paidLabelId = account.label_mapping_paid_label_id;
    log.info({ userAccountId: account.id, paidLabelId, count: paidLeads.length }, 'Pass 2: queuing paid lead labels');

    for (const lead of paidLeads) {
      try {
        const res = await queueLabel(session, lead, paidLabelId);
        if (res.status === 'queued' || res.status === 'already') {
          queuedPaid.set(res.chatId, { leadId: lead.id });
        }
        await new Promise(r => setTimeout(r, 1000));
      } catch (err: any) {
        log.error({ leadId: lead.id, err: err.message }, 'Failed to queue paid lead');
      }
    }
  }

  // Wait for wwebjs to flush queued app-state mutations to WhatsApp servers.
  // Without this delay, changeLabels stays pending in local IndexedDB and never propagates
  // — labels become visible only after next QR rescan (which triggers a sync replay).
  log.info({ userAccountId: account.id, flushDelayMs: FLUSH_DELAY_MS }, 'Waiting for app-state flush');
  await new Promise(r => setTimeout(r, FLUSH_DELAY_MS));

  let syncedCount = 0;

  // Server-side verify: getChatsByLabelId returns chats that WhatsApp server confirms have the label.
  if (account.label_mapping_label_id && queuedLead.size > 0) {
    const labelId = account.label_mapping_label_id;
    try {
      const chatsOnServer = await session.client.getChatsByLabelId(labelId);
      const serverChatIds = new Set(chatsOnServer.map((c: any) => c.id._serialized));
      let confirmed = 0;
      for (const [chatId, { leadId }] of queuedLead) {
        if (serverChatIds.has(chatId)) {
          await markSynced(leadId);
          syncedCount++;
          confirmed++;
        } else {
          log.warn({ leadId, chatId, labelId }, 'Lead label NOT confirmed on server after flush');
        }
      }
      log.info({ userAccountId: account.id, labelId, queued: queuedLead.size, confirmed }, 'Lead label server-side verification');
    } catch (err: any) {
      log.error({ userAccountId: account.id, labelId, err: err.message }, 'getChatsByLabelId failed for lead label');
    }
  }

  if (account.label_mapping_paid_label_id && queuedPaid.size > 0) {
    const paidLabelId = account.label_mapping_paid_label_id;
    try {
      const chatsOnServer = await session.client.getChatsByLabelId(paidLabelId);
      const serverChatIds = new Set(chatsOnServer.map((c: any) => c.id._serialized));
      let confirmed = 0;
      for (const [chatId, { leadId }] of queuedPaid) {
        if (serverChatIds.has(chatId)) {
          await markPaidSynced(leadId);
          syncedCount++;
          confirmed++;
        } else {
          log.warn({ leadId, chatId, paidLabelId }, 'Paid label NOT confirmed on server after flush');
        }
      }
      log.info({ userAccountId: account.id, paidLabelId, queued: queuedPaid.size, confirmed }, 'Paid label server-side verification');
    } catch (err: any) {
      log.error({ userAccountId: account.id, paidLabelId, err: err.message }, 'getChatsByLabelId failed for paid label');
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
