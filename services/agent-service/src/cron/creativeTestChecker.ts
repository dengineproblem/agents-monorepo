import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { fetchCreativeTestInsights } from '../workflows/creativeTest.js';
import * as fb from '../adapters/facebook.js';
import axios from 'axios';

const ANALYZER_URL = process.env.ANALYZER_URL || 'http://localhost:7081';

export function startCreativeTestCron(app: FastifyInstance) {
  app.log.info(`📅 Creative test cron started (runs every 5 minutes). ANALYZER_URL: ${ANALYZER_URL}`);
  
  // Каждые 5 минут проверяем running тесты
  cron.schedule('*/5 * * * *', async () => {
    try {
      app.log.info('[Cron] Checking running creative tests...');
      
      // Получаем все running тесты
      const { data: runningTests, error } = await supabase
        .from('creative_tests')
        .select('id, campaign_id, adset_id, ad_id, test_impressions_limit, user_id')
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
          // Получаем access_token пользователя
          const { data: userAccount, error: userError } = await supabase
            .from('user_accounts')
            .select('access_token')
            .eq('id', test.user_id)
            .single();
          
          if (userError || !userAccount) {
            app.log.error(`[Cron] User not found for test ${test.id}`);
            continue;
          }
          
          // Проверяем что ad_id есть
          if (!test.ad_id) {
            app.log.error(`[Cron] Test ${test.id} has no ad_id! Test data:`, test);
            continue;
          }
          
          app.log.info(`[Cron] Fetching insights for ad_id: ${test.ad_id}`);
          
          // Получаем метрики из Facebook
          const insights = await fetchCreativeTestInsights(
            test.ad_id,
            userAccount.access_token
          );
          
          app.log.info(`[Cron] Test ${test.id}: ${insights.impressions}/${test.test_impressions_limit} impressions`);
          
          // Обновляем метрики в Supabase
          await supabase
            .from('creative_tests')
            .update(insights)
            .eq('id', test.id);
          
          // Проверяем условие завершения
          if (insights.impressions >= test.test_impressions_limit) {
            app.log.info(`[Cron] Test ${test.id} reached limit (${insights.impressions}/${test.test_impressions_limit}), pausing Campaign and triggering analyzer`);
            
            let campaignPaused = false;
            let analyzerSuccess = false;
            
            // ПАУЗИМ CAMPAIGN (не adset, а всю кампанию!)
            try {
              if (!test.campaign_id) {
                throw new Error('Test has no campaign_id');
              }
              
              const pauseResponse = await fb.pauseCampaign(test.campaign_id, userAccount.access_token);
              
              app.log.info(`[Cron] Campaign ${test.campaign_id} paused successfully`, pauseResponse);
              campaignPaused = true;
            } catch (pauseError: any) {
              app.log.error(`[Cron] Failed to pause Campaign ${test.campaign_id}:`, {
                message: pauseError.message,
                response: pauseError.response?.data,
                status: pauseError.response?.status
              });
            }
            
            // ВЫЗЫВАЕМ ANALYZER
            try {
              app.log.info(`[Cron] Calling analyzer at ${ANALYZER_URL}/api/analyzer/analyze-test for test ${test.id}`);
              
              const analyzerResponse = await axios.post(`${ANALYZER_URL}/api/analyzer/analyze-test`, {
                test_id: test.id
              }, {
                timeout: 60000, // 60 секунд
                headers: {
                  'Content-Type': 'application/json'
                }
              });
              
              app.log.info(`[Cron] Test ${test.id} analyzed successfully:`, analyzerResponse.data);
              analyzerSuccess = true;
            } catch (analyzerError: any) {
              app.log.error(`[Cron] Failed to analyze test ${test.id}:`, {
                message: analyzerError.message,
                response: analyzerError.response?.data,
                status: analyzerError.response?.status,
                code: analyzerError.code
              });
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
              
              app.log.info(`[Cron] Test ${test.id} marked as completed. Campaign paused: ${campaignPaused}, Analyzer success: ${analyzerSuccess}`);
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

