import { useEffect, useRef } from 'react';
import { Bot } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage, Plan } from '@/services/assistantApi';

interface ChatMessagesProps {
  messages: ChatMessage[];
  isLoading?: boolean;
  onApprove?: (plan: Plan) => void;
}

export function ChatMessages({ messages, isLoading, onApprove }: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  return (
    <ScrollArea className="flex-1">
      <div className="min-h-full flex flex-col">
        {messages.length === 0 && !isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Bot className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-medium mb-2">AI Ассистент</h3>
            <p className="text-muted-foreground max-w-sm">
              Я могу помочь вам управлять рекламой, просматривать лиды, анализировать диалоги и многое другое.
            </p>
            <div className="mt-6 space-y-2 text-sm text-muted-foreground">
              <p>Попробуйте спросить:</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {[
                  'Покажи расходы за сегодня',
                  'Какие кампании активны?',
                  'Найди горячих лидов',
                  'Остановить неэффективные кампании',
                ].map((suggestion) => (
                  <span
                    key={suggestion}
                    className="px-3 py-1.5 bg-muted rounded-full text-xs cursor-pointer hover:bg-accent transition-colors"
                  >
                    {suggestion}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onApprove={onApprove}
              />
            ))}

            {/* Typing indicator */}
            {isLoading && (
              <div className="flex gap-3 p-4">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

export default ChatMessages;
