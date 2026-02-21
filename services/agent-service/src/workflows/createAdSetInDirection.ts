import { graph, graphBatch, parseBatchBody, type BatchRequest } from '../adapters/facebook.js';
import { supabase } from '../lib/supabase.js';
import { createLogger, type AppLogger } from '../lib/logger.js';
import { convertToFacebookTargeting } from '../lib/defaultSettings.js';
import { saveAdCreativeMappingBatch } from '../lib/adCreativeMapping.js';
import { getCustomEventType } from '../lib/campaignBuilder.js';
import { applyDirectionAudienceControls } from '../lib/settingsHelpers.js';
import {
  getAvailableAdSet,
  activateAdSet,
  incrementAdsCount
} from '../lib/directionAdSets.js';
import { getCredentials } from '../lib/adAccountHelper.js';
import { generateAdsetName, type AdsetSource } from '../lib/adsetNaming.js';
import { requireAppInstallsConfig } from '../lib/appInstallsConfig.js';

const baseLog = createLogger({ module: 'workflowCreateAdSetInDirection' });

type WorkflowLoggerOptions = {
  logger?: AppLogger;
};

type CreateAdSetInDirectionParams = {
  direction_id: string;
  user_creative_ids: string[]; // Массив креативов для создания нескольких ads в adset
  daily_budget_cents?: number; // Опционально - переопределяет бюджет из direction
  source: AdsetSource; // Источник создания: 'Manual' | 'Brain' | 'AI Launch' | 'Test'
  auto_activate?: boolean; // Если true - сразу активирует adset (по умолчанию true)
  start_mode?: 'now' | 'midnight_almaty'; // Когда запускать: сейчас или с ближайшей полуночи (UTC+5)
};

