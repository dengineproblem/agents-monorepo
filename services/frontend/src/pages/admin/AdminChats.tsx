/**
 * Admin Chats
 *
 * Чаты с пользователями в стиле WhatsApp с real-time обновлениями
 *
 * @module pages/admin/AdminChats
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Search,
  Send,
  RefreshCw,
  User,
  Circle,
  CheckCheck,
  MessageSquare,
  Mic,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { API_BASE_URL } from '@/config/api';
import { format, formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';

interface ChatUser {
  id: string;
  username: string;
  telegram_id?: string;
  last_message?: string;
  last_message_time?: string;
  unread_count: number;
  is_online: boolean;
}

interface ChatMessage {
  id: string;
  user_account_id: string;
  direction: 'to_user' | 'from_user';
  message: string | null;
  media_type?: 'voice' | 'photo' | 'text';
  media_url?: string;
  media_metadata?: {
    duration?: number;
    file_size?: number;
    width?: number;
    height?: number;
  };
  delivered: boolean;
  read_at: string | null;
  created_at: string;
}

const AdminChats: React.FC = () => {
  const { userId } = useParams();
  const navigate = useNavigate();

  const [users, setUsers] = useState<ChatUser[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedUser, setSelectedUser] = useState<ChatUser | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);


  // Fetch users with messages
  const fetchUsers = useCallback(async () => {
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    try {
      const res = await fetch(`${API_BASE_URL}/admin/chats/users-with-messages`, {
        headers: { 'x-user-id': currentUser.id || '' },
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);

        // If userId from URL, select that user
        if (userId) {
          const user = data.users.find((u: ChatUser) => u.id === userId);
          if (user) {
            setSelectedUser(user);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoadingUsers(false);
    }
  }, [userId]);

  // Fetch messages for selected user
  const fetchMessages = useCallback(async (uId: string) => {
    setLoadingMessages(true);
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    const headers = { 'x-user-id': currentUser.id || '' };
    try {
      const res = await fetch(`${API_BASE_URL}/admin/chats/${uId}?limit=1000`, { headers });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);

        // Mark as read
        await fetch(`${API_BASE_URL}/admin/chats/${uId}/mark-read`, {
          method: 'POST',
          headers,
        });

        // Update unread count in users list
        setUsers((prev) =>
          prev.map((u) => (u.id === uId ? { ...u, unread_count: 0 } : u))
        );
      }
    } catch (err) {
      console.error('Error fetching messages:', err);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Load messages when user selected
  useEffect(() => {
    if (selectedUser) {
      fetchMessages(selectedUser.id);
      navigate(`/admin/chats/${selectedUser.id}`, { replace: true });
    }
  }, [selectedUser, fetchMessages, navigate]);


  // Polling for users list only (every 30 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchUsers();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchUsers]);

  // Send message
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedUser || sending) return;

    setSending(true);
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

    try {
      const res = await fetch(`${API_BASE_URL}/admin/chats/${selectedUser.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id || '',
        },
        body: JSON.stringify({ message: newMessage.trim() }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, data.message]);
        setNewMessage('');
      }
    } catch (err) {
      console.error('Error sending message:', err);
    } finally {
      setSending(false);
    }
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Filter users by search
  const filteredUsers = users.filter(
    (u) =>
      u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.telegram_id?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Sort: unread first, then by last message time
  const sortedUsers = [...filteredUsers].sort((a, b) => {
    if (a.unread_count > 0 && b.unread_count === 0) return -1;
    if (b.unread_count > 0 && a.unread_count === 0) return 1;
    if (a.last_message_time && b.last_message_time) {
      return new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime();
    }
    return 0;
  });

  return (
    <Tabs defaultValue="user-chats" className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="user-chats">AI-чат</TabsTrigger>
        <TabsTrigger value="moltbot">Техподдержка</TabsTrigger>
      </TabsList>

      <TabsContent value="user-chats" className="mt-0">
        <div className="flex h-[calc(100vh-180px)] border rounded-lg overflow-hidden">
          {/* Users List */}
          <div className="w-80 border-r flex flex-col">
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск пользователя..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {loadingUsers ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : sortedUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">Нет чатов</p>
            </div>
          ) : (
            sortedUsers.map((user) => (
              <div
                key={user.id}
                className={cn(
                  'flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 border-b',
                  selectedUser?.id === user.id && 'bg-muted'
                )}
                onClick={() => setSelectedUser(user)}
              >
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                    <User className="h-5 w-5" />
                  </div>
                  {user.is_online && (
                    <Circle className="absolute bottom-0 right-0 h-3 w-3 fill-green-500 text-green-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-medium truncate">{user.username}</p>
                    {user.last_message_time && (
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(user.last_message_time), {
                          addSuffix: false,
                          locale: ru,
                        })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground truncate">
                      {user.last_message || 'Нет сообщений'}
                    </p>
                    {user.unread_count > 0 && (
                      <Badge className="ml-2">{user.unread_count}</Badge>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </ScrollArea>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {selectedUser ? (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                    <User className="h-5 w-5" />
                  </div>
                  {selectedUser.is_online && (
                    <Circle className="absolute bottom-0 right-0 h-3 w-3 fill-green-500 text-green-500" />
                  )}
                </div>
                <div>
                  <p className="font-medium">{selectedUser.username}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedUser.telegram_id ? `@${selectedUser.telegram_id}` : 'Нет Telegram'}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchMessages(selectedUser.id)}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4">
              {loadingMessages ? (
                <div className="flex items-center justify-center h-full">
                  <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <MessageSquare className="h-12 w-12 mb-2 opacity-50" />
                  <p>Нет сообщений</p>
                  <p className="text-sm">Начните диалог первым</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        'flex flex-col max-w-[70%] rounded-lg p-3',
                        msg.direction === 'to_user'
                          ? 'ml-auto bg-primary text-primary-foreground'
                          : 'mr-auto bg-muted'
                      )}
                    >
                      {/* VOICE MESSAGE */}
                      {msg.media_type === 'voice' && msg.media_url && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm">
                            <Mic className="h-4 w-4" />
                            <span>Голосовое сообщение</span>
                            {msg.media_metadata?.duration && (
                              <span className="text-xs opacity-70">
                                {Math.floor(msg.media_metadata.duration)}с
                              </span>
                            )}
                          </div>
                          <audio controls className="w-full max-w-xs" preload="metadata">
                            <source src={msg.media_url} type="audio/ogg" />
                            Ваш браузер не поддерживает аудио
                          </audio>
                        </div>
                      )}

                      {/* PHOTO MESSAGE */}
                      {msg.media_type === 'photo' && msg.media_url && (
                        <div className="space-y-2">
                          <img
                            src={msg.media_url}
                            alt="Фото от пользователя"
                            className="rounded-lg max-w-sm cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => window.open(msg.media_url, '_blank')}
                            loading="lazy"
                          />
                          {msg.message && (
                            <p className="text-sm whitespace-pre-wrap break-words mt-2">
                              {msg.message}
                            </p>
                          )}
                        </div>
                      )}

                      {/* TEXT MESSAGE */}
                      {(!msg.media_type || msg.media_type === 'text') && msg.message && (
                        <p className="text-sm whitespace-pre-wrap break-words">
                          {msg.message}
                        </p>
                      )}

                      {/* ERROR FALLBACK */}
                      {!msg.message && !msg.media_url && (
                        <p className="text-sm opacity-50 italic">[Медиа не загружено]</p>
                      )}

                      <div
                        className={cn(
                          'flex items-center gap-1 mt-1',
                          msg.direction === 'to_user' ? 'justify-end' : 'justify-start'
                        )}
                      >
                        <span
                          className={cn(
                            'text-xs',
                            msg.direction === 'to_user'
                              ? 'text-primary-foreground/70'
                              : 'text-muted-foreground'
                          )}
                        >
                          {format(new Date(msg.created_at), 'd MMM HH:mm', { locale: ru })}
                        </span>
                        {msg.direction === 'to_user' && msg.delivered && (
                          <CheckCheck
                            className={cn(
                              'h-3 w-3',
                              msg.read_at ? 'text-blue-400' : 'text-primary-foreground/70'
                            )}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-4 border-t flex gap-2">
              <Textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Написать сообщение..."
                disabled={sending || !selectedUser.telegram_id}
                className="resize-none min-h-[60px]"
                rows={2}
              />
              <Button
                onClick={handleSendMessage}
                disabled={!newMessage.trim() || sending || !selectedUser.telegram_id}
                className="self-end"
              >
                {sending ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <MessageSquare className="h-16 w-16 mb-4 opacity-50" />
            <p className="text-lg">Выберите чат</p>
            <p className="text-sm">Выберите пользователя из списка слева</p>
          </div>
        )}
      </div>
        </div>
      </TabsContent>

      <TabsContent value="moltbot" className="mt-0">
        <MoltbotChat />
      </TabsContent>
    </Tabs>
  );
};

// Moltbot Chat Component (Техподдержка)
const MoltbotChat: React.FC = () => {
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedUser, setSelectedUser] = useState<ChatUser | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);

  // Fetch users with messages from support bot
  const fetchUsers = useCallback(async () => {
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    try {
      const res = await fetch(`${API_BASE_URL}/admin/moltbot/users-with-messages`, {
        headers: { 'x-user-id': currentUser.id || '' },
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error('Error fetching support users:', err);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  // Fetch messages for selected user from support bot
  const fetchMessages = useCallback(async (uId: string) => {
    setLoadingMessages(true);
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    const headers = { 'x-user-id': currentUser.id || '' };
    try {
      const res = await fetch(`${API_BASE_URL}/admin/moltbot/chats/${uId}?limit=1000`, { headers });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);

        // Mark as read
        await fetch(`${API_BASE_URL}/admin/moltbot/chats/${uId}/mark-read`, {
          method: 'POST',
          headers,
        });

        // Update unread count in users list
        setUsers((prev) =>
          prev.map((u) => (u.id === uId ? { ...u, unread_count: 0 } : u))
        );
      }
    } catch (err) {
      console.error('Error fetching support messages:', err);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Load messages when user selected
  useEffect(() => {
    if (selectedUser) {
      fetchMessages(selectedUser.id);
    }
  }, [selectedUser, fetchMessages]);

  // Polling for users list (every 30 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchUsers();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchUsers]);

  // Send message to support bot
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedUser || sending) return;

    setSending(true);
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

    try {
      const res = await fetch(`${API_BASE_URL}/admin/moltbot/chats/${selectedUser.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id || '',
        },
        body: JSON.stringify({ message: newMessage.trim() }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, data.message]);
        setNewMessage('');
      }
    } catch (err) {
      console.error('Error sending support message:', err);
    } finally {
      setSending(false);
    }
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Filter users by search
  const filteredUsers = users.filter(
    (u) =>
      u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.telegram_id?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Sort: unread first, then by last message time
  const sortedUsers = [...filteredUsers].sort((a, b) => {
    if (a.unread_count > 0 && b.unread_count === 0) return -1;
    if (b.unread_count > 0 && a.unread_count === 0) return 1;
    if (a.last_message_time && b.last_message_time) {
      return new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime();
    }
    return 0;
  });

  return (
    <div className="flex h-[calc(100vh-180px)] border rounded-lg overflow-hidden">
      {/* Users List */}
      <div className="w-80 border-r flex flex-col">
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск пользователя..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {loadingUsers ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : sortedUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">Нет чатов</p>
            </div>
          ) : (
            sortedUsers.map((user) => (
              <div
                key={user.id}
                className={cn(
                  'flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 border-b',
                  selectedUser?.id === user.id && 'bg-muted'
                )}
                onClick={() => setSelectedUser(user)}
              >
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                    <User className="h-5 w-5" />
                  </div>
                  {user.is_online && (
                    <Circle className="absolute bottom-0 right-0 h-3 w-3 fill-green-500 text-green-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-medium truncate">{user.username}</p>
                    {user.last_message_time && (
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(user.last_message_time), {
                          addSuffix: false,
                          locale: ru,
                        })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground truncate">
                      {user.last_message || 'Нет сообщений'}
                    </p>
                    {user.unread_count > 0 && (
                      <Badge className="ml-2">{user.unread_count}</Badge>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </ScrollArea>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {selectedUser ? (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                    <User className="h-5 w-5" />
                  </div>
                  {selectedUser.is_online && (
                    <Circle className="absolute bottom-0 right-0 h-3 w-3 fill-green-500 text-green-500" />
                  )}
                </div>
                <div>
                  <p className="font-medium">{selectedUser.username}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedUser.telegram_id ? `@${selectedUser.telegram_id}` : 'Нет Telegram'}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchMessages(selectedUser.id)}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4">
              {loadingMessages ? (
                <div className="flex items-center justify-center h-full">
                  <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <MessageSquare className="h-12 w-12 mb-2 opacity-50" />
                  <p>Нет сообщений</p>
                  <p className="text-sm">Начните диалог первым</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        'flex flex-col max-w-[70%] rounded-lg p-3',
                        msg.direction === 'to_user'
                          ? 'ml-auto bg-primary text-primary-foreground'
                          : 'mr-auto bg-muted'
                      )}
                    >
                      {/* VOICE MESSAGE */}
                      {msg.media_type === 'voice' && msg.media_url && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm">
                            <Mic className="h-4 w-4" />
                            <span>Голосовое сообщение</span>
                            {msg.media_metadata?.duration && (
                              <span className="text-xs opacity-70">
                                {Math.floor(msg.media_metadata.duration)}с
                              </span>
                            )}
                          </div>
                          <audio controls className="w-full max-w-xs" preload="metadata">
                            <source src={msg.media_url} type="audio/ogg" />
                            Ваш браузер не поддерживает аудио
                          </audio>
                        </div>
                      )}

                      {/* PHOTO MESSAGE */}
                      {msg.media_type === 'photo' && msg.media_url && (
                        <div className="space-y-2">
                          <img
                            src={msg.media_url}
                            alt="Фото от пользователя"
                            className="rounded-lg max-w-sm cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => window.open(msg.media_url, '_blank')}
                            loading="lazy"
                          />
                          {msg.message && (
                            <p className="text-sm whitespace-pre-wrap break-words mt-2">
                              {msg.message}
                            </p>
                          )}
                        </div>
                      )}

                      {/* TEXT MESSAGE */}
                      {(!msg.media_type || msg.media_type === 'text') && msg.message && (
                        <p className="text-sm whitespace-pre-wrap break-words">
                          {msg.message}
                        </p>
                      )}

                      {/* ERROR FALLBACK */}
                      {!msg.message && !msg.media_url && (
                        <p className="text-sm opacity-50 italic">[Медиа не загружено]</p>
                      )}

                      <div
                        className={cn(
                          'flex items-center gap-1 mt-1',
                          msg.direction === 'to_user' ? 'justify-end' : 'justify-start'
                        )}
                      >
                        <span
                          className={cn(
                            'text-xs',
                            msg.direction === 'to_user'
                              ? 'text-primary-foreground/70'
                              : 'text-muted-foreground'
                          )}
                        >
                          {format(new Date(msg.created_at), 'd MMM HH:mm', { locale: ru })}
                        </span>
                        {msg.direction === 'to_user' && msg.delivered && (
                          <CheckCheck
                            className={cn(
                              'h-3 w-3',
                              msg.read_at ? 'text-blue-400' : 'text-primary-foreground/70'
                            )}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-4 border-t flex gap-2">
              <Textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Написать сообщение..."
                disabled={sending || !selectedUser.telegram_id}
                className="resize-none min-h-[60px]"
                rows={2}
              />
              <Button
                onClick={handleSendMessage}
                disabled={!newMessage.trim() || sending || !selectedUser.telegram_id}
                className="self-end"
              >
                {sending ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <MessageSquare className="h-16 w-16 mb-4 opacity-50" />
            <p className="text-lg">Выберите чат</p>
            <p className="text-sm">Выберите пользователя из списка слева</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminChats;
