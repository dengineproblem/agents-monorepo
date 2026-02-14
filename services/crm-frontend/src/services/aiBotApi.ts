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

  // ===== WhatsApp Instances =====

  /**
   * Get all WhatsApp instances for a user
   */
  async getWhatsAppInstances(
    userId: string,
    options?: { includeWaba?: boolean }
  ): Promise<{
    success: boolean;
    instances: WhatsAppInstance[];
  }> {
    const params = new URLSearchParams({ userId });
    if (options?.includeWaba) {
      params.set('includeWaba', 'true');
    }

    const response = await fetch(`${API_BASE_URL}/whatsapp-instances?${params.toString()}`);
    if (!response.ok) throw new Error('Failed to fetch instances');
    return response.json();
  },

  /**
   * Link a bot to a WhatsApp instance
   */
  async linkBotToInstance(instanceId: string, botId: string | null): Promise<{
    success: boolean;
    instance: WhatsAppInstance;
  }> {
    const response = await fetch(`${API_BASE_URL}/whatsapp-instances/${instanceId}/link-bot`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botId }),
    });
    if (!response.ok) throw new Error('Failed to link bot to instance');
    return response.json();
  },

  /**
   * Get all WhatsApp instances linked to a specific bot
   */
  async getLinkedInstances(botId: string): Promise<{
    success: boolean;
    instances: LinkedInstance[];
  }> {
    const response = await fetch(`${API_BASE_URL}/ai-bots/${botId}/linked-instances`);
    if (!response.ok) throw new Error('Failed to fetch linked instances');
    return response.json();
  },

  /**
   * Update SendPulse settings for a WABA phone number
   */
  async updateSendPulseSettings(instanceName: string, settings: SendPulseSettings): Promise<{ success: boolean }> {
    const response = await fetch(`${API_BASE_URL}/whatsapp-phone-numbers/${encodeURIComponent(instanceName)}/sendpulse`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!response.ok) throw new Error('Failed to update SendPulse settings');
    return response.json();
  },
};

// Types for WhatsApp instances
export interface WhatsAppInstance {
  id: string;
  instanceName: string;
  phoneNumber: string | null;
  status: string;
  connectionType?: 'evolution' | 'waba';
  aiBotId: string | null;
  createdAt: string;
  linkedBot: {
    id: string;
    name: string;
    isActive: boolean;
  } | null;
}

export interface LinkedInstance {
  id: string;
  instanceName: string;
  phoneNumber: string | null;
  status: string;
  connectionType?: 'evolution' | 'waba' | null;
  sendVia?: 'cloud_api' | 'sendpulse';
  sendpulseBotId?: string | null;
  sendpulseClientId?: string | null;
  sendpulseClientSecret?: string | null;
}

export interface SendPulseSettings {
  sendVia: 'cloud_api' | 'sendpulse';
  sendpulseBotId?: string | null;
  sendpulseClientId?: string | null;
  sendpulseClientSecret?: string | null;
}
