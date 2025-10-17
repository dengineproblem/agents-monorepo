/**
 * Feature flags для управления функционалом приложения
 */

export const FEATURES = {
  // TikTok интеграция (временно отключена)
  ENABLE_TIKTOK: false,
  
  // Другие будущие фичи
  ENABLE_ADVANCED_ANALYTICS: true,
  ENABLE_AI_AUTOPILOT: true,
} as const;

export type FeatureFlags = typeof FEATURES; 