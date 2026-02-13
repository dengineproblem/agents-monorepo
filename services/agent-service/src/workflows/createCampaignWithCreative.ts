import { graph } from '../adapters/facebook.js';
import { supabase } from '../lib/supabase.js';
import { 
  getDefaultAdSettingsWithFallback, 
  convertToFacebookTargeting,
  type CampaignGoal 
} from '../lib/defaultSettings.js';
import { saveAdCreativeMappingBatch } from '../lib/adCreativeMapping.js';
import { generateAdsetName } from '../lib/adsetNaming.js';
import { requireAppInstallsConfig } from '../lib/appInstallsConfig.js';

type ObjectiveType = 'WhatsApp' | 'Conversions' | 'Instagram' | 'SiteLeads' | 'LeadForms' | 'AppInstalls';

type CreateCampaignParams = {
  user_creative_ids: string[]; // МАССИВ креативов для создания нескольких ads в одном adset
  objective: ObjectiveType;
  campaign_name: string;
  adset_name?: string;
  daily_budget_cents: number;
  targeting?: any; // Если указан - переопределяет дефолтные настройки
  page_id?: string;
  instagram_id?: string;
  use_default_settings?: boolean; // По умолчанию true
  auto_activate?: boolean; // Если true - сразу активирует кампанию (по умолчанию true)
  conversion_channel?: 'whatsapp' | 'lead_form' | 'site'; // Канал конверсии для objective=Conversions
};

type CreateCampaignContext = {
  user_account_id: string;
  ad_account_id: string;
  whatsapp_phone_number?: string; // Номер WhatsApp из Supabase (если есть)
  account_id?: string; // UUID из ad_accounts.id для мультиаккаунтности
  direction_id?: string; // UUID из account_directions.id
};

// Helpers from campaignDuplicate
function toParams(p: Record<string, any>) {
  const o: Record<string, any> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined && v !== null) {
      o[k] = typeof v === 'object' ? JSON.stringify(v) : v;
    }
  }
  return o;
}

function withStep(step: string, payload: Record<string, any>, fn: () => Promise<any>) {
  return fn().catch((e: any) => {
    e.step = step;
    e.payload = payload;
    throw e;
  });
}

/**
 * Workflow: Создание новой кампании с креативом из Supabase
 */
