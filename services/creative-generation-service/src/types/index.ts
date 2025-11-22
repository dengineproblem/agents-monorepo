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
  cta: string;
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
}

