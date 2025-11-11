/**
 * Direction Ad Sets Helper Functions
 * 
 * Функции для работы с pre-created ad sets в режиме use_existing.
 * Используются во всех workflows (AgentBrain, Auto-Launch, Manual-Launch)
 * для выбора, активации и управления заранее созданными ad sets.
 */

import { supabase } from './supabase.js';
import { graph } from '../adapters/facebook.js';
import { logger } from './logger.js';

/**
 * Helper: конвертирует объекты в параметры для Facebook API
 */
function toParams(obj: any): any {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object' && v !== null) {
      out[k] = JSON.stringify(v);
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

/**
 * Получить доступный PAUSED ad set для направления
 * 
 * Логика выбора:
 * 1. Только активные (is_active = true)
 * 2. Только PAUSED (еще не используются)
 * 3. Только не заполненные (ads_count < 50)
 * 4. Сортировка: сначала с минимальным ads_count, затем самые старые
 * 
 * @param directionId - UUID направления
 * @returns Ad set для использования или null если нет доступных
 */
export async function getAvailableAdSet(directionId: string): Promise<{
  id: string;
  fb_adset_id: string;
  adset_name: string;
  ads_count: number;
} | null> {
  logger.info({ directionId }, '🔍 [USE_EXISTING] Searching for available PAUSED ad set...');
  
  const { data: adsets, error } = await supabase
    .from('direction_adsets')
    .select('id, fb_adset_id, adset_name, ads_count, daily_budget_cents, status')
    .eq('direction_id', directionId)
    .eq('is_active', true)
    .eq('status', 'PAUSED')
    .lt('ads_count', 50)
    .order('ads_count', { ascending: true })
    .order('linked_at', { ascending: true })
    .limit(10); // Берём больше чтобы проверить статусы в Facebook

  if (error) {
    logger.error({ error, directionId }, '❌ [USE_EXISTING] Error fetching available ad set from DB');
    return null;
  }

  if (!adsets || adsets.length === 0) {
    logger.warn({ 
      directionId,
      searched_filters: {
        is_active: true,
        status: 'PAUSED',
        ads_count_lt: 50
      }
    }, '⚠️ [USE_EXISTING] No available ad sets found - check if you have PAUSED ad sets linked to this direction');
    return null;
  }

  logger.info({ 
    directionId,
    found_count: adsets.length,
    selected_adset: {
      id: adsets[0].id,
      fb_adset_id: adsets[0].fb_adset_id,
      name: adsets[0].adset_name,
      current_ads_count: adsets[0].ads_count,
      daily_budget_cents: adsets[0].daily_budget_cents
    }
  }, '✅ [USE_EXISTING] Found available ad set (with minimum ads_count)');

  return adsets[0];
}

/**
 * Активировать ad set (PAUSED -> ACTIVE)
 * 
 * Процесс:
 * 1. Активировать в Facebook через API
 * 2. Обновить статус и last_used_at в БД
 * 
 * @param adsetId - UUID записи в direction_adsets
 * @param fbAdSetId - Facebook ad set ID
 * @param accessToken - Facebook access token
 */
export async function activateAdSet(
  adsetId: string,
  fbAdSetId: string,
  accessToken: string
): Promise<void> {
  try {
    logger.info({ 
      adsetId, 
      fbAdSetId 
    }, '🔄 [USE_EXISTING] STEP 1: Checking ad set status in Facebook before activation...');
    
    // 1. Проверить текущий статус в Facebook
    const adsetInfo = await graph('GET', `${fbAdSetId}`, accessToken, {
      fields: 'id,name,status,promoted_object,daily_budget,targeting'
    });

    logger.info({ 
      fbAdSetId, 
      currentStatus: adsetInfo.status,
      name: adsetInfo.name,
      daily_budget: adsetInfo.daily_budget,
      promoted_object: adsetInfo.promoted_object
    }, '✅ [USE_EXISTING] STEP 1: Ad set info retrieved from Facebook');

    // 2. Проверка: если ARCHIVED - нельзя активировать
    if (adsetInfo.status === 'ARCHIVED') {
      logger.error({ 
        fbAdSetId, 
        adsetId,
        status: adsetInfo.status 
      }, '❌ [USE_EXISTING] Ad set is ARCHIVED - cannot activate');
      
      // Пометить в БД как неактивный
      await supabase
        .from('direction_adsets')
        .update({ is_active: false })
        .eq('id', adsetId);

      throw new Error(`Ad set ${fbAdSetId} is ARCHIVED and cannot be activated. Create a new ad set in Facebook Ads Manager.`);
    }

    logger.info({ fbAdSetId }, '🔄 [USE_EXISTING] STEP 2: Activating ad set in Facebook (PAUSED → ACTIVE)...');
    
    // 3. Активировать в Facebook
    await graph('POST', `${fbAdSetId}`, accessToken, toParams({ status: 'ACTIVE' }));

    logger.info({ fbAdSetId }, '✅ [USE_EXISTING] STEP 2: Ad set activated in Facebook');

    logger.info({ adsetId }, '🔄 [USE_EXISTING] STEP 3: Updating ad set status in database...');
    
    // 4. Обновить в БД
    const { error } = await supabase
      .from('direction_adsets')
      .update({
        status: 'ACTIVE',
        last_used_at: new Date().toISOString()
      })
      .eq('id', adsetId);

    if (error) {
      logger.error({ error, adsetId }, '❌ [USE_EXISTING] STEP 3: Error updating ad set status in DB');
      throw error;
    }

    logger.info({ 
      adsetId, 
      fbAdSetId,
      new_status: 'ACTIVE'
    }, '✅ [USE_EXISTING] STEP 3: Ad set status updated in database - ACTIVATION COMPLETE');
  } catch (error) {
    logger.error({ error, adsetId, fbAdSetId }, '❌ [USE_EXISTING] Error activating ad set');
    throw error;
  }
}

/**
 * Деактивировать ad set + все ads внутри (ACTIVE -> PAUSED)
 * 
 * КРИТИЧНО: При деактивации ad set в режиме use_existing обязательно
 * останавливать все ads, чтобы при следующей активации не было путаницы.
 * 
 * Процесс:
 * 1. Получить все ads в ad set
 * 2. Остановить все ACTIVE ads
 * 3. Остановить сам ad set
 * 4. Обновить статус в БД
 * 
 * @param fbAdSetId - Facebook ad set ID
 * @param accessToken - Facebook access token
 */
export async function deactivateAdSetWithAds(
  fbAdSetId: string,
  accessToken: string
): Promise<void> {
  try {
    // 1. Получить все ads в ad set
    const adsResponse = await graph('GET', `${fbAdSetId}/ads`, accessToken, {
      fields: 'id,status'
    });

    const ads = adsResponse.data || [];

    logger.info({ fbAdSetId, adsCount: ads.length }, 'Fetched ads from ad set');

    // 2. Остановить все ACTIVE ads
    let pausedCount = 0;
    for (const ad of ads) {
      if (ad.status === 'ACTIVE') {
        await graph('POST', `${ad.id}`, accessToken, toParams({ status: 'PAUSED' }));
        pausedCount++;
      }
    }

    logger.info({ fbAdSetId, pausedCount }, 'Paused active ads in ad set');

    // 3. Остановить сам ad set
    await graph('POST', `${fbAdSetId}`, accessToken, toParams({ status: 'PAUSED' }));

    logger.info({ fbAdSetId }, 'Paused ad set in Facebook');

    // 4. Обновить в БД
    const { error } = await supabase
      .from('direction_adsets')
      .update({ status: 'PAUSED' })
      .eq('fb_adset_id', fbAdSetId);

    if (error) {
      logger.error({ error, fbAdSetId }, 'Error updating ad set status in DB after pause');
      throw error;
    }

    logger.info({ fbAdSetId, totalAds: ads.length, pausedAds: pausedCount }, 
      'Ad set and all its ads deactivated successfully');
  } catch (error) {
    logger.error({ error, fbAdSetId }, 'Error deactivating ad set with ads');
    throw error;
  }
}

/**
 * Инкрементировать счетчик ads после успешного добавления
 * 
 * Использует атомарную RPC функцию для thread-safety.
 * 
 * @param fbAdSetId - Facebook ad set ID
 * @param count - Количество добавленных ads
 * @returns Новое значение ads_count
 */
export async function incrementAdsCount(
  fbAdSetId: string,
  count: number
): Promise<number> {
  try {
    logger.info({ 
      fbAdSetId, 
      count 
    }, '🔄 [USE_EXISTING] FINAL STEP: Incrementing ads_count in database...');
    
    const { data, error } = await supabase.rpc('increment_ads_count', {
      p_fb_adset_id: fbAdSetId,
      p_count: count
    });

    if (error) {
      logger.error({ error, fbAdSetId, count }, '❌ [USE_EXISTING] FINAL STEP: Error incrementing ads count');
      throw error;
    }

    logger.info({ 
      fbAdSetId, 
      ads_added: count, 
      new_total_ads_count: data 
    }, '✅ [USE_EXISTING] FINAL STEP: ads_count incremented successfully');
    
    return data;
  } catch (error) {
    logger.error({ error, fbAdSetId, count }, '❌ [USE_EXISTING] FINAL STEP: Error in incrementAdsCount');
    throw error;
  }
}

/**
 * Проверить наличие доступных ad sets для направления
 * 
 * Используется для предварительной проверки перед запуском Auto-Launch
 * или Manual-Launch, чтобы не начинать процесс если нет доступных ad sets.
 * 
 * @param directionId - UUID направления
 * @returns true если есть хотя бы один доступный ad set
 */
export async function hasAvailableAdSets(directionId: string): Promise<boolean> {
  const { count } = await supabase
    .from('direction_adsets')
    .select('*', { count: 'exact', head: true })
    .eq('direction_id', directionId)
    .eq('is_active', true)
    .eq('status', 'PAUSED')
    .lt('ads_count', 50);

  return (count || 0) > 0;
}

