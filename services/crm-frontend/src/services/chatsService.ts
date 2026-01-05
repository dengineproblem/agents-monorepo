import type {
  ChatsListResponse,
  ChatMessagesResponse,
  SendMessageResponse,
  SearchChatsResponse,
} from '@/types/chat';

const API_BASE_URL = '/api/crm';

export const chatsService = {
  /**
   * Get list of all chats (contacts)
   */
  async getChats(instanceName: string): Promise<ChatsListResponse> {
    const response = await fetch(`${API_BASE_URL}/chats?instanceName=${encodeURIComponent(instanceName)}`);
    if (!response.ok) throw new Error('Failed to fetch chats');
    return response.json();
  },

  /**
   * Get message history for a specific chat
   */
  async getMessages(
    instanceName: string,
    remoteJid: string,
    options?: { limit?: number; offset?: number }
  ): Promise<ChatMessagesResponse> {
    const params = new URLSearchParams({
      instanceName,
      ...(options?.limit && { limit: String(options.limit) }),
      ...(options?.offset && { offset: String(options.offset) }),
    });

    const response = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(remoteJid)}/messages?${params}`);
    if (!response.ok) throw new Error('Failed to fetch messages');
    return response.json();
  },

  /**
   * Get message history with AI debug info for bot messages
   */
  async getMessagesWithDebug(
    instanceName: string,
    remoteJid: string,
    options?: { limit?: number; offset?: number }
  ): Promise<ChatMessagesResponse> {
    const params = new URLSearchParams({
      instanceName,
      ...(options?.limit && { limit: String(options.limit) }),
      ...(options?.offset && { offset: String(options.offset) }),
    });

    const response = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(remoteJid)}/messages-with-debug?${params}`);
    if (!response.ok) throw new Error('Failed to fetch messages with debug');
    return response.json();
  },

  /**
   * Send a message to a chat
   */
  async sendMessage(
    instanceName: string,
    remoteJid: string,
    text: string
  ): Promise<SendMessageResponse> {
    const response = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(remoteJid)}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceName, text }),
    });
    if (!response.ok) throw new Error('Failed to send message');
    return response.json();
  },

  /**
   * Search chats by contact name or phone number
   */
  async searchChats(instanceName: string, query: string): Promise<SearchChatsResponse> {
    const params = new URLSearchParams({ instanceName, query });
    const response = await fetch(`${API_BASE_URL}/chats/search?${params}`);
    if (!response.ok) throw new Error('Search failed');
    return response.json();
  },

  /**
   * Get bot status for a chat
   */
  async getBotStatus(instanceName: string, remoteJid: string): Promise<{ leadId: string | null; botPaused: boolean }> {
    const params = new URLSearchParams({ instanceName });
    const response = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(remoteJid)}/bot-status?${params}`);
    if (!response.ok) throw new Error('Failed to get bot status');
    return response.json();
  },

  /**
   * Toggle bot for a chat (pause/resume)
   */
  async toggleBot(instanceName: string, remoteJid: string, paused: boolean): Promise<{ botPaused: boolean }> {
    const response = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(remoteJid)}/toggle-bot`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceName, paused }),
    });
    if (!response.ok) throw new Error('Failed to toggle bot');
    return response.json();
  },
};
