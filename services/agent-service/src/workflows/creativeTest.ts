import { graph } from '../adapters/facebook.js';
import { supabase } from '../lib/supabase.js';
import { getDirectionSettings, buildTargeting } from '../lib/settingsHelpers.js';
import { createLogger, type AppLogger } from '../lib/logger.js';
import { saveAdCreativeMapping } from '../lib/adCreativeMapping.js';

const baseLog = createLogger({ module: 'creativeTestWorkflow' });

type CreativeTestLoggerOptions = {
  logger?: AppLogger;
};

// Вспомогательные функции (как в CreateCampaignWithCreative)
function toParams(p: Record<string, any>) {
  const o: Record<string, any> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined && v !== null) {
      o[k] = typeof v === 'object' ? JSON.stringify(v) : v;
    }
  }
  return o;
}

type StartCreativeTestParams = {
  user_creative_id: string;
  user_id: string;
};

type CreativeTestContext = {
  ad_account_id: string;
  page_id?: string;
  instagram_id?: string;
  whatsapp_phone_number?: string;
  skip_whatsapp_number_in_api?: boolean;
};

/**
 * Workflow: Запуск быстрого теста креатива
 * 
 * 1. Создает Campaign → AdSet → Ad
 * 2. Создает Facebook Auto Rule (остановка при 1000 impressions)
 * 3. Сохраняет в creative_tests
 */
