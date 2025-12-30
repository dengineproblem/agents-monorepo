/**
 * Модуль для кэширования изображений в Supabase Storage
 * Решает проблему истекающих URL Facebook CDN
 */

import { supabase } from './supabase.js';
import { randomUUID } from 'crypto';

const BUCKET_NAME = 'competitor-creatives';
const AVATARS_BUCKET_NAME = 'account-avatars';
const FETCH_TIMEOUT_MS = 30000; // 30 секунд таймаут
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB лимит

// Флаги для ленивой инициализации buckets
let bucketInitialized = false;
let avatarsBucketInitialized = false;

/**
 * Скачивает изображение по URL и загружает в Supabase Storage
 * @param imageUrl - URL изображения (Facebook CDN или другой)
 * @param competitorId - ID конкурента (для организации папок)
 * @returns URL изображения в Supabase Storage или null при ошибке
 */
export async function cacheImageToStorage(
  imageUrl: string,
  competitorId: string
): Promise<string | null> {
  try {
    // Проверяем, нужно ли кэшировать (только Facebook/Instagram CDN)
    if (!isFacebookCdnUrl(imageUrl)) {
      return imageUrl; // Возвращаем оригинальный URL для других источников
    }

    // Ленивая инициализация bucket
    if (!bucketInitialized) {
      await ensureBucketExists();
      bucketInitialized = true;
    }

    // Скачиваем изображение с таймаутом
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      console.warn(`[ImageCache] Failed to fetch image: ${response.status} for competitor ${competitorId}`);
      return null;
    }

    // Проверяем размер файла
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE_BYTES) {
      console.warn(`[ImageCache] Image too large (${contentLength} bytes) for competitor ${competitorId}`);
      return null;
    }

    // Определяем тип контента
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const extension = getExtensionFromContentType(contentType);

    // Генерируем уникальное имя файла
    const fileName = `${competitorId}/${randomUUID()}.${extension}`;

    // Получаем буфер изображения
    const arrayBuffer = await response.arrayBuffer();

    // Дополнительная проверка размера после загрузки
    if (arrayBuffer.byteLength > MAX_FILE_SIZE_BYTES) {
      console.warn(`[ImageCache] Image too large after download (${arrayBuffer.byteLength} bytes) for competitor ${competitorId}`);
      return null;
    }

    const buffer = Buffer.from(arrayBuffer);

    // Загружаем в Supabase Storage
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, buffer, {
        contentType,
        cacheControl: '31536000', // Кэш на 1 год
        upsert: false,
      });

    if (error) {
      console.warn(`[ImageCache] Failed to upload to storage for competitor ${competitorId}: ${error.message}`);
      return null;
    }

    // Получаем публичный URL
    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName);

    return publicUrlData.publicUrl;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn(`[ImageCache] Fetch timeout for competitor ${competitorId}`);
    } else {
      console.warn(`[ImageCache] Error caching image for competitor ${competitorId}: ${err}`);
    }
    return null;
  }
}

/**
 * Проверяет, является ли URL Facebook/Instagram CDN
 */
function isFacebookCdnUrl(url: string): boolean {
  return url.includes('fbcdn.net') ||
         url.includes('facebook.com') ||
         url.includes('fb.com') ||
         url.includes('cdninstagram.com');
}

/**
 * Получает расширение файла по Content-Type
 */
function getExtensionFromContentType(contentType: string): string {
  const types: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
  };
  return types[contentType] || 'jpg';
}

/**
 * Удаляет кэшированные изображения конкурента
 * @param competitorId - ID конкурента
 */
