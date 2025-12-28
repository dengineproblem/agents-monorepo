/**
 * OpenAI Embeddings helper
 * Uses text-embedding-3-small model for semantic similarity
 */

import { OpenAI } from 'openai';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'embeddings' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

// Model info: text-embedding-3-small produces 1536-dimensional vectors
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

/**
 * Get embedding for a single text
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const normalizedText = text.trim().toLowerCase();

  if (!normalizedText) {
    throw new Error('Cannot get embedding for empty text');
  }

  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: normalizedText,
    });

    return response.data[0].embedding;
  } catch (error: any) {
    log.error({ error: error.message, textLength: text.length }, 'Failed to get embedding');
    throw error;
  }
}

/**
 * Get embeddings for multiple texts in a single request (more efficient)
 */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const normalizedTexts = texts.map(t => t.trim().toLowerCase()).filter(t => t.length > 0);

  if (normalizedTexts.length === 0) {
    return [];
  }

  try {
    log.debug({ count: normalizedTexts.length }, 'Getting embeddings batch');

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: normalizedTexts,
    });

    log.debug({
      count: response.data.length,
      tokensUsed: response.usage?.total_tokens
    }, 'Embeddings batch completed');

    return response.data.map(d => d.embedding);
  } catch (error: any) {
    log.error({ error: error.message, count: texts.length }, 'Failed to get embeddings batch');
    throw error;
  }
}

/**
 * Calculate cosine similarity between two embeddings
 * Returns value between 0 (different) and 1 (identical)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have same dimensions');
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

export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS };
