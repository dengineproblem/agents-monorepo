/**
 * Meta Conversions API (CAPI) Client
 *
 * Отправляет события конверсий в Facebook для оптимизации рекламы.
 *
 * Три уровня событий (Pixel/CAPI без WABA):
 * 1. Contact (INTEREST) - клиент проявил интерес (3+ входящих сообщений)
 * 2. CompleteRegistration (QUALIFIED) - клиент прошёл квалификацию
 * 3. Purchase (BOOKED) - клиент записался/купил (event_name = Purchase)
 */

import crypto from 'crypto';
import { createLogger } from './logger.js';
import { supabase } from './supabase.js';

const log = createLogger({ module: 'metaCapiClient' });

// Meta Conversions API endpoint (configurable via env)
const CAPI_BASE_URL = process.env.META_CAPI_URL || 'https://graph.facebook.com/v20.0';

// Retry and timeout configuration
const CAPI_TIMEOUT_MS = 30000;
const CAPI_MAX_RETRIES = 3;
const CAPI_RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff

/**
 * Circuit Breaker для Meta API
 * Предотвращает перегрузку при сбоях
 */
class MetaCircuitBreaker {
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

const circuitBreaker = new MetaCircuitBreaker();

// Event names for each conversion level
export const CAPI_EVENTS = {
  INTEREST: 'Other',                // Level 1: 3+ inbound messages
  QUALIFIED: 'CompleteRegistration',// Level 2: Passed qualification
  SCHEDULED: 'Purchase',            // Level 3: Booked/purchase event
} as const;

export type CapiEventName = typeof CAPI_EVENTS[keyof typeof CAPI_EVENTS];
export type CapiEventLevel = 1 | 2 | 3;
const PURCHASE_CURRENCY = 'KZT';
const PURCHASE_DEFAULT_VALUE = 1;

// Meta CAPI response structure
interface MetaCapiResponse {
  events_received?: number;
  messages?: string[];
  fbtrace_id?: string;
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
}

export interface CapiEventParams {
  // Required
  pixelId: string;
  accessToken: string;
  eventName: CapiEventName;
  eventLevel: CapiEventLevel;

  // User data for matching (at least one required)
  phone?: string;        // Will be hashed
  email?: string;        // Will be hashed
  ctwaClid?: string;     // Stored for logs only; not used in payload

  // Context
  dialogAnalysisId?: string;
  leadId?: string;
  userAccountId: string;
  directionId?: string;

  // Optional event data
  eventSourceUrl?: string;
  customData?: Record<string, unknown>;

  // Tracing
  correlationId?: string;  // For cross-service tracing
}

export interface CapiResponse {
  success: boolean;
  eventId?: string;
  error?: string;
  facebookResponse?: unknown;
}

/**
 * Hash data for CAPI (SHA256, lowercase)
 */
function hashForCapi(value: string): string {
  return crypto
    .createHash('sha256')
    .update(value.toLowerCase().trim())
    .digest('hex');
}

/**
 * Normalize and hash phone number for CAPI
 * Removes all non-digits, validates length, then hashes
 * @throws Error if phone is invalid
 */
function hashPhone(phone: string): string {
  const normalized = phone.replace(/\D/g, '');
  if (normalized.length < 10) {
    throw new Error(`Invalid phone for CAPI hashing: too short (${normalized.length} digits)`);
  }
  return hashForCapi(normalized);
}

/**
 * Generate deterministic event ID for deduplication
 * Format: wa_{leadId}_{interest|qualified|purchase}_v1
 */
function generateEventId(params: CapiEventParams): string {
  const levelSuffix = {
    1: 'interest',
    2: 'qualified',
    3: 'purchase',
  }[params.eventLevel];

  const baseId = params.leadId || params.dialogAnalysisId || params.phone || params.email || params.ctwaClid;

  if (params.leadId || params.dialogAnalysisId) {
    return `wa_${baseId}_${levelSuffix}_v1`;
  }

  if (params.phone) {
    return `wa_${hashPhone(params.phone)}_${levelSuffix}_v1`;
  }

  if (params.email) {
    return `wa_${hashForCapi(params.email)}_${levelSuffix}_v1`;
  }

  if (params.ctwaClid) {
    return `wa_${params.ctwaClid}_${levelSuffix}_v1`;
  }

  const fallback = crypto.randomUUID();
  return `wa_${fallback}_${levelSuffix}_v1`;
}

/**
 * Fetch with retry and timeout
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = CAPI_MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CAPI_TIMEOUT_MS);

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
        }, 'CAPI request failed with 5xx, retrying...');

        lastError = new Error(`HTTP ${response.status}`);
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (lastError.name === 'AbortError') {
        log.warn({ attempt: attempt + 1, url }, 'CAPI request timed out, retrying...');
      } else {
        log.warn({
          attempt: attempt + 1,
          error: lastError.message,
          url,
        }, 'CAPI request failed, retrying...');
      }
    }

    // Wait before next retry (exponential backoff)
    if (attempt < retries - 1) {
      const delay = CAPI_RETRY_DELAYS[attempt] || CAPI_RETRY_DELAYS[CAPI_RETRY_DELAYS.length - 1];
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

/**
 * Send event to Meta Conversions API
 */
export async function sendCapiEvent(params: CapiEventParams): Promise<CapiResponse> {
  const {
    pixelId,
    accessToken,
    eventName,
    eventLevel,
    phone,
    email,
    ctwaClid,
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
    pixelId,
    eventName,
    eventLevel,
    hasPhone: !!phone,
    hasEmail: !!email,
    dialogAnalysisId,
    circuitBreakerState: circuitBreaker.getState(),
    action: 'capi_send_start',
  }, 'Sending CAPI event');

