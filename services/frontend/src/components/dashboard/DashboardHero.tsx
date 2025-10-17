import React from 'react';
import { cn } from '@/lib/utils';

interface DashboardHeroProps {
  title?: string;
  subtitle?: string;
  className?: string;
}

const DashboardHero: React.FC<DashboardHeroProps> = ({ title = 'Главная панель', subtitle = 'Управление рекламными кампаниями и аналитика', className }) => {
  return (
    <div className={cn('mb-6', className)}>
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="text-muted-foreground mt-2">{subtitle}</p>}
    </div>
  );
};

export default DashboardHero;

