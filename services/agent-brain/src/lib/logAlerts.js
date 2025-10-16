import { setTimeout as sleep } from 'node:timers/promises';
import fetch from 'node-fetch';

const LOKI_URL = process.env.LOKI_URL || 'http://loki:3100';
const TELEGRAM_BOT_TOKEN = process.env.LOG_ALERT_TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.LOG_ALERT_TELEGRAM_CHAT_ID;
const POLL_INTERVAL_MS = Number(process.env.LOG_ALERT_POLL_INTERVAL_MS || 30000);
const DEDUP_WINDOW_MS = Number(process.env.LOG_ALERT_DEDUP_WINDOW_MS || 600000);
const FALLBACK_BOT_TOKEN = process.env.LOG_ALERT_TEST_BOT_TOKEN;
const FALLBACK_CHAT_ID = process.env.LOG_ALERT_TEST_CHAT_ID;
const ENVIRONMENT_LABEL = process.env.LOG_ALERT_LOKI_ENVIRONMENT || process.env.NODE_ENV || 'development';

const seen = new Map();

function makeKey(streamLabels, payload) {
  return [
    streamLabels?.service,
    payload?.module,
    payload?.userAccountId,
    payload?.err?.fb?.code,
    payload?.message
  ].join('|');
}

async function queryLoki(startMs, endMs) {
  const params = new URLSearchParams({
    query: `{environment="${ENVIRONMENT_LABEL}"} | json | level="error"`,
    start: String(startMs * 1_000_000),
    end: String(endMs * 1_000_000),
    limit: '2000',
    direction: 'forward'
  });
  const res = await fetch(`${LOKI_URL}/loki/api/v1/query_range?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Loki query failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    if (!FALLBACK_BOT_TOKEN || !FALLBACK_CHAT_ID) return;
  }
  const token = TELEGRAM_BOT_TOKEN || FALLBACK_BOT_TOKEN;
  const chatId = TELEGRAM_CHAT_ID || FALLBACK_CHAT_ID;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'MarkdownV2', disable_web_page_preview: true })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram send failed: ${res.status} ${body}`);
  }
}

function formatMessage(streamLabels, payload) {
  const fb = payload?.err?.fb;
  const resolution = payload?.resolution;
  const parts = [
    '*❗️ Ошибка в сервисе*',
    `Сервис: ${escapeMd(streamLabels?.service || 'unknown')}`,
    payload?.module ? `Модуль: ${escapeMd(payload.module)}` : undefined,
    payload?.message ? `Сообщение: ${escapeMd(payload.message)}` : undefined,
    payload?.userAccountId ? `UserAccount: ${escapeMd(payload.userAccountId)}` : undefined,
    payload?.userAccountName ? `Имя: ${escapeMd(payload.userAccountName)}` : undefined,
    payload?.userTelegram ? `Telegram: ${escapeMd(payload.userTelegram)}` : undefined,
    fb?.code ? `Facebook code: ${fb.code}/${fb.error_subcode || '—'}` : undefined,
    resolution?.short ? `Решение: ${escapeMd(resolution.short)}` : undefined,
    resolution?.hint ? `Hint: ${escapeMd(resolution.hint)}` : undefined,
    fb?.fbtrace_id ? `fbtrace_id: ${escapeMd(fb.fbtrace_id)}` : undefined,
    payload?.requestId ? `requestId: ${escapeMd(payload.requestId)}` : undefined,
  ];
  return parts.filter(Boolean).join('\n');
}

function safeParse(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { message: raw };
  }
}

function escapeMd(text = '') {
  return String(text).replace(/[\_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

export async function startLogAlertsWorker(logger) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    if (!FALLBACK_BOT_TOKEN || !FALLBACK_CHAT_ID) {
      logger.warn('LOG_ALERT_TELEGRAM_* env not set; alerts disabled');
      return;
    }
    logger.warn('LOG_ALERT_TELEGRAM_* env missing, using fallback test credentials');
  }

  logger.info('Starting log alerts worker');

  while (true) {
    try {
      const end = Date.now();
      const start = end - POLL_INTERVAL_MS;
      const data = await queryLoki(start, end);
      const results = data?.data?.result || [];

      for (const stream of results) {
        const labels = stream?.stream || {};
        for (const value of stream?.values || []) {
          const payload = safeParse(value?.[1]);
          if (!payload || typeof payload !== 'object') continue;

          const key = makeKey(labels, payload);
          if (!key) continue;
          const lastSeen = seen.get(key);
          if (lastSeen && end - lastSeen < DEDUP_WINDOW_MS) continue;

          const message = formatMessage(labels, payload);
          if (!message) continue;

          try {
            await sendTelegram(message);
            seen.set(key, end);
            logger.info({ module: 'logAlertsWorker', key }, 'Telegram alert sent');
          } catch (err) {
            logger.error({ err, module: 'logAlertsWorker', key }, 'Failed to send Telegram alert');
          }
        }
      }

      // ограничиваем размер dedup карты
      if (seen.size > 1000) {
        const cutoff = end - DEDUP_WINDOW_MS;
        for (const [key, ts] of seen.entries()) {
          if (ts < cutoff) seen.delete(key);
        }
      }
    } catch (err) {
      logger.error({ err }, 'Log alerts worker iteration failed');
    }

    await sleep(POLL_INTERVAL_MS);
  }
}