  // Check circuit breaker
  if (circuitBreaker.isOpen()) {
    log.warn({
      correlationId,
      pixelId,
      eventName,
      ...circuitBreaker.getState(),
      action: 'capi_circuit_breaker_open',
    }, 'Circuit breaker is open, skipping CAPI event');
    return { success: false, error: 'Circuit breaker is open - too many recent failures' };
  }

  // Validate required params
  if (!pixelId || !accessToken) {
    log.warn({ correlationId, pixelId, hasAccessToken: !!accessToken, action: 'capi_missing_params' }, 'Missing pixelId or accessToken, skipping CAPI event');
    return { success: false, error: 'Missing pixelId or accessToken' };
  }

  // Need at least one user identifier
  if (!phone && !email) {
    log.warn({ correlationId, action: 'capi_no_user_data' }, 'No user data (phone or email) provided, skipping CAPI event');
    return { success: false, error: 'No user data provided' };
  }

  let retryCount = 0;

  try {
    // Generate unique event ID
    const eventId = generateEventId(params);
    const eventTime = Math.floor(Date.now() / 1000);

    // Build user_data object
    const userData: Record<string, string | string[]> = {};

    if (phone) {
      userData.ph = [hashPhone(phone)];
    }

    if (email) {
      userData.em = [hashForCapi(email)];
    }

    if (leadId) {
      userData.external_id = String(leadId);
    }

    const mergedCustomData: Record<string, unknown> = {
      event_level: eventLevel,
      ...customData,
    };

    if (eventName === CAPI_EVENTS.SCHEDULED) {
      if (mergedCustomData.currency == null) {
        mergedCustomData.currency = PURCHASE_CURRENCY;
      }
      if (mergedCustomData.value == null) {
        mergedCustomData.value = PURCHASE_DEFAULT_VALUE;
      }
    }

    // Build event payload
    const eventPayload: Record<string, unknown> = {
      event_name: eventName,
      event_time: eventTime,
      event_id: eventId,
      action_source: process.env.META_CAPI_ACTION_SOURCE || 'system_generated',
      user_data: userData,
      custom_data: mergedCustomData,
    };

    if (eventSourceUrl) {
      eventPayload.event_source_url = eventSourceUrl;
    }

    // Request payload for logging (without access_token)
    const requestPayload = { data: [eventPayload] };

    // Send to CAPI with retry and timeout
    const url = `${CAPI_BASE_URL}/${pixelId}/events`;
    const fetchStartTime = Date.now();

    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: [eventPayload],
        access_token: accessToken,
      }),
    });

    const requestDurationMs = Date.now() - fetchStartTime;
    const responseData = await response.json() as MetaCapiResponse;

    if (!response.ok) {
      circuitBreaker.recordFailure();

      log.error({
        correlationId,
        pixelId,
        eventName,
        status: response.status,
        error: responseData,
        requestDurationMs,
        retryCount,
        circuitBreakerState: circuitBreaker.getState(),
        action: 'capi_send_failed',
      }, 'CAPI request failed');

      // Log to database with retry
      await logCapiEventWithRetry({
        dialogAnalysisId,
        leadId,
        userAccountId,
        directionId,
        eventName,
        eventLevel,
        pixelId,
        ctwaClid,
        eventTime: new Date(eventTime * 1000),
        eventId,
        contactPhone: phone,
        capiStatus: 'error',
        capiError: JSON.stringify(responseData),
        capiResponse: responseData,
        correlationId,
        requestStartedAt,
        requestDurationMs,
        retryCount,
        requestPayload,
      });

      return {
        success: false,
        error: responseData.error?.message || 'CAPI request failed',
        facebookResponse: responseData,
      };
    }

    circuitBreaker.recordSuccess();

    log.info({
      correlationId,
      pixelId,
      eventName,
      eventLevel,
      eventId,
      eventsReceived: responseData.events_received,
      requestDurationMs,
      retryCount,
      action: 'capi_send_success',
    }, 'CAPI event sent successfully');

    // Log to database with retry
    await logCapiEventWithRetry({
      dialogAnalysisId,
      leadId,
      userAccountId,
      directionId,
      eventName,
      eventLevel,
      pixelId,
      ctwaClid,
      eventTime: new Date(eventTime * 1000),
      eventId,
      contactPhone: phone,
      capiStatus: 'success',
      capiResponse: responseData,
      correlationId,
      requestStartedAt,
      requestDurationMs,
      retryCount,
      requestPayload,
    });

    return {
      success: true,
      eventId,
      facebookResponse: responseData,
    };
  } catch (error) {
    circuitBreaker.recordFailure();

    const totalDurationMs = Date.now() - requestStartedAt.getTime();
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : 'UnknownError';

    log.error({
      correlationId,
      pixelId,
      eventName,
      error: errorMessage,
      errorName,
      totalDurationMs,
      circuitBreakerState: circuitBreaker.getState(),
      action: 'capi_send_error',
    }, 'Error sending CAPI event');

    // Log to database with retry
    await logCapiEventWithRetry({
      dialogAnalysisId,
      leadId,
      userAccountId,
      directionId,
      eventName,
      eventLevel,
      pixelId,
      ctwaClid,
      eventTime: new Date(),
      contactPhone: phone,
      capiStatus: 'error',
      capiError: `${errorName}: ${errorMessage}`,
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

interface LogCapiEventParams {
  dialogAnalysisId?: string;
  leadId?: string;
  userAccountId: string;
  directionId?: string;
  eventName: string;
  eventLevel: CapiEventLevel;
  pixelId: string;
  ctwaClid?: string;
  eventTime: Date;
  eventId?: string;
  contactPhone?: string;
  capiStatus: 'success' | 'error' | 'skipped';
  capiError?: string;
  capiResponse?: unknown;
  // Tracing and timing
  correlationId?: string;
  requestStartedAt?: Date;
  requestDurationMs?: number;
  retryCount?: number;
  requestPayload?: unknown;
}

/**
 * Log CAPI event to database for audit trail with retry
 */
async function logCapiEventWithRetry(params: LogCapiEventParams, retries = 2): Promise<void> {
  const insertData = {
    dialog_analysis_id: params.dialogAnalysisId || null,
    lead_id: params.leadId || null,
    user_account_id: params.userAccountId,
    direction_id: params.directionId || null,
    event_name: params.eventName,
    event_level: params.eventLevel,
    pixel_id: params.pixelId,
    ctwa_clid: params.ctwaClid || null,
    event_time: params.eventTime.toISOString(),
    event_id: params.eventId || null,
    contact_phone: params.contactPhone || null,
    capi_status: params.capiStatus,
    capi_error: params.capiError || null,
    capi_response: params.capiResponse || null,
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
        }, 'Failed to log CAPI event to database after retries');
      } else {
        log.warn({
          attempt: attempt + 1,
          eventName: params.eventName,
          correlationId: params.correlationId,
        }, 'Failed to log CAPI event, retrying...');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
}

/**
 * Update dialog_analysis with CAPI event flags
 * Returns true if update was successful
 */
export async function updateDialogCapiFlags(
  dialogAnalysisId: string,
  eventLevel: CapiEventLevel,
  eventId: string
): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {};

    switch (eventLevel) {
      case 1:
        updates.capi_interest_sent = true;
        updates.capi_interest_sent_at = now;
        updates.capi_interest_event_id = eventId;
        break;
      case 2:
        updates.capi_qualified_sent = true;
        updates.capi_qualified_sent_at = now;
        updates.capi_qualified_event_id = eventId;
        break;
      case 3:
        updates.capi_scheduled_sent = true;
        updates.capi_scheduled_sent_at = now;
        updates.capi_scheduled_event_id = eventId;
        break;
    }

    const { error, count } = await supabase
      .from('dialog_analysis')
      .update(updates)
      .eq('id', dialogAnalysisId);

    if (error) {
      log.error({
        error: error.message,
        dialogAnalysisId,
        eventLevel,
      }, 'Failed to update dialog CAPI flags - DB error');
      return false;
    }

    if (count === 0) {
      log.warn({
        dialogAnalysisId,
        eventLevel,
      }, 'Failed to update dialog CAPI flags - dialog not found');
      return false;
    }

    log.debug({ dialogAnalysisId, eventLevel, eventId }, 'Updated dialog CAPI flags');
    return true;
  } catch (error) {
    log.error({
      error: error instanceof Error ? error.message : String(error),
      dialogAnalysisId,
      eventLevel,
    }, 'Failed to update dialog CAPI flags');
    return false;
  }
}

