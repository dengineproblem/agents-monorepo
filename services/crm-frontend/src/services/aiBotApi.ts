import type {
  AIBotConfiguration,
  AIBotFunction,
  CreateBotRequest,
  UpdateBotRequest,
  CreateFunctionRequest,
  UpdateFunctionRequest,
} from '@/types/aiBot';

const API_BASE_URL = '/api/crm';

export const aiBotApi = {
  // ===== Bots CRUD =====

  /**
   * Get all bots for a user
   */
  async getBots(userId: string): Promise<{ success: boolean; bots: AIBotConfiguration[] }> {
    const response = await fetch(`${API_BASE_URL}/ai-bots?userId=${userId}`);
    if (!response.ok) throw new Error('Failed to fetch bots');
    return response.json();
  },

  /**
   * Get a specific bot by ID
   */
  async getBot(botId: string): Promise<{
    success: boolean;
    bot: AIBotConfiguration;
    functions: AIBotFunction[];
  }> {
    const response = await fetch(`${API_BASE_URL}/ai-bots/${botId}`);
    if (!response.ok) throw new Error('Failed to fetch bot');
    return response.json();
  },

  /**
   * Create a new bot
   */
  async createBot(data: CreateBotRequest): Promise<{ success: boolean; bot: AIBotConfiguration }> {
    const response = await fetch(`${API_BASE_URL}/ai-bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create bot');
    return response.json();
  },

  /**
   * Update a bot
   */
  async updateBot(botId: string, data: UpdateBotRequest): Promise<{ success: boolean; bot: AIBotConfiguration }> {
    const response = await fetch(`${API_BASE_URL}/ai-bots/${botId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update bot');
    return response.json();
  },

  /**
   * Delete a bot
   */
  async deleteBot(botId: string): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`${API_BASE_URL}/ai-bots/${botId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete bot');
    return response.json();
  },

  /**
   * Duplicate a bot
   */
  async duplicateBot(botId: string): Promise<{ success: boolean; bot: AIBotConfiguration }> {
    const response = await fetch(`${API_BASE_URL}/ai-bots/${botId}/duplicate`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to duplicate bot');
    return response.json();
  },

  /**
   * Toggle bot active status
   */
  async toggleBot(botId: string): Promise<{ success: boolean; bot: AIBotConfiguration }> {
    const response = await fetch(`${API_BASE_URL}/ai-bots/${botId}/toggle`, {
      method: 'PATCH',
    });
    if (!response.ok) throw new Error('Failed to toggle bot');
    return response.json();
  },

  // ===== Bot Functions CRUD =====

  /**
   * Get all functions for a bot
   */
  async getFunctions(botId: string): Promise<{ success: boolean; functions: AIBotFunction[] }> {
    const response = await fetch(`${API_BASE_URL}/ai-bots/${botId}/functions`);
    if (!response.ok) throw new Error('Failed to fetch functions');
    return response.json();
  },

  /**
   * Create a function for a bot
   */
  async createFunction(botId: string, data: CreateFunctionRequest): Promise<{
    success: boolean;
    function: AIBotFunction;
  }> {
    const response = await fetch(`${API_BASE_URL}/ai-bots/${botId}/functions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create function');
    return response.json();
  },

  /**
   * Update a function
   */
  async updateFunction(botId: string, functionId: string, data: UpdateFunctionRequest): Promise<{
    success: boolean;
    function: AIBotFunction;
  }> {
    const response = await fetch(`${API_BASE_URL}/ai-bots/${botId}/functions/${functionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update function');
    return response.json();
  },

  /**
   * Delete a function
   */
  async deleteFunction(botId: string, functionId: string): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`${API_BASE_URL}/ai-bots/${botId}/functions/${functionId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete function');
    return response.json();
  },
};
