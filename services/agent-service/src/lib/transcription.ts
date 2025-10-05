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
