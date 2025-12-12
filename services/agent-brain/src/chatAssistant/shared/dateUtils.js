/**
 * Date utilities for Chat Assistant
 * Shared across all agents for period-based queries
 */

/**
 * Get date range for a period string
 * @param {string} period - Period identifier: 'today', 'yesterday', 'last_7d', 'last_30d'
 * @returns {{ since: string, until: string }} Date range in YYYY-MM-DD format
 */
export function getDateRange(period) {
  const now = new Date();
  let since, until;

  switch (period) {
    case 'today':
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      until = now;
      break;
    case 'yesterday':
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      until = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'last_7d':
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      until = now;
      break;
    case 'last_30d':
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      until = now;
      break;
    default:
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      until = now;
  }

  return {
    since: since.toISOString().split('T')[0],
    until: until.toISOString().split('T')[0]
  };
}

/**
 * Format date for display
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date string
 */
export function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

/**
 * Parse period from natural language to standard period
 * @param {string} text - Natural language period (e.g., "за сегодня", "за последнюю неделю")
 * @returns {string} Standard period identifier
 */
export function parsePeriod(text) {
  const lower = text.toLowerCase();

  if (lower.includes('сегодня') || lower.includes('today')) {
    return 'today';
  }
  if (lower.includes('вчера') || lower.includes('yesterday')) {
    return 'yesterday';
  }
  if (lower.includes('недел') || lower.includes('7 дн') || lower.includes('week')) {
    return 'last_7d';
  }
  if (lower.includes('месяц') || lower.includes('30 дн') || lower.includes('month')) {
    return 'last_30d';
  }

  return 'last_7d'; // default
}
