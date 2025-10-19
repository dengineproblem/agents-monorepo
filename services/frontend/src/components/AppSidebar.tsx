import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, TrendingUp, Target, Video, User } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from '@/components/ui/sidebar';
import { FEATURES } from '@/config/appReview';

const menuItems = [
  {
    path: '/',
    label: 'Главная',
    icon: LayoutDashboard,
    show: true,
  },
  {
    path: '/roi',
    label: 'ROI',
    icon: TrendingUp,
    show: FEATURES.SHOW_ANALYTICS,
  },
  {
    path: '/creatives',
    label: 'Креативы',
    icon: Target,
    show: FEATURES.SHOW_CREATIVES,
  },
  {
    path: '/videos',
    label: 'Видео',
    icon: Video,
    show: FEATURES.SHOW_CREATIVES,
  },
  {
    path: '/profile',
    label: 'Личный кабинет',
    icon: User,
    show: true,
  },
];

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Фильтруем только те элементы, которые должны показываться
  const visibleMenuItems = menuItems.filter(item => item.show);

  return (
    <Sidebar collapsible="none" className="hidden lg:flex border-r fixed left-0 top-[60px] bottom-0 z-40">
      <SidebarContent className="bg-background">
        <SidebarGroup>
          <SidebarGroupLabel>Навигация</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleMenuItems.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    onClick={() => navigate(item.path)}
                    isActive={location.pathname === item.path}
                    tooltip={item.label}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t p-4 bg-background">
        <p className="text-xs text-muted-foreground text-center">
          performante.ai v1.0
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}

