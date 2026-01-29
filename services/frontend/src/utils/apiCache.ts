/**
 * Утилиты для кэширования API запросов в localStorage
 * Используется для снижения нагрузки на Facebook API и избежания rate limits
 */

import { safeSetItem, safeGetItem, safeRemoveItem } from './safeStorage';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

/**
 * Получить данные из кэша
 * @param key Ключ кэша
 * @returns Данные из кэша или null если кэш устарел/отсутствует
 */
export function getCachedData<T>(key: string): T | null {
  try {
    const cached = safeGetItem(key);
    if (!cached) {

      return null;
    }

    const entry: CacheEntry<T> = JSON.parse(cached);
    const now = Date.now();

    // Проверяем, не истек ли TTL
    if (now - entry.timestamp > entry.ttl) {

    return entry.data;
  } catch (error) {

    return null;
  }
}

/**
 * Сохранить данные в кэш
 * @param key Ключ кэша
 * @param data Данные для сохранения
 * @param ttlMinutes Время жизни кэша в минутах (по умолчанию 5 минут)
 */
export function setCachedData<T>(key: string, data: T, ttlMinutes: number = 5): void {
  const entry: CacheEntry<T> = {
    data,
    timestamp: Date.now(),
    ttl: ttlMinutes * 60 * 1000
  };

  const success = safeSetItem(key, JSON.stringify(entry));
  if (success) {

  } else {

  }
}

/**
 * Инвалидировать (удалить) кэши по паттерну
 * @param pattern Строка для поиска в ключах кэша
 */
export function invalidateCache(pattern: string): void {
  try {
    const keys = Object.keys(localStorage);
    let removed = 0;

    keys.forEach(key => {
      if (key.includes(pattern)) {
        safeRemoveItem(key);
        removed++;
      }
    });

    if (removed > 0) {

    }
  } catch (error) {

  }
}

/**
 * Очистить устаревшие кэши
 */
export function cleanOldCaches(): void {
  try {
    const keys = Object.keys(localStorage);
    const now = Date.now();
    let removed = 0;

    keys.forEach(key => {
      // Проверяем только ключи, которые выглядят как наш кэш
      if (key.startsWith('adsets_') || key.startsWith('adset_stats_') || key.startsWith('api_cache_') || key.startsWith('cache_')) {
        try {
          const cached = safeGetItem(key);
          if (cached) {
            const entry = JSON.parse(cached);
            // Удаляем, если истек TTL
            if (now - entry.timestamp > entry.ttl) {
              safeRemoveItem(key);
              removed++;
            }
          }
        } catch {
          // Если не удалось распарсить, удаляем
          safeRemoveItem(key);
          removed++;
        }
      }
    });

  } catch (error) {

  }
}

/**
 * Полная очистка всех кэшей
 */
export function clearAllCaches(): void {
  try {
    const keys = Object.keys(localStorage);
    let removed = 0;

    keys.forEach(key => {
      if (key.startsWith('adsets_') || key.startsWith('adset_stats_') || key.startsWith('api_cache_') || key.startsWith('cache_')) {
        safeRemoveItem(key);
        removed++;
      }
    });

  } catch (error) {

  }
}

