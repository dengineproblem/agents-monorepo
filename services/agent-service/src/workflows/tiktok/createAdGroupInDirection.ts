/**
 * TikTok Workflow: Create Ad in Direction AdGroup
 *
 * Аналог directionAdSets.ts для Facebook
 * Использует pre-created AdGroups в режиме use_existing
 */

import { tt } from '../../adapters/tiktok.js';
import { supabase } from '../../lib/supabase.js';
import {
  getTikTokCredentials,
  getTikTokDirectionSettings
} from '../../lib/tiktokSettings.js';
import { logger } from '../../lib/logger.js';
import { saveAdCreativeMappingBatch } from '../../lib/adCreativeMapping.js';

// ============================================================
// TYPES
// ============================================================

export interface DirectionAdGroupInfo {
  id: string;
  tiktok_adgroup_id: string;
  adgroup_name: string;
  ads_count: number;
  daily_budget?: number;
  status: 'ENABLE' | 'DISABLE';
}

export interface CreateAdInDirectionParams {
  user_creative_ids: string[];
  direction_id: string;
  auto_activate?: boolean;  // По умолчанию true
}

export interface CreateAdInDirectionContext {
  user_account_id: string;
  ad_account_id?: string;  // Для multi-account
}

export interface CreateAdInDirectionResult {
  success: boolean;
  adgroup_id: string;
  tiktok_adgroup_id: string;
  ads: Array<{
    ad_id: string;
    user_creative_id: string;
    tiktok_video_id: string;
  }>;
  ads_count: number;
  message: string;
}

// ============================================================
// DIRECTION ADGROUP HELPERS
// ============================================================

/**
 * Получить доступный DISABLED AdGroup для направления (аналог getAvailableAdSet)
 */
export async function getAvailableTikTokAdGroup(
  directionId: string
): Promise<DirectionAdGroupInfo | null> {
  logger.info({ directionId }, '🔍 [TIKTOK:USE_EXISTING] Searching for available DISABLED ad group...');

  const { data: adgroups, error } = await supabase
    .from('direction_tiktok_adgroups')
    .select('id, tiktok_adgroup_id, adgroup_name, ads_count, daily_budget, status')
    .eq('direction_id', directionId)
    .eq('is_active', true)
    .eq('status', 'DISABLE')
    .lt('ads_count', 50)
    .order('ads_count', { ascending: true })
    .order('linked_at', { ascending: true })
    .limit(10);

  if (error) {
    logger.error({ error, directionId }, '❌ [TIKTOK:USE_EXISTING] Error fetching available ad group from DB');
    return null;
  }

  if (!adgroups || adgroups.length === 0) {
    logger.warn({
      directionId,
      searched_filters: {
        is_active: true,
        status: 'DISABLE',
        ads_count_lt: 50
      }
    }, '⚠️ [TIKTOK:USE_EXISTING] No available ad groups found');
    return null;
  }

  logger.info({
    directionId,
    found_count: adgroups.length,
    selected_adgroup: {
      id: adgroups[0].id,
      tiktok_adgroup_id: adgroups[0].tiktok_adgroup_id,
      name: adgroups[0].adgroup_name,
      current_ads_count: adgroups[0].ads_count
    }
  }, '✅ [TIKTOK:USE_EXISTING] Found available ad group');

  return adgroups[0] as DirectionAdGroupInfo;
}

/**
 * Активировать AdGroup в TikTok (DISABLE -> ENABLE)
 */
