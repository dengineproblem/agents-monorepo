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
}

export const TestStatusIndicator: React.FC<TestStatusIndicatorProps> = ({ status }) => {
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
          tooltip: 'Тест в процессе',
        };
      case 'completed':
        return {
          icon: CheckCircle2,
          className: 'text-green-600',
          tooltip: 'Тест завершен',
        };
      case 'pending':
        return {
          icon: Clock,
          className: 'text-gray-400',
          tooltip: 'Тест ожидает запуска',
        };
      case 'failed':
        return {
          icon: XCircle,
          className: 'text-red-500',
          tooltip: 'Тест завершился с ошибкой',
        };
      case 'cancelled':
        return {
          icon: XCircle,
          className: 'text-gray-400',
          tooltip: 'Тест отменен',
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
          <div className="flex-shrink-0">
            <Icon className={`h-4 w-4 ${config.className}`} />
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{config.tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};




