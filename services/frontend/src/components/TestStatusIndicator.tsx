import React from 'react';
import { Loader2, CheckCircle2, Clock, XCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type TestStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

interface TestStatusIndicatorProps {
  status?: TestStatus | null;
  impressions?: number;
  limit?: number;
}

export const TestStatusIndicator: React.FC<TestStatusIndicatorProps> = ({ status, impressions = 0, limit = 1000 }) => {
  // Если статуса нет - не показываем ничего
  if (!status) {
    return null;
  }

  const getIndicatorConfig = (status: TestStatus) => {
    switch (status) {
      case 'running':
        return {
          icon: Loader2,
          className: 'text-blue-500 animate-spin',
          tooltip: `Тест в процессе: ${impressions.toLocaleString()} из ${limit.toLocaleString()} показов`,
          showProgress: true,
        };
      case 'completed':
        return {
          icon: CheckCircle2,
          className: 'text-green-600',
          tooltip: `Тест завершен: ${impressions.toLocaleString()} показов`,
          showProgress: false,
        };
      case 'pending':
        return {
          icon: Clock,
          className: 'text-gray-400',
          tooltip: 'Тест ожидает запуска',
          showProgress: false,
        };
      case 'failed':
        return {
          icon: XCircle,
          className: 'text-red-500',
          tooltip: 'Тест завершился с ошибкой',
          showProgress: false,
        };
      case 'cancelled':
        return {
          icon: XCircle,
          className: 'text-gray-400',
          tooltip: 'Тест отменен',
          showProgress: false,
        };
      default:
        return null;
    }
  };

  const config = getIndicatorConfig(status);

  if (!config) {
    return null;
  }

  const Icon = config.icon;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex-shrink-0 flex items-center gap-1.5">
            <Icon className={`h-4 w-4 ${config.className}`} />
            {config.showProgress && (
              <span className="text-xs text-gray-500 font-medium">
                {impressions.toLocaleString()}/{limit.toLocaleString()}
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{config.tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};




