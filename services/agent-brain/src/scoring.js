/**
 * Scoring Agent Module (SIMPLIFIED VERSION)
 * 
 * Агент скоринга и предикшена для оценки рисков роста CPL
 * Работает как часть agent-brain, запускается ПЕРЕД основным LLM
 * 
 * КЛЮЧЕВЫЕ ОТЛИЧИЯ ОТ СТАРОЙ ВЕРСИИ:
 * - Данные всегда берутся из FB API напрямую (не из creative_metrics_history)
 * - FB API сам агрегирует метрики за нужные периоды (last_7d, last_30d)
 * - Для трендов сравниваем два периода (last_7d vs previous_7d)
 * - creative_metrics_history используется ТОЛЬКО для аудита/логирования
 */

import { createClient } from '@supabase/supabase-js';
import { logger } from './lib/logger.js';
import { logScoringError } from './lib/errorLogger.js';
import {
  HS_CLASSES,
  BUDGET_LIMITS,
  TIMEFRAME_WEIGHTS,
  TODAY_COMPENSATION,
  VOLUME_THRESHOLDS
} from './chatAssistant/shared/brainRules.js';

const FB_API_VERSION = 'v23.0';

/**
 * Normalize ad account ID (ensure it starts with 'act_')
 */
function normalizeAdAccountId(adAccountId) {
  if (!adAccountId) return '';
  const id = String(adAccountId).trim();
  return id.startsWith('act_') ? id : `act_${id}`;
}

/**
 * Fetch insights для конкретного Facebook Ad
 * Используется для получения метрик на уровне Ad (не AdSet)
 */
async function fetchAdInsights(adAccountId, accessToken, adId, datePresetOrRange = 'last_7d') {
  const url = `https://graph.facebook.com/${FB_API_VERSION}/${adId}/insights`;
  const params = new URLSearchParams({
    fields: 'impressions,reach,spend,clicks,actions,ctr,cpm,frequency,quality_ranking,engagement_rate_ranking,conversion_rate_ranking,video_play_actions,video_avg_time_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions',
    access_token: accessToken
  });

  // Поддержка как строки date_preset, так и объекта с time_range
  if (typeof datePresetOrRange === 'string') {
    params.set('date_preset', datePresetOrRange);
  } else if (datePresetOrRange && datePresetOrRange.time_range) {
    params.set('time_range', JSON.stringify(datePresetOrRange.time_range));
  } else {
    // fallback на default
    params.set('date_preset', 'last_7d');
  }

  try {
    const res = await fetch(`${url}?${params.toString()}`);
    if (!res.ok) {
      if (res.status === 400) {
        // Ad не имеет показов или удален
        return null;
      }
      const err = await res.text();
      logger.warn({ 
        where: 'fetchAdInsights',
        ad_id: adId,
        status: res.status,
        error: err
      }, 'Failed to fetch ad insights');
      return null;
    }

    const json = await res.json();
    return json.data?.[0] || null;
  } catch (error) {
    logger.warn({ 
      where: 'fetchAdInsights',
      ad_id: adId,
      error: error.message
    }, 'Error fetching ad insights');
    return null;
  }
}

/**
 * Извлечь лиды сайта из actions (fb_pixel_lead с fallback на custom)
 */
function extractSiteLeads(actions) {
  if (!actions || !Array.isArray(actions)) return 0;

  let hasPixelLead = false;
  let siteLeads = 0;

  for (const action of actions) {
    if (action.action_type === 'offsite_conversion.fb_pixel_lead') {
      siteLeads = parseFloat(action.value || '0') || 0;
      hasPixelLead = true;
    } else if (!hasPixelLead && typeof action.action_type === 'string' && action.action_type.startsWith('offsite_conversion.custom')) {
      siteLeads = parseFloat(action.value || '0') || 0;
    }
  }

  return siteLeads;
}

/**
 * Извлечь количество лидов из actions
 * Поддерживает разные типы конверсий (lead, messaging, site leads)
 */
function extractLeads(actions) {
  if (!actions || !Array.isArray(actions)) return 0;

  // Count leads from ALL sources (same logic as facebookApi.ts)
  // DON'T count 'lead' - it's an aggregate that duplicates pixel_lead for site campaigns
  let messagingLeads = 0;
  let leadFormLeads = 0;

  for (const action of actions) {
    if (action.action_type === 'onsite_conversion.total_messaging_connection') {
      messagingLeads = parseInt(action.value || '0', 10);
    } else if (action.action_type === 'onsite_conversion.lead_grouped') {
      leadFormLeads = parseInt(action.value || '0', 10);
    }
  }

  const siteLeads = extractSiteLeads(actions);
  return messagingLeads + siteLeads + leadFormLeads;
}

/**
 * Извлечь количество кликов по ссылке из actions
 */
function extractLinkClicks(actions) {
  if (!actions || !Array.isArray(actions)) return 0;
  
  const linkClickAction = actions.find(a => a.action_type === 'link_click');
  return linkClickAction ? parseInt(linkClickAction.value) || 0 : 0;
}

/**
 * Извлечь метрики по просмотру видео из insights
 */
function extractVideoMetrics(insights) {
  if (!insights) {
    return {
      video_views: 0,
      video_views_25_percent: 0,
      video_views_50_percent: 0,
      video_views_75_percent: 0,
      video_views_95_percent: 0,
      video_avg_watch_time_sec: null
    };
  }

  return {
    video_views: parseInt(insights.video_play_actions?.[0]?.value) || 0,
    video_views_25_percent: parseInt(insights.video_p25_watched_actions?.[0]?.value) || 0,
    video_views_50_percent: parseInt(insights.video_p50_watched_actions?.[0]?.value) || 0,
    video_views_75_percent: parseInt(insights.video_p75_watched_actions?.[0]?.value) || 0,
    video_views_95_percent: parseInt(insights.video_p95_watched_actions?.[0]?.value) || 0,
    video_avg_watch_time_sec: parseFloat(insights.video_avg_time_watched_actions?.[0]?.value) || null
  };
}

/**
 * Извлекает значение action из массива FB actions по типу
 * @param {Array} actions - массив actions из FB API
 * @param {string} actionType - тип действия (lead, link_click, etc)
 * @returns {number} количество действий
 */
function getActionValue(actions, actionType) {
  if (!actions || !Array.isArray(actions)) return 0;
  const action = actions.find(a => a.action_type === actionType);
  return parseInt(action?.value || 0);
}

/**
 * Форматирует сумму в доллары (центы → доллары с разделителями)
 * @param {number} cents - сумма в центах
 * @returns {string} форматированная сумма, например "$5,000"
 */
function formatDollars(cents) {
  if (cents === null || cents === undefined) return '—';
  const dollars = Math.round(cents / 100);
  return '$' + dollars.toLocaleString('en-US');
}

/**
 * Строит человекочитаемое объяснение на основе hsBreakdown
 * @param {Array} hsBreakdown - массив факторов [{ factor, value, reason }]
 * @param {object} metrics - метрики { todayCPL, targetCPL, metricName }
 * @returns {string} понятное объяснение почему HS такой
 */
function buildHumanReadableReason(hsBreakdown, metrics = {}) {
  if (!hsBreakdown || hsBreakdown.length === 0) return '';

  const { todayCPL, targetCPL, metricName = 'CPL' } = metrics;
  const reasons = [];

  // Группируем факторы по типу
  const cplGap = hsBreakdown.find(f => f.factor === 'cpl_gap' || f.factor === 'cpc_gap');
  const trend = hsBreakdown.find(f => f.factor === 'trend_cpl' || f.factor === 'trend_cpc');
  const diagnostics = hsBreakdown.filter(f => ['ctr_low', 'cpm_high', 'frequency_high'].includes(f.factor));

  // CPL/CPC к target
  if (cplGap && targetCPL) {
    const gap = todayCPL - targetCPL;
    const gapPercent = Math.round((gap / targetCPL) * 100);
    if (gap > 0) {
      reasons.push(`${metricName} $${Math.round(todayCPL)} выше цели $${Math.round(targetCPL)} на ${gapPercent}%`);
    } else if (gap < 0) {
      reasons.push(`${metricName} $${Math.round(todayCPL)} ниже цели $${Math.round(targetCPL)} — отлично!`);
    }
  } else if (todayCPL && !targetCPL) {
    reasons.push(`${metricName} $${Math.round(todayCPL)} (цель не задана)`);
  }

  // Тренд
  if (trend) {
    if (trend.value > 0) {
      reasons.push('тренд ухудшается');
    } else if (trend.value < 0) {
      reasons.push('тренд улучшается');
    }
  }

  // Диагностика
  for (const diag of diagnostics) {
    if (diag.factor === 'ctr_low' && diag.value < 0) {
      reasons.push('низкий CTR');
    } else if (diag.factor === 'cpm_high' && diag.value < 0) {
      reasons.push('высокий CPM');
    } else if (diag.factor === 'frequency_high' && diag.value < 0) {
      reasons.push('высокая частота показов (выгорание)');
    }
  }

  return reasons.join(', ');
}

/**
 * Fetch активных ad sets с insights за указанный период
 */
async function fetchAdsets(adAccountId, accessToken, options = 'last_7d') {
  const normalizedId = normalizeAdAccountId(adAccountId);
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${normalizedId}/insights`);
  url.searchParams.set('level', 'adset');
  
  // Поддержка как строки date_preset, так и объекта с time_range
  const isHistorical = typeof options === 'object' && options.historical === true;
  
  if (typeof options === 'string') {
    url.searchParams.set('date_preset', options);
  } else if (options.time_range) {
    url.searchParams.set('time_range', JSON.stringify(options.time_range));
  } else if (options.date_preset) {
    url.searchParams.set('date_preset', options.date_preset);
  } else {
    url.searchParams.set('date_preset', 'last_7d');
  }
  
  // Для текущих данных фильтруем только ACTIVE adsets
  // Для исторических данных НЕ фильтруем - берем все adsets которые работали в тот период
  if (!isHistorical) {
    url.searchParams.set('filtering', JSON.stringify([
      { field: 'adset.effective_status', operator: 'IN', value: ['ACTIVE'] }
    ]));
  }
  
  url.searchParams.set('fields', 'adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpm,cpp,cpc,frequency,reach,actions');
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);
  
  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FB adsets insights failed: ${res.status} ${err}`);
  }
  
  const json = await res.json();
  return json.data || [];
}

/**
 * Fetch diagnostics (quality/engagement/conversion rankings) для ad sets
 * NOTE: Diagnostics доступны только на уровне ad, поэтому группируем по adset_id
 */
async function fetchAdsetDiagnostics(adAccountId, accessToken) {
  const normalizedId = normalizeAdAccountId(adAccountId);
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${normalizedId}/insights`);
  url.searchParams.set('level', 'ad');
  url.searchParams.set('date_preset', 'last_7d');
  url.searchParams.set('filtering', JSON.stringify([
    { field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE'] }
  ]));
  url.searchParams.set('fields', 'ad_id,ad_name,adset_id,quality_ranking,engagement_rate_ranking,conversion_rate_ranking');
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);
  
  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FB diagnostics failed: ${res.status} ${err}`);
  }
  
  const json = await res.json();
  const ads = json.data || [];
  
  // Группируем по adset_id и берем средние/худшие rankings
  const byAdset = {};
  for (const ad of ads) {
    const adsetId = ad.adset_id;
    if (!byAdset[adsetId]) {
      byAdset[adsetId] = {
        adset_id: adsetId,
        ads: []
      };
    }
    byAdset[adsetId].ads.push({
      ad_id: ad.ad_id,
      quality_ranking: ad.quality_ranking,
      engagement_rate_ranking: ad.engagement_rate_ranking,
      conversion_rate_ranking: ad.conversion_rate_ranking
    });
  }
  
  // Для каждого adset берем ХУДШИЙ ranking (самый проблемный ad)
  const result = [];
  for (const adsetId in byAdset) {
    const data = byAdset[adsetId];
    const worstQuality = getWorstRanking(data.ads.map(a => a.quality_ranking));
    const worstEngagement = getWorstRanking(data.ads.map(a => a.engagement_rate_ranking));
    const worstConversion = getWorstRanking(data.ads.map(a => a.conversion_rate_ranking));
    
    result.push({
      adset_id: adsetId,
      quality_ranking: worstQuality,
      engagement_rate_ranking: worstEngagement,
      conversion_rate_ranking: worstConversion,
      ads_count: data.ads.length
    });
  }
  
  return result;
}

/**
 * Определить худший ranking из списка
 */
function getWorstRanking(rankings) {
  const order = {
    'above_average': 4,
    'average': 3,
    'below_average_35': 2,
    'below_average_20': 1,
    'below_average_10': 0
  };
  
  let worst = 'average';
  let worstScore = 3;
  
  for (const rank of rankings) {
    if (!rank) continue;
    const score = order[rank] ?? 3;
    if (score < worstScore) {
      worstScore = score;
      worst = rank;
    }
  }
  
  return worst;
}

/**
 * Извлекает значение action из массива actions FB API
 */
function extractActionValue(actions, actionType) {
  if (!actions || !Array.isArray(actions)) return 0;
  const action = actions.find(a => a.action_type === actionType);
  return action ? parseFloat(action.value || 0) : 0;
}

/**
 * Fetch adsets config (id, name, budgets, status) для переиспользования в brain_run
 * Это избегает повторного запроса и rate limit
 */
