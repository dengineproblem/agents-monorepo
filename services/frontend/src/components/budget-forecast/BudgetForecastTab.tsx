/**
 * BudgetForecastTab
 *
 * Главный компонент таба прогнозирования бюджета
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { budgetForecastApi } from '@/services/budgetForecastApi';
import type {
  CampaignForecastResponse,
  ScalingDelta,
  ForecastMetrics,
} from '@/types/budgetForecast';
import { DELTA_LABELS } from '@/types/budgetForecast';
import { ForecastSummaryCard } from './ForecastSummaryCard';
import { ForecastTable } from './ForecastTable';

interface Props {
  campaignId: string;
}

export const BudgetForecastTab: React.FC<Props> = ({ campaignId }) => {
  const [forecast, setForecast] = useState<CampaignForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDelta, setSelectedDelta] = useState<ScalingDelta>('no_change');

  useEffect(() => {
    async function loadForecast() {
      setLoading(true);
      setError(null);

      try {
        const data = await budgetForecastApi.getCampaignForecast(campaignId);
        setForecast(data);

        if (!data) {
          setError('Нет данных для прогнозирования');
        }
      } catch (err) {

        setError('Ошибка загрузки прогноза');
      } finally {
        setLoading(false);
      }
    }

    loadForecast();
  }, [campaignId]);

  if (loading) {
    return <ForecastSkeleton />;
  }

  if (error || !forecast) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="h-5 w-5" />
            <span>{error || 'Нет данных для прогнозирования'}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Для прогноза нужно минимум 2 недели данных с достаточным spend и результатами.
          </p>
        </CardContent>
      </Card>
    );
  }

  const getScenarioMetrics = (
    delta: ScalingDelta,
    week: 'week_1' | 'week_2'
  ): ForecastMetrics | null => {
    if (delta === 'no_change') {
      return forecast.summary.forecasts.no_change[week];
    }
    return forecast.summary.forecasts.scaling[delta]?.[week] || null;
  };

  const currentWeek1 = getScenarioMetrics(selectedDelta, 'week_1');
  const currentWeek2 = getScenarioMetrics(selectedDelta, 'week_2');

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <ForecastSummaryCard summary={forecast.summary} />

      {/* Scenario Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Сценарии масштабирования
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs
            value={selectedDelta}
            onValueChange={(v) => setSelectedDelta(v as ScalingDelta)}
          >
            <TabsList className="grid w-full grid-cols-4">
              {Object.entries(DELTA_LABELS).map(([key, label]) => (
                <TabsTrigger key={key} value={key}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value={selectedDelta} className="mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Week 1 */}
                <ScenarioCard
                  title="Прогноз на неделю +1"
                  metrics={currentWeek1}
                  current={{
                    spend: forecast.summary.current_weekly_spend,
                    results: forecast.summary.current_weekly_results,
                    cpr: forecast.summary.avg_cpr,
                  }}
                />

                {/* Week 2 */}
                <ScenarioCard
                  title="Прогноз на неделю +2"
                  metrics={currentWeek2}
                  current={{
                    spend: forecast.summary.current_weekly_spend,
                    results: forecast.summary.current_weekly_results,
                    cpr: forecast.summary.avg_cpr,
                  }}
                />
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Per-Ad Forecast Table */}
      <ForecastTable ads={forecast.ads} selectedDelta={selectedDelta} />
    </div>
  );
};

// Scenario Card Component
interface ScenarioCardProps {
  title: string;
  metrics: ForecastMetrics | null;
  current: ForecastMetrics;
}

const ScenarioCard: React.FC<ScenarioCardProps> = ({ title, metrics, current }) => {
  if (!metrics) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Нет данных</p>
        </CardContent>
      </Card>
    );
  }

  const spendChange = ((metrics.spend - current.spend) / current.spend) * 100;
  const resultsChange = ((metrics.results - current.results) / current.results) * 100;
  const cprChange = ((metrics.cpr - current.cpr) / current.cpr) * 100;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <MetricRow
            label="Затраты"
            value={`$${metrics.spend.toFixed(0)}`}
            change={spendChange}
            invertColors={true}
          />
          <MetricRow
            label="Результаты"
            value={metrics.results.toFixed(0)}
            change={resultsChange}
          />
          <MetricRow
            label="CPR"
            value={`$${metrics.cpr.toFixed(2)}`}
            change={cprChange}
            invertColors={true}
          />
        </div>
      </CardContent>
    </Card>
  );
};

// Metric Row Component
interface MetricRowProps {
  label: string;
  value: string;
  change: number;
  invertColors?: boolean;
}

const MetricRow: React.FC<MetricRowProps> = ({ label, value, change, invertColors = false }) => {
  const isPositive = change > 0;
  const isNegative = change < 0;

  // Для spend и CPR: рост = плохо (красный), падение = хорошо (зеленый)
  // Для результатов: рост = хорошо (зеленый), падение = плохо (красный)
  let colorClass = 'text-muted-foreground';
  if (isPositive) {
    colorClass = invertColors ? 'text-red-500' : 'text-green-500';
  } else if (isNegative) {
    colorClass = invertColors ? 'text-green-500' : 'text-red-500';
  }

  const Icon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;

  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-medium">{value}</span>
        <span className={`flex items-center text-sm ${colorClass}`}>
          <Icon className="h-3 w-3 mr-0.5" />
          {Math.abs(change).toFixed(1)}%
        </span>
      </div>
    </div>
  );
};

// Skeleton Component
const ForecastSkeleton: React.FC = () => (
  <div className="space-y-6">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i}>
          <CardContent className="pt-4">
            <Skeleton className="h-4 w-24 mb-2" />
            <Skeleton className="h-8 w-16" />
          </CardContent>
        </Card>
      ))}
    </div>
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-10 w-full mb-4" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </CardContent>
    </Card>
  </div>
);

export default BudgetForecastTab;
