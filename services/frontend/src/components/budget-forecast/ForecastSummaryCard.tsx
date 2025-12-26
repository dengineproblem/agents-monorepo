/**
 * ForecastSummaryCard
 *
 * Карточки с текущими метриками кампании
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { DollarSign, Target, TrendingUp, Users } from 'lucide-react';
import type { CampaignForecastSummary } from '@/types/budgetForecast';

interface Props {
  summary: CampaignForecastSummary;
}

export const ForecastSummaryCard: React.FC<Props> = ({ summary }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <DollarSign className="h-4 w-4" />
            <span>Затраты/неделю</span>
          </div>
          <div className="text-2xl font-bold">
            ${summary.current_weekly_spend.toFixed(0)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Target className="h-4 w-4" />
            <span>Результаты/неделю</span>
          </div>
          <div className="text-2xl font-bold">
            {summary.current_weekly_results.toFixed(0)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <TrendingUp className="h-4 w-4" />
            <span>Средний CPR</span>
          </div>
          <div className="text-2xl font-bold">
            ${summary.avg_cpr.toFixed(2)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Users className="h-4 w-4" />
            <span>Подходящих объявлений</span>
          </div>
          <div className="text-2xl font-bold">
            {summary.eligible_ads}
            <span className="text-base font-normal text-muted-foreground">
              /{summary.total_ads}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ForecastSummaryCard;
