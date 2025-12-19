/**
 * Date utilities for Chat Assistant
 * Shared across all agents for period-based queries
 */

// Month names in Russian
const MONTH_NAMES_RU = {
  'январ': 0, 'феврал': 1, 'март': 2, 'апрел': 3,
  'ма': 4, 'июн': 5, 'июл': 6, 'август': 7,
  'сентябр': 8, 'октябр': 9, 'ноябр': 10, 'декабр': 11
};

/**
 * Parse a specific date from natural language
 * @param {string} text - Date text like "30 ноября", "15 декабря 2024"
 * @returns {Date|null} Parsed date or null
 */
function parseSpecificDate(text) {
  if (!text) return null;

  const lower = text.toLowerCase().trim();

  // Try YYYY-MM-DD format first
  const isoMatch = lower.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
  }

  // Try DD.MM.YYYY or DD/MM/YYYY format
  const dotMatch = lower.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (dotMatch) {
    return new Date(parseInt(dotMatch[3]), parseInt(dotMatch[2]) - 1, parseInt(dotMatch[1]));
  }

  // Try Russian date like "30 ноября" or "30 ноября 2024"
  const ruMatch = lower.match(/(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/);
  if (ruMatch) {
    const day = parseInt(ruMatch[1]);
    const monthText = ruMatch[2];
    const year = ruMatch[3] ? parseInt(ruMatch[3]) : new Date().getFullYear();

    // Find month
    let month = -1;
    for (const [prefix, m] of Object.entries(MONTH_NAMES_RU)) {
      if (monthText.startsWith(prefix)) {
        month = m;
        break;
      }
    }

    if (month >= 0) {
      return new Date(year, month, day);
    }
  }

  return null;
}

/**
 * Get date range for a period string
 * @param {string} period - Period identifier: 'today', 'yesterday', 'last_7d', 'last_30d', or specific date
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
      until = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      break;
    case 'last_3d':
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3);
      until = now;
      break;
    case 'last_7d':
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      until = now;
      break;
    case 'last_14d':
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14);
      until = now;
      break;
    case 'last_30d':
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      until = now;
      break;
    case 'last_90d':
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90);
      until = now;
      break;
    case 'last_6m':
      since = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
      until = now;
      break;
    case 'last_12m':
    case 'last_year':
      since = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      until = now;
      break;
    case 'all':
      since = new Date(2020, 0, 1); // Достаточно далёкая дата
      until = now;
      break;
    default:
      // Try to parse as specific date
      const specificDate = parseSpecificDate(period);
      if (specificDate) {
        since = specificDate;
        until = specificDate;
      } else {
        // Fallback to last 7 days
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        until = now;
      }
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
 * @param {string} text - Natural language period (e.g., "за сегодня", "за последнюю неделю", "за 30 ноября")
 * @returns {string} Standard period identifier or specific date string
 */
export function parsePeriod(text) {
  const lower = text.toLowerCase();

  if (lower.includes('сегодня') || lower.includes('today')) {
    return 'today';
  }
  if (lower.includes('вчера') || lower.includes('yesterday')) {
    return 'yesterday';
  }
  if (lower.includes('3 дн') || lower.match(/три\s*дн/)) {
    return 'last_3d';
  }
  if (lower.includes('недел') || lower.includes('7 дн') || lower.includes('week')) {
    return 'last_7d';
  }
  if (lower.includes('14 дн') || lower.includes('две недел') || lower.includes('2 недел')) {
    return 'last_14d';
  }
  if (lower.match(/месяц[^е]|30 дн/) || lower.includes('month')) {
    return 'last_30d';
  }
  if (lower.includes('90 дн') || lower.includes('квартал') || lower.includes('3 месяц') || lower.includes('три месяц')) {
    return 'last_90d';
  }
  if (lower.includes('6 месяц') || lower.includes('шесть месяц') || lower.includes('полгод') || lower.includes('пол год')) {
    return 'last_6m';
  }
  if (lower.includes('год') || lower.includes('12 месяц') || lower.includes('year')) {
    return 'last_12m';
  }
  if (lower.includes('все время') || lower.includes('всё время') || lower.includes('all time') || lower.includes('за всё') || lower.includes('за все')) {
    return 'all';
  }

  // Try to parse specific date from the text
  const specificDate = parseSpecificDate(text);
  if (specificDate) {
    // Return the date string as-is (will be parsed again in getDateRange)
    // Extract just the date portion from text
    const dateMatch = lower.match(/(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/);
    if (dateMatch) {
      return dateMatch[0]; // Return matched date string
    }
    const isoMatch = lower.match(/\d{4}-\d{2}-\d{2}/);
    if (isoMatch) {
      return isoMatch[0];
    }
    const dotMatch = lower.match(/\d{1,2}[.\/]\d{1,2}[.\/]\d{4}/);
    if (dotMatch) {
      return dotMatch[0];
    }
  }

  return 'last_7d'; // default
}
