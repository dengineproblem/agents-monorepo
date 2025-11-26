// TypeScript типы для сервиса генерации креативов

export interface GenerateTextRequest {
  user_id: string;
  prompt: string;
  existing_offer?: string;
  existing_bullets?: string;
  existing_benefits?: string;
  existing_cta?: string;
}

export interface GenerateTextResponse {
  success: boolean;
  offer?: string;
  bullets?: string;
  profits?: string;
  cta?: string;
  error?: string;
}

export interface GenerateCreativeRequest {
  user_id: string;
  offer: string;
  bullets: string;
  profits: string;
  cta?: string; // deprecated - CTA не рисуется на изображении, FB добавляет кнопку автоматически
  direction_id?: string;
  style_id?: 'modern_performance' | 'live_ugc' | 'visual_hook' | 'premium_minimal' | 'product_hero'; // Стиль креатива
  // Новое поле для референсного изображения
  reference_image?: string;
  reference_image_type?: 'base64' | 'url';
  reference_image_prompt?: string; // Описание того, как использовать референс
}

export interface GenerateCreativeResponse {
  success: boolean;
  creative_id?: string;
  image_url?: string;
  generations_remaining?: number;
  error?: string;
}

export interface UserAccount {
  id: string;
  creative_generations_available: number;
  prompt4: string | null;
  prompt1: string | null; // Используется для генерации текстов каруселей и видео-сценариев
}

// ============================================
// CAROUSEL TYPES
// ============================================

export type CarouselVisualStyle =
  | 'clean_minimal'
  | 'story_illustration'
  | 'photo_ugc'
  | 'asset_focus';

export interface CarouselCard {
  order: number;
  text: string;
  image_url?: string;
  image_url_4k?: string;
  custom_prompt?: string;
  reference_image_url?: string;
}

export interface GenerateCarouselTextsRequest {
  user_id: string;
  carousel_idea: string; // Общая идея карусели от пользователя
  cards_count: number; // 2-10 карточек
}

export interface GenerateCarouselTextsResponse {
  success: boolean;
  texts?: string[]; // Массив текстов для каждой карточки
  error?: string;
}

export interface RegenerateCarouselCardTextRequest {
  user_id: string;
  carousel_id: string;
  card_index: number;
  existing_texts: string[]; // Контекст других карточек
}

export interface RegenerateCarouselCardTextResponse {
  success: boolean;
  text?: string;
  error?: string;
}

export interface GenerateCarouselRequest {
  user_id: string;
  carousel_texts: string[]; // Массив текстов для карточек
  visual_style?: CarouselVisualStyle; // Визуальный стиль карусели (по умолчанию 'clean_minimal')
  custom_prompts?: (string | null)[]; // Опциональные промпты для каждой карточки
  reference_images?: (string | null)[]; // Опциональные референсные изображения (base64)
  direction_id?: string;
}

export interface GenerateCarouselResponse {
  success: boolean;
  carousel_id?: string;
  carousel_data?: CarouselCard[]; // Массив сгенерированных карточек
  generations_remaining?: number;
  error?: string;
}

export interface RegenerateCarouselCardRequest {
  user_id: string;
  carousel_id: string;
  card_index: number;
  custom_prompt?: string;
  reference_image?: string; // base64
  text: string; // Текст для этой карточки
}

export interface RegenerateCarouselCardResponse {
  success: boolean;
  card_data?: CarouselCard;
  generations_remaining?: number;
  error?: string;
}

export interface UpscaleCarouselRequest {
  user_id: string;
  carousel_id: string;
}

export interface UpscaleCarouselResponse {
  success: boolean;
  carousel_data?: CarouselCard[]; // Обновленные карточки с 4K URLs
  error?: string;
}

