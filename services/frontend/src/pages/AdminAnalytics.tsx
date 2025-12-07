/**
 * Admin Analytics Page
 *
 * Страница для администраторов для просмотра аналитики по пользователям:
 * - Список пользователей с их скорами
 * - Детальная статистика по выбранному пользователю
 * - Real-time активные сессии
 * - Общая сводка по платформе
 *
 * @module pages/AdminAnalytics
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Header from '../components/Header';
import { API_BASE_URL } from '@/config/api';
import {
  Users,
  Activity,
  TrendingUp,
  Eye,
  MousePointerClick,
  Clock,
  AlertCircle,
  RefreshCw,
  Monitor,
  Smartphone,
  Tablet,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';

// =====================================================
// Types
// =====================================================

interface UserScore {
  user_account_id: string;
  date: string;
  total_sessions: number;
  total_page_views: number;
  total_clicks: number;
  total_time_seconds: number;
  campaigns_created: number;
  creatives_launched: number;
  leads_received: number;
  engagement_score: number;
  activity_score: number;
  health_score: number;
  overall_score: number;
  user_accounts: {
    username: string;
  };
}

interface ActiveSession {
  user_account_id: string;
  session_id: string;
  page_views: number;
  clicks: number;
  started_at: string;
  updated_at: string;
  entry_page: string;
  device_type: string;
  user_accounts: {
    username: string;
  };
}

interface AnalyticsSummary {
  period: {
    days: number;
    since: string;
  };
  totalEvents: number;
  eventsByCategory: Record<string, number>;
  uniqueUsers: number;
  averageScores: {
    engagement: number;
    activity: number;
    health: number;
    overall: number;
  };
}

interface UserDetail {
  scores: UserScore[];
  recentEvents: Array<{
    event_category: string;
    event_action: string;
    event_label?: string;
    page_path?: string;
    created_at: string;
  }>;
  pageViews: Record<string, number>;
  sessions: Array<{
    started_at: string;
    duration_seconds?: number;
    page_views: number;
    entry_page?: string;
    device_type?: string;
  }>;
}

// =====================================================
// Helper Components
// =====================================================

const ScoreBadge: React.FC<{ score: number; label: string }> = ({ score, label }) => {
  const getColor = () => {
    if (score >= 80) return 'bg-green-100 text-green-800';
    if (score >= 50) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  return (
    <div className="flex flex-col items-center">
      <span className="text-xs text-muted-foreground mb-1">{label}</span>
      <Badge className={cn('text-sm font-bold px-3 py-1', getColor())}>
        {score}
      </Badge>
    </div>
  );
};

const DeviceIcon: React.FC<{ type?: string }> = ({ type }) => {
  switch (type) {
    case 'mobile':
      return <Smartphone className="h-4 w-4" />;
    case 'tablet':
      return <Tablet className="h-4 w-4" />;
    default:
      return <Monitor className="h-4 w-4" />;
  }
};

const StatCard: React.FC<{
  title: string;
  value: string | number;
  icon: React.ReactNode;
  subtitle?: string;
}> = ({ title, value, icon, subtitle }) => (
  <Card>
    <CardContent className="pt-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        <div className="text-muted-foreground">{icon}</div>
      </div>
    </CardContent>
  </Card>
);

// =====================================================
// Main Component
// =====================================================

const AdminAnalytics: React.FC = () => {
  const [users, setUsers] = useState<UserScore[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  // Fetch all data
  const fetchData = async () => {
    try {
      const [usersRes, sessionsRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE_URL}/analytics/users`),
        fetch(`${API_BASE_URL}/analytics/realtime`),
        fetch(`${API_BASE_URL}/analytics/summary?days=7`),
      ]);

      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users || []);
      }

      if (sessionsRes.ok) {
        const data = await sessionsRes.json();
        setActiveSessions(data.activeSessions || []);
      }

      if (summaryRes.ok) {
        const data = await summaryRes.json();
        setSummary(data);
      }
    } catch (error) {
      console.error('Failed to fetch analytics data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch user details
  const fetchUserDetail = async (userId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/analytics/user/${userId}?days=30`);
      if (res.ok) {
        const data = await res.json();
        setUserDetail(data);
      }
    } catch (error) {
      console.error('Failed to fetch user details:', error);
    }
  };

  // Initial load
  useEffect(() => {
    fetchData();
  }, []);

  // Refresh handler
  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  // User selection handler
  const handleUserSelect = (userId: string) => {
    if (expandedUser === userId) {
      setExpandedUser(null);
      setUserDetail(null);
    } else {
      setExpandedUser(userId);
      fetchUserDetail(userId);
    }
  };

  // Unique users from scores (group by user_account_id)
  const uniqueUsers = React.useMemo(() => {
    const userMap = new Map<string, UserScore>();
    users.forEach(u => {
      if (!userMap.has(u.user_account_id) ||
          new Date(u.date) > new Date(userMap.get(u.user_account_id)!.date)) {
        userMap.set(u.user_account_id, u);
      }
    });
    return Array.from(userMap.values()).sort((a, b) => b.overall_score - a.overall_score);
  }, [users]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-8">
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container py-8 pt-20">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Аналитика пользователей</h1>
            <p className="text-muted-foreground">
              Мониторинг активности и вовлечённости
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', refreshing && 'animate-spin')} />
            Обновить
          </Button>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              title="Активных пользователей"
              value={activeSessions.length}
              icon={<Activity className="h-6 w-6" />}
              subtitle="За последние 15 минут"
            />
            <StatCard
              title="Уникальных пользователей"
              value={summary.uniqueUsers}
              icon={<Users className="h-6 w-6" />}
              subtitle="За 7 дней"
            />
            <StatCard
              title="Всего событий"
              value={summary.totalEvents.toLocaleString()}
              icon={<Eye className="h-6 w-6" />}
              subtitle="За 7 дней"
            />
            <StatCard
              title="Средний скор"
              value={summary.averageScores.overall}
              icon={<TrendingUp className="h-6 w-6" />}
              subtitle="Overall Score"
            />
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="users" className="space-y-4">
          <TabsList>
            <TabsTrigger value="users" className="gap-2">
              <Users className="h-4 w-4" />
              Пользователи
            </TabsTrigger>
            <TabsTrigger value="realtime" className="gap-2">
              <Activity className="h-4 w-4" />
              Real-time
              {activeSessions.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {activeSessions.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Users Tab */}
          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle>Скоры пользователей</CardTitle>
              </CardHeader>
              <CardContent>
                {uniqueUsers.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                    <p>Нет данных о пользователях</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {uniqueUsers.map(user => (
                      <div key={user.user_account_id}>
                        <div
                          className={cn(
                            'flex items-center justify-between p-4 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors',
                            expandedUser === user.user_account_id && 'bg-muted/50 border-primary'
                          )}
                          onClick={() => handleUserSelect(user.user_account_id)}
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <span className="text-lg font-semibold text-primary">
                                {user.user_accounts?.username?.[0]?.toUpperCase() || '?'}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium">
                                {user.user_accounts?.username || 'Unknown'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Обновлено: {format(new Date(user.date), 'dd.MM.yyyy', { locale: ru })}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-6">
                            <ScoreBadge score={user.engagement_score || 0} label="Engagement" />
                            <ScoreBadge score={user.activity_score || 0} label="Activity" />
                            <ScoreBadge score={user.health_score || 0} label="Health" />
                            <ScoreBadge score={user.overall_score || 0} label="Overall" />
                            {expandedUser === user.user_account_id ? (
                              <ChevronUp className="h-5 w-5 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                        </div>

                        {/* Expanded User Details */}
                        {expandedUser === user.user_account_id && userDetail && (
                          <div className="mt-2 ml-14 p-4 border rounded-lg bg-background">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                              <div className="text-center p-3 bg-muted rounded-lg">
                                <Eye className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                                <p className="text-xl font-bold">{user.total_page_views || 0}</p>
                                <p className="text-xs text-muted-foreground">Page Views</p>
                              </div>
                              <div className="text-center p-3 bg-muted rounded-lg">
                                <MousePointerClick className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                                <p className="text-xl font-bold">{user.total_clicks || 0}</p>
                                <p className="text-xs text-muted-foreground">Clicks</p>
                              </div>
                              <div className="text-center p-3 bg-muted rounded-lg">
                                <Clock className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                                <p className="text-xl font-bold">
                                  {Math.round((user.total_time_seconds || 0) / 60)}м
                                </p>
                                <p className="text-xs text-muted-foreground">Time</p>
                              </div>
                              <div className="text-center p-3 bg-muted rounded-lg">
                                <Activity className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                                <p className="text-xl font-bold">{user.total_sessions || 0}</p>
                                <p className="text-xs text-muted-foreground">Sessions</p>
                              </div>
                            </div>

                            {/* Business Metrics */}
                            <div className="grid grid-cols-3 gap-4 mb-4">
                              <div className="text-center p-2 border rounded">
                                <p className="text-lg font-semibold">{user.campaigns_created || 0}</p>
                                <p className="text-xs text-muted-foreground">Campaigns</p>
                              </div>
                              <div className="text-center p-2 border rounded">
                                <p className="text-lg font-semibold">{user.creatives_launched || 0}</p>
                                <p className="text-xs text-muted-foreground">Creatives</p>
                              </div>
                              <div className="text-center p-2 border rounded">
                                <p className="text-lg font-semibold">{user.leads_received || 0}</p>
                                <p className="text-xs text-muted-foreground">Leads</p>
                              </div>
                            </div>

                            {/* Recent Events */}
                            {userDetail.recentEvents && userDetail.recentEvents.length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium mb-2">Последние действия</h4>
                                <div className="max-h-48 overflow-y-auto space-y-1">
                                  {userDetail.recentEvents.slice(0, 10).map((event, idx) => (
                                    <div
                                      key={idx}
                                      className="flex items-center justify-between text-sm p-2 bg-muted/50 rounded"
                                    >
                                      <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-xs">
                                          {event.event_category}
                                        </Badge>
                                        <span>{event.event_action}</span>
                                        {event.event_label && (
                                          <span className="text-muted-foreground">
                                            - {event.event_label}
                                          </span>
                                        )}
                                      </div>
                                      <span className="text-xs text-muted-foreground">
                                        {formatDistanceToNow(new Date(event.created_at), {
                                          addSuffix: true,
                                          locale: ru,
                                        })}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Real-time Tab */}
          <TabsContent value="realtime">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
                  Активные сессии
                </CardTitle>
              </CardHeader>
              <CardContent>
                {activeSessions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Activity className="h-8 w-8 mx-auto mb-2" />
                    <p>Нет активных пользователей</p>
                    <p className="text-sm">Последние 15 минут</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Пользователь</TableHead>
                        <TableHead>Устройство</TableHead>
                        <TableHead>Страница входа</TableHead>
                        <TableHead className="text-center">Page Views</TableHead>
                        <TableHead className="text-center">Clicks</TableHead>
                        <TableHead>Активность</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeSessions.map(session => (
                        <TableRow key={session.session_id}>
                          <TableCell className="font-medium">
                            {session.user_accounts?.username || 'Unknown'}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <DeviceIcon type={session.device_type} />
                              <span className="text-sm text-muted-foreground capitalize">
                                {session.device_type || 'desktop'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                            {session.entry_page || '/'}
                          </TableCell>
                          <TableCell className="text-center">{session.page_views}</TableCell>
                          <TableCell className="text-center">{session.clicks}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDistanceToNow(new Date(session.updated_at), {
                              addSuffix: true,
                              locale: ru,
                            })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AdminAnalytics;
