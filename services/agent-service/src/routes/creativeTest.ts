import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import axios from 'axios';
import { supabase } from '../lib/supabase.js';
import { workflowStartCreativeTest, fetchCreativeTestInsights } from '../workflows/creativeTest.js';
import { graph } from '../adapters/facebook.js';
import { getWhatsAppPhoneNumber } from '../lib/settingsHelpers.js';
import { getCredentials } from '../lib/adAccountHelper.js';

const ANALYZER_URL = process.env.ANALYZER_URL || 'http://localhost:7081';

const StartTestSchema = z.object({
  user_creative_id: z.string().uuid(),
  user_id: z.string().uuid(),
  account_id: z.string().uuid().optional(), // UUID из ad_accounts (для мультиаккаунтности)
  force: z.boolean().optional()
});

export async function creativeTestRoutes(app: FastifyInstance) {
  
  /**
   * POST /creative-test/start
   * 
   * Запускает быстрый тест креатива на 1000 показов
   * (nginx проксирует /api/creative-test/start → /creative-test/start)
   */
  app.post('/creative-test/start', async (req, reply) => {
    try {
      const parsed = StartTestSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'validation_error',
          details: parsed.error.flatten()
        });
      }

      const { user_creative_id, user_id, account_id, force = false } = parsed.data;

      // Получаем учётные данные через getCredentials (поддержка мультиаккаунта)
      let credentials;
      try {
        credentials = await getCredentials(user_id, account_id);
      } catch (credError: any) {
        return reply.status(400).send({
          success: false,
          error: credError.message,
        });
      }

      if (!credentials.fbAccessToken) {
        return reply.status(400).send({
          success: false,
          error: 'No Facebook access token configured'
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

      // Получаем WhatsApp номер из направления
      // Если получим ошибку 2446885, workflow автоматически повторит без номера
      const whatsapp_phone_number_for_test = await getWhatsAppPhoneNumber(direction, user_id, supabase) || undefined;

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
          ad_account_id: credentials.fbAdAccountId!,
          page_id: credentials.fbPageId!,
          instagram_id: credentials.fbInstagramId ?? undefined,
          whatsapp_phone_number: whatsapp_phone_number_for_test
        },
        credentials.fbAccessToken!
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
   * GET /creative-test/results/:user_creative_id
   * 
   * Получает результаты теста креатива
   */
  app.get('/creative-test/results/:user_creative_id', async (req, reply) => {
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
   * GET /creative-test/status
   * 
   * Получает все активные тесты (для cron)
   */
  app.get('/creative-test/status', async (req, reply) => {
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
  app.post('/creative-test/check/:test_id', async (req, reply) => {
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
        app.log.info(`Test ${test_id} reached ${insights.impressions} impressions, pausing ad set/campaign and triggering analyzer`);
        
        // Проверяем режим пользователя
        const { data: userAccountWithMode } = await supabase
          .from('user_accounts')
          .select('default_adset_mode')
          .eq('id', test.user_id)
          .single();
        
        const isUseExistingMode = userAccountWithMode?.default_adset_mode === 'use_existing';
        
        // ПАУЗИМ в зависимости от режима
        let pauseSuccess = false;
        try {
          if (isUseExistingMode) {
            // РЕЖИМ use_existing: деактивируем adset и все ads внутри
            if (!test.adset_id) {
              throw new Error('Test has no adset_id');
            }
            
            const { deactivateAdSetWithAds } = await import('../lib/directionAdSets.js');
            await deactivateAdSetWithAds(test.adset_id, accessToken);
            
            app.log.info(`AdSet ${test.adset_id} and all ads paused successfully (use_existing mode)`);
            pauseSuccess = true;
            
          } else {
            // РЕЖИМ api_create: паузим adset через прямой вызов API
            const pauseUrl = `https://graph.facebook.com/v20.0/${test.adset_id}`;
            await axios.post(pauseUrl, new URLSearchParams({
              access_token: accessToken,
              status: 'PAUSED'
            }));
            
            app.log.info(`AdSet ${test.adset_id} paused successfully (api_create mode)`);
            pauseSuccess = true;
          }
        } catch (pauseError: any) {
          app.log.error(`Failed to pause test ${test_id}:`, pauseError.message);
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
            pause_success: pauseSuccess,
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
            pause_success: pauseSuccess,
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
  app.delete('/creative-test/:user_creative_id', async (req, reply) => {
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
          .select('access_token, default_adset_mode')
          .eq('id', String(user_id))
          .single();

        if (userAccountError || !userAccount?.access_token) {
          app.log.warn({ user_id }, 'Cannot pause creative test assets: no access_token');
        } else {
          const accessToken = userAccount.access_token;
          const isUseExistingMode = userAccount.default_adset_mode === 'use_existing';

          for (const test of tests) {
            if (isUseExistingMode) {
              // В режиме use_existing - деактивируем только adset и все ads внутри
              app.log.info({ 
                adset_id: test.adset_id,
                mode: 'use_existing' 
              }, 'Deactivating creative test ad set (use_existing mode)');
              
              try {
                if (test.adset_id) {
                  const { deactivateAdSetWithAds } = await import('../lib/directionAdSets.js');
                  await deactivateAdSetWithAds(test.adset_id, accessToken);
                  app.log.info({ adset_id: test.adset_id }, 'Creative test ad set and ads deactivated');
                }
              } catch (pauseError: any) {
                app.log.warn({ 
                  message: pauseError.message, 
                  fb: pauseError.fb, 
                  adset_id: test.adset_id 
                }, 'Failed to deactivate creative test ad set');
              }
            } else {
              // В режиме api_create - останавливаем кампанию, adset, ad (старая логика)
              app.log.info({ 
                campaign_id: test.campaign_id, 
                adset_id: test.adset_id, 
                ad_id: test.ad_id,
                mode: 'api_create' 
              }, 'Pausing creative test Facebook objects (api_create mode)');
              
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
