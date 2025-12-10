import React from 'react';
import { HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';
import { getTooltip, type TooltipKey } from '@/content/tooltips';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface HelpTooltipProps {
  tooltipKey: TooltipKey;
  className?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  iconSize?: 'sm' | 'md';
}

export const HelpTooltip: React.FC<HelpTooltipProps> = ({
  tooltipKey,
  className,
  side = 'top',
  align = 'center',
  iconSize = 'sm',
}) => {
  const tooltip = getTooltip(tooltipKey);

  if (!tooltip) return null;

  const sizeClass = iconSize === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-help',
            className
          )}
          onClick={(e) => e.preventDefault()}
        >
          <HelpCircle className={sizeClass} />
          <span className="sr-only">Справка</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} align={align} className="max-w-[280px]">
        <div className="space-y-1">
          {tooltip.title && (
            <p className="font-medium text-sm">{tooltip.title}</p>
          )}
          <p className="text-sm text-muted-foreground">{tooltip.content}</p>
          {tooltip.learnMoreLink && (
            <Link
              to={tooltip.learnMoreLink}
              className="text-xs text-primary hover:underline block mt-1.5"
            >
              Подробнее →
            </Link>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
