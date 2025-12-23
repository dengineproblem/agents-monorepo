/**
 * Burnout Card Component
 *
 * Карточка прогноза выгорания объявления
 */

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Flame, TrendingUp, AlertTriangle } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import type { BurnoutPrediction } from '@/types/adInsights';

interface BurnoutCardProps {
  prediction: BurnoutPrediction;
  onClick?: () => void;
}

export const BurnoutCard: React.FC<BurnoutCardProps> = ({ prediction, onClick }) => {
  const burnoutScore = prediction.burnout_score ?? 0;
  const burnoutPercent = Math.round(burnoutScore * 100);
  const cprChange1w = prediction.predicted_cpr_change_1w ?? 0;
  const cprChange2w = prediction.predicted_cpr_change_2w ?? 0;
  const confidence = prediction.confidence ?? 0;

  const getBurnoutColor = (score: number) => {
    if (score >= 0.7) return 'bg-red-500';
    if (score >= 0.5) return 'bg-orange-500';
    if (score >= 0.3) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-500" />
            <span className="font-mono text-xs">{prediction.fb_ad_id}</span>
          </CardTitle>
          <StatusBadge type="burnout" value={prediction.burnout_level} />
        </div>
        {prediction.ad_name && (
          <CardDescription className="truncate">{prediction.ad_name}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Burnout Score Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Burnout Score</span>
            <span className="font-medium">{burnoutPercent}%</span>
          </div>
          <Progress
            value={burnoutPercent}
            className="h-2"
            indicatorClassName={getBurnoutColor(burnoutScore)}
          />
        </div>

        {/* Predictions */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="space-y-1">
            <p className="text-muted-foreground">CPR через 1 нед</p>
            <p className={`font-medium flex items-center gap-1 ${
              cprChange1w > 0 ? 'text-red-500' : 'text-green-500'
            }`}>
              <TrendingUp className={`h-3 w-3 ${cprChange1w < 0 ? 'rotate-180' : ''}`} />
              {cprChange1w > 0 ? '+' : ''}
              {cprChange1w.toFixed(1)}%
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">CPR через 2 нед</p>
            <p className={`font-medium flex items-center gap-1 ${
              cprChange2w > 0 ? 'text-red-500' : 'text-green-500'
            }`}>
              <TrendingUp className={`h-3 w-3 ${cprChange2w < 0 ? 'rotate-180' : ''}`} />
              {cprChange2w > 0 ? '+' : ''}
              {cprChange2w.toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Top Signals */}
        {prediction.top_signals && prediction.top_signals.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Ключевые сигналы:</p>
            <div className="space-y-1">
              {prediction.top_signals.slice(0, 3).map((signal, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs">
                  <AlertTriangle className="h-3 w-3 text-yellow-500 mt-0.5 shrink-0" />
                  <span className="text-muted-foreground">{signal.signal}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Confidence */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Уверенность: {Math.round(confidence * 100)}%</span>
          <span>Неделя: {prediction.week_start_date}</span>
        </div>
      </CardContent>
    </Card>
  );
};

export default BurnoutCard;
