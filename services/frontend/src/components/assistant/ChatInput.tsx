import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Send, Loader2, StopCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ModeSelector } from './ModeSelector';
import type { ChatMode } from '@/services/assistantApi';

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  isLoading?: boolean;
  isStreaming?: boolean;
  disabled?: boolean;
}

export function ChatInput({
  onSend,
  onStop,
  mode,
  onModeChange,
  isLoading,
  isStreaming,
  disabled,
}: ChatInputProps) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [message]);

  const handleSubmit = () => {
    // Разрешаем отправку даже во время стриминга — это прервёт текущий запрос
    if (message.trim() && !disabled) {
      onSend(message.trim());
      setMessage('');
    }
  };

  const handleStop = () => {
    onStop?.();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t bg-background p-4">
      {/* Mode selector */}
      <div className="flex justify-center mb-3">
        <ModeSelector mode={mode} onChange={onModeChange} />
      </div>

      {/* Input area */}
      <div className="flex gap-2 items-end">
        <div className="flex-1 relative">
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isStreaming ? "Дополните запрос..." : "Введите сообщение..."}
            className="resize-none min-h-[44px] max-h-[200px] pr-12"
            rows={1}
            disabled={disabled}
          />
        </div>

        {/* Кнопка Stop во время стриминга (если нет текста) */}
        {isStreaming && !message.trim() && onStop ? (
          <Button
            onClick={handleStop}
            variant="destructive"
            size="icon"
            className="flex-shrink-0 h-[44px] w-[44px]"
            title="Остановить генерацию"
          >
            <StopCircle className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={!message.trim() || disabled}
            size="icon"
            className="flex-shrink-0 h-[44px] w-[44px]"
            title={isStreaming ? "Отправить и прервать текущий ответ" : "Отправить"}
          >
            {isLoading && !isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>

      {/* Hint */}
      <p className="text-xs text-muted-foreground text-center mt-2">
        {isStreaming
          ? "Можете дополнить запрос — AI учтёт новое сообщение"
          : "Enter для отправки, Shift+Enter для новой строки"
        }
      </p>
    </div>
  );
}

export default ChatInput;
