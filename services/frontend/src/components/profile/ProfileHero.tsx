import React from 'react';
import { cn } from '@/lib/utils';

interface ProfileHeroProps {
  title?: string;
  subtitle?: string;
  className?: string;
}

const ProfileHero: React.FC<ProfileHeroProps> = ({ title, subtitle, className }) => {
  return (
    <div className={cn('mb-6', className)}>
      {title && <h1 className="text-3xl font-bold tracking-tight">{title}</h1>}
      {subtitle && <p className="text-muted-foreground mt-2">{subtitle}</p>}
    </div>
  );
};

export default ProfileHero;
