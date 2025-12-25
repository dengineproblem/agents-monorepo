/**
 * MetricsHeatmap - Таблица-heatmap метрик по неделям
 *
 * Показывает:
 * - Rows: метрики (frequency, ctr, cpm, etc.)
 * - Columns: Week 0 | Week -1 | Week -2
 * - Cells: significant_pct с цветовой шкалой
 * - Сортировка по significant_pct в Week -1 (предвестники)
 */

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import type { PatternMetricStats } from '@/types/adInsights';

interface MetricsHeatmapProps {
  week0: PatternMetricStats[];
  weekMinus1: PatternMetricStats[];
  weekMinus2: PatternMetricStats[];
  totalAnomalies: number;
  isLoading?: boolean;
}

// Метки метрик
const METRIC_LABELS: Record<string, string> = {
  frequency: 'Frequency',
  ctr: 'CTR',
  link_ctr: 'Link CTR',
  cpm: 'CPM',
  cpr: 'CPR',
  spend: 'Spend',
  results: 'Results',
  quality_ranking: 'Quality Rank',
  engagement_ranking: 'Engagement Rank',
  conversion_ranking: 'Conversion Rank',
};

// Порядок метрик
const METRIC_ORDER = [
  'frequency',
  'ctr',
  'link_ctr',
  'cpm',
  'cpr',
  'spend',
  'results',
  'quality_ranking',
  'engagement_ranking',
  'conversion_ranking',
];

export function MetricsHeatmap({
  week0,
  weekMinus1,
  weekMinus2,
  totalAnomalies,
  isLoading,
}: MetricsHeatmapProps) {
  // Собираем данные в единую структуру
  const tableData = useMemo(() => {
    const metricsMap = new Map<string, {
      metric: string;
      week0: PatternMetricStats | null;
      weekMinus1: PatternMetricStats | null;
      weekMinus2: PatternMetricStats | null;
    }>();

    // Собираем все метрики
    const allMetrics = new Set<string>();
    week0.forEach((m) => allMetrics.add(m.metric));
    weekMinus1.forEach((m) => allMetrics.add(m.metric));
    weekMinus2.forEach((m) => allMetrics.add(m.metric));

    // Создаём map
    for (const metric of allMetrics) {
      metricsMap.set(metric, {
        metric,
        week0: week0.find((m) => m.metric === metric) || null,
        weekMinus1: weekMinus1.find((m) => m.metric === metric) || null,
        weekMinus2: weekMinus2.find((m) => m.metric === metric) || null,
      });
    }

    // Сортируем: сначала по порядку METRIC_ORDER, потом по significant_pct в week_minus_1
    return Array.from(metricsMap.values()).sort((a, b) => {
      const orderA = METRIC_ORDER.indexOf(a.metric);
      const orderB = METRIC_ORDER.indexOf(b.metric);
      if (orderA !== -1 && orderB !== -1) return orderA - orderB;
      if (orderA !== -1) return -1;
      if (orderB !== -1) return 1;
      // По significant_pct в week_minus_1
      const sigA = a.weekMinus1?.significant_pct || 0;
      const sigB = b.weekMinus1?.significant_pct || 0;
      return sigB - sigA;
    });
  }, [week0, weekMinus1, weekMinus2]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Метрики-виновники</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            Загрузка...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (tableData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Метрики-виновники</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            Нет данных для отображения
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Метрики-виновники</CardTitle>
          <div className="text-sm text-muted-foreground">
            Total: {totalAnomalies} аномалий
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <TooltipProvider>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Метрика</TableHead>
                <TableHead className="text-center">Week 0</TableHead>
                <TableHead className="text-center">Week -1</TableHead>
                <TableHead className="text-center">Week -2</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableData.map((row) => (
                <TableRow key={row.metric}>
                  <TableCell className="font-medium">
                    {METRIC_LABELS[row.metric] || row.metric}
                  </TableCell>
                  <TableCell className="text-center p-1">
                    <MetricCell data={row.week0} totalAnomalies={totalAnomalies} />
                  </TableCell>
                  <TableCell className="text-center p-1">
                    <MetricCell data={row.weekMinus1} totalAnomalies={totalAnomalies} />
                  </TableCell>
                  <TableCell className="text-center p-1">
                    <MetricCell data={row.weekMinus2} totalAnomalies={totalAnomalies} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TooltipProvider>

        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground justify-center">
          <span>Цвет = % аномалий с этой метрикой:</span>
          <div className="flex items-center gap-1">
            <div className="w-6 h-3 rounded" style={{ backgroundColor: getHeatColor(0) }} />
            <span>0%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-3 rounded" style={{ backgroundColor: getHeatColor(25) }} />
            <span>25%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-3 rounded" style={{ backgroundColor: getHeatColor(50) }} />
            <span>50%+</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Ячейка с метрикой
function MetricCell({
  data,
  totalAnomalies,
}: {
  data: PatternMetricStats | null;
  totalAnomalies: number;
}) {
  if (!data || data.significant_count === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  const bgColor = getHeatColor(data.significant_pct);
  // Используем тёмный текст для светлого фона, белый для тёмного
  const textColor = data.significant_pct > 30 ? 'white' : '#1f2937'; // gray-800

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="inline-flex items-center gap-1 px-2 py-1 rounded cursor-help"
          style={{ backgroundColor: bgColor, color: textColor }}
        >
          <DirectionIcon direction={getDominantDirection(data.direction_breakdown)} />
          <span className="font-medium">{data.significant_pct.toFixed(0)}%</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <div className="space-y-1.5">
          <div className="font-medium">{METRIC_LABELS[data.metric] || data.metric}</div>
          <div className="text-xs space-y-0.5">
            <div>Significant: {data.significant_count} из {totalAnomalies}</div>
            <div>Avg delta: {data.avg_delta_pct > 0 ? '+' : ''}{data.avg_delta_pct.toFixed(1)}%</div>
            <div className="flex gap-2">
              <span className="text-red-400">Bad: {data.direction_breakdown.bad}</span>
              <span className="text-green-400">Good: {data.direction_breakdown.good}</span>
              <span className="text-gray-400">Neutral: {data.direction_breakdown.neutral}</span>
            </div>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// Иконка направления
function DirectionIcon({ direction }: { direction: 'bad' | 'good' | 'neutral' }) {
  if (direction === 'bad') {
    return <ArrowUp className="w-3 h-3 text-red-300" />;
  }
  if (direction === 'good') {
    return <ArrowDown className="w-3 h-3 text-green-300" />;
  }
  return <Minus className="w-3 h-3 opacity-50" />;
}

// Определяем доминирующее направление
function getDominantDirection(breakdown: { bad: number; good: number; neutral: number }): 'bad' | 'good' | 'neutral' {
  if (breakdown.bad >= breakdown.good && breakdown.bad >= breakdown.neutral) return 'bad';
  if (breakdown.good >= breakdown.bad && breakdown.good >= breakdown.neutral) return 'good';
  return 'neutral';
}

// Цвет heatmap (0-50%+)
function getHeatColor(pct: number): string {
  const normalized = Math.min(pct / 50, 1); // 0-1, cap at 50%
  // От белого (#f8fafc) к красному (#ef4444)
  const r = Math.round(248 - normalized * (248 - 239));
  const g = Math.round(250 - normalized * (250 - 68));
  const b = Math.round(252 - normalized * (252 - 68));
  return `rgb(${r}, ${g}, ${b})`;
}
