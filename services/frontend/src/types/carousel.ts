// Типы для работы с каруселями

export interface CarouselCard {
  order: number;
  text: string;
  image_url?: string;
  image_url_4k?: string;
  custom_prompt?: string;
  reference_image_url?: string;
  reference_image?: string; // base64 для локального использования (не отправляется на сервер)
}

export interface GenerateCarouselTextsRequest {
  user_id: string;
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
  carousel_texts: string[];
  custom_prompts?: (string | null)[];
  reference_images?: (string | null)[];
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
  carousel_id: string;
  card_index: number;
  custom_prompt?: string;
  reference_image?: string;
  text: string;
}

export interface RegenerateCarouselCardResponse {
  success: boolean;
  image_url?: string;
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
