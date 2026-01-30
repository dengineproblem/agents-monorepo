/**
 * Admin Notifications Dropdown
 *
 * Dropdown с уведомлениями, разделёнными по категориям:
 * - Сообщения (от пользователей)
 * - Регистрации (новые юзеры)
 * - Система (ошибки, достижения)
 *
 * @module components/admin/AdminNotifications
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  MessageSquare,
  UserPlus,
  AlertCircle,
  Check,
  CheckCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import { API_BASE_URL } from '@/config/api';

interface Notification {
  id: string;
  type: 'message' | 'registration' | 'system' | 'error';
  title: string;
  message?: string;
  metadata?: Record<string, any>;
  is_read: boolean;
  created_at: string;
}

interface AdminNotificationsProps {
  unreadCount?: number;
}

const AdminNotifications: React.FC<AdminNotificationsProps> = ({ unreadCount = 0 }) => {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  // Fetch notifications when dropdown opens
  useEffect(() => {
    if (open) {
      fetchNotifications();
    }
  }, [open]);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/notifications?limit=50`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (id: string) => {
    try {
      await fetch(`${API_BASE_URL}/admin/notifications/${id}/read`, {
        method: 'POST',
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  };

  const markAllAsRead = async () => {
    try {
      await fetch(`${API_BASE_URL}/admin/notifications/mark-all-read`, {
        method: 'POST',
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (err) {
      console.error('Error marking all as read:', err);
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    markAsRead(notification.id);

    // Navigate based on type
    switch (notification.type) {
      case 'message':
        if (notification.metadata?.userId) {
          navigate(`/admin/chats/${notification.metadata.userId}`);
        } else {
          navigate('/admin/chats');
        }
        break;
      case 'registration':
        if (notification.metadata?.userId) {
          navigate(`/admin/users/${notification.metadata.userId}`);
        } else {
          navigate('/admin/users');
        }
        break;
      case 'error':
        if (notification.metadata?.errorId) {
          navigate(`/admin/errors?id=${notification.metadata.errorId}`);
        } else {
          navigate('/admin/errors');
        }
        break;
      case 'system':
        // System notifications might have different targets
        if (notification.metadata?.link) {
          navigate(notification.metadata.link);
        }
        break;
    }

    setOpen(false);
  };

  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'message':
        return <MessageSquare className="h-4 w-4 text-blue-500" />;
      case 'registration':
        return <UserPlus className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      case 'system':
        return <Bell className="h-4 w-4 text-yellow-500" />;
      default:
        return <Bell className="h-4 w-4" />;
    }
  };

  const filterByType = (type: string) => {
    if (type === 'all') return notifications;
    return notifications.filter((n) => n.type === type);
  };

  const getUnreadCount = (type: string) => {
    const filtered = type === 'all' ? notifications : notifications.filter((n) => n.type === type);
    return filtered.filter((n) => !n.is_read).length;
  };

  const renderNotificationList = (items: Notification[]) => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <Bell className="h-8 w-8 mb-2 opacity-50" />
          <p className="text-sm">Нет уведомлений</p>
        </div>
      );
    }

    return (
      <div className="space-y-1">
        {items.map((notification) => (
          <button
            key={notification.id}
            className={cn(
              'w-full text-left p-3 rounded-lg transition-colors hover:bg-muted/50',
              !notification.is_read && 'bg-muted/30'
            )}
            onClick={() => handleNotificationClick(notification)}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5">{getIcon(notification.type)}</div>
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    'text-sm truncate',
                    !notification.is_read && 'font-medium'
                  )}
                >
                  {notification.title}
                </p>
                {notification.message && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {notification.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDistanceToNow(new Date(notification.created_at), {
                    addSuffix: true,
                    locale: ru,
                  })}
                </p>
              </div>
              {!notification.is_read && (
                <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />
              )}
            </div>
          </button>
        ))}
      </div>
    );
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="default"
              className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1 flex items-center justify-center"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] sm:w-[380px] p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold">Уведомления</h3>
          {notifications.some((n) => !n.is_read) && (
            <Button variant="ghost" size="sm" onClick={markAllAsRead}>
              <CheckCheck className="h-4 w-4 mr-1" />
              Прочитать все
            </Button>
          )}
        </div>

        <Tabs defaultValue="all" className="w-full">
          <TabsList className="w-full justify-start rounded-none border-b bg-transparent h-auto p-0">
            <TabsTrigger
              value="all"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
            >
              Все
              {getUnreadCount('all') > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-5 px-1.5">
                  {getUnreadCount('all')}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="message"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
            >
              <MessageSquare className="h-4 w-4" />
              {getUnreadCount('message') > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-5 px-1.5">
                  {getUnreadCount('message')}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="registration"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
            >
              <UserPlus className="h-4 w-4" />
              {getUnreadCount('registration') > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-5 px-1.5">
                  {getUnreadCount('registration')}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="system"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
            >
              <AlertCircle className="h-4 w-4" />
              {getUnreadCount('system') + getUnreadCount('error') > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-5 px-1.5">
                  {getUnreadCount('system') + getUnreadCount('error')}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[350px]">
            <TabsContent value="all" className="m-0 p-2">
              {renderNotificationList(filterByType('all'))}
            </TabsContent>
            <TabsContent value="message" className="m-0 p-2">
              {renderNotificationList(filterByType('message'))}
            </TabsContent>
            <TabsContent value="registration" className="m-0 p-2">
              {renderNotificationList(filterByType('registration'))}
            </TabsContent>
            <TabsContent value="system" className="m-0 p-2">
              {renderNotificationList([
                ...filterByType('system'),
                ...filterByType('error'),
              ])}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default AdminNotifications;
