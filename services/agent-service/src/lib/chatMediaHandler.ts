/**
 * Обработка медиа-файлов (голосовые, фото) из Telegram для чата техподдержки
 *
 * - Скачивание файлов через Telegram Bot API
 * - Загрузка в Supabase Storage bucket 'chat-media'
 * - Возврат публичных URL
 */

import { supabase } from './supabase.js';
import { createLogger } from './logger.js';
import { randomUUID } from 'crypto';

const log = createLogger({ module: 'chatMediaHandler' });

const SUPPORT_BOT_TOKEN = process.env.SUPPORT_BOT_TELEGRAM_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${SUPPORT_BOT_TOKEN}`;
const TELEGRAM_FILE_URL = `https://api.telegram.org/file/bot${SUPPORT_BOT_TOKEN}`;

const BUCKET_NAME = 'chat-media';
const FETCH_TIMEOUT_MS = 30000; // 30 секунд
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB (лимит Telegram)

let bucketInitialized = false;

// =====================================================
// Типы
// =====================================================

interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface MediaUploadResult {
  url: string;
  metadata: {
    file_size?: number;
    content_type?: string;
    [key: string]: any;
  };
}

// =====================================================
// Приватные функции для работы с Telegram API
// =====================================================

/**
 * Получает информацию о файле через Telegram API
 */
async function getFileInfo(fileId: string): Promise<TelegramFile | null> {
  try {
    const response = await fetch(`${TELEGRAM_API_URL}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });

    const result = (await response.json()) as { ok: boolean; result?: TelegramFile };

    if (result.ok && result.result) {
      return result.result;
    }

    log.error({ result, fileId }, 'Failed to get file info from Telegram');
    return null;
  } catch (error) {
    log.error({ error: String(error), fileId }, 'Error calling Telegram getFile');
    return null;
  }
}

/**
 * Скачивает файл из Telegram
 */
async function downloadTelegramFile(filePath: string): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      const url = `${TELEGRAM_FILE_URL}/${filePath}`;
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      log.error({ status: response.status, filePath }, 'Failed to download file from Telegram');
      return null;
    }

    // Проверяем размер файла
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE_BYTES) {
      log.error({ contentLength, filePath }, 'File too large');
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();

    // Дополнительная проверка после загрузки
    if (arrayBuffer.byteLength > MAX_FILE_SIZE_BYTES) {
      log.error({ size: arrayBuffer.byteLength, filePath }, 'File too large after download');
      return null;
    }

    return Buffer.from(arrayBuffer);
  } catch (error) {
    log.error({ error: String(error), filePath }, 'Error downloading Telegram file');
    return null;
  }
}

// =====================================================
// Supabase Storage
// =====================================================

/**
 * Создаёт bucket 'chat-media' если не существует (ленивая инициализация)
 */
async function ensureChatMediaBucketExists(): Promise<void> {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();

    const bucketExists = buckets?.some(b => b.name === BUCKET_NAME);

    if (!bucketExists) {
      const { error } = await supabase.storage.createBucket(BUCKET_NAME, {
        public: true,
        fileSizeLimit: MAX_FILE_SIZE_BYTES,
        allowedMimeTypes: [
          'audio/ogg',
          'audio/mpeg',
          'audio/mp4',
          'image/jpeg',
          'image/png',
          'image/webp',
        ],
      });

      if (error && !error.message.includes('already exists')) {
        log.error({ error: error.message }, `Failed to create bucket ${BUCKET_NAME}`);
      } else {
        log.info(`Bucket "${BUCKET_NAME}" created successfully`);
      }
    }
  } catch (err) {
    log.warn({ error: String(err) }, `Error checking/creating bucket ${BUCKET_NAME}`);
  }
}

/**
 * Определяет расширение файла по типу контента
 */
function getFileExtension(contentType: string, mediaType: 'voice' | 'photo'): string {
  if (mediaType === 'voice') {
    if (contentType.includes('ogg')) return 'ogg';
    if (contentType.includes('mpeg') || contentType.includes('mp3')) return 'mp3';
    if (contentType.includes('mp4')) return 'm4a';
    return 'ogg'; // default для голосовых
  }

  if (mediaType === 'photo') {
    if (contentType.includes('png')) return 'png';
    if (contentType.includes('webp')) return 'webp';
    return 'jpg'; // default для фото
  }

  return 'bin';
}

/**
 * Определяет MIME type для медиа типа
 */
function getContentType(mediaType: 'voice' | 'photo'): string {
  return mediaType === 'voice' ? 'audio/ogg' : 'image/jpeg';
}

// =====================================================
// Основная функция
// =====================================================

/**
 * Загружает медиа файл из Telegram в Supabase Storage
 *
 * @param fileId - Telegram file_id
 * @param userId - ID пользователя (для организации папок)
 * @param mediaType - Тип медиа ('voice' или 'photo')
 * @returns {url, metadata} или null при ошибке
 */
export async function uploadTelegramMediaToStorage(
  fileId: string,
  userId: string,
  mediaType: 'voice' | 'photo'
): Promise<MediaUploadResult | null> {
  log.info({ fileId, userId, mediaType }, 'Uploading Telegram media to storage');

  try {
    // Ленивая инициализация bucket
    if (!bucketInitialized) {
      await ensureChatMediaBucketExists();
      bucketInitialized = true;
    }

    // 1. Получаем информацию о файле
    const fileInfo = await getFileInfo(fileId);
    if (!fileInfo?.file_path) {
      log.error({ fileId }, 'Failed to get file info');
      return null;
    }

    // 2. Скачиваем файл
    const buffer = await downloadTelegramFile(fileInfo.file_path);
    if (!buffer) {
      log.error({ fileId, filePath: fileInfo.file_path }, 'Failed to download file');
      return null;
    }

    // 3. Определяем тип контента и расширение
    const contentType = getContentType(mediaType);
    const extension = getFileExtension(contentType, mediaType);

    // 4. Генерируем уникальное имя файла
    // Структура: voice/{userId}/{uuid}.ogg или photo/{userId}/{uuid}.jpg
    const fileName = `${mediaType}/${userId}/${randomUUID()}.${extension}`;

    // 5. Загружаем в Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, buffer, {
        contentType,
        cacheControl: '31536000', // Кэш на 1 год
        upsert: false,
      });

    if (uploadError) {
      log.error(
        { error: uploadError.message, fileName, userId },
        'Failed to upload to Supabase Storage'
      );
      return null;
    }

    // 6. Получаем публичный URL
    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName);

    if (!publicUrlData?.publicUrl) {
      log.error({ fileName }, 'Failed to get public URL');
      return null;
    }

    log.info(
      {
        fileId,
        userId,
        mediaType,
        fileName,
        url: publicUrlData.publicUrl,
      },
      'Media uploaded successfully'
    );

    return {
      url: publicUrlData.publicUrl,
      metadata: {
        file_size: fileInfo.file_size,
        content_type: contentType,
      },
    };
  } catch (error) {
    log.error(
      { error: String(error), fileId, userId, mediaType },
      'Error uploading media to storage'
    );
    return null;
  }
}
