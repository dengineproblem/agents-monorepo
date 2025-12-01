/**
 * API клиент для раздела "Конкуренты"
 */

import type {
  Competitor,
  CompetitorCreative,
  AddCompetitorRequest,
  GetCompetitorsResponse,
  GetCreativesResponse,
  RefreshCompetitorResponse,
  CompetitorsPagination,
} from '@/types/competitor';
import { API_BASE_URL } from '@/config/api';

export const competitorsApi = {
  /**
   * Получить список конкурентов пользователя
   * @param accountId - UUID рекламного аккаунта для мультиаккаунтности (опционально)
   */
  async list(userAccountId: string, accountId?: string): Promise<Competitor[]> {
    try {
      console.log('[competitorsApi.list] Запрос конкурентов для user_account_id:', userAccountId, 'account_id:', accountId);

      const params = new URLSearchParams({ userAccountId });
      if (accountId) {
        params.append('accountId', accountId);
      }

      const response = await fetch(
        `${API_BASE_URL}/competitors?${params}`
      );

      if (!response.ok) {
        console.error('[competitorsApi.list] Ошибка HTTP:', response.statusText);
        return [];
      }

      const data: GetCompetitorsResponse = await response.json();

      if (data.success && data.competitors) {
        console.log('[competitorsApi.list] Найдено конкурентов:', data.competitors.length);
        return data.competitors;
      }

      return [];
    } catch (error) {
      console.error('[competitorsApi.list] Исключение:', error);
      return [];
    }
  },

  /**
   * Добавить конкурента
   */
  async add(payload: AddCompetitorRequest): Promise<{
    success: boolean;
    competitor?: Competitor;
    error?: string;
  }> {
    try {
      console.log('[competitorsApi.add] Добавление конкурента:', payload);

      const response = await fetch(`${API_BASE_URL}/competitors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Не удалось добавить конкурента',
        };
      }

      return {
        success: true,
        competitor: data.competitor,
      };
    } catch (error) {
      console.error('[competitorsApi.add] Исключение:', error);
      return {
        success: false,
        error: 'Произошла ошибка при добавлении конкурента',
      };
    }
  },

  /**
   * Удалить связь с конкурентом
   */
  async delete(
    userCompetitorId: string,
    userAccountId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(
        `${API_BASE_URL}/competitors/${userCompetitorId}?userAccountId=${userAccountId}`,
        {
          method: 'DELETE',
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Не удалось удалить конкурента',
        };
      }

      return { success: true };
    } catch (error) {
      console.error('[competitorsApi.delete] Исключение:', error);
      return {
        success: false,
        error: 'Произошла ошибка при удалении конкурента',
      };
    }
  },

  /**
   * Обновить креативы конкурента (ручной refresh)
   */
  async refresh(competitorId: string): Promise<RefreshCompetitorResponse> {
    try {
      console.log('[competitorsApi.refresh] Обновление конкурента:', competitorId);

      const response = await fetch(
        `${API_BASE_URL}/competitors/${competitorId}/refresh`,
        {
          method: 'POST',
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Не удалось обновить креативы',
          nextAllowedAt: data.nextAllowedAt,
        };
      }

      return {
        success: true,
        result: data.result,
      };
    } catch (error) {
      console.error('[competitorsApi.refresh] Исключение:', error);
      return {
        success: false,
        error: 'Произошла ошибка при обновлении креативов',
      };
    }
  },

  /**
   * Получить креативы конкурента
   */
  async getCreatives(
    competitorId: string,
    options: {
      page?: number;
      limit?: number;
      mediaType?: 'video' | 'image' | 'carousel' | 'all';
    } = {}
  ): Promise<{
    creatives: CompetitorCreative[];
    pagination: CompetitorsPagination;
  }> {
    try {
      const { page = 1, limit = 20, mediaType = 'all' } = options;

      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        mediaType,
      });

      const response = await fetch(
        `${API_BASE_URL}/competitors/${competitorId}/creatives?${params}`
      );

      if (!response.ok) {
        console.error('[competitorsApi.getCreatives] Ошибка HTTP:', response.statusText);
        return {
          creatives: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        };
      }

      const data: GetCreativesResponse = await response.json();

      return {
        creatives: data.creatives || [],
        pagination: data.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 },
      };
    } catch (error) {
      console.error('[competitorsApi.getCreatives] Исключение:', error);
      return {
        creatives: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      };
    }
  },

  /**
   * Получить все креативы всех конкурентов пользователя
   * @param accountId - UUID рекламного аккаунта для мультиаккаунтности (опционально)
   */
  async getAllCreatives(
    userAccountId: string,
    options: {
      page?: number;
      limit?: number;
      mediaType?: 'video' | 'image' | 'carousel' | 'all';
      top10Only?: boolean;
      includeAll?: boolean;
      newOnly?: boolean;
      accountId?: string; // UUID для мультиаккаунтности
    } = {}
  ): Promise<{
    creatives: CompetitorCreative[];
    pagination: CompetitorsPagination;
  }> {
    try {
      const {
        page = 1,
        limit = 20,
        mediaType = 'all',
        top10Only = false,
        includeAll = true,
        newOnly = false,
        accountId,
      } = options;

      const params = new URLSearchParams({
        userAccountId,
        page: page.toString(),
        limit: limit.toString(),
        mediaType,
        top10Only: top10Only.toString(),
        includeAll: includeAll.toString(),
        newOnly: newOnly.toString(),
      });

      if (accountId) {
        params.append('accountId', accountId);
      }

      const response = await fetch(
        `${API_BASE_URL}/competitors/all-creatives?${params}`
      );

      if (!response.ok) {
        console.error('[competitorsApi.getAllCreatives] Ошибка HTTP:', response.statusText);
        return {
          creatives: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        };
      }

      const data: GetCreativesResponse = await response.json();

      return {
        creatives: data.creatives || [],
        pagination: data.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 },
      };
    } catch (error) {
      console.error('[competitorsApi.getAllCreatives] Исключение:', error);
      return {
        creatives: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      };
    }
  },

  /**
   * Получить ТОП-10 креативы для референса при генерации
   * (сортировка по score, только is_top10=true)
   * @param accountId - UUID рекламного аккаунта для мультиаккаунтности (опционально)
   */
  async getTop10ForReference(
    userAccountId: string,
    options: {
      mediaType?: 'video' | 'image' | 'carousel' | 'all';
      limit?: number;
      accountId?: string; // UUID для мультиаккаунтности
    } = {}
  ): Promise<CompetitorCreative[]> {
    try {
      const { mediaType = 'all', limit = 20, accountId } = options;

      const params = new URLSearchParams({
        userAccountId,
        page: '1',
        limit: limit.toString(),
        mediaType,
        top10Only: 'true',
      });

      if (accountId) {
        params.append('accountId', accountId);
      }

      const response = await fetch(
        `${API_BASE_URL}/competitors/all-creatives?${params}`
      );

      if (!response.ok) {
        console.error('[competitorsApi.getTop10ForReference] Ошибка HTTP:', response.statusText);
        return [];
      }

      const data: GetCreativesResponse = await response.json();
      return data.creatives || [];
    } catch (error) {
      console.error('[competitorsApi.getTop10ForReference] Исключение:', error);
      return [];
    }
  },

  /**
   * Извлечь текст из креатива конкурента (OCR для картинок, транскрипция для видео)
   */
  async extractText(creativeId: string): Promise<{
    success: boolean;
    text?: string;
    media_type?: 'video' | 'image' | 'carousel';
    error?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE_URL}/competitors/extract-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creativeId }),
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('[competitorsApi.extractText] Исключение:', error);
      return { success: false, error: 'Ошибка сети' };
    }
  },
};
