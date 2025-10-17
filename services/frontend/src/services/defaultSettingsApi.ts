import type { DefaultAdSettings, CreateDefaultSettingsInput, UpdateDefaultSettingsInput } from '@/types/direction';
import { API_BASE_URL } from '@/config/api';

interface ApiResponse<T> {
  success: boolean;
  settings?: T;
  error?: string;
  details?: any;
  message?: string;
}

export const defaultSettingsApi = {
  /**
   * Получить настройки для направления
   */
  async get(directionId: string): Promise<DefaultAdSettings | null> {
    try {
      console.log('[defaultSettingsApi.get] Загрузка настроек для direction:', directionId);
      const response = await fetch(`${API_BASE_URL}/api/default-settings?directionId=${directionId}`);
      
      if (!response.ok) {
        console.error('[defaultSettingsApi.get] HTTP ошибка:', response.status);
        return null;
      }

      const data: ApiResponse<DefaultAdSettings> = await response.json();
      console.log('[defaultSettingsApi.get] Ответ:', data);
      
      if (data.success) {
        return data.settings || null;
      }
      
      return null;
    } catch (error) {
      console.error('[defaultSettingsApi.get] Исключение:', error);
      return null;
    }
  },

  /**
   * Создать или обновить настройки (upsert)
   */
  async save(input: CreateDefaultSettingsInput): Promise<{ success: boolean; settings?: DefaultAdSettings; error?: string }> {
    try {
      console.log('[defaultSettingsApi.save] Сохранение настроек:', input);
      const response = await fetch(`${API_BASE_URL}/api/default-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      const data: ApiResponse<DefaultAdSettings> = await response.json();
      console.log('[defaultSettingsApi.save] Ответ:', data);

      if (!response.ok) {
        return { success: false, error: data.error || 'Не удалось сохранить настройки' };
      }

      return { success: true, settings: data.settings };
    } catch (error) {
      console.error('[defaultSettingsApi.save] Исключение:', error);
      return { success: false, error: 'Произошла ошибка при сохранении настроек' };
    }
  },

  /**
   * Частичное обновление настроек
   */
  async update(id: string, updates: UpdateDefaultSettingsInput): Promise<{ success: boolean; settings?: DefaultAdSettings; error?: string }> {
    try {
      console.log('[defaultSettingsApi.update] Обновление настроек:', id, updates);
      const response = await fetch(`${API_BASE_URL}/api/default-settings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      const data: ApiResponse<DefaultAdSettings> = await response.json();
      console.log('[defaultSettingsApi.update] Ответ:', data);

      if (!response.ok) {
        return { success: false, error: data.error || 'Не удалось обновить настройки' };
      }

      return { success: true, settings: data.settings };
    } catch (error) {
      console.error('[defaultSettingsApi.update] Исключение:', error);
      return { success: false, error: 'Произошла ошибка при обновлении настроек' };
    }
  },

  /**
   * Удалить настройки
   */
  async delete(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('[defaultSettingsApi.delete] Удаление настроек:', id);
      const response = await fetch(`${API_BASE_URL}/api/default-settings/${id}`, {
        method: 'DELETE',
      });

      const data: ApiResponse<any> = await response.json();
      console.log('[defaultSettingsApi.delete] Ответ:', data);

      if (!response.ok) {
        return { success: false, error: data.error || 'Не удалось удалить настройки' };
      }

      return { success: true };
    } catch (error) {
      console.error('[defaultSettingsApi.delete] Исключение:', error);
      return { success: false, error: 'Произошла ошибка при удалении настроек' };
    }
  },
};

