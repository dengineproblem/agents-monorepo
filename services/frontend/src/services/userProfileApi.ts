import { API_BASE_URL } from '@/config/api';
import { getAuthHeaders } from '@/lib/apiAuth';

export const userProfileApi = {
  /**
   * GET /user/profile — загрузка профиля пользователя
   */
  async fetchProfile(userId: string) {
    const response = await fetch(`${API_BASE_URL}/user/profile`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Failed to fetch profile: ${response.status}`);
    }
    return response.json();
  },

  /**
   * POST /user/change-password — смена пароля
   */
  async changePassword(oldPassword: string, newPassword: string) {
    const response = await fetch(`${API_BASE_URL}/user/change-password`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Failed to change password: ${response.status}`);
    }
    return response.json();
  },

  /**
   * PATCH /user/profile — обновление полей профиля
   */
  async updateProfile(userId: string, fields: Record<string, unknown>) {
    const response = await fetch(`${API_BASE_URL}/user/profile`, {
      method: 'PATCH',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(fields),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Failed to update profile: ${response.status}`);
    }
    return response.json();
  },

  /**
   * DELETE /user/facebook-connection — отключение Facebook
   */
  async disconnectFacebook(userId: string) {
    const response = await fetch(`${API_BASE_URL}/user/facebook-connection`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to disconnect Facebook');
    }
    return response.json();
  },

  /**
   * DELETE /user/tiktok-connection — отключение TikTok
   */
  async disconnectTiktok(userId: string) {
    const response = await fetch(`${API_BASE_URL}/user/tiktok-connection`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to disconnect TikTok');
    }
    return response.json();
  },

  /**
   * GET /user/default-settings — загрузка default_ad_settings
   */
  async fetchDefaultSettings(userId: string, campaignGoal?: string, directionId?: string) {
    const params = new URLSearchParams({ userAccountId: userId });
    if (campaignGoal) params.set('campaignGoal', campaignGoal);
    if (directionId) params.set('directionId', directionId);

    const response = await fetch(`${API_BASE_URL}/user/default-settings?${params}`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch default settings');
    }
    return response.json();
  },

  /**
   * PUT /user/default-settings — сохранение default_ad_settings
   */
  async saveDefaultSettings(userId: string, data: Record<string, unknown>) {
    const response = await fetch(`${API_BASE_URL}/user/default-settings`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save default settings');
    }
    return response.json();
  },
};
