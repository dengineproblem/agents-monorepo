import { graph } from '../adapters/facebook.js';
import { supabase } from '../lib/supabase.js';
import { getDirectionSettings, buildTargeting } from '../lib/settingsHelpers.js';
import { createLogger, type AppLogger } from '../lib/logger.js';
import { saveAdCreativeMapping } from '../lib/adCreativeMapping.js';
import { generateAdsetName } from '../lib/adsetNaming.js';
import { getCustomEventType } from '../lib/campaignBuilder.js';
import { requireAppInstallsConfig } from '../lib/appInstallsConfig.js';

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
  db_ad_account_id?: string; // UUID из ad_accounts (для мультиаккаунтности)
};

type CreativeTestContext = {
  ad_account_id: string; // Facebook Ad Account ID (act_xxx)
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
  accessToken: string,
  options: CreativeTestLoggerOptions = {}
) {
  const log = options.logger
    ? options.logger.child({ module: 'creativeTestWorkflow' })
    : baseLog;
  const { user_creative_id, user_id, db_ad_account_id } = params;
  const { ad_account_id, page_id, instagram_id } = context;

  const { data: userAccountProfile } = await supabase
    .from('user_accounts')
    .select('username, multi_account_enabled')
    .eq('id', user_id)
    .single();
  const isMultiAccount = userAccountProfile?.multi_account_enabled && db_ad_account_id;

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

  // Получаем direction для креатива
  const { data: direction } = await supabase
    .from('account_directions')
    .select('*')
    .eq('id', creative.direction_id)
    .single();

  if (!direction) {
    throw new Error(`Direction not found for creative: ${creative.direction_id}`);
  }

  // Получаем fb_creative_id - новый стандарт: один креатив = один objective
  // Сначала проверяем новое поле fb_creative_id, потом старые для обратной совместимости
  let fb_creative_id: string | null = creative.fb_creative_id;

  if (!fb_creative_id) {
    // Фолбэк на старые поля (deprecated)
    switch (direction.objective) {
      case 'whatsapp':
        fb_creative_id = creative.fb_creative_id_whatsapp;
        break;
      case 'conversions': {
        // Выбираем fb_creative_id по conversion_channel
        const channel = direction.conversion_channel || 'whatsapp';
        if (channel === 'whatsapp') {
          fb_creative_id = creative.fb_creative_id_whatsapp;
        } else if (channel === 'lead_form') {
          fb_creative_id = creative.fb_creative_id_lead_forms;
        } else if (channel === 'site') {
          fb_creative_id = creative.fb_creative_id_site_leads;
        }
        break;
      }
      case 'instagram_traffic':
        fb_creative_id = creative.fb_creative_id_instagram_traffic;
        break;
      case 'site_leads':
        fb_creative_id = creative.fb_creative_id_site_leads;
        break;
      case 'lead_forms':
        fb_creative_id = creative.fb_creative_id_lead_forms;
        break;
      default:
        throw new Error(`Unknown objective: ${direction.objective}`);
    }
  }

  if (!fb_creative_id) {
    log.error({
      creative_id: creative.id,
      objective: direction.objective,
      has_unified_fb_creative_id: Boolean(creative.fb_creative_id),
      has_legacy_site_leads_id: Boolean(creative.fb_creative_id_site_leads),
    }, 'Creative is missing required fb_creative_id for objective');
    throw new Error(
      `Creative does not have Facebook creative ID. ` +
      `Please create a creative for ${direction.objective} objective first.`
    );
  }

  log.info({
    creative_id: creative.id,
    title: creative.title,
    status: creative.status,
    media_type: creative.media_type,
    direction_id: direction.id,
    direction_name: direction.name,
    direction_objective: direction.objective,
    fb_creative_id
  }, 'Creative and direction loaded for test');

  // Нормализуем ad_account_id
  const normalized_ad_account_id = ad_account_id.startsWith('act_')
    ? ad_account_id
    : `act_${ad_account_id}`;

  // Дата для использования в названиях
  const today = new Date().toISOString().split('T')[0];

  // ===================================================
  // STEP 3: Получаем дефолтные настройки направления
  // ===================================================
  const defaultSettings = await getDirectionSettings(creative.direction_id);

  // pixel_id из capi_settings для conversions
  let capiPixelId: string | null = null;
  if (direction.objective === 'conversions') {
    const conversionChannel = direction.conversion_channel || 'whatsapp';
    const capiChannel = conversionChannel === 'lead_form' ? 'lead_forms' : conversionChannel;
    const capiQuery = supabase
      .from('capi_settings')
      .select('pixel_id')
      .eq('user_account_id', user_id)
      .eq('channel', capiChannel)
      .eq('is_active', true);
    if (isMultiAccount) {
      capiQuery.eq('account_id', db_ad_account_id);
    }
    const { data: capiSettings } = await capiQuery.maybeSingle();
    if (capiSettings?.pixel_id) {
      capiPixelId = capiSettings.pixel_id;
      log.info({ pixel_id: capiPixelId, source: 'capi_settings', channel: capiChannel }, 'Resolved pixel_id from capi_settings');
    }
  }

  log.info({
    directionId: creative.direction_id,
    hasSettings: Boolean(defaultSettings)
  }, 'Using direction settings for creative test');

  // ===================================================
  // STEP 4: Определяем Facebook параметры по objective
  // ===================================================
  let fb_objective: string;
  let optimization_goal: string;
  let destination_type: string | undefined;
  let promoted_object: any;

  switch (direction.objective) {
    case 'whatsapp':
      fb_objective = 'OUTCOME_ENGAGEMENT';
      optimization_goal = 'CONVERSATIONS';
      destination_type = 'WHATSAPP';

      // Для WhatsApp - если есть номер, используем его, иначе Facebook подставит дефолтный
      if (context.whatsapp_phone_number) {
        promoted_object = {
          page_id: String(page_id),
          whatsapp_phone_number: context.whatsapp_phone_number
        };
        log.info({ whatsapp_phone_number: context.whatsapp_phone_number }, 'Using WhatsApp number for test');
      } else {
        promoted_object = {
          page_id: String(page_id)
        };
        log.warn('No WhatsApp number provided - Facebook will use page default');
      }
      break;

    case 'instagram_traffic':
      fb_objective = 'OUTCOME_TRAFFIC';
      optimization_goal = 'LINK_CLICKS';
      destination_type = undefined;
      promoted_object = {
        page_id: String(page_id)
      };
      break;

    case 'site_leads':
      fb_objective = 'OUTCOME_LEADS';
      optimization_goal = 'OFFSITE_CONVERSIONS';
      destination_type = 'WEBSITE';

      {
        const sitePixelId = defaultSettings?.pixel_id || capiPixelId;
        if (sitePixelId) {
          promoted_object = {
            pixel_id: String(sitePixelId),
            custom_event_type: 'LEAD'
          };
          log.info({ pixel_id: sitePixelId, source: defaultSettings?.pixel_id ? 'defaultSettings' : 'capi_settings' }, 'Using pixel_id for site_leads');
        } else {
          promoted_object = {
            custom_event_type: 'LEAD'
          };
          log.warn('No pixel_id found for site_leads - creating without pixel tracking');
        }
      }
      break;

    case 'lead_forms':
      fb_objective = 'OUTCOME_LEADS';
      optimization_goal = 'LEAD_GENERATION';
      destination_type = 'ON_AD';

      if (!defaultSettings?.lead_form_id) {
        throw new Error('No lead_form_id found in default settings for lead_forms objective');
      }
      // lead_gen_form_id НЕ добавляем в promoted_object - он передаётся только в креативе (call_to_action)
      promoted_object = {
        page_id: String(page_id)
      };
      log.info({ lead_form_id: defaultSettings.lead_form_id }, 'Using lead_form_id for lead_forms (in creative CTA)');
      break;

    case 'conversions': {
      const conversionChannel = direction.conversion_channel || 'whatsapp';
      if (conversionChannel === 'lead_form') {
        fb_objective = 'OUTCOME_LEADS';
        optimization_goal = 'QUALITY_LEAD';
      } else {
        fb_objective = 'OUTCOME_SALES';
        optimization_goal = 'OFFSITE_CONVERSIONS';
      }
      if (!direction.conversion_channel) {
        log.warn({
          directionId: direction.id,
          directionName: direction.name,
        }, 'Conversions direction missing conversion_channel, falling back to whatsapp');
      }

      if (conversionChannel === 'lead_form') {
        // Lead form (QUALITY_LEAD) — не требует pixel_id, только page_id
        destination_type = 'ON_AD';
        promoted_object = {
          page_id: String(page_id),
        };
        log.info({ conversion_channel: conversionChannel, destination_type }, 'Using lead_form QUALITY_LEAD (no pixel needed)');
      } else {
        // WhatsApp: pixel_id только из capi_settings (messaging dataset)
        // Остальные каналы: defaultSettings → capi_settings
        const effectivePixelId = conversionChannel === 'whatsapp'
          ? capiPixelId
          : (defaultSettings?.pixel_id || capiPixelId);
        if (!effectivePixelId) {
          log.error({
            directionId: direction.id,
            directionName: direction.name,
            conversion_channel: conversionChannel,
          }, 'Conversions requires pixel_id but none configured');
          throw new Error(
            `Cannot create conversions test: pixel_id not configured for direction "${direction.name}". ` +
            `Configure ${conversionChannel === 'whatsapp' ? 'capi_settings' : 'Meta Pixel'}.`
          );
        }

        const customEventType = getCustomEventType(direction.optimization_level, conversionChannel);

        if (conversionChannel === 'whatsapp') {
          destination_type = 'WHATSAPP';
          promoted_object = {
            pixel_id: String(effectivePixelId),
            custom_event_type: customEventType,
            page_id: String(page_id),
          };
          if (context.whatsapp_phone_number) {
            promoted_object.whatsapp_phone_number = context.whatsapp_phone_number;
          }
        } else if (conversionChannel === 'site') {
          destination_type = 'WEBSITE';
          promoted_object = {
            pixel_id: String(effectivePixelId),
            custom_event_type: customEventType,
          };
        } else {
          destination_type = 'WHATSAPP';
          promoted_object = {
            pixel_id: String(effectivePixelId),
            custom_event_type: customEventType,
            page_id: String(page_id),
          };
          if (context.whatsapp_phone_number) {
            promoted_object.whatsapp_phone_number = context.whatsapp_phone_number;
          }
        }

        log.info({
          pixel_id: effectivePixelId,
          pixel_source: defaultSettings?.pixel_id ? 'defaultSettings' : 'capi_settings',
          optimization_level: direction.optimization_level || 'level_1',
          custom_event_type: customEventType,
          conversion_channel: conversionChannel,
          destination_type,
        }, 'Using pixel_id for conversions');
      }
      break;
    }

    case 'app_installs':
      fb_objective = 'OUTCOME_APP_PROMOTION';
      optimization_goal = 'APP_INSTALLS';
      destination_type = undefined;

      const appConfig = requireAppInstallsConfig();
      const appStoreUrl = defaultSettings?.app_store_url;

      if (!appStoreUrl) {
        throw new Error('No app_store_url found in default settings for app_installs objective');
      }

      promoted_object = {
        application_id: appConfig.applicationId,
        object_store_url: appStoreUrl,
        ...(defaultSettings?.is_skadnetwork_attribution !== undefined && {
          is_skadnetwork_attribution: Boolean(defaultSettings.is_skadnetwork_attribution)
        })
      };

      log.info({
        appIdEnvKey: appConfig.appIdEnvKey,
        hasAppStoreUrlInSettings: true,
        isSkadnetworkAttribution: defaultSettings?.is_skadnetwork_attribution ?? null
      }, 'Using global env app config for app_installs creative test');
      break;

    default:
      throw new Error(`Unsupported objective for creative test: ${direction.objective}`);
  }

  log.info({
    objective: direction.objective,
    fb_objective,
    optimization_goal,
    destination_type
  }, 'Facebook parameters determined for creative test');

  // ===================================================
  // STEP 5: Строим таргетинг
  // ===================================================
  log.info({
    directionId: direction.id,
    advantageAudienceEnabled: direction.advantage_audience_enabled !== false,
    hasCustomAudience: Boolean(direction.custom_audience_id),
    customAudienceId: direction.custom_audience_id || null,
  }, 'Applying direction audience controls in creative test');

  const targeting = buildTargeting(defaultSettings, direction.objective, {
    advantageAudienceEnabled: direction.advantage_audience_enabled !== false,
    customAudienceId: direction.custom_audience_id || null,
  });

  // ===================================================
  // STEP 6: Создаем Campaign
  // ===================================================
  const campaign_name = `ТЕСТ | ${direction.objective} | ${user_creative_id.slice(0, 8)} | ${today} | ${creative.title || 'Creative'}`;

  const campaignBody: any = {
    name: campaign_name,
    objective: fb_objective,
    special_ad_categories: [],
    status: 'ACTIVE',
    is_adset_budget_sharing_enabled: false
  };

  log.info({ campaign_name, fb_objective }, 'Creating campaign for creative test');

  const campaignResult = await graph(
    'POST',
    `${normalized_ad_account_id}/campaigns`,
    accessToken,
    toParams(campaignBody)
  );

  const campaign_id = campaignResult?.id;
  if (!campaign_id) {
    throw new Error('Failed to create campaign');
  }

  log.info({ campaign_id }, 'Creative test campaign created');

  // ===================================================
  // STEP 7: Создаем AdSet
  // ===================================================
  const adsetBody: any = {
    name: generateAdsetName({ directionName: direction.name, source: 'Test', objective: direction.objective }),
    campaign_id,
    status: 'ACTIVE',
    billing_event: 'IMPRESSIONS',
    optimization_goal,
    daily_budget: 2000,
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting,
    promoted_object
  };

  // Добавляем destination_type если он определен
  if (destination_type) {
    adsetBody.destination_type = destination_type;
  }

  log.info({
    campaign_id,
    optimization_goal,
    destination_type: destination_type || 'not set',
    has_pixel_id: Boolean(promoted_object?.pixel_id)
  }, 'Creating ad set for creative test');

  const adsetResult = await graph(
    'POST',
    `${normalized_ad_account_id}/adsets`,
    accessToken,
    toParams(adsetBody)
  );

  const adset_id = adsetResult?.id;
  if (!adset_id) {
    throw new Error('Failed to create adset');
  }

  log.info({ adset_id }, 'Creative test ad set created');

  // ===================================================
  // STEP 8: Создаем Ad
  // ===================================================
  const ad_name = `ТЕСТ | ${direction.objective} | ${user_creative_id.slice(0, 8)} | ${today} | ${creative.title || 'Creative'} - Ad`;

  const adBody: any = {
    name: ad_name,
    adset_id,
    status: 'ACTIVE',
    creative: { creative_id: fb_creative_id }
  };

  log.info({ adset_id, fb_creative_id }, 'Creating ad for creative test');

  const adResult = await graph(
    'POST',
    `${normalized_ad_account_id}/ads`,
    accessToken,
    toParams(adBody)
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
    direction_id: direction.id,
    user_id,
    account_id: db_ad_account_id || null,  // UUID для мультиаккаунтности, NULL для legacy
    adset_id,
    campaign_id,
    fb_creative_id,
    source: 'creative_test'
  });

  // ===================================================
  // STEP 9: Сохраняем в creative_tests
  // ===================================================
  const rule_id = null; // Auto rules не используются - cron отслеживает

  const { data: testRecord, error: testError } = await supabase
    .from('creative_tests')
    .insert({
      user_creative_id,
      user_id,
      account_id: db_ad_account_id || null, // UUID для мультиаккаунтности, NULL для legacy
      campaign_id,
      adset_id,
      ad_id,
      rule_id,
      test_budget_cents: 2000,
      test_impressions_limit: 1000,
      objective: direction.objective,
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
    objective: direction.objective
  }, 'Creative test started successfully');

  return {
    success: true,
    test_id: testRecord.id,
    campaign_id,
    adset_id,
    ad_id,
    rule_id,
    objective: direction.objective,
    conversion_channel: direction.conversion_channel || null,
    direction_id: direction.id,
    message: `Creative test started for ${direction.objective}${direction.conversion_channel ? ` (channel: ${direction.conversion_channel})` : ''}. Budget: $20/day, Target: 1000 impressions`
  };
}

