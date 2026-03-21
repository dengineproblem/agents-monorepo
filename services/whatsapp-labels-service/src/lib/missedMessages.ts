import { createClient, SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { pino } from 'pino';
import { initSession, destroySession } from './sessionManager.js';
import { extractAdAttribution } from './adAttribution.js';
import { updateLeadAttribution } from './leadAttributionUpdater.js';

const { Pool } = pg;
const log = pino({ name: 'missed-messages' });

let supabase: SupabaseClient;
let evoPool: pg.Pool | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );
  }
  return supabase;
}

function getEvoPool(): pg.Pool {
  if (!evoPool) {
    evoPool = new Pool({
      host: process.env.EVOLUTION_DB_HOST || 'evolution-postgres',
      port: parseInt(process.env.EVOLUTION_DB_PORT || '5432', 10),
      user: process.env.EVOLUTION_DB_USER || 'evolution',
      password: process.env.EVOLUTION_DB_PASSWORD,
      database: process.env.EVOLUTION_DB_NAME || 'evolution',
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return evoPool;
}

const CHATBOT_SERVICE_URL = process.env.CHATBOT_SERVICE_URL || 'http://chatbot-service:8083';
const MAX_MESSAGE_AGE_HOURS = parseInt(process.env.MISSED_MSG_MAX_AGE_HOURS || '6');

interface WwebjsAccount {
  id: string;
  instanceNames: string[];
}

interface WwebjsMessage {
  chatId: string;       // "77768712233@c.us"
  contactPhone: string; // "77768712233"
  text: string;
  timestamp: number;
  fromMe: boolean;
}

// ─── Helpers ───

function chatIdToPhone(chatId: string): string {
  return chatId.replace(/@.*$/, '');
}

function phoneToRemoteJid(phone: string): string {
  return `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
}

function extractMessageText(msg: any): string | null {
  if (msg.body) return msg.body;
  if ((msg.type === 'image' || msg.type === 'video') && msg.caption) return msg.caption;
  return null;
}

// ─── Evolution DB queries ───

/**
 * Проверить, существует ли контакт в Evolution DB для данного инстанса.
 * Если нет — значит Evolution API вообще не получил ни одного сообщения от этого контакта.
 */
async function hasEvolutionMessages(instanceName: string, contactPhone: string): Promise<boolean> {
  const pool = getEvoPool();
  const remoteJid = phoneToRemoteJid(contactPhone);

  const result = await pool.query(`
    SELECT 1 FROM "Message"
    WHERE "instanceId" = (SELECT id FROM "Instance" WHERE name = $1)
      AND "key"->>'remoteJid' = $2
    LIMIT 1
  `, [instanceName, remoteJid]);

  return result.rowCount! > 0;
}

/**
 * Получить последнее сообщение в Evolution DB для контакта.
 * Возвращает { fromMe, timestamp, text } или null.
 */
async function getLastEvoMessage(instanceName: string, contactPhone: string): Promise<{
  fromMe: boolean;
  timestamp: number;
  text: string | null;
} | null> {
  const pool = getEvoPool();
  const remoteJid = phoneToRemoteJid(contactPhone);

  const result = await pool.query(`
    SELECT
      "key"->>'fromMe' as from_me,
      "messageTimestamp" as timestamp,
      "message" as message_data
    FROM "Message"
    WHERE "instanceId" = (SELECT id FROM "Instance" WHERE name = $1)
      AND "key"->>'remoteJid' = $2
    ORDER BY "messageTimestamp" DESC
    LIMIT 1
  `, [instanceName, remoteJid]);

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const msgData = row.message_data;
  let text: string | null = null;

  if (msgData?.conversation) text = msgData.conversation;
  else if (msgData?.extendedTextMessage?.text) text = msgData.extendedTextMessage.text;
  else if (msgData?.imageMessage?.caption) text = msgData.imageMessage.caption;
  else if (msgData?.audioMessage) text = '[Голосовое сообщение]';

  return {
    fromMe: row.from_me === 'true',
    timestamp: parseInt(row.timestamp, 10),
    text,
  };
}

/**
 * Получить количество сообщений в Evolution DB для контакта после определённого timestamp.
 */
async function countEvoMessagesAfter(instanceName: string, contactPhone: string, afterTimestamp: number): Promise<number> {
  const pool = getEvoPool();
  const remoteJid = phoneToRemoteJid(contactPhone);

  const result = await pool.query(`
    SELECT COUNT(*) as cnt FROM "Message"
    WHERE "instanceId" = (SELECT id FROM "Instance" WHERE name = $1)
      AND "key"->>'remoteJid' = $2
      AND "key"->>'fromMe' = 'false'
      AND "messageTimestamp" >= $3
  `, [instanceName, remoteJid, afterTimestamp]);

  return parseInt(result.rows[0]?.cnt || '0', 10);
}

// ─── Accounts ───

async function getWwebjsAccounts(): Promise<WwebjsAccount[]> {
  const db = getSupabase();

  const { data: accounts, error: accErr } = await db
    .from('user_accounts')
    .select('id')
    .not('wwebjs_label_id', 'is', null);

  if (accErr || !accounts?.length) {
    if (accErr) log.error({ error: accErr.message }, 'Failed to fetch wwebjs accounts');
    return [];
  }

  const accountIds = accounts.map((a: any) => a.id);

  const { data: numbers, error: numErr } = await db
    .from('whatsapp_phone_numbers')
    .select('user_account_id, instance_name, connection_type')
    .in('user_account_id', accountIds)
    .not('instance_name', 'is', null)
    .eq('connection_status', 'connected');

  if (numErr) {
    log.error({ error: numErr.message }, 'Failed to fetch phone numbers');
    return [];
  }

  const accountMap = new Map<string, string[]>();
  for (const num of (numbers || [])) {
    if (num.connection_type === 'waba') continue;
    const list = accountMap.get(num.user_account_id) || [];
    list.push(num.instance_name);
    accountMap.set(num.user_account_id, list);
  }

  return Array.from(accountMap.entries()).map(([id, instanceNames]) => ({
    id,
    instanceNames,
  }));
}

// ─── Push to chatbot ───

async function pushToChatbot(instanceName: string, contactPhone: string, messageText: string): Promise<boolean> {
  try {
    const res = await fetch(`${CHATBOT_SERVICE_URL}/process-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactPhone,
        instanceName,
        messageText,
        messageType: 'text',
      }),
    });

    const result = await res.json();

    if (result.success) {
      log.info({ instanceName, contactPhone }, 'Missed message pushed to chatbot');
      return true;
    } else {
      log.warn({ instanceName, contactPhone, reason: result.reason }, 'Chatbot rejected message');
      return false;
    }
  } catch (err: any) {
    log.error({ instanceName, contactPhone, err: err.message }, 'Failed to push to chatbot');
    return false;
  }
}

