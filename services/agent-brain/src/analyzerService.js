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
      // Leads - собираем все типы лидов, избегая дублирования
      let messagingLeads = 0;
      let siteLeads = 0;
      let formLeads = 0;

      for (const action of d.actions) {
        const t = action.action_type;
        const v = parseFloat(action.value) || 0;

        // WhatsApp лиды
        if (t === 'onsite_conversion.total_messaging_connection') {
          messagingLeads = v;
        }
        // Лид-формы
        else if (t === 'lead' || t === 'fb_form_lead' || (typeof t === 'string' && (t.includes('fb_form_lead') || t.includes('leadgen')))) {
          formLeads += v;
        }
        // Лиды с сайта - ТОЛЬКО offsite_conversion.fb_pixel_lead (избегаем дублирования с onsite_web_lead)
        else if (t === 'offsite_conversion.fb_pixel_lead') {
          siteLeads = v;
        }
        // Кастомные конверсии пикселя
        else if (typeof t === 'string' && t.startsWith('offsite_conversion.custom')) {
          siteLeads += v;
        }
      }

      totalLeads += messagingLeads + siteLeads + formLeads;

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
// Health check (без префикса, т.к. nginx проксирует /api/analyzer/ -> /)
fastify.get('/health', async () => ({ ok: true, service: 'creative-analyzer' }));

