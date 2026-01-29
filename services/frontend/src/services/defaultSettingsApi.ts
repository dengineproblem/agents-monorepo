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

      const response = await fetch(`${API_BASE_URL}/default-settings?directionId=${directionId}`);
      
      if (!response.ok) {

        return null;
      }

      const data: ApiResponse<DefaultAdSettings> = await response.json();

      if (data.success) {
        return data.settings || null;
      }
      
      return null;
    } catch (error) {

      return null;
    }
  },

  /**
   * Создать или обновить настройки (upsert)
   */
  async save(input: CreateDefaultSettingsInput): Promise<{ success: boolean; settings?: DefaultAdSettings; error?: string }> {
    try {

      const response = await fetch(`${API_BASE_URL}/default-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      const data: ApiResponse<DefaultAdSettings> = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Не удалось сохранить настройки' };
      }

      return { success: true, settings: data.settings };
    } catch (error) {

      return { success: false, error: 'Произошла ошибка при сохранении настроек' };
    }
  },

  /**
   * Частичное обновление настроек
   */
  async update(id: string, updates: UpdateDefaultSettingsInput): Promise<{ success: boolean; settings?: DefaultAdSettings; error?: string }> {
    try {

      const response = await fetch(`${API_BASE_URL}/default-settings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      const data: ApiResponse<DefaultAdSettings> = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Не удалось обновить настройки' };
      }

      return { success: true, settings: data.settings };
    } catch (error) {

      return { success: false, error: 'Произошла ошибка при обновлении настроек' };
    }
  },

  /**
   * Удалить настройки
   */
  async delete(id: string): Promise<{ success: boolean; error?: string }> {
    try {

      const response = await fetch(`${API_BASE_URL}/default-settings/${id}`, {
        method: 'DELETE',
      });

      const data: ApiResponse<any> = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Не удалось удалить настройки' };
      }

      return { success: true };
    } catch (error) {

      return { success: false, error: 'Произошла ошибка при удалении настроек' };
    }
  },
};

