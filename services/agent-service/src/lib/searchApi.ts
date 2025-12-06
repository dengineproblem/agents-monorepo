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

  const trimmed = url.trim();

  // Паттерны для Instagram URL
  const urlPatterns = [
    // instagram.com/username или instagram.com/username/
    /instagram\.com\/([a-z0-9._]+)\/?$/i,
  ];

  for (const pattern of urlPatterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  // @username формат — убираем @
  if (trimmed.startsWith('@')) {
    const handle = trimmed.slice(1);
    if (/^[a-z0-9._]+$/i.test(handle)) {
      return handle;
    }
  }

  // Просто username (буквы, цифры, точки, подчёркивания)
  if (/^[a-z0-9._]+$/i.test(trimmed) && trimmed.length >= 2) {
    return trimmed;
  }

  return null;
}

/**
 * Проверяет, является ли ввод Instagram (URL, @handle или username)
 * Возвращает true если это НЕ Facebook URL
 */
export function isInstagramUrl(url: string): boolean {
  if (!url) return false;
  const normalized = url.trim().toLowerCase();

  // Точно Facebook — не Instagram
  if (normalized.includes('facebook.com') || normalized.includes('fb.com')) {
    return false;
  }

  // Instagram URL
  if (normalized.includes('instagram.com')) {
    return true;
  }

  // @username или просто username — считаем Instagram
  if (normalized.startsWith('@') || /^[a-z0-9._]+$/i.test(normalized)) {
    return true;
  }

  return false;
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
 * Выполняет один запрос к SearchAPI
 */
async function fetchFromSearchApi(
  params: URLSearchParams,
  searchType: string,
  query: string
): Promise<SearchApiAd[]> {
  try {
    const response = await fetch(`https://www.searchapi.io/api/v1/search?${params}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error({ status: response.status, error: errorText, query, searchType }, 'SearchAPI вернул ошибку');
      return [];
    }

    const data: SearchApiResponse = await response.json();

    // "no results" - не ошибка, просто пустой массив
    const isNoResultsError = data.error === "Meta Ad Library didn't return any results.";
    if (data.error && !isNoResultsError) {
      log.error({ error: data.error, query, searchType }, 'SearchAPI вернул ошибку в ответе');
      return [];
    }

    const ads = data.ads || [];
    log.info({ adsCount: ads.length, searchType, query }, 'Получены креативы из SearchAPI');

    // Логируем структуру первого объявления для отладки
    if (ads.length > 0) {
      const firstAd = ads[0];
      log.info({
        ad_archive_id: firstAd.ad_archive_id,
        page_id: firstAd.page_id,
        page_name: firstAd.page_name,
        // Ищем поля связанные с Instagram
        ig_username: (firstAd as any).ig_username,
        instagram_handle: (firstAd as any).instagram_handle,
        publisher_platform: firstAd.publisher_platform,
        allKeys: Object.keys(firstAd),
      }, 'Структура первого объявления');
    }

    return ads;
  } catch (error: any) {
    log.error({ err: error, query, searchType }, 'Ошибка при запросе к SearchAPI');
    return [];
  }
}

/**
 * Получить креативы конкурента из Meta Ads Library через SearchAPI
 *
 * ЛОГИКА: Всегда выполняем ОБА поиска (по page_id и по текстовому запросу),
 * объединяем результаты, удаляем дубликаты и возвращаем лучшие 30 креативов.
 *
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

  // Для "всех стран" используем 'ALL' (uppercase, как требует SearchAPI), иначе код страны
  const countryParam = country === 'ALL' ? 'ALL' : country;
  const finalLimit = options.limit || 30; // По умолчанию 30 лучших

  // Базовые параметры
  const baseParams = {
    engine: 'meta_ad_library',
    country: countryParam,
    ad_type: 'all',
    media_type: 'all',
    active_status: 'all', // Включаем неактивные креативы тоже
    api_key: apiKey,
  };

  // ===========================================
  // НОВАЯ ЛОГИКА: Всегда делаем ОБА запроса параллельно
  // ===========================================
  const searchPromises: Promise<SearchApiAd[]>[] = [];

  // 1. Поиск по page_id (если есть)
  if (options.targetPageId) {
    const pageIdParams = new URLSearchParams({ ...baseParams, page_id: options.targetPageId });
    log.info({ pageId: options.targetPageId, country }, 'Запрос креативов по page_id');
    searchPromises.push(fetchFromSearchApi(pageIdParams, 'page_id', options.targetPageId));
  }

  // 2. Поиск по текстовому запросу (всегда, если есть pageIdOrName)
  if (pageIdOrName) {
    const queryParams = new URLSearchParams({ ...baseParams, q: pageIdOrName });
    log.info({ query: pageIdOrName, country }, 'Запрос креативов по текстовому запросу');
    searchPromises.push(fetchFromSearchApi(queryParams, 'text_query', pageIdOrName));
  }

  if (searchPromises.length === 0) {
    log.warn('Нет параметров для поиска (ни page_id, ни текстовый запрос)');
    return [];
  }

  // Выполняем все запросы параллельно
  const results = await Promise.all(searchPromises);

  // Объединяем результаты
  let allAds: SearchApiAd[] = [];
  for (const ads of results) {
    allAds = allAds.concat(ads);
  }

  log.info({
    totalAdsBeforeDedup: allAds.length,
    sources: results.map((r, i) => ({ index: i, count: r.length }))
  }, 'Объединение результатов из всех источников');

  // ===========================================
  // Удаляем дубликаты по ad_archive_id
  // ===========================================
  const seenIds = new Set<string>();
  const uniqueAds: SearchApiAd[] = [];

  for (const ad of allAds) {
    if (ad.ad_archive_id && !seenIds.has(ad.ad_archive_id)) {
      seenIds.add(ad.ad_archive_id);
      uniqueAds.push(ad);
    }
  }

  log.info({
    beforeDedup: allAds.length,
    afterDedup: uniqueAds.length,
    duplicatesRemoved: allAds.length - uniqueAds.length
  }, 'Дедупликация по ad_archive_id');

  let ads = uniqueAds;

  // =====================================================
  // ОПТИМИЗАЦИЯ: сортировка и отбор лучших
  // Критерии: активные + самые долго работающие (по start_date)
  // =====================================================
  const PREFILTER_LIMIT = Math.max(50, finalLimit);

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

  // Ограничиваем до финального лимита
  if (creatives.length > finalLimit) {
    log.info({ before: creatives.length, after: finalLimit }, 'Применён финальный лимит');
    return creatives.slice(0, finalLimit);
  }

  return creatives;
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

    // Логируем полную структуру первого результата для отладки
    if (pageResults.length > 0) {
      log.info({ firstResult: JSON.stringify(pageResults[0]) }, 'Структура первого результата SearchAPI');
    }

    log.info({
      igHandle: cleanHandle,
      resultsCount: pageResults.length,
      results: pageResults.slice(0, 5).map((p: any) => ({
        page_id: p.page_id,
        name: p.name,
        ig_username: p.ig_username,
        page_alias: p.page_alias,
      }))
    }, 'Результаты поиска по Instagram');

    const mappedResults = pageResults.map((page: any) => ({
      page_id: page.page_id,
      page_name: page.name,
      avatar_url: page.image_uri,
      instagram_handle: page.ig_username || page.page_alias,
    }));

    // Приоритизируем ТОЧНОЕ совпадение по ig_username (с учётом точек!)
    const exactMatchByHandle = mappedResults.find((p: any) =>
      p.instagram_handle && p.instagram_handle.toLowerCase() === cleanHandle.toLowerCase()
    );

    if (exactMatchByHandle) {
      log.info({ igHandle: cleanHandle, matchedPage: exactMatchByHandle.page_name, matchedIg: exactMatchByHandle.instagram_handle }, 'Найдено точное совпадение по Instagram handle');
      return [exactMatchByHandle, ...mappedResults.filter((p: any) => p.page_id !== exactMatchByHandle.page_id)];
    }

    // Если точного совпадения нет — возвращаем пустой массив, чтобы не добавлять неправильного конкурента
    log.warn({ igHandle: cleanHandle, availableHandles: mappedResults.map((p: any) => p.instagram_handle) }, 'Точное совпадение не найдено');
    return [];
  } catch (error: any) {
    log.error({ err: error, igHandle }, 'Ошибка при поиске страницы по Instagram');
    // Fallback: пробуем обычный поиск
    log.info({ igHandle: cleanHandle }, 'Fallback на обычный поиск');
    return searchPageByName(cleanHandle, country);
  }
}

/**
 * Получить свежий URL для конкретного креатива через SearchAPI
 * Используется когда URL истёк (Facebook CDN URLs expire after a few hours)
 *
 * @param fbAdArchiveId - ID креатива в Facebook Ad Library
 * @param competitorName - Название конкурента для поиска
 * @param countryCode - Код страны
 * @param pageId - Facebook page_id (опционально, для более точного поиска)
 * @returns Свежие media_urls или null если креатив не найден
 */
export async function refreshCreativeMediaUrl(
  fbAdArchiveId: string,
  competitorName: string,
  countryCode: string = 'ALL',
  pageId?: string
): Promise<{ media_urls: string[]; thumbnail_url: string | null } | null> {
  const apiKey = process.env.SEARCHAPI_KEY;

  if (!apiKey) {
    log.error('SEARCHAPI_KEY не настроен');
    return null;
  }

  log.info({ fbAdArchiveId, competitorName, countryCode, pageId }, '[refreshCreativeMediaUrl] Запрашиваем свежий URL');

  try {
    // Формируем параметры запроса
    const baseParams: Record<string, string> = {
      engine: 'meta_ad_library',
      country: countryCode === 'ALL' ? 'ALL' : countryCode,
      ad_type: 'all',
      media_type: 'all',
      active_status: 'all',
      api_key: apiKey,
    };

    const searchPromises: Promise<SearchApiAd[]>[] = [];

    // 1. Поиск по page_id если есть
    if (pageId) {
      const pageIdParams = new URLSearchParams({ ...baseParams, page_id: pageId });
      searchPromises.push(fetchFromSearchApi(pageIdParams, 'page_id_refresh', pageId));
    }

    // 2. Поиск по названию конкурента
    const queryParams = new URLSearchParams({ ...baseParams, q: competitorName });
    searchPromises.push(fetchFromSearchApi(queryParams, 'name_refresh', competitorName));

    // Выполняем все запросы параллельно
    const results = await Promise.all(searchPromises);

    // Объединяем результаты
    let allAds: SearchApiAd[] = [];
    for (const ads of results) {
      allAds = allAds.concat(ads);
    }

    // Ищем креатив по fb_ad_archive_id
    const targetAd = allAds.find(ad => ad.ad_archive_id === fbAdArchiveId);

    if (!targetAd) {
      log.warn({ fbAdArchiveId, totalAds: allAds.length }, '[refreshCreativeMediaUrl] Креатив не найден в результатах');
      return null;
    }

    // Извлекаем свежие URL
    const creativeData = transformAdToCreativeData(targetAd);

    log.info({
      fbAdArchiveId,
      newMediaUrls: creativeData.media_urls.length,
      newThumbnail: !!creativeData.thumbnail_url
    }, '[refreshCreativeMediaUrl] Получены свежие URL');

    return {
      media_urls: creativeData.media_urls,
      thumbnail_url: creativeData.thumbnail_url,
    };

  } catch (error: any) {
    log.error({ err: error, fbAdArchiveId }, '[refreshCreativeMediaUrl] Ошибка при обновлении URL');
    return null;
  }
}