async function fetchAdsetsConfig(adAccountId, accessToken, logger) {
  const normalizedId = normalizeAdAccountId(adAccountId);
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${normalizedId}/adsets`);
  url.searchParams.set('fields', 'id,name,campaign_id,daily_budget,lifetime_budget,status,effective_status');
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.text();
    logger?.warn({ where: 'fetchAdsetsConfig', error: `FB adsets config failed: ${res.status}`, body: err?.substring(0, 500) });
    // Не бросаем ошибку, возвращаем объект с ошибкой (как в server.js)
    return { error: `FB adsets config failed: ${res.status} ${err}` };
  }

  const json = await res.json();
  logger?.info({ where: 'fetchAdsetsConfig', adsetsCount: json?.data?.length || 0 });
  return json; // Возвращаем весь объект { data: [...], paging: {...} }
}

/**
 * Fetch adsets insights с breakdown по дням за N дней (для трендов)
 */
async function fetchAdsetsDaily(adAccountId, accessToken, days = 14) {
  const normalizedId = normalizeAdAccountId(adAccountId);
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${normalizedId}/insights`);
  url.searchParams.set('level', 'adset');
  url.searchParams.set('time_increment', '1'); // breakdown по дням
  url.searchParams.set('date_preset', `last_${days}d`);
  url.searchParams.set('filtering', JSON.stringify([
    { field: 'adset.effective_status', operator: 'IN', value: ['ACTIVE'] }
  ]));
  url.searchParams.set('fields', 'adset_id,adset_name,campaign_id,campaign_name,date_start,date_stop,spend,impressions,clicks,ctr,cpm,cpp,cpc,frequency,reach');
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);
  
  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FB adsets daily insights failed: ${res.status} ${err}`);
  }
  
  const json = await res.json();
  return json.data || [];
}

/**
 * Получить objective для adsets через campaign_id → direction
 * Возвращает Map<campaign_id, objective>
 * В мультиаккаунтном режиме фильтрует по account_id
 */
async function getAdsetsObjectives(supabase, userAccountId, accountUUID = null) {
  const objectivesMap = new Map();

  try {
    // Получаем campaign_id для каждого adset из Facebook Insights
    // (уже есть в dailyData: campaign_id)
    // Поэтому вместо adsetIds используем campaign_ids

    // Получаем directions с их fb_campaign_id и objective
    let query = supabase
      .from('account_directions')
      .select('fb_campaign_id, objective')
      .eq('user_account_id', userAccountId)
      .not('fb_campaign_id', 'is', null);

    if (accountUUID) {
      query = query.eq('account_id', accountUUID);
    } else {
      query = query.is('account_id', null);
    }

    const { data: directions, error } = await query;

    if (error) {
      logger.error({ error: error.message }, '[getAdsetsObjectives] Failed to fetch directions');
      return objectivesMap;
    }

    // Создаем Map<fb_campaign_id, objective>
    const campaignObjectives = new Map();
    for (const d of directions || []) {
      campaignObjectives.set(d.fb_campaign_id, d.objective);
    }

    logger.debug({
      directions_count: directions?.length || 0,
      campaigns_mapped: campaignObjectives.size,
      accountUUID: accountUUID || null
    }, '[getAdsetsObjectives] Loaded campaign objectives');

    return campaignObjectives;

  } catch (err) {
    logger.error({ err: err.message }, '[getAdsetsObjectives] Error fetching objectives');
    return objectivesMap;
  }
}

/**
 * Fetch агрегированные actions для adsets (для всех типов кампаний)
 */
async function fetchAdsetsActions(adAccountId, accessToken, datePreset = 'last_7d') {
  const normalizedId = normalizeAdAccountId(adAccountId);
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${normalizedId}/insights`);
  url.searchParams.set('level', 'adset');
  url.searchParams.set('date_preset', datePreset);
  url.searchParams.set('filtering', JSON.stringify([
    { field: 'adset.effective_status', operator: 'IN', value: ['ACTIVE'] }
  ]));
  url.searchParams.set('fields', 'adset_id,actions');
  url.searchParams.set('action_breakdowns', 'action_type');
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);
  
  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FB adsets actions failed: ${res.status} ${err}`);
  }
  
  const json = await res.json();
  
  // Логируем actions для отладки
  if (json.data && json.data.length > 0) {
    const sample = json.data[0];
    logger.debug({ sampleAdsetsActions: sample }, '[fetchAdsetsActions] Sample actions');
  }
  
  return json.data || [];
}

/**
 * Группирует daily данные и вычисляет тренды для 1d, 3d, 7d
 * @param {Array} dailyData - данные с breakdown по дням
 * @param {Array} actionsData - агрегированные actions
 * @param {Map} campaignObjectives - Map<campaign_id, objective>
 */
function calculateMultiPeriodTrends(dailyData, actionsData = [], campaignObjectives = new Map()) {
  // Группируем по adset_id
  const byAdset = new Map();
  
  for (const row of dailyData) {
    const id = row.adset_id;
    if (!byAdset.has(id)) {
      byAdset.set(id, {
        adset_id: id,
        adset_name: row.adset_name,
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        days: []
      });
    }
    byAdset.get(id).days.push({
      date: row.date_start,
      cpm: parseFloat(row.cpm || 0),
      ctr: parseFloat(row.ctr || 0),
      frequency: parseFloat(row.frequency || 0),
      impressions: parseFloat(row.impressions || 0),
      spend: parseFloat(row.spend || 0),
      reach: parseFloat(row.reach || 0)
    });
  }
  
  // Сортируем дни по дате (старые → новые)
  for (const adset of byAdset.values()) {
    adset.days.sort((a, b) => new Date(a.date) - new Date(b.date));
  }
  
  // Для каждого adset вычисляем метрики и тренды
  const result = [];
  
  for (const adset of byAdset.values()) {
    const days = adset.days;
    if (days.length < 2) continue; // Недостаточно данных
    
    // Агрегируем метрики за последние 7 дней
    const last7d = aggregateMetrics(days.slice(-7));
    
    // Вычисляем тренды для разных периодов
    const trends = {
      d1: calculateTrend(days.slice(-2, -1), days.slice(-1)), // позавчера vs вчера
      d3: calculateTrend(days.slice(-6, -3), days.slice(-3)), // дни 4-6 vs последние 3
      d7: calculateTrend(days.slice(-14, -7), days.slice(-7)) // дни 8-14 vs последние 7
    };
    
    // Получаем objective для этого adset
    const objective = campaignObjectives.get(adset.campaign_id) || 'whatsapp'; // fallback для legacy

    // Получаем actions для этого adset
    const actionsForAdset = actionsData.find(a => a.adset_id === adset.adset_id);
    const actions = actionsForAdset?.actions || [];

    // Для отладки: выводим все action_types
    const allActionTypes = actions.map(a => `${a.action_type}:${a.value}`).join(', ');

    let dataValid = true;
    let dataValidityReason = null;
    let objectiveMetrics = null;

    // Собираем метрики в зависимости от objective
    if (objective === 'whatsapp') {
      // WhatsApp метрики
      const linkClicksTotal = extractActionValue(actions, 'link_click');
      const conversationsTotal = extractActionValue(actions, 'onsite_conversion.total_messaging_connection');
      const qualityLeadsTotal = extractActionValue(actions, 'onsite_conversion.messaging_user_depth_2_message_send');

      const conversionRate = linkClicksTotal > 0 ? (conversationsTotal / linkClicksTotal) * 100 : 0;
      const qualityConversionRate = linkClicksTotal > 0 ? (qualityLeadsTotal / linkClicksTotal) * 100 : 0;

      // Проверка валидности ТОЛЬКО для WhatsApp
      if (linkClicksTotal > 0 && conversionRate < 10) {
        dataValid = false;
        dataValidityReason = `Низкая конверсия WhatsApp: ${conversionRate.toFixed(1)}% (${linkClicksTotal} кликов → ${conversationsTotal} переписок). Возможно, лиды не прогрузились.`;
      }

      objectiveMetrics = {
        whatsapp_metrics: {
          link_clicks: linkClicksTotal,
          conversations_started: conversationsTotal,
          quality_leads: qualityLeadsTotal,
          conversion_rate: conversionRate.toFixed(1),
          quality_conversion_rate: qualityConversionRate.toFixed(1),
          all_action_types: allActionTypes
        }
      };
    } else if (objective === 'site_leads') {
      // Site Leads метрики
      const linkClicksTotal = extractActionValue(actions, 'link_click');
      const siteLeadsTotal = extractSiteLeads(actions);

      const conversionRate = linkClicksTotal > 0 ? (siteLeadsTotal / linkClicksTotal) * 100 : 0;

      objectiveMetrics = {
        site_leads_metrics: {
          link_clicks: linkClicksTotal,
          pixel_leads: siteLeadsTotal,
          conversion_rate: conversionRate.toFixed(1),
          all_action_types: allActionTypes
        }
      };
    } else if (objective === 'instagram_traffic') {
      // Instagram Traffic метрики
      const linkClicksTotal = extractActionValue(actions, 'link_click');
      const totalSpend = last7d?.spend || 0;
      const costPerClick = linkClicksTotal > 0 ? totalSpend / linkClicksTotal : 0;

      objectiveMetrics = {
        instagram_metrics: {
          link_clicks: linkClicksTotal,
          cost_per_click: costPerClick.toFixed(2),
          all_action_types: allActionTypes
        }
      };
    } else if (objective === 'lead_forms') {
      // Lead Forms метрики (Facebook Instant Forms)
      const formLeadsTotal = extractActionValue(actions, 'onsite_conversion.lead_grouped');
      const totalSpend = last7d?.spend || 0;
      const costPerLead = formLeadsTotal > 0 ? totalSpend / formLeadsTotal : 0;

      objectiveMetrics = {
        lead_forms_metrics: {
          form_leads: formLeadsTotal,
          cost_per_lead: costPerLead.toFixed(2),
          all_action_types: allActionTypes
        }
      };
    }

    result.push({
      adset_id: adset.adset_id,
      adset_name: adset.adset_name,
      campaign_id: adset.campaign_id,
      campaign_name: adset.campaign_name,
      objective: objective, // ✅ ДОБАВЛЕНО
      metrics_last_7d: last7d,
      trends,
      data_valid: dataValid,
      data_validity_reason: dataValidityReason,
      ...objectiveMetrics // ✅ Условное добавление метрик
    });
  }
  
  return result;
}

/**
 * Агрегирует метрики за период
 */
function aggregateMetrics(days) {
  if (!days || days.length === 0) return null;
  
  const totalSpend = days.reduce((sum, d) => sum + d.spend, 0);
  const totalImpressions = days.reduce((sum, d) => sum + d.impressions, 0);
  const totalReach = days.reduce((sum, d) => sum + d.reach, 0);
  const totalClicks = days.reduce((sum, d) => sum + (d.impressions * d.ctr / 100), 0);
  
  return {
    cpm: totalImpressions > 0 ? (totalSpend / totalImpressions * 1000) : 0,
    ctr: totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0,
    frequency: totalReach > 0 ? (totalImpressions / totalReach) : 0,
    impressions: totalImpressions,
    spend: totalSpend,
    reach: totalReach
  };
}

/**
 * Вычисляет % изменение между двумя периодами
 */
function calculateTrend(prevDays, currentDays) {
  const prev = aggregateMetrics(prevDays);
  const current = aggregateMetrics(currentDays);
  
  if (!prev || !current) {
    return { cpm_change_pct: 0, ctr_change_pct: 0 };
  }
  
  const cpmChange = prev.cpm > 0 
    ? ((current.cpm - prev.cpm) / prev.cpm * 100)
    : 0;
  
  const ctrChange = prev.ctr > 0
    ? ((current.ctr - prev.ctr) / prev.ctr * 100)
    : 0;
  
  return {
    cpm_change_pct: parseFloat(cpmChange.toFixed(1)),
    ctr_change_pct: parseFloat(ctrChange.toFixed(1))
  };
}

/**
 * DEPRECATED: Fetch insights для креатива за указанный период
 * 
 * НОВЫЙ МЕТОД: Сначала находим все ads использующие этот creative,
 * затем получаем insights для каждого ad и агрегируем результаты
 * 
 * ЗАМЕЧАНИЕ: Теперь используем getCreativeMetricsFromDB() вместо этой функции
 */
/* DEPRECATED - используется getCreativeMetricsFromDB
async function fetchCreativeInsights(adAccountId, accessToken, fbCreativeId, options = {}) {
  const normalizedId = normalizeAdAccountId(adAccountId);
  
  // ============================================
  // ШАГ 1: Найти все ads использующие этот creative
  // ============================================
  const adsUrl = `https://graph.facebook.com/${FB_API_VERSION}/${normalizedId}/ads`;
  const adsParams = new URLSearchParams({
    fields: 'id,name,status,effective_status,creative{id}',
    limit: '500',
    access_token: accessToken
  });
  
  const adsRes = await fetch(`${adsUrl}?${adsParams.toString()}`);
  if (!adsRes.ok) {
    const err = await adsRes.text();
    logger.error({ 
      where: 'fetchCreativeInsights',
      phase: 'fetch_ads',
      creative_id: fbCreativeId,
      status: adsRes.status,
      error: err
    });
    return null;
  }
  
  const adsJson = await adsRes.json();
  const allAds = adsJson.data || [];
  
  // Фильтруем ads с нашим creative_id
  const adsWithCreative = allAds.filter(ad => ad.creative?.id === fbCreativeId);
  
  logger.info({ 
    where: 'fetchCreativeInsights',
    phase: 'ads_found',
    creative_id: fbCreativeId,
    total_ads: allAds.length,
    ads_with_creative: adsWithCreative.length
  });
  
  if (adsWithCreative.length === 0) {
    logger.info({ 
      where: 'fetchCreativeInsights',
      creative_id: fbCreativeId,
      message: 'No ads found using this creative'
    });
    return null;
  }
  
  // ============================================
  // ШАГ 2: Получить insights для каждого ad
  // ============================================
  const datePreset = options.date_preset || 'last_30d';
  const allInsights = [];
  
  for (const ad of adsWithCreative) {
    const insightsUrl = `https://graph.facebook.com/${FB_API_VERSION}/${ad.id}/insights`;
    const insightsParams = new URLSearchParams({
      fields: 'ctr,cpm,cpp,cpc,frequency,impressions,spend,actions,reach',
      access_token: accessToken
    });
    
    if (options.date_preset) {
      insightsParams.set('date_preset', options.date_preset);
    } else if (options.time_range) {
      insightsParams.set('time_range', JSON.stringify(options.time_range));
    } else {
      insightsParams.set('date_preset', 'last_30d');
    }
    
    try {
      const insightsRes = await fetch(`${insightsUrl}?${insightsParams.toString()}`);
      if (insightsRes.ok) {
        const insightsJson = await insightsRes.json();
        if (insightsJson.data && insightsJson.data.length > 0) {
          allInsights.push(...insightsJson.data);
        }
      }
    } catch (error) {
      logger.warn({ 
        where: 'fetchCreativeInsights',
        ad_id: ad.id,
        error: error.message
      });
    }
  }
  
  // LOG: результаты
  logger.info({ 
    where: 'fetchCreativeInsights',
    phase: 'insights_fetched',
    creative_id: fbCreativeId,
    ads_checked: adsWithCreative.length,
    insights_records: allInsights.length,
    date_preset: datePreset
  });
  
  if (allInsights.length === 0) {
    return null;
  }
  
  const data = allInsights;
  
  // Агрегируем (если несколько ads с одним креативом)
  const totalImpressions = data.reduce((sum, d) => sum + (parseFloat(d.impressions) || 0), 0);
  const totalSpend = data.reduce((sum, d) => sum + (parseFloat(d.spend) || 0), 0);
  const totalReach = data.reduce((sum, d) => sum + (parseFloat(d.reach) || 0), 0);
  const avgCTR = data.reduce((sum, d) => sum + (parseFloat(d.ctr) || 0), 0) / data.length;
  const avgCPM = data.reduce((sum, d) => sum + (parseFloat(d.cpm) || 0), 0) / data.length;
  const avgFrequency = data.reduce((sum, d) => sum + (parseFloat(d.frequency) || 0), 0) / data.length;
  
  // CPL (cost per lead) - use extractLeads for consistent counting
  let totalLeads = 0;
  for (const d of data) {
    if (d.actions) {
      totalLeads += extractLeads(d.actions);
    }
  }
  
  const avgCPL = totalLeads > 0 ? totalSpend / totalLeads : null;
  
  return {
    impressions: totalImpressions,
    spend: totalSpend,
    reach: totalReach,
    avg_ctr: avgCTR,
    avg_cpm: avgCPM,
    avg_frequency: avgFrequency,
    total_leads: totalLeads,
    avg_cpl: avgCPL
  };
}

