import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import pg from 'pg';
import Anthropic from '@anthropic-ai/sdk';

const { Pool } = pg;

// ============================================
// Structured Logging
// ============================================

function log(level, component, msg, data = {}) {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    src: component,
    msg,
    ...data
  });
  if (level === 'error') console.error(entry);
  else console.log(entry);
}

// ============================================
// Configuration
// ============================================

const VERIFY_TOKEN = process.env.FB_WEBHOOK_VERIFY_TOKEN || 'openclaw_leadgen_2026';
const PG_HOST = process.env.PG_HOST || 'postgres';
const PG_USER = process.env.PG_USER || 'postgres';
const PG_PASSWORD = process.env.PG_PASSWORD || 'openclaw_local';
const PG_PORT = process.env.PG_PORT || 5432;

// WABA
const WABA_VERIFY_TOKEN = process.env.WABA_VERIFY_TOKEN || 'openclaw_waba_2026';
const WABA_APP_SECRET = process.env.WABA_APP_SECRET || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20250315';
const META_GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v23.0';

const MAX_BODY_SIZE = 1024 * 1024;        // 1 MB request body limit
const CLAUDE_TIMEOUT_MS = 30_000;          // 30s timeout for Claude API
const WHATSAPP_MAX_TEXT_LENGTH = 4096;     // WhatsApp text message limit

const DEFAULT_BOT_PROMPT = `Ты — вежливый ассистент компании. Отвечай кратко и по делу на русском языке.
Если клиент спрашивает о услугах, ценах или записи — помоги ему.
Не придумывай информацию, которой у тебя нет.
Максимальная длина ответа — 3-4 предложения.`;

// ============================================
// Connection Pools
// ============================================

// Per-tenant connection pool cache
const pools = new Map();

function getPool(slug) {
  if (pools.has(slug)) return pools.get(slug);
  const pool = new Pool({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: `openclaw_${slug}`,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err) => {
    log('error', 'pool', `Unexpected pool error for ${slug}`, { error: err.message });
  });
  pools.set(slug, pool);
  return pool;
}

