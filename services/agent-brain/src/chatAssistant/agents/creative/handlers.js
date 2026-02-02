/**
 * CreativeAgent Handlers - Creative Management
 * Tool execution handlers for creative operations
 */

import { supabase } from '../../../lib/supabaseClient.js';
import { fbGraph } from '../../shared/fbGraph.js';
import { logger } from '../../../lib/logger.js';
import { creativeDryRunHandlers } from '../../shared/dryRunHandlers.js';
import { verifyAdStatus } from '../../shared/postCheck.js';
import { attachRefs, buildEntityMap } from '../../shared/entityLinker.js';

/**
 * Helper: Convert date_from/date_to or period to days limit for RPC
 * Returns days limit and optional date filter for post-filtering
 */
function getCreativeDateFilter({ date_from, date_to, period }) {
  const today = new Date().toISOString().split('T')[0];

  if (date_from) {
    // Calculate days from date_from to today (RPC counts back from today)
    const fromDate = new Date(date_from);
    const toDate = new Date(date_to || today);
    const todayDate = new Date(today);

    // Days from date_from to today — we fetch all, then filter
    const daysToFetch = Math.ceil((todayDate - fromDate) / (1000 * 60 * 60 * 24)) + 1;

    return {
      daysLimit: Math.max(daysToFetch, 7), // min 7 days to ensure data
      dateFrom: date_from,
      dateTo: date_to || today
    };
  }

  // Parse period preset
  const periodDays = {
    'last_3d': 3, '3d': 3,
    'last_7d': 7, '7d': 7,
    'last_14d': 14, '14d': 14,
    'last_30d': 30, '30d': 30,
    'last_90d': 90, '90d': 90,
    'last_6m': 180, '6m': 180,
    'last_12m': 365, '12m': 365,
    'all': 730
  };

  const days = periodDays[period] || 30;

  return {
    daysLimit: days,
    dateFrom: null,
    dateTo: null
  };
}

/**
 * Filter RPC results by date range if specified
 */
function filterByDateRange(data, dateFrom, dateTo) {
  if (!dateFrom || !data) return data;

  return data.filter(row => {
    const rowDate = row.date || row.report_date;
    if (!rowDate) return true;
    return rowDate >= dateFrom && rowDate <= dateTo;
  });
}

