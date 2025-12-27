// Типы для работы с каруселями

export type CarouselVisualStyle =
  | 'clean_minimal'
  | 'story_illustration'
  | 'photo_ugc'
  | 'asset_focus'
  | 'freestyle';

// Опции того, что именно менять при перегенерации карточки
export type CardChangeOption =
  | 'background'      // Фон, сцена, атмосфера
  | 'typography'      // Шрифт, размер, расположение текста
  | 'main_object'     // Основной предмет/персонаж (поза, ракурс, действие)
  | 'composition';    // Композиция, расположение элементов

export interface CarouselCard {
  order: number;
  text: string;
  image_url?: string;
  image_url_4k?: string;
  reference_image_url?: string;
}

export interface GenerateCarouselTextsRequest {
  user_id: string;
  account_id?: string; // UUID рекламного аккаунта для мультиаккаунтности
  carousel_idea: string;
  cards_count: number;
}

export interface GenerateCarouselTextsResponse {
  success: boolean;
  texts?: string[];
  error?: string;
}

export interface RegenerateCarouselCardTextRequest {
  user_id: string;
  account_id?: string; // UUID рекламного аккаунта для мультиаккаунтности
  carousel_id: string;
  card_index: number;
  existing_texts: string[];
}

export interface RegenerateCarouselCardTextResponse {
  success: boolean;
  text?: string;
  error?: string;
}

export interface GenerateCarouselRequest {
  user_id: string;
  account_id?: string; // UUID рекламного аккаунта для мультиаккаунтности
  carousel_texts: string[];
  visual_style?: CarouselVisualStyle;
  style_prompt?: string; // Промпт для freestyle стиля
  custom_prompts?: (string | null)[];
  reference_images?: (string[] | null)[]; // Массив референсов для каждой карточки (до 2 на карточку)
  direction_id?: string;
}

export interface GenerateCarouselResponse {
  success: boolean;
  carousel_id?: string;
  carousel_data?: CarouselCard[];
  generations_remaining?: number;
  error?: string;
}

export interface RegenerateCarouselCardRequest {
  user_id: string;
  account_id?: string; // UUID рекламного аккаунта для мультиаккаунтности
  carousel_id: string;
  card_index: number;
  custom_prompt?: string;
  style_prompt?: string; // Промпт для freestyle стиля
  reference_image?: string; // Для обратной совместимости (первый референс)
  reference_images?: string[]; // До 2 референсов
  text: string;
  change_options?: CardChangeOption[]; // Что именно менять (если не указано — меняем всё)
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
  carousel_data?: CarouselCard[];
  error?: string;
}

// Типы для создания креатива в Facebook
export interface CreateCarouselCreativeRequest {
  user_id: string;
  account_id?: string; // UUID из ad_accounts (для мультиаккаунтности)
  carousel_id: string;
  direction_id: string;
}

export interface CreateCarouselCreativeResponse {
  success: boolean;
  fb_creative_id?: string;
  user_creative_id?: string;
  objective?: 'whatsapp' | 'instagram_traffic' | 'site_leads';
  cards_count?: number;
  error?: string;
  facebook_error?: any;
}
