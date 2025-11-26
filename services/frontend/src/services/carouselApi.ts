import axios from 'axios';
import type {
  GenerateCarouselTextsRequest,
  GenerateCarouselTextsResponse,
  RegenerateCarouselCardTextRequest,
  RegenerateCarouselCardTextResponse,
  GenerateCarouselRequest,
  GenerateCarouselResponse,
  RegenerateCarouselCardRequest,
  RegenerateCarouselCardResponse,
  UpscaleCarouselRequest,
  UpscaleCarouselResponse,
  CreateCarouselCreativeRequest,
  CreateCarouselCreativeResponse
} from '../types/carousel';

const CREATIVE_GENERATION_SERVICE_URL = import.meta.env.VITE_CREATIVE_GENERATION_SERVICE_URL || 'http://localhost:8085';
const AGENT_SERVICE_URL = import.meta.env.VITE_AGENT_SERVICE_URL || 'http://localhost:8082';

export const carouselApi = {
  /**
   * Генерация текстов для карусели
   */
  async generateTexts(request: GenerateCarouselTextsRequest): Promise<GenerateCarouselTextsResponse> {
    try {
      const response = await axios.post<GenerateCarouselTextsResponse>(
        `${CREATIVE_GENERATION_SERVICE_URL}/generate-carousel-texts`,
        request
      );
      return response.data;
    } catch (error: any) {
      console.error('[Carousel API] Error generating texts:', error);
      return {
        success: false,
        error: error.response?.data?.error || error.message || 'Failed to generate carousel texts'
      };
    }
  },

  /**
   * Перегенерация текста одной карточки
   */
  async regenerateCardText(request: RegenerateCarouselCardTextRequest): Promise<RegenerateCarouselCardTextResponse> {
    try {
      const response = await axios.post<RegenerateCarouselCardTextResponse>(
        `${CREATIVE_GENERATION_SERVICE_URL}/regenerate-carousel-card-text`,
        request
      );
      return response.data;
    } catch (error: any) {
      console.error('[Carousel API] Error regenerating card text:', error);
      return {
        success: false,
        error: error.response?.data?.error || error.message || 'Failed to regenerate card text'
      };
    }
  },

  /**
   * Генерация карусели (все изображения)
   */
  async generateCarousel(request: GenerateCarouselRequest): Promise<GenerateCarouselResponse> {
    try {
      const response = await axios.post<GenerateCarouselResponse>(
        `${CREATIVE_GENERATION_SERVICE_URL}/generate-carousel`,
        request,
        {
          timeout: 600000 // 10 минут (генерация может занять много времени)
        }
      );
      return response.data;
    } catch (error: any) {
      console.error('[Carousel API] Error generating carousel:', error);
      return {
        success: false,
        error: error.response?.data?.error || error.message || 'Failed to generate carousel'
      };
    }
  },

  /**
   * Перегенерация одной карточки карусели
   */
  async regenerateCard(request: RegenerateCarouselCardRequest): Promise<RegenerateCarouselCardResponse> {
    try {
      const response = await axios.post<RegenerateCarouselCardResponse>(
        `${CREATIVE_GENERATION_SERVICE_URL}/regenerate-carousel-card`,
        request,
        {
          timeout: 120000 // 2 минуты
        }
      );
      return response.data;
    } catch (error: any) {
      console.error('[Carousel API] Error regenerating card:', error);
      return {
        success: false,
        error: error.response?.data?.error || error.message || 'Failed to regenerate card'
      };
    }
  },

  /**
   * Upscale карусели до 4K
   */
  async upscaleToThe4K(request: UpscaleCarouselRequest): Promise<UpscaleCarouselResponse> {
    try {
      const response = await axios.post<UpscaleCarouselResponse>(
        `${CREATIVE_GENERATION_SERVICE_URL}/upscale-carousel-to-4k`,
        request,
        {
          timeout: 600000 // 10 минут
        }
      );
      return response.data;
    } catch (error: any) {
      console.error('[Carousel API] Error upscaling carousel:', error);
      return {
        success: false,
        error: error.response?.data?.error || error.message || 'Failed to upscale carousel'
      };
    }
  },

  /**
   * Создание креатива в Facebook
   * Загружает изображения карусели в Facebook и создаёт ad creative
   * ВАЖНО: Этот метод идёт в agent-service, а не creative-generation-service
   */
  async createCreative(request: CreateCarouselCreativeRequest): Promise<CreateCarouselCreativeResponse> {
    try {
      const response = await axios.post<CreateCarouselCreativeResponse>(
        `${AGENT_SERVICE_URL}/create-carousel-creative`,
        request,
        {
          timeout: 300000 // 5 минут (загрузка изображений может занять время)
        }
      );
      return response.data;
    } catch (error: any) {
      console.error('[Carousel API] Error creating creative:', error);
      return {
        success: false,
        error: error.response?.data?.error || error.message || 'Failed to create carousel creative',
        facebook_error: error.response?.data?.facebook_error
      };
    }
  }
};
