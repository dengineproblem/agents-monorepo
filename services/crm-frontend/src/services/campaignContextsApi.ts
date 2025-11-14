/**
 * Campaign Contexts API Service
 * 
 * API для работы с актуальными контекстами (акции, кейсы, новости)
 */

const API_BASE = import.meta.env.VITE_CRM_BACKEND_URL || 'http://localhost:8084';

export interface CampaignContext {
  id: string;
  user_account_id: string;
  type: 'promo' | 'case' | 'content' | 'news';
  title: string;
  content: string;
  goal?: string;
  start_date: string;
  end_date?: string | null;
  target_funnel_stages?: string[];
  target_interest_levels?: ('hot' | 'warm' | 'cold')[];
  priority: number;
  is_active: boolean;
  usage_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface CreateContextInput {
  user_account_id: string;
  type: 'promo' | 'case' | 'content' | 'news';
  title: string;
  content: string;
  goal?: string;
  start_date?: string;
  end_date?: string | null;
  target_funnel_stages?: string[];
  target_interest_levels?: ('hot' | 'warm' | 'cold')[];
  priority?: number;
  is_active?: boolean;
}

export const campaignContextsApi = {
  /**
   * Get all contexts for a user
   */
  getContexts: async (userAccountId: string): Promise<CampaignContext[]> => {
    const response = await fetch(
      `${API_BASE}/contexts?user_account_id=${userAccountId}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch contexts');
    }
    
    return response.json();
  },

  /**
   * Get active contexts (within date range)
   */
  getActiveContexts: async (
    userAccountId: string,
    funnelStage?: string,
    interestLevel?: string
  ): Promise<CampaignContext[]> => {
    let url = `${API_BASE}/contexts/active?user_account_id=${userAccountId}`;
    if (funnelStage) url += `&funnel_stage=${funnelStage}`;
    if (interestLevel) url += `&interest_level=${interestLevel}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch active contexts');
    }
    
    return response.json();
  },

  /**
   * Create a new context
   */
  createContext: async (data: CreateContextInput): Promise<CampaignContext> => {
    const response = await fetch(`${API_BASE}/contexts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    
    if (!response.ok) {
      throw new Error('Failed to create context');
    }
    
    return response.json();
  },

  /**
   * Update a context
   */
  updateContext: async (
    id: string,
    data: Partial<CampaignContext>
  ): Promise<CampaignContext> => {
    const response = await fetch(`${API_BASE}/contexts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    
    if (!response.ok) {
      throw new Error('Failed to update context');
    }
    
    return response.json();
  },

  /**
   * Delete a context
   */
  deleteContext: async (id: string, userAccountId: string): Promise<void> => {
    const response = await fetch(
      `${API_BASE}/contexts/${id}?user_account_id=${userAccountId}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to delete context');
    }
  },

  /**
   * Get context by ID
   */
  getContextById: async (id: string): Promise<CampaignContext> => {
    const response = await fetch(`${API_BASE}/contexts/${id}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch context');
    }
    
    return response.json();
  },
};

