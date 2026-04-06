#!/usr/bin/env node
/**
 * Recover lost Bas Dent leads from Feb 26 - Mar 7
 *
 * 1. Updates fb_page_access_token in Supabase
 * 2. Fetches lead data from Facebook API
 * 3. Saves to leads table
 * 4. Pushes to Bitrix24
 * 5. Sends Telegram notification
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const AD_ACCOUNT_ID = '91454447-2906-4d89-892b-12c817584b0f';
const USER_ACCOUNT_ID = '36f011b1-0ae7-4b9d-aaee-c979a295ed11';
const NEW_PAGE_TOKEN = 'EAAKlYWAZCZCgoBQzMiFx5ZCjnUU0B4SewUy3ZA038sX72vhoPIHAJxzbmPiukwBuawz3LOtfltZCZBNZBZBzqptl88hOHKTGCw9ZAaT7LzQQXeGcV2BgrpoVYE2VS4602hGsjUNkABxeHp0oN9enH68KKYk5bbmFBeixnJX0FzKIzS8M5LFQ1Ap6ZBufVzI2JlYdhMhHatTKkZD';
const TELEGRAM_BOT_TOKEN = process.env.LOG_ALERT_TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = '-4862556272';

// Leadgen IDs from logs (today's lost leads)
const LOST_LEADGEN_IDS = [
  '1797732204891285',
  '960625233491403',
  '2690549777970159',
  '4308860939354770',
  '3860093957461318',
  '1405665364384433',
  '963247309724741',
  '4419550428314484',
  '1448128447098525',
];

function normalizePhone(phone) {
  if (!phone) return null;
  let n = phone.replace(/[^\d+]/g, '');
  if (n.startsWith('8') && n.length === 11) n = '7' + n.substring(1);
  return n;
}

function extractField(fieldData, names) {
  for (const name of names) {
    const f = fieldData.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (f?.values?.[0]) return f.values[0];
  }
  return null;
}

async function sendTelegram(name, phone, directionName) {
  if (!TELEGRAM_BOT_TOKEN) return;
  const text = `🔔 <b>Новый лид с Facebook (восстановлен)</b>\n\n👤 Имя: ${name || '—'}\n📞 Телефон: ${phone || '—'}\n📁 Направление: ${directionName || '—'}\n\n⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}`;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' })
    });
  } catch (e) {
    console.error('TG error:', e.message);
  }
}

async function main() {
  console.log('=== Step 1: Update fb_page_access_token ===');
  const { error: updateErr } = await supabase
    .from('ad_accounts')
    .update({ fb_page_access_token: NEW_PAGE_TOKEN })
    .eq('id', AD_ACCOUNT_ID);

  if (updateErr) {
    console.error('Failed to update token:', updateErr);
    process.exit(1);
  }
  console.log('Token updated OK');

  console.log(`\n=== Step 2: Process ${LOST_LEADGEN_IDS.length} lost leads ===`);

  let saved = 0, skipped = 0, errors = 0;

  for (const leadgenId of LOST_LEADGEN_IDS) {
    try {
      // Check duplicate
      const { data: existing } = await supabase
        .from('leads')
        .select('id')
        .eq('leadgen_id', leadgenId)
        .maybeSingle();

      if (existing) {
        console.log(`SKIP ${leadgenId} - already exists`);
        skipped++;
        continue;
      }

      // Fetch from Facebook
      const res = await fetch(`https://graph.facebook.com/v20.0/${leadgenId}?fields=id,ad_id,form_id,created_time,field_data&access_token=${NEW_PAGE_TOKEN}`);
      const data = await res.json();

      if (data.error) {
        console.error(`ERROR ${leadgenId}:`, data.error.message);
        errors++;
        continue;
      }

      const fields = data.field_data || [];
      const name = extractField(fields, ['full_name', 'name', 'first_name', 'имя', 'фио']);
      const phone = normalizePhone(extractField(fields, ['phone_number', 'phone', 'телефон']));
      const email = extractField(fields, ['email', 'email_address', 'почта']);

      // Save to DB
      const { data: lead, error: insertErr } = await supabase
        .from('leads')
        .insert({
          user_account_id: USER_ACCOUNT_ID,
          account_id: AD_ACCOUNT_ID,
          name: name || 'Lead Form',
          phone,
          email,
          source_type: 'lead_form',
          source_id: data.ad_id || null,
          leadgen_id: leadgenId,
          utm_source: 'facebook_lead_form',
          utm_campaign: data.form_id || null,
          created_at: data.created_time || new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (insertErr) {
        console.error(`DB ERROR ${leadgenId}:`, insertErr.message);
        errors++;
        continue;
      }

      console.log(`SAVED ${leadgenId}: ${name} / ${phone} (lead_id: ${lead.id})`);
      saved++;

      // Send Telegram
      await sendTelegram(name, phone, null);

    } catch (e) {
      console.error(`FATAL ${leadgenId}:`, e.message);
      errors++;
    }
  }

  console.log(`\n=== Done: saved=${saved}, skipped=${skipped}, errors=${errors} ===`);
}

main().catch(e => { console.error(e); process.exit(1); });
