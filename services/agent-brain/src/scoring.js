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
async function fetchAdInsights(adAccountId, accessToken, adId, datePreset = 'last_7d') {
  const url = `https://graph.facebook.com/${FB_API_VERSION}/${adId}/insights`;
  const params = new URLSearchParams({
    fields: 'impressions,reach,spend,clicks,actions,ctr,cpm,frequency,video_play_actions,video_avg_time_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions',
    date_preset: datePreset,
    access_token: accessToken
  });

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
 * Извлечь количество лидов из actions
 * Поддерживает разные типы конверсий (lead, messaging, site leads)
 */
function extractLeads(actions) {
  if (!actions || !Array.isArray(actions)) return 0;
  
  // Ищем действия типа lead
  const leadAction = actions.find(a => 
    a.action_type === 'lead' || 
    a.action_type === 'onsite_conversion.lead_grouped' ||
    a.action_type === 'onsite_conversion.messaging_conversation_started_7d' ||
    a.action_type === 'onsite_conversion.total_messaging_connection'
  );
  
  return leadAction ? parseInt(leadAction.value) || 0 : 0;
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
 * Возвращает Map<adset_id, objective>
 */
async function getAdsetsObjectives(supabase, userAccountId, adsetIds) {
  if (!adsetIds || adsetIds.length === 0) return new Map();

  const objectivesMap = new Map();

  try {
    // Получаем campaign_id для каждого adset из Facebook Insights
    // (уже есть в dailyData: campaign_id)
    // Поэтому вместо adsetIds используем campaign_ids

    // Получаем directions с их fb_campaign_id и objective
    const { data: directions, error } = await supabase
      .from('account_directions')
      .select('fb_campaign_id, objective')
      .eq('user_account_id', userAccountId)
      .not('fb_campaign_id', 'is', null);

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
      campaigns_mapped: campaignObjectives.size
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
      const pixelLeadsTotal = extractActionValue(actions, 'offsite_conversion.fb_pixel_lead');

      const conversionRate = linkClicksTotal > 0 ? (pixelLeadsTotal / linkClicksTotal) * 100 : 0;

      objectiveMetrics = {
        site_leads_metrics: {
          link_clicks: linkClicksTotal,
          pixel_leads: pixelLeadsTotal,
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
 * Fetch insights для креатива за указанный период
 * 
 * НОВЫЙ МЕТОД: Сначала находим все ads использующие этот creative,
 * затем получаем insights для каждого ad и агрегируем результаты
 */
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
  
  // CPL (cost per lead)
  let totalLeads = 0;
  for (const d of data) {
    if (d.actions) {
      const leadAction = d.actions.find(a => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped');
      if (leadAction) {
        totalLeads += parseFloat(leadAction.value) || 0;
      }
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
 * Получить активные креативы пользователя из user_creatives
 */
async function getActiveCreatives(supabase, userAccountId) {
  // ========================================
  // ФИЛЬТРУЕМ КРЕАТИВЫ ПО АКТИВНЫМ НАПРАВЛЕНИЯМ
  // ========================================
  // Получаем креативы с информацией о направлении (только из активных направлений)
  const { data, error } = await supabase
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
  
  if (error) throw new Error(`Failed to get active creatives: ${error.message}`);
  
  // Также включаем креативы БЕЗ направления (legacy)
  const { data: legacyCreatives, error: legacyError } = await supabase
    .from('user_creatives')
    .select('id, title, fb_video_id, fb_creative_id_whatsapp, fb_creative_id_instagram_traffic, fb_creative_id_site_leads, is_active, status, created_at, direction_id')
    .eq('user_id', userAccountId)
    .eq('is_active', true)
    .eq('status', 'ready')
    .is('direction_id', null); // Креативы без направления (legacy)
  
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
 */
async function saveMetricsSnapshot(supabase, userAccountId, adsets) {
  if (!adsets || !adsets.length) return;
  
  const today = new Date().toISOString().split('T')[0];
  
  const records = adsets.map(a => ({
    user_account_id: userAccountId,
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
 * Сохранить метрики креативов в creative_metrics_history
 * НОВАЯ ФУНКЦИЯ для унифицированной системы метрик
 * 
 * Получает метрики на уровне Ad (не AdSet) для каждого креатива
 * Использует ad_creative_mapping для точного мэтчинга
 */
async function saveCreativeMetricsToHistory(supabase, userAccountId, readyCreatives, adAccountId, accessToken) {
  if (!readyCreatives || !readyCreatives.length) return;
  
  const today = new Date().toISOString().split('T')[0];
  const records = [];
  
  logger.info({ 
    where: 'saveCreativeMetricsToHistory',
    creatives_count: readyCreatives.length 
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

      // Получить метрики для каждого ad
      for (const mapping of mappings) {
        try {
          const insights = await fetchAdInsights(adAccountId, accessToken, mapping.ad_id, 'last_7d');
          
          if (!insights) {
            logger.debug({ 
              where: 'saveCreativeMetricsToHistory',
              ad_id: mapping.ad_id 
            }, 'No insights for ad');
            continue;
          }

          // Извлекаем метрики
          const leads = extractLeads(insights.actions);
          const linkClicks = extractLinkClicks(insights.actions);
          const spend = parseFloat(insights.spend || 0);
          const videoMetrics = extractVideoMetrics(insights);
          
          // Вычисляем CPL в центах (если есть лиды)
          const cpl = leads > 0 ? (spend * 100 / leads) : null;

          records.push({
            user_account_id: userAccountId,
            date: today,
            ad_id: mapping.ad_id,
            creative_id: mapping.fb_creative_id,
            adset_id: mapping.adset_id,
            campaign_id: mapping.campaign_id,
            impressions: parseInt(insights.impressions || 0),
            reach: parseInt(insights.reach || 0),
            spend: spend,
            clicks: parseInt(insights.clicks || 0),
            link_clicks: linkClicks,
            leads: leads,
            ctr: parseFloat(insights.ctr || 0),
            cpm: parseFloat(insights.cpm || 0),
            cpl: cpl,
            frequency: parseFloat(insights.frequency || 0),
            // Video metrics
            video_views: videoMetrics.video_views,
            video_views_25_percent: videoMetrics.video_views_25_percent,
            video_views_50_percent: videoMetrics.video_views_50_percent,
            video_views_75_percent: videoMetrics.video_views_75_percent,
            video_views_95_percent: videoMetrics.video_views_95_percent,
            video_avg_watch_time_sec: videoMetrics.video_avg_watch_time_sec,
            source: 'production'
          });

          logger.debug({ 
            where: 'saveCreativeMetricsToHistory',
            ad_id: mapping.ad_id,
            impressions: insights.impressions,
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
          ignoreDuplicates: false 
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
          saved_count: records.length 
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
      where: 'saveCreativeMetricsToHistory' 
    }, 'No metrics to save');
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
 */
export async function runScoringAgent(userAccount, options = {}) {
  const startTime = Date.now();
  const { ad_account_id, access_token, id: userAccountId, username } = userAccount;
  
  const supabase = options.supabase || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE
  );
  
  const logger = options.logger || console;
  
  logger.info({ where: 'scoring_agent', phase: 'start', userId: userAccountId, username });
  
  try {
    // ========================================
    // ЧАСТЬ 1: АКТИВНЫЕ ADSETS (ОСНОВНОЕ!)
    // ========================================
    
    logger.info({ where: 'scoring_agent', phase: 'fetching_adsets' });

    // Fetch данные: daily breakdown (для трендов) + агрегированные actions + diagnostics + objectives
    const [dailyData, actionsData, diagnostics, campaignObjectives] = await Promise.all([
      fetchAdsetsDaily(ad_account_id, access_token, 14),
      fetchAdsetsActions(ad_account_id, access_token, 'last_7d'),
      fetchAdsetDiagnostics(ad_account_id, access_token),
      getAdsetsObjectives(supabase, userAccountId)
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
      await saveMetricsSnapshot(supabase, userAccountId, adsetsWithTrends);
    }
    
    // ========================================
    // ЧАСТЬ 2: ГОТОВЫЕ КРЕАТИВЫ
    // ========================================
    
    logger.info({ where: 'scoring_agent', phase: 'fetching_creatives' });
    
    const userCreatives = await getActiveCreatives(supabase, userAccountId);
    
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
        const stats = await fetchCreativeInsights(
          ad_account_id,
          access_token,
          uc.fb_creative_id_whatsapp,
          { date_preset: 'last_30d' }
        );
        
        if (stats) {
          creatives.push({
            objective: 'MESSAGES',
            fb_creative_id: uc.fb_creative_id_whatsapp,
            performance: stats
          });
        }
      }
      
      // Site Leads (OUTCOME_LEADS)
      if (uc.fb_creative_id_site_leads) {
        const stats = await fetchCreativeInsights(
          ad_account_id,
          access_token,
          uc.fb_creative_id_site_leads,
          { date_preset: 'last_30d' }
        );
        
        if (stats) {
          creatives.push({
            objective: 'OUTCOME_LEADS',
            fb_creative_id: uc.fb_creative_id_site_leads,
            performance: stats
          });
        }
      }
      
      // Instagram Traffic (OUTCOME_TRAFFIC)
      if (uc.fb_creative_id_instagram_traffic) {
        const stats = await fetchCreativeInsights(
          ad_account_id,
          access_token,
          uc.fb_creative_id_instagram_traffic,
          { date_preset: 'last_30d' }
        );
        
        if (stats) {
          creatives.push({
            objective: 'OUTCOME_TRAFFIC',
            fb_creative_id: uc.fb_creative_id_instagram_traffic,
            performance: stats
          });
        }
      }
      
      if (creatives.length > 0) {
        // Добавляем ROI данные если есть
        const roiData = creativeROIMap.get(uc.id) || null;
        
        // Рассчитываем risk score с учетом ROI
        // Берем первый креатив для расчета (обычно это основной objective)
        const primaryCreative = creatives[0];
        const performance = primaryCreative?.performance || null;
        const targetCPL = 200; // Целевой CPL в центах (можно получить из настроек пользователя)
        const riskScore = calculateRiskScoreWithROI(performance, roiData, targetCPL);
        
        readyCreatives.push({
          name: uc.title,
          user_creative_id: uc.id,
          creatives: creatives,
          roi_data: roiData, // { revenue, spend, roi, conversions, leads }
          risk_score: riskScore // 0-100, с учетом ROI
        });
      }
    }
    
    logger.info({ 
      where: 'scoring_agent', 
      phase: 'creatives_processed',
      total: readyCreatives.length,
      with_stats: readyCreatives.filter(c => c.creatives.length > 0).length,
      with_roi: readyCreatives.filter(c => c.roi_data !== null).length
    });
    
    // ========================================
    // СОХРАНЯЕМ МЕТРИКИ КРЕАТИВОВ В ИСТОРИЮ
    // ========================================
    
    // НОВОЕ: Сохраняем метрики на уровне Ad для использования в auto-launch
    logger.info({ 
      where: 'scoring_agent', 
      phase: 'saving_metrics_to_history' 
    });
    
    try {
      await saveCreativeMetricsToHistory(
        supabase, 
        userAccountId, 
        readyCreatives, 
        ad_account_id, 
        access_token
      );
    } catch (error) {
      logger.error({ 
        where: 'scoring_agent',
        phase: 'save_metrics_failed',
        error: String(error) 
      }, 'Failed to save creative metrics to history, continuing...');
    }
    
    // ========================================
    // ОПРЕДЕЛЯЕМ НЕИСПОЛЬЗОВАННЫЕ КРЕАТИВЫ
    // ========================================
    
    const unusedCreatives = [];
    
    for (const uc of userCreatives) {
      // Проверяем все fb_creative_id этого креатива
      const creativeIds = [
        uc.fb_creative_id_whatsapp,
        uc.fb_creative_id_instagram_traffic,
        uc.fb_creative_id_site_leads
      ].filter(id => id);
      
      // Если НИ ОДИН из creative_id не используется в активных ads
      const isUnused = creativeIds.length > 0 && 
                       !creativeIds.some(id => activeCreativeIds.creativeIdsSet.has(id));
      
      if (isUnused) {
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
          direction_id: uc.direction_id  // ВАЖНО: привязка к направлению
        });
      }
    }
    
    logger.info({ 
      where: 'scoring_agent', 
      phase: 'unused_creatives_identified',
      count: unusedCreatives.length
    });
    
    // ========================================
    // ЧАСТЬ 3: ФОРМИРОВАНИЕ RAW OUTPUT (БЕЗ LLM!)
    // ========================================
    
    // Возвращаем только RAW данные, без LLM анализа
    const scoringRawData = {
      adsets: adsetsWithTrends,
      ready_creatives: readyCreatives,
      unused_creatives: unusedCreatives  // НОВОЕ!
    };
    
    logger.info({ 
      where: 'scoring_agent', 
      phase: 'data_collected',
      adsets_count: adsetsWithTrends.length,
      creatives_count: readyCreatives.length
    });
    
    // ========================================
    // ЧАСТЬ 4: СОХРАНЕНИЕ РЕЗУЛЬТАТОВ (опционально)
    // ========================================
    
    const duration = Date.now() - startTime;
    
    // Сохраняем факт сбора данных для аудита
    if (options.saveExecution !== false) {
      await supabase.from('scoring_executions').insert({
        user_account_id: userAccountId,
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
    
    await supabase.from('scoring_executions').insert({
      user_account_id: userAccountId,
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

