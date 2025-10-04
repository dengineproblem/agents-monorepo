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
 * Fetch агрегированные actions для adsets (для WhatsApp метрик)
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
    console.log('[fetchAdsetsActions] Sample actions:', JSON.stringify({
      adset_id: sample.adset_id,
      action_types: sample.actions ? sample.actions.map(a => a.action_type) : null
    }));
  }
  
  return json.data || [];
}

/**
 * Группирует daily данные и вычисляет тренды для 1d, 3d, 7d
 * @param {Array} dailyData - данные с breakdown по дням
 * @param {Array} actionsData - агрегированные actions для WhatsApp метрик
 */
function calculateMultiPeriodTrends(dailyData, actionsData = []) {
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
    
    // Получаем WhatsApp метрики из агрегированных actions
    const actionsForAdset = actionsData.find(a => a.adset_id === adset.adset_id);
    const actions = actionsForAdset?.actions || [];
    
    // WhatsApp метрики:
    const linkClicksTotal = extractActionValue(actions, 'link_click');
    const conversationsTotal = extractActionValue(actions, 'onsite_conversion.total_messaging_connection'); // начатые переписки
    const qualityLeadsTotal = extractActionValue(actions, 'onsite_conversion.messaging_user_depth_2_message_send'); // качественные лиды (≥2 сообщения)
    
    // Для отладки: выводим все action_types
    const allActionTypes = actions.map(a => `${a.action_type}:${a.value}`).join(', ');
    
    let dataValid = true;
    let dataValidityReason = null;
    
    // Проверка валидности для WhatsApp кампаний
    if (linkClicksTotal > 0) {
      const conversionRate = conversationsTotal > 0 
        ? (conversationsTotal / linkClicksTotal) * 100 
        : 0;
      
      if (conversionRate < 10) { // менее 10% конверсия = невалидно
        dataValid = false;
        dataValidityReason = `Низкая конверсия WhatsApp: ${conversionRate.toFixed(1)}% (${linkClicksTotal} кликов → ${conversationsTotal} переписок). Возможно, лиды не прогрузились.`;
      }
    }
    
    result.push({
      adset_id: adset.adset_id,
      adset_name: adset.adset_name,
      campaign_id: adset.campaign_id,
      campaign_name: adset.campaign_name,
      metrics_last_7d: last7d,
      trends,
      data_valid: dataValid,
      data_validity_reason: dataValidityReason,
      whatsapp_metrics: {
        link_clicks: linkClicksTotal,
        conversations_started: conversationsTotal, // начатые переписки
        quality_leads: qualityLeadsTotal, // качественные лиды (≥2 сообщения)
        conversion_rate: linkClicksTotal > 0 ? ((conversationsTotal / linkClicksTotal) * 100).toFixed(1) : 0,
        quality_conversion_rate: linkClicksTotal > 0 ? ((qualityLeadsTotal / linkClicksTotal) * 100).toFixed(1) : 0,
        all_action_types: allActionTypes // для отладки
      }
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
 */
async function fetchCreativeInsights(adAccountId, accessToken, fbCreativeId, options = {}) {
  const normalizedId = normalizeAdAccountId(adAccountId);
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${normalizedId}/insights`);
  url.searchParams.set('level', 'ad');
  url.searchParams.set('filtering', JSON.stringify([
    { field: 'ad.creative_id', operator: 'EQUAL', value: fbCreativeId }
  ]));
  url.searchParams.set('fields', 'ctr,cpm,cpp,cpc,frequency,impressions,spend,actions,reach');
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);
  
  if (options.date_preset) {
    url.searchParams.set('date_preset', options.date_preset);
  } else if (options.time_range) {
    url.searchParams.set('time_range', JSON.stringify(options.time_range));
  } else {
    url.searchParams.set('date_preset', 'last_30d');
  }
  
  const res = await fetch(url.toString());
  if (!res.ok) {
    // Креатив может не иметь показов - это нормально
    if (res.status === 400) {
      return null;
    }
    const err = await res.text();
    throw new Error(`FB creative insights failed: ${res.status} ${err}`);
  }
  
  const json = await res.json();
  const data = json.data || [];
  
  if (!data.length) return null;
  
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
  const { data, error } = await supabase
    .from('user_creatives')
    .select('id, title, fb_video_id, fb_creative_id_whatsapp, fb_creative_id_instagram_traffic, fb_creative_id_site_leads, is_active, status')
    .eq('user_id', userAccountId)
    .eq('is_active', true)
    .eq('status', 'ready');
  
  if (error) throw new Error(`Failed to get active creatives: ${error.message}`);
  
  return data || [];
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
 * ОСНОВНАЯ ФУНКЦИЯ: Запуск Scoring Agent
 */
export async function runScoringAgent(userAccount, options = {}) {
  const startTime = Date.now();
  const { ad_account_id, access_token, id: userAccountId } = userAccount;
  
  const supabase = options.supabase || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  const logger = options.logger || console;
  
  logger.info({ where: 'scoring_agent', phase: 'start', userId: userAccountId });
  
  try {
    // ========================================
    // ЧАСТЬ 1: АКТИВНЫЕ ADSETS (ОСНОВНОЕ!)
    // ========================================
    
    logger.info({ where: 'scoring_agent', phase: 'fetching_adsets' });
    
    // Fetch данные: daily breakdown (для трендов) + агрегированные actions (для WhatsApp) + diagnostics
    const [dailyData, actionsData, diagnostics] = await Promise.all([
      fetchAdsetsDaily(ad_account_id, access_token, 14),
      fetchAdsetsActions(ad_account_id, access_token, 'last_7d'),
      fetchAdsetDiagnostics(ad_account_id, access_token)
    ]);
    
    // Группируем по adset_id и вычисляем метрики для разных периодов
    const adsetMetrics = calculateMultiPeriodTrends(dailyData, actionsData);
    
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
      
      return {
        adset_id: adset.adset_id,
        adset_name: adset.adset_name,
        campaign_id: adset.campaign_id,
        campaign_name: adset.campaign_name,
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
        data_validity_reason: adset.data_validity_reason,
        whatsapp_metrics: adset.whatsapp_metrics
      };
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
    
    logger.info({ where: 'scoring_agent', phase: 'creatives_fetched', count: userCreatives.length });
    
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
        readyCreatives.push({
          name: uc.title,
          creatives: creatives
        });
      }
    }
    
    logger.info({ 
      where: 'scoring_agent', 
      phase: 'creatives_processed',
      total: readyCreatives.length,
      with_stats: readyCreatives.filter(c => c.creatives.length > 0).length
    });
    
    // ========================================
    // ЧАСТЬ 3: ФОРМИРОВАНИЕ RAW OUTPUT (БЕЗ LLM!)
    // ========================================
    
    // Возвращаем только RAW данные, без LLM анализа
    const scoringRawData = {
      adsets: adsetsWithTrends,
      ready_creatives: readyCreatives
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

