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
import type { Anomaly, MetricDeviation, WeekDeviations, AnomalySeverity } from '@/types/adInsights';

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

/**
 * Компонент отображения отклонений за одну неделю в виде таблицы
 */
function WeekDeviationsTable({ week, label }: { week: WeekDeviations | null; label: string }) {
  if (!week) {
    return null;
  }

  const weekRange = `${format(new Date(week.week_start), 'd MMM', { locale: ru })} — ${format(new Date(week.week_end), 'd MMM', { locale: ru })}`;
  const hasDeviations = week.deviations && week.deviations.length > 0;
  const hasRankings = week.quality_ranking !== null || week.engagement_ranking !== null || week.conversion_ranking !== null;

  // Показываем если есть хоть что-то
  if (!hasDeviations && !hasRankings) {
    return null;
  }

  const qualityRanking = formatRankingLabel(week.quality_ranking);
  const engagementRanking = formatRankingLabel(week.engagement_ranking);
  const conversionRanking = formatRankingLabel(week.conversion_ranking);

  return (
    <div className="mb-4">
      <div className="text-sm font-medium mb-2">{label}</div>

      {/* Deviations table */}
      {hasDeviations && (
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="border-b">
              <th className="text-left py-1.5 pr-4 font-medium text-muted-foreground">Метрика</th>
              <th className="text-right py-1.5 px-4 font-medium text-muted-foreground">{weekRange}</th>
              <th className="text-right py-1.5 px-4 font-medium text-muted-foreground">Baseline</th>
              <th className="text-right py-1.5 pl-4 font-medium text-muted-foreground">Δ %</th>
            </tr>
          </thead>
          <tbody>
            {week.deviations.map((dev, idx) => {
              const deltaColor = dev.direction === 'bad'
                ? 'text-red-600'
                : dev.direction === 'good'
                  ? 'text-green-600'
                  : 'text-gray-600';

              return (
                <tr key={`${dev.metric}-${idx}`} className="border-b border-gray-100">
                  <td className="py-1.5 pr-4">
                    <div className="flex items-center gap-1.5">
                      {getMetricIcon(dev.metric)}
                      <span>{getMetricLabel(dev.metric)}</span>
                    </div>
                  </td>
                  <td className="text-right py-1.5 px-4 font-medium">
                    {formatMetricValue(dev.value, dev.metric)}
                  </td>
                  <td className="text-right py-1.5 px-4 text-muted-foreground">
                    {formatMetricValue(dev.baseline, dev.metric)}
                  </td>
                  <td className={`text-right py-1.5 pl-4 font-medium ${deltaColor}`}>
                    {dev.delta_pct > 0 ? '+' : ''}{dev.delta_pct.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Rankings row */}
      {hasRankings && (
        <div className="flex gap-3 text-xs">
          <div className="flex items-center gap-1">
            <Star className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Quality:</span>
            <span className={`font-medium ${qualityRanking.color}`}>{qualityRanking.label}</span>
          </div>
          <div className="flex items-center gap-1">
            <ThumbsUp className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Engage:</span>
            <span className={`font-medium ${engagementRanking.color}`}>{engagementRanking.label}</span>
          </div>
          <div className="flex items-center gap-1">
            <Target className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Convert:</span>
            <span className={`font-medium ${conversionRanking.color}`}>{conversionRanking.label}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Подсчитывает общее количество значимых отклонений
 */
function countDeviations(anomaly: Anomaly): number {
  let count = 0;
  if (anomaly.preceding_deviations?.week_0?.deviations) {
    count += anomaly.preceding_deviations.week_0.deviations.length;
  }
  if (anomaly.preceding_deviations?.week_minus_1?.deviations) {
    count += anomaly.preceding_deviations.week_minus_1.deviations.length;
  }
  if (anomaly.preceding_deviations?.week_minus_2?.deviations) {
    count += anomaly.preceding_deviations.week_minus_2.deviations.length;
  }
  return count;
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
                  const deviationsCount = countDeviations(anomaly);
                  const hasDeviations = deviationsCount > 0;

                  return (
                    <React.Fragment key={anomaly.id}>
                      {/* Основная строка */}
                      <TableRow
                        className={`${isAcknowledged ? 'opacity-50' : ''} ${hasDeviations ? 'cursor-pointer hover:bg-muted/50' : ''}`}
                        onClick={() => hasDeviations && toggleRow(anomaly.id)}
                      >
                        <TableCell className="w-8 p-2">
                          {hasDeviations && (
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
                          {hasDeviations ? (
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
                      {isExpanded && hasDeviations && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={11} className="p-4">
                            <div className="text-sm font-medium mb-3 text-muted-foreground">
                              Отклонения метрик
                            </div>
                            <div className="grid gap-4 md:grid-cols-3">
                              <WeekDeviationsTable
                                week={anomaly.preceding_deviations?.week_0 ?? null}
                                label="📍 Неделя аномалии"
                              />
                              <WeekDeviationsTable
                                week={anomaly.preceding_deviations?.week_minus_1 ?? null}
                                label="За 1 неделю до"
                              />
                              <WeekDeviationsTable
                                week={anomaly.preceding_deviations?.week_minus_2 ?? null}
                                label="За 2 недели до"
                              />
                            </div>
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