export async function workflowCreateCampaignWithCreative(
  params: CreateCampaignParams,
  context: CreateCampaignContext,
  accessToken: string
) {
  const {
    user_creative_ids,
    objective,
    campaign_name,
    adset_name,
    daily_budget_cents,
    targeting,
    page_id,
    instagram_id,
    use_default_settings = true,
    auto_activate = true,
    conversion_channel
  } = params;

  const { user_account_id, ad_account_id } = context;

  console.log('[CreateCampaignWithCreative] Starting workflow:', {
    user_creative_ids_count: user_creative_ids.length,
    user_creative_ids,
    objective,
    campaign_name,
    daily_budget_cents,
    use_default_settings
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
    console.warn('[CreateCampaignWithCreative] Some creatives not found:', {
      requested: user_creative_ids.length,
      found: creatives.length
    });
  }

  console.log('[CreateCampaignWithCreative] Creatives found:', {
    count: creatives.length,
    ids: creatives.map(c => c.id),
    titles: creatives.map(c => c.title)
  });

  // ===================================================
  // STEP 2: Определяем fb_creative_id для КАЖДОГО креатива
  // ===================================================
  let fb_objective: string = 'OUTCOME_ENGAGEMENT';
  let optimization_goal: string = 'REACH';
  
  switch (objective) {
    case 'WhatsApp':
      fb_objective = 'OUTCOME_ENGAGEMENT';
      optimization_goal = 'CONVERSATIONS';
      break;
    case 'Conversions':
      if (conversion_channel === 'lead_form') {
        fb_objective = 'OUTCOME_LEADS';
        optimization_goal = 'LEAD_GENERATION';
      } else {
        fb_objective = 'OUTCOME_SALES';
        optimization_goal = 'OFFSITE_CONVERSIONS';
      }
      break;
    case 'Instagram':
      fb_objective = 'OUTCOME_TRAFFIC';
      optimization_goal = 'LINK_CLICKS';
      break;
    case 'SiteLeads':
      fb_objective = 'OUTCOME_LEADS';
      optimization_goal = 'OFFSITE_CONVERSIONS';
      break;
    case 'LeadForms':
      fb_objective = 'OUTCOME_LEADS';
      optimization_goal = 'LEAD_GENERATION';
      break;
    case 'AppInstalls':
      fb_objective = 'OUTCOME_APP_PROMOTION';
      optimization_goal = 'APP_INSTALLS';
      break;
    default:
      throw new Error(`Unknown objective: ${objective}`);
  }

  // Для каждого креатива извлекаем соответствующий fb_creative_id
  const creative_data = creatives.map((creative, index) => {
    let fb_creative_id: string | null = creative.fb_creative_id;

    if (!fb_creative_id) {
      switch (objective) {
        case 'WhatsApp':
          fb_creative_id = creative.fb_creative_id_whatsapp;
          break;
        case 'Conversions': {
          // Выбираем fb_creative_id по conversion_channel
          const channel = conversion_channel || 'whatsapp';
          if (channel === 'whatsapp') {
            fb_creative_id = creative.fb_creative_id_whatsapp;
          } else if (channel === 'lead_form') {
            fb_creative_id = creative.fb_creative_id_lead_forms;
          } else if (channel === 'site') {
            fb_creative_id = creative.fb_creative_id_site_leads;
          }
          break;
        }
        case 'Instagram':
          fb_creative_id = creative.fb_creative_id_instagram_traffic;
          break;
        case 'SiteLeads':
          fb_creative_id = creative.fb_creative_id_site_leads;
          break;
        case 'LeadForms':
          fb_creative_id = creative.fb_creative_id_lead_forms;
          break;
      }
    }

    if (!fb_creative_id) {
      console.error('[CreateCampaignWithCreative] Missing required fb_creative_id for objective', {
        objective,
        creative_id: creative.id,
        has_unified_fb_creative_id: Boolean(creative.fb_creative_id),
        has_legacy_site_leads_id: Boolean(creative.fb_creative_id_site_leads)
      });
      throw new Error(`Creative ${creative.id} does not have fb_creative_id for ${objective}`);
    }

    return {
      user_creative_id: creative.id,
      fb_creative_id,
      title: creative.title,
      ad_name: `${campaign_name} - Ad ${index + 1}`
    };
  });

  console.log('[CreateCampaignWithCreative] Prepared creative data:', {
    count: creative_data.length,
    creatives: creative_data.map(c => ({ id: c.user_creative_id, fb_id: c.fb_creative_id }))
  });

  // Нормализуем ad_account_id
  const normalized_ad_account_id = ad_account_id.startsWith('act_')
    ? ad_account_id
    : `act_${ad_account_id}`;

  // ===================================================
  // STEP 3: Создаем Campaign (КАК В ДУБЛИРОВАНИИ)
  // ===================================================
  const campaignBody: any = {
    name: campaign_name,
    objective: fb_objective,
    special_ad_categories: [], // Требуется Facebook, даже если пустой
    status: auto_activate ? 'ACTIVE' : 'PAUSED',
    is_adset_budget_sharing_enabled: false
  };

  console.log('[CreateCampaignWithCreative] Creating campaign:', campaignBody);

  const campaignResult = await withStep(
    'create_campaign',
    { path: `${normalized_ad_account_id}/campaigns`, body: campaignBody },
    () => graph('POST', `${normalized_ad_account_id}/campaigns`, accessToken, toParams(campaignBody))
  );

  const campaign_id = campaignResult?.id;
  if (!campaign_id) {
    throw Object.assign(new Error('create_campaign_failed'), { step: 'create_campaign_no_id' });
  }

  console.log('[CreateCampaignWithCreative] Campaign created:', campaign_id);

  // ===================================================
  // STEP 3.5: Получаем дефолтные настройки из Supabase
  // ===================================================
  let defaultSettings = null;
  // Используем description из первого креатива как fallback
  let finalDescription = creatives[0]?.description || 'Узнайте подробности';
  
  if (use_default_settings) {
    // Преобразуем ObjectiveType в CampaignGoal
    let campaignGoal: CampaignGoal = 'whatsapp';
    if (objective === 'WhatsApp') campaignGoal = 'whatsapp';
    else if (objective === 'Conversions') campaignGoal = 'conversions';
    else if (objective === 'Instagram') campaignGoal = 'instagram_traffic';
    else if (objective === 'SiteLeads') campaignGoal = 'site_leads';
    else if (objective === 'LeadForms') campaignGoal = 'lead_forms';
    else if (objective === 'AppInstalls') campaignGoal = 'app_installs';

    try {
      defaultSettings = await getDefaultAdSettingsWithFallback(user_account_id, campaignGoal);
      console.log('[CreateCampaignWithCreative] Default settings loaded:', {
        campaign_goal: defaultSettings.campaign_goal,
        age_min: defaultSettings.age_min,
        age_max: defaultSettings.age_max,
        cities: defaultSettings.cities?.length || 0
      });
      
      // Используем description из дефолтных настроек
      if (defaultSettings.description) {
        finalDescription = defaultSettings.description;
      }
    } catch (error: any) {
      console.warn('[CreateCampaignWithCreative] Failed to load default settings:', error.message);
      // Продолжаем без дефолтных настроек
    }
  }

  // ===================================================
  // STEP 4: Создаем AdSet с таргетингом из дефолтных настроек
  // ===================================================
  let finalTargeting: any;
  
  if (targeting) {
    // Если таргетинг передан явно - используем его
    finalTargeting = targeting;
    console.log('[CreateCampaignWithCreative] Using provided targeting');
  } else if (defaultSettings) {
    // Используем таргетинг из дефолтных настроек
    finalTargeting = convertToFacebookTargeting(defaultSettings);
    console.log('[CreateCampaignWithCreative] Using targeting from default settings:', finalTargeting);
  } else {
    // Фолбек на базовый таргетинг
    finalTargeting = getDefaultTargeting();
    console.log('[CreateCampaignWithCreative] Using fallback targeting');
  }
  
  const finalAdsetName = generateAdsetName({ directionName: campaign_name, source: 'AI Launch', objective });

  // Время работы AdSet:
  // - НЕ указываем start_time и end_time при daily_budget
  // - Это значит: начинается СРАЗУ при активации, работает БЕССРОЧНО
  // - Именно так работает дублирование кампаний!
  
  const adsetBody: any = {
    name: finalAdsetName,
    campaign_id,
    status: auto_activate ? 'ACTIVE' : 'PAUSED',
    billing_event: 'IMPRESSIONS',
    optimization_goal,
    daily_budget: daily_budget_cents,
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: finalTargeting
  };

  // Для WhatsApp добавляем promoted_object и destination_type
  if (objective === 'WhatsApp' && page_id) {
    adsetBody.destination_type = 'WHATSAPP';

    // Всегда включаем номер из контекста (если есть)
    // Если получим ошибку 2446885, повторим запрос без номера
    adsetBody.promoted_object = {
      page_id: String(page_id),
      ...(context.whatsapp_phone_number && { whatsapp_phone_number: context.whatsapp_phone_number })
    };
  }

  // Для Conversions: destination_type и promoted_object зависят от conversion_channel
  if (objective === 'Conversions') {
    const channel = conversion_channel || 'whatsapp';
    if (!conversion_channel) {
      console.warn('[CreateCampaignWithCreative] Conversions objective missing conversion_channel, falling back to whatsapp');
    }

    const pixelId = defaultSettings?.pixel_id;
    if (!pixelId) {
      throw new Error('Conversions requires pixel_id in default settings');
    }

    // WhatsApp: LeadSubmitted — кастомное messaging событие, нужен OTHER + custom_event_str
    // Остальные каналы: стандартный LEAD
    const isWhatsApp = channel === 'whatsapp';
    const eventType = isWhatsApp ? 'OTHER' : 'LEAD';

    if (isWhatsApp && page_id) {
      adsetBody.destination_type = 'WHATSAPP';
      adsetBody.promoted_object = {
        pixel_id: String(pixelId),
        custom_event_type: eventType,
        custom_event_str: 'LeadSubmitted',
        page_id: String(page_id),
        ...(context.whatsapp_phone_number && { whatsapp_phone_number: context.whatsapp_phone_number })
      };
    } else if (channel === 'lead_form' && page_id) {
      adsetBody.destination_type = 'ON_AD';
      adsetBody.promoted_object = {
        pixel_id: String(pixelId),
        custom_event_type: eventType,
        page_id: String(page_id),
      };
    } else if (channel === 'site') {
      adsetBody.destination_type = 'WEBSITE';
      adsetBody.promoted_object = {
        pixel_id: String(pixelId),
        custom_event_type: eventType,
      };
    } else {
      // Fallback на whatsapp
      if (page_id) {
        adsetBody.destination_type = 'WHATSAPP';
        adsetBody.promoted_object = {
          pixel_id: String(pixelId),
          custom_event_type: 'OTHER',
          custom_event_str: 'LeadSubmitted',
          page_id: String(page_id),
          ...(context.whatsapp_phone_number && { whatsapp_phone_number: context.whatsapp_phone_number })
        };
      }
    }

    console.log('[CreateCampaignWithCreative] Conversions promoted_object configured', {
      conversion_channel: channel,
      pixel_id: pixelId,
      destination_type: adsetBody.destination_type,
      promoted_object: adsetBody.promoted_object,
      page_id: page_id || null,
      whatsapp_phone_number: context.whatsapp_phone_number || null,
    });
  }

  // Для LeadForms добавляем destination_type ON_AD и promoted_object с page_id
  // lead_gen_form_id НЕ добавляем в promoted_object - он передаётся только в креативе (call_to_action)
  if (objective === 'LeadForms' && page_id && defaultSettings?.lead_form_id) {
    adsetBody.destination_type = 'ON_AD';
    adsetBody.promoted_object = {
      page_id: String(page_id)
    };
  }

  if (objective === 'AppInstalls') {
    const appConfig = requireAppInstallsConfig();
    const appStoreUrl = defaultSettings?.app_store_url;

    if (!appStoreUrl) {
      throw new Error('AppInstalls requires app_store_url in default settings');
    }

    adsetBody.promoted_object = {
      application_id: appConfig.applicationId,
      object_store_url: appStoreUrl,
      ...(defaultSettings?.is_skadnetwork_attribution !== undefined && {
        is_skadnetwork_attribution: Boolean(defaultSettings.is_skadnetwork_attribution)
      })
    };

    console.log('[CreateCampaignWithCreative] AppInstalls promoted_object configured', {
      app_id_env_key: appConfig.appIdEnvKey,
      has_app_store_url_in_settings: true,
      is_skadnetwork_attribution: defaultSettings?.is_skadnetwork_attribution ?? null
    });
  }

  console.log('[CreateCampaignWithCreative] Creating adset:', {
    campaign_id,
    name: finalAdsetName,
    optimization_goal,
    destination_type: adsetBody.destination_type,
    promoted_object: adsetBody.promoted_object,
    whatsapp_number: context.whatsapp_phone_number || null
  });

  let adsetResult;
  try {
    // Попытка 1: создаем с номером
    adsetResult = await withStep(
      'create_adset',
      { payload: adsetBody },
      () => graph('POST', `${normalized_ad_account_id}/adsets`, accessToken, toParams(adsetBody))
    );
  } catch (error: any) {
    // Проверяем, является ли это ошибкой 2446885 (WhatsApp Business requirement)
    const errorSubcode = error?.error?.error_subcode || error?.error_subcode;
    const isWhatsAppError = errorSubcode === 2446885;

    if (isWhatsAppError && context.whatsapp_phone_number && (objective === 'WhatsApp' || objective === 'Conversions')) {
      console.log('[CreateCampaignWithCreative] ⚠️ Facebook API error 2446885 detected - retrying WITHOUT whatsapp_phone_number', {
        error_subcode: errorSubcode,
        whatsapp_number_attempted: context.whatsapp_phone_number
      });

      // Попытка 2: создаем БЕЗ номера (Facebook подставит дефолтный)
      const promotedObjectWithoutNumber: any = {
        ...(adsetBody.promoted_object || {})
      };
      delete promotedObjectWithoutNumber.whatsapp_phone_number;

      if (!promotedObjectWithoutNumber.page_id && page_id) {
        promotedObjectWithoutNumber.page_id = String(page_id);
      }

      const adsetBodyWithoutNumber = {
        ...adsetBody,
        promoted_object: promotedObjectWithoutNumber
      };

      adsetResult = await withStep(
        'create_adset_retry',
        { payload: adsetBodyWithoutNumber },
        () => graph('POST', `${normalized_ad_account_id}/adsets`, accessToken, toParams(adsetBodyWithoutNumber))
      );

      console.log('[CreateCampaignWithCreative] ✅ Ad set created successfully WITHOUT whatsapp_phone_number (fallback used)');
    } else {
      // Если это не ошибка 2446885 или нет номера - пробрасываем ошибку дальше
      throw error;
    }
  }

  const adset_id = adsetResult?.id;
  if (!adset_id) {
    throw Object.assign(new Error('create_adset_failed'), { step: 'create_adset_no_id' });
  }

  console.log('[CreateCampaignWithCreative] AdSet created:', adset_id);

  // ===================================================
  // STEP 5: Создаем НЕСКОЛЬКО Ads (по одному для каждого креатива)
  // ===================================================
  const created_ads: Array<{ ad_id: string; user_creative_id: string; fb_creative_id: string }> = [];

  for (const creative of creative_data) {
    const adBody: any = {
      name: creative.ad_name,
      adset_id,
      status: auto_activate ? 'ACTIVE' : 'PAUSED',
      creative: { creative_id: creative.fb_creative_id }
    };

    console.log('[CreateCampaignWithCreative] Creating ad:', {
      ad_name: creative.ad_name,
      adset_id,
      fb_creative_id: creative.fb_creative_id
    });

    const adResult = await withStep(
      'create_ad',
      { payload: adBody },
      () => graph('POST', `${normalized_ad_account_id}/ads`, accessToken, toParams(adBody))
    );

    const ad_id = adResult?.id;
    if (!ad_id) {
      throw Object.assign(new Error('create_ad_failed'), { 
        step: 'create_ad_no_id',
        creative_id: creative.user_creative_id
      });
    }

    console.log('[CreateCampaignWithCreative] Ad created:', {
      ad_id,
      creative_id: creative.user_creative_id
    });

    created_ads.push({
      ad_id,
      user_creative_id: creative.user_creative_id,
      fb_creative_id: creative.fb_creative_id
    });
  }

  console.log('[CreateCampaignWithCreative] All ads created:', {
    count: created_ads.length,
    ads: created_ads
  });

  // Сохраняем маппинг всех созданных ads для трекинга лидов
  await saveAdCreativeMappingBatch(
    created_ads.map(ad => ({
      ad_id: ad.ad_id,
      user_creative_id: ad.user_creative_id,
      direction_id: context.direction_id || null,
      user_id: context.user_account_id,
      account_id: context.account_id || null,
      adset_id: String(adset_id),
      campaign_id: String(campaign_id),
      fb_creative_id: ad.fb_creative_id,
      source: 'campaign_builder' as const
    }))
  );

  // ===================================================
  // RETURN
  // ===================================================
  return {
    success: true,
    campaign_id: String(campaign_id),
    adset_id: String(adset_id),
    ads: created_ads,
    ads_count: created_ads.length,
    objective,
    conversion_channel: conversion_channel || null,
    message: `Campaign "${campaign_name}" created successfully with ${created_ads.length} ad(s) in one adset (status: ${auto_activate ? 'ACTIVE' : 'PAUSED'})`,
  };
}

/**
 * Дефолтный таргетинг (Россия, 18-65, все гендеры)
 */
function getDefaultTargeting() {
  return {
    geo_locations: {
      countries: ['KZ'], // Казахстан (RU заблокирована Meta)
    },
    age_min: 18,
    age_max: 65,
    genders: [1, 2],
    publisher_platforms: ['facebook', 'instagram'],
    facebook_positions: ['feed', 'right_hand_column', 'instant_article', 'instream_video', 'marketplace'],
    instagram_positions: ['stream', 'story', 'explore', 'reels'],
    targeting_automation: {
      advantage_audience: 1
    }
  };
}