export async function workflowStartCreativeTest(
  params: StartCreativeTestParams,
  context: CreativeTestContext,
  accessToken: string,
  options: CreativeTestLoggerOptions = {}
) {
  const log = options.logger
    ? options.logger.child({ module: 'creativeTestWorkflow' })
    : baseLog;
  const { user_creative_id, user_id } = params;
  const { ad_account_id, page_id, instagram_id } = context;

  const { data: userAccountProfile } = await supabase
    .from('user_accounts')
    .select('username')
    .eq('id', user_id)
    .single();

  log.info({
    user_creative_id,
    user_id,
    ad_account_id,
    userAccountName: userAccountProfile?.username
  }, 'Starting quick test workflow');

  // ===================================================
  // STEP 1: Проверка существующих тестов
  // ===================================================
  const { data: existingTests } = await supabase
    .from('creative_tests')
    .select('id, status')
    .eq('user_creative_id', user_creative_id)
    .eq('user_id', user_id);

  if (existingTests && existingTests.length > 0) {
    const running = existingTests.filter((t: any) => t.status === 'running');
    const completed = existingTests.filter((t: any) => t.status === 'completed');

    if (running.length > 0) {
      throw new Error('Test already running for this creative');
    }

    if (completed.length > 0) {
      await supabase
        .from('creative_tests')
        .delete()
        .eq('user_creative_id', user_creative_id)
        .eq('user_id', user_id)
        .in('status', ['completed', 'cancelled', 'running']);
    }
  }

  // ===================================================
  // STEP 1.5: Получаем режим работы пользователя
  // ===================================================
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('default_adset_mode')
    .eq('id', user_id)
    .single();

  const isUseExistingMode = userAccount?.default_adset_mode === 'use_existing';

  log.info({
    user_id,
    adset_mode: userAccount?.default_adset_mode || 'api_create',
    isUseExistingMode
  }, 'Creative test adset mode determined');

  // ===================================================
  // STEP 2: Получаем креатив из Supabase
  // ===================================================
  const { data: creative, error: creativeError } = await supabase
    .from('user_creatives')
    .select('*')
    .eq('id', user_creative_id)
    .eq('user_id', user_id)
    .eq('status', 'ready')
    .single();

  if (creativeError || !creative) {
    throw new Error(`Creative not found or not ready: ${user_creative_id}`);
  }

  const fb_creative_id = creative.fb_creative_id_whatsapp;
  if (!fb_creative_id) {
    throw new Error('Creative does not have WhatsApp creative ID');
  }

  // Получаем direction для креатива
  const { data: direction } = await supabase
    .from('account_directions')
    .select('*')
    .eq('id', creative.direction_id)
    .single();

  if (!direction) {
    throw new Error(`Direction not found for creative: ${creative.direction_id}`);
  }

  log.info({
    creative_id: creative.id,
    title: creative.title,
    status: creative.status,
    media_type: creative.media_type,
    direction_id: direction.id,
    direction_name: direction.name
  }, 'Creative and direction loaded for test');

  // Нормализуем ad_account_id
  const normalized_ad_account_id = ad_account_id.startsWith('act_')
    ? ad_account_id
    : `act_${ad_account_id}`;

  // Дата для использования в названиях (используется в обоих режимах)
  const today = new Date().toISOString().split('T')[0];

  let campaign_id: string;
  let adset_id: string;

  if (isUseExistingMode) {
    // ===================================================
    // РЕЖИМ: use_existing
    // Используем существующую кампанию направления и свободный adset
    // ===================================================
    
    log.info({
      direction_id: direction.id,
      direction_name: direction.name,
      fb_campaign_id: direction.fb_campaign_id,
      mode: 'use_existing'
    }, 'Creative test in use_existing mode');

    // Проверяем что у направления есть кампания
    if (!direction.fb_campaign_id) {
      throw new Error(
        `Direction "${direction.name}" has no campaign. ` +
        `Please create a campaign for this direction first.`
      );
    }

    campaign_id = direction.fb_campaign_id;

    log.info({ campaign_id }, 'Using existing campaign from direction');

    // Получаем доступный PAUSED adset
    const { getAvailableAdSet, activateAdSet } = await import('../lib/directionAdSets.js');
    const availableAdSet = await getAvailableAdSet(direction.id);

    if (!availableAdSet) {
      throw new Error(
        `No available pre-created ad sets for direction "${direction.name}". ` +
        `Please create ad sets in Facebook Ads Manager and link them in settings, ` +
        `or switch to api_create mode.`
      );
    }

    adset_id = availableAdSet.fb_adset_id;

    log.info({
      adset_id,
      adset_name: availableAdSet.adset_name,
      ads_count: availableAdSet.ads_count,
      direction_id: direction.id
    }, 'Found available pre-created ad set for creative test');

    // Активируем adset (PAUSED -> ACTIVE)
    await activateAdSet(
      availableAdSet.id,
      availableAdSet.fb_adset_id,
      accessToken
    );

    log.info({ adset_id }, 'Activated pre-created ad set for creative test');

  } else {
    // ===================================================
    // РЕЖИМ: api_create (текущая логика)
    // Создаём новую тестовую кампанию и adset
    // ===================================================
    
    log.info({ mode: 'api_create' }, 'Creative test in api_create mode');

    // Получаем дефолтные настройки таргетинга
    const defaultSettings = await getDirectionSettings(creative.direction_id);
    const targeting = buildTargeting(defaultSettings, 'whatsapp');

    log.info({
      directionId: creative.direction_id,
      hasSettings: Boolean(defaultSettings)
    }, 'Using direction targeting for creative test');

    // Создаем Campaign
    const campaign_name = `ТЕСТ | Ad: ${user_creative_id.slice(0, 8)} | ${today} | ${creative.title || 'Creative'}`;

    const campaignBody: any = {
      name: campaign_name,
      objective: 'OUTCOME_ENGAGEMENT',
      special_ad_categories: [],
      status: 'ACTIVE'
    };

    log.info({ campaign_name }, 'Creating campaign for creative test');

    const campaignResult = await graph(
      'POST',
      `${normalized_ad_account_id}/campaigns`,
      accessToken,
      toParams(campaignBody)
    );

    campaign_id = campaignResult?.id;
    if (!campaign_id) {
      throw new Error('Failed to create campaign');
    }

    log.info({ campaign_id }, 'Creative test campaign created');

    // Создаем AdSet
    const adsetBody: any = {
      name: `${campaign_name} - AdSet`,
      campaign_id,
      status: 'ACTIVE',
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'CONVERSATIONS',
      daily_budget: 2000,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting,
      destination_type: 'WHATSAPP',
      promoted_object: context.skip_whatsapp_number_in_api !== false
        ? {
            page_id: String(page_id)
          }
        : {
            page_id: String(page_id),
            ...(context.whatsapp_phone_number && { whatsapp_phone_number: context.whatsapp_phone_number })
          }
    };

    log.info({ campaign_id }, 'Creating ad set for creative test');

    const adsetResult = await graph(
      'POST',
      `${normalized_ad_account_id}/adsets`,
      accessToken,
      toParams(adsetBody)
    );

    adset_id = adsetResult?.id;
    if (!adset_id) {
      throw new Error('Failed to create adset');
    }

    log.info({ adset_id }, 'Creative test ad set created');
  }

  // ===================================================
  // STEP 6: Создаем Ad
  // ===================================================
  // Формируем название ad для обоих режимов
  const ad_name = isUseExistingMode
    ? `Creative Test - ${creative.title || user_creative_id.slice(0, 8)} - ${today}`
    : `ТЕСТ | Ad: ${user_creative_id.slice(0, 8)} | ${today} | ${creative.title || 'Creative'} - Ad`;

  const adBody: any = {
    name: ad_name,
    adset_id,
    status: 'ACTIVE',
    creative: { creative_id: fb_creative_id }
  };

  log.info({ adset_id }, 'Creating ad for creative test');

  const adResult = await graph(
    'POST',
    `${normalized_ad_account_id}/ads`,
    accessToken,
    toParams(adBody)  // Используем toParams
  );

  const ad_id = adResult?.id;
  if (!ad_id) {
    throw new Error('Failed to create ad');
  }

  log.info({ ad_id }, 'Creative test ad created');

  // Сохраняем маппинг для трекинга лидов
  await saveAdCreativeMapping({
    ad_id,
    user_creative_id,
    direction_id: direction.id, // Теперь у нас есть direction
    user_id,
    adset_id,
    campaign_id,
    fb_creative_id,
    source: 'creative_test'
  });

  // ===================================================
  // STEP 7: Инкрементируем счетчик ads для use_existing режима
  // ===================================================
  if (isUseExistingMode) {
    const { incrementAdsCount } = await import('../lib/directionAdSets.js');
    await incrementAdsCount(adset_id, 1);
    
    log.info({
      adset_id,
      mode: 'use_existing'
    }, 'Incremented ads count for pre-created ad set');
  }

  // ===================================================
  // STEP 8: НЕ используем Facebook Auto Rules
  // ===================================================
  // Facebook Auto Rules применяются глобально и могут затронуть другие кампании!
  // Вместо этого используем cron который будет проверять impressions и паузить AdSet вручную
  const rule_id = null;

  log.info('Skipping auto rule (using cron instead)');

  // ===================================================
  // STEP 8: Сохраняем в creative_tests
  // ===================================================
  const { data: testRecord, error: testError } = await supabase
    .from('creative_tests')
    .insert({
      user_creative_id,
      user_id,
      campaign_id,
      adset_id,
      ad_id,
      rule_id,
      test_budget_cents: 2000,
      test_impressions_limit: 1000,
      objective: 'WhatsApp',
      status: 'running',
      started_at: new Date().toISOString()
    })
    .select()
    .single();

  if (testError) {
    log.error({ err: testError }, 'Failed to save creative test record');
    throw new Error('Failed to save test record to database');
  }

  log.info({ 
    testId: testRecord.id,
    mode: isUseExistingMode ? 'use_existing' : 'api_create'
  }, 'Creative test started successfully');

  return {
    success: true,
    test_id: testRecord.id,
    campaign_id,
    adset_id,
    ad_id,
    rule_id,
    mode: isUseExistingMode ? 'use_existing' : 'api_create',
    direction_id: direction.id,
    message: `Creative test started. Budget: $20/day, Target: 1000 impressions`
  };
}

