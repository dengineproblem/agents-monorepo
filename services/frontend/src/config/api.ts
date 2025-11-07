// API Configuration
// API_BASE_URL - базовый URL для API (БЕЗ /api локально, С /api на продакшене)
// В сервисах НЕ добавляется /api/ в начале пути
// Локально: http://localhost:8082 (БЕЗ /api, т.к. без nginx)
// Продакшн: https://app.performanteaiagency.com/api (С /api, т.к. nginx убирает его)
export const API_BASE_URL = 
  import.meta.env.VITE_API_BASE_URL !== undefined
    ? import.meta.env.VITE_API_BASE_URL
    : (import.meta.env.DEV ? 'http://localhost:8082' : 'https://app.performanteaiagency.com/api');

// Analytics API (отдельный сервис на порту 7081)
// Локально: http://localhost:7081
// Продакшн: https://agents.performanteaiagency.com
export const ANALYTICS_API_BASE_URL = 
  import.meta.env.VITE_ANALYTICS_API_BASE_URL !== undefined
    ? import.meta.env.VITE_ANALYTICS_API_BASE_URL
    : (import.meta.env.DEV ? '' : 'https://agents.performanteaiagency.com');

// Для отладки
if (import.meta.env.DEV) {
  console.log('[API Config] Base URL:', API_BASE_URL);
  console.log('[API Config] Analytics API URL:', ANALYTICS_API_BASE_URL);
}

