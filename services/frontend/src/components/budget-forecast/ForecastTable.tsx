/**
 * ForecastTable
 *
 * Таблица прогнозов по объявлениям
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, AlertCircle, CheckCircle } from 'lucide-react';
import type { AdForecast, ScalingDelta, WeeklyForecast } from '@/types/budgetForecast';

interface Props {
  ads: AdForecast[];
  selectedDelta: ScalingDelta;
}

export const ForecastTable: React.FC<Props> = ({ ads, selectedDelta }) => {
  const getForecast = (ad: AdForecast): WeeklyForecast | null => {
    if (selectedDelta === 'no_change') {
      return ad.forecasts.no_change[0] || null;
    }
    return ad.forecasts.scaling[selectedDelta]?.[0] || null;
  };

  const getSourceBadge = (source: string) => {
    switch (source) {
      case 'ad':
        return <Badge variant="default">Ad</Badge>;
      case 'account_family':
        return <Badge variant="secondary">Account</Badge>;
      case 'global_family':
        return <Badge variant="outline">Global</Badge>;
      default:
        return <Badge variant="destructive">Fallback</Badge>;
    }
  };

  const getChangeIcon = (change: number, invert = false) => {
    const isPositive = change > 0;
    const isNegative = change < 0;

    if (Math.abs(change) < 1) {
      return <Minus className="h-3 w-3 text-muted-foreground" />;
    }

    if (isPositive) {
      return invert ? (
        <TrendingUp className="h-3 w-3 text-red-500" />
      ) : (
        <TrendingUp className="h-3 w-3 text-green-500" />
      );
    }

    return invert ? (
      <TrendingDown className="h-3 w-3 text-green-500" />
    ) : (
      <TrendingDown className="h-3 w-3 text-red-500" />
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Прогноз по объявлениям</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Объявление</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead className="text-right">Текущий Spend</TableHead>
                <TableHead className="text-right">Прогноз Spend</TableHead>
                <TableHead className="text-right">Текущий CPR</TableHead>
                <TableHead className="text-right">Прогноз CPR</TableHead>
                <TableHead className="text-right">Прогноз Results</TableHead>
                <TableHead className="text-center">Модель</TableHead>
                <TableHead className="text-center">Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ads.map((ad) => {
                const forecast = getForecast(ad);
                const cprChange = forecast
                  ? ((forecast.cpr_predicted - ad.current_week.cpr) / ad.current_week.cpr) * 100
                  : 0;
                const spendChange = forecast
                  ? ((forecast.spend_predicted - ad.current_week.spend) / ad.current_week.spend) * 100
                  : 0;

                return (
                  <TableRow key={ad.fb_ad_id}>
                    <TableCell className="font-medium max-w-[200px] truncate" title={ad.ad_name}>
                      {ad.ad_name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {ad.result_family}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      ${ad.current_week.spend.toFixed(0)}
                    </TableCell>
                    <TableCell className="text-right">
                      {forecast ? (
                        <div className="flex items-center justify-end gap-1">
                          <span>${forecast.spend_predicted.toFixed(0)}</span>
                          {getChangeIcon(spendChange, true)}
                        </div>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      ${ad.current_week.cpr.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      {forecast ? (
                        <div className="flex items-center justify-end gap-1">
                          <span>${forecast.cpr_predicted.toFixed(2)}</span>
                          {getChangeIcon(cprChange, true)}
                        </div>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {forecast ? forecast.results_predicted.toFixed(0) : '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      {getSourceBadge(ad.elasticity.source)}
                    </TableCell>
                    <TableCell className="text-center">
                      {ad.eligibility.is_eligible ? (
                        <CheckCircle className="h-4 w-4 text-green-500 mx-auto" />
                      ) : (
                        <div className="flex items-center justify-center" title={ad.eligibility.reason}>
                          <AlertCircle className="h-4 w-4 text-yellow-500" />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {ads.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            Нет объявлений с данными для прогнозирования
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ForecastTable;
