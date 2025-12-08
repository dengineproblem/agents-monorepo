/**
 * Admin Users Routes
 *
 * API для управления пользователями в админ-панели
 *
 * @module routes/adminUsers
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'adminUsers' });

export default async function adminUsersRoutes(app: FastifyInstance) {

  /**
   * GET /admin/users
   * Получить список пользователей с пагинацией и фильтрами
   */
  app.get('/admin/users', async (req, res) => {
    try {
      const {
        page = '1',
        limit = '20',
        search = '',
        stage = '',
      } = req.query as Record<string, string>;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const offset = (pageNum - 1) * limitNum;

      // Build query
      let query = supabase
        .from('user_accounts')
        .select('*', { count: 'exact' });

      // Search filter
      if (search) {
        query = query.or(`username.ilike.%${search}%,telegram_id.ilike.%${search}%,email.ilike.%${search}%`);
      }

      // Stage filter
      if (stage) {
        query = query.eq('onboarding_stage', stage);
      }

      // Get total count
      const { count: total } = await query;

      // Get paginated data
      const { data: users, error } = await supabase
        .from('user_accounts')
        .select(`
          id,
          username,
          email,
          telegram_id,
          onboarding_stage,
          created_at,
          engagement_score
        `)
        .order('created_at', { ascending: false })
        .range(offset, offset + limitNum - 1);

      if (error) throw error;

      // Get additional stats for each user
      const usersWithStats = await Promise.all(
        (users || []).map(async (user) => {
          // Campaigns count
          const { count: campaigns_count } = await supabase
            .from('campaigns')
            .select('*', { count: 'exact', head: true })
            .eq('user_account_id', user.id);

          // Creatives count
          const { count: creatives_count } = await supabase
            .from('user_creatives')
            .select('*', { count: 'exact', head: true })
            .eq('user_account_id', user.id);

          // Leads count
          const { count: leads_count } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('user_account_id', user.id);

          // Last activity
          const { data: session } = await supabase
            .from('user_sessions')
            .select('last_activity_at')
            .eq('user_account_id', user.id)
            .order('last_activity_at', { ascending: false })
            .limit(1)
            .single();

          return {
            ...user,
            campaigns_count: campaigns_count || 0,
            creatives_count: creatives_count || 0,
            leads_count: leads_count || 0,
            last_activity_at: session?.last_activity_at || null,
          };
        })
      );

      return res.send({
        users: usersWithStats,
        total: total || 0,
        page: pageNum,
        totalPages: Math.ceil((total || 0) / limitNum),
      });
    } catch (err) {
      log.error({ error: String(err) }, 'Error fetching users');
      return res.status(500).send({ error: 'Failed to fetch users' });
    }
  });

  /**
   * GET /admin/users/search
   * Поиск пользователей для Command Palette
   */
  app.get('/admin/users/search', async (req, res) => {
    try {
      const { q = '', limit = '5' } = req.query as Record<string, string>;

      if (!q || q.length < 2) {
        return res.send({ users: [] });
      }

      const { data: users } = await supabase
        .from('user_accounts')
        .select('id, username, email, telegram_id')
        .or(`username.ilike.%${q}%,telegram_id.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(parseInt(limit));

      return res.send({ users: users || [] });
    } catch (err) {
      log.error({ error: String(err) }, 'Error searching users');
      return res.status(500).send({ error: 'Failed to search users' });
    }
  });

  /**
   * GET /admin/users/:userId
   * Получить детали пользователя
   */
  app.get('/admin/users/:userId', async (req, res) => {
    try {
      const { userId } = req.params as { userId: string };

      const { data: user, error } = await supabase
        .from('user_accounts')
        .select('*')
        .eq('id', userId)
        .single();

      if (error || !user) {
        return res.status(404).send({ error: 'User not found' });
      }

      // Get related data
      const [
        { count: campaigns_count },
        { count: creatives_count },
        { count: leads_count },
        { data: directions },
        { data: recentLeads },
      ] = await Promise.all([
        supabase.from('campaigns').select('*', { count: 'exact', head: true }).eq('user_account_id', userId),
        supabase.from('user_creatives').select('*', { count: 'exact', head: true }).eq('user_account_id', userId),
        supabase.from('leads').select('*', { count: 'exact', head: true }).eq('user_account_id', userId),
        supabase.from('account_directions').select('*').eq('user_account_id', userId),
        supabase.from('leads').select('*').eq('user_account_id', userId).order('created_at', { ascending: false }).limit(10),
      ]);

      return res.send({
        user: {
          ...user,
          campaigns_count: campaigns_count || 0,
          creatives_count: creatives_count || 0,
          leads_count: leads_count || 0,
        },
        directions: directions || [],
        recentLeads: recentLeads || [],
      });
    } catch (err) {
      log.error({ error: String(err) }, 'Error fetching user details');
      return res.status(500).send({ error: 'Failed to fetch user details' });
    }
  });
}
