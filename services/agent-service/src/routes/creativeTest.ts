import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import axios from 'axios';
import { supabase } from '../lib/supabase.js';
import { workflowStartCreativeTest, fetchCreativeTestInsights } from '../workflows/creativeTest.js';

const ANALYZER_URL = process.env.ANALYZER_URL || 'http://localhost:7081';

const StartTestSchema = z.object({
  user_creative_id: z.string().uuid(),
  user_id: z.string().uuid()
});

export async function creativeTestRoutes(app: FastifyInstance) {
  
  /**
   * POST /api/creative-test/start
   * 
   * Запускает быстрый тест креатива на 1000 показов
   */
  app.post('/api/creative-test/start', async (req, reply) => {
    try {
      const parsed = StartTestSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'validation_error',
          details: parsed.error.flatten()
        });
      }

      const { user_creative_id, user_id } = parsed.data;

      // Получаем данные пользователя
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('id, access_token, ad_account_id, page_id, instagram_id')
        .eq('id', user_id)
        .single();

      if (userError || !userAccount) {
        return reply.status(404).send({
          success: false,
          error: 'User account not found'
        });
      }

      // Запускаем тест
      const result = await workflowStartCreativeTest(
        { user_creative_id, user_id },
        {
          ad_account_id: userAccount.ad_account_id,
          page_id: userAccount.page_id,
          instagram_id: userAccount.instagram_id
        },
        userAccount.access_token
      );

      return reply.send(result);
      
    } catch (error: any) {
      app.log.error({ message: error.message, stack: error.stack, fb: error.fb }, 'Creative test start error');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to start creative test'
      });
    }
  });

  /**
   * GET /api/creative-test/results/:user_creative_id
   * 
   * Получает результаты теста креатива
   */
  app.get('/api/creative-test/results/:user_creative_id', async (req, reply) => {
    try {
      const { user_creative_id } = req.params as { user_creative_id: string };

      const { data: test, error } = await supabase
        .from('creative_tests')
        .select('*')
        .eq('user_creative_id', user_creative_id)
        .single();

      if (error || !test) {
        return reply.status(404).send({
          success: false,
          error: 'Test not found'
        });
      }

      return reply.send({
        success: true,
        test
      });
      
    } catch (error: any) {
      app.log.error('Get test results error:', error);
      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to get test results'
      });
    }
  });

  /**
   * GET /api/creative-test/status
   * 
   * Получает все активные тесты (для cron)
   */
  app.get('/api/creative-test/status', async (req, reply) => {
    try {
      const { data: runningTests, error } = await supabase
        .from('creative_tests')
        .select('*')
        .eq('status', 'running')
        .order('started_at', { ascending: true });

      if (error) {
        throw error;
      }

      return reply.send({
        success: true,
        count: runningTests?.length || 0,
        tests: runningTests || []
      });
      
    } catch (error: any) {
      app.log.error('Get running tests error:', error);
      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to get running tests'
      });
    }
  });

  /**
   * POST /api/creative-test/check/:test_id
   * 
   * Проверяет статус теста и обновляет метрики (для cron)
   */
  app.post('/api/creative-test/check/:test_id', async (req, reply) => {
    try {
      const { test_id } = req.params as { test_id: string };

      // Получаем тест
      const { data: test, error: testError } = await supabase
        .from('creative_tests')
        .select('*, user_accounts!inner(access_token)')
        .eq('id', test_id)
        .single();

      if (testError || !test) {
        return reply.status(404).send({
          success: false,
          error: 'Test not found'
        });
      }

      if (test.status !== 'running') {
        return reply.send({
          success: true,
          message: 'Test is not running',
          status: test.status
        });
      }

      const accessToken = (test.user_accounts as any).access_token;

      // Получаем insights
      const insights = await fetchCreativeTestInsights(test.ad_id, accessToken);

      // Обновляем метрики
      await supabase
        .from('creative_tests')
        .update(insights)
        .eq('id', test_id);

      // Проверяем условие завершения
      const shouldComplete = insights.impressions >= test.test_impressions_limit;

      if (shouldComplete) {
        app.log.info(`Test ${test_id} reached ${insights.impressions} impressions, pausing AdSet and triggering analyzer`);
        
        // ПАУЗИМ ADSET ЧЕРЕЗ FACEBOOK API
        try {
          const pauseUrl = `https://graph.facebook.com/v20.0/${test.adset_id}`;
          await axios.post(pauseUrl, new URLSearchParams({
            access_token: accessToken,
            status: 'PAUSED'
          }));
          
          app.log.info(`AdSet ${test.adset_id} paused successfully`);
        } catch (pauseError: any) {
          app.log.error(`Failed to pause AdSet ${test.adset_id}:`, pauseError.message);
          // Продолжаем даже если пауза не удалась
        }
        
        // Вызываем отдельный Analyzer Service
        try {
          const analyzerResponse = await axios.post(`${ANALYZER_URL}/api/analyzer/analyze-test`, {
            test_id: test_id
          });
          
          app.log.info(`Test ${test_id} analyzed successfully:`, analyzerResponse.data);
          
          return reply.send({
            success: true,
            ready_for_analysis: true,
            analyzed: true,
            adset_paused: true,
            insights,
            analysis: analyzerResponse.data.analysis
          });
        } catch (analyzerError: any) {
          app.log.error(`Failed to analyze test ${test_id}:`, analyzerError.message);
          
          // Продолжаем даже если анализ не удался
          return reply.send({
            success: true,
            ready_for_analysis: true,
            analyzed: false,
            adset_paused: true,
            analyzer_error: analyzerError.message,
            insights
          });
        }
      }

      return reply.send({
        success: true,
        ready_for_analysis: false,
        insights
      });
      
    } catch (error: any) {
      app.log.error('Check test error:', error);
      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to check test'
      });
    }
  });
}
