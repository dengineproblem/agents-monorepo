import { graph } from '../adapters/facebook.js';
import { supabase } from '../lib/supabase.js';

type CreateAdSetInDirectionParams = {
  direction_id: string;
  user_creative_ids: string[]; // Массив креативов для создания нескольких ads в adset
  daily_budget_cents?: number; // Опционально - переопределяет бюджет из direction
  adset_name?: string; // Опционально - название adset
  auto_activate?: boolean; // Если true - сразу активирует adset (по умолчанию false)
};

type CreateAdSetInDirectionContext = {
  user_account_id: string;
  ad_account_id: string;
};

/**
 * Преобразует params в query string для Facebook API
 */
function toParams(obj: any): any {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) || (typeof v === 'object' && v !== null)) {
      out[k] = JSON.stringify(v);
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

/**
 * Workflow: Создание AdSet + Ads в существующей Campaign из Direction
 * 
 * КЛЮЧЕВОЕ ОТЛИЧИЕ от workflowCreateCampaignWithCreative:
 * - НЕ создаём новую Campaign
 * - Работаем с существующей fb_campaign_id из Direction
 * - Используем бюджет и objective из Direction
 * - Креативы ДОЛЖНЫ быть связаны с этим direction_id
 */
export async function workflowCreateAdSetInDirection(
  params: CreateAdSetInDirectionParams,
  context: CreateAdSetInDirectionContext,
  accessToken: string
) {
  const {
    direction_id,
    user_creative_ids,
    daily_budget_cents,
    adset_name,
    auto_activate = false
  } = params;

  const { user_account_id, ad_account_id } = context;

  console.log('[CreateAdSetInDirection] Starting workflow:', {
    direction_id,
    user_creative_ids_count: user_creative_ids.length,
    user_creative_ids,
    daily_budget_cents,
    auto_activate
  });

  // ===================================================
  // STEP 1: Получаем Direction из Supabase
  // ===================================================
  const { data: direction, error: directionError } = await supabase
    .from('account_directions')
    .select('*')
    .eq('id', direction_id)
    .eq('user_account_id', user_account_id)
    .single();

  if (directionError || !direction) {
    throw new Error(`Direction not found: ${direction_id}`);
  }

  if (!direction.fb_campaign_id) {
    throw new Error(`Direction ${direction_id} does not have fb_campaign_id (Campaign not created)`);
  }

  console.log('[CreateAdSetInDirection] Direction found:', {
    id: direction.id,
    name: direction.name,
    objective: direction.objective,
    fb_campaign_id: direction.fb_campaign_id,
    daily_budget_cents: direction.daily_budget_cents
  });

  // ===================================================
  // STEP 2: Получаем креативы из Supabase
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

  // Проверяем что креативы связаны с этим direction
  const invalidCreatives = creatives.filter(c => c.direction_id !== direction_id);
  if (invalidCreatives.length > 0) {
    console.warn('[CreateAdSetInDirection] Some creatives not linked to direction:', {
      direction_id,
      invalid_creatives: invalidCreatives.map(c => c.id)
    });
    // Не блокируем, но логируем предупреждение
  }

  console.log('[CreateAdSetInDirection] Creatives found:', {
    count: creatives.length,
    ids: creatives.map(c => c.id),
    titles: creatives.map(c => c.title),
    media_types: creatives.map(c => c.media_type)
  });

  // ===================================================
  // STEP 3: Определяем fb_creative_id для КАЖДОГО креатива
  // ===================================================
  let fb_objective: string = 'OUTCOME_ENGAGEMENT';
  let optimization_goal: string = 'REACH';
  let destination_type: string | undefined;
  
  switch (direction.objective) {
    case 'whatsapp':
      fb_objective = 'OUTCOME_ENGAGEMENT';
      optimization_goal = 'CONVERSATIONS';
      destination_type = 'WHATSAPP';
      break;
    case 'instagram_traffic':
      fb_objective = 'OUTCOME_TRAFFIC';
      optimization_goal = 'LINK_CLICKS';
      break;
    case 'site_leads':
      fb_objective = 'OUTCOME_LEADS';
      optimization_goal = 'LEAD_GENERATION';
      break;
    default:
      throw new Error(`Unknown objective: ${direction.objective}`);
  }

  // Для каждого креатива извлекаем соответствующий fb_creative_id
  const creative_data = creatives.map((creative, index) => {
    let fb_creative_id: string | null = null;
    
    switch (direction.objective) {
      case 'whatsapp':
        fb_creative_id = creative.fb_creative_id_whatsapp;
        break;
      case 'instagram_traffic':
        fb_creative_id = creative.fb_creative_id_instagram_traffic;
        break;
      case 'site_leads':
        fb_creative_id = creative.fb_creative_id_site_leads;
        break;
    }

    if (!fb_creative_id) {
      throw new Error(`Creative ${creative.id} does not have fb_creative_id for ${direction.objective}`);
    }

    return {
      user_creative_id: creative.id,
      fb_creative_id,
      title: creative.title,
      media_type: creative.media_type,
      ad_name: `${direction.name} - ${creative.title || 'Ad'} ${index + 1}`
    };
  });

  console.log('[CreateAdSetInDirection] Prepared creative data:', {
    count: creative_data.length,
    creatives: creative_data.map(c => ({ 
      id: c.user_creative_id, 
      fb_id: c.fb_creative_id, 
      media_type: c.media_type 
    }))
  });

  // Нормализуем ad_account_id
  const normalized_ad_account_id = ad_account_id.startsWith('act_')
    ? ad_account_id
    : `act_${ad_account_id}`;

  // ===================================================
  // STEP 4: Получаем default settings для таргетинга
  // ===================================================
  const { data: defaultSettings } = await supabase
    .from('default_ad_settings')
    .select('*')
    .eq('direction_id', direction_id)
    .maybeSingle();

  let targeting: any = {
    geo_locations: { countries: ['RU'] },
    age_min: 18,
    age_max: 65,
    publisher_platforms: ['instagram'],
    instagram_positions: ['stream', 'story', 'explore', 'reels'],
    device_platforms: ['mobile'],
    targeting_automation: {
      advantage_audience: 1
    }
  };

  if (defaultSettings) {
    // Используем настройки из default_ad_settings
    const cities = defaultSettings.cities || [];
    if (cities.length > 0) {
      // Для простоты используем key без поиска реального geo ID
      targeting.geo_locations = {
        cities: cities.map((city: string) => ({ key: city, name: city }))
      };
    }
    
    if (defaultSettings.age_min) targeting.age_min = defaultSettings.age_min;
    if (defaultSettings.age_max) targeting.age_max = defaultSettings.age_max;
    
    if (defaultSettings.gender && defaultSettings.gender !== 'all') {
      targeting.genders = [defaultSettings.gender === 'male' ? 1 : 2];
    }
  }

  console.log('[CreateAdSetInDirection] Using targeting:', targeting);

  // ===================================================
  // STEP 5: Создаём AdSet в существующей Campaign
  // ===================================================
  const budget = daily_budget_cents || direction.daily_budget_cents;
  const final_adset_name = adset_name || `${direction.name} - AdSet ${new Date().toISOString().split('T')[0]}`;

  const adsetBody: any = {
    name: final_adset_name,
    campaign_id: direction.fb_campaign_id, // КЛЮЧЕВОЕ: используем Campaign из Direction
    daily_budget: budget,
    billing_event: 'IMPRESSIONS',
    optimization_goal: optimization_goal,
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: targeting,
    status: auto_activate ? 'ACTIVE' : 'PAUSED'
  };

  // Добавляем destination_type и promoted_object для WhatsApp
  if (destination_type) {
    adsetBody.destination_type = destination_type;
  }

  // Получаем page_id из user_accounts
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('page_id')
    .eq('id', user_account_id)
    .single();

  if (userAccount?.page_id && direction.objective === 'whatsapp') {
    adsetBody.promoted_object = { page_id: userAccount.page_id };
  }

  console.log('[CreateAdSetInDirection] Creating adset:', {
    name: final_adset_name,
    campaign_id: direction.fb_campaign_id,
    daily_budget: budget,
    optimization_goal,
    destination_type
  });

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

  console.log('[CreateAdSetInDirection] AdSet created:', adset_id);

  // ===================================================
  // STEP 6: Создаём Ads для каждого креатива
  // ===================================================
  const created_ads: Array<{ 
    ad_id: string; 
    user_creative_id: string; 
    fb_creative_id: string;
    media_type: string;
  }> = [];

  for (const creative of creative_data) {
    const adBody: any = {
      name: creative.ad_name,
      adset_id,
      status: auto_activate ? 'ACTIVE' : 'PAUSED',
      creative: { creative_id: creative.fb_creative_id }
    };

    console.log('[CreateAdSetInDirection] Creating ad:', {
      ad_name: creative.ad_name,
      adset_id,
      fb_creative_id: creative.fb_creative_id,
      media_type: creative.media_type
    });

    const adResult = await graph(
      'POST',
      `${normalized_ad_account_id}/ads`,
      accessToken,
      toParams(adBody)
    );

    const ad_id = adResult?.id;
    if (!ad_id) {
      throw new Error(`Failed to create ad for creative ${creative.user_creative_id}`);
    }

    console.log('[CreateAdSetInDirection] Ad created:', {
      ad_id,
      creative_id: creative.user_creative_id,
      media_type: creative.media_type
    });

    created_ads.push({
      ad_id,
      user_creative_id: creative.user_creative_id,
      fb_creative_id: creative.fb_creative_id,
      media_type: creative.media_type
    });
  }

  console.log('[CreateAdSetInDirection] All ads created:', {
    count: created_ads.length,
    ads: created_ads
  });

  // ===================================================
  // STEP 7: Сохраняем связь AdSet с Direction (опционально)
  // ===================================================
  // Можно добавить запись в asset_directions для трекинга
  const { error: assetError } = await supabase
    .from('asset_directions')
    .insert({
      direction_id: direction_id,
      fb_adset_id: adset_id,
      asset_type: 'adset'
    });

  if (assetError) {
    console.warn('[CreateAdSetInDirection] Failed to link adset to direction:', assetError.message);
    // Не блокируем, просто логируем
  }

  // ===================================================
  // RETURN
  // ===================================================
  return {
    success: true,
    direction_id: direction_id,
    direction_name: direction.name,
    campaign_id: direction.fb_campaign_id,
    adset_id: String(adset_id),
    ads: created_ads,
    ads_count: created_ads.length,
    objective: direction.objective,
    message: `AdSet created in direction "${direction.name}" with ${created_ads.length} ad(s) (status: ${auto_activate ? 'ACTIVE' : 'PAUSED'})`,
  };
}

