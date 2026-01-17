/**
 * TikTok Events API Client
 *
 * Отправляет события конверсий в TikTok для оптимизации рекламы.
 * Аналог Meta CAPI для TikTok платформы.
 *
 * Три уровня событий:
 * 1. ViewContent (INTEREST) - клиент проявил интерес (3+ входящих сообщений)
 * 2. CompleteRegistration (QUALIFIED) - клиент прошёл квалификацию
 * 3. PlaceAnOrder (BOOKED) - клиент записался/купил
 *
 * Документация: https://business-api.tiktok.com/portal/docs?id=1771101027431425
 */

import crypto from 'crypto';
import { createLogger } from './logger.js';
import { supabase } from './supabase.js';

const log = createLogger({ module: 'tiktokEventsClient' });

// TikTok Events API endpoint
const TIKTOK_API_BASE_URL = process.env.TIKTOK_EVENTS_API_URL || 'https://business-api.tiktok.com/open_api/v1.3';

// Retry and timeout configuration
const EVENTS_TIMEOUT_MS = 30000;
const EVENTS_MAX_RETRIES = 3;
const EVENTS_RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff

/**
 * Circuit Breaker для TikTok Events API
 * Предотвращает перегрузку при сбоях
 */
class TikTokCircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private readonly threshold = 5;
  private readonly resetMs = 60000; // 1 minute

  isOpen(): boolean {
    if (this.failures < this.threshold) return false;
    if (Date.now() - this.lastFailure > this.resetMs) {
      this.reset();
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
  }

  reset(): void {
    this.failures = 0;
    this.lastFailure = 0;
  }

  getState(): { failures: number; isOpen: boolean } {
    return { failures: this.failures, isOpen: this.isOpen() };
  }
}

const circuitBreaker = new TikTokCircuitBreaker();

// Event names for each conversion level (TikTok standard events)
export const TIKTOK_EVENTS = {
  INTEREST: 'ViewContent',           // Level 1: 3+ inbound messages
  QUALIFIED: 'CompleteRegistration', // Level 2: Passed qualification
  SCHEDULED: 'PlaceAnOrder',         // Level 3: Booked/purchase event
} as const;

export type TikTokEventName = typeof TIKTOK_EVENTS[keyof typeof TIKTOK_EVENTS];
export type TikTokEventLevel = 1 | 2 | 3;

// TikTok Events API response structure
interface TikTokEventsResponse {
  code: number;
  message: string;
  request_id?: string;
  data?: {
    failed_events?: Array<{
      error_code: number;
      error_message: string;
    }>;
  };
}

export interface TikTokEventParams {
  // Required
  pixelCode: string;        // TikTok Pixel Code
  accessToken: string;      // TikTok Access Token
  eventName: TikTokEventName;
  eventLevel: TikTokEventLevel;

  // User data for matching (at least one required)
  phone?: string;           // Will be hashed
  email?: string;           // Will be hashed
  ttclid?: string;          // TikTok Click ID from URL

  // Context
  dialogAnalysisId?: string;
  leadId?: string;
  userAccountId: string;
  directionId?: string;

  // Optional event data
  eventSourceUrl?: string;
  customData?: Record<string, unknown>;

  // Tracing
  correlationId?: string;
}

export interface TikTokEventResponse {
  success: boolean;
  eventId?: string;
  error?: string;
  tiktokResponse?: unknown;
}

/**
 * Hash data for TikTok Events API (SHA256, lowercase)
 */
function hashForTikTok(value: string): string {
  return crypto
    .createHash('sha256')
    .update(value.toLowerCase().trim())
    .digest('hex');
}

/**
 * Normalize and hash phone number for TikTok
 * Removes all non-digits, validates length, then hashes
 */
function hashPhone(phone: string): string {
  const normalized = phone.replace(/\D/g, '');
  if (normalized.length < 10) {
    throw new Error(`Invalid phone for TikTok hashing: too short (${normalized.length} digits)`);
  }
  return hashForTikTok(normalized);
}

/**
 * Generate deterministic event ID for deduplication
 * Format: tt_{leadId}_{interest|qualified|purchase}_v1
 */
function generateEventId(params: TikTokEventParams): string {
  const levelSuffix = {
    1: 'interest',
    2: 'qualified',
    3: 'purchase',
  }[params.eventLevel];

  const baseId = params.leadId || params.dialogAnalysisId || params.phone || params.email || params.ttclid;

  if (params.leadId || params.dialogAnalysisId) {
    return `tt_${baseId}_${levelSuffix}_v1`;
  }

  if (params.phone) {
    return `tt_${hashPhone(params.phone)}_${levelSuffix}_v1`;
  }

  if (params.email) {
    return `tt_${hashForTikTok(params.email)}_${levelSuffix}_v1`;
  }

  if (params.ttclid) {
    return `tt_${params.ttclid}_${levelSuffix}_v1`;
  }

  const fallback = crypto.randomUUID();
  return `tt_${fallback}_${levelSuffix}_v1`;
}

