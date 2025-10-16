import { graph } from '../adapters/facebook.js';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'workflowCreateAdSetInDirection' });

type CreateAdSetInDirectionParams = {
  direction_id: string;
  user_creative_ids: string[]; // Массив креативов для создания нескольких ads в adset
  daily_budget_cents?: number; // Опционально - переопределяет бюджет из direction
  adset_name?: string; // Опционально - название adset
  auto_activate?: boolean; // Если true - сразу активирует adset (по умолчанию false)
  start_mode?: 'now' | 'midnight_almaty'; // Когда запускать: сейчас или с ближайшей полуночи (UTC+5)
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
    auto_activate = false,
    start_mode = 'now'
  } = params;

  const { user_account_id, ad_account_id } = context;

  const { data: userAccountProfile } = await supabase
    .from('user_accounts')
    .select('username')
    .eq('id', user_account_id)
    .single();

  log.info({
    direction_id,
    user_creative_ids_count: user_creative_ids.length,
    user_creative_ids,
    daily_budget_cents,
    auto_activate,
    userAccountId: user_account_id,
    userAccountName: userAccountProfile?.username
  }, 'Starting createAdSetInDirection workflow');

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

  log.info({
    id: direction.id,
    name: direction.name,
    objective: direction.objective,
    fb_campaign_id: direction.fb_campaign_id,
    daily_budget_cents: direction.daily_budget_cents,
    userAccountId: user_account_id,
    userAccountName: userAccountProfile?.username
  }, 'Direction found');

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
    log.warn({
      direction_id,
      invalid_creatives: invalidCreatives.map(c => c.id)
    }, 'Some creatives not linked to direction');
    // Не блокируем, но логируем предупреждение
  }

  log.info({
    count: creatives.length,
    ids: creatives.map(c => c.id),
    titles: creatives.map(c => c.title),
    media_types: creatives.map(c => c.media_type)
  }, 'Creatives loaded for direction');

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

  log.info({
    count: creative_data.length,
    creatives: creative_data.map(c => ({ 
      id: c.user_creative_id, 
      fb_id: c.fb_creative_id, 
      media_type: c.media_type 
    }))
  }, 'Prepared creative data for ads');

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

  log.debug({ targeting }, 'Using targeting for ad set');

  // ===================================================
  // STEP 5: Создаём AdSet в существующей Campaign
  // ===================================================
  const budget = daily_budget_cents || direction.daily_budget_cents;
  const final_adset_name = adset_name || `${direction.name} - AdSet ${new Date().toISOString().split('T')[0]}`;

  // Вычисляем ближайшую полночь по Asia/Almaty (UTC+5)
  function formatWithOffset(date: Date, offsetMin: number) {
    const pad = (n: number) => String(n).padStart(2, '0');
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    const oh = pad(Math.floor(abs / 60));
    const om = pad(abs % 60);
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}${sign}${oh}:${om}`;
  }
  const tzOffsetMin = 5 * 60; // Asia/Almaty UTC+5
  const nowUtcMs = Date.now() + (new Date().getTimezoneOffset() * 60000);
  const localNow = new Date(nowUtcMs + tzOffsetMin * 60000);
  let m = new Date(localNow);
  m.setHours(0, 0, 0, 0);
  if (m <= localNow) m = new Date(m.getTime() + 24 * 60 * 60 * 1000);
  const start_time = formatWithOffset(m, tzOffsetMin);

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

  if (start_mode === 'midnight_almaty') {
    adsetBody.start_time = start_time;
  }

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

  log.info({
    name: final_adset_name,
    campaign_id: direction.fb_campaign_id,
    daily_budget: budget,
    optimization_goal,
    destination_type,
    userAccountId: user_account_id,
    userAccountName: userAccountProfile?.username,
    directionName: direction.name
  }, 'Creating ad set for direction');

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

  log.info({ adsetId: adset_id }, 'Ad set created successfully');

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

    log.info({
      ad_name: creative.ad_name,
      adset_id,
      fb_creative_id: creative.fb_creative_id,
      media_type: creative.media_type
    }, 'Creating ad in direction');

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

    log.info({
      ad_id,
      creative_id: creative.user_creative_id,
      media_type: creative.media_type
    }, 'Ad created successfully');

    created_ads.push({
      ad_id,
      user_creative_id: creative.user_creative_id,
      fb_creative_id: creative.fb_creative_id,
      media_type: creative.media_type
    });
  }

  log.info({
    count: created_ads.length,
    ads: created_ads
  }, 'All ads created for direction');

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
    log.warn({ err: assetError, adsetId: adset_id, direction_id }, 'Failed to link adset to direction');
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

