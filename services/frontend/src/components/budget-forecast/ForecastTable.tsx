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
import { AlertCircle, CheckCircle } from 'lucide-react';
import type { AdForecast, ScalingDelta } from '@/types/budgetForecast';

interface Props {
  ads: AdForecast[];
  selectedDelta: ScalingDelta;
}

export const ForecastTable: React.FC<Props> = ({ ads, selectedDelta }) => {
  // Получить CPR для конкретного delta (week 1)
  const getCprForDelta = (ad: AdForecast, delta: 'delta_20' | 'delta_50' | 'delta_100'): number | null => {
    const forecast = ad.forecasts.scaling[delta]?.[0];
    return forecast?.cpr_predicted ?? null;
  };

  // Получить results для выбранного delta
  const getResultsForSelectedDelta = (ad: AdForecast): number | null => {
    if (selectedDelta === 'no_change') {
      return ad.forecasts.no_change[0]?.results_predicted ?? null;
    }
    return ad.forecasts.scaling[selectedDelta]?.[0]?.results_predicted ?? null;
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

  // Цвет CPR: красный если выше текущего, зелёный если ниже
  const getCprColor = (predicted: number | null, current: number): string => {
    if (predicted === null) return '';
    if (predicted > current * 1.01) return 'text-red-500';
    if (predicted < current * 0.99) return 'text-green-500';
    return '';
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
                <TableHead className="text-right">Затраты/нед</TableHead>
                <TableHead className="text-right">CPR</TableHead>
                <TableHead className="text-right">CPR +20%</TableHead>
                <TableHead className="text-right">CPR +50%</TableHead>
                <TableHead className="text-right">CPR +100%</TableHead>
                <TableHead className="text-right">Результаты</TableHead>
                <TableHead className="text-center">Модель</TableHead>
                <TableHead className="text-center">Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ads.map((ad) => {
                const cpr20 = getCprForDelta(ad, 'delta_20');
                const cpr50 = getCprForDelta(ad, 'delta_50');
                const cpr100 = getCprForDelta(ad, 'delta_100');
                const results = getResultsForSelectedDelta(ad);
                const currentCpr = ad.current_week.cpr;

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
                      ${currentCpr.toFixed(2)}
                    </TableCell>
                    <TableCell className={`text-right ${getCprColor(cpr20, currentCpr)}`}>
                      {cpr20 !== null ? `$${cpr20.toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell className={`text-right ${getCprColor(cpr50, currentCpr)}`}>
                      {cpr50 !== null ? `$${cpr50.toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell className={`text-right ${getCprColor(cpr100, currentCpr)}`}>
                      {cpr100 !== null ? `$${cpr100.toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      {results !== null ? results.toFixed(0) : '-'}
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
