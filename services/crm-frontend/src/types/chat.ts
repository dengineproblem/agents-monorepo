// Debug информация для AI-ответов
export interface AIDebugInfo {
  // Timing
  totalProcessingMs: number;
  aiLatencyMs: number;
  sendLatencyMs: number;

  // Tokens & Cost
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costCents: number;

  // Tool Calls
  toolCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result: string;
    durationMs: number;
  }>;

  // Context
  iterations: number;
  systemPrompt?: string;
  historyMessagesCount?: number;
}

export interface Chat {
  remoteJid: string;
  contactName: string | null;
  lastMessage: string | null;
  lastMessageTime: number;
  unreadCount: number;
  isFromMe: boolean;
}

export interface ChatMessage {
  id: string;
  text: string | null;
  timestamp: number;
  fromMe: boolean;
  pushName: string | null;
  messageType: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'contact' | 'location' | 'unknown';
  debug?: AIDebugInfo;
}

export interface ChatMessagesResponse {
  success: boolean;
  remoteJid: string;
  contactName: string | null;
  messages: ChatMessage[];
  hasMore: boolean;
}

export interface ChatsListResponse {
  success: boolean;
  chats: Chat[];
}

export interface SendMessageResponse {
  success: boolean;
  messageId?: string;
  key?: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
  error?: string;
}

export interface SearchChatsResponse {
  success: boolean;
  chats: {
    remoteJid: string;
    contactName: string | null;
    lastMessageTime: number;
  }[];
}
