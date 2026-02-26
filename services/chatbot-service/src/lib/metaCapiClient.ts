/**
 * Meta Conversions API (CAPI) Client
 *
 * Отправляет события конверсий в Facebook для оптимизации рекламы.
 *
 * WhatsApp CTWA (business_messaging): все уровни = Purchase с разным value
 *   L1 (интерес): Purchase, value=1
 *   L2 (квалифицирован): Purchase, value=10
 *   L3 (записался/купил): Purchase, value=100
 *
 * Meta разрешает только Purchase и LeadSubmitted для action_source=business_messaging.
 * Только Purchase можно использовать в promoted_object адсета с destination_type=WHATSAPP.
 */

import crypto from 'crypto';
import { createLogger } from './logger.js';
import { supabase } from './supabase.js';
import { resolveCapiSettingsForDirection } from './capiSettingsResolver.js';

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

// WhatsApp CTWA: value по уровням для оптимизации (все как Purchase)
const WHATSAPP_LEVEL_VALUES: Record<number, number> = {
  1: 1,    // L1: интерес
  2: 10,   // L2: квалифицирован
  3: 100,  // L3: записался/купил
};

const ALLOWED_ACTION_SOURCES = new Set([
  'email',
  'website',
  'app',
  'phone_call',
  'chat',
  'physical_store',
  'system_generated',
  'business_messaging',
  'other',
]);

// Event names for each conversion level
export const CAPI_EVENTS = {
  // WhatsApp CTWA: все уровни = Purchase (единственное событие поддерживаемое для оптимизации)
  PURCHASE: 'Purchase',
  // Messaging dataset: для отчётности (не для оптимизации)
  LEAD_SUBMITTED: 'LeadSubmitted',
  // Website/CRM dataset
  LEAD: 'Lead',
  // Legacy aliases
  INTEREST: 'Purchase',             // L1: was CompleteRegistration
  QUALIFIED: 'Purchase',            // L2: was AddToCart/Subscribe
  SCHEDULED: 'Purchase',            // L3: Purchase
} as const;

export type CapiEventName = 'LeadSubmitted' | 'Lead' | typeof CAPI_EVENTS[keyof typeof CAPI_EVENTS] | string;
export type CapiEventLevel = 1 | 2 | 3;

// CRM dataset: разные события по уровням для качественной оптимизации Meta
export const CRM_LEVEL_EVENTS: Record<number, string> = {
  1: 'Contact',     // L1: первый контакт / интерес
  2: 'Schedule',    // L2: квалифицирован / назначена встреча
  3: 'StartTrial',  // L3: закрыт / начало использования
};

export function getCrmEventByLevel(level: CapiEventLevel): string {
  return CRM_LEVEL_EVENTS[level] || 'Contact';
}

// Site dataset: события для site conversion_channel (должны совпадать с promoted_object.custom_event_type)
export const SITE_LEVEL_EVENTS: Record<number, string> = {
  1: 'CompleteRegistration',  // matches promoted_object COMPLETE_REGISTRATION
  2: 'AddToCart',             // matches promoted_object ADD_TO_CART
  3: 'Purchase',              // matches promoted_object PURCHASE
};

export function getSiteEventByLevel(level: CapiEventLevel): string {
  return SITE_LEVEL_EVENTS[level] || 'CompleteRegistration';
}
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
  firstName?: string;    // Will be hashed (fn)
  lastName?: string;     // Will be hashed (ln)
  ctwaClid?: string;     // Click-to-WhatsApp Click ID (in user_data for Messaging dataset)
  pageId?: string;       // Facebook Page ID (in user_data for Messaging dataset)
  leadgenId?: string;    // Meta's lead form ID (15-17 digits, highest priority for CRM matching)

  // Site channel fields (NOT hashed, sent as-is per Meta docs)
  fbc?: string;              // Facebook Click Cookie (fb.1.{timestamp}.{fbclid})
  fbp?: string;              // Facebook Browser Pixel cookie
  conversionChannel?: string; // 'whatsapp' | 'lead_form' | 'site'

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

