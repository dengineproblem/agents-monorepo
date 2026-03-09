/**
 * TikTok Workflow: Create Campaign with Creative
 *
 * Аналог createCampaignWithCreative.ts для Facebook
 * Создаёт полную структуру: Campaign → AdGroup → Ad
 */

import { tt } from '../../adapters/tiktok.js';
import { supabase } from '../../lib/supabase.js';
import {
  convertToTikTokTargeting,
  getTikTokObjectiveConfig,
  getTikTokCredentials,
  type TikTokTargeting
} from '../../lib/tiktokSettings.js';
import { resolveTikTokError } from '../../lib/tiktokErrors.js';
import { saveAdCreativeMappingBatch } from '../../lib/adCreativeMapping.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger({ module: 'tiktokCampaignWorkflow' });

// ============================================================
// TYPES
// ============================================================

export type TikTokObjectiveType = 'traffic' | 'conversions' | 'reach' | 'video_views' | 'lead_generation' | 'whatsapp';

export interface CreateTikTokCampaignParams {
  user_creative_ids: string[];  // Массив креативов
  objective: TikTokObjectiveType;
  campaign_name: string;
  adgroup_name?: string;
  daily_budget: number;  // В валюте аккаунта TikTok (например, KZT)
  targeting?: TikTokTargeting;  // Если указан - переопределяет дефолтные
  use_default_settings?: boolean;  // По умолчанию true
  auto_activate?: boolean;  // Если true - сразу активирует (по умолчанию true)
  schedule_start_time?: string;  // ISO datetime
  schedule_end_time?: string;  // ISO datetime
  page_id?: string;  // TikTok Instant Page ID for Lead Generation
  landing_page_url?: string;  // URL для Traffic/WhatsApp (wa.me)
}

export interface CreateTikTokCampaignContext {
  user_account_id: string;
  ad_account_id?: string;  // Для multi-account mode
  advertiser_id?: string;  // Можно передать напрямую
  access_token?: string;   // Можно передать напрямую
  identity_id?: string;    // TT_USER identity
  pixel_id?: string;       // Для conversion tracking
}

export interface CreateTikTokCampaignResult {
  success: boolean;
  campaign_id: string;
  adgroup_id: string;
  ads: Array<{
    ad_id: string;
    user_creative_id: string;
    tiktok_video_id: string;
  }>;
  ads_count: number;
  objective: TikTokObjectiveType;
  message: string;
}

// ============================================================
// HELPERS
// ============================================================

