import { Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface OptimizeButtonProps {
  onClick: (e: React.MouseEvent) => void;
  isVisible: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Кнопка для запуска Brain Mini оптимизации
 * Отображается при hover на строку аккаунта/кампании
 */
export function OptimizeButton({
  onClick,
  isVisible,
  disabled = false,
  size = 'sm',
  className,
}: OptimizeButtonProps) {
  if (!isVisible) return null;

  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const buttonSize = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              buttonSize,
              'rounded-full transition-all duration-200',
              'hover:bg-primary/10 hover:scale-110',
              'focus-visible:ring-2 focus-visible:ring-primary/50',
              disabled && 'opacity-50 cursor-not-allowed',
              className
            )}
            onClick={onClick}
            disabled={disabled}
          >
            <Brain
              className={cn(
                iconSize,
                'text-primary transition-colors',
                !disabled && 'group-hover:text-primary'
              )}
            />
            <span className="sr-only">Оптимизировать с Brain Mini</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p>Brain Mini оптимизация</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default OptimizeButton;
