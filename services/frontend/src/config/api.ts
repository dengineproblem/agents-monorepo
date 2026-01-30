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
// Локально: пустая строка (запросы идут на localhost через Vite proxy)
// Продакшн: пустая строка (запросы идут через nginx /api/analyzer/ на том же домене)
// Это избегает CORS проблем при кросс-доменных запросах
export const ANALYTICS_API_BASE_URL =
  import.meta.env.VITE_ANALYTICS_API_BASE_URL !== undefined
    ? import.meta.env.VITE_ANALYTICS_API_BASE_URL
    : '';

// Brain API (agent-brain сервис на порту 7080)
// Локально: http://localhost:7080
// Продакшн: https://agents.performanteaiagency.com (через nginx)
export const BRAIN_API_BASE_URL =
  import.meta.env.VITE_BRAIN_API_BASE_URL !== undefined
    ? import.meta.env.VITE_BRAIN_API_BASE_URL
    : (import.meta.env.DEV ? 'http://localhost:7080' : 'https://agents.performanteaiagency.com');

// Для отладки
if (import.meta.env.DEV) {
  console.log('[API Config] Base URL:', API_BASE_URL);
  console.log('[API Config] Analytics API URL:', ANALYTICS_API_BASE_URL);
  console.log('[API Config] Brain API URL:', BRAIN_API_BASE_URL);
}

