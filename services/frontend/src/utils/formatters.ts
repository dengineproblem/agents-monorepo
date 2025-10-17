
/**
 * Utility functions for formatting data
 */

// Format currency (US dollars)
export const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
};

// Format currency (Kazakhstani Tenge)
export const formatCurrencyKZT = (value: number): string => {
  // Используем kk-KZ, чтобы получить символ ₸
  return new Intl.NumberFormat('kk-KZ', {
    style: 'currency',
    currency: 'KZT',
    maximumFractionDigits: 2,
  }).format(value);
};

// Format percentage
export const formatPercent = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
};

// Format percentage as whole number (for quality rate, etc.)
export const formatPercentWhole = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value / 100);
};

// Format large numbers with thousand separators
export const formatNumber = (value: number): string => {
  return new Intl.NumberFormat('en-US').format(value);
};

// Format date (day.month)
export const formatShortDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  return `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;
};

// Format date range for display
export const formatDateRange = (since: string, until: string): string => {
  const sinceDate = new Date(since);
  const untilDate = new Date(until);

  const sinceFormatted = `${sinceDate.getDate().toString().padStart(2, '0')}.${(sinceDate.getMonth() + 1).toString().padStart(2, '0')}.${sinceDate.getFullYear()}`;
  const untilFormatted = `${untilDate.getDate().toString().padStart(2, '0')}.${(untilDate.getMonth() + 1).toString().padStart(2, '0')}.${untilDate.getFullYear()}`;

  return `${sinceFormatted} - ${untilFormatted}`;
};
