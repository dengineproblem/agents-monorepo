/**
 * Обработка голосовых сообщений из Telegram
 *
 * - Скачивание файла через Telegram API
 * - Транскрибирование через OpenAI Whisper
 */

import { OpenAI } from 'openai';
import { createLogger } from '../logger.js';

const log = createLogger({ module: 'telegramVoiceHandler' });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8584683514:AAHMPrOyu4v_CT-Tf-k2exgEop-YQPRi3WM';
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const TELEGRAM_FILE_URL = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}`;

// Лимиты
const MAX_VOICE_DURATION_SEC = 120; // 2 минуты максимум
const MAX_FILE_SIZE_MB = 25; // Лимит Whisper API

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// =====================================================
// Типы
// =====================================================

export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number; // секунды
  mime_type?: string; // обычно audio/ogg
  file_size?: number;
}

interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface TranscriptionResult {
  success: boolean;
  text?: string;
  duration?: number;
  error?: string;
  errorCode?: 'TOO_LONG' | 'TOO_LARGE' | 'DOWNLOAD_FAILED' | 'TRANSCRIPTION_FAILED' | 'LOW_QUALITY';
}

// =====================================================
// Функции
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

    log.error({ result }, 'Failed to get file info from Telegram');
    return null;
  } catch (error) {
    log.error({ error: String(error) }, 'Error calling Telegram getFile');
    return null;
  }
}

/**
 * Скачивает файл из Telegram
 */
async function downloadTelegramFile(filePath: string): Promise<Buffer | null> {
  try {
    const url = `${TELEGRAM_FILE_URL}/${filePath}`;
    const response = await fetch(url);

    if (!response.ok) {
      log.error({ status: response.status }, 'Failed to download file from Telegram');
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    log.error({ error: String(error) }, 'Error downloading Telegram file');
    return null;
  }
}

/**
 * Транскрибирует голосовое сообщение из Telegram
 */
export async function transcribeVoiceMessage(voice: TelegramVoice): Promise<TranscriptionResult> {
  log.info(
    {
      fileId: voice.file_id,
      duration: voice.duration,
      fileSize: voice.file_size,
    },
    'Processing voice message'
  );

  // Проверка длительности
  if (voice.duration > MAX_VOICE_DURATION_SEC) {
    return {
      success: false,
      error: `Голосовое сообщение слишком длинное (${voice.duration} сек). Максимум ${MAX_VOICE_DURATION_SEC} секунд. Пожалуйста, запишите сообщение короче.`,
      errorCode: 'TOO_LONG',
    };
  }

  // Проверка размера файла
  if (voice.file_size && voice.file_size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return {
      success: false,
      error: `Файл слишком большой. Максимум ${MAX_FILE_SIZE_MB} МБ.`,
      errorCode: 'TOO_LARGE',
    };
  }

  // Получаем информацию о файле
  const fileInfo = await getFileInfo(voice.file_id);
  if (!fileInfo?.file_path) {
    return {
      success: false,
      error: 'Не удалось получить информацию о файле. Попробуйте записать сообщение ещё раз.',
      errorCode: 'DOWNLOAD_FAILED',
    };
  }

  // Скачиваем файл
  const fileBuffer = await downloadTelegramFile(fileInfo.file_path);
  if (!fileBuffer) {
    return {
      success: false,
      error: 'Не удалось скачать голосовое сообщение. Попробуйте ещё раз.',
      errorCode: 'DOWNLOAD_FAILED',
    };
  }

  try {
    // Транскрибируем через Whisper
    // Whisper API поддерживает OGG формат напрямую!
    const transcription = await openai.audio.transcriptions.create({
      file: await OpenAI.toFile(fileBuffer, 'voice.ogg'),
      model: 'whisper-1',
      language: 'ru',
      response_format: 'verbose_json',
    });

    const text = transcription.text.trim();

    if (!text) {
      return {
        success: false,
        error: 'Не удалось распознать речь. Попробуйте записать сообщение в тихом месте.',
        errorCode: 'LOW_QUALITY',
      };
    }

    log.info(
      {
        textLength: text.length,
        duration: (transcription as any).duration,
      },
      'Voice message transcribed successfully'
    );

    return {
      success: true,
      text,
      duration: (transcription as any).duration || voice.duration,
    };
  } catch (error: any) {
    log.error({ error: error.message }, 'Whisper transcription failed');

    // Проверяем специфичные ошибки Whisper
    if (error.message?.includes('audio') || error.message?.includes('Invalid')) {
      return {
        success: false,
        error: 'Не удалось распознать речь. Попробуйте записать сообщение ещё раз в тихом месте.',
        errorCode: 'LOW_QUALITY',
      };
    }

    return {
      success: false,
      error: 'Ошибка при распознавании речи. Попробуйте отправить текстом.',
      errorCode: 'TRANSCRIPTION_FAILED',
    };
  }
}
