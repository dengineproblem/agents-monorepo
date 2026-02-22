import http from 'node:http';
import { URL } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

// ─── Config ──────────────────────────────────────────────────────
const VERIFY_TOKEN = process.env.FB_WEBHOOK_VERIFY_TOKEN || 'openclaw_leadgen_2026';
const PG_HOST = process.env.PG_HOST || 'postgres';
const PG_USER = process.env.PG_USER || 'postgres';
const PG_PASSWORD = process.env.PG_PASSWORD || 'openclaw_local';
const PG_PORT = process.env.PG_PORT || 5432;
const MAX_BODY_SIZE = 1024 * 1024; // 1 MB
const MAX_POOLS = 50;
const FB_API_TIMEOUT_MS = 15_000;
const TELEGRAM_TIMEOUT_MS = 5_000;

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

// ─── Per-tenant connection pool cache ────────────────────────────
const pools = new Map();

function getPool(slug) {
  if (pools.has(slug)) return pools.get(slug);

  // Evict oldest pool if cache is full
  if (pools.size >= MAX_POOLS) {
    const oldest = pools.keys().next().value;
    log('warn', 'Evicting oldest pool', { slug: oldest });
    pools.get(oldest).end().catch(() => {});
    pools.delete(oldest);
  }

  const pool = new Pool({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: `openclaw_${slug}`,
    max: 3,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
  });

  pool.on('error', (err) => {
    log('error', 'Pool error', { slug, error: err.message });
  });

  pools.set(slug, pool);
  return pool;
}

// Extract slug from /webhook/{slug}
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

