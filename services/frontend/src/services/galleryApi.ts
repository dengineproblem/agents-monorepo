import axios from 'axios';

const CREATIVE_GENERATION_SERVICE_URL = import.meta.env.VITE_CREATIVE_GENERATION_SERVICE_URL
  || (import.meta.env.DEV ? 'http://localhost:8085' : 'https://app.performanteaiagency.com/api/creative');

// Типы для креативов
export interface GeneratedCreative {
  id: string;
  user_id: string;
  account_id?: string;
  direction_id?: string;
  offer: string;
  bullets: string;
  profits: string;
  cta: string;
  image_url: string;
  image_url_4k?: string;
  creative_type: 'image' | 'carousel';
  carousel_data?: CarouselCard[];
  style_id?: string;
  visual_style?: string;
  status: string;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
}

export interface CarouselCard {
  order: number;
  text: string;
  image_url?: string;
  image_url_4k?: string;
  custom_prompt?: string;
  reference_image_url?: string;
}

export interface TextGeneration {
  id: string;
  user_id: string;
  text_type: string;
  user_prompt: string;
  generated_text: string;
  created_at: string;
}

// Лейблы стилей
export const IMAGE_STYLE_LABELS: Record<string, string> = {
  modern_performance: 'Современная графика',
  live_ugc: 'Живой UGC-контент',
  visual_hook: 'Визуальный зацеп',
  premium_minimal: 'Премиум минимализм',
  product_hero: 'Товар в главной роли',
  freestyle: 'Свободный стиль'
};

export const CAROUSEL_STYLE_LABELS: Record<string, string> = {
  clean_minimal: 'Чистый минимализм',
  story_illustration: 'Иллюстрированная история',
  photo_ugc: 'Фото UGC',
  asset_focus: 'Фокус на продукте',
  freestyle: 'Свободный стиль'
};

export const TEXT_TYPE_LABELS: Record<string, string> = {
  storytelling: 'Storytelling',
  direct_offer: 'Прямой оффер',
  expert_video: 'Видео экспертное',
  telegram_post: 'Пост в Telegram',
  threads_post: 'Пост в Threads',
  reference: 'Референс'
};

// Ответы API
interface StyleGroup {
  style_id: string;
  style_label: string;
  count: number;
  creatives: GeneratedCreative[];
}

interface TextTypeGroup {
  type_id: string;
  type_label: string;
  count: number;
  texts: TextGeneration[];
}

interface GalleryCreativesResponse {
  success: boolean;
  total: number;
  styles: StyleGroup[];
  style_labels: {
    image: Record<string, string>;
    carousel: Record<string, string>;
  };
  error?: string;
}

interface HistoryCreativesResponse {
  success: boolean;
  total: number;
  drafts_count: number;
  published_count: number;
  creatives: GeneratedCreative[];
  drafts: GeneratedCreative[];
  published: GeneratedCreative[];
  error?: string;
}

interface TextHistoryResponse {
  success: boolean;
  total: number;
  texts: TextGeneration[];
  type_labels: Record<string, string>;
  error?: string;
}

interface TextGalleryResponse {
  success: boolean;
  total: number;
  types: TextTypeGroup[];
  type_labels: Record<string, string>;
  error?: string;
}

interface SaveDraftRequest {
  user_id: string;
  account_id?: string;
  creative_type: 'image' | 'carousel';
  offer?: string;
  bullets?: string;
  profits?: string;
  cta?: string;
  image_url?: string;
  style_id?: string;
  carousel_data?: CarouselCard[];
  visual_style?: string;
  direction_id?: string;
}

interface SaveDraftResponse {
  success: boolean;
  draft_id?: string;
  draft?: GeneratedCreative;
  error?: string;
}

export const galleryApi = {
  /**
   * Получить галерею креативов всех пользователей
   */
  async getGalleryCreatives(params?: {
    style?: string;
    visual_style?: string;
    creative_type?: 'image' | 'carousel';
    limit?: number;
    offset?: number;
  }): Promise<GalleryCreativesResponse> {
    try {
      const response = await axios.get<GalleryCreativesResponse>(
        `${CREATIVE_GENERATION_SERVICE_URL}/gallery/creatives`,
        { params, timeout: 30000 }
      );
      return response.data;
    } catch (error: any) {

      return {
        success: false,
        total: 0,
        styles: [],
        style_labels: { image: {}, carousel: {} },
        error: error.response?.data?.error || error.message
      };
    }
  },

  /**
   * Получить историю своих креативов
   */
  async getHistoryCreatives(params: {
    user_id: string;
    creative_type?: 'image' | 'carousel';
    include_drafts?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<HistoryCreativesResponse> {
    try {
      const response = await axios.get<HistoryCreativesResponse>(
        `${CREATIVE_GENERATION_SERVICE_URL}/history/creatives`,
        { params, timeout: 30000 }
      );
      return response.data;
    } catch (error: any) {

      return {
        success: false,
        total: 0,
        drafts_count: 0,
        published_count: 0,
        creatives: [],
        drafts: [],
        published: [],
        error: error.response?.data?.error || error.message
      };
    }
  },

  /**
   * Получить историю текстов
   */
  async getTextHistory(params: {
    user_id: string;
    text_type?: string;
    limit?: number;
    offset?: number;
  }): Promise<TextHistoryResponse> {
    try {
      const response = await axios.get<TextHistoryResponse>(
        `${CREATIVE_GENERATION_SERVICE_URL}/history/texts`,
        { params, timeout: 30000 }
      );
      return response.data;
    } catch (error: any) {

      return {
        success: false,
        total: 0,
        texts: [],
        type_labels: {},
        error: error.response?.data?.error || error.message
      };
    }
  },

  /**
   * Получить галерею текстов всех пользователей
   */
  async getTextGallery(params?: {
    text_type?: string;
    limit?: number;
    offset?: number;
  }): Promise<TextGalleryResponse> {
    try {
      const response = await axios.get<TextGalleryResponse>(
        `${CREATIVE_GENERATION_SERVICE_URL}/gallery/texts`,
        { params, timeout: 30000 }
      );
      return response.data;
    } catch (error: any) {

      return {
        success: false,
        total: 0,
        types: [],
        type_labels: {},
        error: error.response?.data?.error || error.message
      };
    }
  },

  /**
   * Сохранить черновик
   */
  async saveDraft(data: SaveDraftRequest): Promise<SaveDraftResponse> {
    try {
      const response = await axios.post<SaveDraftResponse>(
        `${CREATIVE_GENERATION_SERVICE_URL}/drafts/save`,
        data,
        { timeout: 30000 }
      );
      return response.data;
    } catch (error: any) {

      return {
        success: false,
        error: error.response?.data?.error || error.message
      };
    }
  },

  /**
   * Обновить черновик
   */
  async updateDraft(data: SaveDraftRequest & { draft_id: string }): Promise<SaveDraftResponse> {
    try {
      const response = await axios.put<SaveDraftResponse>(
        `${CREATIVE_GENERATION_SERVICE_URL}/drafts/update`,
        data,
        { timeout: 30000 }
      );
      return response.data;
    } catch (error: any) {

      return {
        success: false,
        error: error.response?.data?.error || error.message
      };
    }
  },

  /**
   * Удалить черновик
   */
  async deleteDraft(draftId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await axios.delete(
        `${CREATIVE_GENERATION_SERVICE_URL}/drafts/${draftId}`,
        { params: { user_id: userId }, timeout: 30000 }
      );
      return response.data;
    } catch (error: any) {

      return {
        success: false,
        error: error.response?.data?.error || error.message
      };
    }
  }
};
