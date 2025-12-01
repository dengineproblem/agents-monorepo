/**
 * API для работы с брифингом клиентов
 */

import { API_BASE_URL } from '@/config/api';

export interface BriefingFormData {
  business_name: string;
  business_niche: string;
  instagram_url?: string;
  website_url?: string;
  target_audience?: string;
  geography?: string;
  main_pains?: string;
  main_services?: string;
  competitive_advantages?: string;
  price_segment?: string;
  main_promises?: string;
  social_proof?: string;
  guarantees?: string;
  tone_of_voice?: string;
  competitor_instagrams?: string[]; // До 5 Instagram аккаунтов конкурентов
}

export interface GeneratePromptResponse {
  success: boolean;
  prompt1?: string;
  prompt4?: string;
  message?: string;
  error?: string;
}

export interface GetBriefingResponse {
  success: boolean;
  briefing: (BriefingFormData & { 
    id: string;
    user_id: string;
    created_at: string;
    updated_at: string;
  }) | null;
  error?: string;
}

const getUserId = (): string | null => {
  const stored = localStorage.getItem('user');
  if (!stored) return null;
  try {
    const u = JSON.parse(stored);
    return u?.id || null;
  } catch {
    return null;
  }
};

export const briefingApi = {
  /**
   * Генерация prompt1 на основе ответов брифа
   */
  async generatePrompt(data: BriefingFormData): Promise<GeneratePromptResponse> {
    const userId = getUserId();
    if (!userId) {
      return {
        success: false,
        error: 'Пользователь не авторизован',
      };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/briefing/generate-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          ...data,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Ошибка сервера' }));
        return {
          success: false,
          error: errorData.error || `Ошибка HTTP: ${response.status}`,
        };
      }

      const result = await response.json();
      
      // Обновляем prompt1 и prompt4 в localStorage
      if (result.success && (result.prompt1 || result.prompt4)) {
        const stored = localStorage.getItem('user');
        if (stored) {
          try {
            const user = JSON.parse(stored);
            if (result.prompt1) user.prompt1 = result.prompt1;
            if (result.prompt4) user.prompt4 = result.prompt4;
            localStorage.setItem('user', JSON.stringify(user));
          } catch (e) {
            console.error('Ошибка при обновлении промптов в localStorage:', e);
          }
        }
      }

      return result;
    } catch (error) {
      console.error('Ошибка при генерации промпта:', error);
      return {
        success: false,
        error: 'Не удалось подключиться к серверу',
      };
    }
  },

  /**
   * Получить сохраненные ответы брифа пользователя
   */
  async getBriefing(): Promise<GetBriefingResponse> {
    const userId = getUserId();
    if (!userId) {
      return {
        success: false,
        briefing: null,
        error: 'Пользователь не авторизован',
      };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/briefing/${userId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Ошибка сервера' }));
        return {
          success: false,
          briefing: null,
          error: errorData.error || `Ошибка HTTP: ${response.status}`,
        };
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Ошибка при получении брифа:', error);
      return {
        success: false,
        briefing: null,
        error: 'Не удалось подключиться к серверу',
      };
    }
  },
};

