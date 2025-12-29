import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { getCredentials } from '../lib/adAccountHelper.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import { workflowStartAbTest, fetchAbTestInsights, analyzeAbTestResults } from '../workflows/creativeAbTest.js';

const ANALYZER_URL = process.env.ANALYZER_URL || 'http://localhost:7081';

// Константы конфигурации
const DEFAULT_TOTAL_BUDGET_CENTS = 2000; // $20
const DEFAULT_TOTAL_IMPRESSIONS = 1000;
const MIN_BUDGET_CENTS = 500;  // $5 минимум
const MAX_BUDGET_CENTS = 10000; // $100 максимум
const MIN_CREATIVES = 2;
const MAX_CREATIVES = 5;

const StartAbTestSchema = z.object({
  creative_ids: z.array(z.string().uuid()).min(MIN_CREATIVES).max(MAX_CREATIVES),
  user_id: z.string().uuid(),
  user_account_id: z.string().uuid().optional(),
  account_id: z.string().uuid().optional(),
  direction_id: z.string().uuid().optional(),
  total_budget_cents: z.number().min(MIN_BUDGET_CENTS).max(MAX_BUDGET_CENTS).optional(),
  total_impressions: z.number().min(100).max(10000).optional()
});

export async function creativeAbTestRoutes(app: FastifyInstance) {

  /**
   * POST /creative-ab-test/start
   *
   * Запускает A/B тест нескольких креативов
   * Создаёт 1 кампанию + N adset-ов (по одному на креатив)
   * Бюджет $20 делится на N креативов
   */
  app.post('/creative-ab-test/start', async (req, reply) => {
    try {
      const parsed = StartAbTestSchema.safeParse(req.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'validation_error',
          details: parsed.error.flatten()
        });
      }

      const {
        creative_ids,
        user_id,
        account_id,
        direction_id: providedDirectionId,
        total_budget_cents = DEFAULT_TOTAL_BUDGET_CENTS,
        total_impressions = DEFAULT_TOTAL_IMPRESSIONS
      } = parsed.data;

      const startTime = Date.now();

      app.log.info({
        user_id,
        account_id,
        creative_count: creative_ids.length,
        total_budget_cents,
        total_impressions,
        creative_ids
      }, '[A/B Test] Starting A/B test request');

      // Проверяем, что нет активных A/B тестов для этих креативов
      const { data: existingTests } = await supabase
        .from('creative_ab_test_items')
        .select('test_id, user_creative_id, creative_ab_tests!inner(status)')
        .in('user_creative_id', creative_ids)
        .eq('creative_ab_tests.status', 'running');

      if (existingTests && existingTests.length > 0) {
        return reply.status(409).send({
          success: false,
          error: 'Some creatives are already in a running A/B test',
          conflicting_creatives: existingTests.map((t: any) => t.user_creative_id)
        });
      }

      // Получаем credentials
      let credentials;
      try {
        credentials = await getCredentials(user_id, account_id);
      } catch (credError: any) {
        app.log.error({ user_id, account_id, error: credError.message }, 'Failed to get credentials');
        return reply.status(400).send({
          success: false,
          error: credError.message
        });
      }

      if (!credentials.fbAccessToken) {
        return reply.status(400).send({
          success: false,
          error: 'No Facebook access token configured'
        });
      }

      // Получаем креативы
      const { data: creatives, error: creativesError } = await supabase
        .from('user_creatives')
        .select('id, direction_id, fb_creative_id, title, image_url, ocr_text, image_description, status')
        .in('id', creative_ids)
        .eq('user_id', user_id)
        .eq('status', 'ready');

      if (creativesError || !creatives || creatives.length !== creative_ids.length) {
        return reply.status(400).send({
          success: false,
          error: 'Some creatives not found or not ready',
          found: creatives?.length || 0,
          requested: creative_ids.length
        });
      }

      // Проверяем что все креативы из одного направления
      const directions = [...new Set(creatives.map(c => c.direction_id))];
      if (directions.length > 1) {
        return reply.status(400).send({
          success: false,
          error: 'All creatives must be from the same direction',
          directions
        });
      }

      const directionId = directions[0];
      if (!directionId) {
        return reply.status(400).send({
          success: false,
          error: 'Creatives must have a direction'
        });
      }

      // Получаем direction
      const { data: direction } = await supabase
        .from('account_directions')
        .select('*')
        .eq('id', directionId)
        .single();

      if (!direction) {
        return reply.status(404).send({
          success: false,
          error: 'Direction not found'
        });
      }

      app.log.info({
        directionId,
        direction_name: direction.name,
        direction_objective: direction.objective,
        elapsed_ms: Date.now() - startTime
      }, '[A/B Test] Direction validated, starting workflow');

      // Запускаем workflow
      const result = await workflowStartAbTest(
        {
          creative_ids,
          user_id,
          db_ad_account_id: account_id,
          direction_id: directionId,
          total_budget_cents,
          total_impressions
        },
        {
          ad_account_id: credentials.fbAdAccountId!,
          page_id: credentials.fbPageId!,
          instagram_id: credentials.fbInstagramId ?? undefined
        },
        credentials.fbAccessToken!,
        creatives,
        direction
      );

      const elapsed = Date.now() - startTime;
      app.log.info({
        test_id: result.test_id,
        campaign_id: result.campaign_id,
        items_count: result.items?.length,
        elapsed_ms: elapsed
      }, '[A/B Test] A/B test started successfully');

      return reply.send(result);

    } catch (error: any) {
      app.log.error({ message: error.message, stack: error.stack, fb: error.fb }, 'A/B test start error');

      const body = req.body as any;
      logErrorToAdmin({
        user_account_id: body?.user_id,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'start_ab_test',
        endpoint: '/creative-ab-test/start',
        request_data: { creative_count: body?.creative_ids?.length },
        severity: 'warning'
      }).catch(() => {});

      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to start A/B test'
      });
    }
  });

  /**
   * GET /creative-ab-test/:test_id
   *
   * Получает статус и результаты A/B теста
   */
  app.get('/creative-ab-test/:test_id', async (req, reply) => {
    try {
      const { test_id } = req.params as { test_id: string };
      const { user_id } = req.query as { user_id?: string };

      if (!user_id) {
        return reply.status(400).send({
          success: false,
          error: 'user_id query parameter is required'
        });
      }

      const { data: test, error } = await supabase
        .from('creative_ab_tests')
        .select(`
          *,
          items:creative_ab_test_items(
            *,
            creative:user_creatives(id, title, image_url, ocr_text, image_description)
          )
        `)
        .eq('id', test_id)
        .eq('user_id', user_id)
        .single();

      if (error || !test) {
        return reply.status(404).send({
          success: false,
          error: 'A/B test not found'
        });
      }

      return reply.send({
        success: true,
        test
      });

    } catch (error: any) {
      app.log.error('Get A/B test error:', error);
      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to get A/B test'
      });
    }
  });

  /**
   * GET /creative-ab-test/status
   *
   * Получает все активные A/B тесты (для cron)
   */
  app.get('/creative-ab-test/status', async (req, reply) => {
    try {
      const { data: runningTests, error } = await supabase
        .from('creative_ab_tests')
        .select(`
          *,
          items:creative_ab_test_items(*)
        `)
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
      app.log.error('Get running A/B tests error:', error);
      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to get running A/B tests'
      });
    }
  });

  /**
   * POST /creative-ab-test/check/:test_id
   *
   * Проверяет статус A/B теста и обновляет метрики (для cron)
   */
  app.post('/creative-ab-test/check/:test_id', async (req, reply) => {
    try {
      const { test_id } = req.params as { test_id: string };

      // Получаем тест с items
      const { data: test, error: testError } = await supabase
        .from('creative_ab_tests')
        .select(`
          *,
          items:creative_ab_test_items(*)
        `)
        .eq('id', test_id)
        .single();

      if (testError || !test) {
        return reply.status(404).send({
          success: false,
          error: 'A/B test not found'
        });
      }

      if (test.status !== 'running') {
        return reply.send({
          success: true,
          message: 'A/B test is not running',
          status: test.status
        });
      }

      // Получаем credentials
      let credentials;
      try {
        credentials = await getCredentials(test.user_id, test.account_id || undefined);
      } catch (credError: any) {
        return reply.status(400).send({
          success: false,
          error: credError.message
        });
      }

      if (!credentials.fbAccessToken) {
        return reply.status(400).send({
          success: false,
          error: 'No Facebook access token configured'
        });
      }

      // Обновляем метрики для каждого item
      let totalImpressions = 0;
      const itemsInsights = [];

      for (const item of test.items) {
        const insights = await fetchAbTestInsights(item.ad_id, credentials.fbAccessToken);

        // Обновляем item в БД
        await supabase
          .from('creative_ab_test_items')
          .update(insights)
          .eq('id', item.id);

        totalImpressions += insights.impressions || 0;
        itemsInsights.push({ item_id: item.id, ...insights });
      }

      // Проверяем условие завершения
      // Все items должны набрать свой лимит показов
      const totalLimit = test.impressions_per_creative * test.creatives_count;
      const shouldComplete = totalImpressions >= totalLimit;

      if (shouldComplete) {
        app.log.info({
          test_id,
          totalImpressions,
          totalLimit
        }, 'A/B test reached impression limit, analyzing results');

        // Паузим все adsets
        for (const item of test.items) {
          try {
            const { graph } = await import('../adapters/facebook.js');
            await graph('POST', item.adset_id, credentials.fbAccessToken, { status: 'PAUSED' });
            app.log.info({ adset_id: item.adset_id }, 'AdSet paused');
          } catch (pauseError: any) {
            app.log.warn({ adset_id: item.adset_id, error: pauseError.message }, 'Failed to pause AdSet');
          }
        }

        // Анализируем результаты и сохраняем инсайты
        try {
          await analyzeAbTestResults(test_id);

          return reply.send({
            success: true,
            completed: true,
            analyzed: true,
            totalImpressions,
            items: itemsInsights
          });
        } catch (analyzeError: any) {
          app.log.error({ test_id, error: analyzeError.message }, 'Failed to analyze A/B test');

          return reply.send({
            success: true,
            completed: true,
            analyzed: false,
            analyzer_error: analyzeError.message,
            totalImpressions,
            items: itemsInsights
          });
        }
      }

      return reply.send({
        success: true,
        completed: false,
        totalImpressions,
        totalLimit,
        progress: Math.round((totalImpressions / totalLimit) * 100),
        items: itemsInsights
      });

    } catch (error: any) {
      app.log.error('Check A/B test error:', error);
      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to check A/B test'
      });
    }
  });

  /**
   * DELETE /creative-ab-test/:test_id
   *
   * Останавливает и удаляет A/B тест
   */
  app.delete('/creative-ab-test/:test_id', async (req, reply) => {
    try {
      const { test_id } = req.params as { test_id: string };
      const { user_id } = req.query as { user_id?: string };

      if (!user_id) {
        return reply.status(400).send({
          success: false,
          error: 'user_id query parameter is required'
        });
      }

      // Получаем тест с items
      const { data: test, error } = await supabase
        .from('creative_ab_tests')
        .select(`
          *,
          items:creative_ab_test_items(*)
        `)
        .eq('id', test_id)
        .eq('user_id', user_id)
        .single();

      if (error || !test) {
        return reply.status(404).send({
          success: false,
          error: 'A/B test not found'
        });
      }

      // Получаем credentials для остановки кампании
      let credentials;
      try {
        credentials = await getCredentials(test.user_id, test.account_id || undefined);
      } catch (credError: any) {
        app.log.warn({ error: credError.message }, 'Cannot get credentials for stopping A/B test');
      }

      if (credentials?.fbAccessToken) {
        const { graph } = await import('../adapters/facebook.js');

        // Паузим кампанию
        if (test.campaign_id) {
          try {
            await graph('POST', test.campaign_id, credentials.fbAccessToken, { status: 'PAUSED' });
            app.log.info({ campaign_id: test.campaign_id }, 'A/B test campaign paused');
          } catch (pauseError: any) {
            app.log.warn({ campaign_id: test.campaign_id, error: pauseError.message }, 'Failed to pause campaign');
          }
        }

        // Паузим все adsets
        for (const item of test.items) {
          if (item.adset_id) {
            try {
              await graph('POST', item.adset_id, credentials.fbAccessToken, { status: 'PAUSED' });
            } catch (pauseError: any) {
              app.log.warn({ adset_id: item.adset_id, error: pauseError.message }, 'Failed to pause adset');
            }
          }
        }
      }

      // Удаляем тест (items удалятся каскадно)
      await supabase
        .from('creative_ab_tests')
        .delete()
        .eq('id', test_id);

      return reply.send({ success: true });

    } catch (error: any) {
      app.log.error('Delete A/B test error:', error);
      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to delete A/B test'
      });
    }
  });

  /**
   * GET /creative-ab-test/insights
   *
   * Получает рейтинг инсайтов (офферы и образы)
   */
  app.get('/creative-ab-test/insights', async (req, reply) => {
    try {
      const { user_id, account_id, category, limit = 10 } = req.query as {
        user_id?: string;
        account_id?: string;
        category?: 'offer_text' | 'creative_image';
        limit?: number;
      };

      if (!user_id) {
        return reply.status(400).send({
          success: false,
          error: 'user_id query parameter is required'
        });
      }

      app.log.info({
        user_id,
        account_id,
        category,
        limit
      }, '[A/B Test] Fetching insights');

      // Используем user_id напрямую как user_account_id
      // (в conversation_insights хранится user_account_id = user_id)
      const userAccountId = user_id;

      let query = supabase
        .from('conversation_insights')
        .select('*')
        .eq('user_account_id', userAccountId)
        .in('category', category ? [category] : ['offer_text', 'creative_image'])
        .order('occurrence_count', { ascending: false })
        .limit(Number(limit));

      const { data: insights, error } = await query;

      if (error) {
        throw error;
      }

      // Группируем по категории
      const offerTexts = insights?.filter(i => i.category === 'offer_text') || [];
      const creativeImages = insights?.filter(i => i.category === 'creative_image') || [];

      return reply.send({
        success: true,
        offer_texts: offerTexts.map((i, idx) => ({
          rank: idx + 1,
          content: i.content,
          metadata: i.metadata,
          occurrence_count: i.occurrence_count,
          first_seen_at: i.first_seen_at,
          last_seen_at: i.last_seen_at
        })),
        creative_images: creativeImages.map((i, idx) => ({
          rank: idx + 1,
          content: i.content,
          metadata: i.metadata,
          occurrence_count: i.occurrence_count,
          first_seen_at: i.first_seen_at,
          last_seen_at: i.last_seen_at
        }))
      });

    } catch (error: any) {
      app.log.error('Get insights error:', error);
      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to get insights'
      });
    }
  });
}
