/**
 * Admin Ads Routes
 *
 * API для раздела рекламы в админ-панели: кампании, креативы, CPL анализ
 *
 * @module routes/adminAds
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

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
   * GET /admin/ads/campaigns
   * Получить все кампании всех пользователей
   */
  app.get('/admin/ads/campaigns', async (req, res) => {
    try {
      const { period = '7d' } = req.query as { period?: string };
      const periodDate = getPeriodDate(period);

      let query = supabase
        .from('campaigns')
        .select(`
          id,
          name,
          status,
          user_account_id,
          created_at,
          user_accounts!campaigns_user_account_id_fkey(username)
        `)
        .order('created_at', { ascending: false });

      if (periodDate) {
        query = query.gte('created_at', periodDate.toISOString());
      }

      const { data: campaigns, error } = await query.limit(100);

      if (error) throw error;

      // Get metrics for campaigns
      const campaignsWithMetrics = await Promise.all(
        (campaigns || []).map(async (campaign: any) => {
          // Get aggregated metrics
          const { data: metrics } = await supabase
            .from('creative_metrics_history')
            .select('spend, impressions, clicks')
            .eq('campaign_id', campaign.id);

          const totalSpend = metrics?.reduce((sum, m) => sum + (m.spend || 0), 0) || 0;
          const totalImpressions = metrics?.reduce((sum, m) => sum + (m.impressions || 0), 0) || 0;
          const totalClicks = metrics?.reduce((sum, m) => sum + (m.clicks || 0), 0) || 0;

          // Get leads count
          const { count: leadsCount } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('campaign_id', campaign.id);

          const cpl = leadsCount && leadsCount > 0 ? (totalSpend / leadsCount) * 100 : 0;

          return {
            id: campaign.id,
            name: campaign.name,
            status: campaign.status || 'unknown',
            user_username: campaign.user_accounts?.username || 'Unknown',
            spend: Math.round(totalSpend * 100),
            impressions: totalImpressions,
            clicks: totalClicks,
            leads: leadsCount || 0,
            cpl: Math.round(cpl),
          };
        })
      );

      return res.send({ campaigns: campaignsWithMetrics });
    } catch (err) {
      log.error({ error: String(err) }, 'Error fetching campaigns');
      return res.status(500).send({ error: 'Failed to fetch campaigns' });
    }
  });

  /**
   * GET /admin/ads/creatives
   * Получить топ креативов по метрикам
   */
  app.get('/admin/ads/creatives', async (req, res) => {
    try {
      const { period = '7d' } = req.query as { period?: string };
      const periodDate = getPeriodDate(period);

      let query = supabase
        .from('user_creatives')
        .select(`
          id,
          name,
          thumbnail_url,
          user_account_id,
          user_accounts!user_creatives_user_account_id_fkey(username)
        `)
        .limit(50);

      const { data: creatives, error } = await query;

      if (error) throw error;

      // Get metrics for creatives
      const creativesWithMetrics = await Promise.all(
        (creatives || []).map(async (creative: any) => {
          let metricsQuery = supabase
            .from('creative_metrics_history')
            .select('spend, impressions, clicks')
            .eq('user_creative_id', creative.id);

          if (periodDate) {
            metricsQuery = metricsQuery.gte('date', periodDate.toISOString().split('T')[0]);
          }

          const { data: metrics } = await metricsQuery;

          const totalSpend = metrics?.reduce((sum, m) => sum + (m.spend || 0), 0) || 0;
          const totalImpressions = metrics?.reduce((sum, m) => sum + (m.impressions || 0), 0) || 0;
          const totalClicks = metrics?.reduce((sum, m) => sum + (m.clicks || 0), 0) || 0;

          const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

          // Leads - approximate by creative
          const { count: leadsCount } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('creative_id', creative.id);

          const cpl = leadsCount && leadsCount > 0 ? (totalSpend / leadsCount) * 100 : 0;

          return {
            id: creative.id,
            name: creative.name || 'Без названия',
            thumbnail_url: creative.thumbnail_url,
            user_username: creative.user_accounts?.username || 'Unknown',
            spend: Math.round(totalSpend * 100),
            impressions: totalImpressions,
            clicks: totalClicks,
            ctr: Math.round(ctr * 100) / 100,
            leads: leadsCount || 0,
            cpl: Math.round(cpl),
          };
        })
      );

      // Sort by spend descending
      creativesWithMetrics.sort((a, b) => b.spend - a.spend);

      return res.send({ creatives: creativesWithMetrics.slice(0, 30) });
    } catch (err) {
      log.error({ error: String(err) }, 'Error fetching creatives');
      return res.status(500).send({ error: 'Failed to fetch creatives' });
    }
  });

  /**
   * GET /admin/ads/cpl-analysis
   * CPL анализ по направлениям: план vs факт
   */
  app.get('/admin/ads/cpl-analysis', async (req, res) => {
    try {
      const { period = '7d' } = req.query as { period?: string };
      const periodDate = getPeriodDate(period);

      // Get all directions with planned CPL
      const { data: directions, error } = await supabase
        .from('account_directions')
        .select(`
          id,
          name,
          default_cpl_target_cents,
          user_account_id,
          user_accounts!account_directions_user_account_id_fkey(username)
        `)
        .not('default_cpl_target_cents', 'is', null);

      if (error) throw error;

      // Calculate actual CPL for each direction
      const analysis = await Promise.all(
        (directions || []).map(async (direction: any) => {
          // Get leads for this direction in period
          let leadsQuery = supabase
            .from('leads')
            .select('*', { count: 'exact' })
            .eq('direction_id', direction.id);

          if (periodDate) {
            leadsQuery = leadsQuery.gte('created_at', periodDate.toISOString());
          }

          const { count: leadsCount, data: leads } = await leadsQuery;

          // Get spend for this direction (via campaigns)
          const { data: campaigns } = await supabase
            .from('campaigns')
            .select('id')
            .eq('direction_id', direction.id);

          let totalSpend = 0;
          if (campaigns && campaigns.length > 0) {
            const campaignIds = campaigns.map(c => c.id);

            let metricsQuery = supabase
              .from('creative_metrics_history')
              .select('spend')
              .in('campaign_id', campaignIds);

            if (periodDate) {
              metricsQuery = metricsQuery.gte('date', periodDate.toISOString().split('T')[0]);
            }

            const { data: metrics } = await metricsQuery;
            totalSpend = metrics?.reduce((sum, m) => sum + (m.spend || 0), 0) || 0;
          }

          const actualCpl = leadsCount && leadsCount > 0 ? (totalSpend / leadsCount) * 100 : 0;
          const plannedCpl = direction.default_cpl_target_cents || 0;

          const deviation = plannedCpl > 0
            ? ((actualCpl - plannedCpl) / plannedCpl) * 100
            : 0;

          return {
            user_id: direction.user_account_id,
            user_username: direction.user_accounts?.username || 'Unknown',
            direction_id: direction.id,
            direction_name: direction.name,
            planned_cpl: plannedCpl,
            actual_cpl: Math.round(actualCpl),
            deviation_percent: Math.round(deviation * 10) / 10,
            leads_count: leadsCount || 0,
            spend: Math.round(totalSpend * 100),
          };
        })
      );

      // Filter out entries with no data
      const filteredAnalysis = analysis.filter(a => a.leads_count > 0 || a.spend > 0);

      return res.send({ analysis: filteredAnalysis });
    } catch (err) {
      log.error({ error: String(err) }, 'Error fetching CPL analysis');
      return res.status(500).send({ error: 'Failed to fetch CPL analysis' });
    }
  });
}