/**
 * Собирает метрики из Facebook Insights
 */
export async function fetchCreativeTestInsights(
  ad_id: string,
  accessToken: string
) {
  try {
    const fields = [
      'impressions',
      'reach',
      'frequency',
      'clicks',
      'actions',
      'action_values',
      'spend',
      'cpm',
      'cpc',
      'ctr',
      'video_play_actions',
      'video_avg_time_watched_actions',
      'video_p25_watched_actions',
      'video_p50_watched_actions',
      'video_p75_watched_actions',
      'video_p95_watched_actions'
    ].join(',');

    const url = `${ad_id}/insights`;

    baseLog.info({ ad_id }, 'Fetching insights for creative test ad');

    const result = await graph('GET', url, accessToken, {
      fields,
      date_preset: 'today'
    });

    baseLog.debug({ ad_id, insights: result?.data }, 'Insights response for creative test');

  if (!result?.data || result.data.length === 0) {
    // Данных ещё нет - возвращаем нули
    return {
      impressions: 0,
      reach: 0,
      frequency: null,
      clicks: 0,
      link_clicks: 0,
      ctr: null,
      link_ctr: null,
      leads: 0,
      spend_cents: 0,
      cpm_cents: null,
      cpc_cents: null,
      cpl_cents: null,
      video_views: 0,
      video_views_25_percent: 0,
      video_views_50_percent: 0,
      video_views_75_percent: 0,
      video_views_95_percent: 0,
      video_avg_watch_time_sec: null
    };
  }

  const insights = result.data[0];

  // Извлекаем leads из actions
  // Для WhatsApp кампаний используем правильные action_type
  const actions = insights.actions || [];
  const messaging_connection = actions.find((a: any) => a.action_type === 'onsite_conversion.total_messaging_connection')?.value || 0;
  const quality_leads = actions.find((a: any) => a.action_type === 'onsite_conversion.messaging_user_depth_2_message_send')?.value || 0;
  const legacy_leads = actions.find((a: any) => a.action_type === 'lead')?.value || 0;
  
  // Для WhatsApp берем messaging_connection, для остальных - legacy leads
  const leads = messaging_connection || legacy_leads;
  const link_clicks = actions.find((a: any) => a.action_type === 'link_click')?.value || 0;

  // Video metrics
  const videoViews = insights.video_play_actions?.[0]?.value || 0;
  const video25 = insights.video_p25_watched_actions?.[0]?.value || 0;
  const video50 = insights.video_p50_watched_actions?.[0]?.value || 0;
  const video75 = insights.video_p75_watched_actions?.[0]?.value || 0;
  const video95 = insights.video_p95_watched_actions?.[0]?.value || 0;
  const videoAvgTime = insights.video_avg_time_watched_actions?.[0]?.value || 0;

  // Рассчитываем метрики
  const spend_cents = Math.round(parseFloat(insights.spend || 0) * 100);
  const cpm_cents = Math.round(parseFloat(insights.cpm || 0) * 100);
  const cpc_cents = Math.round(parseFloat(insights.cpc || 0) * 100);
  const cpl_cents = leads > 0 ? Math.round(spend_cents / leads) : null;
  const link_ctr = link_clicks > 0 && insights.impressions > 0
    ? (link_clicks / insights.impressions) * 100
    : 0;

  return {
    impressions: parseInt(insights.impressions || 0),
    reach: parseInt(insights.reach || 0),
    frequency: parseFloat(insights.frequency || 0),
    clicks: parseInt(insights.clicks || 0),
    link_clicks: parseInt(link_clicks),
    ctr: parseFloat(insights.ctr || 0),
    link_ctr,
    leads: parseInt(leads),
    spend_cents,
    cpm_cents,
    cpc_cents,
    cpl_cents,
    video_views: parseInt(videoViews),
    video_views_25_percent: parseInt(video25),
    video_views_50_percent: parseInt(video50),
    video_views_75_percent: parseInt(video75),
    video_views_95_percent: parseInt(video95),
    video_avg_watch_time_sec: parseFloat(videoAvgTime)
  };
  } catch (error: any) {
    baseLog.error({ err: error, ad_id }, 'Error fetching insights for creative test');
    throw error;
  }
}