/**
 * Atomically claim and send CAPI event
 * Prevents duplicate sends via atomic DB update
 */
export async function sendCapiEventAtomic(params: CapiEventParams): Promise<CapiResponse> {
  const { dialogAnalysisId, eventLevel } = params;

  if (!dialogAnalysisId) {
    log.warn({ eventLevel }, 'Cannot use atomic send without dialogAnalysisId');
    return sendCapiEvent(params);
  }

  const flagColumn = {
    1: 'capi_interest_sent',
    2: 'capi_qualified_sent',
    3: 'capi_scheduled_sent',
  }[eventLevel];

  const flagAtColumn = `${flagColumn}_at`;
  const flagEventIdColumn = `${flagColumn.replace('_sent', '_event_id')}`;

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
    }, 'Skipping CAPI event - already sent or not found');

    return {
      success: false,
      error: 'Event already sent or dialog not found',
    };
  }

  // Successfully claimed - now send the event
  const response = await sendCapiEvent(params);

  if (!response.success) {
    // Rollback claim to allow retry on next message/cron run
    const { error: rollbackError } = await supabase
      .from('dialog_analysis')
      .update({
        [flagColumn]: false,
        [flagAtColumn]: null,
        [flagEventIdColumn]: null,
      })
      .eq('id', dialogAnalysisId);

    if (rollbackError) {
      log.error({
        dialogAnalysisId,
        eventLevel,
        error: rollbackError.message,
      }, 'Failed to rollback CAPI claim after send failure');
    } else {
      log.warn({
        dialogAnalysisId,
        eventLevel,
        error: response.error,
      }, 'CAPI send failed, claim rolled back for retry');
    }
  } else if (response.eventId) {
    // Update with event_id
    await supabase
      .from('dialog_analysis')
      .update({ [flagEventIdColumn]: response.eventId })
      .eq('id', dialogAnalysisId);
  }

  return response;
}

