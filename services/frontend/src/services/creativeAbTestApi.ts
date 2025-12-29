import { API_BASE_URL } from '@/config/api';

export type AbTestItem = {
  id: string;
  user_creative_id: string;
  adset_id: string | null;
  ad_id: string | null;
  budget_cents: number;
  impressions_limit: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  ctr: number | null;
  link_ctr: number | null;
  leads: number;
  spend_cents: number;
  cpm_cents: number | null;
  cpc_cents: number | null;
  cpl_cents: number | null;
  rank: number | null;
  extracted_offer_text: string | null;
  extracted_image_description: string | null;
  creative?: {
    id: string;
    title: string;
    image_url: string | null;
    ocr_text: string | null;
    image_description: string | null;
  };
};

export type AbTest = {
  id: string;
  user_id: string;
  account_id: string | null;
  direction_id: string | null;
  campaign_id: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  total_budget_cents: number;
  impressions_per_creative: number;
  creatives_count: number;
  winner_creative_id: string | null;
  analysis_json: any;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  items?: AbTestItem[];
};

export type AbTestInsight = {
  rank: number;
  content: string;
  metadata: {
    wins?: number;
    tests?: number;
    last_ctr?: number;
    last_cpl_cents?: number;
    last_rank?: number;
    is_winner?: boolean;
  };
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
};

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

const getAccountId = (): string | null => {
  const stored = localStorage.getItem('selectedAdAccountId');
  return stored || null;
};

export type StartAbTestParams = {
  user_account_id: string;
  account_id?: string;
  direction_id: string;
  creative_ids: string[];
  total_budget_cents: number;
};

export type AbTestResult = {
  success: boolean;
  test_id?: string;
  campaign_id?: string;
  items?: Array<{
    id: string;
    user_creative_id: string;
    adset_id: string;
    ad_id: string;
    impressions_limit: number;
  }>;
  error?: string;
  message?: string;
};

export const creativeAbTestApi = {
  /**
   * Запускает A/B тест для выбранных креативов
   */
  async startTest(params: StartAbTestParams): Promise<AbTestResult> {
    const userId = getUserId();

    if (!userId) {
      return { success: false, error: 'User not authenticated' };
    }

    if (params.creative_ids.length < 2 || params.creative_ids.length > 5) {
      return { success: false, error: 'Выберите от 2 до 5 креативов' };
    }

    const response = await fetch(`${API_BASE_URL}/creative-ab-test/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...params,
        user_id: userId
      })
    });

    return response.json();
  },

  /**
   * Получает статус и результаты A/B теста
   */
  async getTest(testId: string): Promise<{
    success: boolean;
    test?: AbTest;
    error?: string;
  }> {
    const userId = getUserId();
    if (!userId) {
      return { success: false, error: 'User not authenticated' };
    }

    const response = await fetch(
      `${API_BASE_URL}/creative-ab-test/${testId}?user_id=${userId}`,
      { method: 'GET' }
    );

    return response.json();
  },

  /**
   * Останавливает A/B тест
   */
  async stopTest(testId: string): Promise<{ success: boolean; error?: string }> {
    const userId = getUserId();
    if (!userId) {
      return { success: false, error: 'User not authenticated' };
    }

    const response = await fetch(
      `${API_BASE_URL}/creative-ab-test/${testId}?user_id=${userId}`,
      { method: 'DELETE' }
    );

    return response.json();
  },

  /**
   * Получает рейтинг инсайтов (офферы и образы)
   */
  async getInsights(category?: 'offer_text' | 'creative_image'): Promise<{
    success: boolean;
    offer_texts?: AbTestInsight[];
    creative_images?: AbTestInsight[];
    error?: string;
  }> {
    const userId = getUserId();
    const accountId = getAccountId();

    if (!userId) {
      return { success: false, error: 'User not authenticated' };
    }

    let url = `${API_BASE_URL}/creative-ab-test/insights?user_id=${userId}`;
    if (accountId) url += `&account_id=${accountId}`;
    if (category) url += `&category=${category}`;

    const response = await fetch(url, { method: 'GET' });
    return response.json();
  },

  /**
   * Получает активные A/B тесты пользователя
   */
  async getActiveTests(): Promise<{
    success: boolean;
    tests?: AbTest[];
    error?: string;
  }> {
    const userId = getUserId();
    if (!userId) {
      return { success: false, tests: [] };
    }

    // Получаем тесты через Supabase напрямую
    const { supabase } = await import('@/integrations/supabase/client');
    const accountId = getAccountId();

    let query = supabase
      .from('creative_ab_tests')
      .select(`
        *,
        items:creative_ab_test_items(
          *,
          creative:user_creatives(id, title, image_url, ocr_text, image_description)
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (accountId) {
      query = query.eq('account_id', accountId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('getActiveTests error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, tests: data as AbTest[] };
  }
};
