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

// Helper: получить identity info и poster images
// thumbnailUrls: Record<tiktok_video_id, supabase_thumbnail_url> — из user_creatives.thumbnail_url
async function resolveIdentityAndPosters(
  advertiserId: string,
  accessToken: string,
  identityId?: string,
  videoIds?: string[],
  thumbnailUrls?: Record<string, string>
): Promise<{
  identityType: string;
  displayName: string;
  resolvedIdentityId?: string;
  videoPosters: Record<string, string>;
}> {
  let identityType = 'TT_USER';
  let displayName = '';
  let resolvedIdentityId = identityId;

  // Identity info
  if (identityId) {
    try {
      const info = await tt.getIdentityInfo(advertiserId, accessToken, identityId);
      if (info) {
        resolvedIdentityId = info.identity_id;
        identityType = info.identity_type;
        displayName = info.display_name;
      }
    } catch (e: any) {
      logger.warn({ error: e.message }, '[TikTok:resolveIdentity] ⚠️ Не удалось получить identity info');
    }
  }

  // Poster images — приоритет: thumbnail_url из Supabase, fallback на TikTok CDN poster
  const videoPosters: Record<string, string> = {};
  if (videoIds && videoIds.length > 0) {
    // Сначала пробуем загрузить сохранённые thumbnails из Supabase
    const videosWithoutPoster: string[] = [];
    if (thumbnailUrls) {
      for (const videoId of videoIds) {
        const thumbUrl = thumbnailUrls[videoId];
        if (thumbUrl) {
          try {
            const imageResult = await tt.uploadImage(advertiserId, accessToken, thumbUrl);
            videoPosters[videoId] = imageResult.image_id;
            logger.info({ video_id: videoId, image_id: imageResult.image_id, source: 'supabase_thumbnail' }, '[TikTok] ✅ Poster из thumbnail_url загружен');
          } catch (e: any) {
            logger.warn({ video_id: videoId, error: e.message }, '[TikTok] ⚠️ Не удалось загрузить thumbnail_url, попробуем CDN');
            videosWithoutPoster.push(videoId);
          }
        } else {
          videosWithoutPoster.push(videoId);
        }
      }
    } else {
      videosWithoutPoster.push(...videoIds);
    }

    // Fallback: для видео без thumbnail_url — берём poster из TikTok CDN
    if (videosWithoutPoster.length > 0) {
      try {
        const videoInfos = await tt.getVideoInfo(advertiserId, accessToken, videosWithoutPoster);
        for (const vi of videoInfos) {
          if (vi.poster_url && vi.video_id && !videoPosters[vi.video_id]) {
            const imageResult = await tt.uploadImage(advertiserId, accessToken, vi.poster_url);
            videoPosters[vi.video_id] = imageResult.image_id;
            logger.info({ video_id: vi.video_id, image_id: imageResult.image_id, source: 'tiktok_cdn' }, '[TikTok] ✅ Poster из TikTok CDN загружен');
          }
        }
      } catch (e: any) {
        logger.error({ error: e.message }, '[TikTok] ❌ Ошибка загрузки poster images из TikTok CDN');
        throw new Error(`Failed to upload poster images: ${e.message}`);
      }
    }
  }

  return { identityType, displayName, resolvedIdentityId, videoPosters };
}

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

export interface CreateAdGroupWithCreativesParams {
  user_creative_ids: string[];
  direction_id: string;
  daily_budget?: number;
  adgroup_name?: string;
  auto_activate?: boolean;
}

export interface CreateAdGroupWithCreativesContext {
  user_account_id: string;
  ad_account_id?: string;
}

