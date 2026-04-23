/**
 * Извлечение рекламной атрибуции из wwebjs сообщений.
 *
 * wwebjs хранит ad-метаданные в rawData.ctwaContext (Click-to-WhatsApp context),
 * а не в contextInfo.externalAdReply как Evolution API.
 */

import { pino } from 'pino';

const log = pino({ name: 'ad-attribution' });

export interface AdAttribution {
  sourceId: string | null;
  sourceUrl: string | null;
  mediaUrl: string | null;
  sourceApp: string | null;
  ctwaClid: string | null;
  pattern: 'ctwa_context' | 'url_match' | 'unattributed' | 'none';
}

const EMPTY: AdAttribution = {
  sourceId: null,
  sourceUrl: null,
  mediaUrl: null,
  sourceApp: null,
  ctwaClid: null,
  pattern: 'none',
};

/**
 * Извлекает ad-атрибуцию из массива wwebjs сообщений.
 * Перебирает все сообщения и возвращает первую найденную атрибуцию.
 */
export function extractAdAttribution(messages: any[]): AdAttribution {
  for (const msg of messages) {
    const rd = msg.rawData || msg._data;

    const contextInfo = rd?.contextInfo ||
                        rd?.message?.contextInfo ||
                        rd?.message?.extendedTextMessage?.contextInfo;
    const externalAd = contextInfo?.externalAdReply;
    const referral = contextInfo?.referral || rd?.referral;
    const conversationContext = rd?.conversationContext;
    const referredProductPromotion = contextInfo?.referredProductPromotion || rd?.referredProductPromotion;

    const ctwaClid = normalizeValue(
      rd?.ctwaContext?.ctwaClid ??
      rd?.ctwaContext?.ctwa_clid ??
      externalAd?.ctwaClid ??
      externalAd?.ctwa_clid ??
      referral?.ctwaClid ??
      referral?.ctwa_clid ??
      conversationContext?.ctwaClid ??
      conversationContext?.ctwa_clid ??
      referredProductPromotion?.ctwaClid ??
      referredProductPromotion?.ctwa_clid ??
      rd?.ctwaClid ??
      rd?.ctwa_clid ??
      null
    );

    // Паттерн 1: ctwaContext (основной для wwebjs)
    const ctwa = rd?.ctwaContext;
    if (ctwa?.sourceId) {
      return {
        sourceId: normalizeValue(ctwa.sourceId),
        sourceUrl: normalizeValue(ctwa.sourceUrl),
        mediaUrl: normalizeValue(ctwa.mediaUrl),
        sourceApp: normalizeValue(ctwa.sourceApp),
        ctwaClid,
        pattern: 'ctwa_context',
      };
    }

    // Паттерн 1b: contextInfo.externalAdReply (fallback, формат Evolution)
    if (externalAd?.sourceId) {
      return {
        sourceId: normalizeValue(externalAd.sourceId),
        sourceUrl: normalizeValue(externalAd.sourceUrl),
        mediaUrl: normalizeValue(externalAd.mediaUrl),
        sourceApp: null,
        ctwaClid,
        pattern: 'ctwa_context',
      };
    }

    // Паттерн 1c: referral
    if (referral?.sourceId || referral?.source_id) {
      return {
        sourceId: normalizeValue(referral.sourceId || referral.source_id),
        sourceUrl: normalizeValue(referral.sourceUrl || referral.source_url),
        mediaUrl: normalizeValue(referral.mediaUrl || referral.image_url || referral.video_url),
        sourceApp: null,
        ctwaClid,
        pattern: 'ctwa_context',
      };
    }
  }

  // Паттерн 2: URL match — ищем ссылки на Instagram/Facebook в тексте
  for (const msg of messages) {
    const links: Array<{ link: string }> = msg.links || [];
    for (const l of links) {
      if (isAdUrl(l.link)) {
        return {
          sourceId: null,
          sourceUrl: l.link,
          mediaUrl: null,
          sourceApp: l.link.includes('instagram.com') ? 'instagram' : 'facebook',
          ctwaClid: null,
          pattern: 'url_match',
        };
      }
    }

    // Также проверяем body на URL паттерн
    const body: string = msg.body || '';
    const urlMatch = body.match(/https?:\/\/(?:www\.)?(?:instagram\.com|facebook\.com)\/(?:p|reel|watch)\/[a-zA-Z0-9_-]+/);
    if (urlMatch) {
      return {
        sourceId: null,
        sourceUrl: urlMatch[0],
        mediaUrl: null,
        sourceApp: urlMatch[0].includes('instagram.com') ? 'instagram' : 'facebook',
        ctwaClid: null,
        pattern: 'url_match',
      };
    }
  }

  return EMPTY;
}

function normalizeValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number') return String(value);
  return null;
}

function isAdUrl(url: string): boolean {
  return /^https?:\/\/(?:www\.)?(?:instagram\.com|facebook\.com)\/(?:p|reel|watch)\//i.test(url);
}
