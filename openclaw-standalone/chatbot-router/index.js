import http from 'node:http';
import { URL } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

// ─── Config ──────────────────────────────────────────────────────
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const CHATBOT_SERVICE_URL = process.env.CHATBOT_SERVICE_URL;
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://evolution-api:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const MAX_BODY_SIZE = 1024 * 1024; // 1 MB
const FORWARD_TIMEOUT_MS = 15_000;
const CACHE_TTL = 5 * 60 * 1000; // 5 min
const CACHE_MAX_SIZE = 500;

if (!SUPABASE_DB_URL) {
  console.error('[FATAL] SUPABASE_DB_URL is required');
  process.exit(1);
}

// ─── Logging ─────────────────────────────────────────────────────
function log(level, msg, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  };
  if (level === 'error') console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

// ─── DB Pool ─────────────────────────────────────────────────────
const saasPool = new Pool({
  connectionString: SUPABASE_DB_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30_000,
});

saasPool.on('error', (err) => {
  log('error', 'Unexpected SaaS pool error', { error: err.message });
});

// ─── Instance Cache ──────────────────────────────────────────────
const instanceCache = new Map();

function cacheSet(key, data) {
  // Evict oldest entries if cache is too large
  if (instanceCache.size >= CACHE_MAX_SIZE) {
    const oldest = instanceCache.keys().next().value;
    instanceCache.delete(oldest);
  }
  instanceCache.set(key, { data, ts: Date.now() });
}

async function resolveInstance(instanceName) {
  const cached = instanceCache.get(instanceName);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const { rows } = await saasPool.query(
      `SELECT wi.id, wi.user_account_id, wi.account_id, wi.phone_number, wi.ai_bot_id,
              ua.openclaw_slug
       FROM whatsapp_instances wi
       JOIN user_accounts ua ON ua.id = wi.user_account_id
       WHERE wi.instance_name = $1
       LIMIT 1`,
      [instanceName]
    );

    if (rows.length === 0) return null;
    cacheSet(instanceName, rows[0]);
    return rows[0];
  } catch (err) {
    log('error', 'Failed to resolve instance', { instance: instanceName, error: err.message });
    return null;
  }
}

// ─── Message Parsing ─────────────────────────────────────────────
function extractPhone(remoteJid) {
  if (!remoteJid) return null;
  return remoteJid.replace(/@s\.whatsapp\.net$/, '').replace(/@c\.us$/, '').replace(/@lid$/, '');
}

function extractMessageText(msg) {
  if (!msg?.message) return null;
  const m = msg.message;
  return m.conversation || m.extendedTextMessage?.text || null;
}

function extractCtwaClid(msg) {
  const ci = msg?.message?.contextInfo || msg?.contextInfo;
  return ci?.referral?.ctwaClid
    || ci?.externalAdReply?.ctwaClid
    || msg?.data?.ctwaClid
    || msg?.data?.conversationContext?.referralCtwaClid
    || null;
}

function extractSourceId(msg) {
  const ci = msg?.message?.contextInfo || msg?.contextInfo;
  return ci?.referral?.sourceId
    || ci?.externalAdReply?.sourceId
    || msg?.key?.sourceId
    || msg?.data?.sourceId
    || null;
}

function detectMessageType(msg) {
  if (msg?.message?.audioMessage) return 'audio';
  if (msg?.message?.imageMessage) return 'image';
  if (msg?.message?.documentMessage) return 'document';
  if (msg?.message?.videoMessage) return 'video';
  if (msg?.message?.stickerMessage) return 'sticker';
  return 'text';
}

