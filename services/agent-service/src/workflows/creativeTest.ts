import { graph } from '../adapters/facebook.js';
import { supabase } from '../lib/supabase.js';
import { getDefaultAdSettingsWithFallback, convertToFacebookTargeting } from '../lib/defaultSettings.js';

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
  accessToken: string
) {
  const { user_creative_id, user_id } = params;
  const { ad_account_id, page_id, instagram_id } = context;

  console.log('[CreativeTest] Starting quick test:', {
    user_creative_id,
    user_id,
    ad_account_id
  });

  // ===================================================
  // STEP 1: Проверка существующих тестов
  // ===================================================
  const { data: existingTest } = await supabase
    .from('creative_tests')
    .select('id, status')
    .eq('user_creative_id', user_creative_id)
    .single();

  if (existingTest) {
    if (existingTest.status === 'running') {
      throw new Error('Test already running for this creative');
    }
    if (existingTest.status === 'completed') {
      throw new Error('Creative already tested. Check results in creative_tests table');
    }
  }

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

  console.log('[CreativeTest] Creative found:', {
    id: creative.id,
    title: creative.title,
    fb_creative_id
  });

  // ===================================================
  // STEP 3: Получаем дефолтные настройки таргетинга
  // ===================================================
  const defaultSettings = await getDefaultAdSettingsWithFallback(user_id, 'whatsapp');
  const targeting = convertToFacebookTargeting(defaultSettings);

  console.log('[CreativeTest] Using default targeting');

  // Нормализуем ad_account_id
  const normalized_ad_account_id = ad_account_id.startsWith('act_')
    ? ad_account_id
    : `act_${ad_account_id}`;

  // ===================================================
  // STEP 4: Создаем Campaign
  // ===================================================
  // Формат: ТЕСТ | Ad: {ad_id} | {дата} | {название}
  // Это позволит Brain Agent распознать тестовые кампании и игнорировать их
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const campaign_name = `ТЕСТ | Ad: ${user_creative_id.slice(0, 8)} | ${today} | ${creative.title || 'Creative'}`;

  const campaignBody: any = {
    name: campaign_name,
    objective: 'OUTCOME_ENGAGEMENT',
    special_ad_categories: [],  // Требуется Facebook API (будет JSON.stringify в toParams)
    status: 'ACTIVE'  // Сразу активируем
  };

  console.log('[CreativeTest] Creating campaign:', campaign_name);

  const campaignResult = await graph(
    'POST',
    `${normalized_ad_account_id}/campaigns`,
    accessToken,
    toParams(campaignBody)  // Используем toParams для правильной сериализации
  );

  const campaign_id = campaignResult?.id;
  if (!campaign_id) {
    throw new Error('Failed to create campaign');
  }

  console.log('[CreativeTest] Campaign created:', campaign_id);

  // ===================================================
  // STEP 5: Создаем AdSet ($20/день)
  // ===================================================
  const adsetBody: any = {
    name: `${campaign_name} - AdSet`,
    campaign_id,
    status: 'ACTIVE',
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'CONVERSATIONS',
    daily_budget: 2000,  // $20 = 2000 центов
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting,
    destination_type: 'WHATSAPP',
    promoted_object: {
      page_id: String(page_id),
      ...(context.whatsapp_phone_number && { whatsapp_phone_number: context.whatsapp_phone_number })
    }
  };

  console.log('[CreativeTest] Creating adset');

  const adsetResult = await graph(
    'POST',
    `${normalized_ad_account_id}/adsets`,
    accessToken,
    toParams(adsetBody)  // Используем toParams
  );

  const adset_id = adsetResult?.id;
  if (!adset_id) {
    throw new Error('Failed to create adset');
  }

  console.log('[CreativeTest] AdSet created:', adset_id);

  // ===================================================
  // STEP 6: Создаем Ad
  // ===================================================
  const adBody: any = {
    name: `${campaign_name} - Ad`,
    adset_id,
    status: 'ACTIVE',
    creative: { creative_id: fb_creative_id }
  };

  console.log('[CreativeTest] Creating ad');

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

  console.log('[CreativeTest] Ad created:', ad_id);

  // ===================================================
  // STEP 7: НЕ используем Facebook Auto Rules
  // ===================================================
  // Facebook Auto Rules применяются глобально и могут затронуть другие кампании!
  // Вместо этого используем cron который будет проверять impressions и паузить AdSet вручную
  const rule_id = null;

  console.log('[CreativeTest] Skipping Auto Rule - will use cron instead');

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
    console.error('[CreativeTest] Failed to save test record:', testError);
    throw new Error('Failed to save test record to database');
  }

  console.log('[CreativeTest] Test started successfully:', testRecord.id);

  return {
    success: true,
    test_id: testRecord.id,
    campaign_id,
    adset_id,
    ad_id,
    rule_id,
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

    console.log(`[CreativeTest] Fetching insights for ad ${ad_id} with date_preset=today`);

    const result = await graph('GET', url, accessToken, {
      fields,
      date_preset: 'today'
    });
    
    console.log(`[CreativeTest] Insights response:`, {
      hasData: !!result?.data,
      dataLength: result?.data?.length || 0,
      firstItem: result?.data?.[0]
    });

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
  const actions = insights.actions || [];
  const leads = actions.find((a: any) => a.action_type === 'lead')?.value || 0;
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
    console.error('[CreativeTest] Error fetching insights:', {
      ad_id,
      error: error.message,
      response: error.response?.data
    });
    throw error;
  }
}
