/**
 * Anomalies Table Component
 *
 * Таблица аномалий с фильтрацией и сортировкой
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Check, TrendingDown, TrendingUp, Activity } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { Anomaly, AnomalySeverity } from '@/types/adInsights';

interface AnomaliesTableProps {
  anomalies: Anomaly[];
  loading?: boolean;
  onAcknowledge?: (id: string) => void;
  onFilterChange?: (severity: AnomalySeverity | 'all') => void;
}

const anomalyTypeLabels: Record<string, { label: string; icon: React.ReactNode }> = {
  ctr_drop: { label: 'Падение CTR', icon: <TrendingDown className="h-4 w-4 text-red-500" /> },
  ctr_crash: { label: 'Обвал CTR', icon: <TrendingDown className="h-4 w-4 text-red-600" /> },
  cpr_spike: { label: 'Рост CPR', icon: <TrendingUp className="h-4 w-4 text-orange-500" /> },
  frequency_spike: { label: 'Рост частоты', icon: <Activity className="h-4 w-4 text-yellow-500" /> },
  frequency_critical: { label: 'Критическая частота', icon: <Activity className="h-4 w-4 text-red-500" /> },
  reach_drop: { label: 'Падение охвата', icon: <TrendingDown className="h-4 w-4 text-blue-500" /> },
  spend_anomaly: { label: 'Аномалия расхода', icon: <AlertTriangle className="h-4 w-4 text-purple-500" /> },
};

export const AnomaliesTable: React.FC<AnomaliesTableProps> = ({
  anomalies,
  loading,
  onAcknowledge,
  onFilterChange,
}) => {
  const [selectedSeverity, setSelectedSeverity] = useState<AnomalySeverity | 'all'>('all');

  const handleSeverityChange = (value: string) => {
    const severity = value as AnomalySeverity | 'all';
    setSelectedSeverity(severity);
    onFilterChange?.(severity);
  };

  const filteredAnomalies = selectedSeverity === 'all'
    ? anomalies
    : anomalies.filter((a) => a.severity === selectedSeverity);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Аномалии
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
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Аномалии
          </CardTitle>
          <CardDescription>
            Обнаруженные отклонения в метриках ({filteredAnomalies.length})
          </CardDescription>
        </div>
        <Select value={selectedSeverity} onValueChange={handleSeverityChange}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="critical">Критические</SelectItem>
            <SelectItem value="high">Высокие</SelectItem>
            <SelectItem value="medium">Средние</SelectItem>
            <SelectItem value="low">Низкие</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {filteredAnomalies.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Аномалий не обнаружено
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Тип</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Ad ID</TableHead>
                  <TableHead>Текущее</TableHead>
                  <TableHead>Базовое</TableHead>
                  <TableHead>Δ %</TableHead>
                  <TableHead>Неделя</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAnomalies.map((anomaly) => {
                  const typeInfo = anomalyTypeLabels[anomaly.anomaly_type] || {
                    label: anomaly.anomaly_type,
                    icon: <AlertTriangle className="h-4 w-4" />,
                  };

                  const isAcknowledged = anomaly.status === 'acknowledged';
                  const deltaPct = anomaly.delta_pct ?? 0;

                  return (
                    <TableRow key={anomaly.id} className={isAcknowledged ? 'opacity-50' : ''}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {typeInfo.icon}
                          <span className="text-sm">{typeInfo.label}</span>
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
                          {(anomaly.current_value ?? 0).toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground">
                          {(anomaly.baseline_value ?? 0).toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={deltaPct > 0 ? 'text-red-500' : 'text-green-500'}>
                          {deltaPct > 0 ? '+' : ''}{deltaPct.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {anomaly.week_start_date ? formatDistanceToNow(new Date(anomaly.week_start_date), {
                            addSuffix: true,
                            locale: ru,
                          }) : '-'}
                        </span>
                      </TableCell>
                      <TableCell>
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
