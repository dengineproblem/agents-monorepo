import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  parseISO,
  isValid,
  format,
  startOfDay,
  endOfDay
} from 'date-fns';

export type PeriodType = 'week' | 'month';

export interface PeriodRange {
  periodType: PeriodType;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  startIso: string;
  endIso: string;
}

export function normalizePeriodInput(
  periodTypeInput?: string,
  periodStartInput?: string
): PeriodRange {
  const periodType: PeriodType = periodTypeInput === 'week' || periodTypeInput === 'month'
    ? periodTypeInput
    : 'month';

  let baseDate = periodStartInput ? parseISO(periodStartInput) : new Date();
  if (periodStartInput && !isValid(baseDate)) {
    baseDate = new Date();
  }

  const start = periodType === 'week'
    ? startOfWeek(baseDate, { weekStartsOn: 1 })
    : startOfMonth(baseDate);

  const end = periodType === 'week'
    ? endOfWeek(baseDate, { weekStartsOn: 1 })
    : endOfMonth(baseDate);

  const periodStart = format(start, 'yyyy-MM-dd');
  const periodEnd = format(end, 'yyyy-MM-dd');

  return {
    periodType,
    periodStart,
    periodEnd,
    startIso: startOfDay(start).toISOString(),
    endIso: endOfDay(end).toISOString()
  };
}
