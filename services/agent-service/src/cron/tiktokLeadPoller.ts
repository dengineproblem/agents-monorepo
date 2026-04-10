/**
 * TikTok Lead Poller
 *
 * Каждые 30 минут скачивает новые лиды из TikTok Instant Forms через
 * async task API: POST /page/lead/task/ → GET /page/lead/task/download/
 *
 * Дедупликация: по полю leadgen_id в таблице leads.
 * Обработка: через processLeadEvent (тот же путь что и вебхуки).
 */

import cron from 'node-cron';
import axios from 'axios';
import { FastifyInstance } from 'fastify';
import { createLogger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';
import { tikTokGraph } from '../adapters/tiktok.js';
import { processLeadEvent } from '../routes/tiktokWebhooks.js';

const log = createLogger({ module: 'tiktokLeadPoller' });

// TikTok использует biz-api для Lead Gen endpoints (business-api редиректит 307)
const TIKTOK_BIZ_API = 'https://biz-api.tiktok.com/open_api/v1.3';
// Окно поллинга: последние 48 часов (дедупликация не даст дублей)
const POLL_WINDOW_HOURS = 48;
// Таймаут ожидания задачи на сервере TikTok
const TASK_MAX_WAIT_MS = 90_000;
const TASK_POLL_INTERVAL_MS = 4_000;

// ─── CSV parser (без внешних зависимостей) ───────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCsv(csvData: string): Array<Record<string, string>> {
  const lines = csvData.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }

  return rows;
}

// ─── Получение page_id через ad/get ──────────────────────────────────────────

/**
 * Получаем уникальные page_id из объявлений типа LEAD_ADS.
 * page_id не возвращается через instant_page/list — только через ad/get.
 *
 * ВАЖНО: TikTok page_id — 19-значные целые числа (> Number.MAX_SAFE_INTEGER).
 * При обычном JSON.parse() теряется точность (7616613432980341010 → 7616613432980341000).
 * Поэтому читаем raw text и извлекаем через regex.
 */
async function getLeadPageIds(advertiserId: string, accessToken: string): Promise<string[]> {
  const pageIds = new Set<string>();

  try {
    const params = new URLSearchParams({
      advertiser_id: advertiserId,
      page_size: '100',
      fields: JSON.stringify(['ad_id', 'campaign_id', 'page_id', 'operation_status']),
    });

    // Используем axios напрямую с responseType:'text' чтобы избежать float64 потери точности
    const res = await axios.get(`https://business-api.tiktok.com/open_api/v1.3/ad/get/?${params}`, {
      headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' },
      responseType: 'text',
      timeout: 15_000,
      maxRedirects: 5,
    });

    // Regex-извлечение page_id как строк (без потери точности)
    const matches: string[] = res.data.match(/"page_id"\s*:\s*(\d+)/g) || [];
    for (const m of matches) {
      const id = m.replace(/.*:\s*/, '');
      if (id && id !== '0') pageIds.add(id);
    }

    log.info({ advertiser_id: advertiserId, page_ids: [...pageIds] }, '[tiktokLeadPoller] page_ids from ad/get (raw)');
  } catch (err: any) {
    log.warn({ advertiser_id: advertiserId, err: err.message }, '[tiktokLeadPoller] Failed to get ads, skipping');
  }

  return [...pageIds];
}

// ─── TikTok Lead Task API ─────────────────────────────────────────────────────

