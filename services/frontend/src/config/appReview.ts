/**
 * App Review Mode Configuration
 * 
 * Когда VITE_APP_REVIEW_MODE=true, скрываются все AI-функции и автоматизация
 * для прохождения Facebook App Review.
 */

export const APP_REVIEW_MODE = import.meta.env.VITE_APP_REVIEW_MODE === 'true';

export const FEATURES = {
  // Скрыть TikTok интеграцию
  SHOW_TIKTOK: !APP_REVIEW_MODE,
  
  // Скрыть раздел Креативы (Creative Generation)
  SHOW_CREATIVES: !APP_REVIEW_MODE,
  
  // Скрыть раздел Направления (Directions)
  SHOW_DIRECTIONS: !APP_REVIEW_MODE,
  
  // Скрыть AI Autopilot карточку на Dashboard
  SHOW_AI_AUTOPILOT: !APP_REVIEW_MODE,
  
  // Скрыть ROI Analytics раздел
  SHOW_ROI_ANALYTICS: !APP_REVIEW_MODE,
  
  // Скрыть Консультации
  SHOW_CONSULTATIONS: !APP_REVIEW_MODE,
  
  // Скрыть Campaign Builder / Brain Agent
  SHOW_CAMPAIGN_BUILDER: !APP_REVIEW_MODE,
  
  // Скрыть раздел Видео (в мобильной версии в App Review)
  SHOW_VIDEOS: !APP_REVIEW_MODE,
  
  // Показывать переключатель языка (скрыт)
  SHOW_LANGUAGE_SWITCHER: false,
};

/**
 * Показывать ли confirmation dialog перед действием
 * В App Review режиме - ВСЕГДА показываем для всех критичных действий
 */
export const REQUIRE_CONFIRMATION = APP_REVIEW_MODE;

