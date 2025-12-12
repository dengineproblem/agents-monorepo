import React, { useEffect, useState, useRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TourStep } from '@/content/onboarding-tour';

interface TourTooltipProps {
  step: TourStep;
  currentStepIndex: number;
  totalSteps: number;
  isVisible: boolean;
  onNext: () => void;
  onPrev?: () => void;
  onSkip: () => void;
}

interface TooltipPosition {
  top: number;
  left: number;
  arrowPosition: 'top' | 'bottom' | 'left' | 'right';
}

export const TourTooltip: React.FC<TourTooltipProps> = ({
  step,
  currentStepIndex,
  totalSteps,
  isVisible,
  onNext,
  onPrev,
  onSkip,
}) => {
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const [shouldRender, setShouldRender] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const positionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isVisible) {
      setShouldRender(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsAnimating(true));
      });
    } else {
      setIsAnimating(false);
      const timer = setTimeout(() => setShouldRender(false), 200);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || !step.selector) {
      setPosition(null);
      return;
    }

    const calculatePosition = () => {
      // Пробуем найти элемент по селектору
      const selectors = step.selector!.split(', ');
      let element: Element | null = null;

      for (const sel of selectors) {
        element = document.querySelector(sel.trim());
        if (element) break;
      }

      const tooltip = tooltipRef.current;

      if (!element || !tooltip) return;

      const elementRect = element.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const padding = 16;

      let top: number;
      let left: number;
      let arrowPosition: 'top' | 'bottom' | 'left' | 'right' = 'left';

      const preferredPosition = step.position || 'right';

      switch (preferredPosition) {
        case 'right':
          top = elementRect.top + elementRect.height / 2 - tooltipRect.height / 2;
          left = elementRect.right + padding;
          arrowPosition = 'left';
          break;
        case 'left':
          top = elementRect.top + elementRect.height / 2 - tooltipRect.height / 2;
          left = elementRect.left - tooltipRect.width - padding;
          arrowPosition = 'right';
          break;
        case 'bottom':
          top = elementRect.bottom + padding;
          left = elementRect.left + elementRect.width / 2 - tooltipRect.width / 2;
          arrowPosition = 'top';
          break;
        case 'top':
          top = elementRect.top - tooltipRect.height - padding;
          left = elementRect.left + elementRect.width / 2 - tooltipRect.width / 2;
          arrowPosition = 'bottom';
          break;
      }

      // Убедимся, что tooltip не выходит за границы экрана
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      if (left < padding) left = padding;
      if (left + tooltipRect.width > windowWidth - padding) {
        left = windowWidth - tooltipRect.width - padding;
      }
      if (top < padding) top = padding;
      if (top + tooltipRect.height > windowHeight - padding) {
        top = windowHeight - tooltipRect.height - padding;
      }

      setPosition({ top, left, arrowPosition });
    };

    // Задержка для корректного расчёта после навигации
    positionTimeoutRef.current = setTimeout(calculatePosition, step.delay ? step.delay + 100 : 200);

    // Повторный расчёт
    const secondCalc = setTimeout(calculatePosition, (step.delay || 200) + 300);

    window.addEventListener('resize', calculatePosition);
    window.addEventListener('scroll', calculatePosition, true);

    return () => {
      if (positionTimeoutRef.current) {
        clearTimeout(positionTimeoutRef.current);
      }
      clearTimeout(secondCalc);
      window.removeEventListener('resize', calculatePosition);
      window.removeEventListener('scroll', calculatePosition, true);
    };
  }, [isVisible, step.selector, step.position, step.delay]);

  const getArrowStyles = (arrowPos: string) => {
    const baseStyles = 'absolute w-3 h-3 bg-card rotate-45 border-border';
    switch (arrowPos) {
      case 'left':
        return `${baseStyles} -left-1.5 top-1/2 -translate-y-1/2 border-l border-b`;
      case 'right':
        return `${baseStyles} -right-1.5 top-1/2 -translate-y-1/2 border-r border-t`;
      case 'top':
        return `${baseStyles} left-1/2 -translate-x-1/2 -top-1.5 border-l border-t`;
      case 'bottom':
        return `${baseStyles} left-1/2 -translate-x-1/2 -bottom-1.5 border-r border-b`;
      default:
        return baseStyles;
    }
  };

  if (!shouldRender) return null;

  // Определяем текст кнопки
  const isLastStep = currentStepIndex >= totalSteps - 1;
  const nextButtonText = step.navigateTo ? 'Перейти' : (isLastStep ? 'Готово' : 'Далее');

  return (
    <div
      ref={tooltipRef}
      className={`fixed z-[10000] w-80 bg-card rounded-xl shadow-2xl border border-border transition-all duration-200 ease-out ${
        isAnimating ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-95'
      }`}
      style={{
        top: position?.top ?? '50%',
        left: position?.left ?? '50%',
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {/* Стрелка */}
      {position && <div className={getArrowStyles(position.arrowPosition)} />}

      {/* Заголовок */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">📍</span>
          <h3 className="font-semibold text-foreground text-sm">{step.title}</h3>
        </div>
        <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
          {currentStepIndex + 1}/{totalSteps}
        </span>
      </div>

      {/* Контент */}
      <div className="px-4 pb-3">
        <p className="text-sm text-muted-foreground leading-relaxed">
          {step.content}
        </p>
      </div>

      {/* Прогресс-бар */}
      <div className="px-4 pb-3">
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${((currentStepIndex + 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      {/* Кнопки */}
      <div className="flex items-center justify-between px-4 pb-4 border-t border-border pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onSkip}
          className="text-muted-foreground hover:text-foreground text-xs"
        >
          <X className="w-3 h-3 mr-1" />
          Пропустить
        </Button>

        <div className="flex items-center gap-2">
          {onPrev && (
            <Button
              variant="outline"
              size="sm"
              onClick={onPrev}
              className="h-8 w-8 p-0"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
          )}
          <Button
            size="sm"
            onClick={onNext}
            className="bg-primary hover:bg-primary/90 text-xs"
          >
            {nextButtonText}
            <ChevronRight className="w-3 h-3 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
};
