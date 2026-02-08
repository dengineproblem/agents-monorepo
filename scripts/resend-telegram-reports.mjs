#!/usr/bin/env node
/**
 * Скрипт переотправки отчётов из campaign_reports в Telegram.
 * Запускать внутри контейнера agent-brain:
 *   docker exec agents-monorepo-agent-brain-1 node /app/scripts/resend-telegram-reports.mjs
 *
 * Или с параметром даты:
 *   docker exec agents-monorepo-agent-brain-1 node /app/scripts/resend-telegram-reports.mjs 2026-02-07
 *
 * Режим dry-run (без реальной отправки):
 *   docker exec -e DRY_RUN=true agents-monorepo-agent-brain-1 node /app/scripts/resend-telegram-reports.mjs
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DRY_RUN = process.env.DRY_RUN === 'true';
const MAX_PART = 3800;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!BOT_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

const targetDate = process.argv[2] || new Date().toISOString().split('T')[0];
console.log(`\n=== Переотправка отчётов за ${targetDate} ===`);
console.log(`Bot token: ${BOT_TOKEN.slice(0, 10)}***`);
console.log(`Dry run: ${DRY_RUN}\n`);

// --- Supabase REST helpers ---
async function supabaseGet(table, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase GET ${table} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// --- Telegram helpers ---
async function sendTelegram(chatId, text) {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would send ${text.length} chars to chat ${chatId}`);
    return true;
  }

  const parts = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_PART) {
      parts.push(remaining);
      break;
    }
    let cutAt = remaining.lastIndexOf('\n', MAX_PART);
    if (cutAt < MAX_PART * 0.5) cutAt = MAX_PART;
    parts.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt);
  }

  for (let i = 0; i < parts.length; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: String(chatId),
          text: parts[i],
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text();
        console.error(`  Telegram error (part ${i + 1}/${parts.length}): ${res.status} ${errText}`);
        return false;
      }
      console.log(`  Sent part ${i + 1}/${parts.length} (${parts[i].length} chars) to ${chatId}`);

      // Пауза между частями
      if (i < parts.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (err) {
      clearTimeout(timeout);
      console.error(`  Telegram fetch error (part ${i + 1}): ${err.message}`);
      return false;
    }
  }
  return true;
}

// --- Main ---
async function main() {
  // 1. Получаем отчёты за целевую дату
  const reports = await supabaseGet(
    'campaign_reports',
    `created_at=gte.${targetDate}T00:00:00Z&created_at=lt.${targetDate}T23:59:59Z&order=created_at.asc`
  );
  console.log(`Найдено отчётов: ${reports.length}`);

  if (reports.length === 0) {
    console.log('Нет отчётов для отправки.');
    return;
  }

  // 2. Собираем уникальные telegram_id из отчётов
  const telegramIds = [...new Set(reports.map(r => r.telegram_id).filter(Boolean))];
  console.log(`Уникальных telegram_id в отчётах: ${telegramIds.length}`);

  // 3. Получаем пользователей с их telegram_id полями
  const users = await supabaseGet(
    'user_accounts',
    `select=id,username,telegram_id,telegram_id_2,telegram_id_3,telegram_id_4`
  );

  // Индекс: telegram_id -> user
  const userByTgId = {};
  for (const u of users) {
    if (u.telegram_id) userByTgId[String(u.telegram_id)] = u;
  }

  // 4. Отправляем отчёты
  let sentCount = 0;
  let failCount = 0;

  for (const report of reports) {
    // report_data может быть объектом { text: "..." } или строкой напрямую
    const rd = report.report_data;
    const reportText = typeof rd === 'string' ? rd : rd?.text;
    if (!reportText) {
      console.log(`  Пропуск report ${report.id}: нет текста`);
      continue;
    }

    const tgId = String(report.telegram_id);
    const user = userByTgId[tgId];
    const username = user?.username || tgId;
    const platform = report.platform || 'facebook';

    console.log(`\n--- ${username} (${platform}) ---`);
    console.log(`  Report ID: ${report.id}, длина текста: ${reportText.length}`);

    // Собираем все chat_id для этого юзера
    const chatIds = [];
    if (user) {
      [user.telegram_id, user.telegram_id_2, user.telegram_id_3, user.telegram_id_4]
        .filter(Boolean)
        .forEach(id => chatIds.push(String(id)));
    } else {
      // Fallback: отправляем на telegram_id из отчёта
      if (tgId) chatIds.push(tgId);
    }

    if (chatIds.length === 0) {
      console.log(`  Нет telegram_id для отправки, пропуск`);
      failCount++;
      continue;
    }

    for (const chatId of chatIds) {
      const ok = await sendTelegram(chatId, reportText);
      if (ok) sentCount++;
      else failCount++;

      // Пауза между отправками (rate limit Telegram)
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\n=== Итог ===`);
  console.log(`Успешно отправлено: ${sentCount}`);
  console.log(`Ошибки: ${failCount}`);
  console.log(`Всего отчётов: ${reports.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