async function createLeadTask(
  advertiserId: string,
  pageId: string,
  accessToken: string,
  startTime: number,
  endTime: number,
): Promise<string> {
  // page_id — 19-значное целое, передаём как число в raw JSON строке
  // чтобы избежать float64 потери точности при JSON.stringify({page_id: BigInt})
  // TikTok ожидает page_id как integer string (в кавычках), не число
  const rawBody = `{"advertiser_id":"${advertiserId}","page_id":"${pageId}","start_time":${startTime},"end_time":${endTime}}`;

  const res = await axios.post(
    `${TIKTOK_BIZ_API}/page/lead/task/`,
    rawBody,
    { headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' }, timeout: 15_000 },
  );

  if (res.data?.code !== 0) {
    throw new Error(`TikTok lead task creation failed [${res.data?.code}]: ${res.data?.message}`);
  }

  const taskId: string | undefined = res.data?.data?.task_id;
  if (!taskId) throw new Error('TikTok lead task: no task_id in response');
  return taskId;
}

/**
 * Ждём завершения задачи и возвращаем CSV-строку.
 * TikTok возвращает JSON пока задача выполняется, и CSV когда готова.
 */
async function waitForCsv(
  advertiserId: string,
  taskId: string,
  accessToken: string,
): Promise<string | null> {
  const deadline = Date.now() + TASK_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, TASK_POLL_INTERVAL_MS));

    const res = await axios.get(`${TIKTOK_BIZ_API}/page/lead/task/download/`, {
      params: { advertiser_id: advertiserId, task_id: taskId },
      headers: { 'Access-Token': accessToken },
      timeout: 15_000,
      validateStatus: () => true,
      maxRedirects: 10,
    });

    log.info({
      task_id: taskId,
      status: res.status,
      content_type: res.headers['content-type'],
      data_type: typeof res.data,
      data_preview: JSON.stringify(res.data).substring(0, 400),
    }, '[tiktokLeadPoller] Download response');

    // Если data — строка и похожа на CSV
    if (typeof res.data === 'string' && res.data.trimStart().startsWith('lead_id')) {
      return res.data;
    }

    // Если JSON-объект
    const json = typeof res.data === 'object' ? res.data : null;

    if (json?.code !== undefined && json.code !== 0) {
      throw new Error(`TikTok lead task download error [${json.code}]: ${json.message}`);
    }

    if (json?.data) {
      const status: string = json.data.status;
      if (status === 'DONE') {
        return json.data.content || json.data.csv_data || json.data.download_url || null;
      }
      if (status === 'FAILED') {
        throw new Error(`TikTok lead task FAILED: ${json.data.error_msg || 'unknown'}`);
      }
      // RUNNING — ждём следующей итерации
      log.info({ task_id: taskId, status }, '[tiktokLeadPoller] Task still running');
      continue;
    }

    // Пустой или неизвестный ответ — ждём
    log.warn({ task_id: taskId, data_preview: JSON.stringify(res.data).substring(0, 200) }, '[tiktokLeadPoller] Unrecognized download response, retrying');
  }

  throw new Error(`TikTok lead task timed out after ${TASK_MAX_WAIT_MS / 1000}s`);
}

// ─── Основная логика ──────────────────────────────────────────────────────────