/**
 * POST /analyze-test (nginx проксирует /api/analyzer/analyze-test -> /analyze-test)
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
fastify.post('/analyze-test', async (request, reply) => {
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
          fb_video_id,
          media_type
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

    // Определяем тип медиа (video по умолчанию для обратной совместимости)
    const mediaType = test.user_creatives?.media_type || 'video';

    fastify.log.info({
      where: 'analyzeTest',
      test_id,
      media_type: mediaType,
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
    // STEP 4: Анализируем через LLM (с учетом типа медиа)
    // ===================================================
    const analysis = await analyzeCreativeTest(testData, transcriptText, mediaType);

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

    // ===================================================
    // STEP 5.5: Сохраняем анализ в creative_analysis для унифицированного доступа
    // ===================================================
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const { error: analysisInsertError } = await supabase
        .from('creative_analysis')
        .insert({
          creative_id: test.user_creative_id,
          user_account_id: test.user_id,
          source: 'test',
          test_id: test_id,
          date_from: today,
          date_to: today,
          metrics: testData,
          score: analysis?.score || null,
          verdict: analysis?.verdict || null,
          reasoning: analysis?.reasoning || null,
          video_analysis: analysis?.video_analysis || null,
          text_recommendations: analysis?.text_recommendations || null,
          transcript_match_quality: analysis?.transcript_match_quality || null,
          transcript_suggestions: analysis?.transcript_suggestions || null
        });

      if (analysisInsertError) {
        fastify.log.warn({ 
          test_id,
          creative_id: test.user_creative_id,
          error: analysisInsertError.message 
        }, 'Failed to save analysis to creative_analysis table');
      } else {
        fastify.log.info({ 
          test_id,
          creative_id: test.user_creative_id,
          source: 'test'
        }, 'Saved analysis to creative_analysis table');
      }
    } catch (err) {
      fastify.log.warn({ 
        test_id,
        error: err.message 
      }, 'Error saving analysis to creative_analysis, continuing...');
    }

    // ===================================================
    // STEP 6: Сохраняем метрики в creative_metrics_history
    // ===================================================
    // ПРАВИЛЬНО: Test ad имеет ДРУГОЙ ad_id, чем production ad
    // → нет конфликта! Можем хранить обе истории в одной таблице
    if (test.ad_id && test.user_creatives?.user_id) {
      try {
        const today = new Date().toISOString().split('T')[0];
        
        // Получаем fb_creative_id (используем whatsapp как primary)
        const fbCreativeId = test.user_creatives.fb_creative_id_whatsapp || 
                            test.user_creatives.fb_creative_id_instagram_traffic || 
                            test.user_creatives.fb_creative_id_site_leads ||
                            test.user_creatives.fb_video_id;
        
        if (!fbCreativeId) {
          fastify.log.warn({ 
            where: 'analyzeTest',
            test_id,
            creative_id: test.user_creative_id
          }, 'No fb_creative_id found, skipping creative_metrics_history save');
        } else {
          // Получаем user_account_id
          const { data: userAccount } = await supabase
            .from('user_accounts')
            .select('id')
            .eq('id', test.user_creatives.user_id)
            .single();
          
          if (userAccount) {
            const { error: historyError } = await supabase
              .from('creative_metrics_history')
              .upsert({
                user_account_id: userAccount.id,
                // user_creative_id заполнится автоматически через триггер на основе ad_id
                date: today,
                ad_id: test.ad_id,                    // Test ad (уникальный!)
                creative_id: fbCreativeId,
                adset_id: test.adset_id,
                campaign_id: test.campaign_id,
                impressions: test.impressions || 0,
                reach: test.reach || 0,
                spend: (test.spend_cents || 0) / 100,  // центы → доллары
                clicks: test.clicks || 0,
                link_clicks: test.link_clicks || 0,
                leads: test.leads || 0,
                ctr: test.ctr || 0,
                cpm: (test.cpm_cents || 0) / 100,      // центы → доллары
                cpl: test.cpl_cents ? (test.cpl_cents / 100) : null,
                frequency: test.frequency || 0,
                // Video metrics
                video_views: test.video_views || 0,
                video_views_25_percent: test.video_views_25_percent || 0,
                video_views_50_percent: test.video_views_50_percent || 0,
                video_views_75_percent: test.video_views_75_percent || 0,
                video_views_95_percent: test.video_views_95_percent || 0,
                video_avg_watch_time_sec: test.video_avg_watch_time_sec || null,
                source: 'test'
              }, { 
                onConflict: 'user_account_id,ad_id,date',
                ignoreDuplicates: false  // Обновляем если есть
              });

            if (historyError) {
              fastify.log.warn({ 
                where: 'analyzeTest',
                test_id,
                ad_id: test.ad_id,
                error: historyError.message 
              }, 'Failed to save test metrics to creative_metrics_history');
            } else {
              fastify.log.info({ 
                where: 'analyzeTest',
                test_id, 
                ad_id: test.ad_id,
                creative_id: fbCreativeId
              }, 'Saved test metrics to creative_metrics_history');
            }
          }
        }
      } catch (err) {
        fastify.log.warn({ 
          where: 'analyzeTest',
          test_id,
          error: err.message 
        }, 'Error saving test metrics to history, continuing...');
      }
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
 * POST /analyze-batch (nginx проксирует /api/analyzer/analyze-batch -> /analyze-batch)
 * 
 * Анализирует несколько тестов сразу (для cron)
 */