/**
 * Получить метрики креатива из creative_metrics_history
 * Агрегирует за последние N дней
 * @param {Object} supabase - Supabase client
 * @param {string} userAccountId - ID из user_accounts
 * @param {string} fbCreativeId - ID креатива Facebook
 * @param {number} days - Количество дней для агрегации (по умолчанию 30)
 * @param {string|null} accountId - UUID из ad_accounts.id для мультиаккаунтности (опционально)
 * @returns {Object|null} Метрики или null если данных нет (первый запуск)
 */
async function getCreativeMetricsFromDB(supabase, userAccountId, fbCreativeId, days = 30, accountId = null) {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - days);

  let query = supabase
    .from('creative_metrics_history')
    .select('*')
    .eq('user_account_id', userAccountId)
    .eq('creative_id', fbCreativeId)
    .eq('source', 'production')
    .gte('date', dateFrom.toISOString().split('T')[0]);

  // Фильтрация по рекламному аккаунту для мультиаккаунтного режима
  if (accountId) {
    query = query.eq('account_id', accountId);
  }

  const { data, error } = await query.order('date', { ascending: false });

  if (error) {
    logger.warn({
      error: error.message,
      creative_id: fbCreativeId,
      user_account_id: userAccountId,
      account_id: accountId
    }, 'Failed to fetch metrics from creative_metrics_history');
    return null;
  }
  
  if (!data || data.length === 0) {
    logger.info({ 
      creative_id: fbCreativeId,
      user_account_id: userAccountId,
      days
    }, 'No metrics found in creative_metrics_history - first run');
    return null; // Нет данных - первый запуск
  }
  
  // Агрегируем метрики за период
  const totalImpressions = data.reduce((sum, row) => sum + (row.impressions || 0), 0);
  const totalSpend = data.reduce((sum, row) => sum + (parseFloat(row.spend) || 0), 0);
  const totalReach = data.reduce((sum, row) => sum + (row.reach || 0), 0);
  const totalLeads = data.reduce((sum, row) => sum + (row.leads || 0), 0);
  const totalClicks = data.reduce((sum, row) => sum + (row.clicks || 0), 0);
  const totalLinkClicks = data.reduce((sum, row) => sum + (row.link_clicks || 0), 0);
  
  // Средние значения
  const avgCTR = data.reduce((sum, row) => sum + (parseFloat(row.ctr) || 0), 0) / data.length;
  const avgCPM = data.reduce((sum, row) => sum + (parseFloat(row.cpm) || 0), 0) / data.length;
  const avgFrequency = data.reduce((sum, row) => sum + (parseFloat(row.frequency) || 0), 0) / data.length;
  
  logger.info({ 
    creative_id: fbCreativeId,
    user_account_id: userAccountId,
    data_points: data.length,
    impressions: totalImpressions,
    leads: totalLeads
  }, 'Metrics loaded from creative_metrics_history');
  
  return {
    impressions: totalImpressions,
    spend: totalSpend,
    reach: totalReach,
    clicks: totalClicks,
    link_clicks: totalLinkClicks,
    total_leads: totalLeads,
    avg_cpl: totalLeads > 0 ? totalSpend / totalLeads : null,
    avg_ctr: avgCTR,
    avg_cpm: avgCPM,
    avg_frequency: avgFrequency,
    data_points: data.length,
    date_from: dateFrom.toISOString().split('T')[0],
    date_to: new Date().toISOString().split('T')[0]
  };
}

/**
 * Получить активные креативы пользователя из user_creatives
 */
async function getActiveCreatives(supabase, userAccountId, accountId = null) {
  // ========================================
  // ФИЛЬТРУЕМ КРЕАТИВЫ ПО АКТИВНЫМ НАПРАВЛЕНИЯМ
  // ========================================
  // Получаем креативы с информацией о направлении (только из активных направлений)
  let query = supabase
    .from('user_creatives')
    .select(`
      id, 
      title, 
      fb_video_id, 
      fb_creative_id_whatsapp, 
      fb_creative_id_instagram_traffic, 
      fb_creative_id_site_leads, 
      is_active, 
      status, 
      created_at,
      direction_id,
      account_directions!inner(is_active)
    `)
    .eq('user_id', userAccountId)
    .eq('is_active', true)
    .eq('status', 'ready')
    .eq('account_directions.is_active', true); // ТОЛЬКО из активных направлений!

  if (accountId) {
    query = query.eq('account_id', accountId).eq('account_directions.account_id', accountId);
  } else {
    query = query.is('account_id', null).is('account_directions.account_id', null);
  }

  const { data, error } = await query;
  
  if (error) throw new Error(`Failed to get active creatives: ${error.message}`);
  
  // Также включаем креативы БЕЗ направления (legacy)
  let legacyQuery = supabase
    .from('user_creatives')
    .select('id, title, fb_video_id, fb_creative_id_whatsapp, fb_creative_id_instagram_traffic, fb_creative_id_site_leads, fb_creative_id_lead_forms, is_active, status, created_at, direction_id')
    .eq('user_id', userAccountId)
    .eq('is_active', true)
    .eq('status', 'ready')
    .is('direction_id', null); // Креативы без направления (legacy)

  if (accountId) {
    legacyQuery = legacyQuery.eq('account_id', accountId);
  } else {
    legacyQuery = legacyQuery.is('account_id', null);
  }

  const { data: legacyCreatives, error: legacyError } = await legacyQuery;
  
  if (legacyError) throw new Error(`Failed to get legacy creatives: ${legacyError.message}`);
  
  return [...(data || []), ...(legacyCreatives || [])];
}

/**
 * Получить все creative_id из активных ads в Facebook
 */
async function getActiveCreativeIds(adAccountId, accessToken) {
  const fields = 'id,name,status,effective_status,adset_id,creative{id}';
  const url = `https://graph.facebook.com/${FB_API_VERSION}/${normalizeAdAccountId(adAccountId)}/ads`;
  
  try {
    const response = await fetch(`${url}?access_token=${accessToken}&fields=${fields}&limit=500`);
    const result = await response.json();
    
    if (!response.ok || result.error) {
      throw new Error(result.error?.message || 'Failed to fetch ads');
    }
    
    const activeAds = (result.data || []).filter(ad => 
      ad.status === 'ACTIVE' && ad.effective_status === 'ACTIVE'
    );
    
    const creativeIdsSet = new Set();
    const creativeToAdsMap = new Map();
    
    for (const ad of activeAds) {
      const creativeId = ad.creative?.id;
      if (!creativeId) continue;
      
      creativeIdsSet.add(creativeId);
      
      if (!creativeToAdsMap.has(creativeId)) {
        creativeToAdsMap.set(creativeId, []);
      }
      
      creativeToAdsMap.get(creativeId).push({
        ad_id: ad.id,
        ad_name: ad.name,
        adset_id: ad.adset_id
      });
    }
    
    return { creativeIdsSet, creativeToAdsMap };
  } catch (error) {
    logger.error({ err: error, message: error.message }, 'Failed to fetch active creative IDs');
    return { creativeIdsSet: new Set(), creativeToAdsMap: new Map() };
  }
}

/**
 * Опционально: сохранить snapshot метрик для аудита
 * @param {Object} supabase - Supabase client
 * @param {string} userAccountId - ID пользователя
 * @param {Array} adsets - массив adsets с метриками
 * @param {string|null} accountUUID - UUID рекламного аккаунта (для мультиаккаунтности), NULL для legacy
 */
async function saveMetricsSnapshot(supabase, userAccountId, adsets, accountUUID = null) {
  if (!adsets || !adsets.length) return;

  const today = new Date().toISOString().split('T')[0];

  const records = adsets.map(a => ({
    user_account_id: userAccountId,
    account_id: accountUUID || null,  // UUID для мультиаккаунтности, NULL для legacy
    date: today,
    adset_id: a.adset_id,
    campaign_id: a.campaign_id,
    impressions: parseInt(a.metrics_last_7d?.impressions || 0),
    spend: parseFloat(a.metrics_last_7d?.spend || 0),
    ctr: parseFloat(a.metrics_last_7d?.ctr || 0),
    cpm: parseFloat(a.metrics_last_7d?.cpm || 0),
    frequency: parseFloat(a.metrics_last_7d?.frequency || 0),
    quality_ranking: a.diagnostics?.quality_ranking,
    engagement_rate_ranking: a.diagnostics?.engagement_rate_ranking,
    conversion_rate_ranking: a.diagnostics?.conversion_rate_ranking
  }));

  // Insert (ignore duplicates)
  await supabase
    .from('creative_metrics_history')
    .upsert(records, { onConflict: 'user_account_id,adset_id,date', ignoreDuplicates: true });
}

/**
 * Сохранить метрики креативов за вчерашний день в creative_metrics_history
 *
 * Получает метрики на уровне Ad (не AdSet) для каждого креатива
 * Использует ad_creative_mapping для точного мэтчинга
 * Собирает инкрементальные данные за вчерашний день
 *
 * @param {Object} supabase - Supabase client
 * @param {string} userAccountId - ID пользователя
 * @param {Array} readyCreatives - массив креативов
 * @param {string} adAccountId - Facebook Ad Account ID (act_xxx)
 * @param {string} accessToken - Facebook Access Token
 * @param {string|null} accountUUID - UUID рекламного аккаунта (для мультиаккаунтности), NULL для legacy
 */
