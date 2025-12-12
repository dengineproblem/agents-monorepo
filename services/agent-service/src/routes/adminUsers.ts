/**
 * Admin Users Routes
 *
 * API для управления пользователями в админ-панели
 * NOTE: Таблицы campaigns НЕ существует! user_creatives.user_id (не user_account_id)
 *
 * @module routes/adminUsers
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

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

      // Build query for count
      let countQuery = supabase
        .from('user_accounts')
        .select('*', { count: 'exact', head: true });

      // Search filter (без email - колонка не существует)
      if (search) {
        countQuery = countQuery.or(`username.ilike.%${search}%,telegram_id.ilike.%${search}%`);
      }

      // Stage filter
      if (stage) {
        countQuery = countQuery.eq('onboarding_stage', stage);
      }

      // Get total count
      const { count: total } = await countQuery;

      // Build data query (без email, engagement_score - колонки не существуют)
      let dataQuery = supabase
        .from('user_accounts')
        .select(`
          id,
          username,
          telegram_id,
          onboarding_stage,
          created_at
        `)
        .order('created_at', { ascending: false })
        .range(offset, offset + limitNum - 1);

      // Apply same filters
      if (search) {
        dataQuery = dataQuery.or(`username.ilike.%${search}%,telegram_id.ilike.%${search}%`);
      }
      if (stage) {
        dataQuery = dataQuery.eq('onboarding_stage', stage);
      }

      const { data: users, error } = await dataQuery;

      if (error) throw new Error(error.message);

      // Get additional stats for each user (без campaigns - таблица не существует)
      const usersWithStats = await Promise.all(
        (users || []).map(async (user) => {
          // Directions count (вместо campaigns)
          const { count: directions_count } = await supabase
            .from('account_directions')
            .select('*', { count: 'exact', head: true })
            .eq('user_account_id', user.id);

          // Creatives count (user_creatives.user_id, не user_account_id!)
          const { count: creatives_count } = await supabase
            .from('user_creatives')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);

          // Leads count
          const { count: leads_count } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('user_account_id', user.id);

          // Last activity (updated_at, не last_activity_at!)
          const { data: session } = await supabase
            .from('user_sessions')
            .select('updated_at')
            .eq('user_account_id', user.id)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          return {
            ...user,
            directions_count: directions_count || 0,
            creatives_count: creatives_count || 0,
            leads_count: leads_count || 0,
            last_activity_at: session?.updated_at || null,
          };
        })
      );

      return res.send({
        users: usersWithStats,
        total: total || 0,
        page: pageNum,
        totalPages: Math.ceil((total || 0) / limitNum),
      });
    } catch (err: any) {
      log.error({ error: err instanceof Error ? err.message : JSON.stringify(err) }, 'Error fetching users');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_list_users',
        endpoint: '/admin/users',
        severity: 'warning'
      }).catch(() => {});

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
        .select('id, username, telegram_id')
        .or(`username.ilike.%${q}%,telegram_id.ilike.%${q}%`)
        .limit(parseInt(limit));

      return res.send({ users: users || [] });
    } catch (err: any) {
      log.error({ error: err instanceof Error ? err.message : JSON.stringify(err) }, 'Error searching users');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_search_users',
        endpoint: '/admin/users/search',
        severity: 'warning'
      }).catch(() => {});

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

      // Get related data (без campaigns - таблица не существует)
      const [
        { count: directions_count },
        { count: creatives_count },
        { count: leads_count },
        { data: directions },
        { data: recentLeads },
      ] = await Promise.all([
        supabase.from('account_directions').select('*', { count: 'exact', head: true }).eq('user_account_id', userId),
        supabase.from('user_creatives').select('*', { count: 'exact', head: true }).eq('user_id', userId),
        supabase.from('leads').select('*', { count: 'exact', head: true }).eq('user_account_id', userId),
        supabase.from('account_directions').select('*').eq('user_account_id', userId),
        supabase.from('leads').select('*').eq('user_account_id', userId).order('created_at', { ascending: false }).limit(10),
      ]);

      return res.send({
        user: {
          ...user,
          directions_count: directions_count || 0,
          creatives_count: creatives_count || 0,
          leads_count: leads_count || 0,
        },
        directions: directions || [],
        recentLeads: recentLeads || [],
      });
    } catch (err: any) {
      log.error({ error: err instanceof Error ? err.message : JSON.stringify(err) }, 'Error fetching user details');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_get_user_details',
        endpoint: '/admin/users/:userId',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Failed to fetch user details' });
    }
  });
}
