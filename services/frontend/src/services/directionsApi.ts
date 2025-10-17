import type { Direction, CreateDirectionPayload, UpdateDirectionPayload } from '@/types/direction';
import { API_BASE_URL } from '@/config/api';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: any;
}

export const directionsApi = {
  /**
   * Получить список направлений пользователя
   */
  async list(userAccountId: string): Promise<Direction[]> {
    try {
      console.log('[directionsApi.list] Запрос направлений для user_account_id:', userAccountId);
      
      const response = await fetch(`${API_BASE_URL}/api/directions?userAccountId=${userAccountId}`);
      
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
   * Создать новое направление (+ опционально дефолтные настройки)
   */
  async create(payload: CreateDirectionPayload): Promise<{ 
    success: boolean; 
    direction?: Direction; 
    default_settings?: any;
    error?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/directions`, {
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
      const response = await fetch(`${API_BASE_URL}/api/directions/${id}`, {
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
      const response = await fetch(`${API_BASE_URL}/api/directions/${id}`, {
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