function normalizeCtwaClid(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Generate deterministic event ID for deduplication
 * Level 1 prioritizes ctwa_clid when available to avoid dedup collisions
 * between repeated ad clicks for the same lead.
 */
function generateEventId(params: CapiEventParams): { eventId: string; strategy: string } {
  const levelSuffix = {
    1: 'lead_l1',
    2: 'lead_l2',
    3: 'lead_l3',
  }[params.eventLevel];
  const normalizedCtwaClid = normalizeCtwaClid(params.ctwaClid);

  if (params.eventLevel === 1 && normalizedCtwaClid) {
    return {
      eventId: `wa_${normalizedCtwaClid}_${levelSuffix}_v2`,
      strategy: 'ctwa_level1_v2',
    };
  }

  const baseId = params.leadId || params.dialogAnalysisId || params.phone || params.email || normalizedCtwaClid;

  if (params.leadId || params.dialogAnalysisId) {
    return {
      eventId: `wa_${baseId}_${levelSuffix}_v1`,
      strategy: 'lead_or_dialog',
    };
  }

  if (params.phone) {
    return {
      eventId: `wa_${hashPhone(params.phone)}_${levelSuffix}_v1`,
      strategy: 'phone_hash',
    };
  }

  if (params.email) {
    return {
      eventId: `wa_${hashForCapi(params.email)}_${levelSuffix}_v1`,
      strategy: 'email_hash',
    };
  }

  if (normalizedCtwaClid) {
    return {
      eventId: `wa_${normalizedCtwaClid}_${levelSuffix}_v1`,
      strategy: 'ctwa_v1',
    };
  }

  const fallback = crypto.randomUUID();
  return {
    eventId: `wa_${fallback}_${levelSuffix}_v1`,
    strategy: 'random_uuid',
  };
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
  const normalizedCtwaClid = normalizeCtwaClid(ctwaClid);
  const businessMessagingEnabled = process.env.META_CAPI_ENABLE_BUSINESS_MESSAGING !== 'false';
  const useBusinessMessaging = !!normalizedCtwaClid && businessMessagingEnabled;

  const configuredFallbackActionSource = (process.env.META_CAPI_ACTION_SOURCE || 'system_generated').trim();
  const normalizedFallbackActionSource = (configuredFallbackActionSource || 'system_generated').toLowerCase();

  let safeFallbackActionSource = normalizedFallbackActionSource;
  if (!ALLOWED_ACTION_SOURCES.has(safeFallbackActionSource)) {
    log.warn({
      configuredFallbackActionSource,
      fallback: 'system_generated'
    }, 'Invalid META_CAPI_ACTION_SOURCE config, falling back to system_generated');
    safeFallbackActionSource = 'system_generated';
  }

  if (!normalizedCtwaClid && safeFallbackActionSource === 'business_messaging') {
    log.warn({
      configuredFallbackActionSource,
      fallback: 'system_generated'
    }, 'META_CAPI_ACTION_SOURCE=business_messaging requires ctwa_clid, falling back to system_generated');
    safeFallbackActionSource = 'system_generated';
  }

  let actionSource: string;
  if (useBusinessMessaging) {
    actionSource = 'business_messaging';
  } else if (params.conversionChannel === 'site') {
    actionSource = 'website';
  } else {
    actionSource = safeFallbackActionSource;
  }

  // WhatsApp CTWA: Meta разрешает только Purchase и LeadSubmitted для business_messaging,
  // но только Purchase работает в promoted_object адсета. Поэтому все уровни = Purchase.
  const effectiveEventName = useBusinessMessaging ? 'Purchase' : eventName;

  log.info({
    correlationId,
    pixelId,
    eventName,
    effectiveEventName,
    eventLevel,
    hasPhone: !!phone,
    hasEmail: !!email,
    hasCtwaClid: !!normalizedCtwaClid,
    ctwaClidPrefix: normalizedCtwaClid ? normalizedCtwaClid.slice(0, 10) : null,
    useBusinessMessaging,
    businessMessagingEnabled,
    actionSource,
    configuredFallbackActionSource,
    normalizedFallbackActionSource,
    whatsappLevelValue: useBusinessMessaging ? WHATSAPP_LEVEL_VALUES[eventLevel] : null,
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
    const { eventId, strategy: eventIdStrategy } = generateEventId({
      ...params,
      ctwaClid: normalizedCtwaClid,
    });
    const eventTime = Math.floor(Date.now() / 1000);

    log.debug({
      correlationId,
      eventLevel,
      eventId,
      eventIdStrategy,
      leadId: leadId || null,
      dialogAnalysisId: dialogAnalysisId || null,
      hasCtwaClid: !!normalizedCtwaClid
    }, 'Generated deterministic CAPI event_id');

    // Build user_data object
    const userData: Record<string, string | string[] | number> = {};

    // For business_messaging (CTWA): only ctwa_clid + page_id, no PII fields
    // Meta matches exclusively via ctwa_clid for WhatsApp events
    if (!useBusinessMessaging) {
      if (phone) {
        userData.ph = [hashPhone(phone)];
      }

      if (email) {
        userData.em = [hashForCapi(email)];
      }

      if (params.firstName) {
        userData.fn = [hashForCapi(params.firstName)];
      }

      if (params.lastName) {
        userData.ln = [hashForCapi(params.lastName)];
      }

      if (leadId) {
        userData.external_id = String(leadId);
      }

      // Meta's lead form ID (highest priority for CRM dataset matching per Meta docs)
      // Must be a number per Meta's payload spec
      if (params.leadgenId) {
        const numericLeadId = Number(params.leadgenId);
        if (Number.isFinite(numericLeadId)) {
          userData.lead_id = numericLeadId;
        }
      }

      // Country hash for better matching (Kazakhstan)
      userData.country = [hashForCapi('kz')];
    }

    // Messaging dataset: ctwa_clid in user_data (NOT top-level)
    if (normalizedCtwaClid) {
      userData.ctwa_clid = normalizedCtwaClid;
    }

    // page_id in user_data (required for Messaging dataset)
    if (params.pageId) {
      userData.page_id = params.pageId;
    }

    // Site channel: fbc/fbp cookies for website attribution (NOT hashed per Meta docs)
    if (params.fbc) {
      userData.fbc = params.fbc;
    }
    if (params.fbp) {
      userData.fbp = params.fbp;
    }

    const mergedCustomData: Record<string, unknown> = {
      // event_level only for non-messaging (business_messaging expects clean custom_data)
      ...(useBusinessMessaging ? {} : { event_level: eventLevel }),
      ...customData,
    };

    // Purchase events: добавляем currency и value
    if (effectiveEventName === 'Purchase') {
      if (mergedCustomData.currency == null) {
        mergedCustomData.currency = PURCHASE_CURRENCY;
      }
      if (mergedCustomData.value == null) {
        mergedCustomData.value = useBusinessMessaging
          ? (WHATSAPP_LEVEL_VALUES[eventLevel] ?? PURCHASE_DEFAULT_VALUE)
          : PURCHASE_DEFAULT_VALUE;
      }
    }

    // Build event payload
    const eventPayload: Record<string, unknown> = {
      event_name: effectiveEventName,
      event_time: eventTime,
      event_id: eventId,
      action_source: actionSource,
      user_data: userData,
      custom_data: mergedCustomData,
    };

    // Meta rejects event_source_url for business_messaging payloads.
    if (eventSourceUrl && !useBusinessMessaging) {
      eventPayload.event_source_url = eventSourceUrl;
    } else if (eventSourceUrl && useBusinessMessaging) {
      log.debug({
        correlationId,
        eventName,
        actionSource
      }, 'Skipping event_source_url for business_messaging payload');
    }

    if (useBusinessMessaging) {
      eventPayload.messaging_channel = 'whatsapp';
      // ctwa_clid is now in user_data (per Meta Messaging dataset spec)
    } else if (normalizedCtwaClid && !businessMessagingEnabled) {
      log.info({
        correlationId,
        eventName,
        ctwaClidPrefix: normalizedCtwaClid.slice(0, 10)
      }, 'ctwa_clid present but META_CAPI_ENABLE_BUSINESS_MESSAGING=false, using fallback action_source');
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
        ctwaClid: normalizedCtwaClid,
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
      ctwaClid: normalizedCtwaClid,
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
      ctwaClid: normalizedCtwaClid,
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
    .maybeSingle();

  if (error) {
    log.warn({
      dialogAnalysisId,
      eventLevel,
      error: error.message,
      code: error.code,
      reason: 'db_error',
    }, 'Skipping CAPI event - DB error during atomic claim');
    return { success: false, error: 'DB error during atomic claim' };
  }

  if (!data) {
    log.info({
      dialogAnalysisId,
      eventLevel,
      reason: 'already_sent',
    }, 'Skipping CAPI event - already sent');

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
  pageId: string | null;
  capiEventLevel: number | null;
}> {
  try {
    // Load direction data (always needed for capi_event_level, page_id, access_token fallback)
    const { data: direction, error } = await supabase
      .from('account_directions')
      .select(`
        id,
        user_account_id,
        account_id,
        optimization_level,
        capi_access_token,
        capi_event_level,
        default_ad_settings(pixel_id),
        ad_accounts(access_token, page_id),
        user_accounts(access_token, page_id, multi_account_enabled)
      `)
      .eq('id', directionId)
      .single();

    if (error || !direction) {
      log.warn({ error: error?.message, directionId }, 'Error fetching direction pixel info');
      return { pixelId: null, accessToken: null, pageId: null, capiEventLevel: null };
    }

    // Resolve account data for access_token / page_id fallback
    const adAccount = direction.ad_accounts as { access_token?: string; page_id?: string } | { access_token?: string; page_id?: string }[] | null;
    const userAccount = direction.user_accounts as { access_token?: string; page_id?: string; multi_account_enabled?: boolean } | { access_token?: string; page_id?: string; multi_account_enabled?: boolean }[] | null;
    const userAccountData = Array.isArray(userAccount) ? userAccount[0] : userAccount;
    const adAccountData = Array.isArray(adAccount) ? adAccount[0] : adAccount;
    const isMultiAccount = userAccountData?.multi_account_enabled === true;

    // Page ID: resolve by account type
    const pageId = isMultiAccount
      ? (adAccountData?.page_id || null)
      : (userAccountData?.page_id || null);

    // Event level: per-direction (stays in account_directions)
    // Only use explicit capi_event_level, NOT optimization_level as fallback.
    // optimization_level controls ad optimization, not which CAPI events to send.
    const capiEventLevel = ((direction as Record<string, unknown>).capi_event_level as number) ?? null;

    // 1. Try capi_settings table first (new architecture)
    const resolved = await resolveCapiSettingsForDirection(directionId);

    if (resolved) {
      // Access token: capi_settings.capi_access_token → account fallback
      const accessToken = resolved.accessToken
        || (isMultiAccount ? adAccountData?.access_token : userAccountData?.access_token)
        || null;

      if (!accessToken) {
        log.warn({ directionId, pixelId: resolved.pixelId }, 'Found pixel but no access_token');
      }

      return { pixelId: resolved.pixelId, accessToken, pageId, capiEventLevel };
    }

    // 2. Fallback: legacy pixel from default_ad_settings
    const settings = direction.default_ad_settings as { pixel_id?: string } | { pixel_id?: string }[] | null;
    const pixelId = Array.isArray(settings)
      ? settings[0]?.pixel_id
      : settings?.pixel_id;

    if (!pixelId) {
      log.debug({ directionId }, 'No pixel_id found for direction');
      return { pixelId: null, accessToken: null, pageId: null, capiEventLevel: null };
    }

    const accessToken = (direction as Record<string, unknown>).capi_access_token as string
      || (isMultiAccount ? adAccountData?.access_token : userAccountData?.access_token)
      || null;

    if (!accessToken) {
      log.warn({ directionId, pixelId }, 'Found pixel but no access_token');
    }

    return { pixelId, accessToken, pageId, capiEventLevel };
  } catch (error) {
    log.error({
      error: error instanceof Error ? error.message : String(error),
      directionId,
    }, 'Error getting direction pixel info');
    return { pixelId: null, accessToken: null, pageId: null, capiEventLevel: null };
  }
}
