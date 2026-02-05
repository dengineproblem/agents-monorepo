import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { consultantApi, DashboardStats } from '@/services/consultantApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { LeadsTab } from '@/components/consultant/LeadsTab';
import { CalendarTab } from '@/components/consultant/CalendarTab';
import { ProfileTab } from '@/components/consultant/ProfileTab';
import { ScheduleTab } from '@/components/consultant/ScheduleTab';
import { SalesTab } from '@/components/consultant/SalesTab';
import { TasksTab } from '@/components/consultant/TasksTab';
import { addMonths, addWeeks, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns';
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
  ChevronLeft,
  ChevronRight,
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
  const [periodType, setPeriodType] = useState<'week' | 'month'>('month');
  const [periodStart, setPeriodStart] = useState<Date>(() => startOfMonth(new Date()));

  const getPeriodStart = (date: Date, type: 'week' | 'month') => (
    type === 'week' ? startOfWeek(date, { weekStartsOn: 1 }) : startOfMonth(date)
  );

  const getPeriodEnd = (date: Date, type: 'week' | 'month') => (
    type === 'week' ? endOfWeek(date, { weekStartsOn: 1 }) : endOfMonth(date)
  );

  const formatPeriodLabel = (start: Date, end: Date) => {
    const startLabel = start.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
    const endLabel = end.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${startLabel} — ${endLabel}`;
  };

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
        const normalizedStart = getPeriodStart(periodStart, periodType);
        const periodStartStr = format(normalizedStart, 'yyyy-MM-dd');
        const data = await consultantApi.getDashboard({
          consultantId,
          period_type: periodType,
          period_start: periodStartStr
        });
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
  }, [consultantId, toast, periodType, periodStart]);

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

  const handlePeriodTypeChange = (value: 'week' | 'month') => {
    setPeriodType(value);
    setPeriodStart(getPeriodStart(new Date(), value));
  };

  const shiftPeriod = (direction: 'prev' | 'next') => {
    setPeriodStart((current) => {
      const base = getPeriodStart(current, periodType);
      const shifted = periodType === 'week'
        ? addWeeks(base, direction === 'prev' ? -1 : 1)
        : addMonths(base, direction === 'prev' ? -1 : 1);
      return getPeriodStart(shifted, periodType);
    });
  };

  const periodStartDate = getPeriodStart(periodStart, periodType);
  const periodEndDate = getPeriodEnd(periodStart, periodType);
  const periodLabel = formatPeriodLabel(periodStartDate, periodEndDate);

  const getDelta = (actual?: number, target?: number | null) => {
    if (target === null || target === undefined || actual === undefined) return null;
    return actual - target;
  };

  const deltaClass = (delta: number | null) => {
    if (delta === null) return 'text-muted-foreground';
    if (delta >= 0) return 'text-green-600';
    if (delta >= -5) return 'text-yellow-600';
    return 'text-red-600';
  };

  const formatDelta = (delta: number | null, suffix: string) => {
    if (delta === null) return '—';
    const sign = delta > 0 ? '+' : '';
    return `${sign}${delta}${suffix}`;
  };

  const formatCurrency = (value: number) => value.toLocaleString('ru-RU');

  const formatCurrencyDelta = (delta: number | null) => {
    if (delta === null) return '—';
    const sign = delta > 0 ? '+' : '';
    return `${sign}${formatCurrency(delta)} ₸`;
  };

  const formatTargetPercent = (target: number | null) => (
    target === null ? '—' : `${target}%`
  );

  const leadRate = stats?.lead_to_booked_rate ?? 0;
  const bookedRate = stats?.booked_to_completed_rate ?? 0;
  const completedRate = stats?.completed_to_sales_rate ?? 0;

  const leadTarget = stats?.target_lead_to_booked_rate ?? null;
  const bookedTarget = stats?.target_booked_to_completed_rate ?? null;
  const completedTarget = stats?.target_completed_to_sales_rate ?? null;

  const leadDelta = getDelta(leadRate, leadTarget);
  const bookedDelta = getDelta(bookedRate, bookedTarget);
  const completedDelta = getDelta(completedRate, completedTarget);

  const salesAmount = stats?.sales_amount ?? 0;
  const salesCount = stats?.sales_count ?? 0;
  const targetSalesAmount = stats?.target_sales_amount ?? null;
  const targetSalesCount = stats?.target_sales_count ?? null;
  const salesAmountDelta = getDelta(salesAmount, targetSalesAmount);
  const salesCountDelta = getDelta(salesCount, targetSalesCount);

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
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => shiftPeriod('prev')}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-sm font-medium">{periodLabel}</div>
            <Button variant="outline" size="icon" onClick={() => shiftPeriod('next')}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Период:</span>
            <Select value={periodType} onValueChange={handlePeriodTypeChange}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Неделя</SelectItem>
                <SelectItem value="month">Месяц</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
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
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Лид → Запись</span>
                    <span className="text-sm font-bold">{leadRate}%</span>
                  </div>
                  <div className="flex justify-between items-center text-xs mt-1">
                    <span className="text-muted-foreground">План: {formatTargetPercent(leadTarget)}</span>
                    <span className={deltaClass(leadDelta)}>{formatDelta(leadDelta, ' п.п.')}</span>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Запись → Проведено</span>
                    <span className="text-sm font-bold">{bookedRate}%</span>
                  </div>
                  <div className="flex justify-between items-center text-xs mt-1">
                    <span className="text-muted-foreground">План: {formatTargetPercent(bookedTarget)}</span>
                    <span className={deltaClass(bookedDelta)}>{formatDelta(bookedDelta, ' п.п.')}</span>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Проведено → Продажа</span>
                    <span className="text-sm font-bold">{completedRate}%</span>
                  </div>
                  <div className="flex justify-between items-center text-xs mt-1">
                    <span className="text-muted-foreground">План: {formatTargetPercent(completedTarget)}</span>
                    <span className={deltaClass(completedDelta)}>{formatDelta(completedDelta, ' п.п.')}</span>
                  </div>
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
              <div className="text-2xl font-bold">{formatCurrency(salesAmount)} ₸</div>
              <p className="text-xs text-muted-foreground mt-1">
                План: {targetSalesAmount !== null ? `${formatCurrency(targetSalesAmount)} ₸` : '—'} | Δ: <span className={deltaClass(salesAmountDelta)}>{formatCurrencyDelta(salesAmountDelta)}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Продаж: {salesCount} / {targetSalesCount ?? '—'} {targetSalesCount !== null ? `(${formatDelta(salesCountDelta, '')})` : ''}
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
