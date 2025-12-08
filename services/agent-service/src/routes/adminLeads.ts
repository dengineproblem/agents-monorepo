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

      // Build query
      let query = supabase
        .from('leads')
        .select(`
          id,
          name,
          phone,
          campaign_id,
          creative_id,
          direction_id,
          user_account_id,
          created_at,
          user_accounts!leads_user_account_id_fkey(username),
          campaigns!leads_campaign_id_fkey(name),
          account_directions!leads_direction_id_fkey(name)
        `, { count: 'exact' })
        .order('created_at', { ascending: false });

      if (periodDate) {
        query = query.gte('created_at', periodDate.toISOString());
      }

      if (userId) {
        query = query.eq('user_account_id', userId);
      }

      // Get total count first
      const countQuery = supabase
        .from('leads')
        .select('*', { count: 'exact', head: true });

      if (periodDate) {
        countQuery.gte('created_at', periodDate.toISOString());
      }
      if (userId) {
        countQuery.eq('user_account_id', userId);
      }

      const { count: total } = await countQuery;

      // Get paginated data
      const { data: leads, error } = await query
        .range(offset, offset + limitNum - 1);

      if (error) throw error;

      // Format leads
      const formattedLeads = (leads || []).map((lead: any) => ({
        id: lead.id,
        user_username: lead.user_accounts?.username || 'Unknown',
        lead_name: lead.name,
        phone: lead.phone,
        campaign_name: lead.campaigns?.name,
        direction_name: lead.account_directions?.name,
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
    } catch (err) {
      log.error({ error: String(err) }, 'Error fetching leads');
      return res.status(500).send({ error: 'Failed to fetch leads' });
    }
  });
}
