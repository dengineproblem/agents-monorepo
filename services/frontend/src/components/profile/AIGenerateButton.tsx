import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { textCreativesApi, type TextCreativeType } from '@/services/textCreativesApi';

interface AIGenerateButtonProps {
  userId: string | null | undefined;
  accountId?: string | null;
  textType: TextCreativeType;
  contextHint?: string;
  onGenerated: (text: string) => void;
  disabled?: boolean;
  label?: string;
  minimalContext?: boolean;
}

export const AIGenerateButton: React.FC<AIGenerateButtonProps> = ({
  userId,
  accountId,
  textType,
  contextHint,
  onGenerated,
  disabled,
  label = 'Сгенерировать AI',
  minimalContext = false,
}) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    if (!userId) {
      toast.error('Необходимо авторизоваться');
      return;
    }
    setIsLoading(true);
    try {
      const response = await textCreativesApi.generate({
        user_id: userId,
        text_type: textType,
        user_prompt: contextHint?.trim() || '',
        account_id: accountId || undefined,
        minimal_context: minimalContext,
      });
      if (response.success && response.text) {
        onGenerated(response.text.trim());
        toast.success('Текст сгенерирован');
      } else {
        toast.error(response.error || 'Не удалось сгенерировать текст');
      }
    } catch (e: any) {
      console.error('[AIGenerateButton] Error:', e);
      toast.error('Ошибка при генерации текста');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={disabled || isLoading}
      className="gap-1.5 h-7 px-2 text-xs"
    >
      {isLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Sparkles className="h-3.5 w-3.5" />
      )}
      {label}
    </Button>
  );
};
