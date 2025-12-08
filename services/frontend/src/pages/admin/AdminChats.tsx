/**
 * Admin Chats
 *
 * Чаты с пользователями в стиле WhatsApp с real-time обновлениями
 *
 * @module pages/admin/AdminChats
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Search,
  Send,
  RefreshCw,
  User,
  Circle,
  CheckCheck,
  MessageSquare,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  message: string;
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch users with messages
  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/chats/users-with-messages`);
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
    try {
      const res = await fetch(`${API_BASE_URL}/admin/chats/${uId}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);

        // Mark as read
        await fetch(`${API_BASE_URL}/admin/chats/${uId}/mark-read`, {
          method: 'POST',
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

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // WebSocket connection for real-time updates
  useEffect(() => {
    const wsUrl = API_BASE_URL.replace('http', 'ws').replace('/api', '');

    const connectWebSocket = () => {
      try {
        wsRef.current = new WebSocket(`${wsUrl}/admin/chats/ws`);

        wsRef.current.onopen = () => {
          console.log('WebSocket connected');
        };

        wsRef.current.onmessage = (event) => {
          const data = JSON.parse(event.data);

          if (data.type === 'new_message') {
            // Update messages if from current user
            if (selectedUser && data.message.user_account_id === selectedUser.id) {
              setMessages((prev) => [...prev, data.message]);
            }

            // Update users list
            fetchUsers();
          }
        };

        wsRef.current.onclose = () => {
          console.log('WebSocket disconnected, reconnecting...');
          setTimeout(connectWebSocket, 3000);
        };

        wsRef.current.onerror = (error) => {
          console.error('WebSocket error:', error);
        };
      } catch (err) {
        console.error('WebSocket connection error:', err);
      }
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [selectedUser, fetchUsers]);

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
    <div className="flex h-[calc(100vh-120px)] border rounded-lg overflow-hidden">
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
            <ScrollArea className="flex-1 p-4">
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
                      <p className="text-sm whitespace-pre-wrap break-words">
                        {msg.message}
                      </p>
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
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

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
