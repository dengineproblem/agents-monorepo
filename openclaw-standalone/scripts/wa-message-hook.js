#!/usr/bin/env node
/**
 * wa-message-hook.js — OpenClaw message:received hook
 *
 * Выполняется ДО агента при каждом входящем WhatsApp сообщении.
 * Парсит Baileys JSON, извлекает source_id/ctwa_clid,
 * резолвит через ad_creative_mapping, пишет в wa_dialogs + leads.
 *
 * Вход: JSON сообщения через stdin (OpenClaw hook protocol)
 * Выход: exit 0 (продолжить обработку агентом)
 */

const { execSync } = require('child_process');

const DB_URL = process.env.OPENCLAW_DB_URL;

// Structured logging — stderr to avoid interfering with OpenClaw hook protocol on stdout
function log(level, msg, data = {}) {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    src: 'wa-hook',
    msg,
    ...data
  });
  console.error(entry);
}

if (!DB_URL) {
  log('warn', 'OPENCLAW_DB_URL not set, skipping');
  process.exit(0);
}

// --- Helpers ---

function psql(query, params = []) {
  // Single-pass regex replacement — safe against $N patterns inside substituted values
  const sql = query.replace(/\$(\d+)/g, (match, num) => {
    const idx = parseInt(num, 10) - 1;
    if (idx < 0 || idx >= params.length) return match;
    const val = params[idx];
    return val === null || val === undefined
      ? 'NULL'
      : `'${String(val).replace(/'/g, "''")}'`;
  });

  try {
    const result = execSync(
      `psql "${DB_URL}" -t -A -c ${JSON.stringify(sql)}`,
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return result.trim();
  } catch (err) {
    log('error', 'psql error', { error: err.message, sql: sql.slice(0, 200) });
    return null;
  }
}

function psqlRow(query, params = []) {
  const result = psql(query, params);
  if (!result) return null;
  return result.split('|');
}

// --- Extract metadata from Baileys message ---

function extractSourceId(msg) {
  const candidates = [
    msg?.contextInfo?.referral?.sourceId,
    msg?.contextInfo?.referral?.source_id,
    msg?.contextInfo?.externalAdReply?.sourceId,
    msg?.contextInfo?.externalAdReply?.source_id,
    msg?.message?.extendedTextMessage?.contextInfo?.referral?.sourceId,
    msg?.message?.extendedTextMessage?.contextInfo?.externalAdReply?.sourceId,
    msg?.referral?.sourceId,
    msg?.referral?.source_id,
  ];

  for (const val of candidates) {
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

function extractCtwaClid(msg) {
  const contextInfo = msg?.contextInfo
    || msg?.message?.extendedTextMessage?.contextInfo
    || msg?.message?.contextInfo;
  const referral = contextInfo?.referral || msg?.referral;
  const externalAdReply = contextInfo?.externalAdReply;
  const conversationContext = msg?.conversationContext || contextInfo?.conversationContext;
  const referredProductPromotion = msg?.referredProductPromotion;

  const candidates = [
    referral?.ctwaClid,
    referral?.ctwa_clid,
    conversationContext?.ctwaClid,
    conversationContext?.referralCtwaClid,
    referredProductPromotion?.ctwaClid,
    referredProductPromotion?.ctwa_clid,
    contextInfo?.ctwaClid,
    externalAdReply?.ctwaClid,
    msg?.ctwaClid,
    msg?.ctwa_clid,
  ];

  for (const val of candidates) {
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

function extractPhone(msg) {
  // remoteJid: "77001234567@s.whatsapp.net" or "lid_id@lid"
  const jid = msg?.key?.remoteJid || msg?.remoteJid || '';
  const jidAlt = msg?.key?.remoteJidAlt || msg?.remoteJidAlt || '';

  let phone = jid;

  // @lid номера — использовать альтернативный jid для реального номера
  if (jid.endsWith('@lid') && jidAlt) {
    phone = jidAlt;
  }

  return phone
    .replace('@s.whatsapp.net', '')
    .replace('@c.us', '')
    .replace('@lid', '')
    .trim();
}

function extractName(msg) {
  return msg?.pushName
    || msg?.verifiedBizName
    || msg?.contactName
    || null;
}

function isIncoming(msg) {
  return !msg?.key?.fromMe;
}

// --- Main ---

async function main() {
  // Read JSON from stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let msg;
  try {
    msg = JSON.parse(input);
  } catch {
    // Not JSON or empty — skip silently
    process.exit(0);
  }

  // Only process incoming messages
  if (!isIncoming(msg)) {
    process.exit(0);
  }

  const phone = extractPhone(msg);
  if (!phone || phone.length < 5) {
    log('warn', 'Invalid phone', { raw: msg?.key?.remoteJid });
    process.exit(0);
  }

  const name = extractName(msg);
  const sourceId = extractSourceId(msg);
  const ctwaClid = extractCtwaClid(msg);

  log('info', 'Processing message', {
    phone, name, sourceId: sourceId || null, hasCtwaClid: !!ctwaClid
  });

  // 1. UPSERT wa_dialogs
  const upsertResult = psql(`
    INSERT INTO wa_dialogs (phone, name, incoming_count, capi_msg_count, last_message, ctwa_clid, source_id)
    VALUES ($1, $2, 1, 1, NOW(), $3, $4)
    ON CONFLICT (phone) DO UPDATE SET
      incoming_count = wa_dialogs.incoming_count + 1,
      capi_msg_count = wa_dialogs.capi_msg_count + 1,
      last_message = NOW(),
      ctwa_clid = COALESCE(EXCLUDED.ctwa_clid, wa_dialogs.ctwa_clid),
      source_id = COALESCE(EXCLUDED.source_id, wa_dialogs.source_id),
      name = COALESCE(EXCLUDED.name, wa_dialogs.name),
      updated_at = NOW()
  `, [phone, name, ctwaClid, sourceId]);

  log('info', 'Dialog upserted', { phone, success: upsertResult !== null });

  // 2. Resolve ad_creative_mapping if source_id present
  let creativeId = null;
  let directionId = null;

  if (sourceId) {
    const row = psqlRow(
      `SELECT creative_id, direction_id FROM ad_creative_mapping WHERE ad_id = $1 LIMIT 1`,
      [sourceId]
    );

    if (row && row.length >= 2 && row[0]) {
      creativeId = row[0];
      directionId = row[1] || null;

      // Update wa_dialogs with resolved creative/direction
      psql(`
        UPDATE wa_dialogs
        SET creative_id = $1, direction_id = $2, updated_at = NOW()
        WHERE phone = $3 AND creative_id IS NULL
      `, [creativeId, directionId, phone]);

      log('info', 'Ad mapping resolved', { phone, sourceId, creativeId, directionId });
    } else {
      log('warn', 'No ad_creative_mapping found', { phone, sourceId });
    }
  }

  // 3. Create/update lead if ad attribution data present
  if (sourceId || ctwaClid) {
    psql(`
      INSERT INTO leads (phone, name, ad_id, ctwa_clid, chat_id, source_type, creative_id, direction_id, conversion_source)
      VALUES ($1, $2, $3, $4, $5, 'whatsapp', $6, $7, 'whatsapp_baileys')
      ON CONFLICT (chat_id) WHERE source_type = 'whatsapp' AND chat_id IS NOT NULL
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, leads.name),
        ad_id = COALESCE(EXCLUDED.ad_id, leads.ad_id),
        ctwa_clid = COALESCE(EXCLUDED.ctwa_clid, leads.ctwa_clid),
        creative_id = COALESCE(EXCLUDED.creative_id, leads.creative_id),
        direction_id = COALESCE(EXCLUDED.direction_id, leads.direction_id),
        updated_at = NOW()
    `, [phone, name, sourceId, ctwaClid, phone, creativeId, directionId]);

    log('info', 'Lead upserted', { phone, sourceId, hasCtwaClid: !!ctwaClid });
  }

  log('info', 'Hook completed', {
    phone, sourceId: sourceId || '-',
    ctwaClid: ctwaClid ? 'yes' : '-',
    creative: creativeId || '-'
  });
  process.exit(0);
}

main().catch(err => {
  log('error', 'Hook fatal error', { error: err.message });
  process.exit(0); // Don't block agent on hook errors
});
