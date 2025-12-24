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

// ============================================================
// TYPES
// ============================================================

export type TikTokObjectiveType = 'traffic' | 'conversions' | 'reach' | 'video_views' | 'lead_generation';

export interface CreateTikTokCampaignParams {
  user_creative_ids: string[];  // Массив креативов
  objective: TikTokObjectiveType;
  campaign_name: string;
  adgroup_name?: string;
  daily_budget: number;  // В долларах (TikTok использует доллары, не центы)
  targeting?: TikTokTargeting;  // Если указан - переопределяет дефолтные
  use_default_settings?: boolean;  // По умолчанию true
  auto_activate?: boolean;  // Если true - сразу активирует (по умолчанию true)
  schedule_start_time?: string;  // ISO datetime
  schedule_end_time?: string;  // ISO datetime
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

/**
 * Получить дефолтный targeting для Казахстана
 */
function getDefaultTikTokTargeting(): TikTokTargeting {
  return {
    location_ids: [6251999],  // Казахстан
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
    schedule_end_time
  } = params;

  const { user_account_id, ad_account_id } = context;

  console.log('[TikTok:CreateCampaignWithCreative] Starting workflow:', {
    user_creative_ids_count: user_creative_ids.length,
    user_creative_ids,
    objective,
    campaign_name,
    daily_budget,
    use_default_settings
  });

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

  console.log('[TikTok:CreateCampaignWithCreative] Credentials loaded:', {
    advertiserId,
    hasIdentity: !!identityId
  });

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

  if (creatives.length !== user_creative_ids.length) {
    console.warn('[TikTok:CreateCampaignWithCreative] Some creatives not found:', {
      requested: user_creative_ids.length,
      found: creatives.length
    });
  }

  console.log('[TikTok:CreateCampaignWithCreative] Creatives found:', {
    count: creatives.length,
    ids: creatives.map(c => c.id),
    titles: creatives.map(c => c.title)
  });

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

      console.log('[TikTok:CreateCampaignWithCreative] Uploading video for creative:', {
        creative_id: creative.id,
        media_url: creative.media_url.substring(0, 50) + '...'
      });

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

      console.log('[TikTok:CreateCampaignWithCreative] Video uploaded:', {
        creative_id: creative.id,
        tiktok_video_id
      });
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

  console.log('[TikTok:CreateCampaignWithCreative] Prepared creative data:', {
    count: creative_data.length,
    creatives: creative_data.map(c => ({ id: c.user_creative_id, video_id: c.tiktok_video_id }))
  });

  // ===================================================
  // STEP 3: Получаем objective config
  // ===================================================
  const objectiveConfig = getTikTokObjectiveConfig(objective);

  console.log('[TikTok:CreateCampaignWithCreative] Objective config:', objectiveConfig);

  // ===================================================
  // STEP 4: Создаем Campaign
  // ===================================================
  const campaignResult = await withStep(
    'create_campaign',
    { name: campaign_name, objective: objectiveConfig.objective_type },
    () => tt.createCampaign(advertiserId!, accessToken!, {
      campaign_name,
      objective_type: objectiveConfig.objective_type,
      budget: daily_budget,  // TikTok принимает в долларах
      budget_mode: 'BUDGET_MODE_DAY',
      operation_status: auto_activate ? 'ENABLE' : 'DISABLE'
    })
  );

  const campaign_id = campaignResult.campaign_id;
  if (!campaign_id) {
    throw Object.assign(new Error('create_campaign_failed'), { step: 'create_campaign_no_id' });
  }

  console.log('[TikTok:CreateCampaignWithCreative] Campaign created:', campaign_id);

  // ===================================================
  // STEP 5: Определяем targeting
  // ===================================================
  let finalTargeting: TikTokTargeting;

  if (targeting) {
    finalTargeting = targeting;
    console.log('[TikTok:CreateCampaignWithCreative] Using provided targeting');
  } else if (use_default_settings) {
    // Попробуем загрузить настройки пользователя
    const { data: userSettings } = await supabase
      .from('default_ad_settings')
      .select('*')
      .eq('user_account_id', user_account_id)
      .maybeSingle();

    if (userSettings) {
      finalTargeting = convertToTikTokTargeting(userSettings);
      console.log('[TikTok:CreateCampaignWithCreative] Using user default settings');
    } else {
      finalTargeting = getDefaultTikTokTargeting();
      console.log('[TikTok:CreateCampaignWithCreative] Using fallback targeting');
    }
  } else {
    finalTargeting = getDefaultTikTokTargeting();
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
    placement_type: 'PLACEMENT_TYPE_AUTOMATIC' as const,
    operation_status: auto_activate ? 'ENABLE' as const : 'DISABLE' as const,
    // Pixel для конверсий
    ...(context.pixel_id && objective === 'conversions' && { pixel_id: context.pixel_id }),
    // Identity для креативов
    ...(identityId && { identity_id: identityId, identity_type: 'TT_USER' as const })
  };

  console.log('[TikTok:CreateCampaignWithCreative] Creating AdGroup:', {
    name: finalAdGroupName,
    campaign_id,
    optimization_goal: objectiveConfig.optimization_goal,
    location_ids: finalTargeting.location_ids,
    age_groups: finalTargeting.age_groups
  });

  const adGroupResult = await withStep(
    'create_adgroup',
    { params: adGroupParams },
    () => tt.createAdGroup(advertiserId!, accessToken!, adGroupParams)
  );

  const adgroup_id = adGroupResult.adgroup_id;
  if (!adgroup_id) {
    throw Object.assign(new Error('create_adgroup_failed'), { step: 'create_adgroup_no_id' });
  }

  console.log('[TikTok:CreateCampaignWithCreative] AdGroup created:', adgroup_id);

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
      adgroup_id,
      ad_format: 'SINGLE_VIDEO' as const,
      video_id: creative.tiktok_video_id,
      ad_text: creative.description || creative.title,
      call_to_action: 'LEARN_MORE',
      operation_status: auto_activate ? 'ENABLE' as const : 'DISABLE' as const,
      // Identity
      ...(identityId && { identity_id: identityId, identity_type: 'TT_USER' as const })
    };

    console.log('[TikTok:CreateCampaignWithCreative] Creating ad:', {
      ad_name: creative.ad_name,
      adgroup_id,
      video_id: creative.tiktok_video_id
    });

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

    console.log('[TikTok:CreateCampaignWithCreative] Ad created:', {
      ad_id,
      creative_id: creative.user_creative_id
    });

    created_ads.push({
      ad_id,
      user_creative_id: creative.user_creative_id,
      tiktok_video_id: creative.tiktok_video_id
    });
  }

  console.log('[TikTok:CreateCampaignWithCreative] All ads created:', {
    count: created_ads.length,
    ads: created_ads
  });

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
    console.error('[TikTok:CreateCampaignWithCreative] Failed to save mapping:', mappingError);
  }

  // ===================================================
  // RETURN
  // ===================================================
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
