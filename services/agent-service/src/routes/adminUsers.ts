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

      if (!users || users.length === 0) {
        return res.send({
          users: [],
          total: total || 0,
          page: pageNum,
          totalPages: Math.ceil((total || 0) / limitNum),
        });
      }

      // Batch-запросы вместо N+1
      const userIds = users.map(u => u.id);

      // Все счётчики одним batch-запросом каждый
      const [directionsRes, creativesRes, leadsRes, sessionsRes] = await Promise.all([
        // Directions count per user
        supabase
          .from('account_directions')
          .select('user_account_id')
          .in('user_account_id', userIds),

        // Creatives count per user
        supabase
          .from('user_creatives')
          .select('user_id')
          .in('user_id', userIds),

        // Leads count per user
        supabase
          .from('leads')
          .select('user_account_id')
          .in('user_account_id', userIds),

        // Last activity per user (берём все сессии и группируем)
        supabase
          .from('user_sessions')
          .select('user_account_id, updated_at')
          .in('user_account_id', userIds)
          .order('updated_at', { ascending: false })
      ]);

      // Подсчёт directions по user_id
      const directionsCount: Record<string, number> = {};
      (directionsRes.data || []).forEach(d => {
        directionsCount[d.user_account_id] = (directionsCount[d.user_account_id] || 0) + 1;
      });

      // Подсчёт creatives по user_id
      const creativesCount: Record<string, number> = {};
      (creativesRes.data || []).forEach(c => {
        creativesCount[c.user_id] = (creativesCount[c.user_id] || 0) + 1;
      });

      // Подсчёт leads по user_id
      const leadsCount: Record<string, number> = {};
      (leadsRes.data || []).forEach(l => {
        leadsCount[l.user_account_id] = (leadsCount[l.user_account_id] || 0) + 1;
      });

      // Последняя активность (первая запись для каждого user т.к. отсортировано desc)
      const lastActivity: Record<string, string> = {};
      (sessionsRes.data || []).forEach(s => {
        if (!lastActivity[s.user_account_id]) {
          lastActivity[s.user_account_id] = s.updated_at;
        }
      });

      // Собираем результат
      const usersWithStats = users.map(user => ({
        ...user,
        directions_count: directionsCount[user.id] || 0,
        creatives_count: creativesCount[user.id] || 0,
        leads_count: leadsCount[user.id] || 0,
        last_activity_at: lastActivity[user.id] || null,
      }));

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

  /**
   * PUT /admin/users/:userId
   * Обновить данные пользователя
   */
  app.put('/admin/users/:userId', async (req, res) => {
    try {
      const { userId } = req.params as { userId: string };
      const updates = req.body as Record<string, any>;

      // Убираем поля, которые не должны обновляться напрямую
      const { id, created_at, ...allowedUpdates } = updates;

      // Список разрешённых полей для обновления
      const allowedFields = [
        // Facebook/Instagram
        'access_token',
        'ad_account_id',
        'page_id',
        'business_id',
        'instagram_id',
        'instagram_username',
        // Telegram
        'telegram_id',
        'telegram_bot_token',
        // TikTok
        'tiktok_business_id',
        'tiktok_account_id',
        'tiktok_access_token',
        // Тариф и бюджет
        'tarif',
        'tarif_expires',
        'tarif_renewal_cost',
        'plan_daily_budget_cents',
        'default_cpl_target_cents',
        // Прочее
        'webhook_url',
        'optimization',
        'creative_generations_available',
        'current_campaign_goal',
        'prompt1',
        'prompt2',
        'prompt3',
        'prompt4',
        'onboarding_stage',
        // Чекбоксы
        'is_active',
        'test',
        'autopilot',
        // Базовые
        'username',
      ];

      // Фильтруем только разрешённые поля
      const filteredUpdates: Record<string, any> = {};
      for (const [key, value] of Object.entries(allowedUpdates)) {
        if (allowedFields.includes(key)) {
          // Преобразуем пустые строки в null
          filteredUpdates[key] = value === '' ? null : value;
        }
      }

      if (Object.keys(filteredUpdates).length === 0) {
        return res.status(400).send({ error: 'No valid fields to update' });
      }

      const { data, error } = await supabase
        .from('user_accounts')
        .update(filteredUpdates)
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        throw new Error(error.message);
      }

      log.info({ userId, fields: Object.keys(filteredUpdates) }, 'User updated by admin');

      return res.send({ success: true, user: data });
    } catch (err: any) {
      log.error({ error: err instanceof Error ? err.message : JSON.stringify(err) }, 'Error updating user');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_update_user',
        endpoint: '/admin/users/:userId',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Failed to update user' });
    }
  });
}
