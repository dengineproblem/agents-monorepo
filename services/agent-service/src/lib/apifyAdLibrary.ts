/**
 * Apify интеграция для получения креативов из Meta Ads Library
 * Actor: enrich-stream/ultimate-fb-ad-library-scraper
 * $0.0015 за результат, ~3333 результата бесплатно в месяц ($5 free credits)
 *
 * Формат ответа actor'а — плоский массив объявлений:
 * [{ ad_archive_id, start_date, is_active, publisher_platform, snapshot: { page_id, page_name, body, videos, images, cards, ... } }]
 *
 * Поддерживает:
 * - Keyword search: q=stomatolog&country=KZ
 * - Page search: view_all_page_id=123456&search_type=page
 */

import { createLogger } from './logger.js';

const log = createLogger({ module: 'apifyAdLibrary' });

const APIFY_ACTOR_ID = 'enrich-stream~ultimate-fb-ad-library-scraper';
const APIFY_BASE_URL = 'https://api.apify.com/v2';

// ========================================
// TYPES
// ========================================

interface ApifySnapshot {
  body?: { text?: string } | null;
  title?: string | null;
  caption?: string | null;
  cta_text?: string | null;
  cta_type?: string | null;
  link_url?: string | null;
  link_description?: string | null;
  display_format?: string | null;
  page_id?: string | null;
  page_name?: string | null;
  page_profile_picture_url?: string | null;
  page_profile_uri?: string | null;
  page_like_count?: number | null;
  page_categories?: string[];
  videos?: Array<{
    video_hd_url?: string | null;
    video_sd_url?: string | null;
    video_preview_image_url?: string | null;
  }>;
  images?: Array<{
    original_image_url?: string | null;
    resized_image_url?: string | null;
  }>;
  cards?: Array<{
    body?: string | null;
    title?: string | null;
    cta_text?: string | null;
    cta_type?: string | null;
    link_url?: string | null;
    video_hd_url?: string | null;
    video_sd_url?: string | null;
    video_preview_image_url?: string | null;
    original_image_url?: string | null;
    resized_image_url?: string | null;
  }>;
}

/** Один элемент в dataset от Apify (плоская структура) */
interface ApifyAdItem {
  ad_archive_id?: string;
  ad_library_url?: string;
  start_date?: string; // "Fri, 24 Oct 2025 07:00:00 GMT"
  end_date?: string;
  is_active?: boolean;
  publisher_platform?: string[];
  snapshot?: ApifySnapshot;
  scraper_metadata?: {
    scraped_on?: string;
    run_id?: string;
    dataset_id?: string;
  };
  source_url?: string;
}

export interface CompetitorCreativeData {
  fb_ad_archive_id: string;
  media_type: 'video' | 'image' | 'carousel';
  media_urls: string[];
  thumbnail_url: string | null;
  body_text: string | null;
  headline: string | null;
  cta_type: string | null;
  platforms: string[];
  first_shown_date: string | null;
  is_active: boolean;
  ad_variations: number;
  raw_data: ApifyAdItem;
}

// ========================================
// HELPERS (reused from searchApi.ts)
// ========================================

export function extractInstagramHandle(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  const urlPatterns = [/instagram\.com\/([a-z0-9._]+)\/?$/i];
  for (const pattern of urlPatterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) return match[1];
  }
  if (trimmed.startsWith('@')) {
    const handle = trimmed.slice(1);
    if (/^[a-z0-9._]+$/i.test(handle)) return handle;
  }
  if (/^[a-z0-9._]+$/i.test(trimmed) && trimmed.length >= 2) return trimmed;
  return null;
}

export function isInstagramUrl(url: string): boolean {
  if (!url) return false;
  const normalized = url.trim().toLowerCase();
  if (normalized.includes('facebook.com') || normalized.includes('fb.com')) return false;
  if (normalized.includes('instagram.com')) return true;
  if (normalized.startsWith('@') || /^[a-z0-9._]+$/i.test(normalized)) return true;
  return false;
}