// ─── Main recovery logic ───

/**
 * Обработать пропущенные сообщения для одного аккаунта.
 *
 * Два типа пропусков:
 *
 * 1) ПОЛНЫЙ ПРОПУСК: чат есть в wwebjs, но в Evolution DB нет ни одного сообщения
 *    от этого контакта → первое сообщение не дошло вообще.
 *    Действие: берём сообщения из wwebjs, пушим в chatbot.
 *
 * 2) ПРОПУСК В ДИАЛОГЕ: чат есть и в wwebjs, и в Evolution, но последнее
 *    сообщение в wwebjs от клиента, а в Evolution последнее — от бота (или
 *    клиентских сообщений после определённого timestamp в Evolution меньше чем в wwebjs).
 *    Действие: берём недостающие сообщения из wwebjs, пушим в chatbot.
 */
async function recoverAccountMessages(account: WwebjsAccount): Promise<number> {
  let session;
  try {
    session = await initSession(account.id);
  } catch (err: any) {
    log.error({ userAccountId: account.id, err: err.message }, 'Failed to init session');
    return 0;
  }

  if (!session.ready) {
    log.warn({ userAccountId: account.id }, 'Session not ready — skipping');
    await destroySession(account.id);
    return 0;
  }

  const cutoffTimestamp = Math.floor(Date.now() / 1000) - (MAX_MESSAGE_AGE_HOURS * 3600);
  let recoveredCount = 0;

  try {
    const chats = await session.client.getChats();

    // Только личные чаты (не группы), у которых есть недавняя активность
    const recentChats = chats.filter((chat: any) => {
      if (chat.isGroup) return false;
      // Есть хоть какая-то активность в окне проверки
      if (chat.timestamp && chat.timestamp < cutoffTimestamp) return false;
      return true;
    });

    log.info({ userAccountId: account.id, totalChats: chats.length, recentChats: recentChats.length }, 'Scanning chats');

    for (const chat of recentChats) {
      try {
        const contactPhone = chatIdToPhone(chat.id._serialized);

        // Пропускаем служебные чаты (status, broadcast и т.д.)
        if (contactPhone === 'status' || chat.id._serialized.includes('@broadcast') || chat.id._serialized.includes('@g.us')) {
          continue;
        }

        // Получаем последние сообщения из wwebjs
        const wwebjsMessages = await chat.fetchMessages({ limit: 10 });

        // Находим последние входящие (от клиента) сообщения в окне
        const recentIncoming = wwebjsMessages
          .filter((m: any) => !m.fromMe && m.timestamp >= cutoffTimestamp)
          .sort((a: any, b: any) => a.timestamp - b.timestamp); // хронологический порядок

        if (recentIncoming.length === 0) continue;

        // Берём instance_name (первый подключённый для этого аккаунта)
        const instanceName = account.instanceNames[0];

        // ─── Тип 1: Полный пропуск ───
        const hasEvo = await hasEvolutionMessages(instanceName, contactPhone);

        if (!hasEvo) {
          // Evolution вообще не знает об этом контакте — первое сообщение не дошло

          // Извлекаем ad-атрибуцию из сообщений (ctwaContext / URL / unattributed)
          const attribution = extractAdAttribution(recentIncoming);
          if (attribution.pattern === 'none') {
            // full_miss + нет метаданных = вероятно с рекламы, но неопознано
            attribution.pattern = 'unattributed';
          }

          const texts = recentIncoming
            .map((m: any) => extractMessageText(m))
            .filter(Boolean);

          if (texts.length === 0) continue;

          const combinedText = texts.join('\n');

          log.info({
            type: 'full_miss',
            contactPhone,
            instanceName,
            messageCount: texts.length,
            preview: combinedText.substring(0, 100),
          }, 'Recovering fully missed conversation');

          const pushed = await pushToChatbot(instanceName, contactPhone, combinedText);
          if (pushed) {
            recoveredCount++;
            // Обновляем атрибуцию лида (async, не блокирует recovery)
            updateLeadAttribution(contactPhone, account.id, attribution).catch((err: any) => {
              log.error({ contactPhone, err: err.message }, 'Failed to update lead attribution');
            });
          }

          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        // ─── Тип 2: Пропуск в диалоге ───
        const lastEvo = await getLastEvoMessage(instanceName, contactPhone);

        if (!lastEvo) continue; // не должно произойти после hasEvo=true, но на всякий случай

        // Если последнее сообщение в Evolution от бота (fromMe=true),
        // проверяем — есть ли в wwebjs более новые входящие от клиента
        // которых нет в Evolution
        const lastEvoTimestamp = lastEvo.timestamp;

        // Входящие сообщения в wwebjs ПОСЛЕ последнего сообщения в Evolution
        const missedIncoming = recentIncoming.filter((m: any) => m.timestamp > lastEvoTimestamp);

        if (missedIncoming.length === 0) continue;

        // Сверяем количество: сколько входящих в Evolution после lastEvoTimestamp
        const evoIncomingAfter = await countEvoMessagesAfter(instanceName, contactPhone, lastEvoTimestamp);

        if (evoIncomingAfter >= missedIncoming.length) {
          // Evolution получил все сообщения — бот просто не ответил по своим правилам
          continue;
        }

        // Есть пропущенные сообщения — берём те, что Evolution не видел
        const missingMessages = missedIncoming.slice(evoIncomingAfter);

        // Извлекаем ad-атрибуцию (без unattributed fallback — контакт уже общается)
        const dialogAttribution = extractAdAttribution(missingMessages);

        const texts = missingMessages
          .map((m: any) => extractMessageText(m))
          .filter(Boolean);

        if (texts.length === 0) continue;

        const combinedText = texts.join('\n');

        log.info({
          type: 'dialog_miss',
          contactPhone,
          instanceName,
          evoIncomingAfter,
          wwebjsIncoming: missedIncoming.length,
          missingCount: texts.length,
          preview: combinedText.substring(0, 100),
        }, 'Recovering missed messages in ongoing dialog');

        const pushed = await pushToChatbot(instanceName, contactPhone, combinedText);
        if (pushed) {
          recoveredCount++;
          // Обновляем атрибуцию если найдены ad-метаданные (не unattributed для dialog_miss)
          if (dialogAttribution.pattern !== 'none') {
            updateLeadAttribution(contactPhone, account.id, dialogAttribution).catch((err: any) => {
              log.error({ contactPhone, err: err.message }, 'Failed to update lead attribution (dialog_miss)');
            });
          }
        }

        await new Promise(r => setTimeout(r, 2000));
      } catch (err: any) {
        log.error({ chatId: chat.id._serialized, err: err.message }, 'Failed to process chat');
      }
    }
  } catch (err: any) {
    log.error({ userAccountId: account.id, err: err.message }, 'Failed to get chats');
  }

  await destroySession(account.id);
  return recoveredCount;
}

// ─── Exports ───

export async function runMissedMessagesRecovery(): Promise<void> {
  if (!process.env.EVOLUTION_DB_PASSWORD) {
    log.warn('EVOLUTION_DB_PASSWORD not set — missed messages recovery disabled');
    return;
  }

  log.info('Starting missed messages recovery');

  const accounts = await getWwebjsAccounts();
  if (accounts.length === 0) {
    log.info('No wwebjs-enabled accounts found');
    return;
  }

  log.info({ accountCount: accounts.length }, 'Checking accounts for missed messages');

  let totalRecovered = 0;
  for (const account of accounts) {
    try {
      const count = await recoverAccountMessages(account);
      totalRecovered += count;
    } catch (err: any) {
      log.error({ userAccountId: account.id, err: err.message }, 'Account recovery failed');
      await destroySession(account.id).catch(() => {});
    }
  }

  log.info({ totalRecovered, accountCount: accounts.length }, 'Missed messages recovery finished');
}

export async function recoverSingleAccount(userAccountId: string): Promise<{ recovered: number }> {
  if (!process.env.EVOLUTION_DB_PASSWORD) {
    throw new Error('EVOLUTION_DB_PASSWORD not set');
  }

  const db = getSupabase();

  const { data: account } = await db
    .from('user_accounts')
    .select('id, wwebjs_label_id')
    .eq('id', userAccountId)
    .single();

  if (!account?.wwebjs_label_id) {
    throw new Error('Account not configured for wwebjs');
  }

  const { data: numbers } = await db
    .from('whatsapp_phone_numbers')
    .select('instance_name, connection_type')
    .eq('user_account_id', userAccountId)
    .not('instance_name', 'is', null)
    .eq('connection_status', 'connected');

  const instanceNames = (numbers || [])
    .filter((n: any) => n.instance_name && n.connection_type !== 'waba')
    .map((n: any) => n.instance_name);

  if (instanceNames.length === 0) {
    throw new Error('No connected Evolution instances found');
  }

  const recovered = await recoverAccountMessages({ id: userAccountId, instanceNames });
  return { recovered };
}
