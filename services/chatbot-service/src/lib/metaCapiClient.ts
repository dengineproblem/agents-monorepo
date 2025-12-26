/**
 * Meta Conversions API (CAPI) Client
 *
 * Отправляет события конверсий в Facebook для оптимизации рекламы.
 *
 * Три уровня событий:
 * 1. Lead (INTEREST) - клиент проявил интерес (2+ сообщения)
 * 2. CompleteRegistration (QUALIFIED) - клиент квалифицирован
 * 3. Schedule (SCHEDULED) - клиент записался на консультацию/встречу
 */

import crypto from 'crypto';
import { createLogger } from './logger.js';
import { supabase } from './supabase.js';

const log = createLogger({ module: 'metaCapiClient' });

// Meta Conversions API endpoint
const CAPI_BASE_URL = 'https://graph.facebook.com/v20.0';

// Event names for each conversion level
export const CAPI_EVENTS = {
  INTEREST: 'Lead',                  // Level 1: 2+ messages
  QUALIFIED: 'CompleteRegistration', // Level 2: Passed qualification
  SCHEDULED: 'Schedule',             // Level 3: Booked appointment
} as const;

export type CapiEventName = typeof CAPI_EVENTS[keyof typeof CAPI_EVENTS];
export type CapiEventLevel = 1 | 2 | 3;

export interface CapiEventParams {
  // Required
  pixelId: string;
  accessToken: string;
  eventName: CapiEventName;
  eventLevel: CapiEventLevel;

  // User data for matching (at least one required)
  phone?: string;        // Will be hashed
  email?: string;        // Will be hashed
  ctwaClid?: string;     // Click-to-WhatsApp Click ID (not hashed)

  // Context
  dialogAnalysisId?: string;
  leadId?: string;
  userAccountId: string;
  directionId?: string;

  // Optional event data
  eventSourceUrl?: string;
  customData?: Record<string, unknown>;
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
 * Removes all non-digits, then hashes
 */
function hashPhone(phone: string): string {
  const normalized = phone.replace(/\D/g, '');
  return hashForCapi(normalized);
}

/**
 * Generate unique event ID for deduplication
 */
function generateEventId(params: CapiEventParams): string {
  const data = `${params.pixelId}-${params.eventName}-${params.phone || params.ctwaClid}-${Date.now()}`;
  return crypto.createHash('md5').update(data).digest('hex');
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
  } = params;

  log.info({
    pixelId,
    eventName,
    eventLevel,
    hasPhone: !!phone,
    hasEmail: !!email,
    hasCtwaClid: !!ctwaClid,
    dialogAnalysisId,
  }, 'Sending CAPI event');

  // Validate required params
  if (!pixelId || !accessToken) {
    log.warn({ pixelId, hasAccessToken: !!accessToken }, 'Missing pixelId or accessToken, skipping CAPI event');
    return { success: false, error: 'Missing pixelId or accessToken' };
  }

  // Need at least one user identifier
  if (!phone && !email && !ctwaClid) {
    log.warn({}, 'No user data (phone, email, or ctwaClid) provided, skipping CAPI event');
    return { success: false, error: 'No user data provided' };
  }

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

    // ctwa_clid is NOT hashed - it's passed as-is
    if (ctwaClid) {
      userData.ctwa_clid = ctwaClid;
    }

    // Build event payload
    const eventPayload = {
      event_name: eventName,
      event_time: eventTime,
      event_id: eventId,
      event_source_url: eventSourceUrl || 'https://wa.me/',
      action_source: 'business_messaging', // For Click-to-WhatsApp
      messaging_channel: 'whatsapp',
      user_data: userData,
      custom_data: {
        event_level: eventLevel,
        ...customData,
      },
    };

    // Send to CAPI
    const url = `${CAPI_BASE_URL}/${pixelId}/events`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: [eventPayload],
        access_token: accessToken,
      }),
    });

    const responseData = await response.json();

    if (!response.ok) {
      log.error({
        pixelId,
        eventName,
        status: response.status,
        error: responseData,
      }, 'CAPI request failed');

      // Log to database
      await logCapiEvent({
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
      });

      return {
        success: false,
        error: responseData.error?.message || 'CAPI request failed',
        facebookResponse: responseData,
      };
    }

    log.info({
      pixelId,
      eventName,
      eventLevel,
      eventId,
      eventsReceived: responseData.events_received,
    }, 'CAPI event sent successfully');

    // Log to database
    await logCapiEvent({
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
    });

    return {
      success: true,
      eventId,
      facebookResponse: responseData,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    log.error({
      pixelId,
      eventName,
      error: errorMessage,
    }, 'Error sending CAPI event');

    // Log to database
    await logCapiEvent({
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
      capiError: errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Log CAPI event to database for audit trail
 */
async function logCapiEvent(params: {
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
}): Promise<void> {
  try {
    await supabase.from('capi_events_log').insert({
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
    });
  } catch (error) {
    log.error({ error }, 'Failed to log CAPI event to database');
  }
}

/**
 * Update dialog_analysis with CAPI event flags
 */
export async function updateDialogCapiFlags(
  dialogAnalysisId: string,
  eventLevel: CapiEventLevel,
  eventId: string
): Promise<void> {
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

    await supabase
      .from('dialog_analysis')
      .update(updates)
      .eq('id', dialogAnalysisId);

    log.debug({ dialogAnalysisId, eventLevel, eventId }, 'Updated dialog CAPI flags');
  } catch (error) {
    log.error({ error, dialogAnalysisId, eventLevel }, 'Failed to update dialog CAPI flags');
  }
}

/**
 * Get pixel info for a direction
 */
export async function getDirectionPixelInfo(directionId: string): Promise<{
  pixelId: string | null;
  accessToken: string | null;
}> {
  try {
    // Get direction with default_ad_settings
    const { data: settings } = await supabase
      .from('default_ad_settings')
      .select('pixel_id')
      .eq('direction_id', directionId)
      .single();

    if (!settings?.pixel_id) {
      return { pixelId: null, accessToken: null };
    }

    // Get access token from direction's user account
    const { data: direction } = await supabase
      .from('account_directions')
      .select('user_account_id, account_id')
      .eq('id', directionId)
      .single();

    if (!direction) {
      return { pixelId: settings.pixel_id, accessToken: null };
    }

    // Try ad_accounts first (multi-account mode)
    if (direction.account_id) {
      const { data: adAccount } = await supabase
        .from('ad_accounts')
        .select('access_token')
        .eq('id', direction.account_id)
        .single();

      if (adAccount?.access_token) {
        return { pixelId: settings.pixel_id, accessToken: adAccount.access_token };
      }
    }

    // Fallback to user_accounts
    const { data: userAccount } = await supabase
      .from('user_accounts')
      .select('access_token')
      .eq('id', direction.user_account_id)
      .single();

    return {
      pixelId: settings.pixel_id,
      accessToken: userAccount?.access_token || null,
    };
  } catch (error) {
    log.error({ error, directionId }, 'Error getting direction pixel info');
    return { pixelId: null, accessToken: null };
  }
}
