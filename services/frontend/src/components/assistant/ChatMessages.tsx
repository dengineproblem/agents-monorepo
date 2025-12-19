import { useEffect, useRef } from 'react';
import { Bot, Plus, MessageSquare, ChevronDown } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MessageBubble } from './MessageBubble';
import { StreamingMessage, type StreamingState } from './StreamingMessage';
import type { ChatMessage, Plan, Conversation } from '@/services/assistantApi';
import type { LayerLog } from './DebugLogsModal';

interface ChatMessagesProps {
  messages: ChatMessage[];
  isLoading?: boolean;
  isStreaming?: boolean;
  streamingState?: StreamingState | null;
  onApprove?: (plan: Plan) => void;
  onUIAction?: (action: string, params: Record<string, unknown>) => void;
  // Conversation management
  conversations?: Conversation[];
  activeConversationId?: string;
  onSelectConversation?: (id: string) => void;
  onNewConversation?: () => void;
  // Debug logs
  debugLogsMap?: Map<string, LayerLog[]>;
  showDebugButton?: boolean;
}

export function ChatMessages({
  messages,
  isLoading,
  isStreaming,
  streamingState,
  onApprove,
  onUIAction,
  conversations = [],
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  debugLogsMap,
  showDebugButton,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive or streaming updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, isStreaming, streamingState?.text]);

  const activeConversation = conversations.find(c => c.id === activeConversationId);

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Conversation dropdown - top left */}
      <div className="absolute top-2 left-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 bg-background/80 backdrop-blur-sm">
              <MessageSquare className="h-4 w-4" />
              <span className="max-w-[120px] truncate">
                {activeConversation?.title || 'Новый чат'}
              </span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={onNewConversation} className="gap-2">
              <Plus className="h-4 w-4" />
              Новый чат
            </DropdownMenuItem>
            {conversations.length > 0 && <DropdownMenuSeparator />}
            {conversations.slice(0, 10).map((conversation) => (
              <DropdownMenuItem
                key={conversation.id}
                onClick={() => onSelectConversation?.(conversation.id)}
                className={activeConversationId === conversation.id ? 'bg-accent' : ''}
              >
                <span className="truncate">{conversation.title || 'Новый чат'}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ScrollArea className="flex-1">
        <div className="min-h-full flex flex-col pt-12">
        {messages.length === 0 && !isLoading && !isStreaming ? (
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
                onUIAction={onUIAction}
                debugLogs={debugLogsMap?.get(message.id)}
                showDebugButton={showDebugButton}
              />
            ))}

            {/* Streaming message (real-time response) */}
            {isStreaming && streamingState && (
              <StreamingMessage state={streamingState} />
            )}

            {/* Fallback typing indicator (if not streaming but loading) */}
            {isLoading && !isStreaming && (
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
    </div>
  );
}

export default ChatMessages;
