/**
 * Phone number normalization utility for matching leads across different sources
 * 
 * Handles various phone number formats:
 * - International format: +7 (999) 123-45-67
 * - WhatsApp format: 79991234567@s.whatsapp.net or @c.us
 * - Russian format with 8: 8 999 123 45 67
 * - Plain digits: 79991234567
 * 
 * @module phoneNormalization
 */

/**
 * Normalize phone number to a consistent format for matching
 * Returns phone number as digits only (without +), with WhatsApp suffixes removed
 * 
 * @param phone - Phone number in any format
 * @returns Normalized phone number (digits only)
 * 
 * @example
 * normalizePhoneNumber('+7 (999) 123-45-67') // '79991234567'
 * normalizePhoneNumber('79991234567@s.whatsapp.net') // '79991234567'
 * normalizePhoneNumber('8 999 123 45 67') // '9991234567'
 */
export function normalizePhoneNumber(phone: string | null | undefined): string {
  if (!phone) {
    return '';
  }

  // Remove WhatsApp suffixes
  let normalized = phone
    .replace(/@s\.whatsapp\.net/g, '')
    .replace(/@c\.us/g, '');

  // Remove all non-digit characters except leading +
  normalized = normalized.replace(/[^\d+]/g, '');

  // Remove leading +
  normalized = normalized.replace(/^\+/, '');

  // Handle Russian format starting with 8 (convert to 7)
  // 8 999 123 45 67 → 79991234567
  if (normalized.startsWith('8') && normalized.length === 11) {
    normalized = '7' + normalized.slice(1);
  }

  return normalized;
}

/**
 * Validate that a normalized phone number looks like a real phone number.
 * Rejects Meta Lead IDs and other non-phone identifiers that slip through as remoteJid.
 *
 * E.164 allows up to 15 digits, but in practice the longest real phones are 13 digits
 * (China: +86 1XX XXXX XXXX). Meta Lead IDs are typically 14–18 digits and slip through
 * as remoteJid with @s.whatsapp.net suffix. Using max 13 catches them reliably.
 *
 * @param phone - Already normalized phone (digits only, no +)
 * @returns true if it looks like a real phone number
 */
export function isValidPhoneNumber(phone: string): boolean {
  if (!phone) return false;
  if (!/^\d+$/.test(phone)) return false;
  // Real phones: 7–13 digits (covers all countries; Meta Lead IDs are 14+ digits)
  if (phone.length < 7 || phone.length > 13) return false;
  // Real country codes never start with 0
  if (phone.startsWith('0')) return false;
  return true;
}

/**
 * Check if two phone numbers match after normalization
 * 
 * @param phone1 - First phone number
 * @param phone2 - Second phone number
 * @returns true if phones match after normalization
 * 
 * @example
 * phonesMatch('+79991234567', '79991234567@s.whatsapp.net') // true
 * phonesMatch('8 999 123 45 67', '+7 (999) 123-45-67') // true
 */
export function phonesMatch(
  phone1: string | null | undefined,
  phone2: string | null | undefined
): boolean {
  const normalized1 = normalizePhoneNumber(phone1);
  const normalized2 = normalizePhoneNumber(phone2);
  
  if (!normalized1 || !normalized2) {
    return false;
  }
  
  return normalized1 === normalized2;
}

/**
 * Format phone number for display (Russian format)
 * 
 * @param phone - Phone number in any format
 * @returns Formatted phone number: +7 (999) 123-45-67
 * 
 * @example
 * formatPhoneNumber('79991234567') // '+7 (999) 123-45-67'
 */
export function formatPhoneNumber(phone: string | null | undefined): string {
  const normalized = normalizePhoneNumber(phone);
  
  if (!normalized) {
    return '';
  }
  
  // Russian format: +7 (XXX) XXX-XX-XX
  if (normalized.startsWith('7') && normalized.length === 11) {
    return `+${normalized[0]} (${normalized.slice(1, 4)}) ${normalized.slice(4, 7)}-${normalized.slice(7, 9)}-${normalized.slice(9)}`;
  }
  
  // International format: just add +
  return `+${normalized}`;
}