fastify.post('/analyze-batch', async (request, reply) => {
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
 * GET /creative-analytics/:user_creative_id (nginx проксирует /api/analyzer/creative-analytics -> /creative-analytics)
 * 
 * Получить аналитику ТЕСТА креатива (ТОЛЬКО тесты, НЕ production)
 * 
 * ВХОДНЫЕ ДАННЫЕ:
 * - user_creative_id: UUID креатива
 * - user_id: UUID пользователя (query param)
 * - force: Принудительное обновление (игнорировать кеш)
 * 
 * ЧТО ДЕЛАЕТ:
 * 1. Проверяет кеш (10 минут)
 * 2. Получает креатив из user_creatives
 * 3. Получает данные теста из creative_tests
 * 4. Анализирует через LLM (если тест завершен)
 * 5. Возвращает результат с кешированием
 * 
 * ПРИМЕЧАНИЕ: Для production метрик используй отдельный endpoint в agent-service
 */
fastify.get('/creative-analytics/:user_creative_id', async (request, reply) => {
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
        media_type,
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
    // STEP 3: Получаем данные теста (если был)
    // ===================================================
    const { data: allTests, error: testsError } = await supabase
      .from('creative_tests')
      .select('*')
      .eq('user_creative_id', user_creative_id)
      .order('started_at', { ascending: false });
    
    // Выбираем тест по приоритету: running > completed > cancelled > любой последний
    let test = null;
    if (allTests && allTests.length > 0) {
      const runningTest = allTests.find(t => t.status === 'running');
      const completedTest = allTests.find(t => t.status === 'completed');
      test = runningTest || completedTest || allTests[0];
    }

    // Если нет теста - возвращаем пустой результат
    if (!test) {
      return reply.send({
        creative: {
          id: creative.id,
          title: creative.title,
          status: creative.status,
          direction_id: creative.direction_id,
          direction_name: creative.account_directions?.name || null
        },
        test: {
          exists: false,
          message: 'Креатив не тестировался'
        },
        analysis: null
      });
    }

    // Если тест только запущен (нет данных) - возвращаем статус
    if (test.status === 'running' && (!test.impressions || test.impressions < 100)) {
      return reply.send({
        creative: {
          id: creative.id,
          title: creative.title,
          status: creative.status,
          direction_id: creative.direction_id,
          direction_name: creative.account_directions?.name || null
        },
        test: {
          exists: true,
          status: 'running',
          started_at: test.started_at,
          test_id: test.id,
          message: 'Тест запущен, накапливается статистика',
          metrics: {
            impressions: test.impressions || 0,
            reach: test.reach || 0,
            leads: test.leads || 0
          }
        },
        analysis: null
      });
    }

    // ===================================================
    // STEP 4: Получаем транскрибацию
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
    // STEP 5: Подготавливаем данные теста для LLM
    // ===================================================
    const testMetrics = {
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

    // ===================================================
    // STEP 6: Анализируем через LLM (только для completed тестов)
    // ===================================================
    let analysis = null;
    
    if (test.status === 'completed') {
      // Сначала проверяем creative_analysis (новая система)
      const { data: creativeAnalysisData, error: analysisError } = await supabase
        .from('creative_analysis')
        .select('*')
        .eq('creative_id', user_creative_id)
        .eq('user_account_id', user_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (creativeAnalysisData && !analysisError) {
        fastify.log.info({ 
          user_creative_id, 
          source: 'creative_analysis', 
          score: creativeAnalysisData.score,
          analysis_source: creativeAnalysisData.source
        }, 'Using analysis from creative_analysis table');
        
        analysis = {
          score: creativeAnalysisData.score,
          verdict: creativeAnalysisData.verdict,
          reasoning: creativeAnalysisData.reasoning,
          video_analysis: creativeAnalysisData.video_analysis,
          text_recommendations: creativeAnalysisData.text_recommendations,
          transcript_match_quality: creativeAnalysisData.transcript_match_quality,
          transcript_suggestions: creativeAnalysisData.transcript_suggestions
        };
      } else if (test.llm_score !== null && test.llm_verdict !== null && test.transcript_suggestions !== null) {
        // Fallback на старую систему (creative_tests.llm_*)
        fastify.log.info({ 
          user_creative_id, 
          source: 'creative_tests_legacy', 
          llm_score: test.llm_score 
        }, 'Using legacy LLM analysis from creative_tests');
        
        analysis = {
          score: test.llm_score,
          verdict: test.llm_verdict,
          reasoning: test.llm_reasoning,
          video_analysis: test.llm_video_analysis,
          text_recommendations: test.llm_text_recommendations,
          transcript_match_quality: test.transcript_match_quality,
          transcript_suggestions: test.transcript_suggestions
        };
      } else {
        // Делаем новый анализ через OpenAI
        const mediaType = creative.media_type || 'video';
        fastify.log.info({ user_creative_id, test_status: test.status, media_type: mediaType }, 'Analyzing with LLM');

        try {
          analysis = await analyzeCreativeTest(testMetrics, transcriptText, mediaType);

          fastify.log.info({ 
            user_creative_id, 
            llm_score: analysis.score,
            llm_verdict: analysis.verdict
          }, 'LLM analysis complete');

          // Сохраняем результат в БД
          const { error: updateError } = await supabase
            .from('creative_tests')
            .update({
              llm_score: analysis.score,
              llm_verdict: analysis.verdict,
              llm_reasoning: analysis.reasoning,
              llm_video_analysis: analysis.video_analysis,
              llm_text_recommendations: analysis.text_recommendations,
              transcript_match_quality: analysis.transcript_match_quality,
              transcript_suggestions: analysis.transcript_suggestions,
              updated_at: new Date().toISOString()
            })
            .eq('id', test.id);
          
          if (updateError) {
            fastify.log.error({ test_id: test.id, error: updateError }, 'Failed to save LLM analysis to DB');
          } else {
            fastify.log.info({ test_id: test.id }, 'LLM analysis saved to DB');
          }
        } catch (error) {
          fastify.log.warn({ 
            user_creative_id, 
            error: error.message 
          }, 'LLM analysis failed, continuing without analysis');
          analysis = null;
        }
      }
    } else {
      fastify.log.info({ user_creative_id, test_status: test.status }, 'Skipping LLM analysis for non-completed test');
    }

    // ===================================================
    // STEP 7: Формируем ответ (ТОЛЬКО тестовые данные)
    // ===================================================
    const result = {
      creative: {
        id: creative.id,
        title: creative.title,
        status: creative.status,
        direction_id: creative.direction_id,
        direction_name: creative.account_directions?.name || null
      },
      
      test: {
        exists: true,
        test_id: test.id,
        status: test.status,
        started_at: test.started_at,
        completed_at: test.completed_at,
        metrics: {
          impressions: test.impressions,
          reach: test.reach,
          clicks: test.clicks,
          link_clicks: test.link_clicks,
          leads: test.leads,
          spend_cents: test.spend_cents,
          cpl_cents: test.cpl_cents,
          ctr: test.ctr,
          cpm_cents: test.cpm_cents,
          frequency: test.frequency,
          video_views: test.video_views,
          video_views_25_percent: test.video_views_25_percent,
          video_views_50_percent: test.video_views_50_percent,
          video_views_75_percent: test.video_views_75_percent,
          video_views_95_percent: test.video_views_95_percent,
          video_avg_watch_time_sec: test.video_avg_watch_time_sec
        }
      },
      
      analysis: analysis,
      
      transcript: transcriptText ? {
        exists: true,
        preview: transcriptText.substring(0, 200) + (transcriptText.length > 200 ? '...' : '')
      } : null
    };
    
    // Кешируем результат
    setCachedAnalytics(cacheKey, result);
    
    fastify.log.info({ user_creative_id, test_status: test.status, has_analysis: !!analysis }, 'Returning test analytics');
    
    return reply.send({
      ...result,
      from_cache: false
    });
    
  } catch (error) {
    fastify.log.error({ error: error.message, stack: error.stack }, 'Creative analytics error');
    return reply.code(500).send({ error: error.message });
  }
});

/**
 * POST /analyze-creative
 * 
 * Запускает анализ креатива на основе последних метрик из creative_metrics_history
 * 
 * ВХОДНЫЕ ДАННЫЕ:
 * - creative_id: ID креатива из user_creatives
 * - user_id: ID пользователя
 * 
 * ЧТО ДЕЛАЕТ:
 * 1. Получает последние метрики из creative_metrics_history
 * 2. Получает транскрибацию креатива
 * 3. Отправляет все в LLM (OpenAI)
 * 4. Получает анализ (score, verdict, recommendations)
 * 5. Возвращает результаты анализа
 */
fastify.post('/analyze-creative', async (request, reply) => {
  try {
    const { creative_id, user_id } = request.body;
    
    if (!creative_id || !user_id) {
      return reply.code(400).send({ error: 'creative_id and user_id are required' });
    }

    fastify.log.info({ where: 'analyzeCreative', creative_id, user_id, status: 'started' });

    // ===================================================
    // STEP 1: Получаем последние агрегированные метрики креатива
    // ===================================================
    // ✅ Теперь просто ищем по user_creative_id - никаких джойнов!
    const { data: metricsHistory, error: metricsError } = await supabase
      .from('creative_metrics_history')
      .select('*')
      .eq('user_creative_id', creative_id)  // ✅ Используем user_creative_id напрямую!
      .eq('user_account_id', user_id)
      .order('date', { ascending: false })
      .limit(30); // Берем последние 30 дней

    fastify.log.info({ 
      where: 'analyzeCreative', 
      creative_id, 
      user_id,
      metricsFound: metricsHistory?.length || 0,
      metricsError: metricsError?.message 
    });

    if (metricsError || !metricsHistory || metricsHistory.length === 0) {
      fastify.log.error({ where: 'analyzeCreative', creative_id, user_id, error: metricsError });
      return reply.code(404).send({ 
        error: 'No metrics found for this creative',
        creative_id,
        user_id 
      });
    }

    // Агрегируем метрики за последние 30 дней
    const aggregatedMetrics = metricsHistory.reduce((acc, metric) => ({
      impressions: acc.impressions + (metric.impressions || 0),
      reach: acc.reach + (metric.reach || 0),
      clicks: acc.clicks + (metric.clicks || 0),
      link_clicks: acc.link_clicks + (metric.link_clicks || 0),
      leads: acc.leads + (metric.leads || 0),
      spend_cents: acc.spend_cents + (metric.spend_cents || 0),
      video_views: acc.video_views + (metric.video_views || 0),
      video_views_25_percent: acc.video_views_25_percent + (metric.video_views_25_percent || 0),
      video_views_50_percent: acc.video_views_50_percent + (metric.video_views_50_percent || 0),
      video_views_75_percent: acc.video_views_75_percent + (metric.video_views_75_percent || 0),
      video_views_95_percent: acc.video_views_95_percent + (metric.video_views_95_percent || 0),
    }), {
      impressions: 0,
      reach: 0,
      clicks: 0,
      link_clicks: 0,
      leads: 0,
      spend_cents: 0,
      video_views: 0,
      video_views_25_percent: 0,
      video_views_50_percent: 0,
      video_views_75_percent: 0,
      video_views_95_percent: 0,
    });

    // Вычисляем производные метрики
    const ctr = aggregatedMetrics.impressions > 0 
      ? aggregatedMetrics.clicks / aggregatedMetrics.impressions 
      : 0;
    const link_ctr = aggregatedMetrics.impressions > 0 
      ? aggregatedMetrics.link_clicks / aggregatedMetrics.impressions 
      : 0;
    const cpm_cents = aggregatedMetrics.impressions > 0 
      ? (aggregatedMetrics.spend_cents / aggregatedMetrics.impressions) * 1000 
      : 0;
    const cpl_cents = aggregatedMetrics.leads > 0 
      ? aggregatedMetrics.spend_cents / aggregatedMetrics.leads 
      : null;
    const frequency = aggregatedMetrics.reach > 0 
      ? aggregatedMetrics.impressions / aggregatedMetrics.reach 
      : 0;

    // Средние метрики видео (берем последнее значение)
    const latestMetric = metricsHistory[0];
    const video_avg_watch_time_sec = latestMetric.video_avg_watch_time_sec || 0;

    // ===================================================
    // STEP 2: Получаем информацию о креативе (включая media_type)
    // ===================================================
    const { data: creative, error: creativeError } = await supabase
      .from('user_creatives')
      .select('id, title, media_type')
      .eq('id', creative_id)
      .single();

    if (creativeError || !creative) {
      fastify.log.error({ where: 'analyzeCreative', creative_id, error: creativeError });
      return reply.code(404).send({ error: 'Creative not found' });
    }

    // ===================================================
    // STEP 3: Получаем транскрибацию
    // ===================================================
    const { data: transcript, error: transcriptError } = await supabase
      .from('creative_transcripts')
      .select('text')
      .eq('creative_id', creative_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const transcriptText = transcript?.text || null;

    // Определяем тип медиа (video по умолчанию для обратной совместимости)
    const mediaType = creative.media_type || 'video';

    fastify.log.info({
      where: 'analyzeCreative',
      creative_id,
      media_type: mediaType,
      has_transcript: !!transcriptText,
      impressions: aggregatedMetrics.impressions,
      leads: aggregatedMetrics.leads
    });

    // ===================================================
    // STEP 4: Подготавливаем данные для LLM
    // ===================================================
    const testData = {
      creative_title: creative.title || 'Untitled',
      impressions: aggregatedMetrics.impressions,
      reach: aggregatedMetrics.reach,
      frequency: frequency,
      clicks: aggregatedMetrics.clicks,
      link_clicks: aggregatedMetrics.link_clicks,
      ctr: ctr,
      link_ctr: link_ctr,
      leads: aggregatedMetrics.leads,
      spend_cents: aggregatedMetrics.spend_cents,
      cpm_cents: Math.round(cpm_cents),
      cpc_cents: aggregatedMetrics.clicks > 0 
        ? Math.round(aggregatedMetrics.spend_cents / aggregatedMetrics.clicks) 
        : 0,
      cpl_cents: cpl_cents ? Math.round(cpl_cents) : null,
      video_views: aggregatedMetrics.video_views,
      video_views_25_percent: aggregatedMetrics.video_views_25_percent,
      video_views_50_percent: aggregatedMetrics.video_views_50_percent,
      video_views_75_percent: aggregatedMetrics.video_views_75_percent,
      video_views_95_percent: aggregatedMetrics.video_views_95_percent,
      video_avg_watch_time_sec: video_avg_watch_time_sec
    };

    // ===================================================
    // STEP 5: Анализируем через LLM (с учетом типа медиа)
    // ===================================================
    const analysis = await analyzeCreativeTest(testData, transcriptText, mediaType);

    fastify.log.info({ 
      where: 'analyzeCreative', 
      creative_id,
      score: analysis?.score,
      verdict: analysis?.verdict
    });

    // ===================================================
    // STEP 6: Сохраняем результаты анализа в creative_analysis
    // ===================================================
    try {
      // Используем upsert вместо delete + insert для атомарной операции
      // Это гарантирует что анализ всегда сохраняется, даже если страница обновляется
      const { error: analysisError } = await supabase
        .from('creative_analysis')
        .upsert({
          creative_id: creative_id,
          user_account_id: user_id,
          source: 'manual',
          date_from: metricsHistory[metricsHistory.length - 1].date,
          date_to: metricsHistory[0].date,
          metrics: testData,
          score: analysis?.score || null,
          verdict: analysis?.verdict || null,
          reasoning: analysis?.reasoning || null,
          video_analysis: analysis?.video_analysis || null,
          text_recommendations: analysis?.text_recommendations || null,
          transcript_match_quality: analysis?.transcript_match_quality || null,
          transcript_suggestions: analysis?.transcript_suggestions || null
        }, {
          onConflict: 'creative_id,user_account_id,source'
        });

      if (analysisError) {
        fastify.log.warn({ 
          creative_id, 
          error: analysisError.message 
        }, 'Failed to save analysis to creative_analysis table');
      } else {
        fastify.log.info({ 
          creative_id,
          source: 'manual'
        }, 'Saved analysis to creative_analysis table');
      }
    } catch (err) {
      fastify.log.warn({ 
        creative_id,
        error: err.message 
      }, 'Error saving analysis to creative_analysis, continuing...');
    }

    // ===================================================
    // STEP 7: Возвращаем результаты
    // ===================================================
    return reply.send({
      success: true,
      creative_id,
      metrics: testData,
      analysis: analysis,
      transcript_available: !!transcriptText
    });
    
  } catch (error) {
    fastify.log.error({ error: error.message, stack: error.stack }, 'Analyze creative error');
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
