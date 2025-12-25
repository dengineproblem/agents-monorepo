/**
 * AccountBreakdown - Аномалии по аккаунтам
 *
 * Показывает сколько аномалий у каждого ad account
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2 } from 'lucide-react';
import type { AccountBreakdownItem } from '@/types/adInsights';

interface AccountBreakdownProps {
  breakdown: AccountBreakdownItem[];
  totalAnomalies: number;
  isLoading?: boolean;
}

export function AccountBreakdown({ breakdown, totalAnomalies, isLoading }: AccountBreakdownProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-500" />
            Аномалии по аккаунтам
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[150px] flex items-center justify-center text-muted-foreground">
            Загрузка...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (breakdown.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-500" />
            Аномалии по аккаунтам
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[150px] flex items-center justify-center text-muted-foreground">
            Нет данных
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-500" />
            Аномалии по аккаунтам
          </CardTitle>
          <span className="text-sm text-muted-foreground">
            {breakdown.length} аккаунтов
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {breakdown.map((acc, index) => (
            <div key={acc.account_id} className="flex items-center gap-3">
              {/* Rank */}
              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0">
                {index + 1}
              </div>

              {/* Account name */}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate" title={acc.account_name}>
                  {acc.account_name}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {acc.fb_account_id}
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="secondary" className="font-mono">
                  {acc.anomaly_count}
                </Badge>
                <span className="text-sm text-muted-foreground w-12 text-right">
                  {acc.pct_of_total}%
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-20 h-2 bg-muted rounded-full overflow-hidden shrink-0">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${Math.min(acc.pct_of_total * 2, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
