import { graph } from '../adapters/facebook.js';
import { supabase } from '../lib/supabase.js';
import { 
  getDefaultAdSettingsWithFallback, 
  convertToFacebookTargeting,
  type CampaignGoal 
} from '../lib/defaultSettings.js';
import { saveAdCreativeMappingBatch } from '../lib/adCreativeMapping.js';

type ObjectiveType = 'WhatsApp' | 'Instagram' | 'SiteLeads';

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
};

type CreateCampaignContext = {
  user_account_id: string;
  ad_account_id: string;
  whatsapp_phone_number?: string; // Номер WhatsApp из Supabase (если есть)
  skip_whatsapp_number_in_api?: boolean; // Флаг workaround для bug 2446885
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
    auto_activate = true
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
    case 'Instagram':
      fb_objective = 'OUTCOME_TRAFFIC';
      optimization_goal = 'LINK_CLICKS';
      break;
    case 'SiteLeads':
      fb_objective = 'OUTCOME_LEADS';
      optimization_goal = 'LEAD_GENERATION';
      break;
    default:
      throw new Error(`Unknown objective: ${objective}`);
  }

  // Для каждого креатива извлекаем соответствующий fb_creative_id
  const creative_data = creatives.map((creative, index) => {
    let fb_creative_id: string | null = null;
    
    switch (objective) {
      case 'WhatsApp':
        fb_creative_id = creative.fb_creative_id_whatsapp;
        break;
      case 'Instagram':
        fb_creative_id = creative.fb_creative_id_instagram_traffic;
        break;
      case 'SiteLeads':
        fb_creative_id = creative.fb_creative_id_site_leads;
        break;
    }

    if (!fb_creative_id) {
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
    else if (objective === 'Instagram') campaignGoal = 'instagram_traffic';
    else if (objective === 'SiteLeads') campaignGoal = 'site_leads';

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
  
  const finalAdsetName = adset_name || `${campaign_name} - AdSet 1`;

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
  // WORKAROUND для Facebook API bug 2446885 с обратной совместимостью
  if (objective === 'WhatsApp' && page_id) {
    adsetBody.destination_type = 'WHATSAPP';

    if (context.skip_whatsapp_number_in_api !== false) {
      // НОВАЯ ЛОГИКА (по умолчанию): не отправляем номер
      adsetBody.promoted_object = {
        page_id: String(page_id)
        // whatsapp_phone_number намеренно НЕ передается
      };
    } else {
      // СТАРАЯ ЛОГИКА (обратная совместимость): отправляем номер
      adsetBody.promoted_object = {
        page_id: String(page_id),
        ...(context.whatsapp_phone_number && { whatsapp_phone_number: context.whatsapp_phone_number })
      };
    }
  }

  const skipWhatsAppNumber = context.skip_whatsapp_number_in_api !== false;
  console.log('[CreateCampaignWithCreative] Creating adset:', {
    campaign_id,
    name: finalAdsetName,
    optimization_goal,
    destination_type: adsetBody.destination_type,
    promoted_object: adsetBody.promoted_object,
    skip_whatsapp_number_in_api: skipWhatsAppNumber,
    whatsapp_number_sent: skipWhatsAppNumber ? null : (context.whatsapp_phone_number || null)
  });

  const adsetResult = await withStep(
    'create_adset',
    { payload: adsetBody },
    () => graph('POST', `${normalized_ad_account_id}/adsets`, accessToken, toParams(adsetBody))
  );

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
      direction_id: null, // В этом workflow нет direction
      user_id: context.user_account_id,
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
  };
}