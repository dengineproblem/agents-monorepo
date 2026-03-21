import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { pino } from 'pino';
import { initSession, destroySession, getSession } from './sessionManager.js';

const log = pino({ name: 'label-sync' });

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
  label_mapping_label_id: string | null; // which WhatsApp label ID = "paid"
}

/**
 * Get all user accounts that have wwebjs labels enabled.
 * A user is "enabled" if they have a wwebjs session dir (i.e. scanned QR at least once)
 * AND have configured which label to use.
 */
async function getEnabledAccounts(): Promise<UserAccount[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from('user_accounts')
    .select('id, wwebjs_label_id')
    .not('wwebjs_label_id', 'is', null);

  if (error) {
    log.error({ error: error.message }, 'Failed to fetch enabled accounts');
    return [];
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    label_mapping_label_id: row.wwebjs_label_id,
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
    log.error({ userAccountId, error: error.message }, 'Failed to fetch leads');
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
 * Sync labels for a single user account.
 * Returns count of successfully labeled leads.
 */
async function syncAccountLabels(account: UserAccount): Promise<number> {
  const leads = await getUnlabeledQualifiedLeads(account.id);
  if (leads.length === 0) {
    log.info({ userAccountId: account.id }, 'No leads to sync');
    return 0;
  }

  log.info({ userAccountId: account.id, leadCount: leads.length }, 'Starting label sync');

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

  const labelId = account.label_mapping_label_id!;
  let syncedCount = 0;

  for (const lead of leads) {
    try {
      const chatId = toChatId(lead.chat_id);
      const chat = await session.client.getChatById(chatId);

      if (!chat) {
        log.warn({ leadId: lead.id, chatId }, 'Chat not found');
        continue;
      }

      // Get current labels on this chat
      const currentLabels = await chat.getLabels();
      const currentLabelIds = currentLabels.map((l: any) => l.id);

      log.info({ leadId: lead.id, chatId, currentLabelIds, targetLabelId: labelId }, 'Current labels on chat');

      // Only add if not already present
      if (!currentLabelIds.includes(labelId)) {
        const newLabelIds = [...currentLabelIds, labelId];
        log.info({ leadId: lead.id, chatId, newLabelIds }, 'Calling changeLabels');
        const result = await chat.changeLabels(newLabelIds);
        log.info({ leadId: lead.id, chatId, labelId, result: JSON.stringify(result) }, 'Label assigned');
      } else {
        log.info({ leadId: lead.id, chatId }, 'Label already present');
      }

      await markSynced(lead.id);
      syncedCount++;

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 1000));
    } catch (err: any) {
      log.error({ leadId: lead.id, err: err.message }, 'Failed to label lead');
    }
  }

  // Destroy session to free RAM
  await destroySession(account.id);

  log.info({ userAccountId: account.id, syncedCount, total: leads.length }, 'Label sync complete');
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
    .select('id, wwebjs_label_id')
    .eq('id', userAccountId)
    .single();

  if (!data?.wwebjs_label_id) {
    throw new Error('Account not configured for wwebjs labels');
  }

  const leads = await getUnlabeledQualifiedLeads(userAccountId);
  const synced = await syncAccountLabels({
    id: data.id,
    label_mapping_label_id: data.wwebjs_label_id,
  });

  return { synced, total: leads.length };
}
