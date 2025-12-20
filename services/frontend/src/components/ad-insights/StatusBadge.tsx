/**
 * Status Badge Component
 *
 * Бейджи для отображения статусов и severity
 */

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type {
  AnomalySeverity,
  BurnoutLevel,
  RecoveryLevel,
  AdStatus,
  TrackingStatus,
} from '@/types/adInsights';

interface StatusBadgeProps {
  type: 'severity' | 'burnout' | 'recovery' | 'adStatus' | 'tracking';
  value: string;
  className?: string;
}

const severityConfig: Record<AnomalySeverity, { label: string; className: string }> = {
  low: { label: 'Низкий', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  medium: { label: 'Средний', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  high: { label: 'Высокий', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
  critical: { label: 'Критический', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
};

const burnoutConfig: Record<BurnoutLevel, { label: string; className: string }> = {
  low: { label: 'Низкий', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  medium: { label: 'Средний', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  high: { label: 'Высокий', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
  critical: { label: 'Критический', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
};

const recoveryConfig: Record<RecoveryLevel, { label: string; className: string }> = {
  unlikely: { label: 'Маловероятно', className: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200' },
  possible: { label: 'Возможно', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  likely: { label: 'Вероятно', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  very_likely: { label: 'Очень вероятно', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' },
};

const adStatusConfig: Record<AdStatus, { label: string; className: string }> = {
  healthy: { label: 'Здоров', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  degraded: { label: 'Деградирует', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  burned_out: { label: 'Выгорел', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
};

const trackingConfig: Record<TrackingStatus, { label: string; className: string }> = {
  healthy: { label: 'Здоров', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  warning: { label: 'Предупреждение', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  critical: { label: 'Критический', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ type, value, className }) => {
  let config: { label: string; className: string } | undefined;

  switch (type) {
    case 'severity':
      config = severityConfig[value as AnomalySeverity];
      break;
    case 'burnout':
      config = burnoutConfig[value as BurnoutLevel];
      break;
    case 'recovery':
      config = recoveryConfig[value as RecoveryLevel];
      break;
    case 'adStatus':
      config = adStatusConfig[value as AdStatus];
      break;
    case 'tracking':
      config = trackingConfig[value as TrackingStatus];
      break;
  }

  if (!config) {
    return <Badge variant="outline">{value}</Badge>;
  }

  return (
    <Badge variant="outline" className={cn(config.className, 'border-0', className)}>
      {config.label}
    </Badge>
  );
};

export default StatusBadge;
