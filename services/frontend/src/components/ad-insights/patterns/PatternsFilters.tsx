/**
 * PatternsFilters - Фильтры для patterns дашборда
 *
 * Включает:
 * - Granularity (month/week)
 * - Result family
 * - Period (from/to)
 */

import { Calendar, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PatternsQueryParams } from '@/types/adInsights';

interface PatternsFiltersProps {
  params: PatternsQueryParams;
  onChange: (params: Partial<PatternsQueryParams>) => void;
}

// Семейства результатов
const FAMILIES = [
  { value: 'all', label: 'Все семейства' },
  { value: 'messages', label: 'Messages' },
  { value: 'leadgen_form', label: 'Lead Forms' },
  { value: 'website_lead', label: 'Website Leads' },
  { value: 'purchase', label: 'Purchases' },
  { value: 'click', label: 'Clicks' },
];

// Периоды
const PERIODS = [
  { value: '3m', label: 'Последние 3 месяца', from: getMonthsAgo(3) },
  { value: '6m', label: 'Последние 6 месяцев', from: getMonthsAgo(6) },
  { value: '12m', label: 'Последние 12 месяцев', from: getMonthsAgo(12) },
  { value: 'all', label: 'Все время', from: undefined },
];

export function PatternsFilters({ params, onChange }: PatternsFiltersProps) {
  // Определяем текущий период
  const currentPeriod = params.from
    ? PERIODS.find((p) => p.from === params.from)?.value || 'custom'
    : 'all';

  return (
    <div className="flex flex-wrap items-center gap-3 pb-4 border-b">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Filter className="w-4 h-4" />
        <span className="text-sm font-medium">Фильтры:</span>
      </div>

      {/* Granularity */}
      <Select
        value={params.granularity || 'month'}
        onValueChange={(value) => onChange({ granularity: value as 'month' | 'week' })}
      >
        <SelectTrigger className="w-[140px]">
          <Calendar className="w-4 h-4 mr-2" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="month">По месяцам</SelectItem>
          <SelectItem value="week">По неделям</SelectItem>
        </SelectContent>
      </Select>

      {/* Result Family */}
      <Select
        value={params.result_family || 'all'}
        onValueChange={(value) => onChange({ result_family: value === 'all' ? undefined : value })}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Семейство" />
        </SelectTrigger>
        <SelectContent>
          {FAMILIES.map((f) => (
            <SelectItem key={f.value} value={f.value}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Period */}
      <Select
        value={currentPeriod}
        onValueChange={(value) => {
          const period = PERIODS.find((p) => p.value === value);
          onChange({ from: period?.from, to: undefined });
        }}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Период" />
        </SelectTrigger>
        <SelectContent>
          {PERIODS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Reset */}
      {(params.result_family || params.from || params.granularity !== 'month') && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange({
              granularity: 'month',
              result_family: undefined,
              from: undefined,
              to: undefined,
            })
          }
        >
          Сбросить
        </Button>
      )}
    </div>
  );
}

// Helper: дата N месяцев назад в формате YYYY-MM-DD
function getMonthsAgo(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().split('T')[0];
}
