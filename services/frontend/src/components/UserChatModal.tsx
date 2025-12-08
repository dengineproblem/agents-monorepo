/**
 * User Chat Modal
 *
 * Модальное окно для чата с пользователем через Telegram
 * - История сообщений (входящие/исходящие)
 * - Отправка новых сообщений
 * - Автопрокрутка к последнему сообщению
 *
 * @module components/UserChatModal
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { API_BASE_URL } from '@/config/api';
import { Send, RefreshCw, MessageSquare, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

// =====================================================
// Types
// =====================================================

interface ChatMessage {
  id: string;
  user_account_id: string;
  direction: 'to_user' | 'from_user';
  message: string;
  admin_id: string | null;
  delivered: boolean;
  read_at: string | null;
  created_at: string;
}

interface UserChatModalProps {
  userId: string;
  username: string;
  isOpen: boolean;
  onClose: () => void;
  onUnreadChange?: (count: number) => void;
}

// =====================================================
// Component
// =====================================================

const UserChatModal: React.FC<UserChatModalProps> = ({
  userId,
  username,
  isOpen,
  onClose,
  onUnreadChange,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasTelegram, setHasTelegram] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Fetch messages
  const fetchMessages = async () => {
    if (!userId) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/admin/chats/${userId}`);

      if (!res.ok) {
        throw new Error('Failed to fetch messages');
      }

      const data = await res.json();
      setMessages(data.messages || []);
      setHasTelegram(data.hasTelegram);

      // Mark as read
      if (data.messages?.some((m: ChatMessage) => m.direction === 'from_user' && !m.read_at)) {
        await fetch(`${API_BASE_URL}/admin/chats/${userId}/mark-read`, {
          method: 'POST',
        });
        onUnreadChange?.(0);
      }
    } catch (err) {
      setError('Не удалось загрузить сообщения');
      console.error('Error fetching messages:', err);
    } finally {
      setLoading(false);
    }
  };

  // Send message
  const sendMessage = async () => {
    if (!newMessage.trim() || sending) return;

    setSending(true);
    setError(null);

    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

    try {
      const res = await fetch(`${API_BASE_URL}/admin/chats/${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id || '',
        },
        body: JSON.stringify({ message: newMessage.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to send message');
      }

      const data = await res.json();

      // Add message to list
      setMessages((prev) => [...prev, data.message]);
      setNewMessage('');

      // Scroll to bottom
      setTimeout(scrollToBottom, 100);
    } catch (err: any) {
      setError(err.message || 'Не удалось отправить сообщение');
      console.error('Error sending message:', err);
    } finally {
      setSending(false);
    }
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Load messages when modal opens
  useEffect(() => {
    if (isOpen && userId) {
      fetchMessages();
    }
  }, [isOpen, userId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Чат с {username}
            {!hasTelegram && (
              <Badge variant="destructive" className="ml-2">
                Нет Telegram
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto min-h-[300px] max-h-[400px] p-4 space-y-3 bg-muted/30 rounded-lg">
          {loading ? (
            <div className="flex justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <MessageSquare className="h-12 w-12 mb-2 opacity-50" />
              <p>Нет сообщений</p>
              <p className="text-xs">Начните диалог первым</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  'flex flex-col max-w-[80%] rounded-lg p-3',
                  msg.direction === 'to_user'
                    ? 'ml-auto bg-primary text-primary-foreground'
                    : 'mr-auto bg-card border'
                )}
              >
                <p className="text-sm whitespace-pre-wrap break-words">{msg.message}</p>
                <span
                  className={cn(
                    'text-xs mt-1',
                    msg.direction === 'to_user'
                      ? 'text-primary-foreground/70'
                      : 'text-muted-foreground'
                  )}
                >
                  {format(new Date(msg.created_at), 'd MMM HH:mm', { locale: ru })}
                </span>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-2 rounded">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {/* Input */}
        <div className="flex gap-2 pt-2">
          <Textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasTelegram ? 'Написать сообщение...' : 'У пользователя нет Telegram'}
            disabled={!hasTelegram || sending}
            className="resize-none min-h-[60px]"
            rows={2}
          />
          <Button
            onClick={sendMessage}
            disabled={!hasTelegram || !newMessage.trim() || sending}
            className="self-end"
          >
            {sending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Refresh button */}
        <div className="flex justify-center pt-2">
          <Button variant="ghost" size="sm" onClick={fetchMessages} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4 mr-1', loading && 'animate-spin')} />
            Обновить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UserChatModal;
