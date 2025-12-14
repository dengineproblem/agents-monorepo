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

  async getCreativeDetails({ creative_id }, { userAccountId, adAccountId, adAccountDbId }) {
    const { data: creative, error } = await supabase
      .from('user_creatives')
      .select(`
        *,
        account_directions(id, name, objective, daily_budget_cents, target_cpl_cents),
        creative_transcripts(text, lang, status)
      `)
      .eq('id', creative_id)
      .eq('user_id', userAccountId)
      .single();

    if (error || !creative) {
      return { success: false, error: 'Креатив не найден' };
    }

    // Get ad mappings
    const { data: adMappings } = await supabase
      .from('ad_creative_mapping')
      .select('ad_id, adset_id, campaign_id, source, created_at')
      .eq('user_creative_id', creative_id);

    // Get latest analysis
    const { data: analysis } = await supabase
      .from('creative_analysis')
      .select('score, verdict, reasoning, created_at')
      .eq('creative_id', creative_id)
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

  async getCreativeMetrics({ creative_id, period = '30d' }, { userAccountId, adAccountId, adAccountDbId }) {
    // Use adAccountDbId (UUID) for database queries
    const dbAccountId = adAccountDbId || null;
    const days = parseInt(period) || 30;

    const { data, error } = await supabase.rpc('get_creative_aggregated_metrics', {
      p_user_creative_id: creative_id,
      p_user_account_id: userAccountId,
      p_account_id: dbAccountId,
      p_days_limit: days
    });

    if (error) {
      return { success: false, error: error.message };
    }

    // Calculate totals
    const totals = (data || []).reduce((acc, day) => ({
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

    return {
      success: true,
      creative_id,
      period,
      daily: data || [],
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

  async getCreativeAnalysis({ creative_id }, { userAccountId, adAccountId, adAccountDbId }) {
    const dbAccountId = adAccountDbId || null;

    let query = supabase
      .from('creative_analysis')
      .select('*')
      .eq('creative_id', creative_id)
      .eq('user_account_id', userAccountId)
      .order('created_at', { ascending: false })
      .limit(1);

    // Фильтр по account_id для мультиаккаунтности (если колонка есть в таблице)
    // Примечание: creative_analysis может не иметь account_id, тогда фильтр не применяется

    const { data, error } = await query.single();

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

  async getTopCreatives({ metric, direction_id, limit = 5 }, { userAccountId, adAccountId, adAccountDbId }) {
    // Get all creatives first
    const result = await creativeHandlers.getCreatives(
      { direction_id, status: 'active', limit: 50 },
      { userAccountId, adAccountId, adAccountDbId }
    );

    if (!result.success) return result;

    // Filter creatives with metrics
    let creatives = result.creatives.filter(c => c.metrics_30d.leads > 0 || c.metrics_30d.impressions > 0);

    // Sort by metric
    creatives.sort((a, b) => {
      const ma = a.metrics_30d;
      const mb = b.metrics_30d;
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

    return {
      success: true,
      metric,
      top_creatives: creatives.slice(0, limit)
    };
  },

  async getWorstCreatives({ threshold_cpl, direction_id, limit = 5 }, { userAccountId, adAccountId, adAccountDbId }) {
    const result = await creativeHandlers.getCreatives(
      { direction_id, status: 'active', limit: 50 },
      { userAccountId, adAccountId, adAccountDbId }
    );

    if (!result.success) return result;

    // Filter by CPL threshold if provided
    let creatives = result.creatives.filter(c => {
      if (!c.metrics_30d.cpl) return false;
      if (threshold_cpl) {
        return parseFloat(c.metrics_30d.cpl) > threshold_cpl;
      }
      return true;
    });

    // Sort by CPL descending (worst first)
    creatives.sort((a, b) => {
      return parseFloat(b.metrics_30d.cpl || 0) - parseFloat(a.metrics_30d.cpl || 0);
    });

    return {
      success: true,
      threshold_cpl,
      worst_creatives: creatives.slice(0, limit)
    };
  },

  async compareCreatives({ creative_ids, period = '30d' }, { userAccountId, adAccountId, adAccountDbId }) {
    if (!creative_ids || creative_ids.length < 2) {
      return { success: false, error: 'Нужно минимум 2 креатива для сравнения' };
    }

    if (creative_ids.length > 5) {
      return { success: false, error: 'Максимум 5 креативов для сравнения' };
    }

    const comparisons = await Promise.all(creative_ids.map(async (id) => {
      const [details, metrics] = await Promise.all([
        creativeHandlers.getCreativeDetails({ creative_id: id }, { userAccountId, adAccountId, adAccountDbId }),
        creativeHandlers.getCreativeMetrics({ creative_id: id, period }, { userAccountId, adAccountId, adAccountDbId })
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

    return {
      success: true,
      period,
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

  async getCreativeTranscript({ creative_id }, { userAccountId }) {
    const { data, error } = await supabase
      .from('creative_transcripts')
      .select('*')
      .eq('creative_id', creative_id)
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

  async launchCreative({ creative_id, direction_id, dry_run }, { userAccountId, adAccountId, accessToken }) {
    // Dry-run mode: return preview without executing
    if (dry_run) {
      return creativeDryRunHandlers.launchCreative({ creative_id, direction_id }, { userAccountId, adAccountId });
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

  async pauseCreative({ creative_id, reason, dry_run }, { userAccountId, accessToken, adAccountId }) {
    // Dry-run mode: return preview without executing
    if (dry_run) {
      return creativeDryRunHandlers.pauseCreative({ creative_id }, { userAccountId, adAccountId });
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

  async startCreativeTest({ creative_id, objective = 'whatsapp', dry_run }, { userAccountId, adAccountId }) {
    // Dry-run mode: return preview without executing
    if (dry_run) {
      return creativeDryRunHandlers.startCreativeTest({ creative_id, objective }, { userAccountId, adAccountId });
    }

    // Check if test already running
    const { data: existingTest } = await supabase
      .from('creative_tests')
      .select('id, status')
      .eq('user_creative_id', creative_id)
      .eq('status', 'running')
      .single();

    if (existingTest) {
      return { success: false, error: 'Тест уже запущен для этого креатива' };
    }

    // Create test record (actual FB campaign creation would be done by separate service)
    const { data: test, error } = await supabase
      .from('creative_tests')
      .insert({
        user_creative_id: creative_id,
        user_id: userAccountId,
        account_id: adAccountId,
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
  }
};
