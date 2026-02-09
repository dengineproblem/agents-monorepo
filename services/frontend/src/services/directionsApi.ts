import type { Direction, CreateDirectionPayload, UpdateDirectionPayload } from '@/types/direction';
import { API_BASE_URL } from '@/config/api';
import { shouldFilterByAccountId } from '@/utils/multiAccountHelper';

export interface DirectionCustomAudience {
  id: string;
  name: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: any;
}

export const directionsApi = {
  /**
   * Получить список направлений пользователя
   * @param userAccountId - ID пользователя из user_accounts
   * @param accountId - UUID из ad_accounts.id для фильтрации по рекламному аккаунту (опционально)
   */
  async list(
    userAccountId: string,
    accountId?: string | null,
    platform?: 'facebook' | 'tiktok'
  ): Promise<Direction[]> {
    try {
      console.log('[directionsApi.list] Запрос направлений для user_account_id:', userAccountId, 'account_id:', accountId);

      // Строим URL с параметрами
      const params = new URLSearchParams({ userAccountId });
      // Передаём accountId ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
      if (shouldFilterByAccountId(accountId)) {
        params.append('accountId', accountId!);
      }
      if (platform) {
        params.append('platform', platform);
      }

      const response = await fetch(`${API_BASE_URL}/directions?${params.toString()}`);

      console.log('[directionsApi.list] HTTP статус:', response.status);

      if (!response.ok) {
        console.error('[directionsApi.list] Ошибка HTTP:', response.statusText);
        return [];
      }

      const data = await response.json();
      console.log('[directionsApi.list] Результат от API:', data);

      // Бэкенд возвращает: { success: true, directions: [...] }
      if (data.success && data.directions) {
        console.log('[directionsApi.list] Найдено направлений:', data.directions.length);
        return data.directions;
      }

      return [];
    } catch (error) {
      console.error('[directionsApi.list] Исключение при получении направлений:', error);
      return [];
    }
  },

  /**
   * Получить список Custom Audience из Meta кабинета (с fallback на кэш)
   */
  async listCustomAudiences(
    userAccountId: string,
    accountId?: string | null
  ): Promise<DirectionCustomAudience[]> {
    try {
      console.log('[directionsApi.listCustomAudiences] Loading audiences', {
        userAccountId,
        accountId: accountId || null,
      });
      const params = new URLSearchParams({ userAccountId });
      if (shouldFilterByAccountId(accountId)) {
        params.append('accountId', accountId!);
      }

      const response = await fetch(`${API_BASE_URL}/directions/custom-audiences?${params.toString()}`);
      if (!response.ok) {
        console.warn('[directionsApi.listCustomAudiences] HTTP error', {
          status: response.status,
          statusText: response.statusText,
        });
        return [];
      }

      const data = await response.json();
      if (data.success && Array.isArray(data.audiences)) {
        console.log('[directionsApi.listCustomAudiences] Loaded audiences', {
          count: data.audiences.length,
          refreshed: data.refreshed ?? null,
          source: data.source ?? null,
        });
        return data.audiences;
      }

      console.warn('[directionsApi.listCustomAudiences] Unexpected response payload', data);
      return [];
    } catch (error) {
      console.error('Исключение при загрузке custom audiences:', error);
      return [];
    }
  },

  /**
   * Создать новое направление (+ опционально дефолтные настройки)
   */
  async create(payload: CreateDirectionPayload): Promise<{ 
    success: boolean; 
    direction?: Direction; 
    directions?: Direction[];
    default_settings?: any;
    error?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE_URL}/directions`, {
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
          error: data.error || 'Не удалось создать направление',
        };
      }
      
      return {
        success: true,
        direction: data.direction,
        directions: data.directions,
        default_settings: data.default_settings || null,
      };
    } catch (error) {
      console.error('Исключение при создании направления:', error);
      return {
        success: false,
        error: 'Произошла ошибка при создании направления',
      };
    }
  },

  /**
   * Обновить направление
   */
  async update(
    id: string,
    payload: UpdateDirectionPayload
  ): Promise<{ success: boolean; direction?: Direction; error?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/directions/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Не удалось обновить направление',
        };
      }
      
      return {
        success: true,
        direction: data.direction,
      };
    } catch (error) {
      console.error('Исключение при обновлении направления:', error);
      return {
        success: false,
        error: 'Произошла ошибка при обновлении направления',
      };
    }
  },

  /**
   * Удалить направление
   */
  async delete(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/directions/${id}`, {
        method: 'DELETE',
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Не удалось удалить направление',
        };
      }
      
      return {
        success: true,
      };
    } catch (error) {
      console.error('Исключение при удалении направления:', error);
      return {
        success: false,
        error: 'Произошла ошибка при удалении направления',
      };
    }
  },
};
