import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  MessageCircle, 
  Search, 
  Filter,
  Clock,
  User,
  Phone,
  Calendar,
  Send,
  Eye,
  RefreshCw,
  ExternalLink,
  Link
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { 
  getChats, 
  getChatMessages, 
  sendMessage, 
  updateChatFunnelStage,
  filterChats,
  groupChatsByFunnelStage,
  type ChatHistory,
  type ChatMessage
} from '@/services/chatService';

const ChatsList: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedChat, setSelectedChat] = useState<ChatHistory | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [chats, setChats] = useState<ChatHistory[]>([]);

  // Загрузка чатов при монтировании компонента
  useEffect(() => {
    loadChats();
  }, []);

  const loadChats = async () => {
    setIsLoadingChats(true);
    try {
      const chatsData = await getChats();
      setChats(chatsData);
      
      if (chatsData.length === 0) {
        toast.info('Пока нет данных о чатах в таблице n8n_chat_histories');
      }
    } catch (error) {

      toast.error('Не удалось загрузить чаты');
    } finally {
      setIsLoadingChats(false);
    }
  };

  // Статусы воронки
  const funnelStages = {
    'новый_лид': { label: 'Новый лид', color: 'bg-blue-500' },
    'заинтересован': { label: 'Заинтересован', color: 'bg-yellow-500' },
    'запросил_консультацию': { label: 'Запросил консультацию', color: 'bg-orange-500' },
    'записался_на_консультацию': { label: 'Записался', color: 'bg-green-500' },
    'стал_клиентом': { label: 'Стал клиентом', color: 'bg-purple-500' },
    'не_заинтересован': { label: 'Не заинтересован', color: 'bg-red-500' },
    'неопределен': { label: 'Неопределен', color: 'bg-gray-500' }
  };

  // Фильтрация чатов
  const filteredChats = filterChats(chats, searchTerm, statusFilter);

  // Группировка по статусам
  const groupedChats = groupChatsByFunnelStage(filteredChats);

  // Открытие чата
  const openChat = async (chat: ChatHistory) => {
    setSelectedChat(chat);
    setIsLoadingChat(true);
    
    try {
      const messages = await getChatMessages(chat.session_id);
      setChatHistory(messages);
    } catch (error) {

      toast.error('Не удалось загрузить историю чата');
    } finally {
      setIsLoadingChat(false);
    }
  };

  // Отправка сообщения
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedChat) return;

    const tempMessage: ChatMessage = {
      id: Date.now().toString(),
      sender: 'manager',
      message: newMessage,
      timestamp: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    };

    // Добавляем сообщение в UI сразу
    setChatHistory(prev => [...prev, tempMessage]);
    const messageToSend = newMessage;
    setNewMessage('');

    try {
      const success = await sendMessage(selectedChat.session_id, messageToSend);
      if (!success) {
        toast.error('Не удалось отправить сообщение');
        // Убираем сообщение из UI если отправка не удалась
        setChatHistory(prev => prev.filter(msg => msg.id !== tempMessage.id));
      } else {
        toast.success('Сообщение отправлено');
      }
    } catch (error) {

      toast.error('Ошибка отправки сообщения');
      setChatHistory(prev => prev.filter(msg => msg.id !== tempMessage.id));
    }
  };

  // Обновление статуса воронки
  const handleUpdateFunnelStage = async (sessionId: string, newStage: string) => {
    try {
      const success = await updateChatFunnelStage(sessionId, newStage);
      if (success) {
        toast.success('Статус обновлен');
        // Обновляем локальное состояние
        setChats(prev => prev.map(chat => 
          chat.session_id === sessionId 
            ? { ...chat, funnel_stage: newStage }
            : chat
        ));
        if (selectedChat?.session_id === sessionId) {
          setSelectedChat(prev => prev ? { ...prev, funnel_stage: newStage } : null);
        }
      } else {
        toast.error('Не удалось обновить статус');
      }
    } catch (error) {

      toast.error('Ошибка обновления статуса');
    }
  };

  return (
    <div className="space-y-4">
      {/* Фильтры и поиск */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5" />
              Чаты с клиентами
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={loadChats}
              disabled={isLoadingChats}
            >
              <RefreshCw className={`h-4 w-4 ${isLoadingChats ? 'animate-spin' : ''}`} />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск по имени или телефону..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                {Object.entries(funnelStages).map(([key, stage]) => (
                  <SelectItem key={key} value={key}>{stage.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Статистика по статусам */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4">
            {Object.entries(funnelStages).map(([key, stage]) => {
              const count = chats.filter(chat => (chat.funnel_stage || 'неопределен') === key).length;
              return (
                <div key={key} className="text-center p-2 border rounded">
                  <div className={`w-3 h-3 rounded-full ${stage.color} mx-auto mb-1`}></div>
                  <div className="text-xs text-muted-foreground">{stage.label}</div>
                  <div className="font-bold">{count}</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Загрузка */}
      {isLoadingChats && (
        <Card>
          <CardContent className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </CardContent>
        </Card>
      )}

      {/* Сообщение о пустом списке */}
      {!isLoadingChats && chats.length === 0 && (
        <Card>
          <CardContent className="text-center py-8 text-muted-foreground">
            <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Нет данных о чатах в таблице n8n_chat_histories</p>
            <p className="text-sm mt-2">Чаты появятся здесь после того, как n8n начнет записывать данные в Supabase</p>
          </CardContent>
        </Card>
      )}

      {/* Список чатов по группам */}
      {!isLoadingChats && chats.length > 0 && (
        <div className="space-y-4">
          {Object.entries(groupedChats).map(([status, statusChats]) => (
            <Card key={status}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${funnelStages[status as keyof typeof funnelStages]?.color || 'bg-gray-500'}`}></div>
                  {funnelStages[status as keyof typeof funnelStages]?.label || status} ({statusChats.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {statusChats.map((chat) => (
                    <div
                      key={chat.session_id}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                      onClick={() => openChat(chat)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <User className="h-8 w-8 p-1 bg-muted rounded-full" />
                          {(chat.unread_count || 0) > 0 && (
                            <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 text-xs">
                              {chat.unread_count}
                            </Badge>
                          )}
                        </div>
                        <div>
                          <div className="font-medium">{chat.client_name || `Клиент ${chat.session_id}`}</div>
                          <div className="text-sm text-muted-foreground">{chat.phone || chat.session_id}</div>
                          <div className="text-xs text-muted-foreground max-w-xs truncate">
                            {chat.last_message || 'Нет сообщений'}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground mb-1">
                          {chat.last_message_time || 'Неизвестно'}
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {chat.source || 'Неизвестно'}
                        </Badge>
                        {chat.priority === 'high' && (
                          <div className="text-red-500 text-xs mt-1">Высокий приоритет</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Диалог чата */}
      <Dialog open={!!selectedChat} onOpenChange={() => setSelectedChat(null)}>
        <DialogContent className="max-w-7xl max-h-[90vh] p-0">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle className="flex items-center gap-2 justify-between">
              <div className="flex items-center gap-2">
                <User className="h-5 w-5" />
                <div>
                  <div>{selectedChat?.client_name || `Клиент ${selectedChat?.session_id}`}</div>
                  <div className="text-sm text-muted-foreground">{selectedChat?.phone || selectedChat?.session_id}</div>
                </div>
                <Badge className={funnelStages[selectedChat?.funnel_stage as keyof typeof funnelStages]?.color || 'bg-gray-500'}>
                  {funnelStages[selectedChat?.funnel_stage as keyof typeof funnelStages]?.label || selectedChat?.funnel_stage || 'Неопределен'}
                </Badge>
              </div>
              {selectedChat && (
                <Select 
                  value={selectedChat.funnel_stage || 'неопределен'} 
                  onValueChange={(value) => handleUpdateFunnelStage(selectedChat.session_id, value)}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(funnelStages).map(([key, stage]) => (
                      <SelectItem key={key} value={key}>{stage.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </DialogTitle>
          </DialogHeader>
          
          {isLoadingChat ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <div className="flex h-[calc(90vh-120px)] px-6 pb-6 gap-4">
              {/* Карточка клиента */}
              <div className="w-80 flex-shrink-0">
                <Card className="h-full">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Информация о клиенте</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 overflow-y-auto max-h-[calc(90vh-200px)]">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Имя</label>
                      <div className="text-sm mt-1 break-words">
                        {selectedChat?.client_name || `Клиент ${selectedChat?.session_id}`}
                      </div>
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Телефон</label>
                      <div className="text-sm mt-1 break-words">
                        {selectedChat?.phone || selectedChat?.session_id}
                      </div>
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Ниша</label>
                      <div className="text-sm mt-1 break-words">
                        {selectedChat?.source || 'Не указана'}
                      </div>
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Рекламный бюджет</label>
                      <div className="text-sm mt-1">
                        Не указан
                      </div>
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Этап воронки</label>
                      <div className="text-sm mt-1">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs text-white ${funnelStages[selectedChat?.funnel_stage as keyof typeof funnelStages]?.color || 'bg-gray-500'}`}>
                          {funnelStages[selectedChat?.funnel_stage as keyof typeof funnelStages]?.label || selectedChat?.funnel_stage || 'Неопределен'}
                        </span>
                      </div>
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Последнее сообщение</label>
                      <div className="text-sm mt-1 text-muted-foreground break-words">
                        {selectedChat?.last_message_time || 'Неизвестно'}
                      </div>
                    </div>
                    
                    {selectedChat?.unread_count && selectedChat.unread_count > 0 && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Непрочитанные</label>
                        <div className="text-sm mt-1">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">
                            {selectedChat.unread_count} сообщений
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {selectedChat?.priority === 'high' && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Приоритет</label>
                        <div className="text-sm mt-1">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-orange-100 text-orange-800">
                            Высокий
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Информация об источнике и креативе */}
                    {(selectedChat?.conversion_source || selectedChat?.creative_url) && (
                      <div className="border-t pt-3 mt-3">
                        <label className="text-sm font-medium text-muted-foreground mb-2 block">Источник конверсии</label>
                        
                        {selectedChat?.conversion_source && (
                          <div className="mb-2">
                            <label className="text-xs text-muted-foreground">Источник:</label>
                            <div className="text-sm mt-1">
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                                {selectedChat.conversion_source}
                              </span>
                            </div>
                          </div>
                        )}
                        
                        {selectedChat?.creative_url && (
                          <div>
                            <label className="text-xs text-muted-foreground">Креатив:</label>
                            <div className="text-sm mt-1">
                              <a 
                                href={selectedChat.creative_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                              >
                                <Link className="h-3 w-3" />
                                Посмотреть креатив
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Чат */}
              <div className="flex-1 min-w-0">
                <Card className="h-full flex flex-col">
                  <CardHeader className="pb-3 flex-shrink-0">
                    <CardTitle className="text-base">История сообщений</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col min-h-0 p-4">
                    {/* История сообщений */}
                    <div className="flex-1 overflow-y-auto space-y-3 p-3 border rounded mb-4 min-h-0">
                      {chatHistory.length === 0 ? (
                        <div className="text-center text-muted-foreground py-8">
                          Нет сообщений в этом чате
                        </div>
                      ) : (
                        chatHistory.map((message) => (
                          <div
                            key={message.id}
                            className={`flex ${message.sender === 'client' ? 'justify-start' : 'justify-end'}`}
                          >
                            <div
                              className={`max-w-[70%] p-3 rounded-lg break-words ${
                                message.sender === 'client'
                                  ? 'bg-muted'
                                  : message.sender === 'bot'
                                  ? 'bg-blue-100 dark:bg-gray-800'
                                  : 'bg-primary text-primary-foreground'
                              }`}
                            >
                              <div className="text-sm">{message.message}</div>
                              <div className="text-xs opacity-70 mt-1">{message.timestamp}</div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Отправка сообщения */}
                    <div className="flex gap-2 flex-shrink-0">
                      <Input
                        placeholder="Введите сообщение..."
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                        className="flex-1"
                      />
                      <Button onClick={handleSendMessage} disabled={!newMessage.trim()} className="flex-shrink-0">
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChatsList; 