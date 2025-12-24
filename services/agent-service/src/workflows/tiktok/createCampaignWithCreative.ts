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

  log.info({
    advertiserId,
    hasIdentity: !!identityId,
    step: 'credentials_loaded'
  }, '[TikTok:Workflow:CreateCampaign] ✅ Credentials загружены');

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
      budget: daily_budget,  // TikTok принимает в долларах
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
    placement_type: 'PLACEMENT_TYPE_AUTOMATIC' as const,
    operation_status: auto_activate ? 'ENABLE' as const : 'DISABLE' as const,
    // Pixel для конверсий
    ...(context.pixel_id && objective === 'conversions' && { pixel_id: context.pixel_id }),
    // Identity для креативов
    ...(identityId && { identity_id: identityId, identity_type: 'TT_USER' as const })
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
