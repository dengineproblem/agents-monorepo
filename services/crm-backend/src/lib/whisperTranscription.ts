import { OpenAI } from 'openai';
import { createLogger } from './logger.js';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

const log = createLogger({ module: 'whisperTranscription' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

/**
 * Post-process transcription with GPT-4o to split into dialogue format
 * Менеджер: / Клиент:
 */
export async function formatTranscriptionAsDialogue(rawText: string): Promise<string> {
  try {
    log.info({ textLength: rawText.length }, 'Formatting transcription as dialogue');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: `Ты — эксперт по обработке транскрипций звонков. Твоя задача — разделить сплошной текст транскрипции на реплики двух участников: Менеджер и Клиент.

Правила:
- Менеджер — тот, кто задаёт вопросы о потребностях, презентует продукт/услугу, предлагает решения, ведёт разговор
- Клиент — тот, кто описывает свою ситуацию, задаёт вопросы о продукте/цене, высказывает возражения
- Каждая реплика начинается с "Менеджер:" или "Клиент:" на новой строке
- Не добавляй ничего от себя, используй только текст из транскрипции
- Не пропускай текст, весь текст должен быть распределён по репликам
- Если непонятно кто говорит — используй контекст разговора для определения
- Между репликами ставь пустую строку для читабельности`
        },
        {
          role: 'user',
          content: rawText
        }
      ],
    });

    const dialogue = response.choices[0]?.message?.content;
    if (!dialogue) {
      log.warn('GPT returned empty dialogue, using raw text');
      return rawText;
    }

    log.info({
      rawLength: rawText.length,
      dialogueLength: dialogue.length
    }, 'Transcription formatted as dialogue');

    return dialogue;
  } catch (error: any) {
    log.error({ error: error.message }, 'Failed to format transcription as dialogue, using raw text');
    return rawText;
  }
}

/**
 * Transcribe audio file using OpenAI Whisper API
 * @param audioBuffer - Buffer containing audio data
 * @param filename - Original filename (used for file type detection)
 * @returns Transcribed text in Russian
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  options?: { language?: string }
): Promise<string> {
  try {
    log.info({ filename, size: audioBuffer.length }, 'Starting audio transcription');

    // Whisper API requires a file-like object
    // We need to create a File object from the buffer
    const file = new File([audioBuffer as any], filename, {
      type: getAudioMimeType(filename)
    });

    const response = await openai.audio.transcriptions.create({
      file: file,
      model: 'whisper-1',
      language: options?.language ?? 'ru',
      response_format: 'text',
    });

    log.info({ 
      filename, 
      transcriptLength: response.length 
    }, 'Audio transcribed successfully');

    return response;
  } catch (error: any) {
    log.error({ 
      error: error.message, 
      filename 
    }, 'Failed to transcribe audio');
    throw new Error(`Transcription failed: ${error.message}`);
  }
}

/**
 * Get MIME type based on file extension
 */
function getAudioMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  
  const mimeTypes: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.mp4': 'audio/mp4',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.webm': 'audio/webm',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
  };

  return mimeTypes[ext] || 'audio/mpeg';
}

/**
 * Validate audio file size and format
 */
export function validateAudioFile(filename: string, size: number): { valid: boolean; error?: string } {
  // Max file size: 25 MB (Whisper API limit)
  const MAX_SIZE = 25 * 1024 * 1024;
  
  if (size > MAX_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size is 25 MB, got ${(size / 1024 / 1024).toFixed(2)} MB`
    };
  }

  // Check supported formats
  const ext = path.extname(filename).toLowerCase();
  const supportedFormats = ['.mp3', '.mp4', '.m4a', '.wav', '.webm', '.ogg', '.flac'];
  
  if (!supportedFormats.includes(ext)) {
    return {
      valid: false,
      error: `Unsupported format. Supported: ${supportedFormats.join(', ')}`
    };
  }

  return { valid: true };
}