export async function activateTikTokAdGroup(
  adgroupId: string,
  tikTokAdGroupId: string,
  advertiserId: string,
  accessToken: string
): Promise<void> {
  try {
    logger.info({
      adgroupId,
      tikTokAdGroupId
    }, '🔄 [TIKTOK:USE_EXISTING] Activating ad group...');

    // 1. Активировать в TikTok
    await tt.resumeAdGroup(advertiserId, accessToken, tikTokAdGroupId);

    logger.info({ tikTokAdGroupId }, '✅ [TIKTOK:USE_EXISTING] Ad group activated in TikTok');

    // 2. Обновить в БД
    const { error } = await supabase
      .from('direction_tiktok_adgroups')
      .update({
        status: 'ENABLE',
        last_used_at: new Date().toISOString()
      })
      .eq('id', adgroupId);

    if (error) {
      logger.error({ error, adgroupId }, '❌ [TIKTOK:USE_EXISTING] Error updating ad group status in DB');
      throw error;
    }

    logger.info({
      adgroupId,
      tikTokAdGroupId,
      new_status: 'ENABLE'
    }, '✅ [TIKTOK:USE_EXISTING] Ad group activation complete');
  } catch (error) {
    logger.error({ error, adgroupId, tikTokAdGroupId }, '❌ [TIKTOK:USE_EXISTING] Error activating ad group');
    throw error;
  }
}

/**
 * Деактивировать AdGroup + все ads (ENABLE -> DISABLE)
 */
export async function deactivateTikTokAdGroupWithAds(
  tikTokAdGroupId: string,
  advertiserId: string,
  accessToken: string
): Promise<void> {
  try {
    // 1. Получить все ads в AdGroup
    const adsResponse = await tt.getAds(advertiserId, accessToken, {
      adgroup_ids: [tikTokAdGroupId],
      page_size: 100
    });

    const ads = adsResponse.ads || [];
    logger.info({ tikTokAdGroupId, adsCount: ads.length }, 'Fetched ads from ad group');

    // 2. Остановить все ENABLE ads
    let pausedCount = 0;
    for (const ad of ads) {
      if (ad.status === 'ENABLE') {
        await tt.pauseAd(advertiserId, accessToken, ad.ad_id);
        pausedCount++;
      }
    }

    logger.info({ tikTokAdGroupId, pausedCount }, 'Paused active ads in ad group');

    // 3. Остановить сам AdGroup
    await tt.pauseAdGroup(advertiserId, accessToken, tikTokAdGroupId);

    logger.info({ tikTokAdGroupId }, 'Paused ad group in TikTok');

    // 4. Обновить в БД
    const { error } = await supabase
      .from('direction_tiktok_adgroups')
      .update({ status: 'DISABLE' })
      .eq('tiktok_adgroup_id', tikTokAdGroupId);

    if (error) {
      logger.error({ error, tikTokAdGroupId }, 'Error updating ad group status in DB after pause');
      throw error;
    }

    logger.info({
      tikTokAdGroupId,
      totalAds: ads.length,
      pausedAds: pausedCount
    }, 'Ad group and all its ads deactivated successfully');
  } catch (error) {
    logger.error({ error, tikTokAdGroupId }, 'Error deactivating ad group with ads');
    throw error;
  }
}

/**
 * Инкрементировать счетчик ads
 */
export async function incrementTikTokAdsCount(
  tikTokAdGroupId: string,
  count: number
): Promise<number> {
  try {
    logger.info({
      tikTokAdGroupId,
      count
    }, '🔄 [TIKTOK:USE_EXISTING] Incrementing ads_count...');

    // Используем RPC если есть, иначе обычный update
    const { data: existing } = await supabase
      .from('direction_tiktok_adgroups')
      .select('ads_count')
      .eq('tiktok_adgroup_id', tikTokAdGroupId)
      .single();

    const newCount = (existing?.ads_count || 0) + count;

    const { error } = await supabase
      .from('direction_tiktok_adgroups')
      .update({ ads_count: newCount })
      .eq('tiktok_adgroup_id', tikTokAdGroupId);

    if (error) {
      logger.error({ error, tikTokAdGroupId, count }, '❌ [TIKTOK:USE_EXISTING] Error incrementing ads count');
      throw error;
    }

    logger.info({
      tikTokAdGroupId,
      ads_added: count,
      new_total_ads_count: newCount
    }, '✅ [TIKTOK:USE_EXISTING] ads_count incremented successfully');

    return newCount;
  } catch (error) {
    logger.error({ error, tikTokAdGroupId, count }, '❌ [TIKTOK:USE_EXISTING] Error in incrementTikTokAdsCount');
    throw error;
  }
}

