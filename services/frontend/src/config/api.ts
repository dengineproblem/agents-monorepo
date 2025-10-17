// API Configuration
// Локально: http://localhost:8082
// Продакшн: https://agents.performanteaiagency.com

export const API_BASE_URL = 
  import.meta.env.VITE_API_BASE_URL || 
  'https://agents.performanteaiagency.com';

// Analytics API (отдельный сервис на порту 7081)
// Локально: http://localhost:7081
// Продакшн: https://agents.performanteaiagency.com
export const ANALYTICS_API_BASE_URL = 
  import.meta.env.VITE_ANALYTICS_API_BASE_URL || 
  'https://agents.performanteaiagency.com';

// Для отладки
if (import.meta.env.DEV) {
  console.log('[API Config] Base URL:', API_BASE_URL);
  console.log('[API Config] Analytics API URL:', ANALYTICS_API_BASE_URL);
}