type CreateAdSetInDirectionContext = {
  user_account_id: string;
  ad_account_id: string;
  account_id?: string; // UUID из ad_accounts для multi-account режима
  page_id?: string; // Передаётся из resolveAccessToken (для поддержки multi-account режима)
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
    source,
    auto_activate = true,
    start_mode = 'now'
  } = params;

  const { user_account_id, ad_account_id, account_id: context_account_id, page_id: context_page_id } = context;

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
    case 'conversions':
      if (direction.conversion_channel === 'lead_form') {
        // Lead form + CRM CAPI: QUALITY_LEAD оптимизирует по конвертированным лидам через CAPI
        fb_objective = 'OUTCOME_LEADS';
        optimization_goal = 'QUALITY_LEAD';
      } else {
        fb_objective = 'OUTCOME_SALES';
        optimization_goal = 'OFFSITE_CONVERSIONS';
      }
      // destination_type зависит от conversion_channel — устанавливается ниже
      break;
    case 'instagram_traffic':
      fb_objective = 'OUTCOME_TRAFFIC';
      optimization_goal = 'LINK_CLICKS';
      break;
    case 'site_leads':
      fb_objective = 'OUTCOME_LEADS';
      optimization_goal = 'OFFSITE_CONVERSIONS';
      break;
    case 'lead_forms':
      fb_objective = 'OUTCOME_LEADS';
      optimization_goal = 'LEAD_GENERATION';
      destination_type = 'ON_AD';
      break;
    case 'app_installs':
      fb_objective = 'OUTCOME_APP_PROMOTION';
      optimization_goal = 'APP_INSTALLS';
      break;
    default:
      throw new Error(`Unknown objective: ${direction.objective}`);
  }

  // Для каждого креатива извлекаем fb_creative_id
  // Новый стандарт: один креатив = один objective, используем fb_creative_id
  // Фолбэк на старые поля для обратной совместимости
  const creative_data = creatives.map((creative, index) => {
    let fb_creative_id: string | null = creative.fb_creative_id;

    // Фолбэк на старые поля (deprecated)
    if (!fb_creative_id) {
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
      }
    }

    if (!fb_creative_id) {
      log.error({
        direction_id,
        objective: direction.objective,
        creative_id: creative.id,
        has_unified_fb_creative_id: Boolean(creative.fb_creative_id),
        has_legacy_site_leads_id: Boolean(creative.fb_creative_id_site_leads),
      }, 'Creative does not have required fb_creative_id for objective');
      throw new Error(`Creative ${creative.id} does not have fb_creative_id for objective ${direction.objective}`);
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

  // pixel_id из capi_settings для conversions
  let capiPixelId: string | null = null;
  if (direction.objective === 'conversions') {
    const conversionChannel = direction.conversion_channel || 'whatsapp';
    const capiChannel = conversionChannel === 'lead_form' ? 'lead_forms' : conversionChannel;
    const capiQuery = supabase
      .from('capi_settings')
      .select('pixel_id')
      .eq('user_account_id', user_account_id)
      .eq('channel', capiChannel)
      .eq('is_active', true);
    if (context_account_id) {
      capiQuery.eq('account_id', context_account_id);
    } else {
      capiQuery.is('account_id', null);
    }
    const { data: capiSettings } = await capiQuery.maybeSingle();
    if (capiSettings?.pixel_id) {
      capiPixelId = capiSettings.pixel_id;
      log.info({ pixel_id: capiPixelId, source: 'capi_settings', channel: capiChannel }, 'Resolved pixel_id from capi_settings');
    }
  }

  const directionAudienceControls = {
    advantageAudienceEnabled: direction.advantage_audience_enabled !== false,
    customAudienceId: direction.custom_audience_id || null,
  };

  log.info({
    directionId: direction.id,
    advantageAudienceEnabled: directionAudienceControls.advantageAudienceEnabled,
    hasCustomAudience: Boolean(directionAudienceControls.customAudienceId),
    customAudienceId: directionAudienceControls.customAudienceId,
  }, 'Applying direction audience controls in createAdSetInDirection');

  // Используем ту же функцию, что и в автозапуске (workflowCreateCampaignWithCreative)
  let targeting: any;
  
  if (defaultSettings) {
    // Преобразуем настройки из БД в формат Facebook API
    targeting = convertToFacebookTargeting(defaultSettings, directionAudienceControls);
  } else {
    // Fallback на базовый таргетинг
    const fallbackTargeting = {
      geo_locations: { countries: ['RU'] },
      age_min: 18,
      age_max: 65,
    };
    targeting = applyDirectionAudienceControls(fallbackTargeting, directionAudienceControls);
  }

  // НЕ добавляем дополнительные поля - используем targeting как есть
  // (как в workflowCreateCampaignWithCreative и creativeTest)

  log.debug({ targeting }, 'Using targeting for ad set');

  // ===================================================
  // STEP 5: Создаём AdSet в существующей Campaign
  // ===================================================
  const budget = daily_budget_cents || direction.daily_budget_cents;
  const final_adset_name = generateAdsetName({ directionName: direction.name, source, objective: direction.objective });

  // Получаем настройки из user_accounts (default_adset_mode)
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('whatsapp_phone_number, default_adset_mode')
    .eq('id', user_account_id)
    .single();

  // Получаем page_id через getCredentials - ТОЧНО ТАК ЖЕ КАК В FALLBACK
  // getCredentials автоматически определяет: мультиаккаунт -> ad_accounts, legacy -> user_accounts
  // Приоритет: context_account_id (UUID из envelope) -> direction.ad_account_id
  const credentials = await getCredentials(user_account_id, context_account_id || direction.ad_account_id);
  const effective_page_id = credentials.fbPageId;

  // КРИТИЧЕСКАЯ ПРОВЕРКА: для WhatsApp, lead_forms и conversions (whatsapp/lead_form) кампаний ОБЯЗАТЕЛЬНО нужен page_id
  const needsPageId = direction.objective === 'whatsapp'
    || direction.objective === 'lead_forms'
    || (direction.objective === 'conversions' && (direction.conversion_channel === 'whatsapp' || direction.conversion_channel === 'lead_form'));
  if (needsPageId && !effective_page_id) {
    throw new Error(
      `Cannot create ${direction.objective} (channel: ${direction.conversion_channel || 'N/A'}) adset for direction "${direction.name}": page_id not configured. ` +
      `Please connect Facebook Page in settings.`
    );
  }

  // Получаем WhatsApp номер с fallback логикой
  // Нужен для objective=whatsapp И для conversions+whatsapp (destination_type=WHATSAPP)
  let whatsapp_phone_number = null;
  const needsWhatsAppNumber = direction.objective === 'whatsapp'
    || (direction.objective === 'conversions' && (direction.conversion_channel === 'whatsapp' || !direction.conversion_channel));

  if (needsWhatsAppNumber) {
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
  if (direction.objective === 'whatsapp' && effective_page_id) {
    adsetBody.destination_type = 'WHATSAPP';

    // Всегда включаем номер из направления (если есть)
    // Если получим ошибку 2446885, повторим запрос без номера (см. try-catch ниже)
    adsetBody.promoted_object = {
      page_id: String(effective_page_id),
      ...(whatsapp_phone_number && { whatsapp_phone_number })
    };
  }

  // Для Conversions (CAPI): destination_type и promoted_object зависят от conversion_channel
  if (direction.objective === 'conversions') {
    const conversionChannel = direction.conversion_channel || 'whatsapp';
    if (!direction.conversion_channel) {
      log.warn({
        directionId: direction.id,
        directionName: direction.name,
        fallbackChannel: 'whatsapp',
      }, 'Conversions direction missing conversion_channel, falling back to whatsapp');
    }

    // WhatsApp: pixel_id только из capi_settings (messaging dataset)
    // Остальные каналы: direction → defaultSettings → capi_settings
    const pixelId = conversionChannel === 'whatsapp'
      ? capiPixelId
      : (direction.pixel_id || defaultSettings?.pixel_id || capiPixelId);
    // lead_form (QUALITY_LEAD) не требует pixel_id — только page_id
    if (!pixelId && conversionChannel !== 'lead_form') {
      log.error({
        directionId: direction.id,
        directionName: direction.name,
        objective: direction.objective,
        conversion_channel: conversionChannel,
        optimization_level: direction.optimization_level,
      }, 'Conversions requires pixel_id but none configured');

      throw new Error(
        `Cannot create conversions adset: pixel_id not configured for direction "${direction.name}". ` +
        `Please configure Meta Pixel in direction settings.`
      );
    }

    const customEventType = getCustomEventType(direction.optimization_level, conversionChannel);

    // destination_type зависит от conversion_channel
    if (conversionChannel === 'whatsapp') {
      adsetBody.destination_type = 'WHATSAPP';
      adsetBody.promoted_object = {
        pixel_id: String(pixelId),
        custom_event_type: customEventType,
        custom_event_str: 'LeadSubmitted',
        page_id: String(effective_page_id),
        ...(whatsapp_phone_number && { whatsapp_phone_number })
      };
    } else if (conversionChannel === 'lead_form') {
      // Lead form + CRM CAPI: адсет как обычная лидформа, без pixel в promoted_object
      // Оптимизация по CRM событиям происходит через CAPI события в датасет (по leadgen_id)
      adsetBody.destination_type = 'ON_AD';
      adsetBody.promoted_object = {
        page_id: String(effective_page_id),
      };
    } else if (conversionChannel === 'site') {
      adsetBody.destination_type = 'WEBSITE';
      adsetBody.promoted_object = {
        pixel_id: String(pixelId),
        custom_event_type: customEventType,
      };
    } else {
      // Fallback на whatsapp для неизвестных каналов
      adsetBody.destination_type = 'WHATSAPP';
      adsetBody.promoted_object = {
        pixel_id: String(pixelId),
        custom_event_type: customEventType,
        custom_event_str: 'LeadSubmitted',
        page_id: String(effective_page_id),
        ...(whatsapp_phone_number && { whatsapp_phone_number })
      };
    }

    log.info({
      directionId: direction.id,
      directionName: direction.name,
      objective: direction.objective,
      conversion_channel: conversionChannel,
      optimization_level: direction.optimization_level,
      pixel_id: pixelId,
      pixel_source: direction.pixel_id ? 'direction' : defaultSettings?.pixel_id ? 'defaultSettings' : 'capi_settings',
      custom_event_type: customEventType,
      page_id: effective_page_id || null,
      whatsapp_phone_number: whatsapp_phone_number || null,
      destination_type: adsetBody.destination_type,
    }, 'Conversions ad set: promoted_object configured for CAPI optimization');
  }

  // Для Site Leads добавляем destination_type и promoted_object с pixel_id
  if (direction.objective === 'site_leads') {
    adsetBody.destination_type = 'WEBSITE';

    // Проверяем ВСЕ источники: direction.pixel_id, defaultSettings.pixel_id, capi_settings
    const sitePixelId = direction.pixel_id || defaultSettings?.pixel_id || capiPixelId;
    if (sitePixelId) {
      adsetBody.promoted_object = {
        pixel_id: String(sitePixelId),
        custom_event_type: 'LEAD'
      };

      log.info({
        pixel_id: sitePixelId,
        source: direction.pixel_id ? 'direction' : defaultSettings?.pixel_id ? 'defaultSettings' : 'capi_settings'
      }, 'Using pixel_id for site_leads');
    } else {
      throw new Error(
        `Для направления "${direction.name}" не настроен Meta Pixel. Укажите Pixel ID в настройках направления.`
      );
    }
  }

  // Для Lead Forms добавляем destination_type ON_AD и promoted_object с lead_gen_form_id
  if (direction.objective === 'lead_forms') {
    adsetBody.destination_type = 'ON_AD';

    const leadFormId = defaultSettings?.lead_form_id;
    if (!leadFormId) {
      throw new Error(
        `Cannot create lead_forms adset for direction "${direction.name}": lead_form_id not configured. ` +
        `Please select a lead form in direction settings.`
      );
    }

    // page_id уже проверен выше в effective_page_id

    // lead_gen_form_id НЕ добавляем в promoted_object - он передаётся только в креативе (call_to_action)
    adsetBody.promoted_object = {
      page_id: String(effective_page_id)
    };

    log.info({
      page_id: effective_page_id,
      lead_form_id: leadFormId
    }, 'Using lead_form for lead_forms objective (form_id in creative CTA)');
  }

  if (direction.objective === 'app_installs') {
    const appConfig = requireAppInstallsConfig();
    const appStoreUrl = defaultSettings?.app_store_url;

    if (!appStoreUrl) {
      throw new Error(
        `Cannot create app_installs adset for direction "${direction.name}": app_store_url is required in direction settings.`
      );
    }

    adsetBody.promoted_object = {
      application_id: appConfig.applicationId,
      object_store_url: appStoreUrl,
      ...(defaultSettings?.is_skadnetwork_attribution !== undefined && {
        is_skadnetwork_attribution: Boolean(defaultSettings.is_skadnetwork_attribution)
      })
    };

    log.info({
      directionId: direction.id,
      appIdEnvKey: appConfig.appIdEnvKey,
      hasAppStoreUrlInSettings: true,
      is_skadnetwork_attribution: defaultSettings?.is_skadnetwork_attribution ?? null
    }, 'Using promoted_object for app_installs objective');
  }

  // ===================================================
  // Выбор режима: создать новый ad set или использовать pre-created
  // ===================================================
  let adset_id: string;
  let adset_name_final: string;

  if (userAccount?.default_adset_mode === 'use_existing') {
    // РЕЖИМ: использовать pre-created ad set
    if (direction.objective === 'app_installs') {
      log.warn({
        directionId: direction.id,
        directionName: direction.name,
        mode: userAccount?.default_adset_mode
      }, 'Using pre-created ad set for app_installs: promoted_object cannot be injected and must be configured in Facebook ad set');
    }
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

      if (isWhatsAppError && direction.objective === 'whatsapp' && whatsapp_phone_number && effective_page_id) {
        log.warn({
          error_subcode: errorSubcode,
          error_message: error?.error?.message || error?.message,
          whatsapp_number_attempted: whatsapp_phone_number
        }, '⚠️ Facebook API error 2446885 detected - retrying WITHOUT whatsapp_phone_number');

        // Попытка 2: создаем БЕЗ номера (Facebook подставит дефолтный)
        const adsetBodyWithoutNumber = {
          ...adsetBody,
          promoted_object: {
            page_id: String(effective_page_id)
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

  // Используем batch API для создания всех ads за один запрос
  const batchStartTime = Date.now();

  const batchRequests: BatchRequest[] = creative_data.map(creative => {
    const body = new URLSearchParams({
      name: creative.ad_name,
      adset_id: adset_id,
      status: auto_activate ? 'ACTIVE' : 'PAUSED',
      creative: JSON.stringify({ creative_id: creative.fb_creative_id })
    }).toString();

    return {
      method: 'POST' as const,
      relative_url: `${normalized_ad_account_id}/ads`,
      body
    };
  });

  log.info({
    batchSize: batchRequests.length,
    adset_id,
    adAccountId: normalized_ad_account_id,
    creativeIds: creative_data.map(c => c.fb_creative_id)
  }, `🔧 ${log_prefix} Creating ${creative_data.length} ad(s) via batch API...`);

  const batchResponses = await graphBatch(accessToken, batchRequests);
  const batchDuration = Date.now() - batchStartTime;

  let rateLimitErrors = 0;
  const failedAds: Array<{ index: number; creative_id: string; errorCode?: number }> = [];

  for (let i = 0; i < batchResponses.length; i++) {
    const response = batchResponses[i];
    const creative = creative_data[i];
    const parsed = parseBatchBody<{ id: string }>(response);

    if (parsed.success && parsed.data?.id) {
      log.debug({
        ad_id: parsed.data.id,
        creative_id: creative.user_creative_id,
        media_type: creative.media_type,
        ad_index: i + 1,
        total_ads: creative_data.length
      }, `✅ ${log_prefix} Ad ${i + 1}/${creative_data.length} created`);

      created_ads.push({
        ad_id: parsed.data.id,
        user_creative_id: creative.user_creative_id,
        fb_creative_id: creative.fb_creative_id,
        media_type: creative.media_type
      });
    } else {
      const errorCode = parsed.error?.code;
      if (errorCode === 17 || errorCode === 4) {
        rateLimitErrors++;
      }
      failedAds.push({ index: i + 1, creative_id: creative.user_creative_id, errorCode });
      log.error({
        creative_id: creative.user_creative_id,
        fb_creative_id: creative.fb_creative_id,
        adset_id,
        ad_index: i + 1,
        errorCode,
        errorMessage: parsed.error?.message?.substring(0, 150)
      }, `❌ ${log_prefix} Failed to create ad ${i + 1}/${creative_data.length}`);
    }
  }

  // Если не все ads созданы - это ошибка
  if (created_ads.length < creative_data.length) {
    log.warn({
      created: created_ads.length,
      expected: creative_data.length,
      failed: failedAds.length,
      rateLimitErrors,
      adset_id
    }, `⚠️ ${log_prefix} Some ads failed to create`);

    // Если совсем ничего не создалось - бросаем ошибку
    if (created_ads.length === 0) {
      throw new Error(`Failed to create any ads for adset ${adset_id}. Rate limit errors: ${rateLimitErrors}`);
    }
  }

  log.info({
    count: created_ads.length,
    totalCreatives: creative_data.length,
    failedCount: failedAds.length,
    rateLimitErrors,
    batchDurationMs: batchDuration,
    avgTimePerAd: Math.round(batchDuration / creative_data.length),
    ads: created_ads.map(a => a.ad_id),
    adset_id,
    mode: is_use_existing_mode ? 'use_existing' : 'api_create'
  }, `✅ ${log_prefix} STEP 6: Created ${created_ads.length}/${creative_data.length} ad(s) in ad set (batch)`);

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
      account_id: direction.account_id || null, // UUID для мультиаккаунтности из direction
      adset_id: adset_id,
      campaign_id: direction.fb_campaign_id,
      fb_creative_id: ad.fb_creative_id,
      source: 'direction_launch' as const
    }))
  );

  // ===================================================
  // STEP 7: Сохраняем связь AdSet с Direction
  // ===================================================
  const { error: adsetLinkError } = await supabase
    .from('direction_adsets')
    .insert({
      direction_id: direction_id,
      fb_adset_id: adset_id,
      adset_name: final_adset_name,
      daily_budget_cents: daily_budget_cents,
      status: auto_activate ? 'ACTIVE' : 'PAUSED',
      ads_count: created_ads.length
    });

  if (adsetLinkError) {
    log.warn({ err: adsetLinkError, adsetId: adset_id, direction_id }, 'Failed to link adset to direction');
    // Не блокируем, просто логируем
  } else {
    log.info({ adsetId: adset_id, direction_id, adsCount: created_ads.length }, 'Adset linked to direction');
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
    conversion_channel: direction.conversion_channel || null,
    message: `AdSet created in direction "${direction.name}" with ${created_ads.length} ad(s) (status: ${auto_activate ? 'ACTIVE' : 'PAUSED'})`,
  };
}