export const creativeHandlers = {
  // ============================================================
  // READ HANDLERS
  // ============================================================

  async getCreatives({ direction_id, status, sort_by, limit = 20 }, { userAccountId, adAccountId, adAccountDbId }) {
    // Use adAccountDbId (UUID) for database queries, not adAccountId (Facebook ID)
    const dbAccountId = adAccountDbId || null;

    let query = supabase
      .from('user_creatives')
      .select(`
        id, title, status, media_type, thumbnail_url, created_at,
        direction_id,
        account_directions(name, objective)
      `)
      .eq('user_id', userAccountId);

    if (dbAccountId) {
      query = query.eq('account_id', dbAccountId);
    }

    if (direction_id) {
      query = query.eq('direction_id', direction_id);
    }

    if (status === 'active') {
      query = query.eq('status', 'ready');
    }

    const { data: creatives, error } = await query.order('created_at', { ascending: false }).limit(limit);

    if (error) {
      return { success: false, error: error.message };
    }

    // Enrich with aggregated metrics for each creative
    const enrichedCreatives = await Promise.all(creatives.map(async (creative) => {
      const { data: metrics } = await supabase.rpc('get_creative_aggregated_metrics', {
        p_user_creative_id: creative.id,
        p_user_account_id: userAccountId,
        p_account_id: dbAccountId,
        p_days_limit: 30
      });

      // Sum up totals
      const totals = (metrics || []).reduce((acc, day) => ({
        impressions: acc.impressions + (day.total_impressions || 0),
        leads: acc.leads + (day.total_leads || 0),
        spend: acc.spend + parseFloat(day.total_spend || 0)
      }), { impressions: 0, leads: 0, spend: 0 });

      return {
        id: creative.id,
        title: creative.title,
        status: creative.status,
        media_type: creative.media_type,
        thumbnail_url: creative.thumbnail_url,
        direction: creative.account_directions?.name || null,
        created_at: creative.created_at,
        metrics_30d: {
          impressions: totals.impressions,
          leads: totals.leads,
          spend: totals.spend.toFixed(2),
          cpl: totals.leads > 0 ? (totals.spend / totals.leads).toFixed(2) : null
        }
      };
    }));

    // Sort if requested
    if (sort_by) {
      enrichedCreatives.sort((a, b) => {
        const ma = a.metrics_30d;
        const mb = b.metrics_30d;
        switch (sort_by) {
          case 'cpl':
            return (parseFloat(ma.cpl) || 999) - (parseFloat(mb.cpl) || 999);
          case 'leads':
            return (mb.leads || 0) - (ma.leads || 0);
          case 'spend':
            return parseFloat(mb.spend || 0) - parseFloat(ma.spend || 0);
          case 'created':
            return new Date(b.created_at) - new Date(a.created_at);
          default:
            return 0;
        }
      });
    }

    // Add entity refs for entity linking
    const creativesWithRefs = attachRefs(enrichedCreatives, 'cr');
    const entityMap = buildEntityMap(enrichedCreatives, 'cr');

    return {
      success: true,
      creatives: creativesWithRefs,
      total: enrichedCreatives.length,
      _entityMap: entityMap  // For saving to focus_entities
    };
  },

  // КРИТИЧНО: Добавлена фильтрация по account_id для мультиаккаунтности
  async getCreativeDetails({ creative_id }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;
    const filterMode = dbAccountId ? 'multi_account' : 'legacy';

    logger.info({
      handler: 'getCreativeDetails',
      creative_id,
      userAccountId,
      dbAccountId,
      filterMode
    }, `getCreativeDetails: загрузка данных креатива (${filterMode})`);

    // КРИТИЧНО: Фильтрация по account_id для мультиаккаунтности
    let creativeQuery = supabase
      .from('user_creatives')
      .select(`
        *,
        account_directions(id, name, objective, daily_budget_cents, target_cpl_cents),
        creative_transcripts(text, lang, status)
      `)
      .eq('id', creative_id)
      .eq('user_id', userAccountId);

    if (dbAccountId) {
      creativeQuery = creativeQuery.eq('account_id', dbAccountId);
    } else {
      creativeQuery = creativeQuery.is('account_id', null);
    }

    const { data: creative, error } = await creativeQuery.single();

    if (error || !creative) {
      return { success: false, error: 'Креатив не найден или недоступен' };
    }

    // Get ad mappings
    // КРИТИЧНО: Фильтрация по account_id для мультиаккаунтности
    let adMappingsQuery = supabase
      .from('ad_creative_mapping')
      .select('ad_id, adset_id, campaign_id, source, created_at')
      .eq('user_creative_id', creative_id);

    if (dbAccountId) {
      adMappingsQuery = adMappingsQuery.eq('account_id', dbAccountId);
    } else {
      adMappingsQuery = adMappingsQuery.is('account_id', null);
    }

    const { data: adMappings } = await adMappingsQuery;

    // Get latest analysis
    // КРИТИЧНО: Фильтрация по account_id для мультиаккаунтности
    let analysisQuery = supabase
      .from('creative_analysis')
      .select('score, verdict, reasoning, created_at')
      .eq('creative_id', creative_id);

    if (dbAccountId) {
      analysisQuery = analysisQuery.eq('account_id', dbAccountId);
    } else {
      analysisQuery = analysisQuery.is('account_id', null);
    }

    const { data: analysis } = await analysisQuery
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return {
      success: true,
      creative: {
        id: creative.id,
        title: creative.title,
        status: creative.status,
        media_type: creative.media_type,
        thumbnail_url: creative.thumbnail_url,
        fb_video_id: creative.fb_video_id,
        direction: creative.account_directions,
        transcript: creative.creative_transcripts?.[0]?.text || null,
        created_at: creative.created_at
      },
      ads: adMappings || [],
      analysis: analysis || null
    };
  },

  async getCreativeMetrics({ creative_id, period, date_from, date_to }, { userAccountId, adAccountId, adAccountDbId }) {
    // Use adAccountDbId (UUID) for database queries
    const dbAccountId = adAccountDbId || null;

    // Get date filter (supports date_from/date_to or period preset)
    const dateFilter = getCreativeDateFilter({ date_from, date_to, period });

    const { data, error } = await supabase.rpc('get_creative_aggregated_metrics', {
      p_user_creative_id: creative_id,
      p_user_account_id: userAccountId,
      p_account_id: dbAccountId,
      p_days_limit: dateFilter.daysLimit
    });

    if (error) {
      return { success: false, error: error.message };
    }

    // Filter by date range if date_from/date_to specified
    const filteredData = filterByDateRange(data, dateFilter.dateFrom, dateFilter.dateTo);

    // Calculate totals
    const totals = (filteredData || []).reduce((acc, day) => ({
      impressions: acc.impressions + (day.total_impressions || 0),
      reach: acc.reach + (day.total_reach || 0),
      clicks: acc.clicks + (day.total_clicks || 0),
      link_clicks: acc.link_clicks + (day.total_link_clicks || 0),
      leads: acc.leads + (day.total_leads || 0),
      spend: acc.spend + parseFloat(day.total_spend || 0),
      video_views: acc.video_views + (day.total_video_views || 0),
      video_views_25: acc.video_views_25 + (day.total_video_views_25 || 0),
      video_views_50: acc.video_views_50 + (day.total_video_views_50 || 0),
      video_views_75: acc.video_views_75 + (day.total_video_views_75 || 0),
      video_views_95: acc.video_views_95 + (day.total_video_views_95 || 0)
    }), {
      impressions: 0, reach: 0, clicks: 0, link_clicks: 0,
      leads: 0, spend: 0, video_views: 0,
      video_views_25: 0, video_views_50: 0, video_views_75: 0, video_views_95: 0
    });

    // Calculate retention percentages
    const retention = totals.video_views > 0 ? {
      '25%': ((totals.video_views_25 / totals.video_views) * 100).toFixed(1),
      '50%': ((totals.video_views_50 / totals.video_views) * 100).toFixed(1),
      '75%': ((totals.video_views_75 / totals.video_views) * 100).toFixed(1),
      '95%': ((totals.video_views_95 / totals.video_views) * 100).toFixed(1)
    } : null;

    // Build period info for response
    const periodInfo = date_from
      ? { date_from, date_to: date_to || new Date().toISOString().split('T')[0] }
      : { period: period || 'last_30d' };

    return {
      success: true,
      creative_id,
      ...periodInfo,
      daily: filteredData || [],
      totals: {
        impressions: totals.impressions,
        reach: totals.reach,
        clicks: totals.clicks,
        link_clicks: totals.link_clicks,
        leads: totals.leads,
        spend: totals.spend.toFixed(2),
        video_views: totals.video_views
      },
      calculated: {
        cpl: totals.leads > 0 ? (totals.spend / totals.leads).toFixed(2) : null,
        ctr: totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : null,
        cpm: totals.impressions > 0 ? ((totals.spend / totals.impressions) * 1000).toFixed(2) : null,
        frequency: totals.reach > 0 ? (totals.impressions / totals.reach).toFixed(2) : null
      },
      video_retention: retention
    };
  },

  // КРИТИЧНО: Исправлена фильтрация по account_id для мультиаккаунтности
  async getCreativeAnalysis({ creative_id }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;
    const filterMode = dbAccountId ? 'multi_account' : 'legacy';

    logger.info({
      handler: 'getCreativeAnalysis',
      creative_id,
      userAccountId,
      dbAccountId,
      filterMode
    }, `getCreativeAnalysis: загрузка анализа креатива (${filterMode})`);

    let query = supabase
      .from('creative_analysis')
      .select('*')
      .eq('creative_id', creative_id)
      .eq('user_account_id', userAccountId);

    // КРИТИЧНО: Фильтрация по account_id для мультиаккаунтности
    if (dbAccountId) {
      query = query.eq('account_id', dbAccountId);
    } else {
      query = query.is('account_id', null);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return {
        success: false,
        message: 'Анализ не найден. Используйте triggerCreativeAnalysis для запуска анализа.'
      };
    }

    return {
      success: true,
      analysis: {
        score: data.score,
        verdict: data.verdict,
        reasoning: data.reasoning,
        video_analysis: data.video_analysis,
        text_recommendations: data.text_recommendations,
        transcript_match_quality: data.transcript_match_quality,
        source: data.source,
        created_at: data.created_at
      }
    };
  },

  async getTopCreatives({ metric, direction_id, limit = 5, period, date_from, date_to }, { userAccountId, adAccountId, adAccountDbId }) {
    // Get all creatives first
    const result = await creativeHandlers.getCreatives(
      { direction_id, status: 'active', limit: 50 },
      { userAccountId, adAccountId, adAccountDbId }
    );

    if (!result.success) return result;

    // If custom period specified, enrich with metrics for that period
    let creatives = result.creatives;
    if (date_from || (period && period !== 'last_30d' && period !== '30d')) {
      // Fetch metrics for each creative with specified period
      creatives = await Promise.all(creatives.map(async (creative) => {
        const metricsResult = await creativeHandlers.getCreativeMetrics(
          { creative_id: creative.id, period, date_from, date_to },
          { userAccountId, adAccountId, adAccountDbId }
        );
        if (metricsResult.success) {
          return {
            ...creative,
            metrics: {
              impressions: metricsResult.totals.impressions,
              leads: metricsResult.totals.leads,
              spend: metricsResult.totals.spend,
              cpl: metricsResult.calculated.cpl
            }
          };
        }
        return { ...creative, metrics: creative.metrics_30d };
      }));
    } else {
      // Use default 30d metrics
      creatives = creatives.map(c => ({ ...c, metrics: c.metrics_30d }));
    }

    // Filter creatives with metrics
    creatives = creatives.filter(c => c.metrics.leads > 0 || c.metrics.impressions > 0);

    // Sort by metric
    creatives.sort((a, b) => {
      const ma = a.metrics;
      const mb = b.metrics;
      switch (metric) {
        case 'cpl':
          // Lower CPL is better
          return (parseFloat(ma.cpl) || 999) - (parseFloat(mb.cpl) || 999);
        case 'leads':
          return (mb.leads || 0) - (ma.leads || 0);
        case 'ctr':
          const ctrA = ma.impressions > 0 ? ma.leads / ma.impressions : 0;
          const ctrB = mb.impressions > 0 ? mb.leads / mb.impressions : 0;
          return ctrB - ctrA;
        default:
          return 0;
      }
    });

    // Build period info for response
    const periodInfo = date_from
      ? { date_from, date_to: date_to || new Date().toISOString().split('T')[0] }
      : { period: period || 'last_30d' };

    return {
      success: true,
      metric,
      ...periodInfo,
      top_creatives: creatives.slice(0, limit)
    };
  },

  async getWorstCreatives({ threshold_cpl, direction_id, limit = 5, period, date_from, date_to }, { userAccountId, adAccountId, adAccountDbId }) {
    const result = await creativeHandlers.getCreatives(
      { direction_id, status: 'active', limit: 50 },
      { userAccountId, adAccountId, adAccountDbId }
    );

    if (!result.success) return result;

    // If custom period specified, enrich with metrics for that period
    let creatives = result.creatives;
    if (date_from || (period && period !== 'last_30d' && period !== '30d')) {
      // Fetch metrics for each creative with specified period
      creatives = await Promise.all(creatives.map(async (creative) => {
        const metricsResult = await creativeHandlers.getCreativeMetrics(
          { creative_id: creative.id, period, date_from, date_to },
          { userAccountId, adAccountId, adAccountDbId }
        );
        if (metricsResult.success) {
          return {
            ...creative,
            metrics: {
              impressions: metricsResult.totals.impressions,
              leads: metricsResult.totals.leads,
              spend: metricsResult.totals.spend,
              cpl: metricsResult.calculated.cpl
            }
          };
        }
        return { ...creative, metrics: creative.metrics_30d };
      }));
    } else {
      // Use default 30d metrics
      creatives = creatives.map(c => ({ ...c, metrics: c.metrics_30d }));
    }

    // Filter by CPL threshold if provided
    creatives = creatives.filter(c => {
      if (!c.metrics.cpl) return false;
      if (threshold_cpl) {
        return parseFloat(c.metrics.cpl) > threshold_cpl;
      }
      return true;
    });

    // Sort by CPL descending (worst first)
    creatives.sort((a, b) => {
      return parseFloat(b.metrics.cpl || 0) - parseFloat(a.metrics.cpl || 0);
    });

    // Build period info for response
    const periodInfo = date_from
      ? { date_from, date_to: date_to || new Date().toISOString().split('T')[0] }
      : { period: period || 'last_30d' };

    return {
      success: true,
      threshold_cpl,
      ...periodInfo,
      worst_creatives: creatives.slice(0, limit)
    };
  },

  async compareCreatives({ creative_ids, period, date_from, date_to }, { userAccountId, adAccountId, adAccountDbId }) {
    if (!creative_ids || creative_ids.length < 2) {
      return { success: false, error: 'Нужно минимум 2 креатива для сравнения' };
    }

    if (creative_ids.length > 5) {
      return { success: false, error: 'Максимум 5 креативов для сравнения' };
    }

    const comparisons = await Promise.all(creative_ids.map(async (id) => {
      const [details, metrics] = await Promise.all([
        creativeHandlers.getCreativeDetails({ creative_id: id }, { userAccountId, adAccountId, adAccountDbId }),
        creativeHandlers.getCreativeMetrics({ creative_id: id, period, date_from, date_to }, { userAccountId, adAccountId, adAccountDbId })
      ]);

      return {
        creative_id: id,
        title: details.success ? details.creative.title : 'Unknown',
        metrics: metrics.success ? {
          totals: metrics.totals,
          calculated: metrics.calculated,
          video_retention: metrics.video_retention
        } : null
      };
    }));

    // Build period info for response
    const periodInfo = date_from
      ? { date_from, date_to: date_to || new Date().toISOString().split('T')[0] }
      : { period: period || 'last_30d' };

    return {
      success: true,
      ...periodInfo,
      comparison: comparisons
    };
  },

  async getCreativeScores({ level = 'creative', risk_level, limit = 20 }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    let query = supabase
      .from('creative_scores')
      .select('*')
      .eq('user_account_id', userAccountId)
      .eq('level', level)
      .order('date', { ascending: false });

    // Фильтр по account_id для мультиаккаунтности
    if (dbAccountId) {
      query = query.eq('account_id', dbAccountId);
    }

    if (risk_level && risk_level !== 'all') {
      query = query.eq('risk_level', risk_level);
    }

    const { data, error } = await query.limit(limit);

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      level,
      scores: data.map(s => ({
        creative_id: s.creative_id,
        adset_id: s.adset_id,
        name: s.name,
        risk_score: s.risk_score,
        risk_level: s.risk_level,
        prediction: {
          trend: s.prediction_trend,
          cpl_current: s.prediction_cpl_current,
          cpl_expected: s.prediction_cpl_expected,
          change_pct: s.prediction_change_pct
        },
        recommendations: s.recommendations,
        date: s.date
      }))
    };
  },

  async getCreativeTests({ creative_id }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    let query = supabase
      .from('creative_tests')
      .select('*')
      .eq('user_creative_id', creative_id)
      .eq('user_id', userAccountId)
      .order('created_at', { ascending: false });

    // Фильтр по account_id для мультиаккаунтности
    if (dbAccountId) {
      query = query.eq('account_id', dbAccountId);
    }

    const { data, error } = await query;

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      tests: data.map(t => ({
        id: t.id,
        status: t.status,
        objective: t.objective,
        started_at: t.started_at,
        completed_at: t.completed_at,
        metrics: {
          impressions: t.impressions,
          leads: t.leads,
          spend_cents: t.spend_cents,
          cpl_cents: t.cpl_cents,
          ctr: t.ctr,
          video_views: t.video_views,
          video_retention: {
            '25%': t.video_views_25_percent,
            '50%': t.video_views_50_percent,
            '75%': t.video_views_75_percent,
            '95%': t.video_views_95_percent
          }
        },
        analysis: {
          score: t.llm_score,
          verdict: t.llm_verdict,
          reasoning: t.llm_reasoning
        }
      }))
    };
  },

  // КРИТИЧНО: Добавлен adAccountDbId для мультиаккаунтности
  async getCreativeTranscript({ creative_id }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // КРИТИЧНО: Фильтрация по account_id для мультиаккаунтности
    let query = supabase
      .from('creative_transcripts')
      .select('*')
      .eq('creative_id', creative_id);

    if (dbAccountId) {
      query = query.eq('account_id', dbAccountId);
    } else {
      query = query.is('account_id', null);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return { success: false, message: 'Транскрипция не найдена' };
    }

    return {
      success: true,
      transcript: {
        text: data.text,
        lang: data.lang,
        source: data.source,
        confidence: data.confidence,
        duration_sec: data.duration_sec,
        status: data.status,
        created_at: data.created_at
      }
    };
  },

  // ============================================================
  // WRITE HANDLERS
  // ============================================================

  async triggerCreativeAnalysis({ creative_id }, { userAccountId, adAccountId, adAccountDbId }) {
    // Call the analyzer endpoint
    const analyzerUrl = process.env.ANALYZER_URL || 'http://localhost:7080';
    // Используем adAccountDbId (UUID) для БД операций, adAccountId (Facebook ID) для API
    const dbAccountId = adAccountDbId || null;

    try {
      const response = await fetch(`${analyzerUrl}/api/analyzer/analyze-creative`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creative_id,
          user_account_id: userAccountId,
          account_id: dbAccountId,  // UUID для БД
          fb_account_id: adAccountId  // Facebook ID для API вызовов
        })
      });

      const result = await response.json();

      if (!response.ok) {
        return { success: false, error: result.error || 'Ошибка анализа' };
      }

      return {
        success: true,
        message: 'Анализ запущен',
        analysis: result.analysis
      };
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to trigger creative analysis');
      return { success: false, error: 'Сервис анализа недоступен' };
    }
  },

  async launchCreative({ creative_id, direction_id, dry_run }, { userAccountId, adAccountId, adAccountDbId, accessToken }) {
    // Dry-run mode: return preview without executing
    if (dry_run) {
      return creativeDryRunHandlers.launchCreative({ creative_id, direction_id }, { userAccountId, adAccountId, adAccountDbId });
    }

    // Get creative details
    const { data: creative, error: creativeError } = await supabase
      .from('user_creatives')
      .select('*')
      .eq('id', creative_id)
      .eq('user_id', userAccountId)
      .single();

    if (creativeError || !creative) {
      return { success: false, error: 'Креатив не найден' };
    }

    if (!creative.fb_video_id && !creative.image_url) {
      return { success: false, error: 'Креатив не загружен в Facebook' };
    }

    // Get direction details
    const { data: direction, error: dirError } = await supabase
      .from('account_directions')
      .select('*')
      .eq('id', direction_id)
      .eq('user_account_id', userAccountId)
      .single();

    if (dirError || !direction) {
      return { success: false, error: 'Направление не найдено' };
    }

    if (!direction.fb_campaign_id) {
      return { success: false, error: 'Направление не привязано к Facebook кампании' };
    }

    // Get fb_creative_id for the direction's objective
    const fbCreativeField = `fb_creative_id_${direction.objective}`;
    const fbCreativeId = creative[fbCreativeField];

    if (!fbCreativeId) {
      return { success: false, error: `Креатив не создан для objective: ${direction.objective}` };
    }

    // Create ad in the campaign's first adset
    try {
      // Get adset from campaign
      const adsetsResult = await fbGraph('GET', `${direction.fb_campaign_id}/adsets`, accessToken, {
        fields: 'id,name,status',
        limit: 1
      });

      if (!adsetsResult.data?.length) {
        return { success: false, error: 'Нет активных адсетов в кампании' };
      }

      const adsetId = adsetsResult.data[0].id;

      // Create ad
      // Normalize: don't add act_ prefix if already present
      const actId = adAccountId?.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
      const adResult = await fbGraph('POST', `${actId}/ads`, accessToken, {
        name: `${creative.title} - Chat Assistant`,
        adset_id: adsetId,
        creative: JSON.stringify({ creative_id: fbCreativeId }),
        status: 'ACTIVE'
      });

      // Save mapping
      // Используем adAccountDbId (UUID) для account_id в БД
      const dbAccountId = adAccountDbId || null;
      await supabase.from('ad_creative_mapping').insert({
        ad_id: adResult.id,
        user_creative_id: creative_id,
        direction_id,
        user_id: userAccountId,
        account_id: dbAccountId,  // UUID для мультиаккаунтности
        adset_id: adsetId,
        campaign_id: direction.fb_campaign_id,
        fb_creative_id: fbCreativeId,
        source: 'chat_assistant'
      });

      // Log action
      await supabase.from('agent_logs').insert({
        ad_account_id: adAccountId,
        level: 'info',
        message: `Creative ${creative_id} launched to direction ${direction.name} via Chat Assistant`,
        context: { creative_id, direction_id, ad_id: adResult.id, source: 'CreativeAgent' }
      });

      return {
        success: true,
        message: `Креатив "${creative.title}" запущен в направление "${direction.name}"`,
        ad_id: adResult.id
      };
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to launch creative');
      return { success: false, error: error.message };
    }
  },

  async pauseCreative({ creative_id, reason, dry_run }, { userAccountId, accessToken, adAccountId, adAccountDbId }) {
    // Dry-run mode: return preview without executing
    if (dry_run) {
      return creativeDryRunHandlers.pauseCreative({ creative_id }, { userAccountId, adAccountId, adAccountDbId });
    }

    // Get all ads for this creative
    const { data: adMappings, error } = await supabase
      .from('ad_creative_mapping')
      .select('ad_id')
      .eq('user_creative_id', creative_id)
      .eq('user_id', userAccountId);

    if (error || !adMappings?.length) {
      return { success: false, error: 'Нет активных объявлений для этого креатива' };
    }

    // Pause each ad with post-check verification
    const results = await Promise.all(adMappings.map(async ({ ad_id }) => {
      try {
        await fbGraph('POST', ad_id, accessToken, { status: 'PAUSED' });

        // Post-check verification for each ad
        const verification = await verifyAdStatus(ad_id, 'PAUSED', accessToken);

        return {
          ad_id,
          success: true,
          verified: verification.verified,
          after: verification.after
        };
      } catch (err) {
        return { ad_id, success: false, error: err.message };
      }
    }));

    const successful = results.filter(r => r.success).length;
    const verified = results.filter(r => r.verified).length;

    // Log action
    await supabase.from('agent_logs').insert({
      ad_account_id: adAccountId,
      level: 'info',
      message: `Paused ${successful}/${results.length} ads for creative ${creative_id}`,
      context: {
        creative_id,
        reason,
        source: 'CreativeAgent',
        verified_count: verified
      }
    });

    return {
      success: true,
      message: `Поставлено на паузу ${successful} из ${results.length} объявлений`,
      verification: {
        total: results.length,
        successful,
        verified,
        warning: verified < successful ? 'Часть изменений не подтверждена' : null
      },
      results
    };
  },

  async startCreativeTest({ creative_id, objective = 'whatsapp', dry_run }, { userAccountId, adAccountId, adAccountDbId }) {
    // Use adAccountDbId (UUID) for database, adAccountId (Facebook ID) for API calls
    const dbAccountId = adAccountDbId || null;

    // Dry-run mode: return preview without executing
    if (dry_run) {
      return creativeDryRunHandlers.startCreativeTest({ creative_id, objective }, { userAccountId, adAccountId, adAccountDbId });
    }

    // Check if test already running
    // КРИТИЧНО: Фильтрация по account_id для мультиаккаунтности
    let existingTestQuery = supabase
      .from('creative_tests')
      .select('id, status')
      .eq('user_creative_id', creative_id)
      .eq('status', 'running');

    if (dbAccountId) {
      existingTestQuery = existingTestQuery.eq('account_id', dbAccountId);
    } else {
      existingTestQuery = existingTestQuery.is('account_id', null);
    }

    const { data: existingTest } = await existingTestQuery.single();

    if (existingTest) {
      return { success: false, error: 'Тест уже запущен для этого креатива' };
    }

    // Create test record (actual FB campaign creation would be done by separate service)
    const { data: test, error } = await supabase
      .from('creative_tests')
      .insert({
        user_creative_id: creative_id,
        user_id: userAccountId,
        account_id: dbAccountId,  // UUID from ad_accounts table
        objective,
        status: 'pending',
        test_budget_cents: 2000,
        test_impressions_limit: 1000
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      message: 'Тест поставлен в очередь на запуск',
      test_id: test.id,
      budget: '$20',
      impressions_limit: 1000
    };
  },

  async stopCreativeTest({ creative_id }, { userAccountId, accessToken }) {
    const { data: test, error } = await supabase
      .from('creative_tests')
      .select('*')
      .eq('user_creative_id', creative_id)
      .eq('user_id', userAccountId)
      .eq('status', 'running')
      .single();

    if (error || !test) {
      return { success: false, error: 'Активный тест не найден' };
    }

    // Stop the adset
    if (test.adset_id) {
      try {
        await fbGraph('POST', test.adset_id, accessToken, { status: 'PAUSED' });
      } catch (err) {
        logger.error({ error: err.message }, 'Failed to pause test adset');
      }
    }

    // Update test status
    await supabase
      .from('creative_tests')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('id', test.id);

    return {
      success: true,
      message: 'Тест остановлен'
    };
  },

  /**
   * generateCreatives - Генерация креатива-картинки (single image)
   * Вызывает /generate-creative endpoint Creative Generation Service
   */
  async generateCreatives({ offer, bullets, profits, cta, direction_id, style_id, style_prompt, reference_image }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    // Check if creative generation service is configured
    const creativeServiceUrl = process.env.CREATIVE_GENERATION_URL;

    if (!creativeServiceUrl) {
      return {
        success: true,
        status: 'not_configured',
        message: 'Сервис генерации креативов не подключен',
        setup_guide: 'Для автоматической генерации креативов необходимо подключить Creative Generation Service.',
        recommendations: [
          'Вы можете загрузить креативы вручную через интерфейс',
          'Или использовать существующие креативы из библиотеки'
        ]
      };
    }

    try {
      const response = await fetch(`${creativeServiceUrl}/generate-creative`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userAccountId,
          account_id: dbAccountId,
          offer: offer || '',
          bullets: bullets || '',
          profits: profits || '',
          cta: cta || '',
          direction_id: direction_id || null,
          style_id: style_id || 'modern_performance',
          style_prompt: style_prompt || null,
          reference_image: reference_image || null
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        logger.error({ status: response.status, error: errorData }, 'Image creative generation failed');

        return {
          success: false,
          error: errorData.error || 'Ошибка генерации креатива',
          error_details: errorData.details
        };
      }

      const result = await response.json();

      // Log the generation
      await supabase.from('agent_logs').insert({
        ad_account_id: dbAccountId,
        level: 'info',
        message: `Image creative generated via Chat Assistant`,
        context: {
          creative_id: result.creative_id,
          style_id: style_id || 'modern_performance',
          source: 'CreativeAgent'
        }
      }).catch(() => {});

      return {
        success: true,
        creative_id: result.creative_id,
        image_url: result.image_url,
        generations_remaining: result.generations_remaining,
        message: 'Креатив успешно сгенерирован'
      };

    } catch (error) {
      logger.error({ error: error.message }, 'Failed to call creative generation service');

      return {
        success: false,
        error: 'Сервис генерации временно недоступен',
        recommendations: ['Попробуйте позже', 'Или загрузите креативы вручную']
      };
    }
  },

  /**
   * generateCarousel - Генерация карусели (2-10 карточек)
   * Вызывает /generate-carousel endpoint Creative Generation Service
   */
  async generateCarousel({ carousel_texts, visual_style, style_prompt, reference_image, direction_id }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    const creativeServiceUrl = process.env.CREATIVE_GENERATION_URL;

    if (!creativeServiceUrl) {
      return {
        success: true,
        status: 'not_configured',
        message: 'Сервис генерации креативов не подключен',
        setup_guide: 'Для генерации каруселей необходимо подключить Creative Generation Service.'
      };
    }

    if (!carousel_texts || carousel_texts.length < 2 || carousel_texts.length > 10) {
      return {
        success: false,
        error: 'Для карусели нужно от 2 до 10 текстов карточек'
      };
    }

    try {
      const response = await fetch(`${creativeServiceUrl}/generate-carousel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userAccountId,
          account_id: dbAccountId,
          carousel_texts,
          visual_style: visual_style || 'clean_minimal',
          style_prompt: style_prompt || null,
          reference_image: reference_image || null,
          direction_id: direction_id || null
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        logger.error({ status: response.status, error: errorData }, 'Carousel generation failed');

        return {
          success: false,
          error: errorData.error || 'Ошибка генерации карусели'
        };
      }

      const result = await response.json();

      // Log the generation
      await supabase.from('agent_logs').insert({
        ad_account_id: dbAccountId,
        level: 'info',
        message: `Carousel (${carousel_texts.length} cards) generated via Chat Assistant`,
        context: {
          carousel_id: result.carousel_id,
          cards_count: carousel_texts.length,
          source: 'CreativeAgent'
        }
      }).catch(() => {});

      return {
        success: true,
        carousel_id: result.carousel_id,
        carousel_data: result.carousel_data,
        generations_remaining: result.generations_remaining,
        message: `Карусель из ${carousel_texts.length} карточек успешно сгенерирована`
      };

    } catch (error) {
      logger.error({ error: error.message }, 'Failed to generate carousel');

      return {
        success: false,
        error: 'Сервис генерации временно недоступен'
      };
    }
  },

  /**
   * generateTextCreative - Генерация текстового креатива
   * Вызывает /generate-text-creative endpoint Creative Generation Service
   */
  async generateTextCreative({ text_type, user_prompt }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    const creativeServiceUrl = process.env.CREATIVE_GENERATION_URL;

    if (!creativeServiceUrl) {
      return {
        success: true,
        status: 'not_configured',
        message: 'Сервис генерации креативов не подключен',
        setup_guide: 'Для генерации текстовых креативов необходимо подключить Creative Generation Service.'
      };
    }

    const validTypes = ['storytelling', 'direct_offer', 'expert_video', 'telegram_post', 'threads_post', 'reference'];
    if (!validTypes.includes(text_type)) {
      return {
        success: false,
        error: `Неверный тип текста. Доступные: ${validTypes.join(', ')}`
      };
    }

    try {
      const response = await fetch(`${creativeServiceUrl}/generate-text-creative`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userAccountId,
          text_type,
          user_prompt: user_prompt || ''
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        logger.error({ status: response.status, error: errorData }, 'Text creative generation failed');

        return {
          success: false,
          error: errorData.error || 'Ошибка генерации текста'
        };
      }

      const result = await response.json();

      // Log the generation
      await supabase.from('agent_logs').insert({
        ad_account_id: dbAccountId,
        level: 'info',
        message: `Text creative (${text_type}) generated via Chat Assistant`,
        context: {
          text_type,
          generation_id: result.generation_id,
          source: 'CreativeAgent'
        }
      }).catch(() => {});

      return {
        success: true,
        text: result.text,
        generation_id: result.generation_id,
        text_type,
        message: `Текстовый креатив "${text_type}" успешно сгенерирован`
      };

    } catch (error) {
      logger.error({ error: error.message }, 'Failed to generate text creative');

      return {
        success: false,
        error: 'Сервис генерации временно недоступен'
      };
    }
  },

  /**
   * generateCarouselTexts - Генерация текстов для карусели
   * Вызывает /generate-carousel-texts endpoint для получения текстов карточек
   */
  async generateCarouselTexts({ carousel_idea, cards_count }, { userAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    const creativeServiceUrl = process.env.CREATIVE_GENERATION_URL;

    if (!creativeServiceUrl) {
      return {
        success: true,
        status: 'not_configured',
        message: 'Сервис генерации креативов не подключен'
      };
    }

    if (!cards_count || cards_count < 2 || cards_count > 10) {
      return {
        success: false,
        error: 'Количество карточек должно быть от 2 до 10'
      };
    }

    try {
      const response = await fetch(`${creativeServiceUrl}/generate-carousel-texts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userAccountId,
          account_id: dbAccountId,
          carousel_idea: carousel_idea || '',
          cards_count
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        logger.error({ status: response.status, error: errorData }, 'Carousel texts generation failed');

        return {
          success: false,
          error: errorData.error || 'Ошибка генерации текстов'
        };
      }

      const result = await response.json();

      return {
        success: true,
        texts: result.texts,
        message: `Сгенерировано ${result.texts?.length || 0} текстов для карусели`
      };

    } catch (error) {
      logger.error({ error: error.message }, 'Failed to generate carousel texts');

      return {
        success: false,
        error: 'Сервис генерации временно недоступен'
      };
    }
  },

  // ============================================================
  // TEXT ELEMENT GENERATION (for image creative flow)
  // Flow: generateOffer → generateBullets → generateProfits → generateCta → generateCreatives
  // ============================================================

  /**
   * generateOffer - Генерация заголовка/оффера для креатива
   */
  async generateOffer({ prompt, existing_bullets, existing_profits, existing_cta }, { userAccountId }) {
    const creativeServiceUrl = process.env.CREATIVE_GENERATION_URL;

    if (!creativeServiceUrl) {
      return {
        success: false,
        error: 'Сервис генерации не подключен'
      };
    }

    try {
      const response = await fetch(`${creativeServiceUrl}/generate-offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userAccountId,
          prompt: prompt || '',
          existing_bullets: existing_bullets || '',
          existing_benefits: existing_profits || '',
          existing_cta: existing_cta || ''
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { success: false, error: errorData.error || 'Ошибка генерации оффера' };
      }

      const result = await response.json();
      return {
        success: true,
        offer: result.offer,
        message: 'Оффер сгенерирован. Можете отредактировать или перегенерировать.'
      };

    } catch (error) {
      logger.error({ error: error.message }, 'Failed to generate offer');
      return { success: false, error: 'Сервис генерации временно недоступен' };
    }
  },

  /**
   * generateBullets - Генерация буллетов/преимуществ
   */
  async generateBullets({ prompt, existing_offer, existing_profits, existing_cta }, { userAccountId }) {
    const creativeServiceUrl = process.env.CREATIVE_GENERATION_URL;

    if (!creativeServiceUrl) {
      return { success: false, error: 'Сервис генерации не подключен' };
    }

    try {
      const response = await fetch(`${creativeServiceUrl}/generate-bullets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userAccountId,
          prompt: prompt || '',
          existing_offer: existing_offer || '',
          existing_benefits: existing_profits || '',
          existing_cta: existing_cta || ''
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { success: false, error: errorData.error || 'Ошибка генерации буллетов' };
      }

      const result = await response.json();
      return {
        success: true,
        bullets: result.bullets,
        message: 'Буллеты сгенерированы. Можете отредактировать или перегенерировать.'
      };

    } catch (error) {
      logger.error({ error: error.message }, 'Failed to generate bullets');
      return { success: false, error: 'Сервис генерации временно недоступен' };
    }
  },

  /**
   * generateProfits - Генерация выгод для клиента
   */
  async generateProfits({ prompt, existing_offer, existing_bullets, existing_cta }, { userAccountId }) {
    const creativeServiceUrl = process.env.CREATIVE_GENERATION_URL;

    if (!creativeServiceUrl) {
      return { success: false, error: 'Сервис генерации не подключен' };
    }

    try {
      const response = await fetch(`${creativeServiceUrl}/generate-profits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userAccountId,
          prompt: prompt || '',
          existing_offer: existing_offer || '',
          existing_bullets: existing_bullets || '',
          existing_cta: existing_cta || ''
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { success: false, error: errorData.error || 'Ошибка генерации выгод' };
      }

      const result = await response.json();
      return {
        success: true,
        profits: result.profits,
        message: 'Выгоды сгенерированы. Можете отредактировать или перегенерировать.'
      };

    } catch (error) {
      logger.error({ error: error.message }, 'Failed to generate profits');
      return { success: false, error: 'Сервис генерации временно недоступен' };
    }
  },

  /**
   * generateCta - Генерация призыва к действию (CTA)
   */
  async generateCta({ prompt, existing_offer, existing_bullets, existing_profits }, { userAccountId }) {
    const creativeServiceUrl = process.env.CREATIVE_GENERATION_URL;

    if (!creativeServiceUrl) {
      return { success: false, error: 'Сервис генерации не подключен' };
    }

    try {
      const response = await fetch(`${creativeServiceUrl}/generate-cta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userAccountId,
          prompt: prompt || '',
          existing_offer: existing_offer || '',
          existing_bullets: existing_bullets || '',
          existing_benefits: existing_profits || ''
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { success: false, error: errorData.error || 'Ошибка генерации CTA' };
      }

      const result = await response.json();
      return {
        success: true,
        cta: result.cta,
        message: 'CTA сгенерирован. Можете отредактировать или перегенерировать.'
      };

    } catch (error) {
      logger.error({ error: error.message }, 'Failed to generate cta');
      return { success: false, error: 'Сервис генерации временно недоступен' };
    }
  }
};
