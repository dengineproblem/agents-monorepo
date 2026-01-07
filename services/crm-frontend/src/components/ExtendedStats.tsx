import { useState, useEffect } from 'react';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  Users,
  Calendar,
  Clock,
  RefreshCw,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { consultationService } from '@/services/consultationService';
import { ExtendedStats as ExtendedStatsType, DAYS_OF_WEEK } from '@/types/consultation';

interface ExtendedStatsProps {
  userAccountId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ExtendedStats({ userAccountId, isOpen, onClose }: ExtendedStatsProps) {
  const [stats, setStats] = useState<ExtendedStatsType | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [period, setPeriod] = useState<'week' | 'month' | 'quarter' | 'year'>('month');

  useEffect(() => {
    if (isOpen) {
      loadStats();
    }
  }, [isOpen, period]);

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
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short'
    });
  };

  // Get max value for bar chart scaling
  const getMaxHourValue = () => Math.max(...(stats?.by_hour || [1]));
  const getMaxDayValue = () => Math.max(...(stats?.by_day_of_week || [1]));

  // Source type labels
  const sourceLabels: Record<string, string> = {
    general: 'Ручная запись',
    online_booking: 'Онлайн-запись',
    bot: 'Чат-бот',
    unknown: 'Неизвестно'
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Расширенная статистика
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Select value={period} onValueChange={(v) => setPeriod(v as any)}>
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
              <Button variant="outline" size="sm" onClick={loadStats} disabled={isLoading}>
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {isLoading && !stats ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : stats ? (
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
                      const value = stats.by_day_of_week[day] || 0;
                      const maxVal = getMaxDayValue();
                      const percentage = maxVal > 0 ? (value / maxVal) * 100 : 0;
                      return (
                        <div key={day} className="flex items-center gap-2">
                          <div className="w-12 text-xs text-muted-foreground">
                            {DAYS_OF_WEEK[day].slice(0, 2)}
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
                    {stats.by_hour.slice(8, 21).map((value, idx) => {
                      const hour = idx + 8;
                      const maxVal = getMaxHourValue();
                      const percentage = maxVal > 0 ? (value / maxVal) * 100 : 0;
                      return (
                        <div
                          key={hour}
                          className="flex-1 flex flex-col items-center gap-1"
                          title={`${hour}:00 — ${value} записей`}
                        >
                          <div className="w-full flex flex-col justify-end h-24">
                            <div
                              className="w-full bg-emerald-500 rounded-t transition-all hover:bg-emerald-600"
                              style={{ height: `${percentage}%`, minHeight: value > 0 ? '4px' : '0' }}
                            />
                          </div>
                          <div className="text-[10px] text-muted-foreground">{hour}</div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* By consultant and service */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* By consultant */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    По консультантам
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {Object.keys(stats.by_consultant).length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-4">
                      Нет данных
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {Object.entries(stats.by_consultant).map(([id, data]) => (
                        <div key={id} className="flex items-center justify-between border-b pb-2 last:border-0">
                          <div>
                            <div className="font-medium text-sm">{data.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {data.completed} из {data.total} завершено
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-medium text-sm text-green-600">
                              {formatCurrency(data.revenue)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {data.sales} продаж
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* By service */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" />
                    По услугам
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {Object.keys(stats.by_service).length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-4">
                      Нет данных об услугах
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {Object.entries(stats.by_service).map(([id, data]) => (
                        <div key={id} className="flex items-center justify-between border-b pb-2 last:border-0">
                          <div>
                            <div className="font-medium text-sm">{data.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {data.total} записей
                            </div>
                          </div>
                          <div className="font-medium text-sm text-green-600">
                            {formatCurrency(data.revenue)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* By source */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Источники записей</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4">
                  {Object.entries(stats.by_source).map(([source, count]) => (
                    <div
                      key={source}
                      className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg"
                    >
                      <div className="font-medium text-sm">{sourceLabels[source] || source}</div>
                      <div className="text-sm text-muted-foreground">({count})</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Problem indicators */}
            {(stats.summary.cancelled > 0 || stats.summary.no_show > 0) && (
              <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 text-orange-700 dark:text-orange-400">
                    <AlertCircle className="w-4 h-4" />
                    Обратите внимание
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-orange-700 dark:text-orange-400">
                  <ul className="list-disc list-inside space-y-1">
                    {stats.summary.cancelled > 0 && (
                      <li>
                        {stats.summary.cancelled} отменённых записей ({stats.rates.cancellation_rate}%)
                      </li>
                    )}
                    {stats.summary.no_show > 0 && (
                      <li>
                        {stats.summary.no_show} неявок ({stats.rates.no_show_rate}%)
                      </li>
                    )}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            Не удалось загрузить статистику
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