async function saveCreativeMetricsToHistory(supabase, userAccountId, readyCreatives, adAccountId, accessToken, accountUUID = null) {
  if (!readyCreatives || !readyCreatives.length) return;
  
  // Вчерашний день (метрики собираются на следующий день после показов)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  const records = [];
  
  logger.info({ 
    where: 'saveCreativeMetricsToHistory',
    creatives_count: readyCreatives.length,
    date: yesterdayStr
  }, 'Starting to save creative metrics to history');

  for (const creative of readyCreatives) {
    try {
      // Получить список ads через ad_creative_mapping
      const { data: mappings, error } = await supabase
        .from('ad_creative_mapping')
        .select('ad_id, adset_id, campaign_id, fb_creative_id')
        .eq('user_creative_id', creative.user_creative_id);

      if (error) {
        logger.warn({ 
          where: 'saveCreativeMetricsToHistory',
          creative_id: creative.user_creative_id,
          error: error.message 
        }, 'Failed to fetch ad mappings');
        continue;
      }

      if (!mappings || mappings.length === 0) {
        logger.debug({ 
          where: 'saveCreativeMetricsToHistory',
          creative_id: creative.user_creative_id 
        }, 'No ad mappings found for creative');
        continue;
      }

      logger.debug({ 
        where: 'saveCreativeMetricsToHistory',
        creative_id: creative.user_creative_id,
        ads_count: mappings.length 
      }, 'Found ad mappings');

      // Получить метрики для каждого ad за вчерашний день
      for (const mapping of mappings) {
        try {
          const insights = await fetchAdInsights(adAccountId, accessToken, mapping.ad_id, {
            time_range: {
              since: yesterdayStr,
              until: yesterdayStr
            }
          });
          
          if (!insights) {
            logger.debug({ 
              where: 'saveCreativeMetricsToHistory',
              ad_id: mapping.ad_id,
              date: yesterdayStr
            }, 'No insights for ad');
            continue;
          }

          // Пропускаем если нет показов (ad не показывался вчера)
          const impressions = parseInt(insights.impressions || 0);
          if (impressions === 0) {
            logger.debug({ 
              where: 'saveCreativeMetricsToHistory',
              ad_id: mapping.ad_id,
              date: yesterdayStr
            }, 'No impressions, skipping');
            continue;
          }

          // Извлекаем метрики
          const leads = extractLeads(insights.actions);
          const linkClicks = extractLinkClicks(insights.actions);
          const spend = parseFloat(insights.spend || 0);
          const videoMetrics = extractVideoMetrics(insights);
          
          // Вычисляем CPL (если есть лиды)
          const cpl = leads > 0 ? (spend / leads) : null;

          records.push({
            user_account_id: userAccountId,
            account_id: accountUUID || null,  // UUID для мультиаккаунтности, NULL для legacy
            // user_creative_id заполнится автоматически через триггер на основе ad_id
            date: yesterdayStr,  // Вчерашний день
            ad_id: mapping.ad_id,
            creative_id: mapping.fb_creative_id,
            adset_id: mapping.adset_id,
            campaign_id: mapping.campaign_id,

            // Абсолютные метрики
            impressions: impressions,
            reach: parseInt(insights.reach || 0),
            spend: spend,
            clicks: parseInt(insights.clicks || 0),
            link_clicks: linkClicks,
            leads: leads,

            // Вычисляемые метрики (сохраняем сразу)
            ctr: parseFloat(insights.ctr || 0),
            cpm: parseFloat(insights.cpm || 0),
            cpl: cpl,
            frequency: parseFloat(insights.frequency || 0),

            // Видео метрики
            video_views: videoMetrics.video_views,
            video_views_25_percent: videoMetrics.video_views_25_percent,
            video_views_50_percent: videoMetrics.video_views_50_percent,
            video_views_75_percent: videoMetrics.video_views_75_percent,
            video_views_95_percent: videoMetrics.video_views_95_percent,
            video_avg_watch_time_sec: videoMetrics.video_avg_watch_time_sec,

            // Diagnostics (на уровне ad)
            quality_ranking: insights.quality_ranking || null,
            engagement_rate_ranking: insights.engagement_rate_ranking || null,
            conversion_rate_ranking: insights.conversion_rate_ranking || null,

            source: 'production'
          });

          logger.debug({ 
            where: 'saveCreativeMetricsToHistory',
            ad_id: mapping.ad_id,
            date: yesterdayStr,
            impressions: impressions,
            leads: leads 
          }, 'Collected metrics for ad');

        } catch (err) {
          logger.warn({ 
            where: 'saveCreativeMetricsToHistory',
            ad_id: mapping.ad_id,
            error: err.message 
          }, 'Failed to fetch ad insights');
        }
      }
    } catch (err) {
      logger.warn({ 
        where: 'saveCreativeMetricsToHistory',
        creative_id: creative.user_creative_id,
        error: err.message 
      }, 'Failed to process creative');
    }
  }

  // Сохраняем все записи одним batch запросом
  if (records.length > 0) {
    try {
      const { error } = await supabase
        .from('creative_metrics_history')
        .upsert(records, { 
          onConflict: 'user_account_id,ad_id,date',
          ignoreDuplicates: false  // Обновляем если уже есть (на случай повторного запуска)
        });

      if (error) {
        logger.error({ 
          where: 'saveCreativeMetricsToHistory',
          error: error.message,
          records_count: records.length 
        }, 'Failed to save metrics to history');
      } else {
        logger.info({ 
          where: 'saveCreativeMetricsToHistory',
          saved_count: records.length,
          date: yesterdayStr
        }, 'Successfully saved creative metrics to history');
      }
    } catch (err) {
      logger.error({ 
        where: 'saveCreativeMetricsToHistory',
        error: err.message,
        records_count: records.length 
      }, 'Error saving metrics to history');
    }
  } else {
    logger.info({ 
      where: 'saveCreativeMetricsToHistory',
      date: yesterdayStr
    }, 'No metrics to save (no ads with impressions yesterday)');
  }
}

/**
 * Рассчитывает risk score креатива с учетом ROI
 * 
 * @param {Object} performance - метрики из Facebook API (cpl, ctr, cpm)
 * @param {Object} roiData - данные о реальной окупаемости
 * @param {number} targetCPL - целевой CPL пользователя (в центах)
 * @returns {number} risk_score (0-100)
 */
function calculateRiskScoreWithROI(performance, roiData, targetCPL = 200) {
  let baseScore = 50; // Начальный нейтральный score
  
  // Фактор 1: Facebook метрики (вес 60%)
  if (performance) {
    const cpl = performance.cpl || 0; // в центах
    const ctr = performance.ctr || 0; // в процентах
    const cpm = performance.cpm || 0; // в центах
    
    // CPL выше target -> повышаем risk
    if (cpl > targetCPL * 1.3) {
      baseScore += 20;
    } else if (cpl > targetCPL) {
      baseScore += 10;
    } else if (cpl < targetCPL * 0.7) {
      baseScore -= 15;
    }
    
    // Низкий CTR -> риск
    if (ctr < 0.8) {
      baseScore += 15;
    } else if (ctr > 2.0) {
      baseScore -= 10;
    }
    
    // Высокий CPM -> риск (конвертируем из центов в доллары)
    const cpmDollars = cpm / 100;
    if (cpmDollars > 8) {
      baseScore += 10;
    } else if (cpmDollars < 5) {
      baseScore -= 5;
    }
  }
  
  // Фактор 2: ROI (вес 40% - важнее метрик!)
  // Учитываем ROI только если есть минимум 2 конверсии для статистической значимости
  if (roiData && roiData.conversions >= 2) {
    const roi = roiData.roi;
    
    if (roi > 100) {
      // Отличная окупаемость -> сильно снижаем риск
      baseScore -= 25;
    } else if (roi > 50) {
      // Хорошая окупаемость
      baseScore -= 15;
    } else if (roi > 0) {
      // Положительный ROI
      baseScore -= 5;
    } else if (roi < -50) {
      // Сильный убыток -> высокий риск
      baseScore += 30;
    } else if (roi < 0) {
      // Убыток
      baseScore += 15;
    }
  }
  // Если нет ROI данных или мало конверсий (новый креатив) -> используем только Facebook метрики
  
  // Ограничиваем диапазон 0-100
  return Math.max(0, Math.min(100, Math.round(baseScore)));
}

/**
 * ОСНОВНАЯ ФУНКЦИЯ: Запуск Scoring Agent
 * @param {Object} userAccount - данные пользователя из user_accounts
 * @param {Object} options - опции
 * @param {Object} options.supabase - Supabase client
 * @param {Object} options.logger - logger
 * @param {string|null} options.accountUUID - UUID рекламного аккаунта (для мультиаккаунтности), NULL для legacy
 */
