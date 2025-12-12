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
          creative_id,
          direction_id,
          user_account_id,
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

      // Загружаем связанные данные параллельно
      const [usersResult, directionsResult] = await Promise.all([
        userIds.length > 0
          ? supabase.from('user_accounts').select('id, username').in('id', userIds)
          : { data: [] },
        directionIds.length > 0
          ? supabase.from('account_directions').select('id, name').in('id', directionIds)
          : { data: [] },
      ]);

      // Создаём lookup maps
      const usersMap = Object.fromEntries(usersResult.data?.map(u => [u.id, u.username]) || []);
      const directionsMap = Object.fromEntries(directionsResult.data?.map(d => [d.id, d.name]) || []);

      // Format leads
      const formattedLeads = (leads || []).map((lead: any) => ({
        id: lead.id,
        user_username: usersMap[lead.user_account_id] || 'Unknown',
        lead_name: lead.name,
        phone: lead.phone,
        direction_name: directionsMap[lead.direction_id] || null,
        cost: 0, // TODO: calculate lead cost
        created_at: lead.created_at,
      }));

      // Calculate stats
      let statsQuery = supabase
        .from('leads')
        .select('id');

      if (periodDate) {
        statsQuery = statsQuery.gte('created_at', periodDate.toISOString());
      }
      if (userId) {
        statsQuery = statsQuery.eq('user_account_id', userId);
      }

      const { data: allLeads } = await statsQuery;
      const totalLeads = allLeads?.length || 0;

      // TODO: Calculate actual spend and average CPL
      const totalSpend = 0;
      const averageCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;

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
          averageCpl: Math.round(averageCpl),
          totalSpend: Math.round(totalSpend * 100),
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
