import { supabase } from './supabase.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'adCreativeMapping' });

export interface SaveAdMappingParams {
  ad_id: string;
  user_creative_id: string;
  direction_id?: string | null;
  user_id: string;
  adset_id?: string;
  campaign_id?: string;
  fb_creative_id?: string;
  source: 'creative_test' | 'direction_launch' | 'campaign_builder' | 'duplicate';
}

/**
 * Сохраняет связь между Facebook Ad и креативом/направлением
 * Используется для трекинга лидов из WhatsApp по ad_id
 */
export async function saveAdCreativeMapping(params: SaveAdMappingParams): Promise<void> {
  const {
    ad_id,
    user_creative_id,
    direction_id,
    user_id,
    adset_id,
    campaign_id,
    fb_creative_id,
    source
  } = params;

  try {
    const { error } = await supabase
      .from('ad_creative_mapping')
      .insert({
        ad_id,
        user_creative_id,
        direction_id,
        user_id,
        adset_id,
        campaign_id,
        fb_creative_id,
        source,
        created_at: new Date().toISOString()
      });

    if (error) {
      // Игнорируем дубликаты (conflict on ad_id)
      if (error.code === '23505') {
        log.debug({ ad_id, user_creative_id }, 'Ad mapping already exists');
        return;
      }
      
      log.error({ error: error.message, ad_id, user_creative_id }, 'Failed to save ad mapping');
      // Не прерываем выполнение, только логируем
    } else {
      log.info({ ad_id, user_creative_id, direction_id, source }, 'Ad mapping saved');
    }
  } catch (err: any) {
    log.error({ err: err.message, ad_id }, 'Error saving ad mapping');
    // Не прерываем выполнение
  }
}

/**
 * Сохраняет несколько маппингов за раз
 */
export async function saveAdCreativeMappingBatch(mappings: SaveAdMappingParams[]): Promise<void> {
  if (mappings.length === 0) return;

  try {
    const { error } = await supabase
      .from('ad_creative_mapping')
      .insert(
        mappings.map(m => ({
          ad_id: m.ad_id,
          user_creative_id: m.user_creative_id,
          direction_id: m.direction_id,
          user_id: m.user_id,
          adset_id: m.adset_id,
          campaign_id: m.campaign_id,
          fb_creative_id: m.fb_creative_id,
          source: m.source,
          created_at: new Date().toISOString()
        }))
      );

    if (error && error.code !== '23505') {
      log.error({ error: error.message, count: mappings.length }, 'Failed to save ad mappings batch');
    } else {
      log.info({ count: mappings.length }, 'Ad mappings batch saved');
    }
  } catch (err: any) {
    log.error({ err: err.message, count: mappings.length }, 'Error saving ad mappings batch');
  }
}