export interface CreateAdGroupWithCreativesResult {
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

function assertTikTokVideoCreatives(creatives: any[]) {
  const invalid = creatives.filter((creative) => {
    const mediaType = creative?.media_type ? String(creative.media_type).toLowerCase() : null;
    const hasVideoId = Boolean(creative?.tiktok_video_id);
    const hasMediaUrl = Boolean(creative?.media_url);

    if (mediaType && mediaType !== 'video') {
      return true;
    }

    if (!hasVideoId && !hasMediaUrl) {
      return true;
    }

    return false;
  });

  if (invalid.length > 0) {
    const invalidIds = invalid.map((creative) => creative.id).join(', ');
    throw new Error(`TikTok supports only video creatives with a video source. Invalid creatives: ${invalidIds}`);
  }
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
    const getTikTokStatus = (entity: { operation_status?: string; status?: string }) =>
      entity?.operation_status || entity?.status;

    // 1. Получить все ads в AdGroup
    const adsResponse = await tt.getAds(advertiserId, accessToken, {
      adgroupIds: [tikTokAdGroupId],
      pageSize: 100
    });

    const ads = adsResponse?.data?.list || adsResponse?.ads || [];
    logger.info({
      tikTokAdGroupId,
      adsCount: ads.length,
      responseKeys: adsResponse?.data ? Object.keys(adsResponse.data) : Object.keys(adsResponse || {})
    }, 'Fetched ads from ad group');

    // 2. Остановить все ENABLE ads
    let pausedCount = 0;
    for (const ad of ads) {
      if (getTikTokStatus(ad) === 'ENABLE') {
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

function toTikTokTimestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().replace('T', ' ').substring(0, 19);
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

  assertTikTokVideoCreatives(creatives);

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
        creative.media_url
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
  // STEP 6: Identity info + poster images
  // ===================================================
  const videoIds = creative_data.map(c => c.tiktok_video_id).filter(Boolean);
  // Собираем thumbnail_url из креативов для приоритетного использования
  const thumbnailUrls: Record<string, string> = {};
  for (const creative of creatives) {
    if (creative.tiktok_video_id && creative.thumbnail_url) {
      thumbnailUrls[creative.tiktok_video_id] = creative.thumbnail_url;
    }
  }
  const { identityType, displayName, resolvedIdentityId, videoPosters } = await resolveIdentityAndPosters(
    advertiserId, accessToken, identityId, videoIds, thumbnailUrls
  );

  logger.info({
    identityType,
    displayName,
    postersCount: Object.keys(videoPosters).length
  }, '[TIKTOK:CreateAdInDirection] Identity and posters resolved');

  // ===================================================
  // STEP 6.5: Активируем AdGroup если нужно
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
    const imageId = videoPosters[creative.tiktok_video_id];
    const adParams = {
      ad_name: creative.ad_name,
      adgroup_id: adgroup.tiktok_adgroup_id,
      ad_format: 'SINGLE_VIDEO' as const,
      video_id: creative.tiktok_video_id,
      ad_text: creative.description || creative.title,
      call_to_action: 'LEARN_MORE',
      operation_status: auto_activate ? 'ENABLE' as const : 'DISABLE' as const,
      ...(imageId && { image_ids: [imageId] }),
      ...(resolvedIdentityId && { identity_id: resolvedIdentityId, identity_type: identityType as any }),
      ...(displayName && { display_name: displayName }),
      ...(directionSettings.page_id && { page_id: directionSettings.page_id })
    };

    logger.info({
      ad_name: creative.ad_name,
      adgroup_id: adgroup.tiktok_adgroup_id,
      video_id: creative.tiktok_video_id,
      has_poster: !!imageId,
      has_page_id: !!directionSettings.page_id,
      identity_type: identityType,
      ad_index: created_ads.length + 1,
      total_ads: creative_data.length
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
        account_id: ad_account_id || undefined,
        adset_id: adgroup.tiktok_adgroup_id,
        campaign_id: undefined,  // Можно получить из AdGroup если нужно
        fb_creative_id: ad.tiktok_video_id,
        source: 'tiktok_direction'
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

/**
 * Workflow: Создать новый TikTok AdGroup + Ads внутри направления
 */
export async function workflowCreateAdGroupWithCreatives(
  params: CreateAdGroupWithCreativesParams,
  context: CreateAdGroupWithCreativesContext
): Promise<CreateAdGroupWithCreativesResult> {
  const {
    user_creative_ids,
    direction_id,
    daily_budget,
    adgroup_name,
    auto_activate = true
  } = params;

  const { user_account_id, ad_account_id } = context;

  logger.info({
    direction_id,
    user_creative_ids,
    daily_budget,
    auto_activate
  }, '[TIKTOK:CreateAdGroupWithCreatives] Starting workflow');

  const creds = await getTikTokCredentials(user_account_id, ad_account_id);
  if (!creds) {
    throw new Error('TikTok credentials not found. Please connect TikTok account first.');
  }

  const { accessToken, advertiserId, identityId } = creds;

  const directionSettings = await getTikTokDirectionSettings(direction_id, user_account_id);
  if (!directionSettings) {
    throw new Error(`Direction ${direction_id} not found or has no TikTok settings`);
  }

  const { data: direction, error: directionError } = await supabase
    .from('account_directions')
    .select('id, name, tiktok_campaign_id, tiktok_objective, tiktok_identity_id, tiktok_instant_page_id')
    .eq('id', direction_id)
    .eq('user_account_id', user_account_id)
    .single();

  if (directionError || !direction) {
    throw new Error(`Direction ${direction_id} not found`);
  }

  if (!direction.tiktok_campaign_id) {
    throw new Error(`Direction ${direction_id} has no TikTok campaign_id`);
  }

  const objective = direction.tiktok_objective || 'traffic';
  const finalBudget = daily_budget || directionSettings.daily_budget || 2500;
  const finalAdGroupName = adgroup_name || `${direction.name || 'Direction'} - AdGroup ${new Date().toISOString().replace('T', ' ').slice(0, 16)}`;

  const { data: creatives, error: creativesError } = await supabase
    .from('user_creatives')
    .select('*')
    .in('id', user_creative_ids)
    .eq('user_id', user_account_id)
    .eq('status', 'ready');

  if (creativesError || !creatives || creatives.length === 0) {
    throw new Error(`Creatives not found or not ready: ${user_creative_ids.join(', ')}`);
  }

  assertTikTokVideoCreatives(creatives);

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
      if (!creative.media_url) {
        throw new Error(`Creative ${creative.id} has no media_url and no tiktok_video_id`);
      }

      logger.info({
        creative_id: creative.id
      }, '[TIKTOK:CreateAdGroupWithCreatives] Uploading video for creative');

      const uploadResult = await tt.uploadVideo(
        advertiserId,
        accessToken,
        creative.media_url
      );

      tiktok_video_id = uploadResult.video_id;

      await supabase
        .from('user_creatives')
        .update({
          tiktok_video_id,
          updated_at: new Date().toISOString()
        })
        .eq('id', creative.id);
    }

    creative_data.push({
      user_creative_id: creative.id,
      tiktok_video_id,
      title: creative.title || `Ad ${i + 1}`,
      ad_name: `${finalAdGroupName} - Ad ${i + 1}`,
      description: creative.description || ''
    });
  }

  const scheduleStartTime = toTikTokTimestamp(new Date());

  // Identity info + poster images
  const videoIdsForPosters = creative_data.map(c => c.tiktok_video_id).filter(Boolean);
  const thumbUrls: Record<string, string> = {};
  for (const creative of creatives) {
    if (creative.tiktok_video_id && creative.thumbnail_url) {
      thumbUrls[creative.tiktok_video_id] = creative.thumbnail_url;
    }
  }
  const { identityType: idType, displayName: dName, resolvedIdentityId: resolvedId, videoPosters: posters } = await resolveIdentityAndPosters(
    advertiserId, accessToken, identityId, videoIdsForPosters, thumbUrls
  );

  logger.info({
    identityType: idType,
    displayName: dName,
    postersCount: Object.keys(posters).length
  }, '[TIKTOK:CreateAdGroupWithCreatives] Identity and posters resolved');

  const adGroupParams = {
    adgroup_name: finalAdGroupName,
    campaign_id: direction.tiktok_campaign_id,
    optimization_goal: directionSettings.objective_config.optimization_goal,
    billing_event: directionSettings.objective_config.billing_event,
    bid_type: 'BID_TYPE_NO_BID' as const,
    budget: finalBudget,
    budget_mode: 'BUDGET_MODE_DAY' as const,
    schedule_type: 'SCHEDULE_FROM_NOW' as const,
    schedule_start_time: scheduleStartTime,
    location_ids: directionSettings.targeting.location_ids,
    age_groups: directionSettings.targeting.age_groups,
    gender: directionSettings.targeting.gender,
    pacing: 'PACING_MODE_SMOOTH' as const,
    placement_type: 'PLACEMENT_TYPE_NORMAL' as const,
    placements: ['PLACEMENT_TIKTOK'],
    promotion_type: directionSettings.objective_config.promotion_type,
    operation_status: auto_activate ? 'ENABLE' as const : 'DISABLE' as const,
    ...(directionSettings.pixel_id && objective === 'conversions' && { pixel_id: directionSettings.pixel_id }),
    ...(resolvedId && { identity_id: resolvedId, identity_type: idType as any })
  };

  logger.info({
    adgroup_name: finalAdGroupName,
    campaign_id: direction.tiktok_campaign_id,
    placement_type: 'PLACEMENT_TYPE_NORMAL',
    promotion_type: directionSettings.objective_config.promotion_type,
    budget: finalBudget
  }, '[TIKTOK:CreateAdGroupWithCreatives] Creating AdGroup');

  const adGroupResult = await tt.createAdGroup(advertiserId, accessToken, adGroupParams);
  const tiktok_adgroup_id = adGroupResult.adgroup_id;
  if (!tiktok_adgroup_id) {
    throw new Error('Failed to create TikTok ad group');
  }

  logger.info({ tiktok_adgroup_id }, '[TIKTOK:CreateAdGroupWithCreatives] ✅ AdGroup создана');

  const created_ads: Array<{
    ad_id: string;
    user_creative_id: string;
    tiktok_video_id: string;
  }> = [];

  for (const creative of creative_data) {
    const imageId = posters[creative.tiktok_video_id];
    const pageId = direction.tiktok_instant_page_id;
    const adParams = {
      ad_name: creative.ad_name,
      adgroup_id: tiktok_adgroup_id,
      ad_format: 'SINGLE_VIDEO' as const,
      video_id: creative.tiktok_video_id,
      ad_text: creative.description || creative.title,
      call_to_action: 'LEARN_MORE',
      operation_status: auto_activate ? 'ENABLE' as const : 'DISABLE' as const,
      ...(imageId && { image_ids: [imageId] }),
      ...(resolvedId && { identity_id: resolvedId, identity_type: idType as any }),
      ...(dName && { display_name: dName }),
      ...(pageId && { page_id: pageId })
    };

    logger.info({
      ad_name: creative.ad_name,
      video_id: creative.tiktok_video_id,
      has_poster: !!imageId,
      has_page_id: !!pageId,
      ad_index: created_ads.length + 1,
      total_ads: creative_data.length
    }, '[TIKTOK:CreateAdGroupWithCreatives] Creating ad');

    const adResult = await tt.createAd(advertiserId, accessToken, adParams);
    const ad_id = adResult.ad_id;
    if (!ad_id) {
      throw new Error(`Failed to create ad for creative ${creative.user_creative_id}`);
    }

    created_ads.push({
      ad_id,
      user_creative_id: creative.user_creative_id,
      tiktok_video_id: creative.tiktok_video_id
    });
  }

  await supabase
    .from('direction_tiktok_adgroups')
    .insert({
      direction_id,
      tiktok_adgroup_id,
      adgroup_name: finalAdGroupName,
      daily_budget: finalBudget,
      status: auto_activate ? 'ENABLE' : 'DISABLE',
      ads_count: created_ads.length,
      last_used_at: auto_activate ? new Date().toISOString() : null,
      is_active: true
    });

  try {
    await saveAdCreativeMappingBatch(
      created_ads.map(ad => ({
        ad_id: ad.ad_id,
        user_creative_id: ad.user_creative_id,
        direction_id: direction_id,
        user_id: user_account_id,
        account_id: ad_account_id || undefined,
        adset_id: tiktok_adgroup_id,
        campaign_id: direction.tiktok_campaign_id,
        fb_creative_id: ad.tiktok_video_id,
        source: 'tiktok_direction'
      }))
    );
  } catch (mappingError) {
    logger.error({ error: mappingError }, '[TIKTOK:CreateAdGroupWithCreatives] Failed to save mapping');
  }

  return {
    success: true,
    adgroup_id: tiktok_adgroup_id,
    tiktok_adgroup_id,
    ads: created_ads,
    ads_count: created_ads.length,
    message: `Created TikTok AdGroup "${finalAdGroupName}" with ${created_ads.length} ad(s)`
  };
}

export default {
  workflowCreateAdInDirection,
  workflowCreateAdGroupWithCreatives,
  getAvailableTikTokAdGroup,
  activateTikTokAdGroup,
  deactivateTikTokAdGroupWithAds,
  incrementTikTokAdsCount,
  hasAvailableTikTokAdGroups
};