export function extractPageIdFromUrl(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /facebook\.com\/profile\.php\?id=(\d+)/i,
    /facebook\.com\/pages\/[^\/]+\/(\d+)/i,
    /facebook\.com\/p\/[^\/]+\/(\d+)/i,
    /facebook\.com\/(\d{10,})\/?$/i,
    /facebook\.com\/([a-z0-9._-]+)\/?$/i,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

// ========================================
// NORMALIZE APIFY DATA → CompetitorCreativeData
// ========================================

function getVideos(snapshot?: ApifySnapshot) {
  return snapshot?.videos || [];
}

function getImages(snapshot?: ApifySnapshot) {
  return snapshot?.images || [];
}

function getCards(snapshot?: ApifySnapshot) {
  return snapshot?.cards || [];
}

function detectMediaType(snapshot?: ApifySnapshot): 'video' | 'image' | 'carousel' {
  const videos = getVideos(snapshot);
  const cards = getCards(snapshot);
  const images = getImages(snapshot);
  const displayFormat = snapshot?.display_format?.toUpperCase();
  if (cards.length > 0 || displayFormat === 'CAROUSEL') return 'carousel';
  if (videos.length > 0 || displayFormat === 'VIDEO') return 'video';
  if (images.length > 1) return 'carousel';
  return 'image';
}

function extractMediaUrls(snapshot?: ApifySnapshot): string[] {
  const urls: string[] = [];
  for (const card of getCards(snapshot)) {
    if (card.video_hd_url) urls.push(card.video_hd_url);
    else if (card.video_sd_url) urls.push(card.video_sd_url);
    else if (card.original_image_url) urls.push(card.original_image_url);
    else if (card.resized_image_url) urls.push(card.resized_image_url);
  }
  for (const video of getVideos(snapshot)) {
    if (video.video_hd_url) urls.push(video.video_hd_url);
    else if (video.video_sd_url) urls.push(video.video_sd_url);
  }
  for (const image of getImages(snapshot)) {
    if (image.original_image_url) urls.push(image.original_image_url);
    else if (image.resized_image_url) urls.push(image.resized_image_url);
  }
  return urls;
}

function extractThumbnailUrl(snapshot?: ApifySnapshot): string | null {
  const cards = getCards(snapshot);
  const videos = getVideos(snapshot);
  const images = getImages(snapshot);

  if (cards.length > 0) {
    const card = cards[0];
    if (card.video_preview_image_url) return card.video_preview_image_url;
    if (card.resized_image_url) return card.resized_image_url;
    if (card.original_image_url) return card.original_image_url;
  }
  if (videos.length > 0 && videos[0].video_preview_image_url) return videos[0].video_preview_image_url;
  if (images.length > 0) return images[0].resized_image_url || images[0].original_image_url || null;
  if (snapshot?.page_profile_picture_url) return snapshot.page_profile_picture_url;
  return null;
}

function getBodyText(snapshot?: ApifySnapshot): string | null {
  if (snapshot?.body && typeof snapshot.body === 'object' && snapshot.body.text) return snapshot.body.text;
  if (snapshot?.caption && snapshot.caption !== 'instagram.com') return snapshot.caption;
  return null;
}

/** Парсит дату формата "Fri, 24 Oct 2025 07:00:00 GMT" в ISO date string */
function parseDateToISO(dateStr?: string): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

export function transformAdToCreativeData(ad: ApifyAdItem): CompetitorCreativeData {
  const snapshot = ad.snapshot;
  const cards = getCards(snapshot);
  const videos = getVideos(snapshot);
  const images = getImages(snapshot);
  const adVariations = Math.max(1, cards.length + videos.length + images.length);

  const platforms = (ad.publisher_platform || ['FACEBOOK']).map(p => p.toLowerCase());

  return {
    fb_ad_archive_id: ad.ad_archive_id || '',
    media_type: detectMediaType(snapshot),
    media_urls: extractMediaUrls(snapshot),
    thumbnail_url: extractThumbnailUrl(snapshot),
    body_text: getBodyText(snapshot),
    headline: snapshot?.title || snapshot?.link_description || null,
    cta_type: snapshot?.cta_type || null,
    platforms,
    first_shown_date: parseDateToISO(ad.start_date),
    is_active: ad.is_active ?? true,
    ad_variations: adVariations,
    raw_data: ad,
  };
}

// ========================================
// APIFY API
// ========================================

function getApifyToken(): string {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN не настроен. Зарегистрируйтесь на apify.com и добавьте токен в .env');
  return token;
}

function buildAdLibraryUrl(params: {
  query?: string;
  pageId?: string;
  country?: string;
  searchType?: 'keyword_unordered' | 'page';
}): string {
  const { query, pageId, country = 'ALL', searchType = 'keyword_unordered' } = params;

  const urlParams = new URLSearchParams({
    active_status: 'all',
    ad_type: 'all',
    country: country,
    media_type: 'all',
  });

  if (pageId) {
    urlParams.set('view_all_page_id', pageId);
    urlParams.set('search_type', 'page');
  } else if (query) {
    urlParams.set('q', query);
    urlParams.set('search_type', searchType);
  }

  return `https://www.facebook.com/ads/library/?${urlParams.toString()}`;
}

/**
 * Запускает Apify actor синхронно и возвращает массив объявлений.
 */
async function runApifyActor(targetUrl: string, maxResults: number): Promise<ApifyAdItem[]> {
  const token = getApifyToken();

  const runUrl = `${APIFY_BASE_URL}/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;

  log.info({ targetUrl, maxResults }, 'Запуск Apify actor');

  try {
    const response = await fetch(runUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl, maxResults }),
      signal: AbortSignal.timeout(180_000), // 3 min timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error({ status: response.status, error: errorText }, 'Apify actor вернул ошибку');
      return [];
    }

    const items: ApifyAdItem[] = await response.json();

    // Фильтруем: оставляем только элементы с ad_archive_id
    const validAds = items.filter(item => item.ad_archive_id);
    log.info({ totalItems: items.length, validAds: validAds.length }, 'Получены результаты от Apify');
    return validAds;
  } catch (error: any) {
    log.error({ err: error }, 'Ошибка при запуске Apify actor');
    return [];
  }
}

// ========================================
// PUBLIC API (same interface as searchApi.ts)
// ========================================

/**
 * Получить креативы конкурента из Meta Ads Library через Apify.
 * Если есть targetPageId — ищет по page_id (надёжно).
 * Иначе — keyword search по имени (fallback).
 */
export async function fetchCompetitorCreatives(
  pageIdOrName: string,
  country: string = 'ALL',
  options: { limit?: number; targetPageId?: string } = {}
): Promise<CompetitorCreativeData[]> {
  const finalLimit = options.limit || 30;

  let url: string;
  if (options.targetPageId) {
    url = buildAdLibraryUrl({ pageId: options.targetPageId, country });
  } else if (pageIdOrName) {
    url = buildAdLibraryUrl({ query: pageIdOrName, country });
  } else {
    log.warn('Нет параметров для поиска');
    return [];
  }

  const results = await runApifyActor(url, Math.max(50, finalLimit));

  // Дедупликация по ad_archive_id
  const seenIds = new Set<string>();
  const uniqueAds: ApifyAdItem[] = [];

  for (const ad of results) {
    if (ad.ad_archive_id && !seenIds.has(ad.ad_archive_id)) {
      seenIds.add(ad.ad_archive_id);
      uniqueAds.push(ad);
    }
  }

  log.info({ total: results.length, unique: uniqueAds.length }, 'Дедупликация результатов');

  // Сортировка: активные первые, потом по дате (старые = долго работающие)
  let ads = uniqueAds;
  if (ads.length > finalLimit) {
    ads.sort((a, b) => {
      const aActive = a.is_active ?? true;
      const bActive = b.is_active ?? true;
      if (aActive !== bActive) return aActive ? -1 : 1;
      const dateA = new Date(a.start_date || 0).getTime();
      const dateB = new Date(b.start_date || 0).getTime();
      return dateA - dateB;
    });
    ads = ads.slice(0, finalLimit);
  }

  return ads.map(transformAdToCreativeData);
}

/**
 * Поиск страницы по имени.
 * Keyword search → извлекаем уникальные page_id из результатов.
 */
export async function searchPageByName(
  query: string,
  country: string = 'KZ'
): Promise<Array<{ page_id: string; page_name: string; avatar_url?: string }>> {
  const url = buildAdLibraryUrl({ query, country });
  const results = await runApifyActor(url, 20);

  const pagesMap = new Map<string, { page_id: string; page_name: string; avatar_url?: string }>();

  for (const ad of results) {
    const pageId = ad.snapshot?.page_id;
    const pageName = ad.snapshot?.page_name;
    if (pageId && !pagesMap.has(pageId)) {
      pagesMap.set(pageId, {
        page_id: pageId,
        page_name: pageName || '',
        avatar_url: ad.snapshot?.page_profile_picture_url || undefined,
      });
    }
  }

  return Array.from(pagesMap.values());
}

/**
 * Поиск страницы по Instagram handle.
 * Keyword search по handle → извлекаем page_id из результатов.
 */
/**
 * Нормализует строку для fuzzy-сравнения: lowercase, убирает спецсимволы
 */
function normalizeForMatch(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Проверяет, совпадает ли страница с Instagram handle.
 * Сравнивает handle с page_name и page_profile_uri.
 */
function pageMatchesHandle(ad: ApifyAdItem, handle: string): boolean {
  const normalizedHandle = normalizeForMatch(handle);
  if (!normalizedHandle) return false;

  const pageName = ad.snapshot?.page_name || '';
  const pageUri = ad.snapshot?.page_profile_uri || '';

  // Точное совпадение нормализованного page_name
  if (normalizeForMatch(pageName) === normalizedHandle) return true;

  // page_profile_uri содержит handle (e.g. "https://facebook.com/avocadocleaning")
  if (pageUri && normalizeForMatch(pageUri).includes(normalizedHandle)) return true;

  // page_name содержит handle как подстроку (e.g. "Avocado Cleaning KZ" содержит "avocadocleaning")
  if (normalizeForMatch(pageName).includes(normalizedHandle)) return true;

  // handle содержит нормализованное page_name (e.g. handle "avocado_cleaning_almaty" содержит "avocadocleaning")
  const normalizedPageName = normalizeForMatch(pageName);
  if (normalizedPageName.length >= 4 && normalizedHandle.includes(normalizedPageName)) return true;

  return false;
}

export async function searchPageByInstagram(
  igHandle: string,
  country: string = 'KZ'
): Promise<Array<{ page_id: string; page_name: string; avatar_url?: string; instagram_handle?: string }>> {
  const cleanHandle = igHandle.replace(/^@/, '');

  log.info({ igHandle: cleanHandle, country }, 'Поиск страницы по Instagram handle через Apify');

  // Стратегия: search_type=page (page search, как SearchAPI page_search), потом keyword fallback
  const searchStrategies: Array<{ searchType: 'page' | 'keyword_unordered'; country: string; label: string }> = [];

  // 1. Page search в конкретной стране
  if (country !== 'ALL') {
    searchStrategies.push({ searchType: 'page', country, label: `page_search/${country}` });
  }
  // 2. Page search во всех странах
  searchStrategies.push({ searchType: 'page', country: 'ALL', label: 'page_search/ALL' });
  // 3. Keyword search fallback
  if (country !== 'ALL') {
    searchStrategies.push({ searchType: 'keyword_unordered', country, label: `keyword/${country}` });
  }
  searchStrategies.push({ searchType: 'keyword_unordered', country: 'ALL', label: 'keyword/ALL' });

  for (const strategy of searchStrategies) {
    log.info({ igHandle: cleanHandle, strategy: strategy.label }, 'Попытка поиска');

    const url = buildAdLibraryUrl({ query: cleanHandle, country: strategy.country, searchType: strategy.searchType });
    const results = await runApifyActor(url, 20);

    if (results.length === 0) {
      log.info({ strategy: strategy.label }, 'Нет результатов');
      continue;
    }

    // Собираем уникальные страницы
    const pagesMap = new Map<string, { page_id: string; page_name: string; avatar_url?: string; instagram_handle?: string; matchScore: number }>();

    for (const ad of results) {
      const pageId = ad.snapshot?.page_id;
      const pageName = ad.snapshot?.page_name;
      if (pageId && !pagesMap.has(pageId)) {
        const matches = pageMatchesHandle(ad, cleanHandle);
        pagesMap.set(pageId, {
          page_id: pageId,
          page_name: pageName || '',
          avatar_url: ad.snapshot?.page_profile_picture_url || undefined,
          instagram_handle: cleanHandle,
          matchScore: matches ? 1 : 0,
        });
      }
    }

    // Логируем все найденные страницы для отладки
    const allPages = Array.from(pagesMap.values());
    log.info({
      strategy: strategy.label,
      totalPages: allPages.length,
      pages: allPages.map(p => ({ name: p.page_name, id: p.page_id, match: p.matchScore })),
    }, 'Найденные страницы');

    // Фильтруем: только совпавшие страницы
    const matched = allPages.filter(p => p.matchScore > 0);

    if (matched.length > 0) {
      log.info({ igHandle: cleanHandle, strategy: strategy.label, matchedPages: matched.map(p => `${p.page_name} (${p.page_id})`) }, 'Найдены совпадающие страницы');
      return matched.map(({ matchScore, ...rest }) => rest);
    }
  }

  // Fallback: если handle содержит точку (e.g. atlas_capital.kz), попробовать без доменной части
  if (cleanHandle.includes('.')) {
    const handleWithoutDomain = cleanHandle.split('.')[0];
    log.info({ igHandle: cleanHandle, fallbackHandle: handleWithoutDomain }, 'Пробуем поиск без доменной части');
    const fallbackResults = await searchPageByInstagram(handleWithoutDomain, country);
    if (fallbackResults.length > 0) {
      return fallbackResults;
    }
  }

  log.warn({ igHandle: cleanHandle }, 'Страницы не найдены по Instagram handle');
  return [];
}

/**
 * Обновить URL для конкретного креатива (CDN URLs expire).
 * Ищет по page_id и находит конкретный ad_archive_id.
 */
export async function refreshCreativeMediaUrl(
  fbAdArchiveId: string,
  competitorName: string,
  countryCode: string = 'ALL',
  pageId?: string
): Promise<{ media_urls: string[]; thumbnail_url: string | null } | null> {
  log.info({ fbAdArchiveId, competitorName, countryCode, pageId }, 'Обновление URL креатива через Apify');

  let url: string;
  if (pageId) {
    url = buildAdLibraryUrl({ pageId, country: countryCode });
  } else {
    url = buildAdLibraryUrl({ query: competitorName, country: countryCode });
  }

  const results = await runApifyActor(url, 50);

  const targetAd = results.find(ad => ad.ad_archive_id === fbAdArchiveId);

  if (!targetAd) {
    log.warn({ fbAdArchiveId, totalAds: results.length }, 'Креатив не найден в результатах Apify');
    return null;
  }

  const creativeData = transformAdToCreativeData(targetAd);

  log.info({
    fbAdArchiveId,
    newMediaUrls: creativeData.media_urls.length,
    newThumbnail: !!creativeData.thumbnail_url,
  }, 'Получены свежие URL через Apify');

  return {
    media_urls: creativeData.media_urls,
    thumbnail_url: creativeData.thumbnail_url,
  };
}