/**
 * Get pixel info for a direction
 * Optimized: single query with JOINs instead of 4 separate queries
 */
export async function getDirectionPixelInfo(directionId: string): Promise<{
  pixelId: string | null;
  accessToken: string | null;
}> {
  try {
    // Single query with all necessary JOINs
    const { data: direction, error } = await supabase
      .from('account_directions')
      .select(`
        id,
        user_account_id,
        account_id,
        default_ad_settings(pixel_id),
        ad_accounts(access_token),
        user_accounts(access_token)
      `)
      .eq('id', directionId)
      .single();

    if (error) {
      log.warn({ error: error.message, directionId }, 'Error fetching direction pixel info');
      return { pixelId: null, accessToken: null };
    }

    if (!direction) {
      log.debug({ directionId }, 'Direction not found');
      return { pixelId: null, accessToken: null };
    }

    // Extract pixel_id from default_ad_settings (could be array or object)
    // Type assertion needed because Supabase doesn't infer JOIN types correctly
    const settings = direction.default_ad_settings as { pixel_id?: string } | { pixel_id?: string }[] | null;
    const pixelId = Array.isArray(settings)
      ? settings[0]?.pixel_id
      : settings?.pixel_id;

    if (!pixelId) {
      log.debug({ directionId }, 'No pixel_id found for direction');
      return { pixelId: null, accessToken: null };
    }

    // Get access token: prefer ad_accounts, fallback to user_accounts
    // Type assertions for JOIN relations
    const adAccount = direction.ad_accounts as { access_token?: string } | { access_token?: string }[] | null;
    const userAccount = direction.user_accounts as { access_token?: string } | { access_token?: string }[] | null;

    const accessToken = (Array.isArray(adAccount) ? adAccount[0]?.access_token : adAccount?.access_token)
      || (Array.isArray(userAccount) ? userAccount[0]?.access_token : userAccount?.access_token)
      || null;

    if (!accessToken) {
      log.warn({ directionId, pixelId }, 'Found pixel but no access_token');
    }

    return { pixelId, accessToken };
  } catch (error) {
    log.error({
      error: error instanceof Error ? error.message : String(error),
      directionId,
    }, 'Error getting direction pixel info');
    return { pixelId: null, accessToken: null };
  }
}
