/**
 * Безопасная работа с localStorage
 *
 * Обрабатывает переполнение квоты и автоматически очищает устаревшие данные
 */

// Критичные ключи, которые нельзя удалять при очистке
const PROTECTED_KEYS = [
  'user',
  'currentAdAccountId',
  'multiAccountEnabled',
  'adAccounts',
  'language',
  'originalUser', // для имперсонации
];

// Ключи кэша, которые можно безопасно удалить
const CACHE_PREFIXES = [
  'adsets_',
  'adset_stats_',
  'api_cache_',
  'cache_',
];

// Временные ключи, которые можно удалить
const TEMPORARY_KEYS = [
  'signup_username',
  'signup_phone',
  'hideDebtBanner',
  'onboardingDismissed',
  'onboardingTourCompleted',
  'adminSidebarCollapsed',
  'assistant_debug_logs',
  'directions-order',
  'selected_ad_account',
  'app_platform',
  'app_date_range',
];

/**
 * Оценка размера localStorage в байтах
 */
export function getStorageSize(): number {
  let total = 0;
  for (const key of Object.keys(localStorage)) {
    const value = localStorage.getItem(key);
    if (value) {
      // Приблизительный размер: ключ + значение (UTF-16 = 2 байта на символ)
      total += (key.length + value.length) * 2;
    }
  }
  return total;
}

/**
 * Форматирование размера в человекочитаемый вид
 */
export function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Получить статистику использования localStorage
 */
export function getStorageStats(): {
  totalSize: string;
  itemCount: number;
  cacheCount: number;
  protectedCount: number;
} {
  const keys = Object.keys(localStorage);
  const cacheCount = keys.filter(k =>
    CACHE_PREFIXES.some(prefix => k.startsWith(prefix))
  ).length;
  const protectedCount = keys.filter(k => PROTECTED_KEYS.includes(k)).length;

  return {
    totalSize: formatStorageSize(getStorageSize()),
    itemCount: keys.length,
    cacheCount,
    protectedCount,
  };
}

/**
 * Очистить все кэши (сохраняя критичные данные)
 */
export function clearAllCaches(): number {
  let removed = 0;
  const keys = Object.keys(localStorage);

  for (const key of keys) {
    // Не трогаем защищённые ключи
    if (PROTECTED_KEYS.includes(key)) continue;

    // Удаляем кэши
    if (CACHE_PREFIXES.some(prefix => key.startsWith(prefix))) {
      localStorage.removeItem(key);
      removed++;
    }
  }

  return removed;
}

/**
 * Очистить устаревшие кэши (с проверкой TTL)
 */
export function clearExpiredCaches(): number {
  let removed = 0;
  const now = Date.now();
  const keys = Object.keys(localStorage);

  for (const key of keys) {
    // Проверяем только кэши
    if (!CACHE_PREFIXES.some(prefix => key.startsWith(prefix))) continue;

    try {
      const value = localStorage.getItem(key);
      if (!value) continue;

      const entry = JSON.parse(value);
      // Если есть timestamp и ttl — проверяем
      if (entry.timestamp && entry.ttl) {
        if (now - entry.timestamp > entry.ttl) {
          localStorage.removeItem(key);
          removed++;
        }
      }
    } catch {
      // Если не парсится — удаляем
      localStorage.removeItem(key);
      removed++;
    }
  }

  return removed;
}

/**
 * Очистить временные данные
 */
export function clearTemporaryData(): number {
  let removed = 0;

  for (const key of TEMPORARY_KEYS) {
    if (localStorage.getItem(key) !== null) {
      localStorage.removeItem(key);
      removed++;
    }
  }

  return removed;
}

/**
 * Агрессивная очистка (всё кроме критичных данных)
 */
export function emergencyCleanup(): number {
  let removed = 0;
  const keys = Object.keys(localStorage);

  for (const key of keys) {
    // Оставляем только защищённые ключи
    if (!PROTECTED_KEYS.includes(key)) {
      localStorage.removeItem(key);
      removed++;
    }
  }

  return removed;
}

/**
 * Безопасное сохранение в localStorage
 * При переполнении автоматически очищает кэши
 */
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    if (error instanceof DOMException &&
        (error.name === 'QuotaExceededError' || error.code === 22)) {

      // Стадия 1: очистить устаревшие кэши
      clearExpiredCaches();
      try {
        localStorage.setItem(key, value);
        return true;
      } catch { /* продолжаем */ }

      // Стадия 2: очистить все кэши
      clearAllCaches();
      try {
        localStorage.setItem(key, value);
        return true;
      } catch { /* продолжаем */ }

      // Стадия 3: очистить временные данные
      clearTemporaryData();
      try {
        localStorage.setItem(key, value);
        return true;
      } catch { /* продолжаем */ }

      // Стадия 4: экстренная очистка
      emergencyCleanup();
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (finalError) {

        return false;
      }
    }

    return false;
  }
}

/**
 * Безопасное чтение из localStorage
 */
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (error) {

    return null;
  }
}

/**
 * Безопасное удаление из localStorage
 */
export function safeRemoveItem(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {

    return false;
  }
}

/**
 * Безопасный JSON.parse из localStorage
 */
export function safeGetJSON<T>(key: string, defaultValue: T): T {
  try {
    const value = localStorage.getItem(key);
    if (!value) return defaultValue;
    return JSON.parse(value) as T;
  } catch (error) {

    return defaultValue;
  }
}

/**
 * Безопасный JSON.stringify в localStorage
 */
export function safeSetJSON<T>(key: string, value: T): boolean {
  try {
    return safeSetItem(key, JSON.stringify(value));
  } catch (error) {

    return false;
  }
}

/**
 * Инициализация: проверяет состояние localStorage и очищает при необходимости
 * Вызывать при старте приложения
 */
export function initSafeStorage(): void {
  const stats = getStorageStats();

  // Проактивная очистка устаревших кэшей
  clearExpiredCaches();

  // Если используется > 4MB (из 5MB лимита), очищаем кэши
  const size = getStorageSize();
  if (size > 4 * 1024 * 1024) {

    clearAllCaches();
  }
}
