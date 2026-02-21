import http from 'node:http';
import { URL } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const VERIFY_TOKEN = process.env.FB_WEBHOOK_VERIFY_TOKEN || 'openclaw_leadgen_2026';
const PG_HOST = process.env.PG_HOST || 'postgres';
const PG_USER = process.env.PG_USER || 'postgres';
const PG_PASSWORD = process.env.PG_PASSWORD || 'openclaw_local';
const PG_PORT = process.env.PG_PORT || 5432;

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

async function notifyTelegram(pool, name, phone) {
  try {
    const { rows: [cfg] } = await pool.query('SELECT telegram_bot_token, telegram_chat_id FROM config WHERE id = 1');
    if (!cfg?.telegram_bot_token || !cfg?.telegram_chat_id) return;
    const text = `🔔 Новый лид с Facebook\n👤 ${name || '—'}\n📞 ${phone || '—'}\n⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}`;
    fetch(`https://api.telegram.org/bot${cfg.telegram_bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.telegram_chat_id, text })
    }).catch(() => {});
  } catch {}
}

async function handleLeadgen(pool, leadgenId, adId, formId) {
  const { rows: [cfg] } = await pool.query('SELECT fb_page_access_token, fb_access_token FROM config WHERE id = 1');
  const token = cfg?.fb_page_access_token || cfg?.fb_access_token;
  if (!token) return console.error('No FB access token in config');

  const { rows: dup } = await pool.query('SELECT id FROM leads WHERE leadgen_id = $1', [leadgenId]);
  if (dup.length > 0) return;

  const res = await fetch(`https://graph.facebook.com/v23.0/${leadgenId}?fields=id,ad_id,form_id,created_time,field_data&access_token=${token}`);
  const data = await res.json();
  if (!res.ok || data.error) return console.error('FB error:', data.error?.message);

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

  notifyTelegram(pool, name, phone);
  console.log(`Lead saved: ${name} ${phone}`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200);
    return res.end('ok');
  }

  const slug = parseSlug(url.pathname);
  if (!slug) {
    res.writeHead(404);
    return res.end('Not found. Use /webhook/{slug}');
  }

  let pool;
  try {
    pool = getPool(slug);
    // Quick check: can we connect?
    await pool.query('SELECT 1');
  } catch (e) {
    console.error(`DB not found for slug "${slug}":`, e.message);
    res.writeHead(404);
    return res.end(`Tenant "${slug}" not found`);
  }

  // GET /webhook/{slug} — Facebook verification
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      res.writeHead(200);
      return res.end(challenge);
    }
    res.writeHead(403);
    return res.end('Forbidden');
  }

  // POST /webhook/{slug} — Leadgen handler
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      res.writeHead(200);
      res.end('EVENT_RECEIVED');
      try {
        const json = JSON.parse(body);
        if (json.object !== 'page') return;
        for (const entry of json.entry || []) {
          for (const change of entry.changes || []) {
            if (change.field !== 'leadgen') continue;
            const { leadgen_id, ad_id, form_id } = change.value;
            handleLeadgen(pool, leadgen_id, ad_id, form_id).catch(e => console.error('Leadgen error:', e.message));
          }
        }
      } catch (e) { console.error('Parse error:', e.message); }
    });
    return;
  }

  res.writeHead(405);
  res.end('Method not allowed');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Webhook service (multi-tenant) listening on :${PORT}`));