/**
 * Проверить наличие доступных AdGroups для направления
 */
export async function hasAvailableTikTokAdGroups(directionId: string): Promise<boolean> {
  const { count } = await supabase
    .from('direction_tiktok_adgroups')
    .select('*', { count: 'exact', head: true })
    .eq('direction_id', directionId)
    .eq('is_active', true)
    .eq('status', 'DISABLE')
    .lt('ads_count', 50);

  return (count || 0) > 0;
}

// ============================================================
// MAIN WORKFLOW
// ============================================================

/**
 * Workflow: Добавить ads в существующий AdGroup направления
 */
export async function workflowCreateAdInDirection(
  params: CreateAdInDirectionParams,
  context: CreateAdInDirectionContext
): Promise<CreateAdInDirectionResult> {
  const {
    user_creative_ids,
    direction_id,
    auto_activate = true
  } = params;

  const { user_account_id, ad_account_id } = context;

  logger.info({
    direction_id,
    user_creative_ids,
    auto_activate
  }, '[TIKTOK:CreateAdInDirection] Starting workflow');

  // ===================================================
  // STEP 1: Получаем credentials
  // ===================================================
  const creds = await getTikTokCredentials(user_account_id, ad_account_id);
  if (!creds) {
    throw new Error('TikTok credentials not found. Please connect TikTok account first.');
  }

  const { accessToken, advertiserId, identityId } = creds;

  // ===================================================
  // STEP 2: Получаем настройки направления
  // ===================================================
  const directionSettings = await getTikTokDirectionSettings(direction_id, user_account_id);
  if (!directionSettings) {
    throw new Error(`Direction ${direction_id} not found or has no TikTok settings`);
  }

  // ===================================================
  // STEP 3: Получаем доступный AdGroup
  // ===================================================
  const adgroup = await getAvailableTikTokAdGroup(direction_id);
  if (!adgroup) {
    throw new Error(`No available DISABLED ad groups for direction ${direction_id}. Create new ad groups first.`);
  }

  logger.info({
    adgroup_id: adgroup.id,
    tiktok_adgroup_id: adgroup.tiktok_adgroup_id,
    current_ads_count: adgroup.ads_count
  }, '[TIKTOK:CreateAdInDirection] Found available ad group');

  // ===================================================
  // STEP 4: Получаем креативы из Supabase
  // ===================================================
  const { data: creatives, error: creativesError } = await supabase
    .from('user_creatives')
    .select('*')
    .in('id', user_creative_ids)
    .eq('user_id', user_account_id)
    .eq('status', 'ready');

  if (creativesError || !creatives || creatives.length === 0) {
    throw new Error(`Creatives not found or not ready: ${user_creative_ids.join(', ')}`);
  }

  // ===================================================
  // STEP 5: Подготовка данных креативов (загрузка видео если нужно)
  // ===================================================
  const creative_data: Array<{
    user_creative_id: string;
    tiktok_video_id: string;
    title: string;
    ad_name: string;
    description: string;
  }> = [];

  for (let i = 0; i < creatives.length; i++) {
    const creative = creatives[i];
    let tiktok_video_id = creative.tiktok_video_id;

    if (!tiktok_video_id) {
      // Загружаем видео
      if (!creative.media_url) {
        throw new Error(`Creative ${creative.id} has no media_url and no tiktok_video_id`);
      }

      logger.info({
        creative_id: creative.id
      }, '[TIKTOK:CreateAdInDirection] Uploading video for creative');

      const uploadResult = await tt.uploadVideo(
        advertiserId,
        accessToken,
        creative.media_url,
        creative.title || 'Creative'
      );

      tiktok_video_id = uploadResult.video_id;

      // Сохраняем video_id
      await supabase
        .from('user_creatives')
        .update({
          tiktok_video_id,
          updated_at: new Date().toISOString()
        })
        .eq('id', creative.id);

      logger.info({
        creative_id: creative.id,
        tiktok_video_id
      }, '[TIKTOK:CreateAdInDirection] Video uploaded');
    }

    creative_data.push({
      user_creative_id: creative.id,
      tiktok_video_id,
      title: creative.title || `Ad ${i + 1}`,
      ad_name: `${adgroup.adgroup_name} - Ad ${adgroup.ads_count + i + 1}`,
      description: creative.description || ''
    });
  }

  // ===================================================
  // STEP 6: Активируем AdGroup если нужно
  // ===================================================
  if (auto_activate && adgroup.status === 'DISABLE') {
    await activateTikTokAdGroup(
      adgroup.id,
      adgroup.tiktok_adgroup_id,
      advertiserId,
      accessToken
    );
  }

  // ===================================================
  // STEP 7: Создаем Ads
  // ===================================================
  const created_ads: Array<{
    ad_id: string;
    user_creative_id: string;
    tiktok_video_id: string;
  }> = [];

  for (const creative of creative_data) {
    const adParams = {
      ad_name: creative.ad_name,
      adgroup_id: adgroup.tiktok_adgroup_id,
      ad_format: 'SINGLE_VIDEO' as const,
      video_id: creative.tiktok_video_id,
      ad_text: creative.description || creative.title,
      call_to_action: 'LEARN_MORE' as const,
      status: auto_activate ? 'ENABLE' as const : 'DISABLE' as const,
      ...(identityId && { identity_id: identityId, identity_type: 'TT_USER' as const })
    };

    logger.info({
      ad_name: creative.ad_name,
      adgroup_id: adgroup.tiktok_adgroup_id,
      video_id: creative.tiktok_video_id
    }, '[TIKTOK:CreateAdInDirection] Creating ad');

    const adResult = await tt.createAd(advertiserId, accessToken, adParams);

    const ad_id = adResult.ad_id;
    if (!ad_id) {
      throw new Error(`Failed to create ad for creative ${creative.user_creative_id}`);
    }

    logger.info({
      ad_id,
      creative_id: creative.user_creative_id
    }, '[TIKTOK:CreateAdInDirection] Ad created');

    created_ads.push({
      ad_id,
      user_creative_id: creative.user_creative_id,
      tiktok_video_id: creative.tiktok_video_id
    });
  }

  // ===================================================
  // STEP 8: Обновляем счетчик ads
  // ===================================================
  await incrementTikTokAdsCount(adgroup.tiktok_adgroup_id, created_ads.length);

  // ===================================================
  // STEP 9: Сохраняем маппинг
  // ===================================================
  try {
    await saveAdCreativeMappingBatch(
      created_ads.map(ad => ({
        ad_id: ad.ad_id,
        user_creative_id: ad.user_creative_id,
        direction_id: direction_id,
        user_id: user_account_id,
        account_id: ad_account_id || null,
        adset_id: adgroup.tiktok_adgroup_id,
        campaign_id: null,  // Можно получить из AdGroup если нужно
        fb_creative_id: ad.tiktok_video_id,
        source: 'tiktok_direction' as const
      }))
    );
  } catch (mappingError) {
    logger.error({ error: mappingError }, '[TIKTOK:CreateAdInDirection] Failed to save mapping');
  }

  // ===================================================
  // RETURN
  // ===================================================
  return {
    success: true,
    adgroup_id: adgroup.id,
    tiktok_adgroup_id: adgroup.tiktok_adgroup_id,
    ads: created_ads,
    ads_count: created_ads.length,
    message: `Added ${created_ads.length} ad(s) to TikTok AdGroup "${adgroup.adgroup_name}" (status: ${auto_activate ? 'ENABLE' : 'DISABLE'})`
  };
}

export default {
  workflowCreateAdInDirection,
  getAvailableTikTokAdGroup,
  activateTikTokAdGroup,
  deactivateTikTokAdGroupWithAds,
  incrementTikTokAdsCount,
  hasAvailableTikTokAdGroups
};