async function notifyTelegram(pool, slug, name, phone, source) {
  try {
    const { rows: [cfg] } = await pool.query(
      'SELECT telegram_bot_token, telegram_chat_id, telegram_chat_id_2, telegram_chat_id_3, telegram_chat_id_4, timezone FROM config WHERE id = 1'
    );
    if (!cfg?.telegram_bot_token || !cfg?.telegram_chat_id) return;

    const tz = cfg.timezone || 'Asia/Almaty';
    const sourceLabel = source === 'lead_form' ? 'Facebook Lead Form' : 'Facebook';
    const text = `🔔 Новый лид — ${sourceLabel}\n👤 ${name || '—'}\n📞 ${phone || '—'}\n⏰ ${new Date().toLocaleString('ru-RU', { timeZone: tz })}`;

    const chatIds = [cfg.telegram_chat_id, cfg.telegram_chat_id_2, cfg.telegram_chat_id_3, cfg.telegram_chat_id_4].filter(Boolean);
    for (const chatId of chatIds) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
      try {
        await fetch(`https://api.telegram.org/bot${cfg.telegram_bot_token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text }),
          signal: controller.signal,
        });
      } catch (err) {
        log('warn', 'Telegram notify failed', { slug, chatId, error: err.message });
      } finally {
        clearTimeout(timeout);
      }
    }
    log('info', 'Telegram notified', { slug, chatCount: chatIds.length });
  } catch (err) {
    log('error', 'Telegram notify error', { slug, error: err.message });
  }
}

// Resolve creative_id and direction_id from ad_id via ad_creative_mapping
async function resolveAdAttribution(pool, slug, adId) {
  if (!adId) return { creative_id: null, direction_id: null };
  try {
    const { rows } = await pool.query(
      'SELECT creative_id, direction_id FROM ad_creative_mapping WHERE ad_id = $1 LIMIT 1',
      [adId]
    );
    if (rows.length > 0) {
      log('debug', 'Ad attribution resolved', { slug, adId, creative_id: rows[0].creative_id, direction_id: rows[0].direction_id });
      return rows[0];
    }
  } catch (err) {
    log('error', 'Ad attribution lookup failed', { slug, adId, error: err.message });
  }
  return { creative_id: null, direction_id: null };
}

async function handleLeadgen(pool, slug, leadgenId, adId, formId) {
  log('info', 'Processing leadgen', { slug, leadgenId, adId, formId });

  const { rows: [cfg] } = await pool.query('SELECT fb_page_access_token, fb_access_token FROM config WHERE id = 1');
  const token = cfg?.fb_page_access_token || cfg?.fb_access_token;
  if (!token) {
    log('error', 'No FB access token in config', { slug });
    return;
  }

  const { rows: dup } = await pool.query('SELECT id FROM leads WHERE leadgen_id = $1', [leadgenId]);
  if (dup.length > 0) {
    log('info', 'Duplicate leadgen, skipping', { slug, leadgenId });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FB_API_TIMEOUT_MS);

  let data;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v23.0/${encodeURIComponent(leadgenId)}?fields=id,ad_id,form_id,created_time,field_data&access_token=${token}`,
      { signal: controller.signal }
    );
    data = await res.json();
    if (!res.ok || data.error) {
      log('error', 'Facebook API error', { slug, leadgenId, status: res.status, fbError: data.error?.message });
      return;
    }
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'timeout' : err.message;
    log('error', 'Facebook API request failed', { slug, leadgenId, error: reason });
    return;
  } finally {
    clearTimeout(timeout);
  }

  const fields = data.field_data || [];
  const name = extractField(fields, ['full_name', 'name', 'first_name', 'имя', 'фио']);
  const phone = normalizePhone(extractField(fields, ['phone_number', 'phone', 'телефон', 'номер_телефона']));
  const email = extractField(fields, ['email', 'email_address', 'почта']);
  const city = extractField(fields, ['city', 'город']);

  const resolvedAdId = adId || data.ad_id;
  const resolvedFormId = formId || data.form_id;

  // Resolve creative and direction from ad_creative_mapping
  const { creative_id, direction_id } = await resolveAdAttribution(pool, slug, resolvedAdId);

  await pool.query(
    `INSERT INTO leads (
      name, phone, email, leadgen_id, ad_id, form_id,
      source_type, utm_source,
      creative_id, direction_id,
      message_preview
    ) VALUES ($1, $2, $3, $4, $5, $6, 'lead_form', 'facebook_lead_form', $7, $8, $9)
    ON CONFLICT (leadgen_id) DO NOTHING`,
    [name, phone, email, leadgenId, resolvedAdId, resolvedFormId,
     creative_id, direction_id,
     city ? `Город: ${city}` : null]
  );

  log('info', 'Lead saved', { slug, leadgenId, name, phone, adId: resolvedAdId, formId: resolvedFormId, creative_id, direction_id });
  notifyTelegram(pool, slug, name, phone, 'lead_form');
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

  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ok',
      pools: pools.size,
    }));
  }

  const slug = parseSlug(url.pathname);
  if (!slug) {
    res.writeHead(404);
    return res.end('Not found. Use /webhook/{slug}');
  }

  let pool;
  try {
    pool = getPool(slug);
    await pool.query('SELECT 1');
  } catch (e) {
    log('error', 'DB connection failed', { slug, error: e.message });
    res.writeHead(404);
    return res.end(`Tenant "${slug}" not found`);
  }

  // GET /webhook/{slug} — Facebook verification
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      log('info', 'Facebook webhook verified', { slug });
      res.writeHead(200);
      return res.end(challenge);
    }
    log('warn', 'Webhook verification failed', { slug, mode });
    res.writeHead(403);
    return res.end('Forbidden');
  }

  // POST /webhook/{slug} — Leadgen handler
  if (req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      log('error', 'Webhook body too large', { slug, error: err.message });
      res.writeHead(413);
      return res.end('Payload too large');
    }

    // Respond immediately so Facebook doesn't retry
    res.writeHead(200);
    res.end('EVENT_RECEIVED');

    try {
      const json = JSON.parse(body);
      if (json.object !== 'page') {
        log('debug', 'Ignored non-page object', { slug, object: json.object });
        return;
      }
      let leadCount = 0;
      for (const entry of json.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field !== 'leadgen') continue;
          const { leadgen_id, ad_id, form_id } = change.value;
          leadCount++;
          handleLeadgen(pool, slug, leadgen_id, ad_id, form_id).catch(e => {
            log('error', 'Leadgen processing failed', { slug, leadgenId: leadgen_id, error: e.message, stack: e.stack });
          });
        }
      }
      if (leadCount > 0) {
        log('info', 'Webhook processed', { slug, leadCount });
      }
    } catch (e) {
      log('error', 'Webhook parse error', { slug, error: e.message });
    }
    return;
  }

  res.writeHead(405);
  res.end('Method not allowed');
});

// ─── Startup & Shutdown ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  log('info', 'Webhook service started', {
    port: PORT,
    verifyTokenSet: VERIFY_TOKEN !== 'openclaw_leadgen_2026',
  });
});

async function gracefulShutdown(signal) {
  log('info', 'Shutting down', { signal });
  server.close(async () => {
    const closePromises = [];
    for (const [slug, pool] of pools) {
      closePromises.push(pool.end().catch(err => {
        log('error', 'Pool close error', { slug, error: err.message });
      }));
    }
    await Promise.all(closePromises);
    log('info', 'All pools closed, exiting');
    process.exit(0);
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
