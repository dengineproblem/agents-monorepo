/**
 * OpenAI Embeddings helper
 *
 * Получает векторные представления текста с помощью OpenAI text-embedding-3-small.
 * Используется для семантического поиска похожих инсайтов через pgvector.
 *
 * @module embeddings
 * @see https://platform.openai.com/docs/guides/embeddings
 */

import { OpenAI } from 'openai';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'embeddings' });

// Проверка API ключа при старте
if (!process.env.OPENAI_API_KEY) {
  log.warn('OPENAI_API_KEY not set, embeddings will fail');
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

/** Модель: text-embedding-3-small — быстрая и дешёвая ($0.02/1M токенов) */
const EMBEDDING_MODEL = 'text-embedding-3-small';

/** Размерность вектора: 1536 dimensions */
const EMBEDDING_DIMENSIONS = 1536;

/** Максимальное количество попыток при ошибках API */
const MAX_RETRIES = 3;

/** Задержка между попытками (мс) */
const RETRY_DELAY_MS = 1000;

/**
 * Задержка выполнения
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Получает embedding для одного текста
 *
 * @param text - Текст для векторизации
 * @returns Вектор embedding (1536 dimensions)
 * @throws Error если текст пустой или API недоступен
 *
 * @example
 * const embedding = await getEmbedding('Клиент спрашивает о скидках');
 * // [0.123, -0.456, ...] // 1536 чисел
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const normalizedText = text.trim().toLowerCase();

  if (!normalizedText) {
    throw new Error('Cannot get embedding for empty text');
  }

  const startTime = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: normalizedText,
      });

      log.debug({
        textLength: text.length,
        tokensUsed: response.usage?.total_tokens,
        durationMs: Date.now() - startTime
      }, 'Single embedding completed');

      return response.data[0].embedding;
    } catch (error: any) {
      lastError = error;
      const isRetryable = error.status === 429 || error.status >= 500;

      log.warn({
        error: error.message,
        status: error.status,
        attempt,
        maxRetries: MAX_RETRIES,
        isRetryable
      }, 'Embedding request failed');

      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt; // Exponential backoff
        log.debug({ delay }, 'Retrying after delay');
        await sleep(delay);
      } else {
        break;
      }
    }
  }

  log.error({
    error: lastError?.message,
    textLength: text.length,
    durationMs: Date.now() - startTime
  }, 'Failed to get embedding after all retries');

  throw lastError;
}

/**
 * Получает embeddings для нескольких текстов одним запросом (эффективнее)
 *
 * @param texts - Массив текстов для векторизации
 * @returns Массив векторов embedding (каждый 1536 dimensions)
 *
 * @description
 * Батч-запрос к OpenAI API — экономит время и деньги.
 * Пустые строки отфильтровываются.
 * При ошибке пробует повторить до MAX_RETRIES раз.
 *
 * @example
 * const embeddings = await getEmbeddings(['текст 1', 'текст 2']);
 * // [[0.1, -0.2, ...], [0.3, 0.4, ...]]
 */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const startTime = Date.now();
  const normalizedTexts = texts.map(t => t.trim().toLowerCase()).filter(t => t.length > 0);

  if (normalizedTexts.length === 0) {
    log.warn({ originalCount: texts.length }, 'All texts were empty after normalization');
    return [];
  }

  log.debug({
    count: normalizedTexts.length,
    originalCount: texts.length
  }, 'Getting embeddings batch');

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: normalizedTexts,
      });

      log.info({
        count: response.data.length,
        tokensUsed: response.usage?.total_tokens,
        durationMs: Date.now() - startTime,
        avgTokensPerText: response.usage?.total_tokens
          ? Math.round(response.usage.total_tokens / normalizedTexts.length)
          : null
      }, 'Embeddings batch completed');

      return response.data.map(d => d.embedding);
    } catch (error: any) {
      lastError = error;
      const isRetryable = error.status === 429 || error.status >= 500;

      log.warn({
        error: error.message,
        status: error.status,
        attempt,
        maxRetries: MAX_RETRIES,
        count: normalizedTexts.length,
        isRetryable
      }, 'Embeddings batch request failed');

      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt;
        log.debug({ delay }, 'Retrying batch after delay');
        await sleep(delay);
      } else {
        break;
      }
    }
  }

  log.error({
    error: lastError?.message,
    count: texts.length,
    durationMs: Date.now() - startTime
  }, 'Failed to get embeddings batch after all retries');

  throw lastError;
}

/**
 * Вычисляет cosine similarity между двумя embeddings
 *
 * @param a - Первый вектор
 * @param b - Второй вектор
 * @returns Значение от 0 (разные) до 1 (идентичные)
 *
 * @description
 * Используется для сравнения embeddings локально.
 * В продакшене лучше использовать pgvector в PostgreSQL (быстрее для больших объёмов).
 *
 * @example
 * const similarity = cosineSimilarity(embedding1, embedding2);
 * if (similarity >= 0.85) {
 *   console.log('Тексты похожи по смыслу');
 * }
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embeddings must have same dimensions: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, MAX_RETRIES };
