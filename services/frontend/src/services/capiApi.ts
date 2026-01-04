/**
 * CAPI (Conversions API) Stats Client
 *
 * Клиент для получения статистики CAPI событий
 * Включает timeout, retry logic и подробное логирование
 */

import { API_BASE_URL } from '@/config/api';

// Configuration
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Получить userId из localStorage
 */
function getUserId(): string | null {
  const user = localStorage.getItem('user');
  if (!user) return null;
  try {
    return JSON.parse(user).id;
  } catch {
    return null;
  }
}

/**
 * Интерфейс ответа со статистикой CAPI
 */
export interface CapiStats {
  capiEnabled: boolean;   // Whether CAPI is enabled for any direction
  lead: number;           // Interest (level 1)
  registration: number;   // Qualified (level 2)
  schedule: number;       // Scheduled (level 3)
  total: number;          // Total events
  conversionL1toL2: number; // % Lead → Registration
  conversionL2toL3: number; // % Registration → Schedule
}

/**
 * Validate CAPI stats response structure
 */
function isValidCapiStats(data: unknown): data is CapiStats {
  if (!data || typeof data !== 'object') return false;
  const stats = data as Record<string, unknown>;
  return (
    typeof stats.capiEnabled === 'boolean' &&
    typeof stats.lead === 'number' &&
    typeof stats.registration === 'number' &&
    typeof stats.schedule === 'number' &&
    typeof stats.total === 'number' &&
    typeof stats.conversionL1toL2 === 'number' &&
    typeof stats.conversionL2toL3 === 'number'
  );
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Получить статистику CAPI событий за период
 * Включает retry logic и timeout
 */
export async function getCapiStats(since: string, until: string): Promise<CapiStats | null> {
  const startTime = Date.now();
  const userId = getUserId();

  if (!userId) {
    console.warn('[capiApi] No user ID found in localStorage');
    return null;
  }

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(since) || !dateRegex.test(until)) {
    console.error('[capiApi] Invalid date format:', { since, until });
    return null;
  }

  console.debug('[capiApi] Fetching CAPI stats:', { userId, since, until });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const params = new URLSearchParams({
        user_account_id: userId,
        since,
        until
      });

      const url = `${API_BASE_URL}/analytics/capi-stats?${params}`;

      const response = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': userId
          }
        },
        REQUEST_TIMEOUT_MS
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[capiApi] API error:', {
          status: response.status,
          error: errorData,
          attempt: attempt + 1,
        });

        // Don't retry on 4xx errors (client errors)
        if (response.status >= 400 && response.status < 500) {
          return null;
        }

        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // Validate response structure
      if (!isValidCapiStats(data)) {
        console.error('[capiApi] Invalid response structure:', data);
        return null;
      }

      const durationMs = Date.now() - startTime;
      console.debug('[capiApi] Successfully fetched CAPI stats:', {
        capiEnabled: data.capiEnabled,
        lead: data.lead,
        registration: data.registration,
        schedule: data.schedule,
        durationMs,
      });

      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const isAbortError = lastError.name === 'AbortError';
      const isLastAttempt = attempt === MAX_RETRIES;

      console.warn('[capiApi] Request failed:', {
        error: lastError.message,
        isTimeout: isAbortError,
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES + 1,
        willRetry: !isLastAttempt,
      });

      if (!isLastAttempt) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  console.error('[capiApi] All retries exhausted:', {
    error: lastError?.message,
    durationMs: Date.now() - startTime,
  });

  return null;
}
