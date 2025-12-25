/**
 * PrecursorsCard - Топ-10 метрик-предвестников
 *
 * Показывает метрики из week_-1 и week_-2, которые чаще всего
 * значимо отклоняются перед аномалией CPR.
 *
 * Note: results исключены, т.к. они являются следствием, а не причиной
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import type { TopPrecursor } from '@/types/adInsights';

interface PrecursorsCardProps {
  precursors: TopPrecursor[];
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
  quality_ranking: 'Quality',
  engagement_ranking: 'Engagement',
  conversion_ranking: 'Conversion',
};

// Описание что означает bad направление для метрики
const METRIC_BAD_MEANING: Record<string, string> = {
  frequency: 'рост',
  ctr: 'падение',
  link_ctr: 'падение',
  cpm: 'рост',
  cpr: 'рост',
  spend: 'рост',
  results: 'падение',
  quality_ranking: 'падение',
  engagement_ranking: 'падение',
  conversion_ranking: 'падение',
};

// Метрики, которые исключаем из предвестников (следствия, а не причины)
const EXCLUDED_METRICS = ['results', 'cpr'];

export function PrecursorsCard({ precursors, isLoading }: PrecursorsCardProps) {
  // Фильтруем исключённые метрики
  const filteredPrecursors = precursors.filter(p => !EXCLUDED_METRICS.includes(p.metric));

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Предвестники
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[200px] flex items-center justify-center text-muted-foreground">
            Загрузка...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (filteredPrecursors.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Предвестники
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[200px] flex items-center justify-center text-muted-foreground">
            Нет данных
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          Топ предвестники
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2.5 max-h-[400px] overflow-y-auto">
          {filteredPrecursors.slice(0, 10).map((p, index) => (
            <PrecursorItem key={`${p.metric}_${p.week_offset}`} precursor={p} rank={index + 1} />
          ))}
        </div>
        <div className="mt-4 pt-3 border-t text-xs text-muted-foreground">
          Метрики, значимо отклоняющиеся за 1-2 недели до аномалии CPR
        </div>
      </CardContent>
    </Card>
  );
}

function PrecursorItem({ precursor, rank }: { precursor: TopPrecursor; rank: number }) {
  const label = METRIC_LABELS[precursor.metric] || precursor.metric;
  const weekLabel = precursor.week_offset === 'week_minus_1' ? 'Week -1' : 'Week -2';
  const badMeaning = METRIC_BAD_MEANING[precursor.metric] || 'изменение';

  // Определяем иконку и цвет
  const isBad = precursor.direction === 'bad';
  const isGood = precursor.direction === 'good';

  return (
    <div className="flex items-center gap-3">
      {/* Rank badge */}
      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
        {rank}
      </div>

      {/* Direction icon */}
      <div className={`flex-shrink-0 ${isBad ? 'text-red-500' : isGood ? 'text-green-500' : 'text-gray-400'}`}>
        {isBad ? (
          precursor.avg_delta_pct > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />
        ) : isGood ? (
          precursor.avg_delta_pct > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />
        ) : (
          <Minus className="w-4 h-4" />
        )}
      </div>

      {/* Metric info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{label}</span>
          <Badge variant="outline" className="text-xs shrink-0">
            {weekLabel}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          {isBad && <span className="text-red-500">{badMeaning} </span>}
          {precursor.avg_delta_pct > 0 ? '+' : ''}{precursor.avg_delta_pct.toFixed(0)}% в среднем
        </div>
      </div>

      {/* Percentage */}
      <div className="text-right shrink-0">
        <div className="text-lg font-semibold">
          {precursor.significant_pct.toFixed(0)}%
        </div>
        <div className="text-xs text-muted-foreground">аномалий</div>
      </div>
    </div>
  );
}
