/**
 * Анализатор креативов конкурентов
 * OCR для изображений через GPT-4 Vision
 * ASR для видео через Whisper
 */

import { OpenAI } from 'openai';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { supabase } from './supabase.js';
import { createLogger } from './logger.js';
import { processVideoTranscription } from './transcription.js';

const log = createLogger({ module: 'creativeAnalyzer' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// ========================================
// OCR FUNCTIONS
// ========================================

/**
 * Извлечь текст с изображения через GPT-4 Vision
 */
export async function extractTextFromImage(imageUrl: string): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Извлеки ВЕСЬ текст с этого рекламного изображения.
Включи:
- Заголовки
- Основной текст
- Призывы к действию (CTA)
- Цены, скидки, акции
- Любой другой текст

Верни только извлеченный текст, без комментариев. Если текста нет, верни пустую строку.`,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: 'high',
              },
            },
          ],
        },
      ],
      max_tokens: 1000,
    });

    return response.choices[0]?.message?.content?.trim() || '';
  } catch (error: any) {
    log.error({ err: error, imageUrl }, 'Ошибка OCR');
    throw new Error(`OCR failed: ${error.message}`);
  }
}

// ========================================
// VIDEO PROCESSING
// ========================================

/**
 * Скачать файл по URL во временную директорию
 */
async function downloadFile(url: string, extension: string): Promise<string> {
  const filePath = path.join('/tmp', `download_${randomUUID()}.${extension}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  return filePath;
}

/**
 * Транскрибировать видео по URL
 */
export async function transcribeVideoFromUrl(videoUrl: string, language: string = 'ru'): Promise<{
  text: string;
  language: string;
  duration?: number;
}> {
  let videoPath: string | null = null;

  try {
    // Скачиваем видео
    log.info({ videoUrl }, 'Скачивание видео для транскрипции');
    videoPath = await downloadFile(videoUrl, 'mp4');

    // Транскрибируем
    const result = await processVideoTranscription(videoPath, language);

    log.info({ videoUrl, textLength: result.text.length }, 'Видео транскрибировано');
    return result;
  } finally {
    // Удаляем временный файл
    if (videoPath) {
      try {
        await fs.unlink(videoPath);
      } catch (err) {
        log.warn({ err, videoPath }, 'Не удалось удалить временный файл видео');
      }
    }
  }
}

// ========================================
// CREATIVE ANALYSIS
// ========================================

interface AnalysisResult {
  transcript?: string;
  transcript_lang?: string;
  ocr_text?: string;
  processing_status: 'completed' | 'failed';
  error_message?: string;
}

/**
 * Проанализировать один креатив
 */
export async function analyzeCreative(creativeId: string): Promise<AnalysisResult> {
  // Получаем данные креатива
  const { data: creative, error: fetchError } = await supabase
    .from('competitor_creatives')
    .select('id, media_type, media_urls, thumbnail_url')
    .eq('id', creativeId)
    .single();

  if (fetchError || !creative) {
    return {
      processing_status: 'failed',
      error_message: 'Креатив не найден',
    };
  }

  const result: AnalysisResult = {
    processing_status: 'completed',
  };

  try {
    const mediaUrls = creative.media_urls as string[] || [];

    if (creative.media_type === 'video' && mediaUrls.length > 0) {
      // Транскрибируем видео
      try {
        const transcription = await transcribeVideoFromUrl(mediaUrls[0]);
        result.transcript = transcription.text;
        result.transcript_lang = transcription.language;
      } catch (err: any) {
        log.warn({ err, creativeId }, 'Не удалось транскрибировать видео');
        // Пробуем OCR по thumbnail
        if (creative.thumbnail_url) {
          try {
            result.ocr_text = await extractTextFromImage(creative.thumbnail_url);
          } catch (ocrErr) {
            log.warn({ err: ocrErr, creativeId }, 'Не удалось OCR thumbnail');
          }
        }
      }
    } else if (creative.media_type === 'image' && mediaUrls.length > 0) {
      // OCR для изображений
      try {
        result.ocr_text = await extractTextFromImage(mediaUrls[0]);
      } catch (err: any) {
        log.warn({ err, creativeId }, 'Не удалось OCR изображение');
      }
    } else if (creative.media_type === 'carousel' && mediaUrls.length > 0) {
      // OCR для всех изображений карусели
      const ocrTexts: string[] = [];
      for (const url of mediaUrls.slice(0, 5)) { // Максимум 5 изображений
        try {
          const text = await extractTextFromImage(url);
          if (text) {
            ocrTexts.push(text);
          }
        } catch (err) {
          log.warn({ err, url, creativeId }, 'Не удалось OCR изображение карусели');
        }
      }
      result.ocr_text = ocrTexts.join('\n---\n');
    }

    // Если ничего не извлекли
    if (!result.transcript && !result.ocr_text) {
      result.processing_status = 'failed';
      result.error_message = 'Не удалось извлечь текст';
    }
  } catch (error: any) {
    result.processing_status = 'failed';
    result.error_message = error.message;
  }

  return result;
}

// ========================================
// BATCH PROCESSING
// ========================================

/**
 * Обработать очередь креативов на анализ
 */
export async function processAnalysisQueue(limit: number = 10): Promise<{
  processed: number;
  failed: number;
}> {
  // Получаем креативы в очереди
  const { data: queue, error } = await supabase
    .from('competitor_creative_analysis')
    .select('id, creative_id')
    .eq('processing_status', 'pending')
    .limit(limit);

  if (error || !queue || queue.length === 0) {
    return { processed: 0, failed: 0 };
  }

  log.info({ count: queue.length }, 'Обработка очереди анализа');

  let processed = 0;
  let failed = 0;

  for (const item of queue) {
    try {
      // Обновляем статус на processing
      await supabase
        .from('competitor_creative_analysis')
        .update({ processing_status: 'processing' })
        .eq('id', item.id);

      // Анализируем
      const result = await analyzeCreative(item.creative_id);

      // Сохраняем результат
      await supabase
        .from('competitor_creative_analysis')
        .update({
          transcript: result.transcript || null,
          transcript_lang: result.transcript_lang || null,
          ocr_text: result.ocr_text || null,
          processing_status: result.processing_status,
          error_message: result.error_message || null,
        })
        .eq('id', item.id);

      if (result.processing_status === 'completed') {
        processed++;
      } else {
        failed++;
      }

      // Пауза между запросами к API
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err: any) {
      log.error({ err, analysisId: item.id }, 'Ошибка обработки креатива');

      await supabase
        .from('competitor_creative_analysis')
        .update({
          processing_status: 'failed',
          error_message: err.message,
        })
        .eq('id', item.id);

      failed++;
    }
  }

  log.info({ processed, failed }, 'Обработка очереди завершена');
  return { processed, failed };
}