// Shared DB pool (for waba_phone_mapping)
const sharedPool = new Pool({
  host: PG_HOST,
  port: PG_PORT,
  user: PG_USER,
  password: PG_PASSWORD,
  database: 'openclaw',
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

sharedPool.on('error', (err) => {
  log('error', 'shared-pool', 'Unexpected shared pool error', { error: err.message });
});

// Claude API client
const anthropic = ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  : null;

// ============================================
// WABA Deduplication
// ============================================

const processedWabaMessages = new Map();
const WABA_DEDUP_TTL_MS = 10 * 60 * 1000; // 10 minutes

function isDuplicateWabaMessage(messageId) {
  const now = Date.now();

  // Clean expired entries
  for (const [id, ts] of processedWabaMessages.entries()) {
    if (now - ts > WABA_DEDUP_TTL_MS) processedWabaMessages.delete(id);
  }

  if (processedWabaMessages.has(messageId)) return true;
  processedWabaMessages.set(messageId, now);
  return false;
}

// ============================================
// WABA Utilities (ported from wabaHelpers.ts)
// ============================================

function verifyWabaSignature(rawBody, signature, appSecret) {
  if (!signature || !appSecret || !rawBody) return false;

  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = crypto.createHmac('sha256', appSecret).update(body).digest('hex');
  const provided = signature.replace('sha256=', '');

  if (expected.length !== provided.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(provided, 'hex')
    );
  } catch {
    return false;
  }
}

function normalizeWabaPhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

function extractWabaMessageText(message) {
  switch (message.type) {
    case 'text':
      return message.text?.body || '';
    case 'button':
      return message.button?.text || '';
    case 'interactive':
      return message.interactive?.button_reply?.title ||
             message.interactive?.list_reply?.title || '';
    default:
      return '';
  }
}

function hasAdReferral(message) {
  return !!(message.referral?.source_id);
}

// ============================================
// Lead Gen Utilities (existing)
// ============================================

function parseSlug(pathname) {
  const match = pathname.match(/^\/webhook\/([a-z0-9_-]+)$/i);
  return match ? match[1].toLowerCase() : null;
}

function extractField(fields, names) {
  for (const n of names) {
    const f = fields.find(x => x.name.toLowerCase() === n.toLowerCase());
    if (f?.values?.[0]) return f.values[0];
  }
  return null;
}

function normalizePhone(phone) {
  if (!phone) return null;
  let n = phone.replace(/[^\d+]/g, '');
  if (n.startsWith('8') && n.length === 11) n = '7' + n.slice(1);
  return n;
}

async function notifyTelegram(pool, slug, name, phone) {
  try {
    const { rows: [cfg] } = await pool.query('SELECT telegram_bot_token, telegram_chat_id FROM config WHERE id = 1');
    if (!cfg?.telegram_bot_token || !cfg?.telegram_chat_id) return;
    const text = `🔔 Новый лид с Facebook\n👤 ${name || '—'}\n📞 ${phone || '—'}\n⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}`;
    const resp = await fetch(`https://api.telegram.org/bot${cfg.telegram_bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.telegram_chat_id, text })
    });
    if (!resp.ok) {
      log('warn', 'telegram', 'Notification failed', { slug, status: resp.status });
    }
  } catch (err) {
    log('error', 'telegram', 'Notification error', { slug, error: err.message });
  }
}

async function handleLeadgen(pool, slug, leadgenId, adId, formId) {
  log('info', 'leadgen', 'Processing lead', { slug, leadgenId, adId, formId });

  const { rows: [cfg] } = await pool.query('SELECT fb_page_access_token, fb_access_token FROM config WHERE id = 1');
  const token = cfg?.fb_page_access_token || cfg?.fb_access_token;
  if (!token) {
    log('error', 'leadgen', 'No FB access token in config', { slug });
    return;
  }

  const { rows: dup } = await pool.query('SELECT id FROM leads WHERE leadgen_id = $1', [leadgenId]);
  if (dup.length > 0) {
    log('info', 'leadgen', 'Duplicate lead, skipping', { slug, leadgenId });
    return;
  }

  const res = await fetch(`https://graph.facebook.com/v23.0/${leadgenId}?fields=id,ad_id,form_id,created_time,field_data&access_token=${token}`);
  const data = await res.json();
  if (!res.ok || data.error) {
    log('error', 'leadgen', 'FB API error', { slug, leadgenId, error: data.error?.message, status: res.status });
    return;
  }

  const fields = data.field_data || [];
  const name = extractField(fields, ['full_name', 'name', 'first_name', 'имя', 'фио']);
  const phone = normalizePhone(extractField(fields, ['phone_number', 'phone', 'телефон', 'номер_телефона']));
  const email = extractField(fields, ['email', 'email_address', 'почта']);

  await pool.query(
    `INSERT INTO leads (name, phone, email, leadgen_id, ad_id, form_id, source_type, utm_source)
     VALUES ($1, $2, $3, $4, $5, $6, 'lead_form', 'facebook_lead_form')
     ON CONFLICT (leadgen_id) DO NOTHING`,
    [name, phone, email, leadgenId, adId || data.ad_id, formId || data.form_id]
  );

  notifyTelegram(pool, slug, name, phone);
  log('info', 'leadgen', 'Lead saved', { slug, name, phone, leadgenId });
}

// ============================================
// WABA Message Processing
// ============================================

async function processWabaMessage(pool, slug, wabaPhoneId, accessToken, message, contactName) {
  const messageId = message.id;
  if (!messageId || isDuplicateWabaMessage(messageId)) {
    log('info', 'waba', 'Duplicate or no-id message, skipping', { slug, messageId });
    return;
  }

  const clientPhone = normalizeWabaPhone(message.from);
  if (!clientPhone || clientPhone.length < 5) {
    log('warn', 'waba', 'Invalid phone number', { slug, raw: message.from, normalized: clientPhone });
    return;
  }

  const messageText = extractWabaMessageText(message).trim();
  const isAdLead = hasAdReferral(message);
  const timestampRaw = parseInt(message.timestamp, 10);
  const timestamp = Number.isFinite(timestampRaw) && timestampRaw > 0
    ? new Date(timestampRaw * 1000)
    : new Date();

  log('info', 'waba', 'Incoming message', {
    slug, phone: clientPhone, type: message.type,
    isAd: isAdLead, textLen: messageText.length, messageId
  });

  // 1. UPSERT wa_dialogs
  await pool.query(`
    INSERT INTO wa_dialogs (phone, name, incoming_count, capi_msg_count, first_message, last_message, waba_window_expires_at, updated_at)
    VALUES ($1, $2, 1, 1, $3, $3, $3 + INTERVAL '24 hours', NOW())
    ON CONFLICT (phone) DO UPDATE SET
      name = COALESCE(wa_dialogs.name, EXCLUDED.name),
      incoming_count = wa_dialogs.incoming_count + 1,
      capi_msg_count = wa_dialogs.capi_msg_count + 1,
      last_message = EXCLUDED.last_message,
      waba_window_expires_at = EXCLUDED.last_message + INTERVAL '24 hours',
      updated_at = NOW()
  `, [clientPhone, contactName || null, timestamp]);

  log('info', 'waba', 'Dialog upserted', { slug, phone: clientPhone });

  // 2. INSERT wa_messages (inbound)
  await pool.query(`
    INSERT INTO wa_messages (phone, direction, channel, message_text, message_type, waba_message_id, metadata)
    VALUES ($1, 'inbound', 'waba', $2, $3, $4, $5)
  `, [
    clientPhone,
    messageText || null,
    message.type || 'text',
    messageId,
    isAdLead ? JSON.stringify(message.referral) : null
  ]);

  log('info', 'waba', 'Inbound message logged', { slug, phone: clientPhone, messageId });

  // 3. Ad attribution
  if (isAdLead) {
    const sourceId = message.referral.source_id;
    const ctwaClid = message.referral.ctwa_clid || null;

    log('info', 'waba', 'Processing ad attribution', { slug, phone: clientPhone, sourceId, hasCtwaClid: !!ctwaClid });

    // Resolve creative/direction via ad_creative_mapping
    const { rows: [mapping] } = await pool.query(
      'SELECT creative_id, direction_id FROM ad_creative_mapping WHERE ad_id = $1 LIMIT 1',
      [sourceId]
    );
    const creativeId = mapping?.creative_id || null;
    const directionId = mapping?.direction_id || null;

    if (mapping) {
      log('info', 'waba', 'Ad mapping resolved', { slug, sourceId, creativeId, directionId });
    } else {
      log('warn', 'waba', 'No ad_creative_mapping found', { slug, sourceId });
    }

    // Update wa_dialogs with attribution
    await pool.query(`
      UPDATE wa_dialogs SET
        source_id = COALESCE(wa_dialogs.source_id, $2),
        ctwa_clid = COALESCE(wa_dialogs.ctwa_clid, $3),
        creative_id = COALESCE(wa_dialogs.creative_id, $4),
        direction_id = COALESCE(wa_dialogs.direction_id, $5),
        updated_at = NOW()
      WHERE phone = $1
    `, [clientPhone, sourceId, ctwaClid, creativeId, directionId]);

    // Create/update lead — deduplicate by chat_id for WhatsApp
    await pool.query(`
      INSERT INTO leads (phone, name, ad_id, ctwa_clid, chat_id, source_type, creative_id, direction_id, conversion_source)
      VALUES ($1, $2, $3, $4, $1, 'whatsapp', $5, $6, 'WABA')
      ON CONFLICT (chat_id) WHERE source_type = 'whatsapp' AND chat_id IS NOT NULL
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, leads.name),
        ad_id = COALESCE(EXCLUDED.ad_id, leads.ad_id),
        ctwa_clid = COALESCE(EXCLUDED.ctwa_clid, leads.ctwa_clid),
        creative_id = COALESCE(EXCLUDED.creative_id, leads.creative_id),
        direction_id = COALESCE(EXCLUDED.direction_id, leads.direction_id),
        updated_at = NOW()
    `, [clientPhone, contactName || null, sourceId, ctwaClid, creativeId, directionId]);

    notifyTelegram(pool, slug, contactName || clientPhone, clientPhone);
    log('info', 'waba', 'Ad lead processed', { slug, phone: clientPhone, sourceId });
  }

  // 4. Skip bot if no text (image/video/sticker without text)
  if (!messageText && message.type !== 'audio') {
    log('info', 'waba', 'No text content, skipping bot', { slug, phone: clientPhone, type: message.type });
    return;
  }

  // 5. Call Claude API for auto-response
  if (!anthropic) {
    log('warn', 'waba', 'ANTHROPIC_API_KEY not set, skipping auto-response', { slug });
    return;
  }

  try {
    // Build conversation context from wa_messages
    const { rows: history } = await pool.query(`
      SELECT direction, message_text FROM wa_messages
      WHERE phone = $1 AND message_text IS NOT NULL
      ORDER BY created_at DESC LIMIT 20
    `, [clientPhone]);

    const messages = history.reverse().map(r => ({
      role: r.direction === 'inbound' ? 'user' : 'assistant',
      content: r.message_text
    }));

    // Get system prompt from config
    const { rows: [cfg] } = await pool.query(
      'SELECT waba_bot_system_prompt FROM config WHERE id = 1'
    );
    const systemPrompt = cfg?.waba_bot_system_prompt || DEFAULT_BOT_PROMPT;

    log('info', 'waba-bot', 'Calling Claude API', {
      slug, phone: clientPhone, model: ANTHROPIC_MODEL, historyLen: messages.length
    });

    // Call Claude with timeout
    const claudePromise = anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 500,
      system: systemPrompt,
      messages
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Claude API timeout after ${CLAUDE_TIMEOUT_MS}ms`)), CLAUDE_TIMEOUT_MS)
    );

    const response = await Promise.race([claudePromise, timeoutPromise]);

    const replyText = response.content?.[0]?.text;
    if (!replyText) {
      log('warn', 'waba-bot', 'Empty Claude response', { slug, phone: clientPhone });
      return;
    }

    // Truncate to WhatsApp limit
    const truncatedReply = replyText.length > WHATSAPP_MAX_TEXT_LENGTH
      ? replyText.slice(0, WHATSAPP_MAX_TEXT_LENGTH - 3) + '...'
      : replyText;

    if (replyText.length > WHATSAPP_MAX_TEXT_LENGTH) {
      log('warn', 'waba-bot', 'Reply truncated to WhatsApp limit', {
        slug, phone: clientPhone, originalLen: replyText.length, truncatedLen: truncatedReply.length
      });
    }

    log('info', 'waba-bot', 'Claude response received', {
      slug, phone: clientPhone, replyLen: truncatedReply.length,
      inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens
    });

    // 6. Send reply via Meta Cloud API
    const sent = await sendWabaMessage(slug, wabaPhoneId, accessToken, clientPhone, truncatedReply);
    if (!sent) return;

    // 7. INSERT wa_messages (outbound)
    await pool.query(`
      INSERT INTO wa_messages (phone, direction, channel, message_text, message_type, waba_message_id)
      VALUES ($1, 'outbound', 'waba', $2, 'text', $3)
    `, [clientPhone, truncatedReply, sent.messageId || null]);

    // 8. Update wa_dialogs outgoing_count
    await pool.query(`
      UPDATE wa_dialogs SET outgoing_count = outgoing_count + 1, updated_at = NOW()
      WHERE phone = $1
    `, [clientPhone]);

    log('info', 'waba', 'Reply sent and logged', {
      slug, phone: clientPhone, wabaMessageId: sent.messageId, replyLen: truncatedReply.length
    });

  } catch (err) {
    log('error', 'waba-bot', 'Bot error', { slug, phone: clientPhone, error: err.message });
  }

  // 9. CAPI L1 threshold check
  await checkCapiThreshold(pool, slug, clientPhone);
}

// ============================================
// Meta Cloud API: Send Message
// ============================================

async function sendWabaMessage(slug, wabaPhoneId, accessToken, to, text) {
  // Strip + prefix — WABA API expects digits only
  const toDigits = to.replace(/^\+/, '');

  log('info', 'waba-send', 'Sending message', { slug, to, textLen: text.length });

  try {
    const res = await fetch(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${wabaPhoneId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: toDigits,
          type: 'text',
          text: { body: text }
        })
      }
    );

    if (!res.ok) {
      const errorText = await res.text();
      log('error', 'waba-send', 'Meta API error', {
        slug, to, status: res.status, response: errorText.slice(0, 500)
      });
      return null;
    }

    const data = await res.json();
    const messageId = data.messages?.[0]?.id || null;
    log('info', 'waba-send', 'Message delivered', { slug, to, wabaMessageId: messageId });
    return { messageId };
  } catch (err) {
    log('error', 'waba-send', 'Send error', { slug, to, error: err.message });
    return null;
  }
}

// ============================================
// CAPI L1 Threshold Check (JS port of send-capi.sh logic)
// ============================================

async function checkCapiThreshold(pool, slug, phone) {
  try {
    // Check if CAPI is configured
    const { rows: [capi] } = await pool.query(
      'SELECT pixel_id, access_token, l1_event_name, l1_threshold FROM capi_settings WHERE is_active = true LIMIT 1'
    );
    if (!capi) return;

    // Check dialog state
    const { rows: [dialog] } = await pool.query(
      'SELECT capi_msg_count, l1_sent, ctwa_clid, source_id FROM wa_dialogs WHERE phone = $1',
      [phone]
    );
    if (!dialog || dialog.l1_sent || dialog.capi_msg_count < capi.l1_threshold) return;

    log('info', 'capi', 'L1 threshold reached, sending event', {
      slug, phone, msgCount: dialog.capi_msg_count, threshold: capi.l1_threshold
    });

    // Hash phone for CAPI
    const phoneDigits = phone.replace(/\D/g, '');
    const hashedPhone = crypto.createHash('sha256').update(phoneDigits).digest('hex');
    const eventId = crypto.randomUUID();

    // Build CAPI payload
    const eventData = {
      event_name: capi.l1_event_name || 'LeadSubmitted',
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: dialog.ctwa_clid ? 'messaging' : 'website',
      user_data: {
        ph: [hashedPhone]
      }
    };

    if (dialog.ctwa_clid) {
      eventData.messaging_channel = 'whatsapp';
      eventData.user_data.ctwa_clid = dialog.ctwa_clid;
    }

    // Send CAPI event
    const res = await fetch(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${capi.pixel_id}/events?access_token=${capi.access_token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [eventData] })
      }
    );

    const responseData = await res.json();
    const success = res.ok && responseData.events_received > 0;

    // Log CAPI event
    await pool.query(`
      INSERT INTO capi_events_log (phone, event_name, event_level, ctwa_clid, source_id, pixel_id, event_id, fb_response, status, error_text)
      VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9)
    `, [
      phone,
      capi.l1_event_name || 'LeadSubmitted',
      dialog.ctwa_clid || null,
      dialog.source_id || null,
      capi.pixel_id,
      eventId,
      JSON.stringify(responseData),
      success ? 'success' : 'error',
      success ? null : JSON.stringify(responseData).slice(0, 500)
    ]);

    if (success) {
      await pool.query(
        'UPDATE wa_dialogs SET l1_sent = true, l1_sent_at = NOW(), l1_event_id = $2 WHERE phone = $1',
        [phone, eventId]
      );
      log('info', 'capi', 'L1 event sent successfully', { slug, phone, eventId, pixelId: capi.pixel_id });
    } else {
      log('error', 'capi', 'L1 event failed', {
        slug, phone, eventId, response: JSON.stringify(responseData).slice(0, 300)
      });
    }
  } catch (err) {
    log('error', 'capi', 'CAPI error', { slug, phone, error: err.message });
  }
}

// ============================================
// WABA Webhook Handler
// ============================================

async function handleWabaWebhook(body, rawBody, signature) {
  if (body.object !== 'whatsapp_business_account') {
    log('info', 'waba', 'Ignoring non-WABA webhook', { object: body.object });
    return;
  }

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') {
        log('info', 'waba', 'Ignoring non-messages change', { field: change.field });
        continue;
      }

      const value = change.value;
      if (!value?.messages?.length) {
        // Status updates (sent, delivered, read) — log but skip
        if (value?.statuses?.length) {
          log('info', 'waba', 'Status update received', {
            count: value.statuses.length,
            statuses: value.statuses.map(s => s.status)
          });
        }
        continue;
      }

      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) {
        log('error', 'waba', 'No phone_number_id in metadata');
        continue;
      }

      const contactName = value.contacts?.[0]?.profile?.name;

      // 1. Lookup tenant by phone_number_id
      const { rows: [mapping] } = await sharedPool.query(
        'SELECT slug, waba_app_secret, waba_access_token FROM waba_phone_mapping WHERE waba_phone_id = $1 AND is_active = true',
        [phoneNumberId]
      );

      if (!mapping) {
        log('error', 'waba', 'Unknown phone_number_id', { phoneNumberId });
        continue;
      }

      const { slug, waba_app_secret, waba_access_token } = mapping;

      log('info', 'waba', 'Tenant resolved', {
        phoneNumberId, slug, messagesCount: value.messages.length, contactName
      });

      // 2. Verify signature (per-number secret or global fallback)
      const secret = waba_app_secret || WABA_APP_SECRET;
      if (secret && rawBody && signature) {
        if (!verifyWabaSignature(rawBody, signature, secret)) {
          log('error', 'waba', 'Signature verification failed', { slug, phoneNumberId });
          continue;
        }
        log('info', 'waba', 'Signature verified', { slug });
      } else if (!secret) {
        log('warn', 'waba', 'No app secret configured, skipping signature verification', { slug });
      }

      if (!waba_access_token) {
        log('error', 'waba', 'No access token in waba_phone_mapping', { slug, phoneNumberId });
        continue;
      }

      // 3. Get tenant pool
      let pool;
      try {
        pool = getPool(slug);
        await pool.query('SELECT 1');
      } catch (e) {
        log('error', 'waba', 'DB connection failed', { slug, error: e.message });
        continue;
      }

      // 4. Process each message
      for (const message of value.messages) {
        try {
          await processWabaMessage(pool, slug, phoneNumberId, waba_access_token, message, contactName);
        } catch (err) {
          log('error', 'waba', 'Message processing error', {
            slug, messageId: message.id, error: err.message,
            stack: err.stack?.split('\n').slice(0, 3).join(' | ')
          });
        }
      }
    }
  }
}

// ============================================
// HTTP Helpers
// ============================================

function collectBody(req, maxSize) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        reject(new Error(`Body exceeds ${maxSize} bytes (received ${size})`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ============================================
// HTTP Server
// ============================================

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200);
    return res.end('ok');
  }

  // ============================================
  // WABA Webhooks: /webhooks/waba
  // ============================================
  if (url.pathname === '/webhooks/waba') {
    // GET — Meta webhook verification
    if (req.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token === WABA_VERIFY_TOKEN) {
        log('info', 'waba', 'Webhook verified');
        res.writeHead(200);
        return res.end(challenge);
      }
      log('warn', 'waba', 'Webhook verification failed', { mode, tokenMatch: token === WABA_VERIFY_TOKEN });
      res.writeHead(403);
      return res.end('Forbidden');
    }

    // POST — WABA message processing
    if (req.method === 'POST') {
      let rawBody;
      try {
        rawBody = await collectBody(req, MAX_BODY_SIZE);
      } catch (e) {
        log('error', 'waba', 'Body read error', { error: e.message });
        res.writeHead(200);
        res.end('ok');
        return;
      }

      // Always return 200 to prevent Meta retries
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"success":true}');

      try {
        const body = JSON.parse(rawBody.toString('utf8'));
        const signature = req.headers['x-hub-signature-256'];
        await handleWabaWebhook(body, rawBody, signature);
      } catch (e) {
        log('error', 'waba', 'Webhook processing error', { error: e.message });
      }
      return;
    }

    res.writeHead(405);
    return res.end('Method not allowed');
  }

  // ============================================
  // Lead Gen Webhooks: /webhook/{slug}
  // ============================================
  const slug = parseSlug(url.pathname);
  if (!slug) {
    res.writeHead(404);
    return res.end('Not found. Use /webhook/{slug} or /webhooks/waba');
  }

  let pool;
  try {
    pool = getPool(slug);
    await pool.query('SELECT 1');
  } catch (e) {
    log('error', 'leadgen', 'DB not found for slug', { slug, error: e.message });
    res.writeHead(404);
    return res.end(`Tenant "${slug}" not found`);
  }

  // GET /webhook/{slug} — Facebook verification
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      log('info', 'leadgen', 'Webhook verified', { slug });
      res.writeHead(200);
      return res.end(challenge);
    }
    log('warn', 'leadgen', 'Webhook verification failed', { slug });
    res.writeHead(403);
    return res.end('Forbidden');
  }

  // POST /webhook/{slug} — Leadgen handler
  if (req.method === 'POST') {
    let rawBody;
    try {
      rawBody = await collectBody(req, MAX_BODY_SIZE);
    } catch (e) {
      log('error', 'leadgen', 'Body read error', { slug, error: e.message });
      res.writeHead(200);
      res.end('EVENT_RECEIVED');
      return;
    }

    res.writeHead(200);
    res.end('EVENT_RECEIVED');

    try {
      const json = JSON.parse(rawBody.toString('utf8'));
      if (json.object !== 'page') {
        log('info', 'leadgen', 'Ignoring non-page webhook', { slug, object: json.object });
        return;
      }
      for (const entry of json.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field !== 'leadgen') continue;
          const { leadgen_id, ad_id, form_id } = change.value;
          handleLeadgen(pool, slug, leadgen_id, ad_id, form_id).catch(e =>
            log('error', 'leadgen', 'Processing error', { slug, leadgenId: leadgen_id, error: e.message })
          );
        }
      }
    } catch (e) {
      log('error', 'leadgen', 'Parse error', { slug, error: e.message });
    }
    return;
  }

  res.writeHead(405);
  res.end('Method not allowed');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log('info', 'server', 'Webhook service started', {
    port: PORT,
    wabaEnabled: !!ANTHROPIC_API_KEY,
    model: ANTHROPIC_MODEL
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  log('info', 'server', 'SIGTERM received, shutting down');
  server.close();
  for (const [, pool] of pools.entries()) {
    await pool.end().catch(() => {});
  }
  await sharedPool.end().catch(() => {});
  process.exit(0);
});
