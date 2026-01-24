import crypto from 'crypto';

// ============================================
// WABA Webhook Types
// ============================================

export interface WabaWebhookPayload {
  object: string;
  entry: WabaEntry[];
}

export interface WabaEntry {
  id: string;
  changes: WabaChange[];
}

export interface WabaChange {
  value: WabaValue;
  field: string;
}

export interface WabaValue {
  messaging_product: string;
  metadata: WabaMetadata;
  contacts?: WabaContact[];
  messages?: WabaMessage[];
  statuses?: WabaStatus[];
}

export interface WabaMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

export interface WabaContact {
  profile: {
    name: string;
  };
  wa_id: string;
}

export interface WabaMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'button' | 'interactive' | 'sticker' | 'location' | 'contacts';
  text?: { body: string };
  referral?: WabaReferral;
  context?: {
    from: string;
    id: string;
  };
}

export interface WabaReferral {
  source_id: string;      // Facebook Ad ID
  source_type: string;    // "ad" or "post"
  source_url: string;     // URL to the ad/post
  headline?: string;      // Ad headline
  body?: string;          // Ad body text
  media_type?: string;    // "image" or "video"
  image_url?: string;
  video_url?: string;
  thumbnail_url?: string;
  ctwa_clid?: string;     // Click-to-WhatsApp Click ID for CAPI
}

export interface WabaStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: Array<{
    code: number;
    title: string;
    message?: string;
  }>;
}

// ============================================
// Security: X-Hub-Signature-256 Verification
// ============================================

/**
 * Verify WABA webhook signature using HMAC-SHA256
 * Meta signs all payloads with App Secret
 *
 * @param rawBody - Raw request body as Buffer (BEFORE JSON parsing)
 * @param signature - X-Hub-Signature-256 header value
 * @param appSecret - Meta App Secret
 * @returns true if signature is valid
 */
export function verifyWabaSignature(
  rawBody: Buffer | string | undefined,
  signature: string | undefined,
  appSecret: string
): boolean {
  if (!signature || !appSecret || !rawBody) {
    return false;
  }

  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

  const expectedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(body)
    .digest('hex');

  const providedSignature = signature.replace('sha256=', '');

  // Ensure both have same length for timing-safe comparison
  if (expectedSignature.length !== providedSignature.length) {
    return false;
  }

  // Timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(providedSignature, 'hex')
    );
  } catch {
    return false;
  }
}

// ============================================
// Phone Number Utilities
// ============================================

/**
 * Normalize phone number from WABA format
 * WABA returns clean digits: "79001234567"
 * We store with +: "+79001234567"
 */
export function normalizeWabaPhone(phone: string): string {
  if (!phone) return '';

  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // Add + prefix for consistent storage
  return digits.startsWith('+') ? digits : `+${digits}`;
}

/**
 * Extract message text from WABA message
 */
export function extractMessageText(message: WabaMessage): string {
  switch (message.type) {
    case 'text':
      return message.text?.body || '';
    case 'button':
      return (message as any).button?.text || '';
    case 'interactive':
      const interactive = (message as any).interactive;
      return interactive?.button_reply?.title ||
             interactive?.list_reply?.title ||
             '';
    default:
      return '';
  }
}

/**
 * Check if message has ad referral data
 */
export function hasAdReferral(message: WabaMessage): boolean {
  return !!(message.referral?.source_id);
}
