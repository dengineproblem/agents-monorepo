/**
 * Admin Stats Routes
 *
 * API для статистики дашборда админ-панели
 *
 * @module routes/adminStats
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'adminStats' });

export default async function adminStatsRoutes(app: FastifyInstance) {

  /**
   * GET /admin/stats/dashboard
   * Получить статистику для дашборда
   */
  app.get('/admin/stats/dashboard', async (req, res) => {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Общее количество пользователей
      const { count: totalUsers } = await supabase
        .from('user_accounts')
        .select('*', { count: 'exact', head: true });

      // Новые пользователи за 7 дней
      const { count: newUsersLast7Days } = await supabase
        .from('user_accounts')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', weekAgo.toISOString());

      // Активные пользователи (с активностью за 7 дней)
      const { count: activeUsers } = await supabase
        .from('user_sessions')
        .select('user_account_id', { count: 'exact', head: true })
        .gte('updated_at', weekAgo.toISOString());

      // Лиды за сегодня
      const { count: leadsToday } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today.toISOString());

      // Лиды за неделю
      const { count: leadsWeek } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', weekAgo.toISOString());

      // Лиды за месяц
      const { count: leadsMonth } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', monthAgo.toISOString());

      // Общий расход (сумма spend из creative_metrics_history за всё время)
      const { data: spendData } = await supabase
        .from('creative_metrics_history')
        .select('spend');

      const totalSpend = spendData?.reduce((sum, row) => sum + (row.spend || 0), 0) || 0;

      // Онлайн пользователи (активность за последние 5 минут)
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const { count: onlineUsers } = await supabase
        .from('user_sessions')
        .select('*', { count: 'exact', head: true })
        .gte('updated_at', fiveMinutesAgo.toISOString());

      // Воронка онбординга
      const { data: funnelData } = await supabase
        .from('user_accounts')
        .select('onboarding_stage');

      const funnelMap: Record<string, number> = {};
      funnelData?.forEach((user) => {
        const stage = user.onboarding_stage || 'new';
        funnelMap[stage] = (funnelMap[stage] || 0) + 1;
      });

      const onboardingFunnel = Object.entries(funnelMap).map(([stage, count]) => ({
        stage,
        count,
      }));

      // Последние регистрации
      const { data: recentUsers } = await supabase
        .from('user_accounts')
        .select('id, username, created_at, onboarding_stage')
        .order('created_at', { ascending: false })
        .limit(5);

      // Последние ошибки
      const { data: recentErrors } = await supabase
        .from('error_logs')
        .select(`
          id,
          error_type,
          raw_error,
          severity,
          created_at,
          user_account_id
        `)
        .eq('is_resolved', false)
        .order('created_at', { ascending: false })
        .limit(5);

      // Получаем usernames отдельно для ошибок
      const errorUserIds = recentErrors?.map(e => e.user_account_id).filter(Boolean) || [];
      let errorUsersMap: Record<string, string> = {};
      if (errorUserIds.length > 0) {
        const { data: errorUsers } = await supabase
          .from('user_accounts')
          .select('id, username')
          .in('id', errorUserIds);
        errorUsersMap = Object.fromEntries(errorUsers?.map(u => [u.id, u.username]) || []);
      }

      const formattedErrors = recentErrors?.map((e: any) => ({
        ...e,
        user_username: errorUsersMap[e.user_account_id] || null,
      })) || [];

      // Топ юзеров по лидам за 30 дней
      const { data: leadsPerUser } = await supabase
        .from('leads')
        .select('user_account_id')
        .gte('created_at', monthAgo.toISOString());

      const userLeadsCount: Record<string, number> = {};
      leadsPerUser?.forEach((lead) => {
        if (lead.user_account_id) {
          userLeadsCount[lead.user_account_id] = (userLeadsCount[lead.user_account_id] || 0) + 1;
        }
      });

      const topUserIds = Object.entries(userLeadsCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id]) => id);

      let topUsers: any[] = [];
      if (topUserIds.length > 0) {
        const { data: topUsersData } = await supabase
          .from('user_accounts')
          .select('id, username')
          .in('id', topUserIds);

        topUsers = topUserIds.map((id) => {
          const user = topUsersData?.find((u) => u.id === id);
          return {
            id,
            username: user?.username || 'Unknown',
            leads_count: userLeadsCount[id],
            spend: 0, // TODO: calculate user spend
          };
        });
      }

      return res.send({
        stats: {
          totalUsers: totalUsers || 0,
          activeUsers: activeUsers || 0,
          newUsersLast7Days: newUsersLast7Days || 0,
          leadsToday: leadsToday || 0,
          leadsWeek: leadsWeek || 0,
          leadsMonth: leadsMonth || 0,
          totalSpend: Math.round(totalSpend * 100), // в центах
          onlineUsers: onlineUsers || 0,
          onboardingFunnel,
        },
        recentUsers: recentUsers || [],
        recentErrors: formattedErrors,
        topUsers,
      });
    } catch (err) {
      log.error({ error: err instanceof Error ? err.message : JSON.stringify(err) }, 'Error fetching dashboard stats');
      return res.status(500).send({ error: 'Failed to fetch dashboard stats' });
    }
  });
}
