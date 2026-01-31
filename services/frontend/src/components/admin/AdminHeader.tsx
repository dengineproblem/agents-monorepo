/**
 * Admin Header
 *
 * Хедер админ-панели с поиском, уведомлениями и профилем
 *
 * @module components/admin/AdminHeader
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  MessageSquare,
  AlertTriangle,
  Bell,
  Sun,
  Moon,
  LogOut,
  User,
  ExternalLink,
  Command,
  Menu,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import AdminNotifications from './AdminNotifications';

interface AdminHeaderProps {
  unreadChats?: number;
  unresolvedErrors?: number;
  unreadNotifications?: number;
  onOpenCommandPalette?: () => void;
  onOpenMobileSidebar?: () => void;
}

const AdminHeader: React.FC<AdminHeaderProps> = ({
  unreadChats = 0,
  unresolvedErrors = 0,
  unreadNotifications = 0,
  onOpenCommandPalette,
  onOpenMobileSidebar,
}) => {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [user, setUser] = useState<{ username?: string; is_tech_admin?: boolean } | null>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch {
        setUser(null);
      }
    }
  }, []);

  const handleSignOut = () => {
    localStorage.removeItem('user');
    navigate('/login');
  };

  const handleGoToApp = () => {
    navigate('/');
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  // Keyboard shortcut for command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onOpenCommandPalette?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenCommandPalette]);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-[60px] border-b bg-background">
      <div className="flex items-center justify-between h-full px-4">
        {/* Left: Menu button (mobile) + Logo */}
        <div className="flex items-center gap-2">
          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onOpenMobileSidebar}
          >
            <Menu className="h-5 w-5" />
          </Button>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">A</span>
            </div>
            <span className="font-semibold text-lg hidden sm:block">Admin Panel</span>
          </div>
        </div>

        {/* Center: Search */}
        <div className="flex-1 max-w-md mx-4 hidden md:block">
          <Button
            variant="outline"
            className="w-full justify-start text-muted-foreground"
            onClick={onOpenCommandPalette}
          >
            <Search className="h-4 w-4 mr-2" />
            <span>Поиск...</span>
            <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              <Command className="h-3 w-3" />K
            </kbd>
          </Button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          {/* Chats Badge */}
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            onClick={() => navigate('/admin/chats')}
          >
            <MessageSquare className="h-5 w-5" />
            {unreadChats > 0 && (
              <Badge
                variant="default"
                className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1 flex items-center justify-center"
              >
                {unreadChats > 99 ? '99+' : unreadChats}
              </Badge>
            )}
          </Button>

          {/* Errors Badge */}
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            onClick={() => navigate('/admin/errors')}
          >
            <AlertTriangle className={cn('h-5 w-5', unresolvedErrors > 0 && 'text-destructive')} />
            {unresolvedErrors > 0 && (
              <Badge
                variant="destructive"
                className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1 flex items-center justify-center"
              >
                {unresolvedErrors > 99 ? '99+' : unresolvedErrors}
              </Badge>
            )}
          </Button>

          {/* Notifications Dropdown */}
          <AdminNotifications unreadCount={unreadNotifications} />

          {/* Theme Toggle */}
          <Button variant="ghost" size="icon" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </Button>

          {/* Profile Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <User className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium">{user?.username || 'Admin'}</p>
                  <p className="text-xs text-muted-foreground">Техадмин</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleGoToApp}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Перейти в приложение
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                <LogOut className="h-4 w-4 mr-2" />
                Выйти
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};

export default AdminHeader;
