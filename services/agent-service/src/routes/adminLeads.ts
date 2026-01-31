/**
 * Admin Leads Routes
 *
 * API для раздела лидов в админ-панели
 *
 * @module routes/adminLeads
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

const log = createLogger({ module: 'adminLeads' });

function getPeriodDate(period: string): Date | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case 'today':
      return today;
    case '7d':
      return new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    case 'all':
    default:
      return null;
  }
}

export default async function adminLeadsRoutes(app: FastifyInstance) {

  /**
   * GET /admin/leads
   * Получить все лиды с фильтрами и пагинацией
   */
  app.get('/admin/leads', async (req, res) => {
    try {
      const {
        period = '7d',
        userId = '',
        page = '1',
        limit = '20',
      } = req.query as Record<string, string>;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const offset = (pageNum - 1) * limitNum;
      const periodDate = getPeriodDate(period);

      // Build query - без FK joins, чтобы избежать ошибок
      // NOTE: таблица leads НЕ имеет campaign_id, только direction_id и creative_id
      let query = supabase
        .from('leads')
        .select(`
          id,
          name,
          phone,
          chat_id,
          creative_id,
          direction_id,
          user_account_id,
          source_id,
          source_type,
          created_at
        `, { count: 'exact' })
        .order('created_at', { ascending: false });

      if (periodDate) {
        query = query.gte('created_at', periodDate.toISOString());
      }

      if (userId) {
        query = query.eq('user_account_id', userId);
      }

      // Get paginated data
      const { data: leads, error, count: total } = await query
        .range(offset, offset + limitNum - 1);

      if (error) throw new Error(error.message);

      // Собираем уникальные ID для подгрузки связанных данных
      const userIds = [...new Set(leads?.map(l => l.user_account_id).filter(Boolean) || [])];
      const directionIds = [...new Set(leads?.map(l => l.direction_id).filter(Boolean) || [])];
      const creativeIds = [...new Set(leads?.map(l => l.creative_id).filter(Boolean) || [])];

      // Загружаем связанные данные параллельно
      const [usersResult, directionsResult, creativesResult] = await Promise.all([
        userIds.length > 0
          ? supabase.from('user_accounts').select('id, username').in('id', userIds)
          : { data: [] },
        directionIds.length > 0
          ? supabase.from('account_directions').select('id, name').in('id', directionIds)
          : { data: [] },
        creativeIds.length > 0
          ? supabase.from('user_creatives').select('id, title').in('id', creativeIds)
          : { data: [] },
      ]);

      // Создаём lookup maps
      const usersMap = Object.fromEntries(usersResult.data?.map(u => [u.id, u.username]) || []);
      const directionsMap = Object.fromEntries(directionsResult.data?.map(d => [d.id, d.name]) || []);

      // Создаём lookup map для названий креативов
      const creativeTitlesMap = Object.fromEntries(
        creativesResult.data?.map(c => [c.id, c.title]) || []
      );

      // Получить метрики напрямую через user_creative_id (БЕЗ fb_creative_id!)
      let metricsQuery = supabase
        .from('creative_metrics_history')
        .select('user_creative_id, spend, platform');

      if (periodDate) {
        metricsQuery = metricsQuery.gte('date', periodDate.toISOString().split('T')[0]);
      }
      if (creativeIds.length > 0) {
        metricsQuery = metricsQuery.in('user_creative_id', creativeIds);
      }

      const { data: metricsData } = await metricsQuery;

      // Суммируем spend по user_creative_id (один креатив = одна сумма)
      const spendByCreativeId: Record<string, number> = {};
      (metricsData || []).forEach((m: any) => {
        if (m.user_creative_id && m.spend) {
          const key = m.user_creative_id;
          spendByCreativeId[key] = (spendByCreativeId[key] || 0) + parseFloat(m.spend);
        }
      });

      // Посчитать количество лидов по креативам за ОДИН проход O(N)
      const leadsCountByCreative: Record<string, number> = {};
      (leads || []).forEach((lead: any) => {
        if (lead.creative_id) {
          leadsCountByCreative[lead.creative_id] = (leadsCountByCreative[lead.creative_id] || 0) + 1;
        }
      });

      // Вычислить CPL для каждого креатива (не для каждого лида!)
      const cplByCreative: Record<string, number | null> = {};
      Object.keys(leadsCountByCreative).forEach(creativeId => {
        const totalSpend = spendByCreativeId[creativeId] || 0;
        const leadsCount = leadsCountByCreative[creativeId];

        if (leadsCount > 0) {
          if (totalSpend > 0) {
            cplByCreative[creativeId] = Math.round((totalSpend / leadsCount) * 100); // в центах
          } else {
            cplByCreative[creativeId] = 0; // Реально $0.00 (тестовая кампания)
          }
        }
        // Если метрик нет вообще → не добавляем в map (будет undefined = null)
      });

      // Format leads
      const formattedLeads = (leads || []).map((lead: any) => {
        // Парсим телефон из chat_id для WhatsApp лидов
        let phoneNumber = lead.phone;
        if (!phoneNumber && lead.chat_id && lead.source_type === 'whatsapp') {
          // Формат: 79123456789@s.whatsapp.net или 79123456789@c.us
          const match = lead.chat_id.match(/^(\d+)@/);
          if (match) {
            phoneNumber = '+' + match[1];
          }
        }

        return {
          id: lead.id,
          user_username: usersMap[lead.user_account_id] || 'Unknown',
          lead_name: lead.name,
          phone: phoneNumber,
          source: lead.source_type || null, // whatsapp/website/lead_form
          direction_name: directionsMap[lead.direction_id] || null,
          creative_name: creativeTitlesMap[lead.creative_id] || null,
          cost: lead.creative_id && cplByCreative[lead.creative_id] !== undefined
            ? cplByCreative[lead.creative_id]
            : null, // null = нет метрик, 0 = реально $0.00
          created_at: lead.created_at,
        };
      });

      // Calculate stats
      let statsQuery = supabase
        .from('leads')
        .select('id, creative_id');

      if (periodDate) {
        statsQuery = statsQuery.gte('created_at', periodDate.toISOString());
      }
      if (userId) {
        statsQuery = statsQuery.eq('user_account_id', userId);
      }

      const { data: allLeads } = await statsQuery;
      const totalLeads = allLeads?.length || 0;

      // Calculate total spend using user_creative_id
      const allStatsCreativeIds = [...new Set(allLeads?.map(l => l.creative_id).filter(Boolean) || [])];

      let totalSpendDollars = 0;
      if (allStatsCreativeIds.length > 0) {
        let statsMetricsQuery = supabase
          .from('creative_metrics_history')
          .select('spend')
          .in('user_creative_id', allStatsCreativeIds); // ИЗМЕНЕНО: user_creative_id вместо creative_id

        if (periodDate) {
          statsMetricsQuery = statsMetricsQuery.gte('date', periodDate.toISOString().split('T')[0]);
        }

        const { data: statsMetrics } = await statsMetricsQuery;
        totalSpendDollars = (statsMetrics || []).reduce((sum, m) => sum + (parseFloat(m.spend) || 0), 0);
      }

      const averageCpl = totalLeads > 0 ? totalSpendDollars / totalLeads : 0;

      // Get available users for filter
      const { data: usersData } = await supabase
        .from('user_accounts')
        .select('id, username')
        .order('username');

      return res.send({
        leads: formattedLeads,
        total: total || 0,
        page: pageNum,
        totalPages: Math.ceil((total || 0) / limitNum),
        stats: {
          total: totalLeads,
          averageCpl: Math.round(averageCpl * 100), // в центах
          totalSpend: Math.round(totalSpendDollars * 100), // в центах
        },
        users: usersData || [],
      });
    } catch (err: any) {
      log.error({ error: err instanceof Error ? err.message : JSON.stringify(err) }, 'Error fetching leads');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_list_leads',
        endpoint: '/admin/leads',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Failed to fetch leads' });
    }
  });
}