export async function deleteCompetitorImages(competitorId: string): Promise<void> {
  try {
    const { data: files, error: listError } = await supabase.storage
      .from(BUCKET_NAME)
      .list(competitorId);

    if (listError || !files || files.length === 0) {
      return;
    }

    const filePaths = files.map(file => `${competitorId}/${file.name}`);

    const { error: deleteError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove(filePaths);

    if (deleteError) {
      console.warn(`[ImageCache] Failed to delete images for ${competitorId}: ${deleteError.message}`);
    }
  } catch (err) {
    console.warn(`[ImageCache] Error deleting images: ${err}`);
  }
}

/**
 * Создаёт bucket если он не существует
 */
export async function ensureBucketExists(): Promise<void> {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();

    const bucketExists = buckets?.some(b => b.name === BUCKET_NAME);

    if (!bucketExists) {
      const { error } = await supabase.storage.createBucket(BUCKET_NAME, {
        public: true,
        fileSizeLimit: 10485760, // 10MB
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4'],
      });

      if (error && !error.message.includes('already exists')) {
        console.error(`[ImageCache] Failed to create bucket: ${error.message}`);
      } else {
        console.log(`[ImageCache] Bucket "${BUCKET_NAME}" created`);
      }
    }
  } catch (err) {
    console.warn(`[ImageCache] Error checking/creating bucket: ${err}`);
  }
}

/**
 * Создаёт bucket для аватаров если он не существует
 */
async function ensureAvatarsBucketExists(): Promise<void> {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();

    const bucketExists = buckets?.some(b => b.name === AVATARS_BUCKET_NAME);

    if (!bucketExists) {
      const { error } = await supabase.storage.createBucket(AVATARS_BUCKET_NAME, {
        public: true,
        fileSizeLimit: 1048576, // 1MB (аватары маленькие)
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      });

      if (error && !error.message.includes('already exists')) {
        console.error(`[ImageCache] Failed to create avatars bucket: ${error.message}`);
      } else {
        console.log(`[ImageCache] Bucket "${AVATARS_BUCKET_NAME}" created`);
      }
    }
  } catch (err) {
    console.warn(`[ImageCache] Error checking/creating avatars bucket: ${err}`);
  }
}

/**
 * Кэширует аватар страницы Facebook в Supabase Storage
 * @param imageUrl - URL аватара (Facebook CDN)
 * @param accountId - ID рекламного аккаунта
 * @returns URL изображения в Supabase Storage или null при ошибке
 */
export async function cachePageAvatarToStorage(
  imageUrl: string,
  accountId: string
): Promise<string | null> {
  try {
    // Проверяем, является ли это FB CDN URL
    if (!isFacebookCdnUrl(imageUrl)) {
      return imageUrl; // Возвращаем оригинальный URL для других источников
    }

    // Ленивая инициализация bucket
    if (!avatarsBucketInitialized) {
      await ensureAvatarsBucketExists();
      avatarsBucketInitialized = true;
    }

    // Скачиваем изображение с таймаутом
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      console.warn(`[ImageCache] Failed to fetch avatar: ${response.status} for account ${accountId}`);
      return null;
    }

    // Определяем тип контента
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const extension = getExtensionFromContentType(contentType);

    // Используем accountId как имя файла (перезаписываем при обновлении)
    const fileName = `${accountId}.${extension}`;

    // Получаем буфер изображения
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Загружаем в Supabase Storage (upsert: true для перезаписи)
    const { error } = await supabase.storage
      .from(AVATARS_BUCKET_NAME)
      .upload(fileName, buffer, {
        contentType,
        cacheControl: '31536000', // Кэш на 1 год
        upsert: true, // Перезаписываем если существует
      });

    if (error) {
      console.warn(`[ImageCache] Failed to upload avatar for account ${accountId}: ${error.message}`);
      return null;
    }

    // Получаем публичный URL
    const { data: publicUrlData } = supabase.storage
      .from(AVATARS_BUCKET_NAME)
      .getPublicUrl(fileName);

    console.log(`[ImageCache] Avatar cached for account ${accountId}`);
    return publicUrlData.publicUrl;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn(`[ImageCache] Fetch timeout for account ${accountId}`);
    } else {
      console.warn(`[ImageCache] Error caching avatar for account ${accountId}: ${err}`);
    }
    return null;
  }
}
