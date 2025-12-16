import { ArrowUpIcon, ArrowDownIcon, MinusIcon } from '@radix-ui/react-icons';
import { cn } from '@/lib/utils';

interface MetricRow {
  label: string;
  current: string;
  previous: string | null;
  delta: string | null;
  trend: 'up' | 'down' | 'neutral';
  inverse: boolean;
}

interface MetricsComparisonData {
  rows: MetricRow[];
  periods?: {
    current: { start: string; end: string };
    previous: { start: string; end: string } | null;
  } | null;
  hasPrevious: boolean;
}

interface UIMetricsComparisonProps {
  data: MetricsComparisonData;
  title?: string;
}

export function UIMetricsComparison({ data, title }: UIMetricsComparisonProps) {
  const { rows, periods, hasPrevious } = data;

  if (!rows || rows.length === 0) {
    return null;
  }

  const getTrendIcon = (trend: string, inverse: boolean) => {
    if (trend === 'neutral') {
      return <MinusIcon className="h-3 w-3 text-muted-foreground" />;
    }

    // For inverse metrics, up trend (bad) shows red, down trend (good) shows green
    // For normal metrics, up trend (good) shows green, down trend (bad) shows red
    const isGood = inverse ? trend === 'down' : trend === 'up';

    if (trend === 'up') {
      return (
        <ArrowUpIcon
          className={cn(
            "h-3 w-3",
            isGood ? "text-green-500" : "text-red-500"
          )}
        />
      );
    }

    return (
      <ArrowDownIcon
        className={cn(
          "h-3 w-3",
          isGood ? "text-green-500" : "text-red-500"
        )}
      />
    );
  };

  const getDeltaColor = (trend: string, inverse: boolean) => {
    if (trend === 'neutral') return 'text-muted-foreground';
    const isGood = inverse ? trend === 'down' : trend === 'up';
    return isGood ? 'text-green-600' : 'text-red-600';
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {title && (
        <h4 className="text-sm font-medium text-foreground">{title}</h4>
      )}

      {periods && (
        <div className="text-xs text-muted-foreground">
          {periods.current.start} — {periods.current.end}
          {periods.previous && (
            <span className="ml-2 opacity-70">
              vs {periods.previous.start} — {periods.previous.end}
            </span>
          )}
        </div>
      )}

      <div className="space-y-2">
        {rows.map((row, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0"
          >
            <span className="text-sm text-muted-foreground">{row.label}</span>

            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-foreground">
                {row.current}
              </span>

              {hasPrevious && row.previous && (
                <span className="text-xs text-muted-foreground">
                  {row.previous}
                </span>
              )}

              {row.delta && (
                <div className={cn(
                  "flex items-center gap-0.5 text-xs font-medium min-w-[60px] justify-end",
                  getDeltaColor(row.trend, row.inverse)
                )}>
                  {getTrendIcon(row.trend, row.inverse)}
                  <span>{row.delta}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default UIMetricsComparison;
