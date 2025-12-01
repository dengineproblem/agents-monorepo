/**
 * SearchAPI интеграция для получения креативов из Meta Ads Library
 * Документация: https://www.searchapi.io/docs/meta-ad-library-api
 */

import { createLogger } from './logger.js';

const log = createLogger({ module: 'searchApi' });

// ========================================
// TYPES
// ========================================

export interface SearchApiAdSnapshot {
  videos?: Array<{ video_hd_url?: string; video_sd_url?: string; video_preview_image_url?: string }>;
  images?: Array<{ original_image_url?: string; resized_image_url?: string }>;
  cards?: Array<{ video_hd_url?: string; video_sd_url?: string; video_preview_image_url?: string; original_image_url?: string; resized_image_url?: string }>;
  caption?: string;
  cta_text?: string;
  cta_type?: string;
  link_url?: string;
  display_format?: string;
  page_profile_picture_url?: string;
}

export interface SearchApiAd {
  ad_archive_id: string;
  page_id: string;
  page_name: string;
  snapshot?: SearchApiAdSnapshot;
  // Legacy fields (иногда данные на верхнем уровне)
  body?: { text?: string };
  title?: string;
  link_title?: string;
  call_to_action_type?: string;
  images?: Array<{ original_image_url?: string; resized_image_url?: string }>;
  videos?: Array<{ video_hd_url?: string; video_sd_url?: string; video_preview_image_url?: string }>;
  start_date?: string;
  end_date?: string;
  is_active?: boolean;
  publisher_platform?: string[];
  page_profile_picture_url?: string;
}

export interface SearchApiResponse {
  ads?: SearchApiAd[];
  search_metadata?: {
    total_results?: number;
  };
  error?: string;
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
  ad_variations: number; // Количество вариаций (карточки + видео + изображения)
  raw_data: SearchApiAd;
}

// ========================================
// HELPERS
// ========================================

/**
 * Извлекает Instagram handle из URL
 */
