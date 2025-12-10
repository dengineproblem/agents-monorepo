import React from 'react';
import { cn } from '@/lib/utils';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import type { TooltipKey } from '@/content/tooltips';

interface PageHeroProps {
  title: string;
  subtitle?: string;
  className?: string;
  rightContent?: React.ReactNode;
  tooltipKey?: TooltipKey;
}

const PageHero: React.FC<PageHeroProps> = ({ title, subtitle, className, rightContent, tooltipKey }) => {
  return (
    <div className={cn('mb-6', className)}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            {title}
            {tooltipKey && <HelpTooltip tooltipKey={tooltipKey} iconSize="md" />}
          </h1>
          {subtitle && <p className="text-muted-foreground mt-2">{subtitle}</p>}
        </div>
        {rightContent && <div>{rightContent}</div>}
      </div>
    </div>
  );
};

export default PageHero;

