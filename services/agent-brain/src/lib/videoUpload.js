/**
 * Facebook Video Upload Module
 *
 * Implements chunked video upload to Facebook Graph API with support for:
 * - Simple upload for small files (< 100 MB)
 * - 3-phase chunked upload for large files (>= 100 MB)
 * - Retry logic with exponential backoff
 * - Long timeouts (up to 10 minutes)
 */

import fbGraph from '../chatAssistant/shared/fbGraph.js';
import { logger } from './logger.js';
import fs from 'fs/promises';

// Constants from Facebook API best practices
const CHUNK_SIZE = 8 * 1024 * 1024;  // 8 MB chunks
const SIMPLE_UPLOAD_THRESHOLD = 100 * 1024 * 1024;  // 100 MB
const MAX_RETRIES = 5;
const INITIAL_DELAY = 1000;  // 1 second

// Timeouts for each phase
const START_TIMEOUT = 120000;   // 2 minutes for session init
const TRANSFER_TIMEOUT = 600000; // 10 minutes per chunk
const FINISH_TIMEOUT = 120000;  // 2 minutes for finish

/**
 * Upload video to Facebook Ad Account
 * Automatically chooses simple or chunked upload based on file size
 *
 * @param {Object} params
 * @param {string} params.adAccountId - Facebook Ad Account ID (e.g., 'act_123456')
 * @param {string} params.accessToken - Facebook access token
 * @param {string} params.filePath - Path to video file on disk
 * @param {string} [params.title] - Optional video title
 * @returns {Promise<{id: string, thumbnail_url: string}>} Video upload result
 */
export async function uploadVideoToFacebook({
  adAccountId,
  accessToken,
  filePath,
  title
}) {
  const stats = await fs.stat(filePath);
  const fileSize = stats.size;

  logger.info({
    fileSize,
    fileSizeMB: Math.round(fileSize / 1024 / 1024),
    filePath,
    adAccountId: adAccountId?.slice(0, 15) + '...'
  }, 'Starting Facebook video upload');

  // Choose upload method based on file size
  if (fileSize < SIMPLE_UPLOAD_THRESHOLD) {
    logger.info('Using simple upload (file < 100 MB)');
    return await uploadVideoSimple(adAccountId, accessToken, filePath, title, fileSize);
  } else {
    logger.info('Using chunked upload (file >= 100 MB)');
    return await uploadVideoChunked(adAccountId, accessToken, filePath, title, fileSize);
  }
}

/**
 * Simple upload for small videos (< 100 MB)
 * Single POST request with file in multipart/form-data
 *
 * @private
 */
