/**
 * Admin Ads Routes
 *
 * API для раздела рекламы в админ-панели: направления, креативы, CPL анализ
 * NOTE: Таблица campaigns НЕ существует! Используем account_directions.
 *
 * @module routes/adminAds
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { getCampaignInsightsBatch } from '../lib/fbCampaignInsights.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

const log = createLogger({ module: 'adminAds' });

function getPeriodDate(period: string): Date | null {
  const now = new Date();
  switch (period) {
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '14d':
      return new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case 'all':
    default:
      return null;
  }
}

export default async function adminAdsRoutes(app: FastifyInstance) {

  /**
   * GET /admin/ads/directions
   * Получить все направления всех пользователей с метриками
   */
  app.get('/admin/ads/directions', async (req, res) => {
    try {
      const { period = '7d' } = req.query as { period?: string };
      const periodDate = getPeriodDate(period);

      // NOTE: account_directions НЕ имеет default_cpl_target_cents
      // Эта колонка есть в ad_accounts
      let query = supabase
        .from('account_directions')
        .select(`
          id,
          name,
          user_account_id,
          fb_campaign_id,
          created_at
        `)
        .order('created_at', { ascending: false });

      if (periodDate) {
        query = query.gte('created_at', periodDate.toISOString());
      }

      const { data: directions, error } = await query;

      if (error) throw new Error(error.message);

      // Загружаем usernames отдельно
      const userIds = [...new Set(directions?.map(d => d.user_account_id).filter(Boolean) || [])];
      let usersMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: users } = await supabase.from('user_accounts').select('id, username').in('id', userIds);
        usersMap = Object.fromEntries(users?.map(u => [u.id, u.username]) || []);
      }

      // Get metrics for directions
      const directionsWithMetrics = await Promise.all(
        (directions || []).map(async (direction: any) => {
          // Get leads count for this direction
          let leadsQuery = supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('direction_id', direction.id);

          if (periodDate) {
            leadsQuery = leadsQuery.gte('created_at', periodDate.toISOString());
          }

          const { count: leadsCount } = await leadsQuery;

          // Get metrics from creative_metrics_history by direction
          // (creative_metrics_history может не иметь direction_id, используем approximate через user_account_id)
          let metricsQuery = supabase
            .from('creative_metrics_history')
            .select('spend, impressions, clicks')
            .eq('user_account_id', direction.user_account_id);

          if (periodDate) {
            metricsQuery = metricsQuery.gte('date', periodDate.toISOString().split('T')[0]);
          }

          const { data: metrics } = await metricsQuery;

          const totalSpend = metrics?.reduce((sum, m) => sum + (m.spend || 0), 0) || 0;
          const totalImpressions = metrics?.reduce((sum, m) => sum + (m.impressions || 0), 0) || 0;
          const totalClicks = metrics?.reduce((sum, m) => sum + (m.clicks || 0), 0) || 0;

          const cpl = leadsCount && leadsCount > 0 ? (totalSpend / leadsCount) * 100 : 0;

          return {
            id: direction.id,
            name: direction.name,
            user_username: usersMap[direction.user_account_id] || 'Unknown',
            fb_campaign_id: direction.fb_campaign_id,
            spend: Math.round(totalSpend * 100),
            impressions: totalImpressions,
            clicks: totalClicks,
            leads: leadsCount || 0,
            cpl: Math.round(cpl),
          };
        })
      );

      return res.send({ directions: directionsWithMetrics });
    } catch (err: any) {
      log.error({ error: err instanceof Error ? err.message : JSON.stringify(err) }, 'Error fetching directions');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_get_directions',
        endpoint: '/admin/ads/directions',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Failed to fetch directions' });
    }
  });

  /**
   * GET /admin/ads/creatives
   * Получить топ креативов по метрикам
   * Метрики из creative_metrics_history (как в ROI аналитике)
   * ЛОГИКА: Берём только креативы, у которых есть метрики за период
   */
  app.get('/admin/ads/creatives', async (req, res) => {
    try {
      const { period = '30d' } = req.query as { period?: string };
      const periodDate = getPeriodDate(period);

      // 1. Сначала получаем метрики за период - это определит какие креативы показывать
      let metricsQuery = supabase
        .from('creative_metrics_history')
        .select('user_creative_id, spend, impressions, clicks, leads')
        .not('user_creative_id', 'is', null);

      if (periodDate) {
        metricsQuery = metricsQuery.gte('date', periodDate.toISOString().split('T')[0]);
      }

      const { data: metricsData, error: metricsError } = await metricsQuery;

      if (metricsError) throw new Error(metricsError.message);

      // 2. Агрегируем метрики по user_creative_id
      const creativeMetrics = new Map<string, {
        spend: number;
        impressions: number;
        clicks: number;
        leads: number;
      }>();

      for (const metric of metricsData || []) {
        const cid = metric.user_creative_id;
        if (!cid) continue;
        if (!creativeMetrics.has(cid)) {
          creativeMetrics.set(cid, { spend: 0, impressions: 0, clicks: 0, leads: 0 });
        }
        const m = creativeMetrics.get(cid)!;
        m.spend += Number(metric.spend) || 0;
        m.impressions += Number(metric.impressions) || 0;
        m.clicks += Number(metric.clicks) || 0;
        m.leads += Number(metric.leads) || 0;
      }

      // 3. Получаем уникальные ID креативов с метриками
      const creativeIdsWithMetrics = [...creativeMetrics.keys()];

      if (creativeIdsWithMetrics.length === 0) {
        return res.send({ creatives: [] });
      }

      // 4. Загружаем данные креативов
      const { data: creatives, error } = await supabase
        .from('user_creatives')
        .select(`
          id,
          title,
          thumbnail_url,
          user_id,
          direction_id,
          created_at
        `)
        .in('id', creativeIdsWithMetrics);

      if (error) throw new Error(error.message);

      // 5. Загружаем направления с target_cpl_cents
      const directionIds = [...new Set(creatives?.map(c => c.direction_id).filter(Boolean) || [])];
      let directionsMap: Record<string, { name: string; target_cpl_cents: number }> = {};
      if (directionIds.length > 0) {
        const { data: directions } = await supabase
          .from('account_directions')
          .select('id, name, target_cpl_cents')
          .in('id', directionIds);
        directionsMap = Object.fromEntries(
          directions?.map(d => [d.id, { name: d.name, target_cpl_cents: d.target_cpl_cents || 0 }]) || []
        );
      }

      // 6. Загружаем usernames
      const creativeUserIds = [...new Set(creatives?.map(c => c.user_id).filter(Boolean) || [])];
      let creativeUsersMap: Record<string, string> = {};
      if (creativeUserIds.length > 0) {
        const { data: users } = await supabase.from('user_accounts').select('id, username').in('id', creativeUserIds);
        creativeUsersMap = Object.fromEntries(users?.map(u => [u.id, u.username]) || []);
      }

      // 7. Загружаем revenue из leads (sale_amount)
      let leadsQuery = supabase
        .from('leads')
        .select('creative_id, sale_amount')
        .in('creative_id', creativeIdsWithMetrics);

      if (periodDate) {
        leadsQuery = leadsQuery.gte('created_at', periodDate.toISOString());
      }

      const { data: leadsData } = await leadsQuery;

      // Агрегируем revenue по creative_id
      const revenueMap = new Map<string, number>();
      for (const lead of leadsData || []) {
        const cid = lead.creative_id;
        if (!cid) continue;
        revenueMap.set(cid, (revenueMap.get(cid) || 0) + (Number(lead.sale_amount) || 0));
      }

      // 8. Формируем ответ с метриками
      const formattedCreatives = (creatives || []).map((creative: any) => {
        const metrics = creativeMetrics.get(creative.id) || { spend: 0, impressions: 0, clicks: 0, leads: 0 };
        const revenue = revenueMap.get(creative.id) || 0;
        const direction = creative.direction_id ? directionsMap[creative.direction_id] : null;

        // Рассчитываем ROI: ((revenue - spend) / spend) * 100
        const spendInKzt = metrics.spend * 500; // USD to KZT
        const roi = spendInKzt > 0 ? Math.round(((revenue - spendInKzt) / spendInKzt) * 100) : 0;

        // CPL в центах
        const cpl = metrics.leads > 0 ? Math.round((metrics.spend / metrics.leads) * 100) : 0;

        // CTR в процентах
        const ctr = metrics.impressions > 0 ? (metrics.clicks / metrics.impressions) * 100 : 0;

        // Плановый CPL и отклонение (только если есть фактический CPL)
        const plannedCpl = direction?.target_cpl_cents || 0;
        const cplDeviation = (plannedCpl > 0 && cpl > 0) ? Math.round(((cpl - plannedCpl) / plannedCpl) * 100 * 10) / 10 : 0;

        return {
          id: creative.id,
          name: creative.title || 'Без названия',
          thumbnail_url: creative.thumbnail_url,
          user_username: creativeUsersMap[creative.user_id] || 'Unknown',
          direction_name: direction?.name || null,
          created_at: creative.created_at,
          // Метрики из creative_metrics_history
          spend: Math.round(metrics.spend * 100), // в центах
          impressions: metrics.impressions,
          clicks: metrics.clicks,
          leads: metrics.leads,
          cpl: cpl,
          planned_cpl: plannedCpl,       // плановый CPL в центах
          cpl_deviation: cplDeviation,   // отклонение в %
          ctr: parseFloat(ctr.toFixed(2)), // CTR в процентах
          // Метрики из leads
          revenue: revenue,  // в тенге
          roi: roi,          // в процентах
          conversions: revenue > 0 ? 1 : 0,
        };
      });

      // 9. Сортируем по leads (топ креативы первыми)
      formattedCreatives.sort((a, b) => b.leads - a.leads);

      log.info({ count: formattedCreatives.length, period }, 'Fetched creatives with metrics');

      return res.send({ creatives: formattedCreatives });
    } catch (err: any) {
      log.error({ error: err instanceof Error ? err.message : JSON.stringify(err) }, 'Error fetching creatives');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_get_creatives',
        endpoint: '/admin/ads/creatives',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Failed to fetch creatives' });
    }
  });

  /**
   * GET /admin/ads/users-summary
   * ROI сводка по пользователям: расход, доход, лиды, ROI
   * Метрики из creative_metrics_history + revenue из leads
   */
  app.get('/admin/ads/users-summary', async (req, res) => {
    try {
      const { period = '7d' } = req.query as { period?: string };
      const periodDate = getPeriodDate(period);

      // 1. Получаем метрики из creative_metrics_history агрегированные по user_account_id
      let metricsQuery = supabase
        .from('creative_metrics_history')
        .select('user_account_id, user_creative_id, spend, leads')
        .not('user_account_id', 'is', null);

      if (periodDate) {
        metricsQuery = metricsQuery.gte('date', periodDate.toISOString().split('T')[0]);
      }

      const { data: metricsData, error: metricsError } = await metricsQuery;

      if (metricsError) throw new Error(metricsError.message);

      // 2. Агрегируем по user_account_id
      const userMetrics = new Map<string, {
        spend: number;
        leads: number;
        creativeIds: Set<string>;
      }>();

      for (const metric of metricsData || []) {
        const uid = metric.user_account_id;
        if (!uid) continue;
        if (!userMetrics.has(uid)) {
          userMetrics.set(uid, { spend: 0, leads: 0, creativeIds: new Set() });
        }
        const m = userMetrics.get(uid)!;
        m.spend += Number(metric.spend) || 0;
        m.leads += Number(metric.leads) || 0;
        if (metric.user_creative_id) {
          m.creativeIds.add(metric.user_creative_id);
        }
      }

      const userIds = [...userMetrics.keys()];

      if (userIds.length === 0) {
        return res.send({ users: [] });
      }

      // 3. Загружаем usernames
      const { data: users } = await supabase
        .from('user_accounts')
        .select('id, username')
        .in('id', userIds);

      const usersMap = Object.fromEntries(users?.map(u => [u.id, u.username]) || []);

      // 4. Загружаем revenue из leads по user_account_id
      let leadsQuery = supabase
        .from('leads')
        .select('user_account_id, sale_amount')
        .in('user_account_id', userIds);

      if (periodDate) {
        leadsQuery = leadsQuery.gte('created_at', periodDate.toISOString());
      }

      const { data: leadsData } = await leadsQuery;

      // Агрегируем revenue по user_account_id
      const revenueMap = new Map<string, number>();
      for (const lead of leadsData || []) {
        const uid = lead.user_account_id;
        if (!uid) continue;
        revenueMap.set(uid, (revenueMap.get(uid) || 0) + (Number(lead.sale_amount) || 0));
      }

      // 5. Формируем ответ
      const usersSummary = userIds.map(userId => {
        const metrics = userMetrics.get(userId)!;
        const revenue = revenueMap.get(userId) || 0;

        // spend в центах для отображения
        const spendCents = Math.round(metrics.spend * 100);
        // CPL в центах
        const cpl = metrics.leads > 0 ? Math.round((metrics.spend / metrics.leads) * 100) : 0;
        // ROI: ((revenue - spend_kzt) / spend_kzt) * 100
        const spendInKzt = metrics.spend * 500; // USD to KZT
        const roi = spendInKzt > 0 ? Math.round(((revenue - spendInKzt) / spendInKzt) * 100) : 0;

        return {
          user_id: userId,
          username: usersMap[userId] || 'Unknown',
          spend: spendCents,
          revenue: revenue,
          leads: metrics.leads,
          cpl: cpl,
          roi: roi,
          creatives_count: metrics.creativeIds.size,
        };
      });

      // Сортируем по расходу (больший расход первым)
      usersSummary.sort((a, b) => b.spend - a.spend);

      log.info({ count: usersSummary.length, period }, 'Fetched users ROI summary');

      return res.send({ users: usersSummary });
    } catch (err: any) {
      log.error({ error: err instanceof Error ? err.message : JSON.stringify(err) }, 'Error fetching users summary');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_get_users_summary',
        endpoint: '/admin/ads/users-summary',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Failed to fetch users summary' });
    }
  });

  /**
   * GET /admin/ads/cpl-analysis
   * CPL анализ по направлениям: план vs факт
   * Метрики (spend, leads) берутся напрямую из Facebook API
   */
  app.get('/admin/ads/cpl-analysis', async (req, res) => {
    try {
      const { period = '7d' } = req.query as { period?: string };
      const fbPeriod = period as '7d' | '14d' | '30d' | 'all';

      // Get all directions with target_cpl_cents and fb_campaign_id
      const { data: directions, error } = await supabase
        .from('account_directions')
        .select(`
          id,
          name,
          user_account_id,
          target_cpl_cents,
          fb_campaign_id
        `);

      if (error) throw new Error(error.message);

      // Загружаем usernames и access_token
      const directionUserIds = [...new Set(directions?.map(d => d.user_account_id).filter(Boolean) || [])];
      let usersData: Record<string, { username: string; access_token: string | null }> = {};

      if (directionUserIds.length > 0) {
        const { data: users } = await supabase
          .from('user_accounts')
          .select('id, username, access_token')
          .in('id', directionUserIds);

        usersData = Object.fromEntries(
          users?.map(u => [u.id, { username: u.username, access_token: u.access_token }]) || []
        );
      }

      // Собираем все кампании для batch запроса к FB
      const campaignsToFetch: { campaignId: string; accessToken: string; directionId: string }[] = [];

      for (const direction of directions || []) {
        if (direction.fb_campaign_id && usersData[direction.user_account_id]?.access_token) {
          campaignsToFetch.push({
            campaignId: direction.fb_campaign_id,
            accessToken: usersData[direction.user_account_id].access_token!,
            directionId: direction.id
          });
        }
      }

      // Получаем метрики из Facebook API (batch запрос)
      const fbInsights = await getCampaignInsightsBatch(
        campaignsToFetch.map(c => ({ campaignId: c.campaignId, accessToken: c.accessToken })),
        fbPeriod
      );

      log.info({ campaignsCount: campaignsToFetch.length, insightsCount: fbInsights.size }, 'Fetched FB insights');

      // Формируем результат
      const analysis = (directions || []).map((direction: any) => {
        const userData = usersData[direction.user_account_id] || { username: 'Unknown', access_token: null };
        const fbData = direction.fb_campaign_id ? fbInsights.get(direction.fb_campaign_id) : null;

        const spend = fbData?.spend || 0;
        const leads = fbData?.leads || 0;
        const actualCpl = fbData?.cpl || 0;  // CPL уже посчитан в fbCampaignInsights

        const plannedCpl = direction.target_cpl_cents || 0;
        const deviationPercent = plannedCpl > 0
          ? ((actualCpl - plannedCpl) / plannedCpl) * 100
          : 0;

        return {
          user_id: direction.user_account_id,
          user_username: userData.username,
          direction_id: direction.id,
          direction_name: direction.name,
          fb_campaign_id: direction.fb_campaign_id,
          planned_cpl: plannedCpl,
          actual_cpl: actualCpl,
          deviation_percent: Math.round(deviationPercent * 10) / 10,
          leads_count: leads,
          spend: Math.round(spend * 100), // convert to cents for display
        };
      });

      // Filter out entries with no FB campaign or no data
      const filteredAnalysis = analysis.filter(a => a.fb_campaign_id && (a.leads_count > 0 || a.spend > 0));

      return res.send({ analysis: filteredAnalysis });
    } catch (err: any) {
      log.error({ error: err instanceof Error ? err.message : JSON.stringify(err) }, 'Error fetching CPL analysis');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_get_cpl_analysis',
        endpoint: '/admin/ads/cpl-analysis',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Failed to fetch CPL analysis' });
    }
  });
}