export function extractInstagramHandle(url: string): string | null {
  if (!url) return null;

  // Паттерны для Instagram
  const patterns = [
    // instagram.com/username
    /instagram\.com\/([a-z0-9._]+)\/?$/i,
    // instagram.com/username/
    /instagram\.com\/([a-z0-9._]+)\/$/i,
    // @username (просто хендл)
    /^@([a-z0-9._]+)$/i,
  ];

  for (const pattern of patterns) {
    const match = url.trim().match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Проверяет, является ли URL ссылкой на Instagram
 */
export function isInstagramUrl(url: string): boolean {
  if (!url) return false;
  const normalized = url.trim().toLowerCase();
  return normalized.includes('instagram.com') || normalized.startsWith('@');
}

/**
 * Извлекает page_id из различных форматов Facebook URL
 */
export function extractPageIdFromUrl(url: string): string | null {
  if (!url) return null;

  // Нормализуем URL
  const normalizedUrl = url.trim().toLowerCase();

  // Паттерны для извлечения
  const patterns = [
    // facebook.com/profile.php?id=123456789
    /facebook\.com\/profile\.php\?id=(\d+)/i,
    // facebook.com/pages/PageName/123456789
    /facebook\.com\/pages\/[^\/]+\/(\d+)/i,
    // facebook.com/p/PageName/123456789
    /facebook\.com\/p\/[^\/]+\/(\d+)/i,
    // facebook.com/123456789 (numeric page id)
    /facebook\.com\/(\d{10,})\/?$/i,
    // facebook.com/PageUsername (username, not numeric)
    /facebook\.com\/([a-z0-9._-]+)\/?$/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Получает видео из объявления (проверяет snapshot и верхний уровень)
 */
function getVideos(ad: SearchApiAd): Array<{ video_hd_url?: string; video_sd_url?: string; video_preview_image_url?: string }> {
  return ad.snapshot?.videos || ad.videos || [];
}

/**
 * Получает изображения из объявления (проверяет snapshot и верхний уровень)
 */
function getImages(ad: SearchApiAd): Array<{ original_image_url?: string; resized_image_url?: string }> {
  return ad.snapshot?.images || ad.images || [];
}

/**
 * Получает карточки карусели из объявления
 */
function getCards(ad: SearchApiAd): Array<{ video_hd_url?: string; video_sd_url?: string; video_preview_image_url?: string; original_image_url?: string; resized_image_url?: string }> {
  return ad.snapshot?.cards || [];
}

/**
 * Определяет тип медиа по данным объявления
 */
function detectMediaType(ad: SearchApiAd): 'video' | 'image' | 'carousel' {
  const videos = getVideos(ad);
  const images = getImages(ad);
  const cards = getCards(ad);
  const displayFormat = ad.snapshot?.display_format?.toUpperCase();

  // Карусель
  if (cards.length > 0 || displayFormat === 'CAROUSEL') {
    return 'carousel';
  }

  // Видео
  if (videos.length > 0 || displayFormat === 'VIDEO') {
    return 'video';
  }

  // Несколько изображений = карусель
  if (images.length > 1) {
    return 'carousel';
  }

  return 'image';
}

/**
 * Извлекает URL медиа из объявления
 */
function extractMediaUrls(ad: SearchApiAd): string[] {
  const urls: string[] = [];
  const videos = getVideos(ad);
  const images = getImages(ad);
  const cards = getCards(ad);

  // Карточки карусели
  if (cards.length > 0) {
    for (const card of cards) {
      if (card.video_hd_url) {
        urls.push(card.video_hd_url);
      } else if (card.video_sd_url) {
        urls.push(card.video_sd_url);
      } else if (card.original_image_url) {
        urls.push(card.original_image_url);
      } else if (card.resized_image_url) {
        urls.push(card.resized_image_url);
      }
    }
  }

  // Видео (приоритет HD)
  if (videos.length > 0) {
    for (const video of videos) {
      if (video.video_hd_url) {
        urls.push(video.video_hd_url);
      } else if (video.video_sd_url) {
        urls.push(video.video_sd_url);
      }
    }
  }

  // Изображения
  if (images.length > 0) {
    for (const image of images) {
      if (image.original_image_url) {
        urls.push(image.original_image_url);
      } else if (image.resized_image_url) {
        urls.push(image.resized_image_url);
      }
    }
  }

  return urls;
}

/**
 * Извлекает thumbnail URL
 */
function extractThumbnailUrl(ad: SearchApiAd): string | null {
  const videos = getVideos(ad);
  const images = getImages(ad);
  const cards = getCards(ad);

  // Для карусели - первая карточка
  if (cards.length > 0) {
    const card = cards[0];
    if (card.video_preview_image_url) return card.video_preview_image_url;
    if (card.resized_image_url) return card.resized_image_url;
    if (card.original_image_url) return card.original_image_url;
  }

  // Для видео - preview image
  if (videos.length > 0 && videos[0].video_preview_image_url) {
    return videos[0].video_preview_image_url;
  }

  // Для изображений - первое изображение
  if (images.length > 0) {
    return images[0].resized_image_url || images[0].original_image_url || null;
  }

  // Fallback: аватар страницы
  if (ad.snapshot?.page_profile_picture_url) {
    return ad.snapshot.page_profile_picture_url;
  }

  return null;
}

/**
 * Преобразует данные из SearchAPI в формат для БД
 */
export function transformAdToCreativeData(ad: SearchApiAd): CompetitorCreativeData {
  // Текст: snapshot.caption или body.text
  const bodyText = ad.snapshot?.caption || ad.body?.text || null;

  // CTA: snapshot.cta_type или верхний уровень
  const ctaType = ad.snapshot?.cta_type || ad.call_to_action_type || null;

  // Количество вариаций: карточки + видео + изображения (минимум 1)
  const videos = getVideos(ad);
  const images = getImages(ad);
  const cards = getCards(ad);
  const adVariations = Math.max(1, cards.length + videos.length + images.length);

  return {
    fb_ad_archive_id: ad.ad_archive_id,
    media_type: detectMediaType(ad),
    media_urls: extractMediaUrls(ad),
    thumbnail_url: extractThumbnailUrl(ad),
    body_text: bodyText,
    headline: ad.title || ad.link_title || null,
    cta_type: ctaType,
    platforms: ad.publisher_platform || ['facebook'],
    first_shown_date: ad.start_date || null,
    is_active: ad.is_active ?? true,
    ad_variations: adVariations,
    raw_data: ad,
  };
}

// ========================================
// API FUNCTIONS
// ========================================

/**
 * Получить креативы конкурента из Meta Ads Library через SearchAPI
 * @param pageIdOrName - page_id или название страницы для поиска
 * @param country - код страны (KZ, RU, ALL и т.д.)
 * @param options - дополнительные опции
 */
export async function fetchCompetitorCreatives(
  pageIdOrName: string,
  country: string = 'ALL',
  options: { limit?: number; targetPageId?: string } = {}
): Promise<CompetitorCreativeData[]> {
  const apiKey = process.env.SEARCHAPI_KEY;

  if (!apiKey) {
    log.error('SEARCHAPI_KEY не настроен');
    throw new Error('SEARCHAPI_KEY не настроен. Добавьте его в .env');
  }

  // Для "всех стран" используем 'all' (lowercase), иначе код страны
  const countryParam = country === 'ALL' ? 'all' : country;

  const params = new URLSearchParams({
    engine: 'meta_ad_library',
    q: pageIdOrName,
    country: countryParam,
    ad_type: 'all',
    media_type: 'all',
    active_status: 'all', // Включаем неактивные креативы тоже
    api_key: apiKey,
  });

  log.info({ query: pageIdOrName, country, targetPageId: options.targetPageId }, 'Запрос креативов из SearchAPI');

  try {
    const response = await fetch(`https://www.searchapi.io/api/v1/search?${params}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error({ status: response.status, error: errorText, query: pageIdOrName }, 'SearchAPI вернул ошибку');
      throw new Error(`SearchAPI error: ${response.status} - ${errorText}`);
    }

    const data: SearchApiResponse = await response.json();

    if (data.error) {
      log.error({ error: data.error, query: pageIdOrName }, 'SearchAPI вернул ошибку в ответе');
      throw new Error(`SearchAPI error: ${data.error}`);
    }

    let ads = data.ads || [];
    log.info({ query: pageIdOrName, adsCount: ads.length }, 'Получены креативы из SearchAPI');

    // Если указан targetPageId, фильтруем только креативы этой страницы
    if (options.targetPageId && ads.length > 0) {
      const filtered = ads.filter(ad => ad.page_id === options.targetPageId);
      log.info({
        originalCount: ads.length,
        filteredCount: filtered.length,
        targetPageId: options.targetPageId
      }, 'Отфильтрованы креативы по page_id');
      ads = filtered;
    }

    // =====================================================
    // ОПТИМИЗАЦИЯ: предварительная фильтрация и сортировка
    // Вместо скоринга всех 800+ креативов, отбираем 50 лучших кандидатов
    // Критерии: активные + самые долго работающие (по start_date)
    // =====================================================
    const PREFILTER_LIMIT = 50;

    if (ads.length > PREFILTER_LIMIT) {
      // Сначала активные, потом неактивные
      // Внутри каждой группы - по start_date ASC (самые старые первые = долго работают)
      ads.sort((a, b) => {
        // Активные выше неактивных
        if (a.is_active !== b.is_active) {
          return a.is_active ? -1 : 1;
        }
        // По дате старта (старые первые)
        const dateA = a.start_date ? new Date(a.start_date).getTime() : Date.now();
        const dateB = b.start_date ? new Date(b.start_date).getTime() : Date.now();
        return dateA - dateB;
      });

      const beforeCount = ads.length;
      ads = ads.slice(0, PREFILTER_LIMIT);

      log.info({
        beforePrefilter: beforeCount,
        afterPrefilter: ads.length,
        limit: PREFILTER_LIMIT
      }, 'Применена предварительная фильтрация (активные + долго работающие)');
    }

    // Преобразуем в формат для БД
    const creatives = ads.map(transformAdToCreativeData);

    // Ограничиваем если нужно (дополнительно к PREFILTER_LIMIT)
    if (options.limit && creatives.length > options.limit) {
      return creatives.slice(0, options.limit);
    }

    return creatives;
  } catch (error: any) {
    log.error({ err: error, query: pageIdOrName }, 'Ошибка при запросе к SearchAPI');
    throw error;
  }
}

/**
 * Поиск страницы по имени для резолвинга
 */
export async function searchPageByName(
  query: string,
  country: string = 'KZ'
): Promise<Array<{ page_id: string; page_name: string; avatar_url?: string }>> {
  const apiKey = process.env.SEARCHAPI_KEY;

  if (!apiKey) {
    throw new Error('SEARCHAPI_KEY не настроен');
  }

  const params = new URLSearchParams({
    engine: 'meta_ad_library',
    q: query,
    country: country,
    ad_type: 'all',
    api_key: apiKey,
  });

  log.info({ query, country }, 'Поиск страницы по имени');

  try {
    const response = await fetch(`https://www.searchapi.io/api/v1/search?${params}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SearchAPI error: ${response.status} - ${errorText}`);
    }

    const data: SearchApiResponse = await response.json();
    const ads = data.ads || [];

    // Извлекаем уникальные страницы
    const pagesMap = new Map<string, { page_id: string; page_name: string; avatar_url?: string }>();

    for (const ad of ads) {
      if (ad.page_id && !pagesMap.has(ad.page_id)) {
        pagesMap.set(ad.page_id, {
          page_id: ad.page_id,
          page_name: ad.page_name,
          avatar_url: ad.page_profile_picture_url,
        });
      }
    }

    return Array.from(pagesMap.values());
  } catch (error: any) {
    log.error({ err: error, query }, 'Ошибка при поиске страницы');
    throw error;
  }
}

/**
 * Поиск страницы по Instagram handle через Meta Ad Library Page Search
 */
export async function searchPageByInstagram(
  igHandle: string,
  country: string = 'KZ'
): Promise<Array<{ page_id: string; page_name: string; avatar_url?: string; instagram_handle?: string }>> {
  const apiKey = process.env.SEARCHAPI_KEY;

  if (!apiKey) {
    throw new Error('SEARCHAPI_KEY не настроен');
  }

  // Убираем @ если есть
  const cleanHandle = igHandle.replace(/^@/, '');

  const params = new URLSearchParams({
    engine: 'meta_ad_library_page_search',
    q: cleanHandle,
    country: country,
    api_key: apiKey,
  });

  log.info({ igHandle: cleanHandle, country }, 'Поиск страницы по Instagram handle');

  try {
    const response = await fetch(`https://www.searchapi.io/api/v1/search?${params}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error({ status: response.status, error: errorText }, 'SearchAPI page_search вернул ошибку');
      throw new Error(`SearchAPI error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const pageResults = data.page_results || [];

    log.info({ igHandle: cleanHandle, resultsCount: pageResults.length }, 'Результаты поиска по Instagram');

    return pageResults.map((page: any) => ({
      page_id: page.page_id,
      page_name: page.page_name,
      avatar_url: page.page_profile_picture_url,
      instagram_handle: page.instagram_handle,
    }));
  } catch (error: any) {
    log.error({ err: error, igHandle }, 'Ошибка при поиске страницы по Instagram');
    // Fallback: пробуем обычный поиск
    log.info({ igHandle: cleanHandle }, 'Fallback на обычный поиск');
    return searchPageByName(cleanHandle, country);
  }
}
