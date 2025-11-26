/**
 * Creative Resolver
 * 
 * Resolve creative_id and direction_id from Facebook Ad ID
 * 
 * This module provides a unified way to map Facebook Ad IDs to creatives and directions.
 * Used by:
 * - WhatsApp webhooks (Evolution API, Green API) - for leads from WhatsApp ads
 * - Tilda leads endpoint - for website leads with UTM parameters containing ad_id
 * 
 * @module lib/creativeResolver
 */

import { supabase } from './supabase.js';
import { FastifyInstance } from 'fastify';

/**
 * Resolve creative_id, direction_id, and whatsapp_phone_number_id from Facebook Ad ID
 *
 * Strategy:
 * 1. PRIMARY: Lookup in ad_creative_mapping by ad_id
 *    - This is the main source of truth for ad-to-creative mapping
 *    - Populated when ads are created via the platform
 * 
 * 2. FALLBACK: Lookup in user_creatives by creative URL matching
 *    - Used for WhatsApp messages that include Instagram post URLs
 *    - Matches URL patterns in creative titles
 * 
 * @param sourceId - Facebook Ad ID (from webhook metadata or UTM parameters)
 * @param sourceUrl - Optional creative URL for fallback matching (mainly for WhatsApp)
 * @param userAccountId - User account UUID for scoping the lookup
 * @param app - Fastify instance for logging
 * 
 * @returns Object containing:
 *   - creativeId: UUID of the matched creative, or null if not found
 *   - directionId: UUID of the associated direction, or null if not found
 *   - whatsappPhoneNumberId: UUID of WhatsApp number (from direction), or null
 * 
 * @example
 * // For Tilda lead with ad_id in UTM
 * const result = await resolveCreativeAndDirection(
 *   '123456789', // ad_id from utm_content
 *   null,        // no URL for Tilda
 *   userId,
 *   app
 * );
 * 
 * @example
 * // For WhatsApp lead with ad metadata
 * const result = await resolveCreativeAndDirection(
 *   adId,        // from WhatsApp message metadata
 *   postUrl,     // Instagram post URL as fallback
 *   userId,
 *   app
 * );
 */
export async function resolveCreativeAndDirection(
  sourceId: string,
  sourceUrl: string | null,
  userAccountId: string,
  app: FastifyInstance
): Promise<{ 
  creativeId: string | null; 
  directionId: string | null;
  whatsappPhoneNumberId: string | null;
}> {

  // PRIMARY LOOKUP: Find in ad_creative_mapping by ad_id
  const { data: adMapping, error: mappingError } = await supabase
    .from('ad_creative_mapping')
    .select(`
      user_creative_id,
      direction_id,
      account_directions(whatsapp_phone_number_id)
    `)
    .eq('ad_id', sourceId)
    .eq('user_id', userAccountId)
    .maybeSingle();

  if (mappingError) {
    app.log.error({ error: mappingError.message, sourceId }, 'Error looking up ad_creative_mapping');
  }

  if (adMapping) {
    const whatsappPhoneNumberId = (adMapping as any)?.account_directions?.whatsapp_phone_number_id || null;

    app.log.debug({
      sourceId,
      creativeId: adMapping.user_creative_id,
      directionId: adMapping.direction_id,
      whatsappPhoneNumberId,
    }, 'Found creative via ad_creative_mapping');

    return {
      creativeId: adMapping.user_creative_id,
      directionId: adMapping.direction_id,
      whatsappPhoneNumberId,
    };
  }

  // FALLBACK LOOKUP: Find by creative URL matching
  if (sourceUrl) {
    const { data: creativeByUrl, error: urlError } = await supabase
      .from('user_creatives')
      .select(`
        id, 
        direction_id,
        account_directions(whatsapp_phone_number_id)
      `)
      .eq('user_id', userAccountId)
      .ilike('title', `%${sourceUrl}%`)
      .maybeSingle();

    if (urlError) {
      app.log.error({ error: urlError.message, sourceUrl }, 'Error looking up user_creatives by URL');
    }

    if (creativeByUrl) {
      const whatsappPhoneNumberId = (creativeByUrl as any)?.account_directions?.whatsapp_phone_number_id || null;

      app.log.debug({
        sourceUrl,
        creativeId: creativeByUrl.id,
        directionId: creativeByUrl.direction_id,
        whatsappPhoneNumberId,
      }, 'Found creative via URL matching');

      return {
        creativeId: creativeByUrl.id,
        directionId: creativeByUrl.direction_id,
        whatsappPhoneNumberId,
      };
    }
  }

  app.log.warn({ sourceId, sourceUrl }, 'Could not resolve creative_id and direction_id');

  return {
    creativeId: null,
    directionId: null,
    whatsappPhoneNumberId: null,
  };
}





