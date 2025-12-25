/**
 * Anomalies Table Component
 *
 * Таблица CPR аномалий с expandable rows для показа предшествующих отклонений
 */

import React, { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  Check,
  TrendingUp,
  ChevronDown,
  ChevronRight,
  Activity,
  DollarSign,
  MousePointerClick,
  Eye,
  Star,
  ThumbsUp,
  Target,
  PauseCircle,
  BarChart3,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { Anomaly, MetricDeviation, WeekDeviations, AnomalySeverity, DailyBreakdownResult, DayBreakdown } from '@/types/adInsights';
import { Calendar } from 'lucide-react';

interface AnomaliesTableProps {
  anomalies: Anomaly[];
  loading?: boolean;
  onAcknowledge?: (id: string) => void;
  onFilterChange?: (severity: AnomalySeverity | 'all') => void;
}

/**
 * Форматирует диапазон дат недели
 */
function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${format(start, 'd MMM', { locale: ru })} — ${format(end, 'd MMM yyyy', { locale: ru })}`;
}

/**
 * Форматирует значение метрики для отображения
 */
function formatMetricValue(value: number, metric: string): string {
  switch (metric) {
    case 'ctr':
    case 'link_ctr':
      return `${value.toFixed(2)}%`;
    case 'cpm':
    case 'spend':
    case 'cpr':
      return `$${value.toFixed(2)}`;
    case 'frequency':
      return value.toFixed(2);
    case 'results':
      return Math.round(value).toString();
    case 'quality_ranking':
    case 'engagement_ranking':
    case 'conversion_ranking':
      // Ranking scores: 5=above, 3=average, 1-2=below
      return value.toFixed(1);
    default:
      return value.toFixed(2);
  }
}

/**
 * Возвращает иконку для метрики
 */
function getMetricIcon(metric: string): React.ReactNode {
  switch (metric) {
    case 'frequency':
      return <Activity className="h-3.5 w-3.5" />;
    case 'ctr':
    case 'link_ctr':
      return <MousePointerClick className="h-3.5 w-3.5" />;
    case 'cpm':
    case 'spend':
    case 'cpr':
      return <DollarSign className="h-3.5 w-3.5" />;
    case 'results':
      return <BarChart3 className="h-3.5 w-3.5" />;
    case 'quality_ranking':
      return <Star className="h-3.5 w-3.5" />;
    case 'engagement_ranking':
      return <ThumbsUp className="h-3.5 w-3.5" />;
    case 'conversion_ranking':
      return <Target className="h-3.5 w-3.5" />;
    default:
      return <Eye className="h-3.5 w-3.5" />;
  }
}

/**
 * Возвращает читаемое название метрики
 */
function getMetricLabel(metric: string): string {
  switch (metric) {
    case 'frequency':
      return 'Частота';
    case 'ctr':
      return 'CTR';
    case 'link_ctr':
      return 'Link CTR';
    case 'cpm':
      return 'CPM';
    case 'spend':
      return 'Расход';
    case 'cpr':
      return 'CPR';
    case 'results':
      return 'Результаты';
    case 'quality_ranking':
      return 'Качество';
    case 'engagement_ranking':
      return 'Вовлечённость';
    case 'conversion_ranking':
      return 'Конверсии';
    default:
      return metric;
  }
}

/**
 * Форматирует ranking score в текстовый лейбл
 * Facebook scores: +2 = Above Average, 0 = Average, -1/-2/-3 = Below Average
 */
function formatRankingLabel(score: number | null): { label: string; color: string } {
  if (score === null) return { label: '—', color: 'text-gray-400' };
  if (score > 0) return { label: 'Above', color: 'text-green-600' };
  if (score === 0) return { label: 'Average', color: 'text-yellow-600' };
  return { label: 'Below', color: 'text-red-600' };
}

// Порядок метрик для отображения (без rankings — они отдельно)
const METRICS_ORDER = ['frequency', 'ctr', 'link_ctr', 'cpm', 'cpr', 'spend', 'results'];

/**
 * Таблица детализации по дням недели
 */
function DailyBreakdownTable({ breakdown }: { breakdown: DailyBreakdownResult }) {
  if (!breakdown || !breakdown.days || breakdown.days.length === 0) {
    return <div className="text-muted-foreground text-sm py-2">Нет данных по дням</div>;
  }

  const { days, summary } = breakdown;

  return (
    <div className="mt-4 border-t pt-4">
      <div className="text-sm font-medium mb-3 flex items-center gap-2">
        <Calendar className="h-4 w-4" />
        Детализация по дням
        <Badge variant="outline" className="text-xs ml-2">
          {summary.active_days} активных / {summary.pause_days} пауза
        </Badge>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left py-2 px-2 font-medium">День</th>
              <th className="text-right py-2 px-2 font-medium">Spend</th>
              <th className="text-right py-2 px-2 font-medium">Impr</th>
              <th className="text-right py-2 px-2 font-medium">CTR</th>
              <th className="text-right py-2 px-2 font-medium">CPM</th>
              <th className="text-right py-2 px-2 font-medium">Results</th>
              <th className="text-right py-2 px-2 font-medium">CPR</th>
              <th className="text-left py-2 px-2 font-medium">Сигналы</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day: DayBreakdown) => {
              const isWorst = day.date === summary.worst_day;
              const isBest = day.date === summary.best_day;
              const isPause = day.metrics.impressions === 0;

              const rowClass = isWorst
                ? 'bg-red-50'
                : isBest
                  ? 'bg-green-50'
                  : isPause
                    ? 'opacity-50'
                    : '';

              return (
                <tr key={day.date} className={`border-b border-gray-100 ${rowClass}`}>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1">
                      {format(new Date(day.date), 'EEE d', { locale: ru })}
                      {isWorst && <AlertTriangle className="h-3 w-3 text-red-500" />}
                      {isBest && <Check className="h-3 w-3 text-green-500" />}
                      {isPause && <PauseCircle className="h-3 w-3 text-gray-400" />}
                    </div>
                  </td>
                  <td className="text-right py-2 px-2">
                    ${day.metrics.spend.toFixed(2)}
                  </td>
                  <td className="text-right py-2 px-2">
                    {day.metrics.impressions.toLocaleString()}
                  </td>
                  <td className="text-right py-2 px-2">
                    {day.metrics.ctr !== null ? `${day.metrics.ctr.toFixed(2)}%` : '—'}
                  </td>
                  <td className="text-right py-2 px-2">
                    {day.metrics.cpm !== null ? `$${day.metrics.cpm.toFixed(2)}` : '—'}
                  </td>
                  <td className="text-right py-2 px-2">
                    {day.metrics.results}
                  </td>
                  <td className="text-right py-2 px-2 font-medium">
                    {day.metrics.cpr !== null ? `$${day.metrics.cpr.toFixed(2)}` : '—'}
                  </td>
                  <td className="text-left py-2 px-2">
                    {(() => {
                      // Показываем только значимые отклонения
                      const significantDeviations = day.deviations.filter(d => d.is_significant);
                      if (significantDeviations.length === 0) {
                        return <span className="text-muted-foreground">—</span>;
                      }
                      return (
                        <div className="flex flex-wrap gap-1">
                          {significantDeviations.map((dev, i) => (
                            <Badge
                              key={i}
                              variant="outline"
                              className={`text-xs ${
                                dev.direction === 'bad'
                                  ? 'border-red-300 text-red-600 bg-red-50'
                                  : dev.direction === 'good'
                                    ? 'border-green-300 text-green-600 bg-green-50'
                                    : 'border-gray-300 text-gray-600'
                              }`}
                            >
                              {dev.metric === 'cpr' ? 'CPR' : dev.metric.toUpperCase()}
                              {dev.delta_pct > 0 ? '+' : ''}{dev.delta_pct.toFixed(0)}%
                            </Badge>
                          ))}
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Объединённая таблица отклонений по всем 3 неделям
 * Строки = метрики, колонки = недели
 */
function UnifiedDeviationsTable({
  week0,
  weekMinus1,
  weekMinus2,
}: {
  week0: WeekDeviations | null;
  weekMinus1: WeekDeviations | null;
  weekMinus2: WeekDeviations | null;
}) {
  // Хелпер: найти deviation для метрики в неделе
  const getDeviation = (week: WeekDeviations | null, metric: string): MetricDeviation | undefined =>
    week?.deviations?.find((d) => d.metric === metric);

  // Хелпер: определить цвет ячейки
  const getCellColor = (dev: MetricDeviation | undefined): string => {
    if (!dev) return 'text-muted-foreground';
    if (dev.is_significant && dev.direction === 'bad') return 'text-red-600 font-medium';
    if (dev.is_significant && dev.direction === 'good') return 'text-green-600 font-medium';
    return 'text-gray-700';
  };

  // Хелпер: форматировать ячейку (значение + delta)
  const formatCell = (dev: MetricDeviation | undefined): React.ReactNode => {
    if (!dev) return '—';
    const valueStr = formatMetricValue(dev.value, dev.metric);
    const deltaStr = `${dev.delta_pct > 0 ? '+' : ''}${dev.delta_pct.toFixed(1)}%`;
    return (
      <span>
        {valueStr} <span className="text-xs">({deltaStr})</span>
      </span>
    );
  };

  // Хелпер: форматировать заголовок недели
  const formatWeekHeader = (week: WeekDeviations | null, label: string): string => {
    if (!week) return label;
    return `${format(new Date(week.week_start), 'd MMM', { locale: ru })} — ${format(new Date(week.week_end), 'd MMM', { locale: ru })}`;
  };

  // Хелпер: форматировать rankings для недели
  const formatRankings = (week: WeekDeviations | null): React.ReactNode => {
    if (!week) return <span className="text-muted-foreground">—</span>;
    const q = formatRankingLabel(week.quality_ranking);
    const e = formatRankingLabel(week.engagement_ranking);
    const c = formatRankingLabel(week.conversion_ranking);
    return (
      <div className="flex flex-col gap-0.5 text-xs">
        <span className={q.color}>Q: {q.label}</span>
        <span className={e.color}>E: {e.label}</span>
        <span className={c.color}>C: {c.label}</span>
      </div>
    );
  };

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="border-b">
          <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Метрика</th>
          <th className="text-center py-2 px-3 font-medium text-muted-foreground">
            <div className="flex flex-col">
              <span>📍 Аномалия</span>
              <span className="text-xs font-normal">{formatWeekHeader(week0, 'Week 0')}</span>
            </div>
          </th>
          <th className="text-center py-2 px-3 font-medium text-muted-foreground">
            <div className="flex flex-col">
              <span>-1 неделя</span>
              <span className="text-xs font-normal">{formatWeekHeader(weekMinus1, 'Week -1')}</span>
            </div>
          </th>
          <th className="text-center py-2 px-3 font-medium text-muted-foreground">
            <div className="flex flex-col">
              <span>-2 недели</span>
              <span className="text-xs font-normal">{formatWeekHeader(weekMinus2, 'Week -2')}</span>
            </div>
          </th>
        </tr>
      </thead>
      <tbody>
        {METRICS_ORDER.map((metric) => {
          const dev0 = getDeviation(week0, metric);
          const dev1 = getDeviation(weekMinus1, metric);
          const dev2 = getDeviation(weekMinus2, metric);

          return (
            <tr key={metric} className="border-b border-gray-100">
              <td className="py-2 pr-4">
                <div className="flex items-center gap-1.5">
                  {getMetricIcon(metric)}
                  <span>{getMetricLabel(metric)}</span>
                </div>
              </td>
              <td className={`text-center py-2 px-3 ${getCellColor(dev0)}`}>
                {formatCell(dev0)}
              </td>
              <td className={`text-center py-2 px-3 ${getCellColor(dev1)}`}>
                {formatCell(dev1)}
              </td>
              <td className={`text-center py-2 px-3 ${getCellColor(dev2)}`}>
                {formatCell(dev2)}
              </td>
            </tr>
          );
        })}
        {/* Rankings row */}
        <tr className="bg-muted/20">
          <td className="py-2 pr-4">
            <div className="flex items-center gap-1.5">
              <Star className="h-3.5 w-3.5" />
              <span>Rankings</span>
            </div>
          </td>
          <td className="text-center py-2 px-3">{formatRankings(week0)}</td>
          <td className="text-center py-2 px-3">{formatRankings(weekMinus1)}</td>
          <td className="text-center py-2 px-3">{formatRankings(weekMinus2)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * Подсчитывает общее количество ЗНАЧИМЫХ отклонений (is_significant = true)
 */
function countSignificantDeviations(anomaly: Anomaly): number {
  let count = 0;
  if (anomaly.preceding_deviations?.week_0?.deviations) {
    count += anomaly.preceding_deviations.week_0.deviations.filter((d) => d.is_significant).length;
  }
  if (anomaly.preceding_deviations?.week_minus_1?.deviations) {
    count += anomaly.preceding_deviations.week_minus_1.deviations.filter((d) => d.is_significant).length;
  }
  if (anomaly.preceding_deviations?.week_minus_2?.deviations) {
    count += anomaly.preceding_deviations.week_minus_2.deviations.filter((d) => d.is_significant).length;
  }
  return count;
}

/**
 * Проверяет есть ли данные для отображения
 */
function hasDataData(anomaly: Anomaly): boolean {
  return !!(
    anomaly.preceding_deviations?.week_0 ||
    anomaly.preceding_deviations?.week_minus_1 ||
    anomaly.preceding_deviations?.week_minus_2
  );
}

export const AnomaliesTable: React.FC<AnomaliesTableProps> = ({
  anomalies,
  loading,
  onAcknowledge,
}) => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            CPR Аномалии
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          CPR Аномалии
        </CardTitle>
        <CardDescription>
          Рост стоимости результата с анализом предшествующих отклонений ({anomalies.length})
        </CardDescription>
      </CardHeader>
      <CardContent>
        {anomalies.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Аномалий не обнаружено
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>CPR</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Ad</TableHead>
                  <TableHead>Текущее</TableHead>
                  <TableHead>Базовое</TableHead>
                  <TableHead>Δ %</TableHead>
                  <TableHead>Неделя</TableHead>
                  <TableHead>Сигналы</TableHead>
                  <TableHead>Паузы</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anomalies.map((anomaly) => {
                  const isExpanded = expandedRows.has(anomaly.id);
                  const isAcknowledged = anomaly.status === 'acknowledged';
                  const deltaPct = anomaly.delta_pct ?? 0;
                  const deviationsCount = countSignificantDeviations(anomaly);
                  const hasData = hasDataData(anomaly);

                  return (
                    <React.Fragment key={anomaly.id}>
                      {/* Основная строка */}
                      <TableRow
                        className={`${isAcknowledged ? 'opacity-50' : ''} ${hasData ? 'cursor-pointer hover:bg-muted/50' : ''}`}
                        onClick={() => hasData && toggleRow(anomaly.id)}
                      >
                        <TableCell className="w-8 p-2">
                          {hasData && (
                            isExpanded
                              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-orange-500" />
                            <span className="text-sm font-medium">Рост CPR</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`font-medium ${anomaly.anomaly_score >= 0.8 ? 'text-red-500' : anomaly.anomaly_score >= 0.5 ? 'text-orange-500' : 'text-yellow-500'}`}>
                            {(anomaly.anomaly_score ?? 0).toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs">{anomaly.fb_ad_id}</span>
                          {anomaly.ad_name && (
                            <p className="text-xs text-muted-foreground truncate max-w-32">
                              {anomaly.ad_name}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">
                            ${(anomaly.current_value ?? 0).toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-muted-foreground">
                            ${(anomaly.baseline_value ?? 0).toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-red-500 font-medium">
                            +{deltaPct.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">
                            {anomaly.week_start_date ? formatWeekRange(anomaly.week_start_date) : '-'}
                          </span>
                        </TableCell>
                        <TableCell>
                          {hasData ? (
                            <Badge variant="outline" className="text-xs">
                              {deviationsCount} сигнал{deviationsCount === 1 ? '' : deviationsCount < 5 ? 'а' : 'ов'}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {anomaly.has_delivery_gap ? (
                            <div className="flex items-center gap-1.5">
                              <PauseCircle className="h-4 w-4 text-amber-500" />
                              <span className="text-xs text-amber-600">
                                {anomaly.pause_days_count || 0} д.
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {!isAcknowledged && onAcknowledge && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onAcknowledge(anomaly.id)}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>

                      {/* Expanded row с деталями отклонений */}
                      {isExpanded && hasData && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={11} className="p-4">
                            <div className="text-sm font-medium mb-3 text-muted-foreground">
                              Отклонения метрик {deviationsCount > 0 && (
                                <span className="text-red-500">({deviationsCount} значимых)</span>
                              )}
                            </div>
                            <UnifiedDeviationsTable
                              week0={anomaly.preceding_deviations?.week_0 ?? null}
                              weekMinus1={anomaly.preceding_deviations?.week_minus_1 ?? null}
                              weekMinus2={anomaly.preceding_deviations?.week_minus_2 ?? null}
                            />
                            {/* Daily Breakdown - детализация по дням */}
                            {anomaly.daily_breakdown && (
                              <DailyBreakdownTable breakdown={anomaly.daily_breakdown} />
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AnomaliesTable;
