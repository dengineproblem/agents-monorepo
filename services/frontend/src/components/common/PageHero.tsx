import React from 'react';
import { cn } from '@/lib/utils';

interface PageHeroProps {
  title: string;
  subtitle?: string;
  className?: string;
}

const PageHero: React.FC<PageHeroProps> = ({ title, subtitle, className }) => {
  return (
    <div className={cn('mb-6', className)}>
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="text-muted-foreground mt-2">{subtitle}</p>}
    </div>
  );
};

export default PageHero;

