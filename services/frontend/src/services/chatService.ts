import { supabase } from '@/integrations/supabase/client';

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

// Получить все уникальные чаты (группируем по chat_id)
export const getChats = async (): Promise<ChatHistory[]> => {
  try {
    const { data, error } = await supabase
      .from('n8n_chat_histories')
      .select('*')
      .order('id', { ascending: false });

    if (error) {
      console.error('Ошибка загрузки сообщений:', error);
      return [];
    }

    if (!data || data.length === 0) {
      console.log('Нет данных в таблице n8n_chat_histories');
      return [];
    }

    // Группируем сообщения по chat_id
    const chatGroups: Record<string, any[]> = {};
    data.forEach(message => {
      if (!chatGroups[message.chat_id]) {
        chatGroups[message.chat_id] = [];
      }
      chatGroups[message.chat_id].push(message);
    });

    // Создаем чаты из групп
    const chats: ChatHistory[] = Object.entries(chatGroups).map(([chatId, messages]) => {
      // Берем последнее сообщение для получения метаданных чата
      const lastMessage = messages[0]; // уже отсортированы по убыванию id
      const messageJson = lastMessage.message_data as any;

      return {
        session_id: chatId,
        client_name: lastMessage.client_name || `Клиент ${chatId}`,
        phone: lastMessage.phone || chatId,
        last_message: messageJson?.content || 'Нет сообщений',
        last_message_time: lastMessage.created_at || null,
        funnel_stage: lastMessage.funnel_stage || 'неопределен',
        source: lastMessage.source || 'неизвестно',
        unread_count: lastMessage.unread_count || 0,
        priority: lastMessage.priority || null,
        conversion_source: undefined, // TODO: добавить позже
        creative_url: undefined // TODO: добавить позже
      };
    });

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
    const { data: messagesData, error } = await supabase
      .from('n8n_chat_histories')
      .select('*')
      .eq('chat_id', sessionId)
      .order('id', { ascending: true });

    if (error) {
      console.error('Ошибка загрузки сообщений:', error);
      return [];
    }

    if (!messagesData || messagesData.length === 0) {
      console.log('Сообщения не найдены для chat_id:', sessionId);
      return [];
    }

    // Преобразуем данные в нужный формат
    const messages: ChatMessage[] = messagesData.map((msg) => {
      const messageJson = msg.message_data as any;
      
      // Определяем отправителя на основе типа сообщения
      let sender: 'client' | 'bot' | 'manager' = 'client';
      if (messageJson.type === 'ai') {
        sender = 'bot';
      } else if (messageJson.type === 'manager') {
        sender = 'manager';
      } else if (messageJson.type === 'human') {
        sender = 'client';
      }

      return {
        id: msg.id.toString(),
        sender,
        message: messageJson.content || 'Сообщение без содержимого',
        timestamp: new Date(msg.created_at || Date.now()).toLocaleTimeString('ru-RU', { 
          hour: '2-digit', 
          minute: '2-digit' 
        })
      };
    });

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
    // Сначала проверяем, есть ли запись в follow_up_simple
    const { data: existingRecord, error: selectError } = await supabase
      .from('follow_up_simple')
      .select('id')
      .eq('chat_id', sessionId)
      .single();

    if (selectError && selectError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Ошибка проверки записи в follow_up_simple:', selectError);
      return false;
    }

    if (existingRecord) {
      // Обновляем существующую запись
      const { error: updateError } = await supabase
        .from('follow_up_simple')
        .update({ 
          message: funnelStage,
          updated_at: new Date().toISOString()
        })
        .eq('chat_id', sessionId);

      if (updateError) {
        console.error('Ошибка обновления статуса в follow_up_simple:', updateError);
        return false;
      }
    } else {
      // Создаем новую запись
      const { error: insertError } = await supabase
        .from('follow_up_simple')
        .insert({
          chat_id: sessionId,
          message: funnelStage,
          follow_up_date: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

      if (insertError) {
        console.error('Ошибка создания записи в follow_up_simple:', insertError);
        return false;
      }
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
    const { data: messagesData, error } = await supabase
      .from('n8n_chat_histories')
      .select('message_data')
      .eq('chat_id', sessionId)
      .order('id', { ascending: false })
      .limit(1);

    if (error || !messagesData || messagesData.length === 0) {
      return null;
    }

    const messageJson = messagesData[0].message_data as any;
    return messageJson.content || null;
  } catch (error) {
    console.error('Ошибка получения последнего сообщения:', error);
    return null;
  }
}; 