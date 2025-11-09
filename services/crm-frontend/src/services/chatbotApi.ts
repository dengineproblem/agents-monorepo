const API_BASE_URL = import.meta.env.VITE_CHATBOT_API_URL || '/api/chatbot';

export const chatbotApi = {
  // Статистика
  async getStats(userId: string) {
    const response = await fetch(`${API_BASE_URL}/stats?userId=${userId}`);
    if (!response.ok) throw new Error('Failed to fetch stats');
    return response.json();
  },
  
  // Конфигурация
  async getConfiguration(userId: string) {
    const response = await fetch(`${API_BASE_URL}/configuration/${userId}`);
    if (!response.ok) throw new Error('Failed to fetch configuration');
    return response.json();
  },
  
  async updateConfiguration(configId: string, data: any) {
    const response = await fetch(`${API_BASE_URL}/configuration/${configId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to update configuration');
    return response.json();
  },
  
  // Документы
  async uploadDocument(file: File, userId: string) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', userId);
    
    const response = await fetch(`${API_BASE_URL}/documents/upload`, {
      method: 'POST',
      body: formData
    });
    if (!response.ok) throw new Error('Failed to upload document');
    return response.json();
  },
  
  async deleteDocument(fileId: string) {
    const response = await fetch(`${API_BASE_URL}/documents/${fileId}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete document');
    return response.json();
  },
  
  // Рассылки
  async getReactivationStatus(userId: string) {
    const response = await fetch(`${API_BASE_URL}/reactivation/status?userId=${userId}`);
    if (!response.ok) throw new Error('Failed to fetch reactivation status');
    return response.json();
  },
  
  async getReactivationQueue(userId: string) {
    const response = await fetch(`${API_BASE_URL}/reactivation/queue?userId=${userId}`);
    if (!response.ok) throw new Error('Failed to fetch reactivation queue');
    return response.json();
  },
  
  async startCampaign(userId: string) {
    const response = await fetch(`${API_BASE_URL}/reactivation/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
    if (!response.ok) throw new Error('Failed to start campaign');
    return response.json();
  },
  
  async cancelCampaign(userId: string) {
    const response = await fetch(`${API_BASE_URL}/reactivation/cancel`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
    if (!response.ok) throw new Error('Failed to cancel campaign');
    return response.json();
  },
  
  // Триггеры
  async getTriggers(userId: string) {
    const response = await fetch(`${API_BASE_URL}/triggers?userId=${userId}`);
    if (!response.ok) throw new Error('Failed to fetch triggers');
    return response.json();
  },
  
  async createTrigger(data: any) {
    const response = await fetch(`${API_BASE_URL}/triggers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to create trigger');
    return response.json();
  },
  
  async updateTrigger(triggerId: string, data: any) {
    const response = await fetch(`${API_BASE_URL}/triggers/${triggerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to update trigger');
    return response.json();
  },
  
  async deleteTrigger(triggerId: string) {
    const response = await fetch(`${API_BASE_URL}/triggers/${triggerId}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete trigger');
    return response.json();
  },

  // Regenerate prompt from documents
  async regeneratePrompt(userId: string) {
    const response = await fetch(`${API_BASE_URL}/regenerate-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
    if (!response.ok) throw new Error('Failed to regenerate prompt');
    return response.json();
  }
};

