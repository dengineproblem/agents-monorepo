import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import axios from 'axios';
import { supabase } from '../lib/supabase.js';
import { workflowStartCreativeTest, fetchCreativeTestInsights } from '../workflows/creativeTest.js';
import { graph } from '../adapters/facebook.js';
import { getWhatsAppPhoneNumber } from '../lib/settingsHelpers.js';

const ANALYZER_URL = process.env.ANALYZER_URL || 'http://localhost:7081';

const StartTestSchema = z.object({
  user_creative_id: z.string().uuid(),
  user_id: z.string().uuid(),
  force: z.boolean().optional()
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

      const { user_creative_id, user_id, force = false } = parsed.data;

      // Получаем данные пользователя
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('id, access_token, ad_account_id, page_id, instagram_id, whatsapp_phone_number')
        .eq('id', user_id)
        .single();

      if (userError || !userAccount) {
        return reply.status(404).send({
          success: false,
          error: 'User account not found'
        });
      }

      // Получаем креатив для определения direction_id
      const { data: creative } = await supabase
        .from('user_creatives')
        .select('direction_id')
        .eq('id', user_creative_id)
        .single();

      if (!creative || !creative.direction_id) {
        return reply.status(404).send({
          success: false,
          error: 'Creative not found or has no direction'
        });
      }

      // Получаем direction для WhatsApp fallback
      const { data: direction } = await supabase
        .from('account_directions')
        .select('*')
        .eq('id', creative.direction_id)
        .single();

      if (!direction) {
        return reply.status(404).send({
          success: false,
          error: 'Direction not found'
        });
      }

      // Получаем WhatsApp номер с 4-tier fallback (может вернуть null)
      const whatsapp_phone_number = await getWhatsAppPhoneNumber(direction, user_id, supabase) || undefined;

      // Проверяем, не запускался ли тест ранее
      const { data: existingTests, error: existingError } = await supabase
        .from('creative_tests')
        .select('id, status, adset_id, ad_id, started_at')
        .eq('user_creative_id', user_creative_id)
        .eq('user_id', user_id);

      if (!existingError && existingTests && existingTests.length > 0) {
        const runningTests = existingTests.filter((t: any) => t.status === 'running');
        if (runningTests.length > 0) {
          if (!force) {
            return reply.status(409).send({
              success: false,
              error: 'Test already running for this creative',
              tests: runningTests,
              can_force: true
            });
          }
        }

        await supabase
          .from('creative_tests')
          .delete()
          .eq('user_creative_id', user_creative_id)
          .eq('user_id', user_id)
          .in('status', ['completed', 'cancelled', 'failed', 'running']);
      }

      // Запускаем тест
      const result = await workflowStartCreativeTest(
        { user_creative_id, user_id },
        {
          ad_account_id: userAccount.ad_account_id,
          page_id: userAccount.page_id,
          instagram_id: userAccount.instagram_id,
          whatsapp_phone_number
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
        .select('*')
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

      // Получаем access_token отдельно
      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('access_token')
        .eq('id', test.user_id)
        .single();

      if (userError || !userAccount) {
        return reply.status(404).send({
          success: false,
          error: 'User account not found'
        });
      }

      const accessToken = userAccount.access_token;

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

  /**
   * DELETE /api/creative-test/:user_creative_id
   * 
   * Сбрасывает результаты теста креатива
   */
  app.delete('/api/creative-test/:user_creative_id', async (req, reply) => {
    try {
      const { user_creative_id } = req.params as { user_creative_id: string };
      const user_id = (req.query as any)?.user_id;

      if (!user_id) {
        return reply.status(400).send({
          success: false,
          error: 'user_id query parameter is required'
        });
      }

      const { data: tests, error } = await supabase
        .from('creative_tests')
        .select('*')
        .eq('user_creative_id', user_creative_id)
        .eq('user_id', String(user_id));

      if (error) {
        throw error;
      }

      if (tests && tests.length > 0) {
        const { data: userAccount, error: userAccountError } = await supabase
          .from('user_accounts')
          .select('access_token')
          .eq('id', String(user_id))
          .single();

        if (userAccountError || !userAccount?.access_token) {
          app.log.warn({ user_id }, 'Cannot pause creative test assets: no access_token');
        } else {
          const accessToken = userAccount.access_token;

          for (const test of tests) {
            app.log.info({ campaign_id: test.campaign_id, adset_id: test.adset_id, ad_id: test.ad_id }, 'Pausing creative test Facebook objects');
            
            try {
              if (test.campaign_id) {
                await graph('POST', `${test.campaign_id}`, accessToken, { status: 'PAUSED' });
                app.log.info({ campaign_id: test.campaign_id }, 'Creative test campaign paused');
              }
            } catch (pauseError: any) {
              app.log.warn({ message: pauseError.message, fb: pauseError.fb, campaign_id: test.campaign_id }, 'Failed to pause creative test campaign');
            }

            try {
              if (test.adset_id) {
                await graph('POST', `${test.adset_id}`, accessToken, { status: 'PAUSED' });
                app.log.info({ adset_id: test.adset_id }, 'Creative test ad set paused');
              }
            } catch (pauseError: any) {
              app.log.warn({ message: pauseError.message, fb: pauseError.fb, adset_id: test.adset_id }, 'Failed to pause creative test ad set');
            }

            try {
              if (test.ad_id) {
                await graph('POST', `${test.ad_id}`, accessToken, { status: 'PAUSED' });
                app.log.info({ ad_id: test.ad_id }, 'Creative test ad paused');
              }
            } catch (pauseError: any) {
              app.log.warn({ message: pauseError.message, fb: pauseError.fb, ad_id: test.ad_id }, 'Failed to pause creative test ad');
            }
          }
        }
      }

      await supabase
        .from('creative_tests')
        .delete()
        .eq('user_creative_id', user_creative_id)
        .eq('user_id', String(user_id));

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error({ message: error.message, stack: error.stack }, 'Creative test reset error');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to reset creative test'
      });
    }
  });
}
