/**
 * Decay Recovery List Component
 *
 * Список объявлений с анализом decay/recovery
 */

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Activity, ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import type { DecayRecoveryAnalysis } from '@/types/adInsights';

interface DecayRecoveryListProps {
  analysis: DecayRecoveryAnalysis[];
  loading?: boolean;
}

export const DecayRecoveryList: React.FC<DecayRecoveryListProps> = ({ analysis, loading }) => {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Decay / Recovery
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

  // Разделяем по статусам
  const degraded = analysis.filter((a) => a.status === 'degraded');
  const burnedOut = analysis.filter((a) => a.status === 'burned_out');
  const healthy = analysis.filter((a) => a.status === 'healthy');

  const getScoreColor = (score: number, isRecovery: boolean) => {
    if (isRecovery) {
      if (score >= 0.7) return 'bg-emerald-500';
      if (score >= 0.5) return 'bg-green-500';
      if (score >= 0.3) return 'bg-blue-500';
      return 'bg-gray-400';
    } else {
      if (score >= 0.7) return 'bg-red-500';
      if (score >= 0.5) return 'bg-orange-500';
      if (score >= 0.3) return 'bg-yellow-500';
      return 'bg-green-500';
    }
  };

  const renderAnalysisRow = (item: DecayRecoveryAnalysis) => (
    <TableRow key={item.fb_ad_id}>
      <TableCell>
        <div>
          <span className="font-mono text-xs">{item.fb_ad_id}</span>
          {item.ad_name && (
            <p className="text-xs text-muted-foreground truncate max-w-40">
              {item.ad_name}
            </p>
          )}
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge type="adStatus" value={item.status} />
      </TableCell>
      <TableCell>
        {item.decay ? (
          <div className="flex items-center gap-2">
            <ArrowDown className="h-4 w-4 text-red-500" />
            <div className="w-16">
              <Progress
                value={item.decay.score * 100}
                className="h-2"
                indicatorClassName={getScoreColor(item.decay.score, false)}
              />
            </div>
            <span className="text-xs font-medium">
              {Math.round(item.decay.score * 100)}%
            </span>
          </div>
        ) : (
          <Minus className="h-4 w-4 text-muted-foreground" />
        )}
      </TableCell>
      <TableCell>
        {item.recovery ? (
          <div className="flex items-center gap-2">
            <ArrowUp className="h-4 w-4 text-green-500" />
            <div className="w-16">
              <Progress
                value={item.recovery.score * 100}
                className="h-2"
                indicatorClassName={getScoreColor(item.recovery.score, true)}
              />
            </div>
            <span className="text-xs font-medium">
              {Math.round(item.recovery.score * 100)}%
            </span>
          </div>
        ) : (
          <Minus className="h-4 w-4 text-muted-foreground" />
        )}
      </TableCell>
      <TableCell>
        <span className="text-xs text-muted-foreground">{item.recommendation}</span>
      </TableCell>
    </TableRow>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Decay / Recovery анализ
        </CardTitle>
        <CardDescription>
          Статус объявлений: {burnedOut.length} выгорело, {degraded.length} деградирует, {healthy.length} здоровых
        </CardDescription>
      </CardHeader>
      <CardContent>
        {analysis.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Нет данных для анализа. Запустите синхронизацию.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ad</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Decay</TableHead>
                  <TableHead>Recovery</TableHead>
                  <TableHead>Рекомендация</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Сначала burned out, потом degraded, потом healthy */}
                {burnedOut.map(renderAnalysisRow)}
                {degraded.map(renderAnalysisRow)}
                {healthy.slice(0, 10).map(renderAnalysisRow)}
                {healthy.length > 10 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      ...и ещё {healthy.length - 10} здоровых объявлений
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default DecayRecoveryList;
