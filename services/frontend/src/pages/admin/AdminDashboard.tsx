/**
 * Admin Dashboard
 *
 * Главная страница админ-панели со статистикой и виджетами
 *
 * @module pages/admin/AdminDashboard
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Target,
  DollarSign,
  Activity,
  TrendingUp,
  TrendingDown,
  UserPlus,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { API_BASE_URL } from '@/config/api';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';

interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  newUsersLast7Days: number;
  leadsToday: number;
  leadsWeek: number;
  leadsMonth: number;
  totalSpend: number;
  onlineUsers: number;
  onboardingFunnel: {
    stage: string;
    count: number;
  }[];
}

interface RecentUser {
  id: string;
  username: string;
  created_at: string;
  onboarding_stage: string;
}

interface RecentError {
  id: string;
  error_type: string;
  raw_error: string;
  severity: string;
  created_at: string;
  user_username?: string;
}

interface TopUser {
  id: string;
  username: string;
  leads_count: number;
  spend: number;
}

const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentUsers, setRecentUsers] = useState<RecentUser[]>([]);
  const [recentErrors, setRecentErrors] = useState<RecentError[]>([]);
  const [topUsers, setTopUsers] = useState<TopUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      const headers: HeadersInit = currentUser.id
        ? { 'x-user-id': currentUser.id }
        : {};
      const res = await fetch(`${API_BASE_URL}/admin/stats/dashboard`, { headers });
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
        setRecentUsers(data.recentUsers || []);
        setRecentErrors(data.recentErrors || []);
        setTopUsers(data.topUsers || []);
      }
    } catch (err) {

    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-500';
      case 'warning':
        return 'bg-yellow-500';
      default:
        return 'bg-blue-500';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Дашборд</h1>
        <p className="text-muted-foreground">Обзор системы и ключевые метрики</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Пользователи</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalUsers || 0}</div>
            <p className="text-xs text-muted-foreground">
              <span className="text-green-500">+{stats?.newUsersLast7Days || 0}</span> за 7 дней
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Лиды сегодня</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.leadsToday || 0}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.leadsWeek || 0} за неделю / {stats?.leadsMonth || 0} за месяц
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Расход рекламы</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(stats?.totalSpend || 0)}
            </div>
            <p className="text-xs text-muted-foreground">Всего за всё время</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Онлайн сейчас</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.onlineUsers || 0}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.activeUsers || 0} активных за 7 дней
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Widgets */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Recent Users */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Последние регистрации</CardTitle>
              <CardDescription>Новые пользователи</CardDescription>
            </div>
            <UserPlus className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Нет новых регистраций
                </p>
              ) : (
                recentUsers.slice(0, 5).map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between cursor-pointer hover:bg-muted/50 -mx-2 px-2 py-1 rounded"
                    onClick={() => navigate(`/admin/users/${user.id}`)}
                  >
                    <div>
                      <p className="text-sm font-medium">{user.username}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(user.created_at), {
                          addSuffix: true,
                          locale: ru,
                        })}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {user.onboarding_stage}
                    </Badge>
                  </div>
                ))
              )}
            </div>
            <Button
              variant="ghost"
              className="w-full mt-4"
              onClick={() => navigate('/admin/users')}
            >
              Все пользователи
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>

        {/* Recent Errors */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Последние ошибки</CardTitle>
              <CardDescription>Требуют внимания</CardDescription>
            </div>
            <AlertTriangle className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentErrors.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Нет ошибок
                </p>
              ) : (
                recentErrors.slice(0, 5).map((error) => (
                  <div
                    key={error.id}
                    className="flex items-start gap-2 cursor-pointer hover:bg-muted/50 -mx-2 px-2 py-1 rounded"
                    onClick={() => navigate(`/admin/errors?id=${error.id}`)}
                  >
                    <div
                      className={`w-2 h-2 rounded-full mt-2 ${getSeverityColor(error.severity)}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {error.raw_error.substring(0, 50)}...
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {error.user_username || 'Система'} •{' '}
                        {formatDistanceToNow(new Date(error.created_at), {
                          addSuffix: true,
                          locale: ru,
                        })}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <Button
              variant="ghost"
              className="w-full mt-4"
              onClick={() => navigate('/admin/errors')}
            >
              Все ошибки
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>

        {/* Top Users by Leads */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Топ по лидам</CardTitle>
              <CardDescription>За последние 30 дней</CardDescription>
            </div>
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Нет данных
                </p>
              ) : (
                topUsers.slice(0, 5).map((user, index) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between cursor-pointer hover:bg-muted/50 -mx-2 px-2 py-1 rounded"
                    onClick={() => navigate(`/admin/users/${user.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold text-muted-foreground w-6">
                        {index + 1}
                      </span>
                      <div>
                        <p className="text-sm font-medium">{user.username}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatCurrency(user.spend)} расход
                        </p>
                      </div>
                    </div>
                    <Badge variant="secondary">{user.leads_count} лидов</Badge>
                  </div>
                ))
              )}
            </div>
            <Button
              variant="ghost"
              className="w-full mt-4"
              onClick={() => navigate('/admin/leads')}
            >
              Все лиды
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Onboarding Funnel */}
      {stats?.onboardingFunnel && stats.onboardingFunnel.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Воронка онбординга</CardTitle>
            <CardDescription>Распределение пользователей по этапам</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-4 h-40">
              {stats.onboardingFunnel.map((stage, index) => {
                const maxCount = Math.max(...stats.onboardingFunnel.map((s) => s.count));
                const height = maxCount > 0 ? (stage.count / maxCount) * 100 : 0;

                return (
                  <div key={stage.stage} className="flex-1 flex flex-col items-center">
                    <span className="text-sm font-medium mb-2">{stage.count}</span>
                    <div
                      className="w-full bg-primary/80 rounded-t transition-all"
                      style={{ height: `${height}%`, minHeight: '4px' }}
                    />
                    <span className="text-xs text-muted-foreground mt-2 text-center">
                      {stage.stage}
                    </span>
                  </div>
                );
              })}
            </div>
            <Button
              variant="ghost"
              className="w-full mt-4"
              onClick={() => navigate('/admin/onboarding')}
            >
              Канбан онбординга
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AdminDashboard;