export async function runScoringAgent(userAccount, options = {}) {
  const startTime = Date.now();
  const { ad_account_id, access_token, id: userAccountId, username } = userAccount;

  const supabase = options.supabase || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE
  );

  const logger = options.logger || console;

  // UUID рекламного аккаунта для мультиаккаунтности (NULL для legacy)
  const accountUUID = options.accountUUID || null;

  logger.info({ where: 'scoring_agent', phase: 'start', userId: userAccountId, username, accountUUID });
  
  try {
    // ========================================
    // ЧАСТЬ 1: АКТИВНЫЕ ADSETS (ОСНОВНОЕ!)
    // ========================================
    
    logger.info({ where: 'scoring_agent', phase: 'fetching_adsets' });

    // Сначала получаем adsets config (для переиспользования в brain_run) - делаем ПЕРВЫМ запросом
    // чтобы избежать rate limit от параллельных запросов
    const adsetsConfig = await fetchAdsetsConfig(ad_account_id, access_token, logger);

    // Fetch данные: daily breakdown (для трендов) + агрегированные actions + diagnostics + objectives
    const [dailyData, actionsData, diagnostics, campaignObjectives] = await Promise.all([
      fetchAdsetsDaily(ad_account_id, access_token, 14),
      fetchAdsetsActions(ad_account_id, access_token, 'last_7d'),
      fetchAdsetDiagnostics(ad_account_id, access_token),
      getAdsetsObjectives(supabase, userAccountId, accountUUID)
    ]);

    // Группируем по adset_id и вычисляем метрики для разных периодов
    const adsetMetrics = calculateMultiPeriodTrends(dailyData, actionsData, campaignObjectives);
    
    logger.info({ 
      where: 'scoring_agent', 
      phase: 'adsets_fetched',
      daily_rows: dailyData.length,
      actions_rows: actionsData.length,
      unique_adsets: adsetMetrics.length,
      diagnostics: diagnostics.length
    });
    
    // Объединяем данные с diagnostics
    const adsetsWithTrends = adsetMetrics.map(adset => {
      const diag = diagnostics.find(d => d.adset_id === adset.adset_id);

      // Формируем базовый объект
      const result = {
        adset_id: adset.adset_id,
        adset_name: adset.adset_name,
        campaign_id: adset.campaign_id,
        campaign_name: adset.campaign_name,
        objective: adset.objective, // ✅ ДОБАВЛЕНО
        metrics_last_7d: adset.metrics_last_7d,
        trends: {
          // Короткий тренд (1 день): вчера vs позавчера
          d1: {
            cpm_change_pct: adset.trends.d1.cpm_change_pct,
            ctr_change_pct: adset.trends.d1.ctr_change_pct
          },
          // Средний тренд (3 дня): последние 3 vs предыдущие 3
          d3: {
            cpm_change_pct: adset.trends.d3.cpm_change_pct,
            ctr_change_pct: adset.trends.d3.ctr_change_pct
          },
          // Долгий тренд (7 дней): последние 7 vs предыдущие 7
          d7: {
            cpm_change_pct: adset.trends.d7.cpm_change_pct,
            ctr_change_pct: adset.trends.d7.ctr_change_pct
          }
        },
        diagnostics: diag ? {
          quality_ranking: diag.quality_ranking,
          engagement_rate_ranking: diag.engagement_rate_ranking,
          conversion_rate_ranking: diag.conversion_rate_ranking,
          ads_count: diag.ads_count
        } : null,
        data_valid: adset.data_valid,
        data_validity_reason: adset.data_validity_reason
      };

      // Условное добавление метрик в зависимости от objective
      if (adset.whatsapp_metrics) {
        result.whatsapp_metrics = adset.whatsapp_metrics;
      }
      if (adset.site_leads_metrics) {
        result.site_leads_metrics = adset.site_leads_metrics;
      }
      if (adset.instagram_metrics) {
        result.instagram_metrics = adset.instagram_metrics;
      }

      return result;
    });
    
    // Опционально: сохраняем snapshot для аудита
    if (options.saveSnapshot !== false) {
      await saveMetricsSnapshot(supabase, userAccountId, adsetsWithTrends, accountUUID);
    }
    
    // ========================================
    // ЧАСТЬ 2: ГОТОВЫЕ КРЕАТИВЫ
    // ========================================
    
    logger.info({ where: 'scoring_agent', phase: 'fetching_creatives' });
    
    const userCreatives = await getActiveCreatives(supabase, userAccountId, accountUUID);
    
    // Получаем список creative_id которые используются в активных ads
    const activeCreativeIds = await getActiveCreativeIds(ad_account_id, access_token);
    
    logger.info({ 
      where: 'scoring_agent', 
      phase: 'creatives_fetched', 
      total_creatives: userCreatives.length,
      active_in_ads: activeCreativeIds.creativeIdsSet.size
    });
    
    // ========================================
    // ЧАСТЬ 2.5: ЗАГРУЗКА ROI ДАННЫХ
    // ========================================
    
    logger.info({ where: 'scoring_agent', phase: 'fetching_roi' });
    
    let creativeROIMap = new Map();
    try {
      const { calculateCreativeROI } = await import('../../agent-service/src/lib/roiCalculator.js');
      creativeROIMap = await calculateCreativeROI(userAccountId, null, 30, supabase);
      
      logger.info({ 
        where: 'scoring_agent', 
        phase: 'roi_loaded',
        creatives_with_roi: creativeROIMap.size
      });
    } catch (error) {
      logger.warn({
        where: 'scoring_agent',
        phase: 'roi_load_failed',
        error: String(error)
      }, 'Failed to load ROI data, continuing without it');
    }
    
    const readyCreatives = [];
    
    for (const uc of userCreatives) {
      const creatives = [];
      
      // WhatsApp (MESSAGES)
      if (uc.fb_creative_id_whatsapp) {
        const stats = await getCreativeMetricsFromDB(
          supabase,
          userAccountId,
          uc.fb_creative_id_whatsapp,
          30,
          accountUUID // UUID из ad_accounts.id для мультиаккаунтности
        );

        creatives.push({
          objective: 'MESSAGES',
          fb_creative_id: uc.fb_creative_id_whatsapp,
          performance: stats,
          has_data: stats !== null  // НОВОЕ: флаг наличия данных
        });
      }

      // Site Leads (OUTCOME_LEADS)
      if (uc.fb_creative_id_site_leads) {
        const stats = await getCreativeMetricsFromDB(
          supabase,
          userAccountId,
          uc.fb_creative_id_site_leads,
          30,
          accountUUID // UUID из ad_accounts.id для мультиаккаунтности
        );

        creatives.push({
          objective: 'OUTCOME_LEADS',
          fb_creative_id: uc.fb_creative_id_site_leads,
          performance: stats,
          has_data: stats !== null  // НОВОЕ: флаг наличия данных
        });
      }

      // Instagram Traffic (OUTCOME_TRAFFIC)
      if (uc.fb_creative_id_instagram_traffic) {
        const stats = await getCreativeMetricsFromDB(
          supabase,
          userAccountId,
          uc.fb_creative_id_instagram_traffic,
          30,
          accountUUID // UUID из ad_accounts.id для мультиаккаунтности
        );

        creatives.push({
          objective: 'OUTCOME_TRAFFIC',
          fb_creative_id: uc.fb_creative_id_instagram_traffic,
          performance: stats,
          has_data: stats !== null  // НОВОЕ: флаг наличия данных
        });
      }
      
      if (creatives.length > 0) {
        // Добавляем ROI данные если есть
        const roiData = creativeROIMap.get(uc.id) || null;
        
        // Рассчитываем risk score с учетом ROI только если есть данные
        // Берем первый креатив для расчета (обычно это основной objective)
        const primaryCreative = creatives[0];
        const performance = primaryCreative?.performance || null;
        const targetCPL = 200; // Целевой CPL в центах (можно получить из настроек пользователя)
        const riskScore = performance ? calculateRiskScoreWithROI(performance, roiData, targetCPL) : null;
        
        readyCreatives.push({
          name: uc.title,
          user_creative_id: uc.id,
          id: uc.id, // Добавляем для совместимости
          title: uc.title,
          direction_id: uc.direction_id,
          created_at: uc.created_at,
          fb_creative_id_whatsapp: uc.fb_creative_id_whatsapp,
          fb_creative_id_instagram_traffic: uc.fb_creative_id_instagram_traffic,
          fb_creative_id_site_leads: uc.fb_creative_id_site_leads,
          creatives: creatives,
          roi_data: roiData, // { revenue, spend, roi, conversions, leads }
          risk_score: riskScore, // 0-100, с учетом ROI или null если нет данных
          has_data: creatives.some(c => c.has_data) // Есть ли хоть один креатив с данными
        });
      }
    }
    
    logger.info({ 
      where: 'scoring_agent', 
      phase: 'creatives_processed',
      total: readyCreatives.length,
      with_data: readyCreatives.filter(c => c.has_data).length,
      without_data: readyCreatives.filter(c => !c.has_data).length,
      with_roi: readyCreatives.filter(c => c.roi_data !== null).length
    });
    
    // ========================================
    // ЧАСТЬ 2.6: СОХРАНЕНИЕ МЕТРИК В ИСТОРИЮ
    // ========================================
    
    logger.info({ 
      where: 'scoring_agent', 
      phase: 'saving_metrics_to_history',
      creatives_count: readyCreatives.length 
    });
    
    // Сохраняем метрики за вчерашний день для всех активных ads
    try {
      await saveCreativeMetricsToHistory(
        supabase,
        userAccountId,
        readyCreatives,
        ad_account_id,
        access_token,
        accountUUID
      );
      
      logger.info({
        where: 'scoring_agent',
        phase: 'metrics_saved'
      });

      // Заполнить direction_metrics_rollup (агрегация по направлениям)
      try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        const { data: rollupResult, error: rollupError } = await supabase.rpc(
          'upsert_direction_metrics_rollup',
          {
            p_user_account_id: userAccountId,
            p_account_id: accountUUID,
            p_day: yesterdayStr
          }
        );

        if (rollupError) {
          logger.warn({
            where: 'scoring_agent',
            phase: 'direction_rollup_failed',
            error: rollupError.message
          }, 'Failed to update direction metrics rollup');
        } else {
          logger.info({
            where: 'scoring_agent',
            phase: 'direction_rollup_updated',
            rows_affected: rollupResult
          });
        }
      } catch (rollupErr) {
        logger.warn({
          where: 'scoring_agent',
          phase: 'direction_rollup_error',
          error: String(rollupErr)
        }, 'Error updating direction metrics rollup');
      }

    } catch (error) {
      // Не критическая ошибка - продолжаем работу даже если не удалось сохранить метрики
      logger.error({
        where: 'scoring_agent',
        phase: 'metrics_save_failed',
        error: String(error)
      }, 'Failed to save metrics to history, continuing...');
    }

    // ========================================
    // ОПРЕДЕЛЯЕМ НЕИСПОЛЬЗОВАННЫЕ КРЕАТИВЫ
    // ========================================
    // Креативы попадают в unused_creatives если:
    // 1. Не используются в активных ads (isUnused = true)
    // 2. Или у них нет метрик в БД (первый запуск, has_data = false)
    
    const unusedCreatives = [];
    
    for (const uc of userCreatives) {
      // Проверяем все fb_creative_id этого креатива
      const creativeIds = [
        uc.fb_creative_id_whatsapp,
        uc.fb_creative_id_instagram_traffic,
        uc.fb_creative_id_site_leads
      ].filter(id => id);
      
      // Проверяем есть ли этот креатив в ready_creatives и есть ли у него данные
      const readyCreative = readyCreatives.find(rc => rc.id === uc.id);
      const hasData = readyCreative?.has_data || false;
      
      // Если НИ ОДИН из creative_id не используется в активных ads
      const isUnused = creativeIds.length > 0 && 
                       !creativeIds.some(id => activeCreativeIds.creativeIdsSet.has(id));
      
      // Креатив unused если он не используется ИЛИ у него нет данных (первый запуск)
      if (isUnused || !hasData) {
        // Определяем рекомендуемый objective на основе наличия креативов
        let recommendedObjective = 'WhatsApp'; // По умолчанию
        if (uc.fb_creative_id_whatsapp) recommendedObjective = 'WhatsApp';
        else if (uc.fb_creative_id_instagram_traffic) recommendedObjective = 'Instagram';
        else if (uc.fb_creative_id_site_leads) recommendedObjective = 'SiteLeads';
        
        unusedCreatives.push({
          id: uc.id,
          title: uc.title,
          fb_creative_id_whatsapp: uc.fb_creative_id_whatsapp,
          fb_creative_id_instagram_traffic: uc.fb_creative_id_instagram_traffic,
          fb_creative_id_site_leads: uc.fb_creative_id_site_leads,
          recommended_objective: recommendedObjective,
          created_at: uc.created_at,
          direction_id: uc.direction_id,  // ВАЖНО: привязка к направлению
          first_run: !hasData,  // НОВОЕ: флаг первого запуска (нет метрик в БД)
          not_in_active_ads: isUnused  // Не используется в активных ads
        });
      }
    }
    
    logger.info({ 
      where: 'scoring_agent', 
      phase: 'unused_creatives_identified',
      count: unusedCreatives.length,
      first_run_count: unusedCreatives.filter(c => c.first_run).length,
      not_in_active_ads_count: unusedCreatives.filter(c => c.not_in_active_ads).length
    });
    
    // ========================================
    // ЧАСТЬ 3: ФОРМИРОВАНИЕ RAW OUTPUT (БЕЗ LLM!)
    // ========================================
    
    // Разделяем ready_creatives на те, что с данными и без данных
    const creativesWithData = readyCreatives.filter(c => c.has_data);
    const creativesWithoutData = readyCreatives.filter(c => !c.has_data);
    
    // Возвращаем только RAW данные, без LLM анализа
    const scoringRawData = {
      adsets: adsetsWithTrends,
      ready_creatives: creativesWithData,  // Только креативы с метриками
      unused_creatives: unusedCreatives,  // Включает креативы без метрик (first_run: true)
      adsets_config: adsetsConfig  // Конфигурация adsets для brain_run (избегаем повторный запрос и rate limit)
    };
    
    logger.info({ 
      where: 'scoring_agent', 
      phase: 'data_collected',
      adsets_count: adsetsWithTrends.length,
      ready_creatives_count: creativesWithData.length,
      unused_creatives_count: unusedCreatives.length,
      creatives_without_data_count: creativesWithoutData.length
    });
    
    // ========================================
    // ЧАСТЬ 4: СОХРАНЕНИЕ РЕЗУЛЬТАТОВ (опционально)
    // ========================================
    
    const duration = Date.now() - startTime;
    
    // Сохраняем факт сбора данных для аудита
    if (options.saveExecution !== false) {
      await supabase.from('scoring_executions').insert({
        user_account_id: userAccountId,
        account_id: accountUUID || null,  // UUID для мультиаккаунтности, NULL для legacy
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: duration,
        status: 'success',
        items_analyzed: adsetsWithTrends.length,
        creatives_analyzed: readyCreatives.length,
        scoring_output: scoringRawData, // raw данные
        llm_used: false, // больше не используем LLM в scoring agent
        llm_model: null
      });
    }
    
    logger.info({
      where: 'scoring_agent',
      phase: 'complete',
      userId: userAccountId,
      duration,
      stats: {
        adsets: adsetsWithTrends.length,
        creatives: readyCreatives.length
      }
    });
    
    return scoringRawData;
    
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error({
      where: 'scoring_agent',
      phase: 'error',
      userId: userAccountId,
      username,
      duration,
      error: String(error),
      stack: error.stack
    });

    // Логируем ошибку в централизованную систему
    logScoringError(userAccountId, error, {
      username,
      accountUUID,
      duration,
      phase: 'scoring_agent'
    }).catch(() => {});

    await supabase.from('scoring_executions').insert({
      user_account_id: userAccountId,
      account_id: accountUUID || null,  // UUID для мультиаккаунтности, NULL для legacy
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      status: 'error',
      error_message: String(error),
      items_analyzed: 0,
      creatives_analyzed: 0,
      llm_model: process.env.BRAIN_MODEL || 'gpt-5'
    });

    throw error;
  }
}

/**
 * Interactive Brain Mode (ENHANCED)
 *
 * Собирает данные с фокусом на TODAY и генерирует proposals без выполнения.
 * Использует ту же логику Health Score что и основной Brain Agent.
 * Proposals возвращаются для подтверждения пользователем через Chat Assistant.
 *
 * КЛЮЧЕВЫЕ ОТЛИЧИЯ ОТ АВТОМАТИЧЕСКОГО BRAIN:
 * 1. ФОКУС НА СЕГОДНЯ — анализирует realtime данные за сегодня
 * 2. ИСПОЛЬЗУЕТ ПОСЛЕДНИЙ ОТЧЁТ BRAIN — берёт исторические данные из scoring_executions
 * 3. TODAY-КОМПЕНСАЦИЯ — если сегодня лучше вчера, смягчает негативные решения
 * 4. НЕ ВЫПОЛНЯЕТ — только предлагает, ждёт подтверждения пользователя
 *
 * @param {Object} userAccount - данные пользователя (ad_account_id, access_token, id)
 * @param {Object} options - опции
 * @param {string} options.directionId - UUID направления (опционально, для фильтрации)
 * @param {Object} options.supabase - Supabase client
 * @param {Object} options.logger - logger instance
 * @returns {Object} - { proposals: [...], context: {...}, summary: {...} }
 */
