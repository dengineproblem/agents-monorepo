/**
 * Facebook Graph API utility with retry support and circuit breaker
 * Shared across all agents that need Facebook API access
 */

import { withRetry, isRetryableError } from './retryUtils.js';
import { withCircuitBreaker, CircuitOpenError } from './circuitBreaker.js';
import { logger } from '../../lib/logger.js';

const FB_API_VERSION = process.env.FB_API_VERSION || 'v20.0';
const DEFAULT_TIMEOUT = 25000;  // 25 seconds
const DEFAULT_MAX_RETRIES = 2;

// Circuit breaker name for Facebook API
const FB_CIRCUIT_NAME = 'facebook-graph-api';

/**
 * Check if Facebook error is retryable
 * @param {Error} error
 * @returns {boolean}
 */
function isFbRetryable(error) {
  // Facebook specific rate limiting error codes
  // Code 17: User request limit reached
  // Code 4: Application request limit reached
  // Code 32: Page request limit reached
  const fbErrorCode = error?.fbError?.code;
  if (fbErrorCode === 17 || fbErrorCode === 4 || fbErrorCode === 32) {
    return true;
  }

  // Use generic retryable check for network errors
  return isRetryableError(error);
}

/**
 * Execute a Facebook Graph API call with circuit breaker and retry
 * @param {string} method - HTTP method (GET, POST, DELETE)
 * @param {string} path - API path (e.g., 'act_123/campaigns')
 * @param {string} accessToken - Facebook access token
 * @param {object} params - Query/body parameters
 * @param {object} options - { timeout, maxRetries, skipCircuitBreaker }
 * @returns {Promise<object>} API response
 */
export async function fbGraph(method, path, accessToken, params = {}, options = {}) {
  const {
    timeout = DEFAULT_TIMEOUT,
    maxRetries = DEFAULT_MAX_RETRIES,
    skipCircuitBreaker = false
  } = options;

  // Extract first segment of path for operation name (e.g., 'act_123' from 'act_123/campaigns')
  const pathSegment = path.split('/')[0] || path;
  const operationName = `fb:${method}:${pathSegment}`;

  // Inner function: retry with backoff
  const retryableFn = () => withRetry(
    () => fbGraphInternal(method, path, accessToken, params),
    {
      maxRetries,
      timeoutMs: timeout,
      operationName,
      shouldRetry: isFbRetryable
    }
  );

  // Wrap with circuit breaker (unless explicitly skipped)
  if (skipCircuitBreaker) {
    return retryableFn();
  }

  try {
    return await withCircuitBreaker(FB_CIRCUIT_NAME, retryableFn, {
      failureThreshold: 5,
      timeout: 60000,  // 1 minute before trying HALF_OPEN
      successThreshold: 2
    });
  } catch (error) {
    // Transform CircuitOpenError to a more user-friendly message
    if (error instanceof CircuitOpenError) {
      logger.warn({
        circuit: error.circuitName,
        retryAfterMs: error.retryAfterMs,
        path
      }, 'Facebook API circuit breaker is open');

      const waitSec = Math.ceil(error.retryAfterMs / 1000);
      const friendlyError = new Error(
        `Facebook API временно недоступен из-за повторяющихся ошибок. ` +
        `Попробуйте через ${waitSec} сек.`
      );
      friendlyError.isCircuitOpen = true;
      friendlyError.retryAfterMs = error.retryAfterMs;
      throw friendlyError;
    }
    throw error;
  }
}

/**
 * Internal Facebook Graph API call (without retry)
 * @private
 */
async function fbGraphInternal(method, path, accessToken, params = {}) {
  const usp = new URLSearchParams();
  usp.set('access_token', accessToken);

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      const value = typeof v === 'object' ? JSON.stringify(v) : String(v);
      usp.set(k, value);
    }
  }

  const url = method === 'GET'
    ? `https://graph.facebook.com/${FB_API_VERSION}/${path}?${usp.toString()}`
    : `https://graph.facebook.com/${FB_API_VERSION}/${path}`;

  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : usp.toString(),
  });

  const json = await res.json();

  if (!res.ok) {
    const error = new Error(json?.error?.message || `Facebook API error: ${res.status}`);
    error.status = res.status;
    error.fbError = json?.error;  // Preserve FB error for retry logic
    throw error;
  }

  return json;
}

export default fbGraph;