// ─── SaaS Forwarding ─────────────────────────────────────────────
async function forwardToSaaS(endpoint, body) {
  if (!CHATBOT_SERVICE_URL) {
    log('warn', 'CHATBOT_SERVICE_URL not set, skipping forward', { endpoint });
    return null;
  }

  const url = `${CHATBOT_SERVICE_URL}${endpoint}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    log('info', 'Forwarded to SaaS', { endpoint, status: res.status });
    return { status: res.status, data };
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'timeout' : err.message;
    log('error', 'Forward to SaaS failed', { endpoint, error: reason });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Event Handlers ──────────────────────────────────────────────
async function handleMessagesUpsert(event) {
  const instanceName = event.instance;
  if (!instanceName) {
    log('warn', 'messages.upsert event without instance name');
    return;
  }

  const instance = await resolveInstance(instanceName);
  if (!instance) {
    log('warn', 'Unknown instance, ignoring messages', { instance: instanceName });
    return;
  }

  const messages = event.data?.messages || (event.data ? [event.data] : []);
  let processedCount = 0;

  for (const msg of messages) {
    if (msg.key?.fromMe) continue;
    if (msg.message?.reactionMessage || msg.message?.protocolMessage) continue;

    const contactPhone = extractPhone(msg.key?.remoteJid || msg.key?.remoteJidAlt);
    if (!contactPhone) {
      log('warn', 'Message without extractable phone', { instance: instanceName });
      continue;
    }

    const messageText = extractMessageText(msg);
    const ctwaClid = extractCtwaClid(msg);
    const sourceId = extractSourceId(msg);
    const messageType = detectMessageType(msg);

    log('info', 'Incoming message', {
      instance: instanceName,
      slug: instance.openclaw_slug,
      phone: contactPhone,
      type: messageType,
      ctwaClid: ctwaClid || undefined,
      adSourceId: sourceId || undefined,
      hasText: !!messageText,
    });

    processedCount++;
  }

  if (processedCount > 0) {
    // Forward full webhook to SaaS — it handles AI bot, CAPI, lead creation
    const result = await forwardToSaaS('/webhooks/evolution', event);
    log('info', 'Messages batch forwarded', {
      instance: instanceName,
      count: processedCount,
      saasStatus: result?.status,
    });
  }
}

async function handleConnectionUpdate(event) {
  const instanceName = event.instance;
  if (!instanceName) return;

  const state = event.data?.state || event.data?.connection;

  // Map Evolution states to our status
  let status = 'disconnected';
  if (state === 'open' || state === 'connected') status = 'connected';
  else if (state === 'connecting') status = 'connecting';
  else if (state === 'close' || state === 'disconnected') status = 'disconnected';

  log('info', 'Connection update', { instance: instanceName, rawState: state, status });

  try {
    const result = await saasPool.query(
      `UPDATE whatsapp_instances
       SET status = $1,
           updated_at = NOW(),
           last_connected_at = CASE WHEN $1 = 'connected' THEN NOW() ELSE last_connected_at END,
           error_message = CASE WHEN $1 = 'connected' THEN NULL ELSE error_message END
       WHERE instance_name = $2
       RETURNING id`,
      [status, instanceName]
    );

    if (result.rowCount === 0) {
      log('warn', 'Connection update for unregistered instance', { instance: instanceName });
    }

    // Invalidate cache on status change
    instanceCache.delete(instanceName);
  } catch (err) {
    log('error', 'Failed to update connection status', { instance: instanceName, error: err.message });
  }
}

async function handleQRCodeUpdate(event) {
  const instanceName = event.instance;
  if (!instanceName) return;

  const qrCode = event.data?.qrcode?.base64 || event.data?.qrcode || event.data?.base64;
  if (!qrCode) {
    log('warn', 'QR event without qrcode data', { instance: instanceName });
    return;
  }

  log('info', 'QR code updated', { instance: instanceName, qrLength: qrCode.length });

  try {
    const result = await saasPool.query(
      `UPDATE whatsapp_instances
       SET qr_code = $1, status = 'connecting', updated_at = NOW()
       WHERE instance_name = $2
       RETURNING id`,
      [qrCode, instanceName]
    );

    if (result.rowCount === 0) {
      log('warn', 'QR update for unregistered instance', { instance: instanceName });
    }
  } catch (err) {
    log('error', 'Failed to update QR code', { instance: instanceName, error: err.message });
  }
}

// ─── Body Parser ─────────────────────────────────────────────────
function readBody(req, maxSize = MAX_BODY_SIZE) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        reject(new Error(`Body exceeds ${maxSize} bytes`));
        return;
      }
      body += chunk;
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ─── HTTP Server ─────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health check — also verifies DB connectivity
  if (url.pathname === '/health') {
    try {
      await saasPool.query('SELECT 1');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', pool: { total: saasPool.totalCount, idle: saasPool.idleCount, waiting: saasPool.waitingCount } }));
    } catch (err) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'error', error: err.message }));
    }
  }

  // Evolution API webhook endpoint
  if (url.pathname === '/evolution-webhook' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      log('error', 'Webhook body too large', { error: err.message });
      res.writeHead(413);
      return res.end('Payload too large');
    }

    // Respond immediately so Evolution API doesn't retry
    res.writeHead(200);
    res.end('OK');

    try {
      const event = JSON.parse(body);
      const eventType = event.event;

      if (!eventType) {
        log('warn', 'Webhook without event type', { keys: Object.keys(event) });
        return;
      }

      log('debug', 'Webhook received', { event: eventType, instance: event.instance });

      switch (eventType) {
        case 'messages.upsert':
          await handleMessagesUpsert(event);
          break;
        case 'connection.update':
          await handleConnectionUpdate(event);
          break;
        case 'qrcode.updated':
          await handleQRCodeUpdate(event);
          break;
        default:
          log('debug', 'Ignored event type', { event: eventType, instance: event.instance });
          break;
      }
    } catch (err) {
      log('error', 'Webhook processing error', { error: err.message, stack: err.stack });
    }
    return;
  }

  // Evolution API proxy — allows OpenClaw agents to manage instances
  if (url.pathname.startsWith('/api/evolution/') && EVOLUTION_API_URL) {
    const evoPath = url.pathname.replace('/api/evolution', '');

    log('info', 'Evolution proxy request', { method: req.method, path: evoPath });

    try {
      const headers = { 'apikey': EVOLUTION_API_KEY };

      let reqBody;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        headers['Content-Type'] = 'application/json';
        try {
          reqBody = await readBody(req);
        } catch (err) {
          res.writeHead(413);
          return res.end(JSON.stringify({ error: 'Payload too large' }));
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);

      try {
        const evoRes = await fetch(`${EVOLUTION_API_URL}${evoPath}`, {
          method: req.method,
          headers,
          body: reqBody || undefined,
          signal: controller.signal,
        });
        const evoData = await evoRes.text();

        log('info', 'Evolution proxy response', { path: evoPath, status: evoRes.status });

        res.writeHead(evoRes.status, { 'Content-Type': 'application/json' });
        res.end(evoData);
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      const reason = err.name === 'AbortError' ? 'Evolution API timeout' : err.message;
      log('error', 'Evolution proxy error', { path: evoPath, error: reason });
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: reason }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// ─── Startup & Shutdown ──────────────────────────────────────────
const PORT = process.env.PORT || 3002;

server.listen(PORT, () => {
  log('info', 'Chatbot router started', {
    port: PORT,
    hasSaasDb: !!SUPABASE_DB_URL,
    hasChatbotUrl: !!CHATBOT_SERVICE_URL,
    hasEvoKey: !!EVOLUTION_API_KEY,
  });
});

async function gracefulShutdown(signal) {
  log('info', 'Shutting down', { signal });
  server.close(() => {
    saasPool.end().then(() => {
      log('info', 'Pool closed, exiting');
      process.exit(0);
    });
  });
  // Force exit after 10s
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  log('error', 'Unhandled rejection', { error: err?.message, stack: err?.stack });
});
process.on('uncaughtException', (err) => {
  log('error', 'Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});
