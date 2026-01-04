import axios from 'axios';

const CREATIVE_GENERATION_SERVICE_URL = import.meta.env.VITE_CREATIVE_GENERATION_SERVICE_URL
  || (import.meta.env.DEV ? 'http://localhost:8085' : 'https://app.performanteaiagency.com/api/creative');

// Типы текстовых креативов
export type TextCreativeType = 'storytelling' | 'direct_offer' | 'expert_video' | 'telegram_post' | 'threads_post' | 'reference';

// Названия типов для UI
export const TEXT_TYPE_LABELS: Record<TextCreativeType, string> = {
  storytelling: 'Storytelling',
  direct_offer: 'Прямой оффер',
  expert_video: 'Видео экспертное',
  telegram_post: 'Пост в Telegram',
  threads_post: 'Пост в Threads',
  reference: 'Референс',
};

// Типы для dropdown
export const TEXT_TYPES: Array<{ value: TextCreativeType; label: string }> = [
  { value: 'storytelling', label: 'Storytelling' },
  { value: 'direct_offer', label: 'Прямой оффер' },
  { value: 'expert_video', label: 'Видео экспертное' },
  { value: 'telegram_post', label: 'Пост в Telegram' },
  { value: 'threads_post', label: 'Пост в Threads' },
  { value: 'reference', label: 'Референс' },
];

// Request/Response интерфейсы
export interface GenerateTextCreativeRequest {
  user_id: string;
  text_type: TextCreativeType;
  user_prompt: string;
  account_id?: string; // UUID рекламного аккаунта для мультиаккаунтности
}

export interface GenerateTextCreativeResponse {
  success: boolean;
  text?: string;
  generation_id?: string;
  error?: string;
}

export interface EditTextCreativeRequest {
  user_id: string;
  text_type: TextCreativeType;
  original_text: string;
  edit_instructions: string;
  account_id?: string; // UUID рекламного аккаунта для мультиаккаунтности
}

export interface EditTextCreativeResponse {
  success: boolean;
  text?: string;
  error?: string;
}

export const textCreativesApi = {
  /**
   * Генерация текстового креатива
   */
  async generate(request: GenerateTextCreativeRequest): Promise<GenerateTextCreativeResponse> {
    try {
      const response = await axios.post<GenerateTextCreativeResponse>(
        `${CREATIVE_GENERATION_SERVICE_URL}/generate-text-creative`,
        request,
        {
          timeout: 120000 // 2 минуты (генерация текста обычно быстрая)
        }
      );
      return response.data;
    } catch (error: any) {
      console.error('[Text Creatives API] Error generating text:', error);
      return {
        success: false,
        error: error.response?.data?.error || error.message || 'Failed to generate text creative'
      };
    }
  },

  /**
   * Редактирование текстового креатива
   */
  async edit(request: EditTextCreativeRequest): Promise<EditTextCreativeResponse> {
    try {
      const response = await axios.post<EditTextCreativeResponse>(
        `${CREATIVE_GENERATION_SERVICE_URL}/edit-text-creative`,
        request,
        {
          timeout: 120000
        }
      );
      return response.data;
    } catch (error: any) {
      console.error('[Text Creatives API] Error editing text:', error);
      return {
        success: false,
        error: error.response?.data?.error || error.message || 'Failed to edit text creative'
      };
    }
  }
};
