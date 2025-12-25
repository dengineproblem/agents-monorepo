/**
 * SeasonalityChart - Bar chart с anomaly_rate по месяцам/неделям
 *
 * Показывает:
 * - X-axis: bucket (месяц или неделя)
 * - Y-axis: anomaly_rate (%)
 * - Elevated buckets выделены красным
 * - Baseline line (avg_rate)
 */

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { SeasonalityBucket, SeasonalitySummary } from '@/types/adInsights';

interface SeasonalityChartProps {
  buckets: SeasonalityBucket[];
  summary: SeasonalitySummary;
  granularity: 'month' | 'week';
  isLoading?: boolean;
}

export function SeasonalityChart({
  buckets,
  summary,
  granularity,
  isLoading,
}: SeasonalityChartProps) {
  // Форматируем данные для графика
  const chartData = useMemo(() => {
    return buckets.map((b) => ({
      ...b,
      // Форматируем label для оси X
      label: granularity === 'month'
        ? formatMonth(b.bucket)
        : formatWeek(b.bucket),
    }));
  }, [buckets, granularity]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Сезонность аномалий</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            Загрузка...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (buckets.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Сезонность аномалий</CardTitle>
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
          <CardTitle className="text-base">
            Сезонность аномалий ({granularity === 'month' ? 'по месяцам' : 'по неделям'})
          </CardTitle>
          <div className="text-sm text-muted-foreground">
            Avg rate: {summary.avg_rate.toFixed(2)}% | Elevated: {buckets.filter(b => b.is_elevated).length}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis
                dataKey="label"
                angle={-45}
                textAnchor="end"
                height={60}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11 }}
                label={{ value: 'Anomaly Rate', angle: -90, position: 'insideLeft', fontSize: 12 }}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine
                y={summary.avg_rate}
                stroke="#888"
                strokeDasharray="5 5"
                label={{ value: 'Avg', position: 'right', fontSize: 10 }}
              />
              <ReferenceLine
                y={summary.avg_rate + summary.rate_stddev}
                stroke="#ef4444"
                strokeDasharray="3 3"
                label={{ value: '+1σ', position: 'right', fontSize: 10 }}
              />
              <Bar dataKey="anomaly_rate" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.is_elevated ? '#ef4444' : '#3b82f6'}
                    opacity={entry.is_elevated ? 1 : 0.7}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground justify-center">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-blue-500 opacity-70" />
            <span>Normal</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-red-500" />
            <span>Elevated (&gt;avg + 1σ)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Custom tooltip
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null;

  const data = payload[0].payload as SeasonalityBucket;

  return (
    <div className="bg-popover border rounded-lg shadow-lg p-3 text-sm">
      <div className="font-medium mb-2">{data.bucket}</div>
      <div className="space-y-1 text-muted-foreground">
        <div className="flex justify-between gap-4">
          <span>Eligible weeks:</span>
          <span className="font-medium text-foreground">{data.eligible_count}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Anomalies:</span>
          <span className="font-medium text-foreground">{data.anomaly_count}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Rate:</span>
          <span className={`font-medium ${data.is_elevated ? 'text-red-500' : 'text-foreground'}`}>
            {data.anomaly_rate.toFixed(2)}%
          </span>
        </div>
        {data.avg_delta_pct !== null && (
          <div className="flex justify-between gap-4">
            <span>Avg CPR delta:</span>
            <span className="font-medium text-foreground">+{data.avg_delta_pct.toFixed(1)}%</span>
          </div>
        )}
        {data.is_elevated && (
          <div className="mt-2 pt-2 border-t text-red-500 text-xs">
            Elevated bucket
          </div>
        )}
      </div>
    </div>
  );
}

// Helpers
function formatMonth(bucket: string): string {
  // "2024-01" -> "Янв 24"
  const [year, month] = bucket.split('-');
  const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  return `${months[parseInt(month) - 1]} ${year.slice(2)}`;
}

function formatWeek(bucket: string): string {
  // "2024-W12" -> "W12"
  return bucket.replace(/^\d{4}-/, '');
}
