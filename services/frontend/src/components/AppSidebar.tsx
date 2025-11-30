import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, TrendingUp, Target, Upload, User, Globe, Users2 } from 'lucide-react';
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
  SidebarRail,
} from '@/components/ui/sidebar';
import { FEATURES } from '../config/appReview';
import { useTranslation } from '../i18n/LanguageContext';
import { Button } from './ui/button';

const menuItems = [
  {
    path: '/',
    label: 'menu.dashboard',
    icon: LayoutDashboard,
    show: true,
  },
  {
    path: '/roi',
    label: 'menu.roi',
    icon: TrendingUp,
    show: FEATURES.SHOW_ROI_ANALYTICS,
  },
  {
    path: '/creatives',
    label: 'menu.creatives',
    icon: Target,
    show: FEATURES.SHOW_CREATIVES,
  },
  {
    path: '/videos',
    label: 'menu.videos',
    icon: Upload,
    show: FEATURES.SHOW_VIDEOS,
  },
  {
    path: '/competitors',
    label: 'menu.competitors',
    icon: Users2,
    show: FEATURES.SHOW_COMPETITORS,
  },
  {
    path: '/profile',
    label: 'menu.profile',
    icon: User,
    show: true,
  },
];

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language, setLanguage } = useTranslation();

  // Фильтруем menuItems по флагу show
  const visibleMenuItems = menuItems.filter(item => item.show);

  return (
    <Sidebar collapsible="icon" className="hidden lg:flex border-r fixed left-0 top-[60px] bottom-0 z-40">
      <SidebarContent className="bg-background">
        <SidebarGroup>
          <SidebarGroupLabel>{t('sidebar.navigation')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleMenuItems.map((item) => {
                const translatedLabel = t(item.label);
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      onClick={() => navigate(item.path)}
                      isActive={location.pathname === item.path}
                      tooltip={translatedLabel}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{translatedLabel}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t p-4 bg-background">
        {FEATURES.SHOW_LANGUAGE_SWITCHER && (
          <div className="flex gap-2 justify-center mb-3">
            <Button
              variant={language === 'ru' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLanguage('ru')}
              className="flex-1"
            >
              RU
            </Button>
            <Button
              variant={language === 'en' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLanguage('en')}
              className="flex-1"
            >
              EN
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground text-center">
          performante.ai v1.0
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

