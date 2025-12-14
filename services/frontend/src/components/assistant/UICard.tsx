import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { CardData, CardMetric, CardAction } from '@/types/assistantUI';

interface UICardProps {
  data: CardData;
  onAction?: (action: string, params: Record<string, unknown>) => void;
}

export function UICard({ data, onAction }: UICardProps) {
  const { title, subtitle, metrics, actions, variant = 'default' } = data;

  const variantStyles = {
    default: 'bg-background border',
    success: 'bg-green-50 border-green-200',
    warning: 'bg-amber-50 border-amber-200',
    error: 'bg-red-50 border-red-200',
  };

  return (
    <div className={cn('rounded-lg p-4 border', variantStyles[variant])}>
      {/* Header */}
      <div className="mb-3">
        <h4 className="font-semibold text-sm">{title}</h4>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>

      {/* Metrics */}
      {metrics && metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-3">
          {metrics.map((metric, idx) => (
            <MetricItem key={idx} metric={metric} />
          ))}
        </div>
      )}

      {/* Actions */}
      {actions && actions.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t">
          {actions.map((action, idx) => (
            <ActionButton
              key={idx}
              action={action}
              onClick={() => onAction?.(action.action, action.params)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MetricItem({ metric }: { metric: CardMetric }) {
  const { label, value, delta, trend } = metric;

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor = trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-muted-foreground';

  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-semibold">{value}</span>
        {delta && (
          <span className={cn('text-xs flex items-center gap-0.5', trendColor)}>
            <TrendIcon className="h-3 w-3" />
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  action,
  onClick,
}: {
  action: CardAction;
  onClick: () => void;
}) {
  const { label, variant = 'secondary' } = action;

  const variantMap = {
    primary: 'default' as const,
    secondary: 'outline' as const,
    danger: 'destructive' as const,
  };

  return (
    <Button
      size="sm"
      variant={variantMap[variant]}
      onClick={onClick}
      className="text-xs h-7"
    >
      {label}
    </Button>
  );
}

export default UICard;