/**
 * Собирает метрики из Facebook Insights
 */
export async function fetchCreativeTestInsights(
  ad_id: string,
  accessToken: string,
  objective?: string,
  conversion_channel?: string | null
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
      date_preset: 'maximum'  // All time data for tests running across multiple days
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

  // Извлекаем leads из actions в зависимости от objective
  const actions = insights.actions || [];
  let leads = 0;

  if (objective === 'site_leads') {
    // Для site_leads используем offsite_conversion.fb_pixel_lead
    const offsite_leads = actions.find((a: any) => a.action_type === 'offsite_conversion.fb_pixel_lead')?.value || 0;
    leads = offsite_leads;
    baseLog.debug({ ad_id, objective, offsite_leads, leads }, 'Site leads extracted from insights');
  } else if (objective === 'lead_forms') {
    // Для lead_forms используем action_type: 'lead'
    const form_leads = actions.find((a: any) => a.action_type === 'lead')?.value || 0;
    leads = form_leads;
    baseLog.debug({ ad_id, objective, form_leads, leads }, 'Lead form leads extracted from insights');
  } else if (objective === 'whatsapp') {
    // Для WhatsApp используем messaging connection
    const messaging_connection = actions.find((a: any) => a.action_type === 'onsite_conversion.total_messaging_connection')?.value || 0;
    const legacy_leads = actions.find((a: any) => a.action_type === 'lead')?.value || 0;
    leads = messaging_connection || legacy_leads;
    baseLog.debug({ ad_id, objective, messaging_connection, legacy_leads, leads }, 'WhatsApp leads extracted from insights');
  } else if (objective === 'conversions') {
    // Для conversions — определяем по conversion_channel
    const channel = conversion_channel || 'whatsapp';
    if (channel === 'whatsapp') {
      // Как whatsapp: messaging connection
      const messaging_connection = actions.find((a: any) => a.action_type === 'onsite_conversion.total_messaging_connection')?.value || 0;
      const legacy_leads = actions.find((a: any) => a.action_type === 'lead')?.value || 0;
      leads = messaging_connection || legacy_leads;
    } else if (channel === 'lead_form') {
      // Как lead_forms: lead action_type
      const form_leads = actions.find((a: any) => a.action_type === 'lead')?.value || 0;
      leads = form_leads;
    } else if (channel === 'site') {
      // Как site_leads: offsite_conversion.fb_pixel_lead
      const offsite_leads = actions.find((a: any) => a.action_type === 'offsite_conversion.fb_pixel_lead')?.value || 0;
      leads = offsite_leads;
    } else {
      const legacy_leads = actions.find((a: any) => a.action_type === 'lead')?.value || 0;
      leads = legacy_leads;
    }
    baseLog.debug({ ad_id, objective, conversion_channel: channel, leads }, 'Conversions leads extracted from insights');
  } else if (objective === 'app_installs') {
    const appInstalls =
      actions.find((a: any) => a.action_type === 'mobile_app_install')?.value ||
      actions.find((a: any) => a.action_type === 'app_install')?.value ||
      actions.find((a: any) => a.action_type === 'omni_app_install')?.value ||
      actions.find((a: any) => a.action_type === 'offsite_conversion.fb_mobile_app_install')?.value ||
      0;
    leads = appInstalls;
    baseLog.debug({ ad_id, objective, appInstalls, leads }, 'App installs extracted from insights');
  } else {
    // Для instagram_traffic и других - legacy leads или link clicks
    const legacy_leads = actions.find((a: any) => a.action_type === 'lead')?.value || 0;
    leads = legacy_leads;
    baseLog.debug({ ad_id, objective, legacy_leads, leads }, 'Legacy leads extracted from insights');
  }

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
    leads: parseInt(String(leads)),
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
