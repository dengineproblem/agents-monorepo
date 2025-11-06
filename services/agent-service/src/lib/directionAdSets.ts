/**
 * Direction Ad Sets Helper Functions
 * 
 * Функции для работы с pre-created ad sets в режиме use_existing.
 * Используются во всех workflows (AgentBrain, Auto-Launch, Manual-Launch)
 * для выбора, активации и управления заранее созданными ad sets.
 */

import { supabase } from './supabase.js';
import { graph } from '../adapters/facebook.js';
import log from './logger.js';

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
  const { data: adsets, error } = await supabase
    .from('direction_adsets')
    .select('id, fb_adset_id, adset_name, ads_count, daily_budget_cents, status')
    .eq('direction_id', directionId)
    .eq('is_active', true)
    .eq('status', 'PAUSED')
    .lt('ads_count', 50)
    .order('ads_count', { ascending: true })
    .order('linked_at', { ascending: true })
    .limit(1);

  if (error) {
    log.error({ error, directionId }, 'Error fetching available ad set');
    return null;
  }

  if (!adsets || adsets.length === 0) {
    log.warn({ directionId }, 'No available ad sets found');
    return null;
  }

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
    // 1. Активировать в Facebook
    await graph('POST', `${fbAdSetId}`, accessToken, { status: 'ACTIVE' });

    log.info({ fbAdSetId }, 'Activated ad set in Facebook');

    // 2. Обновить в БД
    const { error } = await supabase
      .from('direction_adsets')
      .update({
        status: 'ACTIVE',
        last_used_at: new Date().toISOString()
      })
      .eq('id', adsetId);

    if (error) {
      log.error({ error, adsetId }, 'Error updating ad set status in DB');
      throw error;
    }

    log.info({ adsetId, fbAdSetId }, 'Ad set activated successfully');
  } catch (error) {
    log.error({ error, adsetId, fbAdSetId }, 'Error activating ad set');
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

    log.info({ fbAdSetId, adsCount: ads.length }, 'Fetched ads from ad set');

    // 2. Остановить все ACTIVE ads
    let pausedCount = 0;
    for (const ad of ads) {
      if (ad.status === 'ACTIVE') {
        await graph('POST', `${ad.id}`, accessToken, { status: 'PAUSED' });
        pausedCount++;
      }
    }

    log.info({ fbAdSetId, pausedCount }, 'Paused active ads in ad set');

    // 3. Остановить сам ad set
    await graph('POST', `${fbAdSetId}`, accessToken, { status: 'PAUSED' });

    log.info({ fbAdSetId }, 'Paused ad set in Facebook');

    // 4. Обновить в БД
    const { error } = await supabase
      .from('direction_adsets')
      .update({ status: 'PAUSED' })
      .eq('fb_adset_id', fbAdSetId);

    if (error) {
      log.error({ error, fbAdSetId }, 'Error updating ad set status in DB after pause');
      throw error;
    }

    log.info({ fbAdSetId, totalAds: ads.length, pausedAds: pausedCount }, 
      'Ad set and all its ads deactivated successfully');
  } catch (error) {
    log.error({ error, fbAdSetId }, 'Error deactivating ad set with ads');
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
    const { data, error } = await supabase.rpc('increment_ads_count', {
      p_fb_adset_id: fbAdSetId,
      p_count: count
    });

    if (error) {
      log.error({ error, fbAdSetId, count }, 'Error incrementing ads count');
      throw error;
    }

    log.info({ fbAdSetId, count, newCount: data }, 'Incremented ads count');
    return data;
  } catch (error) {
    log.error({ error, fbAdSetId, count }, 'Error in incrementAdsCount');
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

