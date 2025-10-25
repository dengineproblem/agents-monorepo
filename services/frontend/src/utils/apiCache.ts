/**
 * Утилиты для кэширования API запросов в localStorage
 * Используется для снижения нагрузки на Facebook API и избежания rate limits
 */

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
    const cached = localStorage.getItem(key);
    if (!cached) {
      console.log(`[Cache] Промах: ${key}`);
      return null;
    }
    
    const entry: CacheEntry<T> = JSON.parse(cached);
    const now = Date.now();
    
    // Проверяем, не истек ли TTL
    if (now - entry.timestamp > entry.ttl) {
      console.log(`[Cache] Истек: ${key} (возраст: ${Math.round((now - entry.timestamp) / 1000)}с)`);
      localStorage.removeItem(key);
      return null;
    }
    
    console.log(`[Cache] Попадание: ${key} (возраст: ${Math.round((now - entry.timestamp) / 1000)}с)`);
    return entry.data;
  } catch (error) {
    console.error(`[Cache] Ошибка при чтении кэша ${key}:`, error);
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
  try {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttlMinutes * 60 * 1000
    };
    localStorage.setItem(key, JSON.stringify(entry));
    console.log(`[Cache] Сохранено: ${key} (TTL: ${ttlMinutes} мин)`);
  } catch (error) {
    console.error(`[Cache] Ошибка при сохранении кэша ${key}:`, error);
    // Если localStorage переполнен, очищаем старые кэши
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      console.warn('[Cache] localStorage переполнен, очищаю старые кэши...');
      cleanOldCaches();
      // Пытаемся еще раз
      try {
        localStorage.setItem(key, JSON.stringify({
          data,
          timestamp: Date.now(),
          ttl: ttlMinutes * 60 * 1000
        }));
      } catch (retryError) {
        console.error('[Cache] Не удалось сохранить даже после очистки');
      }
    }
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
        localStorage.removeItem(key);
        removed++;
      }
    });
    
    if (removed > 0) {
      console.log(`[Cache] Инвалидировано ${removed} записей по паттерну: ${pattern}`);
    }
  } catch (error) {
    console.error(`[Cache] Ошибка при инвалидации кэша по паттерну ${pattern}:`, error);
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
      if (key.startsWith('adsets_') || key.startsWith('adset_stats_')) {
        try {
          const cached = localStorage.getItem(key);
          if (cached) {
            const entry = JSON.parse(cached);
            // Удаляем, если истек TTL
            if (now - entry.timestamp > entry.ttl) {
              localStorage.removeItem(key);
              removed++;
            }
          }
        } catch {
          // Если не удалось распарсить, удаляем
          localStorage.removeItem(key);
          removed++;
        }
      }
    });
    
    console.log(`[Cache] Очищено ${removed} устаревших записей`);
  } catch (error) {
    console.error('[Cache] Ошибка при очистке старых кэшей:', error);
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
      if (key.startsWith('adsets_') || key.startsWith('adset_stats_')) {
        localStorage.removeItem(key);
        removed++;
      }
    });
    
    console.log(`[Cache] Очищено всего ${removed} записей`);
  } catch (error) {
    console.error('[Cache] Ошибка при полной очистке кэшей:', error);
  }
}

