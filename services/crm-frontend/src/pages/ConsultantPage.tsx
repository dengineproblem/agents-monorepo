import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { consultantApi, DashboardStats } from '@/services/consultantApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { LeadsTab } from '@/components/consultant/LeadsTab';
import { CalendarTab } from '@/components/consultant/CalendarTab';
import { ProfileTab } from '@/components/consultant/ProfileTab';
import { ScheduleTab } from '@/components/consultant/ScheduleTab';
import { SalesTab } from '@/components/consultant/SalesTab';
import { TasksTab } from '@/components/consultant/TasksTab';
import {
  Users,
  Calendar,
  TrendingUp,
  DollarSign,
  Clock,
  LogOut,
  UserCircle,
  Settings,
  MessageSquare,
  Briefcase,
  CheckSquare,
} from 'lucide-react';

export function ConsultantPage() {
  const { consultantId } = useParams<{ consultantId: string }>();
  const { user, logout, isConsultant } = useAuth();
  const { toast } = useToast();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [consultantName, setConsultantName] = useState<string>('Консультант');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('calendar');
  const [unreadCount, setUnreadCount] = useState(0);
  const [prevUnreadCount, setPrevUnreadCount] = useState(0);

  // Проверка доступа
  useEffect(() => {
    if (isConsultant && user?.consultantId && user.consultantId !== consultantId) {
      // Консультант пытается зайти на страницу другого консультанта
      window.location.href = `/c/${user.consultantId}`;
    }
  }, [isConsultant, user, consultantId]);

  // Загрузка статистики и профиля
  useEffect(() => {
    const loadStats = async () => {
      try {
        setLoading(true);
        const data = await consultantApi.getDashboard(consultantId);
        setStats(data);
      } catch (error: any) {
        console.error('Failed to load dashboard:', error);
        toast({
          title: 'Ошибка',
          description: 'Не удалось загрузить статистику',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    const loadProfile = async () => {
      try {
        const profile = await consultantApi.getProfile(consultantId);
        setConsultantName(profile.name || 'Консультант');
      } catch (error: any) {
        console.error('Failed to load consultant profile:', error);
      }
    };

    loadStats();
    loadProfile();
  }, [consultantId, toast]);

  // Загрузка счетчика непрочитанных с polling и toast уведомлениями
  useEffect(() => {
    const loadUnreadCount = async () => {
      try {
        const data = await consultantApi.getUnreadCount();
        const newCount = data.unreadCount;

        // Показываем toast только если счетчик увеличился и это не первая загрузка
        if (newCount > prevUnreadCount && prevUnreadCount > 0) {
          const diff = newCount - prevUnreadCount;
          toast({
            title: 'Новые сообщения',
            description: `У вас ${diff} ${diff === 1 ? 'новое непрочитанное сообщение' : 'новых непрочитанных сообщений'}`,
            duration: 5000,
          });
        }

        setPrevUnreadCount(newCount);
        setUnreadCount(newCount);
      } catch (error) {
        console.error('Failed to load unread count:', error);
      }
    };

    // Начальная загрузка
    loadUnreadCount();

    // Polling каждые 30 секунд
    const interval = setInterval(loadUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [toast, prevUnreadCount]);

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <UserCircle className="h-10 w-10 text-primary" />
              <div>
                <h1 className="text-2xl font-bold">{consultantName}</h1>
                <p className="text-sm text-muted-foreground">Личный кабинет</p>
              </div>
            </div>
            <Button variant="outline" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              Выйти
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Всего лидов</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total_leads || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Горячих: {stats?.hot_leads || 0} | Теплых: {stats?.warm_leads || 0}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Консультации</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total_consultations || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Запланировано: {stats?.scheduled || 0} | Завершено: {stats?.completed || 0}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Конверсии</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Лид → Запись</span>
                  <span className="text-sm font-bold">{stats?.lead_to_booked_rate || 0}%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Запись → Проведено</span>
                  <span className="text-sm font-bold">{stats?.booked_to_completed_rate || 0}%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Проведено → Продажа</span>
                  <span className="text-sm font-bold">{stats?.completed_to_sales_rate || 0}%</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Доход</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.sales_amount?.toLocaleString() || 0} ₸</div>
              <p className="text-xs text-muted-foreground mt-1">
                Сумма продаж ({stats?.sales_count || 0} шт.)
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Активные задачи</CardTitle>
              <CheckSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.tasks_total || 0}</div>
              <div className="flex gap-4 mt-2 text-xs">
                <span className="text-red-600">
                  Просрочено: {stats?.tasks_overdue || 0}
                </span>
                <span className="text-blue-600">
                  Сегодня: {stats?.tasks_today || 0}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="calendar">
              <Calendar className="h-4 w-4 mr-2" />
              Календарь
            </TabsTrigger>
            <TabsTrigger value="leads" className="relative">
              <Users className="h-4 w-4 mr-2" />
              Лиды
              {unreadCount > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {unreadCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="tasks">
              <CheckSquare className="h-4 w-4 mr-2" />
              Задачи
            </TabsTrigger>
            <TabsTrigger value="schedule">
              <Clock className="h-4 w-4 mr-2" />
              Расписание
            </TabsTrigger>
            <TabsTrigger value="sales">
              <DollarSign className="h-4 w-4 mr-2" />
              Продажи
            </TabsTrigger>
            <TabsTrigger value="profile">
              <Settings className="h-4 w-4 mr-2" />
              Профиль
            </TabsTrigger>
          </TabsList>

          <TabsContent value="calendar" className="space-y-4">
            <CalendarTab />
          </TabsContent>

          <TabsContent value="leads" className="space-y-4">
            <LeadsTab />
          </TabsContent>

          <TabsContent value="tasks" className="space-y-4">
            <TasksTab />
          </TabsContent>

          <TabsContent value="schedule" className="space-y-4">
            <ScheduleTab />
          </TabsContent>

          <TabsContent value="sales" className="space-y-4">
            <SalesTab />
          </TabsContent>

          <TabsContent value="profile" className="space-y-4">
            <ProfileTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
