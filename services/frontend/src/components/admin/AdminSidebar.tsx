/**
 * Admin Sidebar
 *
 * Сайдбар для админ-панели с навигацией по разделам
 *
 * @module components/admin/AdminSidebar
 */

import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  CreditCard,
  Kanban,
  BarChart3,
  Target,
  AlertTriangle,
  Settings,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

interface MenuItem {
  path: string;
  label: string;
  icon: React.ElementType;
  badge?: number;
  badgeColor?: 'default' | 'destructive';
}

interface AdminSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  unreadChats?: number;
  unresolvedErrors?: number;
  isMobile?: boolean;
  onNavigate?: () => void;
}

const menuItems: MenuItem[] = [
  {
    path: '/admin',
    label: 'Дашборд',
    icon: LayoutDashboard,
  },
  {
    path: '/admin/chats',
    label: 'Чаты',
    icon: MessageSquare,
  },
  {
    path: '/admin/users',
    label: 'Пользователи',
    icon: Users,
  },
  {
    path: '/admin/subscriptions',
    label: 'Подписки',
    icon: CreditCard,
  },
  {
    path: '/admin/onboarding',
    label: 'Онбординг',
    icon: Kanban,
  },
  {
    path: '/admin/ads',
    label: 'Реклама',
    icon: BarChart3,
  },
  {
    path: '/admin/leads',
    label: 'Лиды',
    icon: Target,
  },
  {
    path: '/admin/errors',
    label: 'Ошибки',
    icon: AlertTriangle,
  },
  {
    path: '/admin/settings',
    label: 'Настройки',
    icon: Settings,
  },
  {
    path: '/admin/ad-insights',
    label: 'Ad Insights',
    icon: TrendingUp,
  },
];

const AdminSidebar: React.FC<AdminSidebarProps> = ({
  collapsed,
  onToggle,
  unreadChats = 0,
  unresolvedErrors = 0,
  isMobile = false,
  onNavigate,
}) => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleNavigate = (path: string) => {
    navigate(path);
    // Закрываем мобильное меню после навигации
    if (isMobile && onNavigate) {
      onNavigate();
    }
  };

  // Добавляем бейджи к пунктам меню
  const itemsWithBadges = menuItems.map((item) => {
    if (item.path === '/admin/chats' && unreadChats > 0) {
      return { ...item, badge: unreadChats };
    }
    if (item.path === '/admin/errors' && unresolvedErrors > 0) {
      return { ...item, badge: unresolvedErrors, badgeColor: 'destructive' as const };
    }
    return item;
  });

  const isActive = (path: string) => {
    if (path === '/admin') {
      return location.pathname === '/admin';
    }
    return location.pathname.startsWith(path);
  };

  return (
    <TooltipProvider>
      <aside
        className={cn(
          'flex flex-col bg-background transition-all duration-300',
          // Для мобильной версии (в Sheet) - без fixed позиционирования
          isMobile ? 'h-full pt-4' : 'fixed left-0 top-[60px] bottom-0 z-40 border-r',
          !isMobile && (collapsed ? 'w-16' : 'w-64')
        )}
      >
        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {itemsWithBadges.map((item) => {
            const active = isActive(item.path);
            const Icon = item.icon;

            const button = (
              <Button
                key={item.path}
                variant={active ? 'secondary' : 'ghost'}
                className={cn(
                  'w-full justify-start gap-3 relative',
                  collapsed && !isMobile && 'justify-center px-2'
                )}
                onClick={() => handleNavigate(item.path)}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                {!collapsed && <span>{item.label}</span>}
                {item.badge && item.badge > 0 && (
                  <span
                    className={cn(
                      'absolute flex items-center justify-center min-w-[18px] h-[18px] px-1 text-xs font-medium rounded-full',
                      collapsed ? 'top-0 right-0' : 'right-2',
                      item.badgeColor === 'destructive'
                        ? 'bg-destructive text-destructive-foreground'
                        : 'bg-primary text-primary-foreground'
                    )}
                  >
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </Button>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.path} delayDuration={0}>
                  <TooltipTrigger asChild>{button}</TooltipTrigger>
                  <TooltipContent side="right">
                    <p>{item.label}</p>
                  </TooltipContent>
                </Tooltip>
              );
            }

            return button;
          })}
        </nav>

        {/* Collapse Toggle - только для десктопа */}
        {!isMobile && (
          <div className="p-2 border-t">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center"
              onClick={onToggle}
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <>
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  <span>Свернуть</span>
                </>
              )}
            </Button>
          </div>
        )}

        {/* Footer */}
        {!collapsed && !isMobile && (
          <div className="p-4 border-t">
            <p className="text-xs text-muted-foreground text-center">
              Admin Panel v1.0
            </p>
          </div>
        )}
      </aside>
    </TooltipProvider>
  );
};

export default AdminSidebar;
