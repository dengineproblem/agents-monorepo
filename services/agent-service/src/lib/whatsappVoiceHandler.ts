/**
 * Обработка голосовых сообщений из WhatsApp (Evolution API)
 *
 * - Скачивание аудио через Evolution API
 * - Транскрибирование через OpenAI Whisper
 */

import { OpenAI } from 'openai';
import { FastifyInstance } from 'fastify';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://evolution-api:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

// Лимиты
const MAX_VOICE_DURATION_SEC = 120; // 2 минуты максимум
const MAX_FILE_SIZE_MB = 25; // Лимит Whisper API

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// =====================================================
// Типы
// =====================================================

export interface WhatsAppAudioMessage {
  mimetype: string;
  fileLength?: string | number;
  seconds?: number;
  ptt?: boolean; // Push-to-talk (голосовое)
  mediaKey?: string;
  fileEncSha256?: string;
  directPath?: string;
  url?: string;
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
 * Скачивает аудио файл через Evolution API getBase64FromMediaMessage
 */
async function downloadAudioFromEvolution(
  instanceName: string,
  messageKey: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  },
  app: FastifyInstance
): Promise<Buffer | null> {
  try {
    const response = await fetch(`${EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${instanceName}`, {
      method: 'POST',
      headers: {
        'apikey': EVOLUTION_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: {
          key: messageKey
        },
        convertToMp4: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      app.log.error({
        status: response.status,
        errorText,
        instanceName
      }, 'Failed to get audio from Evolution API');
      return null;
    }

    const result = await response.json() as { base64?: string };

    if (!result.base64) {
      app.log.error({ instanceName }, 'No base64 data in Evolution API response');
      return null;
    }

    // Убираем data URL prefix если есть
    const base64Data = result.base64.replace(/^data:audio\/[^;]+;base64,/, '');
    return Buffer.from(base64Data, 'base64');
  } catch (error: any) {
    app.log.error({ error: error.message, instanceName }, 'Error downloading audio from Evolution');
    return null;
  }
}

/**
 * Транскрибирует голосовое сообщение из WhatsApp через Whisper
 */
export async function transcribeWhatsAppVoice(
  instanceName: string,
  messageKey: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  },
  audioMessage: WhatsAppAudioMessage,
  app: FastifyInstance
): Promise<TranscriptionResult> {
  const duration = audioMessage.seconds || 0;
  const fileSize = typeof audioMessage.fileLength === 'string'
    ? parseInt(audioMessage.fileLength, 10)
    : (audioMessage.fileLength || 0);

  app.log.info({
    instanceName,
    messageId: messageKey.id,
    duration,
    fileSize,
    mimetype: audioMessage.mimetype,
    isPtt: audioMessage.ptt
  }, 'Processing WhatsApp voice message');

  // Проверка длительности
  if (duration > MAX_VOICE_DURATION_SEC) {
    return {
      success: false,
      error: `Голосовое сообщение слишком длинное (${duration} сек). Максимум ${MAX_VOICE_DURATION_SEC} секунд.`,
      errorCode: 'TOO_LONG',
    };
  }

  // Проверка размера файла
  if (fileSize > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return {
      success: false,
      error: `Файл слишком большой. Максимум ${MAX_FILE_SIZE_MB} МБ.`,
      errorCode: 'TOO_LARGE',
    };
  }

  // Скачиваем аудио через Evolution API
  const audioBuffer = await downloadAudioFromEvolution(instanceName, messageKey, app);

  if (!audioBuffer) {
    return {
      success: false,
      error: 'Не удалось скачать голосовое сообщение.',
      errorCode: 'DOWNLOAD_FAILED',
    };
  }

  try {
    // Определяем расширение файла по mimetype
    const mimeToExt: Record<string, string> = {
      'audio/ogg': 'ogg',
      'audio/ogg; codecs=opus': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/aac': 'aac',
      'audio/wav': 'wav',
    };
    const ext = mimeToExt[audioMessage.mimetype] || 'ogg';

    // Транскрибируем через Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: await OpenAI.toFile(audioBuffer, `voice.${ext}`),
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

    app.log.info({
      instanceName,
      messageId: messageKey.id,
      textLength: text.length,
      duration: (transcription as any).duration,
    }, 'WhatsApp voice message transcribed successfully');

    return {
      success: true,
      text,
      duration: (transcription as any).duration || duration,
    };
  } catch (error: any) {
    app.log.error({
      error: error.message,
      instanceName,
      messageId: messageKey.id
    }, 'Whisper transcription failed for WhatsApp voice');

    // Проверяем специфичные ошибки Whisper
    if (error.message?.includes('audio') || error.message?.includes('Invalid')) {
      return {
        success: false,
        error: 'Не удалось распознать речь. Попробуйте записать сообщение ещё раз.',
        errorCode: 'LOW_QUALITY',
      };
    }

    return {
      success: false,
      error: 'Ошибка при распознавании речи.',
      errorCode: 'TRANSCRIPTION_FAILED',
    };
  }
}
