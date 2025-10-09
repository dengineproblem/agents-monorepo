/**
 * ОТДЕЛЬНЫЙ МИКРОСЕРВИС: Creative Test Analyzer
 * 
 * НЕ ТРОГАЕТ основной Brain Agent!
 * Имеет свой промпт, свой порт, свою логику
 */

import Fastify from 'fastify';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { analyzeCreativeTest } from './creativeAnalyzer.js';

const fastify = Fastify({ logger: true });

// Supabase клиент
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

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

// Запуск сервиса на отдельном порту
const ANALYZER_PORT = Number(process.env.ANALYZER_PORT || 7081);
fastify.listen({ host: '0.0.0.0', port: ANALYZER_PORT })
  .then(() => fastify.log.info(`Creative Analyzer listening on ${ANALYZER_PORT}`))
  .catch(err => { 
    fastify.log.error(err); 
    process.exit(1); 
  });
