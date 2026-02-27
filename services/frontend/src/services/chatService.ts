import { API_BASE_URL } from '@/config/api';

export interface ChatMessage {
  id: string;
  sender: 'client' | 'bot' | 'manager';
  message: string;
  timestamp: string;
}

export interface ChatHistory {
  session_id: string;
  client_name?: string;
  phone?: string;
  last_message?: string;
  last_message_time?: string;
  funnel_stage?: string;
  source?: string;
  unread_count?: number;
  priority?: string;
  messages?: ChatMessage[];
  conversion_source?: string;
  creative_url?: string;
}

/**
 * Получить user ID из localStorage
 */
function getUserId(): string | null {
  try {
    const user = localStorage.getItem('user');
    if (!user) return null;
    return JSON.parse(user).id;
  } catch {
    return null;
  }
}

// Получить все уникальные чаты (группируем по chat_id)
export const getChats = async (): Promise<ChatHistory[]> => {
  try {
    const userId = getUserId();
    if (!userId) {
      console.error('User ID не найден');
      return [];
    }

    const response = await fetch(`${API_BASE_URL}/chat-history`, {
      headers: { 'x-user-id': userId },
    });

    if (!response.ok) {
      console.error('Ошибка загрузки чатов:', response.statusText);
      return [];
    }

    const result = await response.json();
    const chats: ChatHistory[] = result.chats || [];

    console.log(`Загружено ${chats.length} чатов`);
    return chats;
  } catch (error) {
    console.error('Ошибка при получении чатов:', error);
    return [];
  }
};

// Получить сообщения для конкретного чата
export const getChatMessages = async (sessionId: string): Promise<ChatMessage[]> => {
  try {
    const userId = getUserId();
    if (!userId) {
      console.error('User ID не найден');
      return [];
    }

    const response = await fetch(`${API_BASE_URL}/chat-history/${encodeURIComponent(sessionId)}/messages`, {
      headers: { 'x-user-id': userId },
    });

    if (!response.ok) {
      console.error('Ошибка загрузки сообщений:', response.statusText);
      return [];
    }

    const result = await response.json();
    const messages: ChatMessage[] = (result.messages || []).map((msg: any) => ({
      ...msg,
      timestamp: new Date(msg.timestamp || Date.now()).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    }));

    console.log(`Загружено ${messages.length} сообщений для чата ${sessionId}`);
    return messages;
  } catch (error) {
    console.error('Ошибка при получении сообщений чата:', error);
    return [];
  }
};

// Отправить сообщение через n8n webhook
export const sendMessage = async (sessionId: string, message: string): Promise<boolean> => {
  try {
    const response = await fetch('https://n8n.performanteaiagency.com/webhook/send-manager-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        message: message,
        sender: 'manager'
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return true;
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    return false;
  }
};

// Обновить статус воронки для чата
export const updateChatFunnelStage = async (sessionId: string, funnelStage: string): Promise<boolean> => {
  try {
    const userId = getUserId();
    if (!userId) {
      console.error('User ID не найден');
      return false;
    }

    const response = await fetch(`${API_BASE_URL}/chat-history/${encodeURIComponent(sessionId)}/follow-up`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
      },
      body: JSON.stringify({ message: funnelStage }),
    });

    if (!response.ok) {
      console.error('Ошибка обновления статуса воронки:', response.statusText);
      return false;
    }

    console.log(`Статус воронки обновлен для ${sessionId}: ${funnelStage}`);
    return true;
  } catch (error) {
    console.error('Ошибка при обновлении статуса чата:', error);
    return false;
  }
};

// Фильтрация чатов
export const filterChats = (
  chats: ChatHistory[],
  searchTerm: string,
  statusFilter: string
): ChatHistory[] => {
  return chats.filter(chat => {
    const matchesSearch =
      (chat.client_name?.toLowerCase().includes(searchTerm.toLowerCase()) || false) ||
      (chat.phone?.includes(searchTerm) || false) ||
      (chat.session_id?.includes(searchTerm) || false);

    const matchesStatus = statusFilter === 'all' || chat.funnel_stage === statusFilter;

    return matchesSearch && matchesStatus;
  });
};

// Группировка чатов по статусам воронки
export const groupChatsByFunnelStage = (chats: ChatHistory[]): Record<string, ChatHistory[]> => {
  return chats.reduce((acc, chat) => {
    const stage = chat.funnel_stage || 'неопределен';
    if (!acc[stage]) {
      acc[stage] = [];
    }
    acc[stage].push(chat);
    return acc;
  }, {} as Record<string, ChatHistory[]>);
};

// Получить последнее сообщение для чата
export const getLastMessage = async (sessionId: string): Promise<string | null> => {
  try {
    const userId = getUserId();
    if (!userId) {
      console.error('User ID не найден');
      return null;
    }

    const response = await fetch(`${API_BASE_URL}/chat-history/${encodeURIComponent(sessionId)}/last-message`, {
      headers: { 'x-user-id': userId },
    });

    if (!response.ok) {
      return null;
    }

    const result = await response.json();
    return result.content || null;
  } catch (error) {
    console.error('Ошибка получения последнего сообщения:', error);
    return null;
  }
};