/**
 * Fetch with retry and timeout
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = EVENTS_MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), EVENTS_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Success or client error (4xx) - don't retry
        if (response.ok || response.status < 500) {
          return response;
        }

        // Server error (5xx) - retry
        log.warn({
          attempt: attempt + 1,
          status: response.status,
          url,
        }, 'TikTok Events request failed with 5xx, retrying...');

        lastError = new Error(`HTTP ${response.status}`);
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (lastError.name === 'AbortError') {
        log.warn({ attempt: attempt + 1, url }, 'TikTok Events request timed out, retrying...');
      } else {
        log.warn({
          attempt: attempt + 1,
          error: lastError.message,
          url,
        }, 'TikTok Events request failed, retrying...');
      }
    }

    // Wait before next retry (exponential backoff)
    if (attempt < retries - 1) {
      const delay = EVENTS_RETRY_DELAYS[attempt] || EVENTS_RETRY_DELAYS[EVENTS_RETRY_DELAYS.length - 1];
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

/**
 * Send event to TikTok Events API
 */
export async function sendTikTokEvent(params: TikTokEventParams): Promise<TikTokEventResponse> {
  const {
    pixelCode,
    accessToken,
    eventName,
    eventLevel,
    phone,
    email,
    ttclid,
    dialogAnalysisId,
    leadId,
    userAccountId,
    directionId,
    eventSourceUrl,
    customData,
    correlationId,
  } = params;

  const requestStartedAt = new Date();

  log.info({
    correlationId,
    pixelCode,
    eventName,
    eventLevel,
    hasPhone: !!phone,
    hasEmail: !!email,
    hasTtclid: !!ttclid,
    dialogAnalysisId,
    circuitBreakerState: circuitBreaker.getState(),
    action: 'tiktok_event_send_start',
  }, 'Sending TikTok event');

  // Check circuit breaker
  if (circuitBreaker.isOpen()) {
    log.warn({
      correlationId,
      pixelCode,
      eventName,
      ...circuitBreaker.getState(),
      action: 'tiktok_circuit_breaker_open',
    }, 'Circuit breaker is open, skipping TikTok event');
    return { success: false, error: 'Circuit breaker is open - too many recent failures' };
  }

  // Validate required params
  if (!pixelCode || !accessToken) {
    log.warn({ correlationId, pixelCode, hasAccessToken: !!accessToken, action: 'tiktok_missing_params' }, 'Missing pixelCode or accessToken, skipping TikTok event');
    return { success: false, error: 'Missing pixelCode or accessToken' };
  }

  // Need at least one user identifier
  if (!phone && !email && !ttclid) {
    log.warn({ correlationId, action: 'tiktok_no_user_data' }, 'No user data (phone, email, or ttclid) provided, skipping TikTok event');
    return { success: false, error: 'No user data provided' };
  }

  let retryCount = 0;

  try {
    // Generate unique event ID
    const eventId = generateEventId(params);
    const eventTime = Math.floor(Date.now() / 1000);

    // Build user object for TikTok
    // https://business-api.tiktok.com/portal/docs?id=1771101027431425
    const user: Record<string, string> = {};

    if (phone) {
      user.phone_number = hashPhone(phone);
    }

    if (email) {
      user.email = hashForTikTok(email);
    }

    if (ttclid) {
      user.ttclid = ttclid; // TikTok Click ID is NOT hashed
    }

    if (leadId) {
      user.external_id = String(leadId);
    }

    // Build properties
    const properties: Record<string, unknown> = {
      event_level: eventLevel,
      ...customData,
    };

    // Build event payload
    const eventPayload = {
      pixel_code: pixelCode,
      event: eventName,
      event_id: eventId,
      timestamp: new Date().toISOString(),
      context: {
        user,
        ...(eventSourceUrl && { page: { url: eventSourceUrl } }),
      },
      properties,
    };

    // Request payload
    const requestBody = {
      event_source: 'web',
      event_source_id: pixelCode,
      data: [eventPayload],
    };

    // Send to TikTok Events API
    const url = `${TIKTOK_API_BASE_URL}/event/track/`;
    const fetchStartTime = Date.now();

    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': accessToken,
      },
      body: JSON.stringify(requestBody),
    });

    const requestDurationMs = Date.now() - fetchStartTime;
    const responseData = await response.json() as TikTokEventsResponse;

    // TikTok returns code: 0 for success
    if (responseData.code !== 0) {
      circuitBreaker.recordFailure();

      log.error({
        correlationId,
        pixelCode,
        eventName,
        code: responseData.code,
        message: responseData.message,
        requestDurationMs,
        retryCount,
        circuitBreakerState: circuitBreaker.getState(),
        action: 'tiktok_event_send_failed',
      }, 'TikTok Events request failed');

      // Log to database
      await logTikTokEventWithRetry({
        dialogAnalysisId,
        leadId,
        userAccountId,
        directionId,
        eventName,
        eventLevel,
        pixelCode,
        ttclid,
        eventTime: new Date(eventTime * 1000),
        eventId,
        contactPhone: phone,
        status: 'error',
        error: JSON.stringify(responseData),
        response: responseData,
        correlationId,
        requestStartedAt,
        requestDurationMs,
        retryCount,
        requestPayload: requestBody,
      });

      return {
        success: false,
        error: responseData.message || 'TikTok Events request failed',
        tiktokResponse: responseData,
      };
    }

    circuitBreaker.recordSuccess();

    log.info({
      correlationId,
      pixelCode,
      eventName,
      eventLevel,
      eventId,
      requestDurationMs,
      retryCount,
      action: 'tiktok_event_send_success',
    }, 'TikTok event sent successfully');

    // Log to database
    await logTikTokEventWithRetry({
      dialogAnalysisId,
      leadId,
      userAccountId,
      directionId,
      eventName,
      eventLevel,
      pixelCode,
      ttclid,
      eventTime: new Date(eventTime * 1000),
      eventId,
      contactPhone: phone,
      status: 'success',
      response: responseData,
      correlationId,
      requestStartedAt,
      requestDurationMs,
      retryCount,
      requestPayload: requestBody,
    });

    return {
      success: true,
      eventId,
      tiktokResponse: responseData,
    };
  } catch (error) {
    circuitBreaker.recordFailure();

    const totalDurationMs = Date.now() - requestStartedAt.getTime();
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : 'UnknownError';

    log.error({
      correlationId,
      pixelCode,
      eventName,
      error: errorMessage,
      errorName,
      totalDurationMs,
      circuitBreakerState: circuitBreaker.getState(),
      action: 'tiktok_event_send_error',
    }, 'Error sending TikTok event');

    // Log to database
    await logTikTokEventWithRetry({
      dialogAnalysisId,
      leadId,
      userAccountId,
      directionId,
      eventName,
      eventLevel,
      pixelCode,
      ttclid,
      eventTime: new Date(),
      contactPhone: phone,
      status: 'error',
      error: `${errorName}: ${errorMessage}`,
      correlationId,
      requestStartedAt,
      requestDurationMs: totalDurationMs,
      retryCount,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

interface LogTikTokEventParams {
  dialogAnalysisId?: string;
  leadId?: string;
  userAccountId: string;
  directionId?: string;
  eventName: string;
  eventLevel: TikTokEventLevel;
  pixelCode: string;
  ttclid?: string;
  eventTime: Date;
  eventId?: string;
  contactPhone?: string;
  status: 'success' | 'error' | 'skipped';
  error?: string;
  response?: unknown;
  // Tracing and timing
  correlationId?: string;
  requestStartedAt?: Date;
  requestDurationMs?: number;
  retryCount?: number;
  requestPayload?: unknown;
}

/**
 * Log TikTok event to capi_events_log with platform = 'tiktok'
 */
async function logTikTokEventWithRetry(params: LogTikTokEventParams, retries = 2): Promise<void> {
  const insertData = {
    dialog_analysis_id: params.dialogAnalysisId || null,
    lead_id: params.leadId || null,
    user_account_id: params.userAccountId,
    direction_id: params.directionId || null,
    event_name: params.eventName,
    event_level: params.eventLevel,
    pixel_id: params.pixelCode, // Using pixel_id column for TikTok pixel_code
    ttclid: params.ttclid || null,
    event_time: params.eventTime.toISOString(),
    event_id: params.eventId || null,
    contact_phone: params.contactPhone || null,
    capi_status: params.status,
    capi_error: params.error || null,
    capi_response: params.response || null,
    platform: 'tiktok', // Platform identifier
    // Tracing and timing fields
    correlation_id: params.correlationId || null,
    request_started_at: params.requestStartedAt?.toISOString() || null,
    request_duration_ms: params.requestDurationMs ?? null,
    retry_count: params.retryCount ?? 0,
    request_payload: params.requestPayload || null,
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { error } = await supabase.from('capi_events_log').insert(insertData);
      if (error) throw error;
      return; // Success
    } catch (error) {
      const isLastAttempt = attempt === retries;
      if (isLastAttempt) {
        log.error({
          error: error instanceof Error ? error.message : String(error),
          attempt: attempt + 1,
          eventName: params.eventName,
          eventLevel: params.eventLevel,
          correlationId: params.correlationId,
        }, 'Failed to log TikTok event to database after retries');
      } else {
        log.warn({
          attempt: attempt + 1,
          eventName: params.eventName,
          correlationId: params.correlationId,
        }, 'Failed to log TikTok event, retrying...');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
}

/**
 * Send TikTok event with atomic deduplication
 * Prevents duplicate sends via atomic DB update
 */
export async function sendTikTokEventAtomic(params: TikTokEventParams): Promise<TikTokEventResponse> {
  const { dialogAnalysisId, eventLevel } = params;

  if (!dialogAnalysisId) {
    log.warn({ eventLevel }, 'Cannot use atomic send without dialogAnalysisId');
    return sendTikTokEvent(params);
  }

  // Use separate TikTok flags (if they exist) or share with CAPI flags
  // For now, we use the same flags as CAPI since dialog can only be from one platform
  const flagColumn = {
    1: 'capi_interest_sent',
    2: 'capi_qualified_sent',
    3: 'capi_scheduled_sent',
  }[eventLevel];

  const flagAtColumn = `${flagColumn}_at`;

  // Atomic: SET flag = true WHERE flag = false (claim the send)
  const { data, error } = await supabase
    .from('dialog_analysis')
    .update({
      [flagColumn]: true,
      [flagAtColumn]: new Date().toISOString(),
    })
    .eq('id', dialogAnalysisId)
    .eq(flagColumn, false)
    .select('id')
    .single();

  if (error || !data) {
    log.info({
      dialogAnalysisId,
      eventLevel,
      reason: error ? 'db_error' : 'already_sent',
    }, 'Skipping TikTok event - already sent or not found');

    return {
      success: false,
      error: 'Event already sent or dialog not found',
    };
  }

  // Successfully claimed - now send the event
  const response = await sendTikTokEvent(params);

  if (!response.success) {
    log.warn({
      dialogAnalysisId,
      eventLevel,
      error: response.error,
    }, 'TikTok event claimed but send failed - flag remains set');
  } else if (response.eventId) {
    // Update with event_id
    await supabase
      .from('dialog_analysis')
      .update({ [`${flagColumn.replace('_sent', '_event_id')}`]: response.eventId })
      .eq('id', dialogAnalysisId);
  }

  return response;
}

/**
 * Get TikTok pixel info for a direction
 * Returns pixel_code from tiktok_pixel_id field
 */
export async function getDirectionTikTokPixelInfo(directionId: string): Promise<{
  pixelCode: string | null;
  accessToken: string | null;
}> {
  try {
    const { data: direction, error } = await supabase
      .from('account_directions')
      .select(`
        id,
        user_account_id,
        account_id,
        tiktok_pixel_id,
        ad_accounts(tiktok_access_token),
        user_accounts(tiktok_access_token)
      `)
      .eq('id', directionId)
      .single();

    if (error) {
      log.warn({ error: error.message, directionId }, 'Error fetching direction TikTok pixel info');
      return { pixelCode: null, accessToken: null };
    }

    if (!direction) {
      log.debug({ directionId }, 'Direction not found');
      return { pixelCode: null, accessToken: null };
    }

    const pixelCode = direction.tiktok_pixel_id || null;

    if (!pixelCode) {
      log.debug({ directionId }, 'No tiktok_pixel_id found for direction');
      return { pixelCode: null, accessToken: null };
    }

    // Get access token: prefer ad_accounts, fallback to user_accounts
    const adAccount = direction.ad_accounts as { tiktok_access_token?: string } | { tiktok_access_token?: string }[] | null;
    const userAccount = direction.user_accounts as { tiktok_access_token?: string } | { tiktok_access_token?: string }[] | null;

    const accessToken = (Array.isArray(adAccount) ? adAccount[0]?.tiktok_access_token : adAccount?.tiktok_access_token)
      || (Array.isArray(userAccount) ? userAccount[0]?.tiktok_access_token : userAccount?.tiktok_access_token)
      || null;

    if (!accessToken) {
      log.warn({ directionId, pixelCode }, 'Found TikTok pixel but no access_token');
    }

    return { pixelCode, accessToken };
  } catch (error) {
    log.error({
      error: error instanceof Error ? error.message : String(error),
      directionId,
    }, 'Error getting direction TikTok pixel info');
    return { pixelCode: null, accessToken: null };
  }
}
