import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Trash2, Bot, User, Clock, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isScheduleBlocked?: boolean;
  bufferApplied?: number;
}

interface BotTestChatProps {
  botId: string;
  botName?: string;
}

// Используем Vite proxy для обхода CORS и работы с Docker
// В dev: /api/chatbot → localhost:8083 (через vite proxy)
// В prod: /api/chatbot → nginx proxy → chatbot-service:8083
const CHATBOT_API_PATH = '/api/chatbot';

export function BotTestChat({ botId, botName }: BotTestChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setLoadingStatus('Отправка...');

    try {
      // Prepare conversation history for API
      const conversationHistory = messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      setLoadingStatus('Ожидание буфера сообщений...');

      const response = await fetch(`${CHATBOT_API_PATH}/test-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          botId,
          messageText: userMessage.content,
          conversationHistory,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Если есть массив responses (split_messages), показывать по одному с задержкой
        if (data.responses && data.responses.length > 1) {
          // Скрыть начальный загрузчик перед показом сообщений
          setIsLoading(false);

          for (let i = 0; i < data.responses.length; i++) {
            const content = data.responses[i];

            // Показать индикатор "печатает..." перед каждым сообщением (кроме первого)
            if (i > 0) {
              // Небольшая пауза чтобы предыдущее сообщение отрендерилось
              await new Promise(resolve => setTimeout(resolve, 100));

              setLoadingStatus('Печатает...');
              setIsLoading(true);

              // Задержка 1-2 секунды (имитация набора текста)
              await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));

              // Скрыть индикатор и дать время отрендериться
              setIsLoading(false);
              await new Promise(resolve => setTimeout(resolve, 100));
            }

            const assistantMessage: Message = {
              role: 'assistant',
              content,
              timestamp: new Date(),
              bufferApplied: i === 0 ? data.bufferApplied : undefined,
              isScheduleBlocked: data.scheduleBlocked,
            };
            setMessages((prev) => [...prev, assistantMessage]);
          }
        } else if (data.response) {
          const assistantMessage: Message = {
            role: 'assistant',
            content: data.response,
            timestamp: new Date(),
            bufferApplied: data.bufferApplied,
            isScheduleBlocked: data.scheduleBlocked,
          };
          setMessages((prev) => [...prev, assistantMessage]);
        }
      } else {
        // Show error as assistant message
        const errorMessage: Message = {
          role: 'assistant',
          content: `Ошибка: ${data.error || 'Не удалось получить ответ'}`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      }
    } catch (error: any) {
      const errorMessage: Message = {
        role: 'assistant',
        content: `Ошибка подключения: ${error.message}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
      // Focus back on textarea
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex flex-col h-[500px] border rounded-lg bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          <span className="font-medium">Тест: {botName || 'Бот'}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearChat}
          disabled={messages.length === 0}
        >
          <Trash2 className="w-4 h-4 mr-1" />
          Очистить
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Bot className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-center">
              Напишите сообщение, чтобы протестировать бота
            </p>
            <p className="text-sm text-center mt-2 opacity-75">
              Бот ответит так же, как в WhatsApp, с учётом всех настроек
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div
                key={index}
                className={cn(
                  'flex gap-3',
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                {message.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                )}
                <div
                  className={cn(
                    'max-w-[80%] rounded-lg px-4 py-2',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : message.isScheduleBlocked
                        ? 'bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700'
                        : 'bg-muted'
                  )}
                >
                  {message.isScheduleBlocked && (
                    <div className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400 text-xs mb-1">
                      <AlertTriangle className="w-3 h-3" />
                      <span>Расписание</span>
                    </div>
                  )}
                  <p className="whitespace-pre-wrap break-words">{message.content}</p>
                  <div
                    className={cn(
                      'flex items-center gap-2 text-xs mt-1',
                      message.role === 'user'
                        ? 'text-primary-foreground/70'
                        : 'text-muted-foreground'
                    )}
                  >
                    <span>{formatTime(message.timestamp)}</span>
                    {message.bufferApplied && message.bufferApplied > 0 && (
                      <span className="flex items-center gap-0.5">
                        <Clock className="w-3 h-3" />
                        {message.bufferApplied}с
                      </span>
                    )}
                  </div>
                </div>
                {message.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-3 justify-start">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div className="bg-muted rounded-lg px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    {loadingStatus && (
                      <span className="text-sm text-muted-foreground">{loadingStatus}</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t bg-muted/30">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Введите сообщение... (Enter для отправки)"
            className="min-h-[44px] max-h-[120px] resize-none"
            rows={1}
            disabled={isLoading}
          />
          <Button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            size="icon"
            className="h-[44px] w-[44px]"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
