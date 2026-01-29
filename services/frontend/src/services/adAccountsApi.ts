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

      const response = await fetch(`${API_BASE_URL}/ad-accounts/${userAccountId}`);

      if (!response.ok) {

        return { multi_account_enabled: false, ad_accounts: [] };
      }

      const data = await response.json();

      return data;
    } catch (error) {

      return { multi_account_enabled: false, ad_accounts: [] };
    }
  },

  /**
   * Получить конкретный рекламный аккаунт
   */
  async get(userAccountId: string, adAccountId: string): Promise<AdAccount | null> {
    try {

      const response = await fetch(`${API_BASE_URL}/ad-accounts/${userAccountId}/${adAccountId}`);

      if (!response.ok) {

        return null;
      }

      const data = await response.json();
      return data;
    } catch (error) {

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

      const response = await fetch(`${API_BASE_URL}/ad-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        return {
          success: false,
          error: errorData.error || `HTTP ${response.status}`,
        };
      }

      const adAccount = await response.json();

      return { success: true, adAccount };
    } catch (error) {

      return { success: false, error: 'Network error' };
    }
  },

  /**
   * Обновить рекламный аккаунт
   */
  async update(
    adAccountId: string,
    payload: UpdateAdAccountPayload
  ): Promise<{
    success: boolean;
    adAccount?: AdAccount;
    error?: string;
  }> {
    try {

      const response = await fetch(`${API_BASE_URL}/ad-accounts/${adAccountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        return {
          success: false,
          error: errorData.error || `HTTP ${response.status}`,
        };
      }

      const adAccount = await response.json();

      return { success: true, adAccount };
    } catch (error) {

      return { success: false, error: 'Network error' };
    }
  },

  /**
   * Удалить рекламный аккаунт
   */
  async delete(adAccountId: string): Promise<{ success: boolean; error?: string }> {
    try {

      const response = await fetch(`${API_BASE_URL}/ad-accounts/${adAccountId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        return { success: false, error: errorData.error || `HTTP ${response.status}` };
      }

      return { success: true };
    } catch (error) {

      return { success: false, error: 'Network error' };
    }
  },

  /**
   * Обновить аватар страницы для одного аккаунта
   */
  async refreshPicture(adAccountId: string): Promise<{ success: boolean; page_picture_url?: string; error?: string }> {
    try {

      const response = await fetch(`${API_BASE_URL}/ad-accounts/${adAccountId}/refresh-picture`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        return { success: false, error: errorData.error || `HTTP ${response.status}` };
      }

      const data = await response.json();

      return { success: true, page_picture_url: data.page_picture_url };
    } catch (error) {

      return { success: false, error: 'Network error' };
    }
  },

  /**
   * Обновить аватары для всех аккаунтов пользователя
   */
  async refreshAllPictures(userAccountId: string): Promise<{ success: boolean; results?: Array<{ id: string; success: boolean; page_picture_url?: string }> }> {
    try {

      const response = await fetch(`${API_BASE_URL}/ad-accounts/${userAccountId}/refresh-all-pictures`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        return { success: false };
      }

      const data = await response.json();

      return { success: true, results: data.results };
    } catch (error) {

      return { success: false };
    }
  },
};