export async function runInteractiveBrain(userAccount, options = {}) {
  const startTime = Date.now();
  const { ad_account_id, access_token, id: userAccountId } = userAccount;

  const supabase = options.supabase || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE
  );

  const log = options.logger || logger;
  const directionId = options.directionId || null;

  log.info({ where: 'interactive_brain', phase: 'start', userId: userAccountId, directionId });

  try {
    // ========================================
    // ЧАСТЬ 1: СБОР ДАННЫХ ЗА СЕГОДНЯ (REAL-TIME)
    // ========================================

    log.info({ where: 'interactive_brain', phase: 'fetching_today_data' });

    // Получаем данные из FB API:
    // - today/yesterday для текущих метрик
    // - dailyData + actionsData для исторических метрик (как в основном runScoringAgent)
    log.info({
      where: 'interactive_brain',
      phase: 'fetching_fb_data',
      ad_account_id,
      message: 'Запрашиваем today, yesterday, daily (14d), actions (7d)'
    });

    let todayData, yesterdayData, dailyData, actionsData, adsetsConfigData;
    try {
      [todayData, yesterdayData, dailyData, actionsData, adsetsConfigData] = await Promise.all([
        fetchAdsets(ad_account_id, access_token, 'today'),
        fetchAdsets(ad_account_id, access_token, 'yesterday'),
        fetchAdsetsDaily(ad_account_id, access_token, 14),  // 14 дней для трендов
        fetchAdsetsActions(ad_account_id, access_token, 'last_7d'),  // actions за 7 дней
        fetchAdsetsConfig(ad_account_id, access_token, log)  // конфиг с бюджетами
      ]);
    } catch (fbError) {
      log.error({
        where: 'interactive_brain',
        phase: 'fb_api_error',
        error: String(fbError),
        message: 'Ошибка при запросе данных из Facebook API'
      });
      throw new Error(`FB API fetch failed: ${fbError.message}`);
    }

    // Валидация ответов FB API
    if (!Array.isArray(todayData)) {
      log.warn({ where: 'interactive_brain', phase: 'validation', message: 'todayData не массив, заменяем на []' });
      todayData = [];
    }
    if (!Array.isArray(yesterdayData)) {
      log.warn({ where: 'interactive_brain', phase: 'validation', message: 'yesterdayData не массив, заменяем на []' });
      yesterdayData = [];
    }
    if (!Array.isArray(dailyData)) {
      log.warn({ where: 'interactive_brain', phase: 'validation', message: 'dailyData не массив, заменяем на []' });
      dailyData = [];
    }
    if (!Array.isArray(actionsData)) {
      log.warn({ where: 'interactive_brain', phase: 'validation', message: 'actionsData не массив, заменяем на []' });
      actionsData = [];
    }

    log.info({
      where: 'interactive_brain',
      phase: 'fb_data_received',
      today_rows: todayData.length,
      yesterday_rows: yesterdayData.length,
      daily_rows: dailyData.length,
      actions_rows: actionsData.length,
      today_adset_ids: todayData.slice(0, 5).map(a => a.adset_id),
      message: `Получено ${todayData.length} адсетов today, ${yesterdayData.length} yesterday`
    });

    // Проверка на пустые данные
    if (todayData.length === 0) {
      log.warn({
        where: 'interactive_brain',
        phase: 'no_data',
        message: 'Нет активных адсетов за сегодня. Возможно, все кампании на паузе или нет расхода.'
      });
    }

    // Рассчитываем метрики как в основном агенте (для external кампаний)
    // campaignObjectives = пустая Map, т.к. для external нет directions
    const adsetMetricsFromFB = calculateMultiPeriodTrends(dailyData, actionsData, new Map());

    // Создаём Map для быстрого доступа к рассчитанным метрикам по adset_id
    const fbMetricsByAdset = new Map();
    for (const adset of adsetMetricsFromFB) {
      fbMetricsByAdset.set(adset.adset_id, adset);
    }

    // Создаём Map для бюджетов адсетов (id → {daily_budget, status})
    const adsetBudgets = new Map();
    if (adsetsConfigData?.data && Array.isArray(adsetsConfigData.data)) {
      for (const adset of adsetsConfigData.data) {
        adsetBudgets.set(adset.id, {
          daily_budget_cents: adset.daily_budget ? parseInt(adset.daily_budget) : null,
          lifetime_budget_cents: adset.lifetime_budget ? parseInt(adset.lifetime_budget) : null,
          status: adset.status,
          effective_status: adset.effective_status
        });
      }
    }

    log.info({
      where: 'interactive_brain',
      phase: 'metrics_calculated',
      fb_metrics_adsets: adsetMetricsFromFB.length,
      adset_budgets_loaded: adsetBudgets.size,
      sample_metrics: adsetMetricsFromFB.slice(0, 2).map(a => ({
        adset_id: a.adset_id,
        has_7d: !!a.metrics_last_7d,
        spend_7d: a.metrics_last_7d?.spend
      })),
      message: 'calculateMultiPeriodTrends завершён'
    });

    // ========================================
    // ЧАСТЬ 2: ЗАГРУЗКА ПОСЛЕДНЕГО ОТЧЁТА BRAIN
    // ========================================

    log.info({ where: 'interactive_brain', phase: 'loading_brain_report' });

    // Получаем последний успешный scoring_output (отчёт основного Brain)
    const { data: lastExecution } = await supabase
      .from('scoring_executions')
      .select('scoring_output, completed_at')
      .eq('user_account_id', userAccountId)
      .eq('status', 'success')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    const brainReport = lastExecution?.scoring_output || null;
    const brainReportAge = lastExecution?.completed_at
      ? Math.round((Date.now() - new Date(lastExecution.completed_at).getTime()) / 1000 / 60 / 60)
      : null;

    log.info({
      where: 'interactive_brain',
      phase: 'brain_report_loaded',
      has_report: !!brainReport,
      report_age_hours: brainReportAge,
      adsets_in_report: brainReport?.adsets?.length || 0,
      unused_creatives: brainReport?.unused_creatives?.length || 0
    });

    // ========================================
    // ЧАСТЬ 3: ПОЛУЧАЕМ НАПРАВЛЕНИЯ И НАСТРОЙКИ
    // ========================================

    let directionsQuery = supabase
      .from('account_directions')
      .select('id, name, fb_campaign_id, objective, daily_budget_cents, target_cpl_cents, is_active, created_at')
      .eq('user_account_id', userAccountId)
      .eq('is_active', true);

    if (directionId) {
      directionsQuery = directionsQuery.eq('id', directionId);
    }

    const { data: directions } = await directionsQuery;

    // ========================================
    // ЗАГРУЗКА НАСТРОЕК АККАУНТА (для внешних кампаний)
    // ========================================
    let adAccountSettings = null;

    // Пробуем найти ad_account по fb_ad_account_id
    const { data: adAccountData } = await supabase
      .from('ad_accounts')
      .select('id, default_cpl_target_cents, plan_daily_budget_cents')
      .eq('ad_account_id', ad_account_id)
      .single();

    if (adAccountData) {
      adAccountSettings = adAccountData;
    } else {
      // Fallback: ищем по user_account_id
      const { data: adAccountByUser } = await supabase
        .from('ad_accounts')
        .select('id, default_cpl_target_cents, plan_daily_budget_cents')
        .eq('user_account_id', userAccountId)
        .limit(1)
        .single();

      adAccountSettings = adAccountByUser || null;
    }

    log.info({
      where: 'interactive_brain',
      phase: 'ad_account_settings_loaded',
      has_settings: !!adAccountSettings,
      default_cpl: adAccountSettings?.default_cpl_target_cents,
      plan_budget: adAccountSettings?.plan_daily_budget_cents
    });

    // Загружаем последние действия Brain для защиты от дёрготни
    const { data: recentActions } = await supabase
      .from('brain_executions')
      .select('proposals_json, completed_at')
      .eq('user_account_id', userAccountId)
      .in('status', ['proposals_generated', 'executed'])
      .order('completed_at', { ascending: false })
      .limit(3);

    // ========================================
    // ЧАСТЬ 4: АНАЛИЗ С HEALTH SCORE
    // ========================================

    // ========================================
    // ВЫБОР ИСТОЧНИКА АДСЕТОВ ДЛЯ АНАЛИЗА
    // Если есть данные за сегодня — используем todayData
    // Если нет данных за сегодня — используем adsetMetricsFromFB (все адсеты за 14 дней)
    // Это позволяет анализировать кампании, которые были на паузе сегодня
    // ========================================
    const adsetsToAnalyze = todayData.length > 0 ? todayData : adsetMetricsFromFB;
    const usingHistoricalData = todayData.length === 0;

    log.info({
      where: 'interactive_brain',
      phase: 'calculating_health_scores',
      adsets_to_process: adsetsToAnalyze.length,
      using_historical_data: usingHistoricalData,
      today_adsets_count: todayData.length,
      fb_metrics_adsets_count: adsetMetricsFromFB.length,
      directions_count: directions?.length || 0,
      message: usingHistoricalData
        ? `Нет данных за сегодня, анализируем ${adsetMetricsFromFB.length} адсетов за 14 дней`
        : `Начинаем анализ ${todayData.length} адсетов`
    });

    const proposals = [];
    const adsetAnalysis = [];
    const skippedAdsets = [];  // Для логирования пропущенных адсетов

    for (let adsetIndex = 0; adsetIndex < adsetsToAnalyze.length; adsetIndex++) {
      const adsetData = adsetsToAnalyze[adsetIndex];
      // Унифицируем структуру: adsetMetricsFromFB и todayData имеют разные поля
      const adsetId = adsetData.adset_id;
      const adsetName = adsetData.adset_name;
      const campaignId = adsetData.campaign_id;

      try {
        // ========================================
        // ПОИСК СВЯЗАННЫХ ДАННЫХ
        // ========================================
        const todayAdset = todayData.find(a => a.adset_id === adsetId);
        const yesterdayAdset = yesterdayData.find(a => a.adset_id === adsetId);
        const brainAdset = brainReport?.adsets?.find(a => a.adset_id === adsetId);
        const direction = directions?.find(d => d.fb_campaign_id === campaignId);
        const fbMetrics = fbMetricsByAdset.get(adsetId);

        // ========================================
        // ОПРЕДЕЛЕНИЕ ТИПА КАМПАНИИ (internal vs external)
        // ========================================
        const isExternalCampaign = !direction;

        // Детальное логирование для каждого адсета (первые 3 + все external)
        if (adsetIndex < 3 || isExternalCampaign) {
          log.info({
            where: 'interactive_brain',
            phase: 'adset_processing_start',
            adset_index: adsetIndex,
            adset_id: adsetId,
            adset_name: adsetName?.substring(0, 50),
            campaign_id: campaignId,
            campaign_type: isExternalCampaign ? 'EXTERNAL' : 'internal',
            has_today_data: !!todayAdset,
            has_yesterday_data: !!yesterdayAdset,
            has_fb_metrics: !!fbMetrics,
            has_brain_report_data: !!brainAdset,
            has_direction: !!direction,
            direction_id: direction?.id || null,
            using_historical: usingHistoricalData
          });
        }

        // ========================================
        // МЕТРИКИ
        // Если есть данные за сегодня — используем их
        // Иначе используем metrics_last_7d как "текущие" метрики
        // ========================================
        let todaySpend, todayImpressions, todayClicks, todayCTR, todayCPM;
        let todayLinkClicks, todayLeads, todayConversions, todayCostPerConversion, todayCPL;
        let metricsSource = 'none';

        if (todayAdset) {
          // Есть данные за сегодня
          todaySpend = parseFloat(todayAdset.spend || 0);
          todayImpressions = parseInt(todayAdset.impressions || 0);
          todayClicks = parseInt(todayAdset.clicks || 0);
          todayCTR = todayImpressions > 0 ? (todayClicks / todayImpressions * 100) : null;
          todayCPM = todayImpressions > 0 ? (todaySpend / todayImpressions * 1000) : null;
          todayLinkClicks = getActionValue(todayAdset.actions, 'link_click');
          todayLeads = getActionValue(todayAdset.actions, 'lead');
          metricsSource = 'today';
        } else if (fbMetrics?.metrics_last_7d) {
          // Нет данных за сегодня — используем средние за 7 дней
          const m7d = fbMetrics.metrics_last_7d;
          todaySpend = m7d.spend || 0;
          todayImpressions = m7d.impressions || 0;
          todayClicks = m7d.clicks || 0;
          todayCTR = m7d.ctr || null;
          todayCPM = m7d.cpm || null;
          todayLinkClicks = m7d.link_clicks || 0;
          todayLeads = m7d.leads || 0;
          metricsSource = 'last_7d';
        } else {
          // Нет никаких данных — пропускаем
          skippedAdsets.push({ adset_id: adsetId, adset_name: adsetName, error: 'No metrics data' });
          continue;
        }

        // Для instagram_traffic используем link_clicks как "конверсии", для остальных - leads
        // Для внешних кампаний по умолчанию используем leads (CPL)
        const directionObjective = direction?.objective || 'whatsapp';
        const isTrafficObjective = directionObjective === 'instagram_traffic';
        const metricName = isTrafficObjective ? 'CPC' : 'CPL';

        // Конверсии
        todayConversions = isTrafficObjective ? todayLinkClicks : todayLeads;
        todayCostPerConversion = todayConversions > 0 ? todaySpend / todayConversions : null;
        todayCPL = todayCostPerConversion;

        // Yesterday метрики
        const yesterdaySpend = parseFloat(yesterdayAdset?.spend || 0);
        const yesterdayLinkClicks = getActionValue(yesterdayAdset?.actions, 'link_click');
        const yesterdayLeads = getActionValue(yesterdayAdset?.actions, 'lead');
        const yesterdayConversions = isTrafficObjective ? yesterdayLinkClicks : yesterdayLeads;
        const yesterdayCostPerConversion = yesterdayConversions > 0 ? yesterdaySpend / yesterdayConversions : null;
        const yesterdayCPL = yesterdayCostPerConversion;

        // ========================================
        // TARGET CPL с каскадом fallback
        // 1. target_cpl из direction (если есть)
        // 2. default_cpl_target_cents из ad_accounts (если есть)
        // 3. null — анализ только по трендам
        // ========================================
        let targetCPL = null;
        let targetCPLSource = 'none';

        if (direction?.target_cpl_cents) {
          targetCPL = direction.target_cpl_cents / 100;
          targetCPLSource = 'direction';
        } else if (adAccountSettings?.default_cpl_target_cents) {
          targetCPL = adAccountSettings.default_cpl_target_cents / 100;
          targetCPLSource = 'account_default';
        }
        // Если targetCPL = null — всё равно анализируем (только тренды)

        // ========================================
        // МЕТРИКИ ЗА 7 ДНЕЙ (hist7d)
        // ========================================
        let hist7d = {};
        let histCPL = null;
        let histCTR = null;
        let histCPM = null;
        let histFrequency = 0;
        let hist7dSource = 'none';

        if (!isExternalCampaign && brainAdset?.metrics_last_7d) {
          // Internal кампании: используем brainReport (сохранённый с утреннего прогона)
          hist7d = brainAdset.metrics_last_7d;
          hist7dSource = 'brain_report';
        } else {
          // External кампании ИЛИ internal без данных в brainReport:
          // используем данные из FB API (рассчитанные через calculateMultiPeriodTrends)
          const fbMetrics = fbMetricsByAdset.get(adsetId);
          if (fbMetrics?.metrics_last_7d) {
            hist7d = fbMetrics.metrics_last_7d;
            hist7dSource = 'fb_api_calculated';
          }
        }

        // Извлекаем метрики из hist7d (одинаковая структура для internal и external)
        if (hist7d && Object.keys(hist7d).length > 0) {
          const hist7dConversions = isTrafficObjective
            ? (hist7d.link_clicks || 0)
            : (hist7d.leads || 0);
          histCPL = hist7dConversions > 0 ? hist7d.spend / hist7dConversions : null;
          histCTR = hist7d.ctr || null;
          histCPM = hist7d.cpm || null;
          histFrequency = hist7d.frequency || 0;
        }

        // Логируем источники данных для external и первых internal
        if (adsetIndex < 3 || isExternalCampaign) {
          log.info({
            where: 'interactive_brain',
            phase: 'adset_data_sources',
            adset_id: adsetId,
            campaign_type: isExternalCampaign ? 'EXTERNAL' : 'internal',
            target_cpl_source: targetCPLSource,
            target_cpl_value: targetCPL,
            hist7d_source: hist7dSource,
            hist7d_has_data: Object.keys(hist7d).length > 0,
            hist_metrics: {
              histCPL: histCPL?.toFixed(2),
              histCTR: histCTR?.toFixed(2),
              histCPM: histCPM?.toFixed(2),
              histFrequency: histFrequency?.toFixed(2)
            },
            today_metrics: {
              spend: todaySpend.toFixed(2),
              conversions: todayConversions,
              cpl: todayCPL?.toFixed(2),
              impressions: todayImpressions
            }
          });
        }

      // ========================================
      // HEALTH SCORE CALCULATION (синхронизировано с brainRules.js)
      // ========================================
      let healthScore = 0;
      const hsBreakdown = [];

      // 1. CPL/CPC GAP к TARGET (вес 45) — для instagram_traffic используется CPC
      if (todayCPL && targetCPL) {
        const cplRatio = todayCPL / targetCPL;
        if (cplRatio <= 0.7) {
          healthScore += 45;
          hsBreakdown.push({ factor: 'cost_gap', value: 45, reason: `${metricName} ${((1 - cplRatio) * 100).toFixed(0)}% ниже target` });
        } else if (cplRatio <= 0.9) {
          healthScore += 30;
          hsBreakdown.push({ factor: 'cost_gap', value: 30, reason: `${metricName} ${((1 - cplRatio) * 100).toFixed(0)}% ниже target` });
        } else if (cplRatio <= 1.1) {
          healthScore += 10;
          hsBreakdown.push({ factor: 'cost_gap', value: 10, reason: `${metricName} в пределах ±10% от target` });
        } else if (cplRatio <= 1.3) {
          healthScore -= 30;
          hsBreakdown.push({ factor: 'cost_gap', value: -30, reason: `${metricName} ${((cplRatio - 1) * 100).toFixed(0)}% выше target` });
        } else {
          healthScore -= 45;
          hsBreakdown.push({ factor: 'cost_gap', value: -45, reason: `${metricName} ${((cplRatio - 1) * 100).toFixed(0)}% выше target` });
        }
      }

      // 2. ТРЕНДЫ (вес до 15) — сегодня vs вчера
      if (todayCPL && yesterdayCPL) {
        const trendRatio = todayCPL / yesterdayCPL;
        if (trendRatio <= 0.8) {
          healthScore += 15;
          hsBreakdown.push({ factor: 'trend', value: 15, reason: `${metricName} улучшился на ${((1 - trendRatio) * 100).toFixed(0)}% vs вчера` });
        } else if (trendRatio >= 1.2) {
          healthScore -= 15;
          hsBreakdown.push({ factor: 'trend', value: -15, reason: `${metricName} ухудшился на ${((trendRatio - 1) * 100).toFixed(0)}% vs вчера` });
        }
      }

      // 3. ДИАГНОСТИКА (до -30)
      // CTR слишком низкий
      if (todayCTR !== null && todayCTR < 1) {
        healthScore -= 8;
        hsBreakdown.push({ factor: 'low_ctr', value: -8, reason: `CTR ${todayCTR.toFixed(2)}% < 1% (слабый креатив)` });
      }

      // CPM слишком высокий (vs история)
      if (todayCPM && histCPM && todayCPM > histCPM * 1.3) {
        healthScore -= 12;
        hsBreakdown.push({ factor: 'high_cpm', value: -12, reason: `CPM $${todayCPM.toFixed(2)} на 30%+ выше средней` });
      }

      // Frequency высокая (выгорание)
      if (histFrequency > 2) {
        healthScore -= 10;
        hsBreakdown.push({ factor: 'high_frequency', value: -10, reason: `Frequency ${histFrequency.toFixed(1)} > 2 (выгорание)` });
      }

      // 4. ОБЪЁМ ДАННЫХ (множитель доверия)
      let volumeMultiplier = 1.0;
      if (todayImpressions < VOLUME_THRESHOLDS.TODAY_MIN_IMPRESSIONS) {
        volumeMultiplier = 0.6;
        hsBreakdown.push({ factor: 'low_volume', value: null, reason: `Мало данных (${todayImpressions} impr), доверие 60%` });
      } else if (todayImpressions < VOLUME_THRESHOLDS.MIN_IMPRESSIONS) {
        volumeMultiplier = 0.8;
      }

      // 5. TODAY-КОМПЕНСАЦИЯ (КЛЮЧЕВОЕ для мини-brain!)
      // Если сегодня CPL значительно лучше вчера — компенсируем негатив
      let todayCompensation = 0;
      if (todayCPL && yesterdayCPL && todayImpressions >= VOLUME_THRESHOLDS.TODAY_MIN_IMPRESSIONS) {
        const improvementRatio = todayCPL / yesterdayCPL;

        if (improvementRatio <= TODAY_COMPENSATION.FULL) {
          // CPL/CPC в 2+ раза лучше вчера → ПОЛНАЯ компенсация штрафов
          const negativePart = hsBreakdown.filter(h => h.value < 0).reduce((sum, h) => sum + h.value, 0);
          todayCompensation = Math.abs(negativePart);
          hsBreakdown.push({
            factor: 'today_compensation',
            value: todayCompensation,
            reason: `СЕГОДНЯ ${metricName} в ${(1 / improvementRatio).toFixed(1)}x лучше вчера! Полная компенсация.`
          });
        } else if (improvementRatio <= TODAY_COMPENSATION.PARTIAL) {
          // На 30%+ лучше → 60% компенсация
          const negativePart = hsBreakdown.filter(h => h.value < 0).reduce((sum, h) => sum + h.value, 0);
          todayCompensation = Math.abs(negativePart) * 0.6;
          hsBreakdown.push({
            factor: 'today_compensation',
            value: Math.round(todayCompensation),
            reason: `Сегодня ${metricName} на ${((1 - improvementRatio) * 100).toFixed(0)}% лучше вчера (60% компенсация)`
          });
        } else if (improvementRatio <= TODAY_COMPENSATION.SLIGHT) {
          // Небольшое улучшение → +5 бонус
          todayCompensation = 5;
          hsBreakdown.push({ factor: 'today_compensation', value: 5, reason: `Небольшое улучшение ${metricName} сегодня` });
        }
        healthScore += todayCompensation;
      }

      // Применяем множитель доверия
      healthScore = Math.round(healthScore * volumeMultiplier);

      // Ограничиваем диапазон [-100, +100]
      healthScore = Math.max(-100, Math.min(100, healthScore));

      // ========================================
      // ОПРЕДЕЛЕНИЕ КЛАССА HS
      // ========================================
      let hsClass;
      if (healthScore >= HS_CLASSES.VERY_GOOD) hsClass = 'very_good';
      else if (healthScore >= HS_CLASSES.GOOD) hsClass = 'good';
      else if (healthScore >= HS_CLASSES.NEUTRAL_LOW) hsClass = 'neutral';
      else if (healthScore >= HS_CLASSES.SLIGHTLY_BAD) hsClass = 'slightly_bad';
      else hsClass = 'bad';

      // Сохраняем анализ
      adsetAnalysis.push({
        adset_id: adsetId,
        adset_name: adsetName,
        campaign_id: campaignId,
        campaign_type: isExternalCampaign ? 'external' : 'internal',
        direction_id: direction?.id || null,
        direction_name: direction?.name || null,
        direction_objective: directionObjective,
        target_cpl_source: targetCPLSource,
        hist7d_source: hist7dSource,
        metrics_source: metricsSource,  // NEW: откуда взяты текущие метрики (today/last_7d)
        health_score: healthScore,
        hs_class: hsClass,
        hs_breakdown: hsBreakdown,
        metrics: {
          today: {
            spend: todaySpend,
            conversions: todayConversions,
            cost_per_conversion: todayCPL,
            ctr: todayCTR,
            impressions: todayImpressions,
            // Для обратной совместимости
            leads: todayLeads,
            link_clicks: todayLinkClicks
          },
          yesterday: {
            spend: yesterdaySpend,
            conversions: yesterdayConversions,
            cost_per_conversion: yesterdayCPL,
            leads: yesterdayLeads,
            link_clicks: yesterdayLinkClicks
          },
          target_cost_per_conversion: targetCPL,
          metric_name: metricName, // 'CPC' для instagram_traffic, 'CPL' для остальных
          hist_7d: hist7d,
          hist_7d_calculated: {
            histCPL,
            histCTR,
            histCPM,
            histFrequency
          }
        }
      });

      // ========================================
      // ГЕНЕРАЦИЯ PROPOSALS по классу HS
      // ========================================

      // Защита от дёрготни: проверяем недавние действия
      const recentActionOnAdset = recentActions?.some(ra =>
        ra.proposals_json?.some(p => p.entity_id === adsetId)
      );

      // Получаем текущий бюджет адсета
      const adsetBudgetInfo = adsetBudgets.get(adsetId);
      const currentBudgetCents = adsetBudgetInfo?.daily_budget_cents || null;
      const currentBudgetDollars = currentBudgetCents ? Math.round(currentBudgetCents / 100) : null;

      // Строим человекочитаемое объяснение
      const humanReason = buildHumanReadableReason(hsBreakdown, { todayCPL, targetCPL, metricName });

      // Добавляем пометку если данные исторические
      const dataNote = metricsSource === 'last_7d' ? ' (данные за 7 дней)' : '';
      const campaignNote = isExternalCampaign ? ' [внешняя кампания]' : '';

      if (hsClass === 'very_good' && !recentActionOnAdset) {
        // Масштабировать +20%
        const increasePercent = Math.min(BUDGET_LIMITS.MAX_INCREASE_PCT, 20);
        const newBudgetCents = currentBudgetCents ? Math.round(currentBudgetCents * (1 + increasePercent / 100)) : null;
        const newBudgetDollars = newBudgetCents ? Math.round(newBudgetCents / 100) : null;

        const budgetChangeText = currentBudgetDollars && newBudgetDollars
          ? `Увеличить бюджет с $${currentBudgetDollars} до $${newBudgetDollars} (+${increasePercent}%).`
          : `Увеличить бюджет на ${increasePercent}%.`;

        proposals.push({
          action: 'updateBudget',
          priority: 'high',
          entity_type: 'adset',
          entity_id: adsetId,
          entity_name: adsetName,
          campaign_id: campaignId,
          campaign_type: isExternalCampaign ? 'external' : 'internal',
          direction_id: direction?.id || null,
          direction_name: direction?.name || null,
          target_cpl_source: targetCPLSource,
          health_score: healthScore,
          hs_class: hsClass,
          reason: `«${adsetName}»${campaignNote}: ${humanReason || 'отличные результаты'}${dataNote}. ${budgetChangeText}`,
          confidence: 0.85,
          suggested_action_params: {
            increase_percent: increasePercent,
            current_budget_cents: currentBudgetCents,
            new_budget_cents: newBudgetCents,
            max_budget_cents: BUDGET_LIMITS.MAX_CENTS
          },
          metrics: { today_spend: todaySpend, today_conversions: todayConversions, today_cpl: todayCPL, target_cpl: targetCPL, objective: directionObjective, metrics_source: metricsSource }
        });
      }
      else if (hsClass === 'bad') {
        // CPL/CPC критически высокий → пауза или сильное снижение (-50%)
        const cplMultiple = todayCPL && targetCPL ? todayCPL / targetCPL : null;
        const decreasePercent = BUDGET_LIMITS.MAX_DECREASE_PCT;
        const newBudgetCents = currentBudgetCents ? Math.round(currentBudgetCents * (1 - decreasePercent / 100)) : null;
        const newBudgetDollars = newBudgetCents ? Math.round(newBudgetCents / 100) : null;

        if (cplMultiple && cplMultiple > 3) {
          proposals.push({
            action: 'pauseAdSet',
            priority: 'critical',
            entity_type: 'adset',
            entity_id: adsetId,
            entity_name: adsetName,
            campaign_id: campaignId,
            campaign_type: isExternalCampaign ? 'external' : 'internal',
            direction_id: direction?.id || null,
            direction_name: direction?.name || null,
            target_cpl_source: targetCPLSource,
            health_score: healthScore,
            hs_class: hsClass,
            reason: `«${adsetName}»${campaignNote}: КРИТИЧНО! ${humanReason}${dataNote}. ${metricName} превышает цель в ${cplMultiple.toFixed(1)}x раз. Рекомендую поставить на паузу.`,
            confidence: 0.9,
            suggested_action_params: {
              current_budget_cents: currentBudgetCents
            },
            metrics: { today_spend: todaySpend, today_conversions: todayConversions, today_cpl: todayCPL, target_cpl: targetCPL, objective: directionObjective, metrics_source: metricsSource }
          });
        } else {
          const budgetChangeText = currentBudgetDollars && newBudgetDollars
            ? `Снизить бюджет с $${currentBudgetDollars} до $${newBudgetDollars} (-${decreasePercent}%).`
            : `Снизить бюджет на ${decreasePercent}%.`;

          proposals.push({
            action: 'updateBudget',
            priority: 'high',
            entity_type: 'adset',
            entity_id: adsetId,
            entity_name: adsetName,
            campaign_id: campaignId,
            campaign_type: isExternalCampaign ? 'external' : 'internal',
            direction_id: direction?.id || null,
            direction_name: direction?.name || null,
            target_cpl_source: targetCPLSource,
            health_score: healthScore,
            hs_class: hsClass,
            reason: `«${adsetName}»${campaignNote}: ${humanReason}${dataNote}. ${budgetChangeText}`,
            confidence: 0.8,
            suggested_action_params: {
              decrease_percent: decreasePercent,
              current_budget_cents: currentBudgetCents,
              new_budget_cents: newBudgetCents,
              min_budget_cents: BUDGET_LIMITS.MIN_CENTS
            },
            metrics: { today_spend: todaySpend, today_conversions: todayConversions, today_cpl: todayCPL, target_cpl: targetCPL, objective: directionObjective, metrics_source: metricsSource }
          });
        }
      }
      else if (hsClass === 'slightly_bad' && !recentActionOnAdset) {
        // Снижать -25%
        const decreasePercent = 25;
        const newBudgetCents = currentBudgetCents ? Math.round(currentBudgetCents * (1 - decreasePercent / 100)) : null;
        const newBudgetDollars = newBudgetCents ? Math.round(newBudgetCents / 100) : null;

        const budgetChangeText = currentBudgetDollars && newBudgetDollars
          ? `Снизить бюджет с $${currentBudgetDollars} до $${newBudgetDollars} (-${decreasePercent}%).`
          : `Снизить бюджет на ${decreasePercent}%.`;

        proposals.push({
          action: 'updateBudget',
          priority: 'medium',
          entity_type: 'adset',
          entity_id: adsetId,
          entity_name: adsetName,
          campaign_id: campaignId,
          campaign_type: isExternalCampaign ? 'external' : 'internal',
          direction_id: direction?.id || null,
          direction_name: direction?.name || null,
          target_cpl_source: targetCPLSource,
          health_score: healthScore,
          hs_class: hsClass,
          reason: `«${adsetName}»${campaignNote}: ${humanReason || 'результаты ниже нормы'}${dataNote}. ${budgetChangeText}`,
          confidence: 0.7,
          suggested_action_params: {
            decrease_percent: decreasePercent,
            current_budget_cents: currentBudgetCents,
            new_budget_cents: newBudgetCents,
            min_budget_cents: BUDGET_LIMITS.MIN_CENTS
          },
          metrics: { today_spend: todaySpend, today_conversions: todayConversions, today_cpl: todayCPL, target_cpl: targetCPL, objective: directionObjective, metrics_source: metricsSource }
        });
      }
      // good и neutral — не предлагаем изменений (наблюдаем)

        // Логируем итоговый результат анализа адсета (для external и первых internal)
        if (adsetIndex < 3 || isExternalCampaign) {
          log.info({
            where: 'interactive_brain',
            phase: 'adset_analysis_complete',
            adset_id: adsetId,
            campaign_type: isExternalCampaign ? 'EXTERNAL' : 'internal',
            health_score: healthScore,
            hs_class: hsClass,
            hs_breakdown_count: hsBreakdown.length,
            proposal_generated: proposals.some(p => p.entity_id === adsetId),
            metrics_source: metricsSource
          });
        }

      } catch (adsetError) {
        // Ловим ошибки при обработке отдельного адсета, не прерывая весь анализ
        log.error({
          where: 'interactive_brain',
          phase: 'adset_processing_error',
          adset_id: adsetId,
          adset_name: adsetName?.substring(0, 50),
          error: String(adsetError),
          stack: adsetError.stack?.substring(0, 500)
        });
        skippedAdsets.push({
          adset_id: adsetId,
          adset_name: adsetName,
          error: String(adsetError)
        });
        // Продолжаем обработку следующих адсетов
      }
    }

    // Логируем если были пропущены адсеты из-за ошибок
    if (skippedAdsets.length > 0) {
      log.warn({
        where: 'interactive_brain',
        phase: 'adsets_skipped',
        skipped_count: skippedAdsets.length,
        skipped_adsets: skippedAdsets.slice(0, 5),
        message: `${skippedAdsets.length} адсетов пропущено из-за ошибок обработки`
      });
    }

    // ========================================
    // ЧАСТЬ 4.5: ЛОГИКА ПЕРЕРАСПРЕДЕЛЕНИЯ БЮДЖЕТА
    // ========================================

    // Считаем сумму экономии от снижения бюджетов
    const decreaseProposals = proposals.filter(p =>
      p.action === 'updateBudget' &&
      p.suggested_action_params?.decrease_percent &&
      p.suggested_action_params?.current_budget_cents
    );

    const totalSavingsCents = decreaseProposals.reduce((sum, p) => {
      const current = p.suggested_action_params.current_budget_cents;
      const newBudget = p.suggested_action_params.new_budget_cents || 0;
      return sum + (current - newBudget);
    }, 0);

    // Находим адсеты с хорошими результатами, куда можно перераспределить
    const goodAdsets = adsetAnalysis.filter(a =>
      (a.hs_class === 'very_good' || a.hs_class === 'good') &&
      !proposals.some(p => p.entity_id === a.adset_id && p.action === 'updateBudget')
    );

    if (totalSavingsCents > 0 && goodAdsets.length > 0) {
      const totalSavingsDollars = Math.round(totalSavingsCents / 100);

      // Добавляем информацию о перераспределении к decrease proposals
      const redistributeTargets = goodAdsets.slice(0, 3).map(a => ({
        adset_id: a.adset_id,
        adset_name: a.adset_name,
        health_score: a.health_score
      }));

      for (const proposal of decreaseProposals) {
        proposal.redistribute_suggestion = {
          total_savings_cents: totalSavingsCents,
          total_savings_dollars: totalSavingsDollars,
          redistribute_to: redistributeTargets,
          message: `Сэкономленные $${totalSavingsDollars} можно перераспределить на: ${redistributeTargets.map(t => `«${t.adset_name}» (HS=${t.health_score})`).join(', ')}`
        };
      }

      log.info({
        where: 'interactive_brain',
        phase: 'redistribution_calculated',
        total_savings_cents: totalSavingsCents,
        total_savings_dollars: totalSavingsDollars,
        decrease_proposals_count: decreaseProposals.length,
        good_adsets_count: goodAdsets.length,
        redistribute_targets: redistributeTargets.map(t => t.adset_name)
      });
    } else if (totalSavingsCents > 0 && goodAdsets.length === 0) {
      // Некуда перераспределять — все адсеты плохие
      // Предлагаем запустить новые адсеты с лучшими креативами
      const totalSavingsDollars = Math.round(totalSavingsCents / 100);

      // Проверяем есть ли внешние кампании среди плохих
      const hasExternalCampaigns = decreaseProposals.some(p => p.campaign_type === 'external');

      // Добавляем рекомендацию к каждому decrease proposal
      for (const proposal of decreaseProposals) {
        if (proposal.campaign_type === 'external') {
          proposal.redistribute_suggestion = {
            total_savings_cents: totalSavingsCents,
            total_savings_dollars: totalSavingsDollars,
            redistribute_to: [],
            no_good_adsets: true,
            message: `Все адсеты показывают слабые результаты. Рекомендуем: запустить новые адсеты с улучшенными креативами (свежие визуалы, новые тексты). Сэкономленные $${totalSavingsDollars} можно направить на тестирование.`
          };
        } else {
          proposal.redistribute_suggestion = {
            total_savings_cents: totalSavingsCents,
            total_savings_dollars: totalSavingsDollars,
            redistribute_to: [],
            no_good_adsets: true,
            message: `Нет адсетов с хорошими результатами для перераспределения бюджета.`
          };
        }
      }

      // Добавляем отдельный proposal-рекомендацию для запуска новых креативов
      if (hasExternalCampaigns) {
        proposals.push({
          action: 'launchNewCreatives',
          priority: 'medium',
          entity_type: 'account',
          entity_id: ad_account_id,
          entity_name: 'Рекламный аккаунт',
          campaign_type: 'external',
          health_score: null,
          hs_class: null,
          reason: `💡 Все текущие адсеты неэффективны. Рекомендуем запустить новые адсеты с улучшенными креативами: свежие визуалы, новые тексты, возможно другие аудитории. Освободившийся бюджет $${totalSavingsDollars} можно направить на тестирование новых связок.`,
          confidence: 0.7,
          suggested_action_params: {
            recommended_budget_cents: totalSavingsCents,
            suggestions: [
              'Обновить визуалы (новые фото/видео)',
              'Переписать тексты объявлений',
              'Протестировать новые аудитории',
              'Изменить формат (карусель, reels, stories)'
            ]
          }
        });
      }

      log.info({
        where: 'interactive_brain',
        phase: 'no_redistribution_targets',
        total_savings_cents: totalSavingsCents,
        total_savings_dollars: totalSavingsDollars,
        decrease_proposals_count: decreaseProposals.length,
        has_external_campaigns: hasExternalCampaigns,
        message: 'Все адсеты плохие, некуда перераспределять. Предложено запустить новые креативы.'
      });
    }

    // ========================================
    // ЧАСТЬ 5: АНАЛИЗ НЕИСПОЛЬЗОВАННЫХ КРЕАТИВОВ (из отчёта Brain)
    // ========================================

    if (brainReport?.unused_creatives?.length > 0) {
      const byDirection = {};
      for (const uc of brainReport.unused_creatives) {
        const dirId = uc.direction_id || 'no_direction';
        if (!byDirection[dirId]) byDirection[dirId] = [];
        byDirection[dirId].push(uc);
      }

      for (const [dirId, creatives] of Object.entries(byDirection)) {
        if (creatives.length > 0 && dirId !== 'no_direction') {
          const direction = directions?.find(d => d.id === dirId);

          proposals.push({
            action: 'createAdSet',
            priority: 'medium',
            entity_type: 'direction',
            entity_id: dirId,
            entity_name: direction?.name || 'Unknown',
            reason: `${creatives.length} неиспользованных креативов готовы к запуску. Рекомендую протестировать.`,
            confidence: 0.75,
            suggested_action_params: {
              creative_ids: creatives.slice(0, 5).map(c => c.id),
              creative_titles: creatives.slice(0, 5).map(c => c.title),
              recommended_budget_cents: BUDGET_LIMITS.NEW_ADSET_MIN
            }
          });
        }
      }
    }

    // ========================================
    // ЧАСТЬ 6: HIGH RISK ИЗ ОТЧЁТА BRAIN
    // ========================================

    if (brainReport?.ready_creatives) {
      for (const creative of brainReport.ready_creatives) {
        if (creative.risk_score && creative.risk_score >= 70) {
          // Уже не добавляем proposal если adset уже в списке
          const alreadyHasProposal = proposals.some(p =>
            p.entity_type === 'creative' && p.entity_id === creative.id
          );

          if (!alreadyHasProposal) {
            proposals.push({
              action: 'review',
              priority: 'low',
              entity_type: 'creative',
              entity_id: creative.id,
              entity_name: creative.title || creative.name,
              reason: `High risk score (${creative.risk_score}/100) по данным последнего анализа Brain. Рекомендую проверить креатив.`,
              confidence: 0.6,
              metrics: { risk_score: creative.risk_score, roi_data: creative.roi_data }
            });
          }
        }
      }
    }

    // ========================================
    // ЧАСТЬ 7: СОРТИРОВКА И ВОЗВРАТ
    // ========================================

    // Сортируем proposals по приоритету
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    proposals.sort((a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3));

    const duration = Date.now() - startTime;

    // Summary статистика
    const externalAdsets = adsetAnalysis.filter(a => a.campaign_type === 'external');
    const internalAdsets = adsetAnalysis.filter(a => a.campaign_type === 'internal');

    const summary = {
      total_adsets_analyzed: adsetAnalysis.length,
      skipped_adsets_count: skippedAdsets.length,
      // NEW: статистика по типам кампаний
      by_campaign_type: {
        internal: internalAdsets.length,
        external: externalAdsets.length
      },
      // NEW: статистика по источникам данных
      by_data_source: {
        target_cpl_from_direction: adsetAnalysis.filter(a => a.target_cpl_source === 'direction').length,
        target_cpl_from_account: adsetAnalysis.filter(a => a.target_cpl_source === 'account_default').length,
        target_cpl_none: adsetAnalysis.filter(a => a.target_cpl_source === 'none').length,
        hist7d_from_brain_report: adsetAnalysis.filter(a => a.hist7d_source === 'brain_report').length,
        hist7d_from_fb_api: adsetAnalysis.filter(a => a.hist7d_source === 'fb_api_calculated').length,
        hist7d_none: adsetAnalysis.filter(a => a.hist7d_source === 'none').length
      },
      by_hs_class: {
        very_good: adsetAnalysis.filter(a => a.hs_class === 'very_good').length,
        good: adsetAnalysis.filter(a => a.hs_class === 'good').length,
        neutral: adsetAnalysis.filter(a => a.hs_class === 'neutral').length,
        slightly_bad: adsetAnalysis.filter(a => a.hs_class === 'slightly_bad').length,
        bad: adsetAnalysis.filter(a => a.hs_class === 'bad').length
      },
      // NEW: HS по типам кампаний для сравнения
      external_hs_breakdown: externalAdsets.length > 0 ? {
        avg_health_score: Math.round(externalAdsets.reduce((sum, a) => sum + a.health_score, 0) / externalAdsets.length),
        by_class: {
          very_good: externalAdsets.filter(a => a.hs_class === 'very_good').length,
          good: externalAdsets.filter(a => a.hs_class === 'good').length,
          neutral: externalAdsets.filter(a => a.hs_class === 'neutral').length,
          slightly_bad: externalAdsets.filter(a => a.hs_class === 'slightly_bad').length,
          bad: externalAdsets.filter(a => a.hs_class === 'bad').length
        }
      } : null,
      proposals_by_action: {
        pauseAdSet: proposals.filter(p => p.action === 'pauseAdSet').length,
        updateBudget: proposals.filter(p => p.action === 'updateBudget').length,
        createAdSet: proposals.filter(p => p.action === 'createAdSet').length,
        review: proposals.filter(p => p.action === 'review').length
      },
      // NEW: proposals по типам кампаний
      proposals_by_campaign_type: {
        internal: proposals.filter(p => p.campaign_type === 'internal').length,
        external: proposals.filter(p => p.campaign_type === 'external').length
      },
      brain_report_age_hours: brainReportAge,
      today_total_spend: todayData.reduce((sum, a) => sum + parseFloat(a.spend || 0), 0).toFixed(2),
      // Исправлено: используем getActionValue вместо прямого доступа к свойствам
      today_total_leads: todayData.reduce((sum, a) => sum + getActionValue(a.actions, 'lead'), 0),
      today_total_link_clicks: todayData.reduce((sum, a) => sum + getActionValue(a.actions, 'link_click'), 0)
    };

    // Сохраняем запуск для аудита
    await supabase.from('brain_executions').insert({
      user_account_id: userAccountId,
      mode: 'interactive',
      direction_id: directionId,
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      status: 'proposals_generated',
      proposals_count: proposals.length,
      proposals_json: proposals
    });

    log.info({
      where: 'interactive_brain',
      phase: 'complete',
      proposals_count: proposals.length,
      duration_ms: duration,
      adsets_analyzed: adsetAnalysis.length,
      adsets_skipped: skippedAdsets.length,
      internal_adsets: internalAdsets.length,
      external_adsets: externalAdsets.length,
      proposals_internal: summary.proposals_by_campaign_type.internal,
      proposals_external: summary.proposals_by_campaign_type.external,
      data_sources: summary.by_data_source,
      message: `Анализ завершён: ${adsetAnalysis.length} адсетов (${internalAdsets.length} internal, ${externalAdsets.length} external), ${proposals.length} proposals`
    });

    // Детальный лог summary для отладки
    log.debug({
      where: 'interactive_brain',
      phase: 'complete_summary',
      summary
    });

    return {
      success: true,
      mode: 'interactive',
      proposals,
      adset_analysis: adsetAnalysis,
      summary,
      context: {
        today_adsets: todayData.length,
        yesterday_adsets: yesterdayData.length,
        daily_data_rows: dailyData.length,
        fb_calculated_metrics: adsetMetricsFromFB.length,
        brain_report_available: !!brainReport,
        brain_report_age_hours: brainReportAge,
        ad_account_settings_available: !!adAccountSettings,
        default_cpl_target: adAccountSettings?.default_cpl_target_cents ? (adAccountSettings.default_cpl_target_cents / 100) : null,
        directions_count: directions?.length || 0,
        generated_at: new Date().toISOString(),
        duration_ms: duration,
        focus: 'TODAY — все решения основаны на сегодняшних данных с учётом истории'
      }
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    log.error({
      where: 'interactive_brain',
      phase: 'error',
      userId: userAccountId,
      duration,
      error: String(error),
      stack: error.stack
    });

    // Сохраняем ошибку
    await supabase.from('brain_executions').insert({
      user_account_id: userAccountId,
      mode: 'interactive',
      direction_id: directionId,
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      status: 'error',
      error_message: String(error)
    });

    throw error;
  }
}
