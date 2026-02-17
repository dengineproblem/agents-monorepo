import type {
  AdAccount,
  AdAccountsResponse,
  CreateAdAccountPayload,
  UpdateAdAccountPayload,
} from '@/types/adAccount';
import { API_BASE_URL } from '@/config/api';

export const adAccountsApi = {
  /**
   * Получить все рекламные аккаунты пользователя
   */
  async list(userAccountId: string): Promise<AdAccountsResponse> {
    try {
      console.log('[adAccountsApi.list] Запрос аккаунтов для:', userAccountId);

      const response = await fetch(`${API_BASE_URL}/ad-accounts/${userAccountId}`);

      if (!response.ok) {
        console.error('[adAccountsApi.list] Ошибка HTTP:', response.status);
        return { multi_account_enabled: false, ad_accounts: [] };
      }

      const data = await response.json();
      console.log('[adAccountsApi.list] Результат:', data);

      return data;
    } catch (error) {
      console.error('[adAccountsApi.list] Исключение:', error);
      return { multi_account_enabled: false, ad_accounts: [] };
    }
  },

  /**
   * Получить конкретный рекламный аккаунт
   */
  async get(userAccountId: string, adAccountId: string): Promise<AdAccount | null> {
    try {
      console.log('[adAccountsApi.get] Запрос аккаунта:', adAccountId);

      const response = await fetch(`${API_BASE_URL}/ad-accounts/${userAccountId}/${adAccountId}`);

      if (!response.ok) {
        console.error('[adAccountsApi.get] Ошибка HTTP:', response.status);
        return null;
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('[adAccountsApi.get] Исключение:', error);
      return null;
    }
  },

  /**
   * Создать новый рекламный аккаунт
   */
  async create(payload: CreateAdAccountPayload): Promise<{
    success: boolean;
    adAccount?: AdAccount;
    error?: string;
  }> {
    try {
      console.log('[adAccountsApi.create] Создание аккаунта:', payload.name);

      const response = await fetch(`${API_BASE_URL}/ad-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[adAccountsApi.create] Ошибка:', errorData);
        return {
          success: false,
          error: errorData.error || `HTTP ${response.status}`,
        };
      }

      const adAccount = await response.json();
      console.log('[adAccountsApi.create] Создан:', adAccount.id);

      return { success: true, adAccount };
    } catch (error) {
      console.error('[adAccountsApi.create] Исключение:', error);
      return { success: false, error: 'Network error' };
    }
  },

  /**
   * Обновить рекламный аккаунт
   */
  async update(
    adAccountId: string,
    payload: UpdateAdAccountPayload,
    userAccountId?: string
  ): Promise<{
    success: boolean;
    adAccount?: AdAccount;
    error?: string;
  }> {
    try {
      console.log('[adAccountsApi.update] Обновление аккаунта:', adAccountId);

      // Resolve userAccountId from parameter or localStorage
      const userId = userAccountId || (() => {
        try { return JSON.parse(localStorage.getItem('user') || '{}').id; } catch { return undefined; }
      })();

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (userId) headers['x-user-id'] = userId;

      const response = await fetch(`${API_BASE_URL}/ad-accounts/${adAccountId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[adAccountsApi.update] Ошибка:', errorData);
        return {
          success: false,
          error: errorData.error || `HTTP ${response.status}`,
        };
      }

      const adAccount = await response.json();
      console.log('[adAccountsApi.update] Обновлён:', adAccount.id);

      return { success: true, adAccount };
    } catch (error) {
      console.error('[adAccountsApi.update] Исключение:', error);
      return { success: false, error: 'Network error' };
    }
  },

  /**
   * Удалить рекламный аккаунт
   */
  async delete(adAccountId: string, userAccountId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('[adAccountsApi.delete] Удаление аккаунта:', adAccountId);

      const userId = userAccountId || (() => {
        try { return JSON.parse(localStorage.getItem('user') || '{}').id; } catch { return undefined; }
      })();

      const headers: Record<string, string> = {};
      if (userId) headers['x-user-id'] = userId;

      const response = await fetch(`${API_BASE_URL}/ad-accounts/${adAccountId}`, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[adAccountsApi.delete] Ошибка:', errorData);
        return { success: false, error: errorData.error || `HTTP ${response.status}` };
      }

      console.log('[adAccountsApi.delete] Удалён:', adAccountId);
      return { success: true };
    } catch (error) {
      console.error('[adAccountsApi.delete] Исключение:', error);
      return { success: false, error: 'Network error' };
    }
  },

  /**
   * Обновить аватар страницы для одного аккаунта
   */
  async refreshPicture(adAccountId: string, userAccountId?: string): Promise<{ success: boolean; page_picture_url?: string; error?: string }> {
    try {
      console.log('[adAccountsApi.refreshPicture] Обновление аватара:', adAccountId);

      const userId = userAccountId || (() => {
        try { return JSON.parse(localStorage.getItem('user') || '{}').id; } catch { return undefined; }
      })();

      const headers: Record<string, string> = {};
      if (userId) headers['x-user-id'] = userId;

      const response = await fetch(`${API_BASE_URL}/ad-accounts/${adAccountId}/refresh-picture`, {
        method: 'POST',
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[adAccountsApi.refreshPicture] Ошибка:', errorData);
        return { success: false, error: errorData.error || `HTTP ${response.status}` };
      }

      const data = await response.json();
      console.log('[adAccountsApi.refreshPicture] Результат:', data);
      return { success: true, page_picture_url: data.page_picture_url };
    } catch (error) {
      console.error('[adAccountsApi.refreshPicture] Исключение:', error);
      return { success: false, error: 'Network error' };
    }
  },

  /**
   * Обновить аватары для всех аккаунтов пользователя
   */
  async refreshAllPictures(userAccountId: string): Promise<{ success: boolean; results?: Array<{ id: string; success: boolean; page_picture_url?: string }> }> {
    try {
      console.log('[adAccountsApi.refreshAllPictures] Обновление всех аватаров для:', userAccountId);

      const response = await fetch(`${API_BASE_URL}/ad-accounts/${userAccountId}/refresh-all-pictures`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[adAccountsApi.refreshAllPictures] Ошибка:', errorData);
        return { success: false };
      }

      const data = await response.json();
      console.log('[adAccountsApi.refreshAllPictures] Результат:', data);
      return { success: true, results: data.results };
    } catch (error) {
      console.error('[adAccountsApi.refreshAllPictures] Исключение:', error);
      return { success: false };
    }
  },
};
