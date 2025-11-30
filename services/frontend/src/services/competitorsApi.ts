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
   */
  async list(userAccountId: string): Promise<Competitor[]> {
    try {
      console.log('[competitorsApi.list] Запрос конкурентов для user_account_id:', userAccountId);

      const response = await fetch(
        `${API_BASE_URL}/competitors?userAccountId=${userAccountId}`
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
   */
  async getAllCreatives(
    userAccountId: string,
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
        userAccountId,
        page: page.toString(),
        limit: limit.toString(),
        mediaType,
      });

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
};