async function pollAccount(
  account: { id: string; user_account_id: string; tiktok_business_id: string; tiktok_access_token: string },
  app: FastifyInstance,
): Promise<void> {
  const { tiktok_business_id: advertiserId, tiktok_access_token: accessToken } = account;

  log.info({ advertiser_id: advertiserId, account_id: account.id }, '[tiktokLeadPoller] Polling account');

  // Получаем page_id из объявлений типа LEAD_ADS
  const pageIds = await getLeadPageIds(advertiserId, accessToken);
  if (!pageIds.length) {
    log.info({ advertiser_id: advertiserId }, '[tiktokLeadPoller] No Lead page_ids found, skipping');
    return;
  }
  log.info({ advertiser_id: advertiserId, pages: pageIds.length }, '[tiktokLeadPoller] Pages found');

  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - POLL_WINDOW_HOURS * 3600;

  for (const pageId of pageIds) {
    try {
      const taskId = await createLeadTask(advertiserId, pageId, accessToken, startTime, endTime);
      log.info({ advertiser_id: advertiserId, page_id: pageId, task_id: taskId }, '[tiktokLeadPoller] Task created');

      const csvData = await waitForCsv(advertiserId, taskId, accessToken);
      if (!csvData) {
        log.info({ advertiser_id: advertiserId, page_id: pageId }, '[tiktokLeadPoller] Empty CSV, no leads');
        continue;
      }

      const allRows = parseCsv(csvData);

      // TikTok игнорирует start_time/end_time и возвращает всю историю —
      // фильтруем на клиенте: только лиды за последние POLL_WINDOW_HOURS часов
      const cutoffMs = Date.now() - POLL_WINDOW_HOURS * 3600 * 1000;
      const rows = allRows.filter((row) => {
        const raw = row['created_time'];
        if (!raw) return true; // если нет даты — пропускаем через
        // Формат TikTok: "2026-04-09 10:20:35(UTC+00:00)" → берём только дату+время
        const clean = raw.replace(/\(.*\)/, '').trim();
        const ts = new Date(clean + 'Z').getTime(); // трактуем как UTC
        return ts >= cutoffMs;
      });

      log.info({ advertiser_id: advertiserId, page_id: pageId, total: allRows.length, after_filter: rows.length }, '[tiktokLeadPoller] Parsed CSV (filtered to last 48h)');

      let saved = 0;
      let skipped = 0;

      for (const row of rows) {
        const leadId = row['lead_id'];
        if (!leadId) continue;

        // Быстрая дедупликация перед дорогой processLeadEvent
        const { data: existing } = await supabase
          .from('leads')
          .select('id')
          .eq('leadgen_id', leadId)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }

        // Строим TikTokLeadData из CSV-строки
        // CSV: lead_id, created_time, ad_id, ad_name, adgroup_id, adgroup_name,
        //      campaign_id, campaign_name, form_id, form_name, Name, Phone number
        const leadData = {
          lead_id: leadId,
          page_id: pageId,
          advertiser_id: advertiserId,
          ad_id: row['ad_id'] || undefined,
          adgroup_id: row['adgroup_id'] || undefined,
          campaign_id: row['campaign_id'] || undefined,
          create_time: row['created_time'] || new Date().toISOString(),
          field_data: [
            ...(row['Name'] ? [{ field_name: 'name', field_value: row['Name'] }] : []),
            ...(row['Phone number'] ? [{ field_name: 'phone_number', field_value: row['Phone number'] }] : []),
            ...(row['Email'] ? [{ field_name: 'email', field_value: row['Email'] }] : []),
          ],
        };

        const correlationId = `poller-${leadId}`;
        try {
          await processLeadEvent(leadData, correlationId, app);
          saved++;
        } catch (err: any) {
          log.error({ lead_id: leadId, err: err.message }, '[tiktokLeadPoller] processLeadEvent failed');
        }
      }

      log.info(
        { advertiser_id: advertiserId, page_id: pageId, saved, skipped },
        '[tiktokLeadPoller] Page done',
      );
    } catch (err: any) {
      log.error(
        { advertiser_id: advertiserId, page_id: pageId, err: err.message },
        '[tiktokLeadPoller] Error polling page',
      );
    }
  }
}

async function pollAllAccounts(app: FastifyInstance): Promise<void> {
  log.info({}, '[tiktokLeadPoller] Starting poll cycle');

  const { data: accounts, error } = await supabase
    .from('ad_accounts')
    .select('id, user_account_id, tiktok_business_id, tiktok_access_token')
    .not('tiktok_business_id', 'is', null)
    .not('tiktok_access_token', 'is', null);

  if (error) {
    log.error({ err: error.message }, '[tiktokLeadPoller] Failed to query accounts');
    return;
  }

  if (!accounts?.length) {
    log.info({}, '[tiktokLeadPoller] No TikTok accounts configured');
    return;
  }

  log.info({ count: accounts.length }, '[tiktokLeadPoller] Accounts to poll');

  for (const account of accounts) {
    try {
      await pollAccount(account as any, app);
    } catch (err: any) {
      log.error({ account_id: account.id, err: err.message }, '[tiktokLeadPoller] Unhandled error for account');
    }
  }

  log.info({}, '[tiktokLeadPoller] Poll cycle complete');
}

// ─── Экспорт ──────────────────────────────────────────────────────────────────

export { pollAllAccounts };

export function startTikTokLeadPoller(app: FastifyInstance): void {
  app.log.info('[tiktokLeadPoller] Started (every 30 min + once on boot in 15s)');

  // Первый запуск через 15 секунд после старта сервера
  setTimeout(() => {
    pollAllAccounts(app).catch((err) => {
      log.error({ err: String(err) }, '[tiktokLeadPoller] Initial poll failed');
    });
  }, 15_000);

  // Затем каждые 30 минут
  cron.schedule('*/30 * * * *', async () => {
    try {
      await pollAllAccounts(app);
    } catch (err) {
      log.error({ error: String(err) }, '[tiktokLeadPoller] Unexpected error in cron');
    }
  });
}
