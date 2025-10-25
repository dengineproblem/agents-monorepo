import React from 'react';
import { useSidebar } from './ui/sidebar';
import { cn } from '@/lib/utils';

interface SidebarAwareContentProps {
  children: React.ReactNode;
}

export const SidebarAwareContent: React.FC<SidebarAwareContentProps> = ({ children }) => {
  const { state } = useSidebar();
  
  return (
    <div 
      className={cn(
        "pb-[64px] lg:pb-0 w-full max-w-full overflow-x-hidden transition-all duration-200",
        state === "expanded" ? "lg:ml-[16rem] lg:w-[calc(100vw-16rem)]" : "lg:ml-[3rem] lg:w-[calc(100vw-3rem)]"
      )}
    >
      {children}
    </div>
  );
};

