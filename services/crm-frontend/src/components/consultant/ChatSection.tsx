import { useState, useEffect, useCallback, useRef } from 'react';
import { consultantApi } from '@/services/consultantApi';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface ChatSectionProps {
  leadId: string; // dialog_analysis_id
  clientName?: string;
  clientPhone?: string;
  className?: string;
}

export function ChatSection({ leadId, clientName, clientPhone, className }: ChatSectionProps) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Автоскролл к последнему сообщению
  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      console.log('[ChatSection] Scrolled to bottom');
    }
  }, []);

  // Загрузка сообщений для лида
  const loadMessages = useCallback(async () => {
    // Валидация leadId
    if (!leadId || leadId.trim() === '') {
      console.warn('[ChatSection] loadMessages: Invalid leadId', { leadId });
      return;
    }

    console.log('[ChatSection] Loading messages for leadId:', leadId);

    try {
      setLoadingMessages(true);
      const data = await consultantApi.getMessages(leadId);

      console.log('[ChatSection] Messages loaded:', {
        leadId,
        count: data.messages?.length || 0,
        messages: data.messages
      });

      setMessages(data.messages || []);

      // Автоскролл после загрузки сообщений
      setTimeout(() => scrollToBottom(), 100);
    } catch (error: any) {
      console.error('[ChatSection] Failed to load messages:', {
        leadId,
        error: error.message,
        stack: error.stack
      });

      toast({
        title: 'Ошибка',
        description: 'Не удалось загрузить переписку',
        variant: 'destructive',
      });
    } finally {
      setLoadingMessages(false);
    }
  }, [leadId, toast, scrollToBottom]);

  // Загрузка сообщений при монтировании компонента
  useEffect(() => {
    console.log('[ChatSection] Component mounted/leadId changed:', { leadId, clientName, clientPhone });

    if (leadId && leadId.trim() !== '') {
      loadMessages();
    } else {
      console.warn('[ChatSection] Skipping loadMessages: empty or invalid leadId');
    }

    return () => {
      console.log('[ChatSection] Component unmounting for leadId:', leadId);
    };
  }, [leadId, loadMessages]);

  // Отправить сообщение
  const handleSendMessage = useCallback(async () => {
    const trimmedMessage = newMessage.trim();

    if (!trimmedMessage) {
      console.warn('[ChatSection] handleSendMessage: Empty message');
      return;
    }

    if (!leadId || leadId.trim() === '') {
      console.error('[ChatSection] handleSendMessage: Invalid leadId');
      toast({
        title: 'Ошибка',
        description: 'Невозможно отправить сообщение: отсутствует ID лида',
        variant: 'destructive',
      });
      return;
    }

    console.log('[ChatSection] Sending message:', {
      leadId,
      messageLength: trimmedMessage.length,
      messagePreview: trimmedMessage.substring(0, 50)
    });

    try {
      setSendingMessage(true);
      await consultantApi.sendMessage(leadId, trimmedMessage);

      console.log('[ChatSection] Message sent successfully:', { leadId });

      toast({
        title: 'Успешно',
        description: 'Сообщение отправлено',
      });

      // Обновить список сообщений
      await loadMessages();
      setNewMessage('');
    } catch (error: any) {
      console.error('[ChatSection] Failed to send message:', {
        leadId,
        error: error.message,
        stack: error.stack
      });

      toast({
        title: 'Ошибка',
        description: 'Не удалось отправить сообщение',
        variant: 'destructive',
      });
    } finally {
      setSendingMessage(false);
    }
  }, [leadId, newMessage, toast, loadMessages]);

  // Обработка Enter для отправки (Shift+Enter для новой строки)
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      console.log('[ChatSection] Enter pressed, sending message');
      handleSendMessage();
    }
  }, [handleSendMessage]);

  // Безопасное форматирование даты
  const formatTimestamp = useCallback((timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        console.warn('[ChatSection] Invalid timestamp:', timestamp);
        return 'Неверная дата';
      }
      return format(date, 'HH:mm', { locale: ru });
    } catch (error) {
      console.error('[ChatSection] Error formatting timestamp:', { timestamp, error });
      return 'Ошибка даты';
    }
  }, []);

  return (
    <div className={className}>
      {/* Заголовок (если передано имя или телефон) */}
      {(clientName || clientPhone) && (
        <div className="mb-3">
          <h3 className="text-sm font-semibold">Переписка с клиентом</h3>
          {clientName && (
            <p className="text-xs text-muted-foreground">
              {clientName} {clientPhone && `(${clientPhone})`}
            </p>
          )}
        </div>
      )}

      {/* Список сообщений */}
      <div className="border rounded-lg p-4 space-y-3 h-64 overflow-y-auto">
        {loadingMessages ? (
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto"></div>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            Нет сообщений
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.from_me ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[70%] rounded-lg px-4 py-2 ${
                    msg.from_me
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                  <p className="text-xs mt-1 opacity-70">
                    {formatTimestamp(msg.timestamp)}
                  </p>
                </div>
              </div>
            ))}
            {/* Элемент для автоскролла */}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Форма отправки */}
      <div className="flex gap-2 mt-3">
        <Textarea
          placeholder="Введите сообщение... (Enter для отправки)"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1"
          rows={2}
          disabled={sendingMessage}
        />
        <Button
          onClick={handleSendMessage}
          disabled={sendingMessage || !newMessage.trim()}
        >
          {sendingMessage ? 'Отправка...' : 'Отправить'}
        </Button>
      </div>
    </div>
  );
}
