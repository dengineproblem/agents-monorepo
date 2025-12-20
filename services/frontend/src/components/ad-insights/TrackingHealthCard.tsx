/**
 * Tracking Health Card Component
 *
 * Карточка здоровья трекинга (пиксель/CAPI)
 */

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Wifi, WifiOff, AlertTriangle, CheckCircle } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import type { TrackingHealthResponse, TrackingIssue } from '@/types/adInsights';

interface TrackingHealthCardProps {
  data: TrackingHealthResponse | null;
  loading?: boolean;
}

const issueTypeLabels: Record<string, string> = {
  clicks_no_results: 'Клики без результатов',
  results_dropped: 'Падение результатов',
  high_volatility: 'Высокая волатильность',
};

export const TrackingHealthCard: React.FC<TrackingHealthCardProps> = ({ data, loading }) => {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wifi className="h-5 w-5" />
            Tracking Health
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

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wifi className="h-5 w-5" />
            Tracking Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            Нет данных
          </div>
        </CardContent>
      </Card>
    );
  }

  const getHealthColor = (score: number) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 50) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'critical':
        return <WifiOff className="h-5 w-5 text-red-500" />;
      default:
        return <Wifi className="h-5 w-5" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon(data.status)}
            <CardTitle>Tracking Health</CardTitle>
          </div>
          <StatusBadge type="tracking" value={data.status} />
        </div>
        <CardDescription>
          Здоровье пикселя и CAPI
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Overall Health Score */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Общий показатель</span>
            <span className="font-medium">{data.overallHealth}%</span>
          </div>
          <Progress
            value={data.overallHealth}
            className="h-3"
            indicatorClassName={getHealthColor(data.overallHealth)}
          />
        </div>

        {/* Issues */}
        {data.issues.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Проблемы ({data.issues.length})</p>
            <div className="space-y-2">
              {data.issues.slice(0, 5).map((issue, idx) => (
                <IssueRow key={idx} issue={issue} />
              ))}
              {data.issues.length > 5 && (
                <p className="text-xs text-muted-foreground text-center">
                  ...и ещё {data.issues.length - 5} проблем
                </p>
              )}
            </div>
          </div>
        )}

        {/* Recommendations */}
        {data.recommendations && data.recommendations.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Рекомендации</p>
            <ul className="space-y-1">
              {data.recommendations.map((rec, idx) => (
                <li key={idx} className="text-xs text-muted-foreground flex items-start gap-2">
                  <span className="text-primary">•</span>
                  {rec}
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.issues.length === 0 && (
          <div className="text-center py-4 text-green-600">
            <CheckCircle className="h-8 w-8 mx-auto mb-2" />
            <p className="text-sm font-medium">Трекинг работает корректно</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const IssueRow: React.FC<{ issue: TrackingIssue }> = ({ issue }) => {
  return (
    <div className="flex items-start gap-3 p-2 bg-muted/50 rounded-lg">
      <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {issueTypeLabels[issue.issue_type] || issue.issue_type}
          </span>
          <StatusBadge type="severity" value={issue.severity} />
        </div>
        <p className="text-xs text-muted-foreground font-mono truncate">
          {issue.fb_ad_id}
        </p>
        {issue.details && (
          <div className="text-xs text-muted-foreground mt-1">
            {issue.details.clicks !== undefined && (
              <span>Клики: {issue.details.clicks} | </span>
            )}
            {issue.details.results !== undefined && (
              <span>Результаты: {issue.details.results}</span>
            )}
            {issue.details.drop_percentage !== undefined && (
              <span>Падение: {issue.details.drop_percentage.toFixed(1)}%</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TrackingHealthCard;
