import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { fetchCreativeTestInsights } from '../workflows/creativeTest.js';
import { fb } from '../adapters/facebook.js';
import { getCredentials } from '../lib/adAccountHelper.js';
import axios from 'axios';

const ANALYZER_URL = process.env.ANALYZER_URL || 'http://localhost:7081';

export function startCreativeTestCron(app: FastifyInstance) {
  app.log.info(`📅 Creative test cron started (runs every 5 minutes). ANALYZER_URL: ${ANALYZER_URL}`);
  
  // Каждые 5 минут проверяем running тесты
  cron.schedule('*/5 * * * *', async () => {
    try {
      app.log.info('[Cron] Checking running creative tests...');
      
      // Получаем все running тесты (включая account_id для мультиаккаунтности)
      const { data: runningTests, error } = await supabase
        .from('creative_tests')
        .select('id, campaign_id, adset_id, ad_id, test_impressions_limit, user_id, objective, account_id, user_creative_id')
        .eq('status', 'running');
      
      if (error) {
        app.log.error({ error }, '[Cron] Failed to fetch running tests');
        return;
      }
      
      if (!runningTests || runningTests.length === 0) {
        app.log.info('[Cron] No running tests found');
        return;
      }
      
      app.log.info(`[Cron] Found ${runningTests.length} running test(s)`);
      
      // Проверяем каждый тест
      for (const test of runningTests) {
        try {
          // Получаем credentials через getCredentials() для поддержки мультиаккаунтности
          // Если test.account_id есть - используем ad_accounts, иначе - user_accounts (legacy)
          let credentials;
          try {
            credentials = await getCredentials(test.user_id, test.account_id || undefined);
          } catch (credError: any) {
            app.log.error({
              testId: test.id,
              userId: test.user_id,
              accountId: test.account_id,
              error: credError.message
            }, `[Cron] Failed to get credentials for test ${test.id}`);
            continue;
          }

          if (!credentials.fbAccessToken) {
            app.log.error(`[Cron] No access_token found for test ${test.id}`);
            continue;
          }

          const accessToken = credentials.fbAccessToken;

          // Проверяем что ad_id есть
          if (!test.ad_id) {
            app.log.error({ test }, `[Cron] Test ${test.id} has no ad_id!`);
            continue;
          }

          app.log.info({
            testId: test.id,
            adId: test.ad_id,
            objective: test.objective || 'unknown',
            accountId: test.account_id || 'legacy'
          }, `[Cron] Fetching insights for ad_id: ${test.ad_id}`);

          // Для conversions — загружаем conversion_channel из direction
          let conversionChannel: string | null = null;
          if (test.objective === 'conversions' && test.user_creative_id) {
            const { data: creative } = await supabase
              .from('user_creatives')
              .select('direction_id')
              .eq('id', test.user_creative_id)
              .maybeSingle();
            if (creative?.direction_id) {
              const { data: dir } = await supabase
                .from('account_directions')
                .select('conversion_channel')
                .eq('id', creative.direction_id)
                .maybeSingle();
              conversionChannel = dir?.conversion_channel || null;
            }
          }

          // Получаем метрики из Facebook (передаем objective и conversion_channel для правильного подсчета лидов)
          const insights = await fetchCreativeTestInsights(
            test.ad_id,
            accessToken,
            test.objective,
            conversionChannel
          );
          
          app.log.info(`[Cron] Test ${test.id}: ${insights.impressions}/${test.test_impressions_limit} impressions`);
          
          // Обновляем метрики в Supabase
          await supabase
            .from('creative_tests')
            .update(insights)
            .eq('id', test.id);
          
          // Проверяем условие завершения
          if (insights.impressions >= test.test_impressions_limit) {
            app.log.info(`[Cron] Test ${test.id} reached limit (${insights.impressions}/${test.test_impressions_limit}), pausing campaign and triggering analyzer`);

            let pauseSuccess = false;
            let analyzerSuccess = false;

            // ПАУЗИМ КАМПАНИЮ
            try {
              if (!test.campaign_id) {
                throw new Error('Test has no campaign_id');
              }

              const pauseResponse = await fb.pauseCampaign(test.campaign_id, accessToken);

              app.log.info({
                pauseResponse,
                campaign_id: test.campaign_id
              }, `[Cron] Campaign ${test.campaign_id} paused successfully`);
              pauseSuccess = true;
            } catch (pauseError: any) {
              app.log.error({
                message: pauseError.message,
                response: pauseError.response?.data,
                status: pauseError.response?.status,
                campaign_id: test.campaign_id
              }, `[Cron] Failed to pause campaign for test ${test.id}`);
            }
            
            // ВЫЗЫВАЕМ ANALYZER
            try {
              app.log.info(`[Cron] Calling analyzer at ${ANALYZER_URL}/analyze-test for test ${test.id}`);

              const analyzerResponse = await axios.post(`${ANALYZER_URL}/analyze-test`, {
                test_id: test.id
              }, {
                timeout: 60000, // 60 секунд
                headers: {
                  'Content-Type': 'application/json'
                }
              });
              
              app.log.info({ result: analyzerResponse.data }, `[Cron] Test ${test.id} analyzed successfully`);
              analyzerSuccess = true;
            } catch (analyzerError: any) {
              app.log.error({
                message: analyzerError.message,
                response: analyzerError.response?.data,
                status: analyzerError.response?.status,
                code: analyzerError.code
              }, `[Cron] Failed to analyze test ${test.id}`);
            }
            
            // ВСЕГДА помечаем тест как completed после достижения лимита
            // (независимо от того, успешно ли остановили AdSet или провели анализ)
            try {
              await supabase
                .from('creative_tests')
                .update({
                  status: 'completed',
                  completed_at: new Date().toISOString()
                })
                .eq('id', test.id);
              
              app.log.info(`[Cron] Test ${test.id} marked as completed. Pause success: ${pauseSuccess}, Analyzer success: ${analyzerSuccess}`);
            } catch (updateError: any) {
              app.log.error(`[Cron] Failed to update test status:`, updateError);
            }
          }
          
        } catch (testError: any) {
          app.log.error(`[Cron] Error checking test ${test.id}: ${testError.message}`);
          app.log.error({ 
            message: `[Cron] Full error details for test ${test.id}`,
            error: testError.message,
            stack: testError.stack,
            test_id: test.id,
            response: testError.response?.data
          });
        }
      }
      
      app.log.info('[Cron] Creative test check completed');
      
    } catch (error: any) {
      app.log.error('[Cron] Creative test checker error:', error);
    }
  });
}