function withStep(step: string, payload: Record<string, any>, fn: () => Promise<any>) {
  return fn().catch((e: any) => {
    e.step = step;
    e.payload = payload;
    throw e;
  });
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

/**
 * Получить дефолтный targeting для Казахстана
 */
function getDefaultTikTokTargeting(): TikTokTargeting {
  return {
    location_ids: ['1522867'],  // Казахстан (TikTok location_id)
    age_groups: ['AGE_18_24', 'AGE_25_34', 'AGE_35_44', 'AGE_45_54', 'AGE_55_100'],
    gender: 'GENDER_UNLIMITED'
  };
}

/**
 * Конвертировать дату в формат TikTok (UTC timestamp)
 */
function toTikTokTimestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

// ============================================================
// MAIN WORKFLOW
// ============================================================

export async function workflowCreateTikTokCampaignWithCreative(
  params: CreateTikTokCampaignParams,
  context: CreateTikTokCampaignContext
): Promise<CreateTikTokCampaignResult> {
  const {
    user_creative_ids,
    objective,
    campaign_name,
    adgroup_name,
    daily_budget,
    targeting,
    use_default_settings = true,
    auto_activate = true,
    schedule_start_time,
    schedule_end_time,
    page_id,
    landing_page_url
  } = params;

  const { user_account_id, ad_account_id } = context;
  const workflowStartTime = Date.now();

  log.info({
    user_creative_ids_count: user_creative_ids.length,
    user_creative_ids,
    objective,
    campaign_name,
    daily_budget,
    use_default_settings,
    auto_activate,
    user_account_id
  }, '[TikTok:Workflow:CreateCampaign] 🚀 Начало workflow');

  // ===================================================
  // STEP 0: Получаем credentials
  // ===================================================
  let accessToken = context.access_token;
  let advertiserId = context.advertiser_id;
  let identityId = context.identity_id;

  if (!accessToken || !advertiserId) {
    const creds = await getTikTokCredentials(user_account_id, ad_account_id);
    if (!creds) {
      throw new Error('TikTok credentials not found. Please connect TikTok account first.');
    }
    accessToken = creds.accessToken;
    advertiserId = creds.advertiserId;
    identityId = identityId || creds.identityId;
  }

  // Получаем identity info (display_name, identity_type)
  let identityType: string = 'TT_USER';
  let displayName: string = '';
  let identityAuthorizedBcId: string | undefined;

  if (identityId) {
    try {
      const identityInfo = await tt.getIdentityInfo(advertiserId!, accessToken!, identityId);
      if (identityInfo) {
        identityId = identityInfo.identity_id;
        identityType = identityInfo.identity_type;
        displayName = identityInfo.display_name;
        identityAuthorizedBcId = identityInfo.identity_authorized_bc_id;
      }
    } catch (e: any) {
      log.warn({ error: e.message }, '[TikTok:Workflow:CreateCampaign] ⚠️ Не удалось получить identity info');
    }
  }

  log.info({
    advertiserId,
    hasIdentity: !!identityId,
    identityType,
    displayName,
    step: 'credentials_loaded'
  }, '[TikTok:Workflow:CreateCampaign] ✅ Credentials загружены');

  // ===================================================
  // STEP 0.5: Валидация page_id для Lead Generation
  // ===================================================
  if (objective === 'lead_generation') {
    if (!page_id) {
      throw new Error('page_id (Instant Page ID) is required for lead_generation objective');
    }

    // Проверяем, что page_id принадлежит этому advertiser
    log.info({
      page_id,
      advertiserId,
      step: 'validating_page_id'
    }, '[TikTok:Workflow:CreateCampaign] 🔍 Проверка доступа к Instant Page');

    const pageInfo = await tt.getInstantPage(advertiserId!, page_id, accessToken!);

    if (!pageInfo) {
      throw new Error(`Instant Page ${page_id} not found or not accessible for this advertiser`);
    }

    log.info({
      page_id,
      page_name: pageInfo.page_name,
      page_type: pageInfo.page_type,
      status: pageInfo.status,
      step: 'page_id_validated'
    }, '[TikTok:Workflow:CreateCampaign] ✅ Instant Page подтверждена');
  }

  // ===================================================
  // STEP 1: Получаем ВСЕ креативы из Supabase
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

  if (creatives.length !== user_creative_ids.length) {
    log.warn({
      requested: user_creative_ids.length,
      found: creatives.length,
      missing: user_creative_ids.filter(id => !creatives.some(c => c.id === id))
    }, '[TikTok:Workflow:CreateCampaign] ⚠️ Некоторые креативы не найдены');
  }

  log.info({
    count: creatives.length,
    ids: creatives.map(c => c.id),
    titles: creatives.map(c => c.title),
    step: 'creatives_loaded'
  }, '[TikTok:Workflow:CreateCampaign] ✅ Креативы загружены');

  // ===================================================
  // STEP 2: Подготовка данных креативов
  // ===================================================
  // TikTok требует video_id для рекламы
  // Проверяем, есть ли уже загруженные video_id, иначе нужно загрузить
  const creative_data: Array<{
    user_creative_id: string;
    tiktok_video_id: string;
    title: string;
    ad_name: string;
    description: string;
    video_url?: string;
  }> = [];

  for (let i = 0; i < creatives.length; i++) {
    const creative = creatives[i];

    // Проверяем наличие tiktok_video_id
    let tiktok_video_id = creative.tiktok_video_id;

    if (!tiktok_video_id) {
      // Нужно загрузить видео в TikTok
      if (!creative.media_url) {
        throw new Error(`Creative ${creative.id} has no media_url and no tiktok_video_id`);
      }

      log.info({
        creative_id: creative.id,
        media_url: creative.media_url.substring(0, 80),
        creative_index: i + 1,
        total_creatives: creatives.length
      }, '[TikTok:Workflow:CreateCampaign] 📤 Загрузка видео для креатива');

      // Загружаем видео по URL
      const uploadResult = await withStep(
        'upload_video',
        { creative_id: creative.id },
        () => tt.uploadVideo(advertiserId!, accessToken!, creative.media_url)
      );

      tiktok_video_id = uploadResult.video_id;

      // Сохраняем video_id в креативе
      await supabase
        .from('user_creatives')
        .update({
          tiktok_video_id,
          updated_at: new Date().toISOString()
        })
        .eq('id', creative.id);

      log.info({
        creative_id: creative.id,
        tiktok_video_id,
        step: 'video_uploaded'
      }, '[TikTok:Workflow:CreateCampaign] ✅ Видео загружено');
    }

    creative_data.push({
      user_creative_id: creative.id,
      tiktok_video_id,
      title: creative.title || `Ad ${i + 1}`,
      ad_name: `${campaign_name} - Ad ${i + 1}`,
      description: creative.description || '',
      video_url: creative.media_url
    });
  }

  log.info({
    count: creative_data.length,
    creatives: creative_data.map(c => ({ id: c.user_creative_id, video_id: c.tiktok_video_id })),
    step: 'creatives_prepared'
  }, '[TikTok:Workflow:CreateCampaign] ✅ Данные креативов подготовлены');

  // ===================================================
  // STEP 3: Получаем objective config
  // ===================================================
  const objectiveConfig = getTikTokObjectiveConfig(objective);

  log.info({
    objective,
    objective_type: objectiveConfig.objective_type,
    optimization_goal: objectiveConfig.optimization_goal,
    billing_event: objectiveConfig.billing_event
  }, '[TikTok:Workflow:CreateCampaign] 📋 Objective config');

  // ===================================================
  // STEP 4: Создаем Campaign
  // ===================================================
  const campaignResult = await withStep(
    'create_campaign',
    { name: campaign_name, objective: objectiveConfig.objective_type },
    () => tt.createCampaign(advertiserId!, accessToken!, {
      campaign_name,
      objective_type: objectiveConfig.objective_type,
      budget: daily_budget,  // TikTok принимает в валюте аккаунта
      budget_mode: 'BUDGET_MODE_DAY',
      operation_status: auto_activate ? 'ENABLE' : 'DISABLE'
    })
  );

  const campaign_id = campaignResult.campaign_id;
  if (!campaign_id) {
    throw Object.assign(new Error('create_campaign_failed'), { step: 'create_campaign_no_id' });
  }

  log.info({
    campaign_id,
    campaign_name,
    step: 'campaign_created'
  }, '[TikTok:Workflow:CreateCampaign] ✅ Кампания создана');

  // ===================================================
  // STEP 5: Определяем targeting
  // ===================================================
  let finalTargeting: TikTokTargeting;
  let targetingSource: string;

  if (targeting) {
    finalTargeting = targeting;
    targetingSource = 'provided';
    log.info({ source: 'provided' }, '[TikTok:Workflow:CreateCampaign] 🎯 Используем предоставленный targeting');
  } else if (use_default_settings) {
    // Попробуем загрузить настройки пользователя
    const { data: userSettings } = await supabase
      .from('default_ad_settings')
      .select('*')
      .eq('user_account_id', user_account_id)
      .maybeSingle();

    if (userSettings) {
      finalTargeting = convertToTikTokTargeting(userSettings);
      targetingSource = 'user_settings';
      log.info({ source: 'user_settings' }, '[TikTok:Workflow:CreateCampaign] 🎯 Используем настройки пользователя');
    } else {
      finalTargeting = getDefaultTikTokTargeting();
      targetingSource = 'fallback';
      log.info({ source: 'fallback' }, '[TikTok:Workflow:CreateCampaign] 🎯 Используем дефолтный targeting (KZ)');
    }
  } else {
    finalTargeting = getDefaultTikTokTargeting();
    targetingSource = 'default';
  }

  // ===================================================
  // STEP 6: Создаем AdGroup
  // ===================================================
  const finalAdGroupName = adgroup_name || `${campaign_name} - AdGroup 1`;

  // Рассчитываем schedule
  const scheduleStartTime = schedule_start_time
    ? toTikTokTimestamp(schedule_start_time)
    : toTikTokTimestamp(new Date());  // Сейчас

  const scheduleEndTime = schedule_end_time
    ? toTikTokTimestamp(schedule_end_time)
    : undefined;  // Бессрочно

  const adGroupParams = {
    adgroup_name: finalAdGroupName,
    campaign_id,
    optimization_goal: objectiveConfig.optimization_goal,
    billing_event: objectiveConfig.billing_event,
    bid_type: 'BID_TYPE_NO_BID' as const,  // Автоматическая ставка
    budget: daily_budget,
    budget_mode: 'BUDGET_MODE_DAY' as const,
    schedule_type: scheduleEndTime ? 'SCHEDULE_START_END' as const : 'SCHEDULE_FROM_NOW' as const,
    schedule_start_time: scheduleStartTime,
    schedule_end_time: scheduleEndTime,
    location_ids: finalTargeting.location_ids,
    age_groups: finalTargeting.age_groups,
    gender: finalTargeting.gender,
    pacing: 'PACING_MODE_SMOOTH' as const,
    placement_type: 'PLACEMENT_TYPE_NORMAL' as const,
    placements: ['PLACEMENT_TIKTOK'],
    promotion_type: objectiveConfig.promotion_type,
    operation_status: auto_activate ? 'ENABLE' as const : 'DISABLE' as const,
    // Pixel для конверсий
    ...(context.pixel_id && objective === 'conversions' && { pixel_id: context.pixel_id }),
    // Identity для креативов
    ...(identityId && { identity_id: identityId, identity_type: identityType as any }),
    ...(identityAuthorizedBcId && { identity_authorized_bc_id: identityAuthorizedBcId })
  };

  log.info({
    name: finalAdGroupName,
    campaign_id,
    optimization_goal: objectiveConfig.optimization_goal,
    location_ids: finalTargeting.location_ids,
    age_groups: finalTargeting.age_groups,
    gender: finalTargeting.gender,
    targeting_source: targetingSource,
    budget: daily_budget
  }, '[TikTok:Workflow:CreateCampaign] 📦 Создание AdGroup');

  const adGroupResult = await withStep(
    'create_adgroup',
    { params: adGroupParams },
    () => tt.createAdGroup(advertiserId!, accessToken!, adGroupParams)
  );

  const adgroup_id = adGroupResult.adgroup_id;
  if (!adgroup_id) {
    throw Object.assign(new Error('create_adgroup_failed'), { step: 'create_adgroup_no_id' });
  }

  log.info({
    adgroup_id,
    adgroup_name: finalAdGroupName,
    campaign_id,
    step: 'adgroup_created'
  }, '[TikTok:Workflow:CreateCampaign] ✅ AdGroup создана');

  // ===================================================
  // STEP 7: Получаем poster images для видео
  // Приоритет: thumbnail_url из Supabase (сгенерирован FFmpeg при загрузке),
  // fallback на poster из TikTok CDN
  // ===================================================
  const videoIds = creative_data.map(c => c.tiktok_video_id).filter(Boolean);
  let videoPosters: Record<string, string> = {};

  if (videoIds.length > 0) {
    log.info({ videoIds, count: videoIds.length }, '[TikTok:Workflow:CreateCampaign] 🖼️ Загрузка poster images для видео');

    // Собираем thumbnail_url из креативов
    const thumbUrls: Record<string, string> = {};
    for (const creative of creatives) {
      if (creative.tiktok_video_id && creative.thumbnail_url) {
        thumbUrls[creative.tiktok_video_id] = creative.thumbnail_url;
      }
    }

    // Сначала пробуем загрузить сохранённые thumbnails
    const videosNeedCdnPoster: string[] = [];
    for (const videoId of videoIds) {
      const thumbUrl = thumbUrls[videoId];
      if (thumbUrl) {
        try {
          const imageResult = await tt.uploadImage(advertiserId!, accessToken!, thumbUrl);
          videoPosters[videoId] = imageResult.image_id;
          log.info({
            video_id: videoId,
            image_id: imageResult.image_id,
            source: 'supabase_thumbnail',
            step: 'poster_uploaded'
          }, '[TikTok:Workflow:CreateCampaign] ✅ Poster из thumbnail_url загружен');
        } catch (e: any) {
          log.warn({ video_id: videoId, error: e.message }, '[TikTok:Workflow:CreateCampaign] ⚠️ thumbnail_url не удался, fallback на CDN');
          videosNeedCdnPoster.push(videoId);
        }
      } else {
        videosNeedCdnPoster.push(videoId);
      }
    }

    // Fallback: для видео без thumbnail_url — берём poster из TikTok CDN
    if (videosNeedCdnPoster.length > 0) {
      const videoInfos = await withStep(
        'get_video_info',
        { videoIds: videosNeedCdnPoster },
        () => tt.getVideoInfo(advertiserId!, accessToken!, videosNeedCdnPoster)
      );

      for (const info of videoInfos) {
        if (info.poster_url && info.video_id && !videoPosters[info.video_id]) {
          try {
            const imageResult = await tt.uploadImage(advertiserId!, accessToken!, info.poster_url);
            videoPosters[info.video_id] = imageResult.image_id;
            log.info({
              video_id: info.video_id,
              image_id: imageResult.image_id,
              source: 'tiktok_cdn',
              step: 'poster_uploaded'
            }, '[TikTok:Workflow:CreateCampaign] ✅ Poster из TikTok CDN загружен');
          } catch (e: any) {
            log.error({
              video_id: info.video_id,
              poster_url: info.poster_url.substring(0, 80),
              error: e.message
            }, '[TikTok:Workflow:CreateCampaign] ❌ Ошибка загрузки poster image');
            throw new Error(`Failed to upload poster image for video ${info.video_id}: ${e.message}`);
          }
        } else if (info.video_id && !videoPosters[info.video_id]) {
          log.warn({
            video_id: info.video_id,
            has_poster: !!info.poster_url
          }, '[TikTok:Workflow:CreateCampaign] ⚠️ Видео без poster URL');
        }
      }
    }

    log.info({
      total_videos: videoIds.length,
      posters_uploaded: Object.keys(videoPosters).length,
      step: 'posters_complete'
    }, '[TikTok:Workflow:CreateCampaign] ✅ Poster images готовы');
  }

  // ===================================================
  // STEP 8: Создаем Ads
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
      adgroup_id,
      ad_format: 'SINGLE_VIDEO' as const,
      video_id: creative.tiktok_video_id,
      ad_text: creative.description || creative.title,
      call_to_action: objective === 'lead_generation' ? 'SIGN_UP' : objective === 'whatsapp' ? 'CONTACT_US' : 'LEARN_MORE',
      operation_status: auto_activate ? 'ENABLE' as const : 'DISABLE' as const,
      // Thumbnail/cover image
      ...(imageId && { image_ids: [imageId] }),
      // Identity
      ...(identityId && { identity_id: identityId, identity_type: identityType as any }),
      ...(identityAuthorizedBcId && { identity_authorized_bc_id: identityAuthorizedBcId }),
      // Display name from identity
      ...(displayName && { display_name: displayName }),
      // Lead Generation: Instant Page
      ...(objective === 'lead_generation' && page_id && { page_id }),
      // WhatsApp/Traffic: landing page URL
      ...(landing_page_url && { landing_page_url })
    };

    log.info({
      ad_name: creative.ad_name,
      adgroup_id,
      video_id: creative.tiktok_video_id,
      ad_index: created_ads.length + 1,
      total_ads: creative_data.length
    }, '[TikTok:Workflow:CreateCampaign] 📺 Создание Ad');

    const adResult = await withStep(
      'create_ad',
      { params: adParams },
      () => tt.createAd(advertiserId!, accessToken!, adParams)
    );

    const ad_id = adResult.ad_id;
    if (!ad_id) {
      throw Object.assign(new Error('create_ad_failed'), {
        step: 'create_ad_no_id',
        creative_id: creative.user_creative_id
      });
    }

    log.info({
      ad_id,
      creative_id: creative.user_creative_id,
      step: 'ad_created'
    }, '[TikTok:Workflow:CreateCampaign] ✅ Ad создан');

    created_ads.push({
      ad_id,
      user_creative_id: creative.user_creative_id,
      tiktok_video_id: creative.tiktok_video_id
    });
  }

  log.info({
    count: created_ads.length,
    ads: created_ads.map(a => ({ ad_id: a.ad_id, creative_id: a.user_creative_id })),
    step: 'all_ads_created'
  }, '[TikTok:Workflow:CreateCampaign] ✅ Все Ads созданы');

  // ===================================================
  // STEP 8: Сохраняем маппинг для трекинга
  // ===================================================
  try {
    await saveAdCreativeMappingBatch(
      created_ads.map(ad => ({
        ad_id: ad.ad_id,
        user_creative_id: ad.user_creative_id,
        direction_id: undefined,
        user_id: user_account_id,
        account_id: ad_account_id || undefined,
        adset_id: adgroup_id,  // TikTok AdGroup = FB AdSet
        campaign_id: campaign_id,
        fb_creative_id: ad.tiktok_video_id,  // Используем video_id как reference
        source: 'tiktok_campaign_builder'
      }))
    );
  } catch (mappingError) {
    // Не фейлим workflow если маппинг не сохранился
    log.error({
      error: mappingError,
      campaign_id,
      adgroup_id
    }, '[TikTok:Workflow:CreateCampaign] ⚠️ Ошибка сохранения маппинга (не критично)');
  }

  // ===================================================
  // RETURN
  // ===================================================
  const workflowDuration = Date.now() - workflowStartTime;

  log.info({
    campaign_id,
    adgroup_id,
    ads_count: created_ads.length,
    objective,
    auto_activate,
    duration_ms: workflowDuration,
    step: 'workflow_complete'
  }, '[TikTok:Workflow:CreateCampaign] 🎉 Workflow завершён успешно');

  return {
    success: true,
    campaign_id,
    adgroup_id,
    ads: created_ads,
    ads_count: created_ads.length,
    objective,
    message: `TikTok Campaign "${campaign_name}" created successfully with ${created_ads.length} ad(s) (status: ${auto_activate ? 'ENABLED' : 'DISABLED'})`
  };
}

export default workflowCreateTikTokCampaignWithCreative;
