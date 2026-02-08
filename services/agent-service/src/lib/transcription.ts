import { OpenAI } from 'openai';
import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

/**
 * Извлекает аудио из видео файла
 */
export async function extractAudioFromVideo(videoPath: string): Promise<string> {
  const audioPath = path.join('/tmp', `audio_${randomUUID()}.wav`);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('pcm_s16le')
      .audioFrequency(16000)
      .audioChannels(1)
      .output(audioPath)
      .on('end', () => resolve(audioPath))
      .on('error', (err: Error) => reject(new Error(`FFmpeg error: ${err.message}`)))
      .run();
  });
}

/**
 * Транскрибирует аудио файл с помощью OpenAI Whisper
 */
export async function transcribeAudio(audioPath: string, language: string = 'ru'): Promise<{
  text: string;
  language: string;
  duration?: number;
}> {
  const audioFile = await fs.readFile(audioPath);
  
  // OpenAI API принимает File или Blob, создаем через toFile helper
  const transcription = await openai.audio.transcriptions.create({
    file: await OpenAI.toFile(audioFile, 'audio.wav'),
    model: 'whisper-1',
    language: language,
    response_format: 'verbose_json'
  });

  return {
    text: transcription.text,
    language: (transcription as any).language || language,
    duration: (transcription as any).duration
  };
}

/**
 * Извлекает первый кадр видео как изображение для обложки
 */
export async function extractVideoThumbnail(videoPath: string): Promise<Buffer> {
  const thumbnailPath = path.join('/var/tmp', `thumbnail_${randomUUID()}.jpg`);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(0.001) // Первый кадр на 0.001 секунде
      .frames(1) // Извлекаем только 1 кадр
      .size('1200x628') // Масштабируем до оптимального размера для Facebook
      .output(thumbnailPath)
      .on('end', async () => {
        try {
          const buffer = await fs.readFile(thumbnailPath);
          await fs.unlink(thumbnailPath); // Удаляем временный файл
          resolve(buffer);
        } catch (err) {
          reject(err);
        }
      })
      .on('error', (err: Error) => reject(new Error(`FFmpeg thumbnail error: ${err.message}`)))
      .run();
  });
}

/**
 * Извлекает первый кадр видео для TikTok cover image.
 * TikTok принимает cover: 9:16, 1:1 или 16:9.
 * Для нестандартных пропорций (например 4:5) кропаем до ближайшего 9:16
 * с центрированием по высоте/ширине.
 * Минимальное разрешение: 720x1280 (9:16).
 */
export async function extractVideoThumbnail916(videoPath: string): Promise<Buffer> {
  const thumbnailPath = path.join('/var/tmp', `thumbnail_tiktok_${randomUUID()}.jpg`);

  // Определяем размеры видео
  const probe = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err) return reject(err);
      const stream = data.streams.find(s => s.codec_type === 'video');
      if (!stream || !stream.width || !stream.height) return reject(new Error('No video stream found'));
      resolve({ width: stream.width, height: stream.height });
    });
  });

  const ratio = probe.width / probe.height;

  // Определяем target: 9:16 (<= 0.625), 1:1 (0.625..1.333), 16:9 (>= 1.333)
  let targetW: number;
  let targetH: number;

  if (ratio <= 0.85) {
    // Вертикальное (9:16, 4:5 и уже) → кроп/scale до 720x1280
    targetW = 720; targetH = 1280;
  } else if (ratio <= 1.2) {
    // Квадратное → 640x640
    targetW = 640; targetH = 640;
  } else {
    // Горизонтальное → 1280x720
    targetW = 1280; targetH = 720;
  }

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(0.001)
      .frames(1)
      .videoFilters([
        // Масштабируем чтобы покрыть target (crop, не pad), потом кропаем по центру
        `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase`,
        `crop=${targetW}:${targetH}`
      ])
      .output(thumbnailPath)
      .on('end', async () => {
        try {
          const buffer = await fs.readFile(thumbnailPath);
          await fs.unlink(thumbnailPath);
          resolve(buffer);
        } catch (err) {
          reject(err);
        }
      })
      .on('error', (err: Error) => reject(new Error(`FFmpeg TikTok thumbnail error: ${err.message}`)))
      .run();
  });
}

/**
 * Обрабатывает видео: извлекает аудио и транскрибирует его
 */
export async function processVideoTranscription(
  videoPath: string,
  language: string = 'ru'
): Promise<{
  text: string;
  language: string;
  duration?: number;
}> {
  let audioPath: string | null = null;

  try {
    // Извлекаем аудио
    audioPath = await extractAudioFromVideo(videoPath);

    // Транскрибируем
    const result = await transcribeAudio(audioPath, language);

    return result;
  } finally {
    // Очищаем временные файлы
    if (audioPath) {
      try {
        await fs.unlink(audioPath);
      } catch (err) {
        console.error('Failed to delete audio file:', err);
      }
    }
  }
}
