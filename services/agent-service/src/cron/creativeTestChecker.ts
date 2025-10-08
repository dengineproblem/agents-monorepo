import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { fetchCreativeTestInsights } from '../workflows/creativeTest.js';
import axios from 'axios';

const ANALYZER_URL = process.env.ANALYZER_URL || 'http://localhost:7081';

export function startCreativeTestCron(app: FastifyInstance) {
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
            app.log.info(`[Cron] Test ${test.id} reached limit, pausing AdSet and triggering analyzer`);
            
            // ПАУЗИМ ADSET
            try {
              const pauseUrl = `https://graph.facebook.com/v20.0/${test.adset_id}`;
              await axios.post(pauseUrl, new URLSearchParams({
                access_token: userAccount.access_token,
                status: 'PAUSED'
              }));
              
              app.log.info(`[Cron] AdSet ${test.adset_id} paused successfully`);
            } catch (pauseError: any) {
              app.log.error(`[Cron] Failed to pause AdSet ${test.adset_id}:`, pauseError.message);
            }
            
            // ВЫЗЫВАЕМ ANALYZER
            try {
              const analyzerResponse = await axios.post(`${ANALYZER_URL}/api/analyzer/analyze-test`, {
                test_id: test.id
              }, {
                timeout: 30000 // 30 секунд
              });
              
              app.log.info(`[Cron] Test ${test.id} analyzed successfully:`, analyzerResponse.data);
            } catch (analyzerError: any) {
              app.log.error(`[Cron] Failed to analyze test ${test.id}:`, analyzerError.message);
              
              // Помечаем тест как completed даже если анализ не удался
              await supabase
                .from('creative_tests')
                .update({
                  status: 'completed',
                  completed_at: new Date().toISOString()
                })
                .eq('id', test.id);
            }
          }
          
        } catch (testError: any) {
          app.log.error({ 
            message: `[Cron] Error checking test ${test.id}`,
            error: testError.message,
            stack: testError.stack,
            test_id: test.id
          });
        }
      }
      
      app.log.info('[Cron] Creative test check completed');
      
    } catch (error: any) {
      app.log.error('[Cron] Creative test checker error:', error);
    }
  });
  
  app.log.info('📅 Creative test cron started (runs every 5 minutes)');
}

