import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { fetchAbTestInsights, analyzeAbTestResults } from '../workflows/creativeAbTest.js';
import { getCredentials } from '../lib/adAccountHelper.js';
import { graph } from '../adapters/facebook.js';

export function startCreativeAbTestCron(app: FastifyInstance) {
  app.log.info('📅 Creative A/B test cron started (runs every 5 minutes)');

  // Каждые 5 минут проверяем running A/B тесты
  cron.schedule('*/5 * * * *', async () => {
    try {
      app.log.info('[A/B Cron] Checking running A/B tests...');

      // Получаем все running A/B тесты с их items
      const { data: runningTests, error } = await supabase
        .from('creative_ab_tests')
        .select(`
          id,
          user_id,
          account_id,
          campaign_id,
          impressions_per_creative,
          creatives_count,
          items:creative_ab_test_items(id, ad_id, adset_id, impressions_limit)
        `)
        .eq('status', 'running');

      if (error) {
        app.log.error({ error }, '[A/B Cron] Failed to fetch running A/B tests');
        return;
      }

      if (!runningTests || runningTests.length === 0) {
        app.log.info('[A/B Cron] No running A/B tests found');
        return;
      }

      app.log.info(`[A/B Cron] Found ${runningTests.length} running A/B test(s)`);

      // Проверяем каждый тест
      for (const test of runningTests) {
        try {
          // Получаем credentials
          let credentials;
          try {
            credentials = await getCredentials(test.user_id, test.account_id || undefined);
          } catch (credError: any) {
            app.log.error({
              testId: test.id,
              error: credError.message
            }, '[A/B Cron] Failed to get credentials');
            continue;
          }

          if (!credentials.fbAccessToken) {
            app.log.error({ testId: test.id }, '[A/B Cron] No access_token found');
            continue;
          }

          const accessToken = credentials.fbAccessToken;
          const items = test.items || [];

          if (items.length === 0) {
            app.log.warn({ testId: test.id }, '[A/B Cron] Test has no items');
            continue;
          }

          // Обновляем метрики для каждого item
          let totalImpressions = 0;

          for (const item of items) {
            if (!item.ad_id) {
              app.log.warn({ itemId: item.id }, '[A/B Cron] Item has no ad_id');
              continue;
            }

            const insights = await fetchAbTestInsights(item.ad_id, accessToken);

            // Обновляем item в БД
            await supabase
              .from('creative_ab_test_items')
              .update(insights)
              .eq('id', item.id);

            totalImpressions += insights.impressions || 0;
          }

          const totalLimit = (test.impressions_per_creative || 0) * (test.creatives_count || items.length);

          app.log.info({
            testId: test.id,
            totalImpressions,
            totalLimit,
            progress: `${Math.round((totalImpressions / totalLimit) * 100)}%`
          }, '[A/B Cron] Test progress updated');

          // Проверяем условие завершения
          if (totalImpressions >= totalLimit) {
            app.log.info({
              testId: test.id,
              totalImpressions,
              totalLimit
            }, '[A/B Cron] Test reached limit, completing...');

            // Паузим все adsets
            for (const item of items) {
              if (item.adset_id) {
                try {
                  await graph('POST', item.adset_id, accessToken, { status: 'PAUSED' });
                  app.log.info({ adsetId: item.adset_id }, '[A/B Cron] AdSet paused');
                } catch (pauseError: any) {
                  app.log.warn({
                    adsetId: item.adset_id,
                    error: pauseError.message
                  }, '[A/B Cron] Failed to pause AdSet');
                }
              }
            }

            // Паузим кампанию
            if (test.campaign_id) {
              try {
                await graph('POST', test.campaign_id, accessToken, { status: 'PAUSED' });
                app.log.info({ campaignId: test.campaign_id }, '[A/B Cron] Campaign paused');
              } catch (pauseError: any) {
                app.log.warn({
                  campaignId: test.campaign_id,
                  error: pauseError.message
                }, '[A/B Cron] Failed to pause campaign');
              }
            }

            // Анализируем результаты
            try {
              await analyzeAbTestResults(test.id);
              app.log.info({ testId: test.id }, '[A/B Cron] Test analyzed successfully');
            } catch (analyzeError: any) {
              app.log.error({
                testId: test.id,
                error: analyzeError.message
              }, '[A/B Cron] Failed to analyze test');

              // Всё равно помечаем как completed
              await supabase
                .from('creative_ab_tests')
                .update({
                  status: 'completed',
                  completed_at: new Date().toISOString()
                })
                .eq('id', test.id);
            }
          }

        } catch (testError: any) {
          app.log.error({
            testId: test.id,
            error: testError.message
          }, '[A/B Cron] Error checking test');
        }
      }

      app.log.info('[A/B Cron] A/B test check completed');

    } catch (error: any) {
      app.log.error({ error: error.message }, '[A/B Cron] A/B test checker error');
    }
  });
}
