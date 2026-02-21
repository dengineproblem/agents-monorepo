import http from 'node:http';
import { URL } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const VERIFY_TOKEN = process.env.FB_WEBHOOK_VERIFY_TOKEN || 'openclaw_leadgen_2026';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

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

async function notifyTelegram(name, phone) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const text = `🔔 Новый лид с Facebook\n👤 ${name || '—'}\n📞 ${phone || '—'}\n⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}`;
  fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text })
  }).catch(() => {});
}

async function handleLeadgen(leadgenId, adId, formId) {
  // Get access token from config
  const { rows: [cfg] } = await pool.query('SELECT fb_page_access_token, fb_access_token FROM config WHERE id = 1');
  const token = cfg?.fb_page_access_token || cfg?.fb_access_token;
  if (!token) return console.error('No FB access token in config');

  // Check duplicate
  const { rows: dup } = await pool.query('SELECT id FROM leads WHERE leadgen_id = $1', [leadgenId]);
  if (dup.length > 0) return;

  // Fetch lead data from Facebook
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

  notifyTelegram(name, phone);
  console.log(`Lead saved: ${name} ${phone}`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200);
    return res.end('ok');
  }

  // GET /webhook — Facebook verification
  if (req.method === 'GET' && url.pathname === '/webhook') {
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

  // POST /webhook — Leadgen handler
  if (req.method === 'POST' && url.pathname === '/webhook') {
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
            handleLeadgen(leadgen_id, ad_id, form_id).catch(e => console.error('Leadgen error:', e.message));
          }
        }
      } catch (e) { console.error('Parse error:', e.message); }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Webhook service listening on :${PORT}`));
