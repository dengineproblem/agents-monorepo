import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  Search,
  Send,
  RefreshCw,
  Loader2,
  User,
  Phone,
  AlertCircle,
  WifiOff,
  Bot,
  BotOff
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { chatsService } from '@/services/chatsService';
import { aiBotApi } from '@/services/aiBotApi';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Chat, ChatMessage } from '@/types/chat';

const USER_ID = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';
const POLLING_INTERVAL = 5000; // 5 seconds
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Custom hook for debounced value
 */
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export function ChatsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [selectedInstance, setSelectedInstance] = useState<string>('');
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [messageText, setMessageText] = useState('');

  // Debounce search query
  const debouncedSearchQuery = useDebounce(searchQuery, SEARCH_DEBOUNCE_MS);

  // Fetch WhatsApp instances
  const {
    data: instancesData,
    isLoading: instancesLoading,
    error: instancesError
  } = useQuery({
    queryKey: ['whatsapp-instances', USER_ID],
    queryFn: () => aiBotApi.getWhatsAppInstances(USER_ID),
    staleTime: 60000, // 1 minute
    retry: 2,
  });

  // Auto-select first instance
  useEffect(() => {
    if (instancesData?.instances?.length && !selectedInstance) {
      setSelectedInstance(instancesData.instances[0].instanceName);
    }
  }, [instancesData, selectedInstance]);

  // Fetch chats list with polling
  const {
    data: chatsData,
    isLoading: chatsLoading,
    isFetching: chatsFetching,
    error: chatsError,
    refetch: refetchChats
  } = useQuery({
    queryKey: ['chats', selectedInstance],
    queryFn: () => chatsService.getChats(selectedInstance),
    enabled: !!selectedInstance,
    refetchInterval: POLLING_INTERVAL,
    staleTime: POLLING_INTERVAL - 1000,
    retry: 1,
  });

  // Fetch messages for selected chat with polling
  const {
    data: messagesData,
    isLoading: messagesLoading,
    isFetching: messagesFetching,
    error: messagesError
  } = useQuery({
    queryKey: ['chat-messages', selectedInstance, selectedChat?.remoteJid],
    queryFn: () => chatsService.getMessages(selectedInstance, selectedChat!.remoteJid, { limit: 100 }),
    enabled: !!selectedInstance && !!selectedChat,
    refetchInterval: POLLING_INTERVAL,
    staleTime: POLLING_INTERVAL - 1000,
    retry: 1,
  });

  // Fetch bot status for selected chat
  const {
    data: botStatusData,
    isLoading: botStatusLoading
  } = useQuery({
    queryKey: ['bot-status', selectedInstance, selectedChat?.remoteJid],
    queryFn: () => chatsService.getBotStatus(selectedInstance, selectedChat!.remoteJid),
    enabled: !!selectedInstance && !!selectedChat,
    staleTime: 30000, // 30 seconds
    retry: 1,
  });

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: () =>
      chatsService.sendMessage(selectedInstance, selectedChat!.remoteJid, messageText),
    onSuccess: () => {
      setMessageText('');
      // Immediately refetch messages
      queryClient.invalidateQueries({
        queryKey: ['chat-messages', selectedInstance, selectedChat?.remoteJid],
      });
      // Refetch chats to update last message
      queryClient.invalidateQueries({
        queryKey: ['chats', selectedInstance],
      });
      // Focus input after sending
      inputRef.current?.focus();
    },
    onError: (error: Error) => {
      console.error('[ChatsPage] Send message error:', error);
      toast({
        title: 'Ошибка отправки',
        description: error.message || 'Не удалось отправить сообщение',
        variant: 'destructive',
      });
    },
  });

  // Toggle bot mutation
  const toggleBotMutation = useMutation({
    mutationFn: (paused: boolean) =>
      chatsService.toggleBot(selectedInstance, selectedChat!.remoteJid, paused),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['bot-status', selectedInstance, selectedChat?.remoteJid],
      });
      toast({
        title: data.botPaused ? 'Бот остановлен' : 'Бот запущен',
        description: data.botPaused
          ? 'AI-бот больше не будет отвечать в этом чате'
          : 'AI-бот снова будет отвечать в этом чате',
      });
    },
    onError: (error: Error) => {
      console.error('[ChatsPage] Toggle bot error:', error);
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось изменить статус бота',
        variant: 'destructive',
      });
    },
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesData?.messages?.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messagesData?.messages]);

  // Filter chats by debounced search
  const filteredChats = useMemo(() => {
    const chats = chatsData?.chats || [];
    if (!debouncedSearchQuery) return chats;

    const query = debouncedSearchQuery.toLowerCase();
    return chats.filter(chat => {
      const name = chat.contactName?.toLowerCase() || '';
      const phone = chat.remoteJid.split('@')[0];
      return name.includes(query) || phone.includes(query);
    });
  }, [chatsData?.chats, debouncedSearchQuery]);

  // Group messages by date
  const groupedMessages = useMemo(() => {
    const messages = messagesData?.messages || [];
    const groups: { date: string; messages: ChatMessage[] }[] = [];
    let currentDate = '';

    messages.forEach(msg => {
      const msgDate = formatDate(msg.timestamp);
      if (msgDate !== currentDate) {
        currentDate = msgDate;
        groups.push({ date: msgDate, messages: [msg] });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    });

    return groups;
  }, [messagesData?.messages]);

  const handleSendMessage = useCallback(() => {
    if (!messageText.trim() || !selectedChat || sendMutation.isPending) return;
    sendMutation.mutate();
  }, [messageText, selectedChat, sendMutation]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  const handleChatSelect = useCallback((chat: Chat) => {
    setSelectedChat(chat);
  }, []);

  const handleInstanceChange = useCallback((value: string) => {
    setSelectedInstance(value);
    setSelectedChat(null); // Reset selected chat when instance changes
  }, []);

  // Show error toast for query errors
  useEffect(() => {
    if (chatsError) {
      console.error('[ChatsPage] Chats fetch error:', chatsError);
      toast({
        title: 'Ошибка загрузки чатов',
        description: 'Не удалось загрузить список чатов',
        variant: 'destructive',
      });
    }
  }, [chatsError, toast]);

  useEffect(() => {
    if (messagesError) {
      console.error('[ChatsPage] Messages fetch error:', messagesError);
      toast({
        title: 'Ошибка загрузки сообщений',
        description: 'Не удалось загрузить историю сообщений',
        variant: 'destructive',
      });
    }
  }, [messagesError, toast]);

  // Loading state
  if (instancesLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error state for instances
  if (instancesError) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <AlertCircle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-xl font-semibold mb-2">Ошибка загрузки</h2>
        <p className="text-muted-foreground text-center mb-4">
          Не удалось загрузить список WhatsApp номеров
        </p>
        <Button onClick={() => window.location.reload()}>
          Обновить страницу
        </Button>
      </div>
    );
  }

  const instances = instancesData?.instances || [];

  // Empty state - no instances
  if (instances.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <MessageSquare className="w-16 h-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Нет подключённых номеров</h2>
        <p className="text-muted-foreground text-center">
          Для просмотра чатов необходимо подключить WhatsApp номер
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquare className="w-6 h-6" />
          Чаты
          {(chatsFetching || messagesFetching) && !chatsLoading && !messagesLoading && (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          )}
        </h1>
        <div className="flex items-center gap-3">
          <Select value={selectedInstance} onValueChange={handleInstanceChange}>
            <SelectTrigger className="w-[200px]" aria-label="Выбор WhatsApp номера">
              <SelectValue placeholder="Выберите номер" />
            </SelectTrigger>
            <SelectContent>
              {instances.map(inst => (
                <SelectItem key={inst.id} value={inst.instanceName}>
                  <div className="flex items-center gap-2">
                    <Phone className="w-3 h-3" />
                    {inst.phoneNumber || inst.instanceName}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetchChats()}
            disabled={chatsLoading}
            aria-label="Обновить список чатов"
          >
            <RefreshCw className={`w-4 h-4 ${chatsLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Chats list */}
        <div className="w-80 border-r flex flex-col">
          {/* Search */}
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по имени или номеру..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9"
                aria-label="Поиск чатов"
              />
            </div>
          </div>

          {/* Chats */}
          <ScrollArea className="flex-1">
            {chatsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : chatsError ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <WifiOff className="w-8 h-8 mb-2" />
                <p className="text-sm">Ошибка загрузки</p>
                <Button variant="link" size="sm" onClick={() => refetchChats()}>
                  Повторить
                </Button>
              </div>
            ) : filteredChats.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery ? 'Ничего не найдено' : 'Нет чатов'}
              </div>
            ) : (
              filteredChats.map(chat => (
                <button
                  key={chat.remoteJid}
                  onClick={() => handleChatSelect(chat)}
                  className={`w-full p-3 flex items-start gap-3 hover:bg-accent/50 transition-colors text-left border-b ${
                    selectedChat?.remoteJid === chat.remoteJid ? 'bg-accent' : ''
                  }`}
                  aria-label={`Чат с ${chat.contactName || getPhoneNumber(chat.remoteJid)}`}
                  aria-selected={selectedChat?.remoteJid === chat.remoteJid}
                >
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-primary" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-medium truncate">
                        {getContactDisplayName(chat)}
                      </span>
                      <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                        {formatChatTime(chat.lastMessageTime)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {chat.isFromMe && <span className="text-primary">Вы: </span>}
                      {chat.lastMessage || 'Нет сообщений'}
                    </p>
                  </div>
                </button>
              ))
            )}
          </ScrollArea>
        </div>

        {/* Chat window */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedChat ? (
            <>
              {/* Chat header */}
              <div className="p-4 border-b flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold truncate">
                    {messagesData?.contactName || getContactDisplayName(selectedChat)}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {getPhoneNumber(selectedChat.remoteJid)}
                  </p>
                </div>
                {/* Bot toggle button */}
                {botStatusData?.leadId && (
                  <Button
                    variant={botStatusData.botPaused ? "outline" : "default"}
                    size="sm"
                    onClick={() => toggleBotMutation.mutate(!botStatusData.botPaused)}
                    disabled={toggleBotMutation.isPending || botStatusLoading}
                    className="gap-2"
                    title={botStatusData.botPaused ? 'Запустить бота' : 'Остановить бота'}
                  >
                    {toggleBotMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : botStatusData.botPaused ? (
                      <BotOff className="w-4 h-4" />
                    ) : (
                      <Bot className="w-4 h-4" />
                    )}
                    {botStatusData.botPaused ? 'Бот выкл' : 'Бот вкл'}
                  </Button>
                )}
                {messagesFetching && !messagesLoading && (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                )}
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                {messagesLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : messagesError ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <AlertCircle className="w-12 h-12 mb-2" />
                    <p>Ошибка загрузки сообщений</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {groupedMessages.map((group, groupIdx) => (
                      <div key={groupIdx}>
                        {/* Date separator */}
                        <div className="flex justify-center mb-4">
                          <span className="px-3 py-1 bg-muted rounded-full text-xs text-muted-foreground">
                            {group.date}
                          </span>
                        </div>

                        {/* Messages */}
                        <div className="space-y-2">
                          {group.messages.map(msg => (
                            <div
                              key={msg.id}
                              className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}
                            >
                              <div
                                className={`max-w-[70%] px-3 py-2 rounded-lg ${
                                  msg.fromMe
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted'
                                }`}
                              >
                                <p className="text-sm whitespace-pre-wrap break-words">
                                  {msg.text || `[${msg.messageType}]`}
                                </p>
                                <p
                                  className={`text-[10px] mt-1 text-right ${
                                    msg.fromMe ? 'text-primary-foreground/70' : 'text-muted-foreground'
                                  }`}
                                >
                                  {formatTime(msg.timestamp)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </ScrollArea>

              {/* Input */}
              <div className="p-4 border-t">
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    placeholder="Введите сообщение..."
                    value={messageText}
                    onChange={e => setMessageText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={sendMutation.isPending}
                    className="flex-1"
                    aria-label="Текст сообщения"
                    maxLength={10000}
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={!messageText.trim() || sendMutation.isPending}
                    aria-label="Отправить сообщение"
                  >
                    {sendMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <MessageSquare className="w-16 h-16 mb-4 opacity-50" />
              <p>Выберите чат для просмотра сообщений</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== HELPER FUNCTIONS ====================

function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Сегодня';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Вчера';
  }
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function formatChatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return formatTime(timestamp);
  } else if (diffDays === 1) {
    return 'Вчера';
  } else if (diffDays < 7) {
    return date.toLocaleDateString('ru-RU', { weekday: 'short' });
  }
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function getContactDisplayName(chat: Chat): string {
  if (chat.contactName) return chat.contactName;
  const phone = chat.remoteJid.split('@')[0];
  if (phone.length >= 11) {
    return `+${phone.slice(0, 1)} ${phone.slice(1, 4)} ${phone.slice(4, 7)}-${phone.slice(7, 9)}-${phone.slice(9)}`;
  }
  return `+${phone}`;
}

function getPhoneNumber(remoteJid: string): string {
  const phone = remoteJid.split('@')[0];
  return `+${phone}`;
}