async function uploadVideoSimple(adAccountId, accessToken, filePath, title, fileSize) {
  logger.info({ adAccountId, fileSize }, 'Starting simple video upload');

  // Note: fbGraph doesn't support multipart/form-data, we need direct fetch
  const FormData = (await import('form-data')).default;
  const form = new FormData();

  const fileStream = await import('fs').then(m => m.createReadStream(filePath));
  form.append('source', fileStream);
  if (title) {
    form.append('title', title);
  }
  form.append('access_token', accessToken);

  const url = `https://graph.facebook.com/v20.0/${adAccountId}/advideos`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
      signal: AbortSignal.timeout(TRANSFER_TIMEOUT) // 10 minutes timeout
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Facebook API error: ${error?.error?.message || response.statusText}`);
    }

    const result = await response.json();
    logger.info({ videoId: result.id }, 'Simple upload completed successfully');

    return {
      id: result.id,
      thumbnail_url: result.picture || null
    };

  } catch (error) {
    logger.error({ error: error.message, adAccountId }, 'Simple upload failed');
    throw error;
  }
}

/**
 * Chunked upload for large videos (>= 100 MB)
 * 3-phase process: START → TRANSFER → FINISH
 *
 * @private
 */
async function uploadVideoChunked(adAccountId, accessToken, filePath, title, fileSize) {
  logger.info({ adAccountId, fileSize, chunks: Math.ceil(fileSize / CHUNK_SIZE) },
    'Starting chunked video upload (3-phase)');

  // PHASE 1: START - Create upload session
  const sessionId = await startUploadSession(adAccountId, accessToken, fileSize);
  logger.info({ sessionId }, 'Upload session created (START phase complete)');

  // PHASE 2: TRANSFER - Upload chunks with retry
  await transferChunks(sessionId, adAccountId, accessToken, filePath, fileSize);
  logger.info({ sessionId }, 'All chunks transferred (TRANSFER phase complete)');

  // PHASE 3: FINISH - Finalize upload
  const result = await finishUploadSession(sessionId, adAccountId, accessToken, title);
  logger.info({ sessionId, videoId: result.id }, 'Chunked upload completed (FINISH phase complete)');

  return result;
}

/**
 * PHASE 1: START - Create upload session
 * @private
 */
async function startUploadSession(adAccountId, accessToken, fileSize) {
  const response = await withRetry(async () => {
    return await fbGraph('POST', `${adAccountId}/advideos`, accessToken, {
      upload_phase: 'start',
      file_size: String(fileSize)
    }, {
      timeout: START_TIMEOUT,
      longTimeout: false // Use custom timeout, not LONG_TIMEOUT
    });
  }, 'start_upload_session');

  if (!response.upload_session_id) {
    throw new Error('Failed to create upload session: missing upload_session_id');
  }

  return response.upload_session_id;
}

/**
 * PHASE 2: TRANSFER - Upload chunks sequentially
 * @private
 */
async function transferChunks(sessionId, adAccountId, accessToken, filePath, fileSize) {
  const fileHandle = await fs.open(filePath, 'r');
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

  try {
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const startOffset = chunkIndex * CHUNK_SIZE;
      const endOffset = Math.min(startOffset + CHUNK_SIZE, fileSize) - 1;
      const chunkSize = endOffset - startOffset + 1;

      logger.info({
        chunkIndex: chunkIndex + 1,
        totalChunks,
        startOffset,
        endOffset,
        chunkSizeMB: Math.round(chunkSize / 1024 / 1024),
        progress: Math.round(((chunkIndex + 1) / totalChunks) * 100)
      }, 'Uploading chunk');

      // Read chunk from file
      const buffer = Buffer.alloc(chunkSize);
      await fileHandle.read(buffer, 0, chunkSize, startOffset);

      // Upload chunk with retry
      await withRetry(async () => {
        // Note: fbGraph doesn't support binary data in body
        // We need direct fetch for this phase
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('upload_phase', 'transfer');
        form.append('upload_session_id', sessionId);
        form.append('start_offset', String(startOffset));
        form.append('video_file_chunk', buffer, {
          filename: 'chunk',
          contentType: 'application/octet-stream'
        });
        form.append('access_token', accessToken);

        const url = `https://graph.facebook.com/v20.0/${adAccountId}/advideos`;
        const response = await fetch(url, {
          method: 'POST',
          body: form,
          headers: form.getHeaders(),
          signal: AbortSignal.timeout(TRANSFER_TIMEOUT)
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(`Chunk upload failed: ${error?.error?.message || response.statusText}`);
        }

        return await response.json();
      }, `transfer_chunk_${chunkIndex}`);

      logger.info({
        chunkIndex: chunkIndex + 1,
        totalChunks,
        progress: Math.round(((chunkIndex + 1) / totalChunks) * 100)
      }, 'Chunk uploaded successfully');
    }
  } finally {
    await fileHandle.close();
  }
}

/**
 * PHASE 3: FINISH - Finalize upload and get video ID
 * @private
 */
async function finishUploadSession(sessionId, adAccountId, accessToken, title) {
  const params = {
    upload_phase: 'finish',
    upload_session_id: sessionId
  };

  if (title) {
    params.title = title;
  }

  const response = await withRetry(async () => {
    return await fbGraph('POST', `${adAccountId}/advideos`, accessToken, params, {
      timeout: FINISH_TIMEOUT,
      longTimeout: false
    });
  }, 'finish_upload_session');

  if (!response.success) {
    throw new Error('Failed to finalize upload session');
  }

  return {
    id: response.id || response.video_id,
    thumbnail_url: response.picture || null
  };
}

/**
 * Retry wrapper with exponential backoff
 * @private
 */
async function withRetry(fn, operationName) {
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      const isRetryable = isRetryableError(error);

      logger.warn({
        operationName,
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
        error: error.message,
        isRetryable
      }, 'Operation failed, checking if retryable');

      // Don't retry if not retryable or last attempt
      if (!isRetryable || attempt === MAX_RETRIES - 1) {
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      const delay = INITIAL_DELAY * Math.pow(2, attempt);
      logger.info({ delay, attempt: attempt + 1 }, 'Retrying after delay');
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Check if error is retryable (network errors, rate limits, etc.)
 * @private
 */
function isRetryableError(error) {
  const message = error.message?.toLowerCase() || '';

  // Network errors
  if (message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('enotfound')) {
    return true;
  }

  // Facebook rate limiting
  if (message.includes('rate limit') ||
      message.includes('too many requests') ||
      error.status === 429) {
    return true;
  }

  // Temporary Facebook errors
  if (error.status === 500 || error.status === 503) {
    return true;
  }

  return false;
}

/**
 * Sleep helper
 * @private
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default { uploadVideoToFacebook };
