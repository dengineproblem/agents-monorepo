/**
 * Retry and Timeout utilities for tool handlers
 *
 * Provides:
 * - withTimeout() — Promise.race with timeout
 * - withRetry() — retry with exponential backoff
 * - isRetryableError() — determine if error is retryable
 */

import { logger } from '../../lib/logger.js';

// Retryable HTTP status codes
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];

// Retryable error patterns (network/transient errors)
const RETRYABLE_ERROR_PATTERNS = [
  'econnreset',
  'etimedout',
  'enotfound',
  'econnrefused',
  'socket hang up',
  'rate limit',
  'temporarily unavailable',
  'service unavailable',
  'too many requests'
];

/**
 * Check if error is retryable (network/transient errors)
 * @param {Error} error
 * @returns {boolean}
 */
export function isRetryableError(error) {
  if (!error) return false;

  const message = (error.message || '').toLowerCase();
  const status = error.status || error.statusCode;

  // Check HTTP status codes
  if (status && RETRYABLE_STATUS_CODES.includes(status)) {
    return true;
  }

  // Check error message patterns
  return RETRYABLE_ERROR_PATTERNS.some(pattern =>
    message.includes(pattern)
  );
}

/**
 * Sleep with optional jitter
 * @param {number} ms - base milliseconds
 * @param {boolean} withJitter - add 0-30% random jitter
 * @returns {Promise<void>}
 */
function sleep(ms, withJitter = true) {
  const jitter = withJitter ? Math.random() * 0.3 * ms : 0;
  return new Promise(resolve => setTimeout(resolve, ms + jitter));
}

/**
 * Execute function with timeout
 * @param {Function} fn - Async function to execute
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operationName - Name for error messages
 * @returns {Promise<any>}
 * @throws {Error} with "timed out" in message
 */
export async function withTimeout(fn, timeoutMs, operationName = 'operation') {
  if (!timeoutMs || timeoutMs <= 0) {
    // No timeout, just execute
    return fn();
  }

  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([fn(), timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Execute function with retry and exponential backoff
 *
 * @param {Function} fn - Async function to execute
 * @param {Object} options
 * @param {number} options.maxRetries - Maximum retry attempts (default: 3)
 * @param {number} options.baseDelayMs - Base delay between retries (default: 1000)
 * @param {number} options.maxDelayMs - Maximum delay cap (default: 10000)
 * @param {number} options.timeoutMs - Timeout per attempt (default: 30000, 0 = no timeout)
 * @param {string} options.operationName - Name for logging
 * @param {Function} options.shouldRetry - Custom retry predicate (error) => boolean
 * @returns {Promise<any>}
 */
export async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    timeoutMs = 30000,
    operationName = 'operation',
    shouldRetry = isRetryableError
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Execute with timeout (if specified)
      const result = timeoutMs > 0
        ? await withTimeout(fn, timeoutMs, operationName)
        : await fn();

      // Log successful retry
      if (attempt > 0) {
        logger.info({ operationName, attempt: attempt + 1, maxRetries: maxRetries + 1 }, 'Retry succeeded');
      }

      return result;

    } catch (error) {
      lastError = error;

      // Check if we should retry
      const isLastAttempt = attempt >= maxRetries;
      const canRetry = !isLastAttempt && shouldRetry(error);

      logger.warn({
        operationName,
        attempt: attempt + 1,
        maxRetries: maxRetries + 1,
        error: error.message,
        willRetry: canRetry
      }, canRetry ? 'Operation failed, will retry' : 'Operation failed');

      if (!canRetry) {
        break;
      }

      // Calculate delay with exponential backoff: baseDelay * 2^attempt
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);

      logger.debug({ operationName, delayMs: Math.round(delay) }, 'Waiting before retry');
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Create a retryable wrapper for a handler function
 * Useful for wrapping existing handlers
 *
 * @param {Function} handler - Async handler function
 * @param {Object} defaultOptions - Default retry options
 * @returns {Function} Wrapped handler with retry logic
 */
export function createRetryableHandler(handler, defaultOptions = {}) {
  return async (...args) => {
    return withRetry(
      () => handler(...args),
      defaultOptions
    );
  };
}

export default {
  isRetryableError,
  withTimeout,
  withRetry,
  createRetryableHandler
};
