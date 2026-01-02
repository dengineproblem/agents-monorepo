import { useState, useEffect } from 'react';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  Users,
  Calendar,
  Clock,
  RefreshCw,
  CheckCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { consultationService } from '@/services/consultationService';
import { ExtendedStats, DAYS_OF_WEEK } from '@/types/consultation';

export function AnalyticsPage() {
  const userAccountId = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';

  const [stats, setStats] = useState<ExtendedStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [period, setPeriod] = useState<'week' | 'month' | 'quarter' | 'year'>('month');

  useEffect(() => {
    loadStats();
  }, [period]);

  const loadStats = async () => {
    setIsLoading(true);
    try {
      const data = await consultationService.getExtendedStats({
        period,
        user_account_id: userAccountId
      });
      setStats(data);
    } catch (error) {
      console.error('Error loading extended stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 0
    }).format(value);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short'
    });
  };

  const getMaxDayValue = () => Math.max(...(stats?.by_day_of_week || [1]));
  const getMaxHourValue = () => Math.max(...(stats?.by_hour || [1]));

  if (isLoading && !stats) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="w-6 h-6" />
          Аналитика
        </h1>
        <div className="flex items-center gap-3">
          <Select value={period} onValueChange={(v: 'week' | 'month' | 'quarter' | 'year') => setPeriod(v)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">Неделя</SelectItem>
              <SelectItem value="month">Месяц</SelectItem>
              <SelectItem value="quarter">Квартал</SelectItem>
              <SelectItem value="year">Год</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={loadStats} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {stats ? (
        <div className="space-y-6">
          {/* Period info */}
          <div className="text-sm text-muted-foreground">
            {formatDate(stats.period.start)} — {formatDate(stats.period.end)}
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold">{stats.summary.total}</div>
                    <div className="text-sm text-muted-foreground">Всего записей</div>
                  </div>
                  <Calendar className="w-8 h-8 text-blue-500 opacity-50" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold text-green-600">
                      {formatCurrency(stats.summary.total_revenue)}
                    </div>
                    <div className="text-sm text-muted-foreground">Выручка</div>
                  </div>
                  <DollarSign className="w-8 h-8 text-green-500 opacity-50" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold text-purple-600">{stats.summary.completed}</div>
                    <div className="text-sm text-muted-foreground">Завершено</div>
                  </div>
                  <CheckCircle className="w-8 h-8 text-purple-500 opacity-50" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold text-emerald-600">{stats.summary.sales_closed}</div>
                    <div className="text-sm text-muted-foreground">Продаж</div>
                  </div>
                  <TrendingUp className="w-8 h-8 text-emerald-500 opacity-50" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Conversion rates */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-l-4 border-l-green-500">
              <CardContent className="p-3">
                <div className="text-lg font-bold text-green-600">{stats.rates.completion_rate}%</div>
                <div className="text-xs text-muted-foreground">Завершаемость</div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-blue-500">
              <CardContent className="p-3">
                <div className="text-lg font-bold text-blue-600">{stats.rates.sales_conversion_rate}%</div>
                <div className="text-xs text-muted-foreground">Конверсия в продажи</div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-orange-500">
              <CardContent className="p-3">
                <div className="text-lg font-bold text-orange-600">{stats.rates.no_show_rate}%</div>
                <div className="text-xs text-muted-foreground">Неявка</div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-red-500">
              <CardContent className="p-3">
                <div className="text-lg font-bold text-red-600">{stats.rates.cancellation_rate}%</div>
                <div className="text-xs text-muted-foreground">Отмены</div>
              </CardContent>
            </Card>
          </div>

          {/* Charts section */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* By day of week */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  По дням недели
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                    const value = stats.by_day_of_week?.[day] || 0;
                    const maxVal = getMaxDayValue();
                    const percentage = maxVal > 0 ? (value / maxVal) * 100 : 0;
                    const dayName = DAYS_OF_WEEK[day] || '';
                    return (
                      <div key={day} className="flex items-center gap-2">
                        <div className="w-12 text-xs text-muted-foreground">
                          {dayName.slice(0, 2)}
                        </div>
                        <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <div className="w-8 text-xs text-right">{value}</div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* By hour */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  По часам
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-1 h-32">
                  {(stats.by_hour || []).slice(8, 21).map((value, idx) => {
                    const hour = idx + 8;
                    const maxVal = getMaxHourValue();
                    const percentage = maxVal > 0 ? (value / maxVal) * 100 : 0;
                    return (
                      <div
                        key={hour}
                        className="flex-1 flex flex-col items-center gap-1"
                        title={`${hour}:00 - ${value} записей`}
                      >
                        <div
                          className="w-full bg-emerald-500 rounded-t transition-all"
                          style={{ height: `${percentage}%`, minHeight: value > 0 ? '4px' : '0' }}
                        />
                        <div className="text-[10px] text-muted-foreground">{hour}</div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* By Consultant */}
          {stats.by_consultant && Object.keys(stats.by_consultant).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  По консультантам
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(stats.by_consultant).map(([id, data]) => (
                    <div key={id} className="flex items-center justify-between p-3 bg-accent/50 rounded-lg">
                      <div>
                        <div className="font-medium">{data.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {data.total} консультаций • {data.completed} завершено • {data.sales} продаж
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">{formatCurrency(data.revenue)}</div>
                        <div className="text-xs text-muted-foreground">выручка</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* By Service */}
          {stats.by_service && Object.keys(stats.by_service).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  По услугам
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(stats.by_service).map(([id, data]) => (
                    <div key={id} className="flex items-center justify-between p-2 border-b last:border-0">
                      <div>
                        <div className="font-medium">{data.name}</div>
                        <div className="text-sm text-muted-foreground">{data.total} записей</div>
                      </div>
                      <div className="font-bold">{formatCurrency(data.revenue)}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          Нет данных для отображения
        </div>
      )}
    </div>
  );
}
