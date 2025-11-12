import { graph } from '../adapters/facebook.js';
import { supabase } from '../lib/supabase.js';
import { createLogger, type AppLogger } from '../lib/logger.js';
import { convertToFacebookTargeting } from '../lib/defaultSettings.js';
import { saveAdCreativeMappingBatch } from '../lib/adCreativeMapping.js';
import {
  getAvailableAdSet,
  activateAdSet,
  incrementAdsCount
} from '../lib/directionAdSets.js';

const baseLog = createLogger({ module: 'workflowCreateAdSetInDirection' });

type WorkflowLoggerOptions = {
  logger?: AppLogger;
};

type CreateAdSetInDirectionParams = {
  direction_id: string;
  user_creative_ids: string[]; // Массив креативов для создания нескольких ads в adset
  daily_budget_cents?: number; // Опционально - переопределяет бюджет из direction
  adset_name?: string; // Опционально - название adset
  auto_activate?: boolean; // Если true - сразу активирует adset (по умолчанию true)
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
    
    // Специальная обработка для creative - Facebook ожидает уже JSON-строку
    if (k === 'creative' && typeof v === 'object' && v !== null && !Array.isArray(v)) {
      out[k] = JSON.stringify(v);
    }
    // Для остальных объектов и массивов - тоже JSON.stringify
    else if (Array.isArray(v) || (typeof v === 'object' && v !== null)) {
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
  accessToken: string,
  options: WorkflowLoggerOptions = {}
) {
  const log = options.logger
    ? options.logger.child({ module: 'workflowCreateAdSetInDirection' })
    : baseLog;
  const {
    direction_id,
    user_creative_ids,
    daily_budget_cents,
    adset_name,
    auto_activate = true,
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
      optimization_goal = 'OFFSITE_CONVERSIONS';
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

  // Используем ту же функцию, что и в автозапуске (workflowCreateCampaignWithCreative)
  let targeting: any;
  
  if (defaultSettings) {
    // Преобразуем настройки из БД в формат Facebook API
    targeting = convertToFacebookTargeting(defaultSettings);
  } else {
    // Fallback на базовый таргетинг
    targeting = {
      geo_locations: { countries: ['RU'] },
      age_min: 18,
      age_max: 65
    };
  }

  // НЕ добавляем дополнительные поля - используем targeting как есть
  // (как в workflowCreateCampaignWithCreative и creativeTest)

  log.debug({ targeting }, 'Using targeting for ad set');

  // ===================================================
  // STEP 5: Создаём AdSet в существующей Campaign
  // ===================================================
  const budget = daily_budget_cents || direction.daily_budget_cents;
  const final_adset_name = adset_name || `${direction.name} - AdSet ${new Date().toISOString().split('T')[0]}`;

  // Получаем page_id и режим создания ad sets из user_accounts ПЕРЕД формированием adsetBody
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('page_id, whatsapp_phone_number, default_adset_mode')
    .eq('id', user_account_id)
    .single();

  // КРИТИЧЕСКАЯ ПРОВЕРКА: для WhatsApp кампаний ОБЯЗАТЕЛЬНО нужен page_id
  if (direction.objective === 'whatsapp' && !userAccount?.page_id) {
    throw new Error(
      `Cannot create WhatsApp adset for direction "${direction.name}": page_id not configured for user account ${user_account_id}. ` +
      `Please connect Facebook Page in settings.`
    );
  }

  // Получаем WhatsApp номер с fallback логикой
  let whatsapp_phone_number = null;
  
  if (direction.objective === 'whatsapp') {
    // 1. Приоритет: номер из направления
    if (direction.whatsapp_phone_number_id) {
      const { data: phoneNumber } = await supabase
        .from('whatsapp_phone_numbers')
        .select('phone_number')
        .eq('id', direction.whatsapp_phone_number_id)
        .eq('is_active', true)
        .single();
      
      whatsapp_phone_number = phoneNumber?.phone_number;
      
      if (whatsapp_phone_number) {
        log.info({ phone_number: whatsapp_phone_number, source: 'direction' }, 'Using WhatsApp number from direction');
      }
    }
    
    // 2. Fallback: дефолтный номер пользователя
    if (!whatsapp_phone_number) {
      const { data: defaultNumber } = await supabase
        .from('whatsapp_phone_numbers')
        .select('phone_number')
        .eq('user_account_id', user_account_id)
        .eq('is_default', true)
        .eq('is_active', true)
        .single();
      
      whatsapp_phone_number = defaultNumber?.phone_number;
      
      if (whatsapp_phone_number) {
        log.info({ phone_number: whatsapp_phone_number, source: 'default' }, 'Using default WhatsApp number');
      }
    }
    
    // 3. Fallback: старый номер из user_accounts (обратная совместимость)
    if (!whatsapp_phone_number && userAccount?.whatsapp_phone_number) {
      whatsapp_phone_number = userAccount.whatsapp_phone_number;
      log.info({ phone_number: whatsapp_phone_number, source: 'user_accounts' }, 'Using legacy WhatsApp number');
    }
  }

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

  // Формируем adsetBody
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

  // Для WhatsApp добавляем destination_type и promoted_object ВМЕСТЕ
  // Это критично! Facebook требует promoted_object если указан destination_type
  if (direction.objective === 'whatsapp' && userAccount?.page_id) {
    adsetBody.destination_type = 'WHATSAPP';

    // Всегда включаем номер из направления (если есть)
    // Если получим ошибку 2446885, повторим запрос без номера (см. try-catch ниже)
    adsetBody.promoted_object = {
      page_id: String(userAccount.page_id),
      ...(whatsapp_phone_number && { whatsapp_phone_number })
    };
  }

  // Для Site Leads добавляем destination_type и promoted_object с pixel_id
  if (direction.objective === 'site_leads') {
    adsetBody.destination_type = 'WEBSITE';

    // Получаем pixel_id из направления (если был выбран при создании)
    if (direction.pixel_id) {
      adsetBody.promoted_object = {
        pixel_id: String(direction.pixel_id),
        custom_event_type: 'LEAD'
      };
    } else {
      // Если pixel_id не указан, используем только custom_event_type
      adsetBody.promoted_object = {
        custom_event_type: 'LEAD'
      };
    }
  }

  // ===================================================
  // Выбор режима: создать новый ad set или использовать pre-created
  // ===================================================
  let adset_id: string;
  let adset_name_final: string;

  if (userAccount?.default_adset_mode === 'use_existing') {
    // РЕЖИМ: использовать pre-created ad set
    log.info({
      directionId: direction.id,
      directionName: direction.name,
      mode: 'use_existing',
      userAccountId: user_account_id,
      userAccountName: userAccountProfile?.username,
      creatives_count: user_creative_ids.length
    }, '🚀 [USE_EXISTING] === MODE: use_existing ACTIVATED ===');

    log.info({
      directionId: direction.id,
      fb_campaign_id: direction.fb_campaign_id
    }, '🔍 [USE_EXISTING] Searching for available PAUSED ad set in this direction...');

    const availableAdSet = await getAvailableAdSet(direction.id);
    
    if (!availableAdSet) {
      log.error({
        directionId: direction.id,
        directionName: direction.name,
        userAccountId: user_account_id,
        userAccountName: userAccountProfile?.username,
        message: 'NO PAUSED AD SETS FOUND'
      }, '❌ [USE_EXISTING] No available pre-created ad sets; cannot proceed');
      
      throw new Error(
        `No pre-created ad sets available for direction "${direction.name}". ` +
        `Please create ad sets in Facebook Ads Manager and link them in settings.`
      );
    }

    log.info({
      directionId: direction.id,
      availableAdSet: {
        db_id: availableAdSet.id,
        fb_adset_id: availableAdSet.fb_adset_id,
        name: availableAdSet.adset_name,
        current_ads_count: availableAdSet.ads_count
      }
    }, '✅ [USE_EXISTING] Found available ad set - proceeding to activation...');

    // Активировать выбранный ad set
    await activateAdSet(
      availableAdSet.id,
      availableAdSet.fb_adset_id,
      accessToken
    );

    adset_id = availableAdSet.fb_adset_id;
    adset_name_final = availableAdSet.adset_name;

    log.info({
      directionId: direction.id,
      adsetId: adset_id,
      adsetName: adset_name_final,
      mode: 'use_existing',
      previousAdsCount: availableAdSet.ads_count,
      userAccountId: user_account_id,
      userAccountName: userAccountProfile?.username
    }, '✅ [USE_EXISTING] Pre-created ad set activated successfully - ready to create ads');

  } else {
    // РЕЖИМ: создать новый ad set через API
    log.info({
      name: final_adset_name,
      campaign_id: direction.fb_campaign_id,
      daily_budget: budget,
      optimization_goal,
      destination_type,
      promoted_object: adsetBody.promoted_object,
      whatsapp_number_in_db: whatsapp_phone_number || null,
      whatsapp_number_id: direction.whatsapp_phone_number_id || null,
      userAccountId: user_account_id,
      userAccountName: userAccountProfile?.username,
      directionName: direction.name,
      mode: 'api_create'
    }, 'Creating new ad set via API with WhatsApp number from direction');

    let adsetResult;
    try {
      // Попытка 1: создаем с номером из направления
      adsetResult = await graph(
        'POST',
        `${normalized_ad_account_id}/adsets`,
        accessToken,
        toParams(adsetBody)
      );
    } catch (error: any) {
      // Проверяем, является ли это ошибкой 2446885 (WhatsApp Business requirement)
      const errorSubcode = error?.error?.error_subcode || error?.error_subcode;
      const isWhatsAppError = errorSubcode === 2446885;

      if (isWhatsAppError && direction.objective === 'whatsapp' && whatsapp_phone_number) {
        log.warn({
          error_subcode: errorSubcode,
          error_message: error?.error?.message || error?.message,
          whatsapp_number_attempted: whatsapp_phone_number
        }, '⚠️ Facebook API error 2446885 detected - retrying WITHOUT whatsapp_phone_number');

        // Попытка 2: создаем БЕЗ номера (Facebook подставит дефолтный)
        const adsetBodyWithoutNumber = {
          ...adsetBody,
          promoted_object: {
            page_id: String(userAccount.page_id)
            // whatsapp_phone_number убран
          }
        };

        adsetResult = await graph(
          'POST',
          `${normalized_ad_account_id}/adsets`,
          accessToken,
          toParams(adsetBodyWithoutNumber)
        );

        log.info({
          adsetId: adsetResult?.id,
          fallback_used: true
        }, '✅ Ad set created successfully WITHOUT whatsapp_phone_number (Facebook will use page default)');
      } else {
        // Если это не ошибка 2446885 или не WhatsApp - пробрасываем ошибку дальше
        throw error;
      }
    }

    adset_id = adsetResult?.id;
    if (!adset_id) {
      throw new Error('Failed to create adset');
    }

    adset_name_final = final_adset_name;

    log.info({
      adsetId: adset_id,
      mode: 'api_create'
    }, 'Ad set created successfully via API');
  }

  // ===================================================
  // STEP 6: Создаём Ads для каждого креатива
  // ===================================================
  const is_use_existing_mode = userAccount?.default_adset_mode === 'use_existing';
  const log_prefix = is_use_existing_mode ? '[USE_EXISTING]' : '[API_CREATE]';
  
  log.info({
    count: creative_data.length,
    adset_id,
    mode: is_use_existing_mode ? 'use_existing' : 'api_create',
    userAccountId: user_account_id,
    userAccountName: userAccountProfile?.username
  }, `🔧 ${log_prefix} STEP 6: Creating ${creative_data.length} ad(s) in ad set...`);
  
  const created_ads: Array<{ 
    ad_id: string; 
    user_creative_id: string; 
    fb_creative_id: string;
    media_type: string;
  }> = [];

  for (let i = 0; i < creative_data.length; i++) {
    const creative = creative_data[i];
    
    const adBody: any = {
      name: creative.ad_name,
      adset_id,
      status: auto_activate ? 'ACTIVE' : 'PAUSED',
      creative: { creative_id: creative.fb_creative_id }
    };

    log.info({
      ad_index: i + 1,
      total_ads: creative_data.length,
      ad_name: creative.ad_name,
      adset_id,
      fb_creative_id: creative.fb_creative_id,
      media_type: creative.media_type,
      status: auto_activate ? 'ACTIVE' : 'PAUSED'
    }, `🔧 ${log_prefix} Creating ad ${i + 1}/${creative_data.length}...`);

    const adResult = await graph(
      'POST',
      `${normalized_ad_account_id}/ads`,
      accessToken,
      toParams(adBody)
    );

    const ad_id = adResult?.id;
    if (!ad_id) {
      log.error({
        creative_id: creative.user_creative_id,
        fb_creative_id: creative.fb_creative_id,
        adset_id,
        ad_index: i + 1
      }, `❌ ${log_prefix} Failed to create ad ${i + 1}/${creative_data.length}`);
      
      throw new Error(`Failed to create ad for creative ${creative.user_creative_id}`);
    }

    log.info({
      ad_id,
      creative_id: creative.user_creative_id,
      media_type: creative.media_type,
      ad_index: i + 1,
      total_ads: creative_data.length
    }, `✅ ${log_prefix} Ad ${i + 1}/${creative_data.length} created successfully`);

    created_ads.push({
      ad_id,
      user_creative_id: creative.user_creative_id,
      fb_creative_id: creative.fb_creative_id,
      media_type: creative.media_type
    });
  }

  log.info({
    count: created_ads.length,
    ads: created_ads.map(a => ({ ad_id: a.ad_id, creative_id: a.user_creative_id })),
    adset_id,
    mode: is_use_existing_mode ? 'use_existing' : 'api_create'
  }, `✅ ${log_prefix} STEP 6: All ${created_ads.length} ad(s) created successfully in ad set`);

  // Инкрементировать счетчик ads для use_existing режима
  if (userAccount?.default_adset_mode === 'use_existing') {
    log.info({
      adsetId: adset_id,
      ads_to_add: created_ads.length,
      userAccountId: user_account_id,
      userAccountName: userAccountProfile?.username
    }, '📊 [USE_EXISTING] Updating ads_count in database...');
    
    const newCount = await incrementAdsCount(adset_id, created_ads.length);
    
    log.info({
      adsetId: adset_id,
      adsAdded: created_ads.length,
      newAdsCount: newCount,
      userAccountId: user_account_id,
      userAccountName: userAccountProfile?.username
    }, '✅ [USE_EXISTING] ads_count updated successfully');
  }

  // Сохраняем маппинг всех созданных ads для трекинга лидов
  await saveAdCreativeMappingBatch(
    created_ads.map(ad => ({
      ad_id: ad.ad_id,
      user_creative_id: ad.user_creative_id,
      direction_id: direction_id,
      user_id: user_account_id,
      adset_id: adset_id,
      campaign_id: direction.fb_campaign_id,
      fb_creative_id: ad.fb_creative_id,
      source: 'direction_launch' as const
    }))
  );

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

