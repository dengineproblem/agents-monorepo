/**
 * ОТДЕЛЬНЫЙ МИКРОСЕРВИС: Creative Test Analyzer
 * 
 * НЕ ТРОГАЕТ основной Brain Agent!
 * Имеет свой промпт, свой порт, свою логику
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { analyzeCreativeTest } from './creativeAnalyzer.js';

const fastify = Fastify({ logger: true });

// CORS для фронтенда
await fastify.register(cors, {
  origin: true, // Разрешить все origin (или укажи конкретный домен)
  credentials: true
});

// Supabase клиент
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Кеш для аналитики (защита от частых LLM запросов)
const analyticsCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 минут
const FB_API_VERSION = 'v20.0';

/**
 * Helper: Получить данные из кеша
 */
function getCachedAnalytics(cacheKey) {
  const cached = analyticsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

/**
 * Helper: Сохранить данные в кеш
 */
function setCachedAnalytics(cacheKey, data) {
  analyticsCache.set(cacheKey, {
    data: data,
    timestamp: Date.now()
  });
}

/**
 * Helper: Нормализация ad_account_id
 */
function normalizeAdAccountId(adAccountId) {
  if (!adAccountId) return null;
  return adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
}

/**
 * Получить lifetime метрики креатива из Facebook API
 */
async function fetchProductionMetrics(adAccountId, accessToken, fbCreativeId) {
  const normalizedId = normalizeAdAccountId(adAccountId);
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${normalizedId}/insights`);
  
  url.searchParams.set('level', 'ad');
  url.searchParams.set('filtering', JSON.stringify([
    { field: 'ad.creative_id', operator: 'EQUAL', value: fbCreativeId }
  ]));
  
  // Запрашиваем все нужные поля, включая видео метрики
  url.searchParams.set('fields', [
    'impressions',
    'reach',
    'frequency',
    'clicks',
    'actions',
    'spend',
    'cpm',
    'cpc',
    'ctr',
    'video_play_actions',
    'video_avg_time_watched_actions',
    'video_p25_watched_actions',
    'video_p50_watched_actions',
    'video_p75_watched_actions',
    'video_p95_watched_actions'
  ].join(','));
  
  url.searchParams.set('date_preset', 'lifetime'); // Весь период!
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);
  
  fastify.log.info({ fb_creative_id: fbCreativeId }, 'Fetching production metrics from Facebook');
  
  const res = await fetch(url.toString());
  
  if (!res.ok) {
    if (res.status === 400) {
      // Креатив не используется или нет показов
      return null;
    }
    const err = await res.text();
    throw new Error(`FB production insights failed: ${res.status} ${err}`);
  }
  
  const json = await res.json();
  const data = json.data || [];
  
  if (!data.length) {
    return null; // Нет данных
  }
  
  // Агрегируем метрики по всем ads с этим креативом
  const totalImpressions = data.reduce((sum, d) => sum + (parseFloat(d.impressions) || 0), 0);
  const totalSpend = data.reduce((sum, d) => sum + (parseFloat(d.spend) || 0), 0);
  const totalReach = data.reduce((sum, d) => sum + (parseFloat(d.reach) || 0), 0);
  const totalClicks = data.reduce((sum, d) => sum + (parseFloat(d.clicks) || 0), 0);
  const avgCTR = data.reduce((sum, d) => sum + (parseFloat(d.ctr) || 0), 0) / data.length;
  const avgCPM = data.reduce((sum, d) => sum + (parseFloat(d.cpm) || 0), 0) / data.length;
  const avgCPC = data.reduce((sum, d) => sum + (parseFloat(d.cpc) || 0), 0) / data.length;
  const avgFrequency = data.reduce((sum, d) => sum + (parseFloat(d.frequency) || 0), 0) / data.length;
  
  // Извлекаем leads из actions
  let totalLeads = 0;
  let totalLinkClicks = 0;
  
  for (const d of data) {
    if (d.actions) {
      // Leads
      const leadAction = d.actions.find(a => 
        a.action_type === 'lead' || 
        a.action_type === 'onsite_conversion.lead_grouped' ||
        a.action_type === 'onsite_conversion.total_messaging_connection' ||
        a.action_type === 'onsite_conversion.messaging_user_depth_2_message_send'
      );
      if (leadAction) {
        totalLeads += parseFloat(leadAction.value) || 0;
      }
      
      // Link clicks
      const linkClickAction = d.actions.find(a => a.action_type === 'link_click');
      if (linkClickAction) {
        totalLinkClicks += parseFloat(linkClickAction.value) || 0;
      }
    }
  }
  
  // Видео метрики
  let totalVideoViews = 0;
  let totalVideo25 = 0;
  let totalVideo50 = 0;
  let totalVideo75 = 0;
  let totalVideo95 = 0;
  let totalVideoAvgTime = 0;
  let videoDataCount = 0;
  
  for (const d of data) {
    if (d.video_play_actions && d.video_play_actions.length > 0) {
      totalVideoViews += parseFloat(d.video_play_actions[0].value) || 0;
    }
    if (d.video_p25_watched_actions && d.video_p25_watched_actions.length > 0) {
      totalVideo25 += parseFloat(d.video_p25_watched_actions[0].value) || 0;
    }
    if (d.video_p50_watched_actions && d.video_p50_watched_actions.length > 0) {
      totalVideo50 += parseFloat(d.video_p50_watched_actions[0].value) || 0;
    }
    if (d.video_p75_watched_actions && d.video_p75_watched_actions.length > 0) {
      totalVideo75 += parseFloat(d.video_p75_watched_actions[0].value) || 0;
    }
    if (d.video_p95_watched_actions && d.video_p95_watched_actions.length > 0) {
      totalVideo95 += parseFloat(d.video_p95_watched_actions[0].value) || 0;
    }
    if (d.video_avg_time_watched_actions && d.video_avg_time_watched_actions.length > 0) {
      totalVideoAvgTime += parseFloat(d.video_avg_time_watched_actions[0].value) || 0;
      videoDataCount++;
    }
  }
  
  const avgVideoTime = videoDataCount > 0 ? totalVideoAvgTime / videoDataCount : 0;
  
  // Формируем объект в формате, идентичном creative_tests
  return {
    impressions: Math.round(totalImpressions),
    reach: Math.round(totalReach),
    frequency: avgFrequency,
    clicks: totalClicks,
    link_clicks: totalLinkClicks,
    ctr: avgCTR,
    link_ctr: totalLinkClicks > 0 ? (totalLinkClicks / totalImpressions) * 100 : 0,
    leads: totalLeads,
    spend_cents: Math.round(totalSpend * 100),
    cpm_cents: Math.round(avgCPM * 100),
    cpc_cents: Math.round(avgCPC * 100),
    cpl_cents: totalLeads > 0 ? Math.round((totalSpend / totalLeads) * 100) : null,
    video_views: totalVideoViews,
    video_views_25_percent: totalVideo25,
    video_views_50_percent: totalVideo50,
    video_views_75_percent: totalVideo75,
    video_views_95_percent: totalVideo95,
    video_avg_watch_time_sec: avgVideoTime
  };
}

/**
 * Health check
 */
fastify.get('/health', async () => ({ ok: true, service: 'creative-analyzer' }));

/**
 * POST /api/analyzer/analyze-test
 * 
 * Анализирует результаты быстрого теста креатива
 * 
 * ВХОДНЫЕ ДАННЫЕ:
 * - test_id: ID теста из creative_tests
 * 
 * ЧТО ДЕЛАЕТ:
 * 1. Получает данные теста из Supabase (метрики)
 * 2. Получает транскрибацию креатива
 * 3. Отправляет все в LLM (OpenAI)
 * 4. Получает анализ (score, verdict, recommendations)
 * 5. Сохраняет результаты в creative_tests
 */
fastify.post('/api/analyzer/analyze-test', async (request, reply) => {
  try {
    const { test_id } = request.body;
    
    if (!test_id) {
      return reply.code(400).send({ error: 'test_id required' });
    }

    fastify.log.info({ where: 'analyzeTest', test_id, status: 'started' });

    // ===================================================
    // STEP 1: Получаем данные теста из Supabase
    // ===================================================
    const { data: test, error: testError } = await supabase
      .from('creative_tests')
      .select(`
        *,
        user_creatives (
          id,
          title,
          user_id,
          fb_video_id
        )
      `)
      .eq('id', test_id)
      .single();

    if (testError || !test) {
      fastify.log.error({ where: 'analyzeTest', test_id, error: testError });
      return reply.code(404).send({ error: 'Test not found' });
    }

    // Можем анализировать как running так и completed тесты
    if (test.status !== 'running' && test.status !== 'completed') {
      return reply.code(400).send({ 
        error: 'Test must be in running or completed state', 
        current_status: test.status 
      });
    }

    // ===================================================
    // STEP 2: Получаем транскрибацию
    // ===================================================
    // ВАЖНО: В creative_transcripts поле называется creative_id, а не user_creative_id!
    const { data: transcript, error: transcriptError } = await supabase
      .from('creative_transcripts')
      .select('text')
      .eq('creative_id', test.user_creative_id)  // creative_id = user_creatives.id
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const transcriptText = transcript?.text || null;

    fastify.log.info({ 
      where: 'analyzeTest', 
      test_id, 
      has_transcript: !!transcriptText,
      impressions: test.impressions,
      leads: test.leads
    });

    // ===================================================
    // STEP 3: Подготавливаем данные для LLM
    // ===================================================
    const testData = {
      creative_title: test.user_creatives?.title || 'Untitled',
      impressions: test.impressions || 0,
      reach: test.reach || 0,
      frequency: test.frequency || 0,
      clicks: test.clicks || 0,
      link_clicks: test.link_clicks || 0,
      ctr: test.ctr || 0,
      link_ctr: test.link_ctr || 0,
      leads: test.leads || 0,
      spend_cents: test.spend_cents || 0,
      cpm_cents: test.cpm_cents || 0,
      cpc_cents: test.cpc_cents || 0,
      cpl_cents: test.cpl_cents || null,
      video_views: test.video_views || 0,
      video_views_25_percent: test.video_views_25_percent || 0,
      video_views_50_percent: test.video_views_50_percent || 0,
      video_views_75_percent: test.video_views_75_percent || 0,
      video_views_95_percent: test.video_views_95_percent || 0,
      video_avg_watch_time_sec: test.video_avg_watch_time_sec || 0
    };

    // ===================================================
    // STEP 4: Анализируем через LLM
    // ===================================================
    const analysis = await analyzeCreativeTest(testData, transcriptText);

    fastify.log.info({ 
      where: 'analyzeTest', 
      test_id, 
      llm_score: analysis.score,
      llm_verdict: analysis.verdict
    });

    // ===================================================
    // STEP 5: Сохраняем результаты в Supabase
    // ===================================================
    const { error: updateError } = await supabase
      .from('creative_tests')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        llm_score: analysis.score,
        llm_verdict: analysis.verdict,
        llm_reasoning: analysis.reasoning,
        llm_video_analysis: analysis.video_analysis,
        llm_text_recommendations: analysis.text_recommendations,
        transcript_match_quality: analysis.transcript_match_quality,
        transcript_suggestions: analysis.transcript_suggestions
      })
      .eq('id', test_id);

    if (updateError) {
      fastify.log.error({ where: 'analyzeTest', test_id, error: updateError });
      throw updateError;
    }

    return reply.send({
      success: true,
      test_id,
      analysis
    });
    
  } catch (error) {
    fastify.log.error({ where: 'analyzeTest', error: error.message });
    return reply.code(500).send({ error: error.message });
  }
});

/**
 * POST /api/analyzer/analyze-batch
 * 
 * Анализирует несколько тестов сразу (для cron)
 */
fastify.post('/api/analyzer/analyze-batch', async (request, reply) => {
  try {
    // Получаем все тесты готовые к анализу
    const { data: tests, error } = await supabase
      .from('creative_tests')
      .select('id')
      .eq('status', 'running')
      .gte('impressions', 1000);  // >= 1000 impressions

    if (error) {
      throw error;
    }

    if (!tests || tests.length === 0) {
      return reply.send({
        success: true,
        analyzed: 0,
        message: 'No tests ready for analysis'
      });
    }

    // Анализируем каждый тест
    const results = [];
    for (const test of tests) {
      try {
        const analyzeResponse = await fastify.inject({
          method: 'POST',
          url: '/api/analyzer/analyze-test',
          payload: { test_id: test.id }
        });
        
        results.push({
          test_id: test.id,
          success: analyzeResponse.statusCode === 200,
          result: analyzeResponse.json()
        });
      } catch (err) {
        results.push({
          test_id: test.id,
          success: false,
          error: err.message
        });
      }
    }

    return reply.send({
      success: true,
      analyzed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    });
    
  } catch (error) {
    fastify.log.error('Batch analysis error:', error);
    return reply.code(500).send({ error: error.message });
  }
});

/**
 * GET /api/analyzer/creative-analytics/:user_creative_id
 * 
 * Получить полную аналитику креатива (тест + production)
 * 
 * ВХОДНЫЕ ДАННЫЕ:
 * - user_creative_id: UUID креатива
 * - user_id: UUID пользователя (query param)
 * - force: Принудительное обновление (игнорировать кеш)
 * 
 * ЧТО ДЕЛАЕТ:
 * 1. Проверяет кеш (10 минут)
 * 2. Получает креатив из user_creatives
 * 3. Проверяет: используется ли в production?
 * 4. Получает метрики (test или production)
 * 5. Анализирует через LLM
 * 6. Возвращает результат с кешированием
 */
fastify.get('/api/analyzer/creative-analytics/:user_creative_id', async (request, reply) => {
  try {
    const { user_creative_id } = request.params;
    const { user_id, force } = request.query;
    
    if (!user_creative_id || !user_id) {
      return reply.code(400).send({ 
        error: 'user_creative_id and user_id are required' 
      });
    }

    const cacheKey = `analytics_${user_creative_id}`;
    
    // Проверяем кеш (если не force)
    if (!force) {
      const cached = getCachedAnalytics(cacheKey);
      if (cached) {
        fastify.log.info({ user_creative_id, from_cache: true }, 'Returning cached analytics');
        return reply.send({
          ...cached,
          from_cache: true,
          cached_at: new Date(analyticsCache.get(cacheKey).timestamp).toISOString()
        });
      }
    }

    fastify.log.info({ user_creative_id, user_id }, 'Fetching creative analytics');

    // ===================================================
    // STEP 1: Получаем креатив из Supabase
    // ===================================================
    const { data: creative, error: creativeError } = await supabase
      .from('user_creatives')
      .select(`
        id,
        title,
        user_id,
        status,
        fb_video_id,
        fb_creative_id_whatsapp,
        fb_creative_id_instagram_traffic,
        fb_creative_id_site_leads,
        direction_id,
        account_directions (
          id,
          name
        )
      `)
      .eq('id', user_creative_id)
      .eq('user_id', user_id)
      .single();

    if (creativeError || !creative) {
      fastify.log.error({ user_creative_id, error: creativeError }, 'Creative not found');
      return reply.code(404).send({ error: 'Creative not found' });
    }

    // ===================================================
    // STEP 2: Получаем данные пользователя (access_token, ad_account_id)
    // ===================================================
    const { data: userAccount, error: userError } = await supabase
      .from('user_accounts')
      .select('access_token, ad_account_id')
      .eq('id', user_id)
      .single();

    if (userError || !userAccount) {
      fastify.log.error({ user_id, error: userError }, 'User account not found');
      return reply.code(404).send({ error: 'User account not found' });
    }

    // ===================================================
    // STEP 3: Проверяем тест (если был)
    // ===================================================
    const { data: test, error: testError } = await supabase
      .from('creative_tests')
      .select('*')
      .eq('user_creative_id', user_creative_id)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    // ===================================================
    // STEP 4: Пробуем получить production метрики
    // ===================================================
    let productionMetrics = null;
    let dataSource = 'none';
    
    // Определяем какой fb_creative_id использовать (приоритет: whatsapp > instagram > site_leads)
    const fbCreativeId = creative.fb_creative_id_whatsapp || 
                         creative.fb_creative_id_instagram_traffic || 
                         creative.fb_creative_id_site_leads;
    
    if (fbCreativeId && userAccount.access_token && userAccount.ad_account_id) {
      try {
        productionMetrics = await fetchProductionMetrics(
          userAccount.ad_account_id,
          userAccount.access_token,
          fbCreativeId
        );
        
        if (productionMetrics) {
          dataSource = 'production';
          fastify.log.info({ user_creative_id, impressions: productionMetrics.impressions }, 'Production metrics found');
        }
      } catch (err) {
        fastify.log.warn({ user_creative_id, error: err.message }, 'Failed to fetch production metrics');
      }
    }
    
    // Если нет production, используем тест
    if (!productionMetrics && test) {
      dataSource = 'test';
    }

    // Если нет ни production, ни теста
    if (dataSource === 'none') {
      return reply.send({
        creative: {
          id: creative.id,
          title: creative.title,
          status: creative.status,
          direction_name: creative.account_directions?.name || null
        },
        data_source: 'none',
        message: 'Креатив не тестировался и не используется в рекламе',
        test: null,
        production: null,
        analysis: null
      });
    }

    // ===================================================
    // STEP 5: Получаем транскрибацию
    // ===================================================
    const { data: transcript } = await supabase
      .from('creative_transcripts')
      .select('text')
      .eq('creative_id', user_creative_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const transcriptText = transcript?.text || null;

    // ===================================================
    // STEP 6: Подготавливаем данные для LLM
    // ===================================================
    let metricsForAnalysis;
    
    if (dataSource === 'production') {
      metricsForAnalysis = {
        creative_title: creative.title,
        ...productionMetrics
      };
    } else {
      // Используем тест
      metricsForAnalysis = {
        creative_title: creative.title,
        impressions: test.impressions || 0,
        reach: test.reach || 0,
        frequency: test.frequency || 0,
        clicks: test.clicks || 0,
        link_clicks: test.link_clicks || 0,
        ctr: test.ctr || 0,
        link_ctr: test.link_ctr || 0,
        leads: test.leads || 0,
        spend_cents: test.spend_cents || 0,
        cpm_cents: test.cpm_cents || 0,
        cpc_cents: test.cpc_cents || 0,
        cpl_cents: test.cpl_cents || null,
        video_views: test.video_views || 0,
        video_views_25_percent: test.video_views_25_percent || 0,
        video_views_50_percent: test.video_views_50_percent || 0,
        video_views_75_percent: test.video_views_75_percent || 0,
        video_views_95_percent: test.video_views_95_percent || 0,
        video_avg_watch_time_sec: test.video_avg_watch_time_sec || 0
      };
    }

    // ===================================================
    // STEP 7: Анализируем через LLM (СУЩЕСТВУЮЩАЯ ФУНКЦИЯ!)
    // ===================================================
    fastify.log.info({ user_creative_id, data_source: dataSource }, 'Analyzing with LLM');
    
    const analysis = await analyzeCreativeTest(metricsForAnalysis, transcriptText);

    fastify.log.info({ 
      user_creative_id, 
      llm_score: analysis.score,
      llm_verdict: analysis.verdict
    }, 'LLM analysis complete');

    // ===================================================
    // STEP 8: Формируем ответ
    // ===================================================
    const result = {
      creative: {
        id: creative.id,
        title: creative.title,
        status: creative.status,
        direction_id: creative.direction_id,
        direction_name: creative.account_directions?.name || null
      },
      
      data_source: dataSource, // 'test' или 'production'
      
      test: test ? {
        exists: true,
        status: test.status,
        completed_at: test.completed_at,
        metrics: {
          impressions: test.impressions,
          reach: test.reach,
          leads: test.leads,
          cpl_cents: test.cpl_cents,
          ctr: test.ctr,
          video_views: test.video_views,
          video_views_25_percent: test.video_views_25_percent,
          video_views_50_percent: test.video_views_50_percent,
          video_views_75_percent: test.video_views_75_percent,
          video_views_95_percent: test.video_views_95_percent
        },
        llm_analysis: {
          score: test.llm_score,
          verdict: test.llm_verdict,
          reasoning: test.llm_reasoning
        }
      } : null,
      
      production: productionMetrics ? {
        in_use: true,
        metrics: productionMetrics
      } : null,
      
      analysis: {
        ...analysis,
        based_on: dataSource,
        note: dataSource === 'production' 
          ? 'Анализ основан на реальных данных из рекламы'
          : 'Анализ основан на результатах теста'
      }
    };

    // ===================================================
    // STEP 9: Сохраняем в кеш
    // ===================================================
    setCachedAnalytics(cacheKey, result);

    return reply.send({
      ...result,
      from_cache: false
    });
    
  } catch (error) {
    fastify.log.error({ error: error.message, stack: error.stack }, 'Creative analytics error');
    return reply.code(500).send({ error: error.message });
  }
});

// Запуск сервиса на отдельном порту
const ANALYZER_PORT = Number(process.env.ANALYZER_PORT || 7081);
fastify.listen({ host: '0.0.0.0', port: ANALYZER_PORT })
  .then(() => fastify.log.info(`Creative Analyzer listening on ${ANALYZER_PORT}`))
  .catch(err => { 
    fastify.log.error(err); 
    process.exit(1); 
  });
