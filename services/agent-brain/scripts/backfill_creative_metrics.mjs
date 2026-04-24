#!/usr/bin/env node
/**
 * Standalone backfill for creative_metrics_history.
 *
 * Fix-up для legacy-пользователей, у которых в user_creatives.account_id
 * висел UUID (→ scoring.js фильтровал .is(null) и пропускал их), поэтому
 * метрики за первые дни жизни креатива не попали в историю.
 *
 * Вызывает scoring.js::saveCreativeMetricsToHistory напрямую с accountUUID=null
 * для каждой даты из диапазона. Функция сама делает upsert с
 * onConflict=user_account_id,ad_id,date,platform, так что повторный запуск
 * безопасен и обновит существующие записи.
 *
 * Usage:
 *   USER_ACCOUNT_ID=... DATE_FROM=2026-04-20 DATE_TO=2026-04-22 \
 *     node scripts/backfill_creative_metrics.mjs
 *
 * Optional:
 *   CREATIVE_IDS=uuid1,uuid2       — фильтр по конкретным креативам
 *   DRY_RUN=1                      — только распечатать, что будем делать
 */
import { createClient } from '@supabase/supabase-js';
import { saveCreativeMetricsToHistory } from '../src/scoring.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_ACCOUNT_ID = process.env.USER_ACCOUNT_ID;
const DATE_FROM = process.env.DATE_FROM;
const DATE_TO = process.env.DATE_TO;
const CREATIVE_IDS = (process.env.CREATIVE_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const DRY_RUN = process.env.DRY_RUN === '1';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE');
  process.exit(1);
}
if (!USER_ACCOUNT_ID || !DATE_FROM || !DATE_TO) {
  console.error(
    'Required env: USER_ACCOUNT_ID, DATE_FROM (YYYY-MM-DD), DATE_TO (YYYY-MM-DD)',
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function dateRange(from, to) {
  const dates = [];
  const cur = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (cur <= end) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

async function main() {
  console.log(`[backfill] user=${USER_ACCOUNT_ID} range=${DATE_FROM}..${DATE_TO}`);
  if (CREATIVE_IDS.length) console.log(`[backfill] filter creative_ids=${CREATIVE_IDS.join(',')}`);
  if (DRY_RUN) console.log('[backfill] DRY_RUN=1 — ничего не пишем');

  const { data: user, error: userErr } = await supabase
    .from('user_accounts')
    .select('id, username, ad_account_id, access_token, multi_account_enabled')
    .eq('id', USER_ACCOUNT_ID)
    .single();
  if (userErr || !user) throw new Error(`user not found: ${userErr?.message}`);
  if (!user.ad_account_id || !user.access_token)
    throw new Error('user has no ad_account_id/access_token');
  if (user.multi_account_enabled) {
    console.warn(
      `[backfill] WARNING: ${user.username} имеет multi_account_enabled=true — скрипт заточен под legacy. Прерываю.`,
    );
    process.exit(2);
  }

  // Собираем креативы: legacy-режим → account_id IS NULL
  let creativesQuery = supabase
    .from('user_creatives')
    .select('id, title, is_active, status, account_id, created_at')
    .eq('user_id', USER_ACCOUNT_ID)
    .eq('is_active', true)
    .eq('status', 'ready')
    .is('account_id', null);
  if (CREATIVE_IDS.length) creativesQuery = creativesQuery.in('id', CREATIVE_IDS);
  const { data: creatives, error: cErr } = await creativesQuery;
  if (cErr) throw new Error(`fetch creatives: ${cErr.message}`);
  console.log(`[backfill] активных креативов: ${creatives.length}`);

  if (!creatives.length) {
    console.log('[backfill] нечего бэкфиллить, выхожу');
    return;
  }

  const readyCreatives = creatives.map(c => ({
    id: c.id,
    title: c.title,
    is_active: c.is_active,
    status: c.status,
  }));

  const dates = dateRange(DATE_FROM, DATE_TO);
  console.log(`[backfill] дат: ${dates.length} (${dates.join(', ')})`);

  for (const date of dates) {
    console.log(`\n[backfill] --- date=${date} ---`);
    if (DRY_RUN) {
      console.log('[backfill] (dry-run) saveCreativeMetricsToHistory skipped');
      continue;
    }
    try {
      await saveCreativeMetricsToHistory(
        supabase,
        USER_ACCOUNT_ID,
        readyCreatives,
        user.ad_account_id,
        user.access_token,
        null, // accountUUID — ЯВНО null для legacy
        date,
      );
    } catch (err) {
      console.error(`[backfill] date=${date} FAILED: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  console.log('\n[backfill] done');
}

main().catch(err => {
  console.error('[backfill] FATAL:', err);
  process.exit(1);
});
