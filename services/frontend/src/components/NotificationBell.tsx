/**
 * Notification Bell Component
 *
 * Колокольчик с количеством непрочитанных уведомлений
 * и выпадающим списком уведомлений
 *
 * @module components/NotificationBell
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bell, Check, CheckCheck, Trash2, ChevronRight, Brain } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { API_BASE_URL } from '@/config/api';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useBrainProposalsContextOptional } from '@/contexts/BrainProposalsContext';

// =====================================================
// Types
// =====================================================

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  telegram_sent: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

// =====================================================
// Type Icons & Colors
// =====================================================

const TYPE_COLORS: Record<string, string> = {
  fb_approved: 'bg-green-100 text-green-800 border-green-300',
  fb_rejected: 'bg-red-100 text-red-800 border-red-300',
  stage_changed: 'bg-blue-100 text-blue-800 border-blue-300',
  brain_proposals: 'bg-purple-100 text-purple-800 border-purple-300',
  default: 'bg-gray-100 text-gray-800 border-gray-300',
};

// =====================================================
// Main Component
// =====================================================

const NotificationBell: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  // Brain proposals context для открытия модалки
  const brainProposals = useBrainProposalsContextOptional();

  // Get current user ID
  const getUserId = useCallback(() => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      return user.id;
    } catch {
      return null;
    }
  }, []);

  // Fetch unread count
  const fetchUnreadCount = useCallback(async () => {
    const userId = getUserId();
    if (!userId) return;

    try {
      const res = await fetch(`${API_BASE_URL}/notifications/unread-count`, {
        headers: { 'x-user-id': userId },
      });
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (error) {
      console.error('Failed to fetch unread count:', error);
    }
  }, [getUserId]);

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    const userId = getUserId();
    if (!userId) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/notifications?limit=20`, {
        headers: { 'x-user-id': userId },
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      setLoading(false);
    }
  }, [getUserId]);

  // Mark as read
  const markAsRead = async (id: string) => {
    const userId = getUserId();
    if (!userId) return;

    try {
      await fetch(`${API_BASE_URL}/notifications/${id}/read`, {
        method: 'PATCH',
        headers: { 'x-user-id': userId },
      });

      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  // Mark all as read
  const markAllAsRead = async () => {
    const userId = getUserId();
    if (!userId) return;

    try {
      await fetch(`${API_BASE_URL}/notifications/mark-all-read`, {
        method: 'POST',
        headers: { 'x-user-id': userId },
      });

      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  // Delete notification
  const deleteNotification = async (id: string) => {
    const userId = getUserId();
    if (!userId) return;

    try {
      await fetch(`${API_BASE_URL}/notifications/${id}`, {
        method: 'DELETE',
        headers: { 'x-user-id': userId },
      });

      const wasUnread = notifications.find((n) => n.id === id && !n.is_read);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      if (wasUnread) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error('Failed to delete notification:', error);
    }
  };

  // Handle notification click
  const handleNotificationClick = (notification: Notification) => {
    // Mark as read first
    if (!notification.is_read) {
      markAsRead(notification.id);
    }

    // Handle brain_proposals type
    if (notification.type === 'brain_proposals' && brainProposals) {
      const proposalId = (notification.metadata as { proposal_id?: string })?.proposal_id;
      if (proposalId) {
        setOpen(false); // Close popover
        brainProposals.openModal(proposalId);
      }
    }
  };

  // Initial fetch and polling
  useEffect(() => {
    fetchUnreadCount();

    // Poll for new notifications every 30 seconds
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Fetch full list when popover opens
  useEffect(() => {
    if (open) {
      fetchNotifications();
    }
  }, [open, fetchNotifications]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>Уведомления</p>
        </TooltipContent>
      </Tooltip>

      <PopoverContent className="w-[calc(100vw-2rem)] sm:w-80 p-0" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h4 className="font-semibold">Уведомления</h4>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={markAllAsRead}
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              Прочитать все
            </Button>
          )}
        </div>

        <ScrollArea className="h-[300px]">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">Нет уведомлений</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => {
                const isClickable = notification.type === 'brain_proposals';
                const isBrainProposal = notification.type === 'brain_proposals';
                const metadata = notification.metadata || {};
                const paymentUrlRaw = typeof (metadata as any).payment_url === 'string' ? (metadata as any).payment_url : '';
                const paymentUrl = paymentUrlRaw.trim().length > 0 ? paymentUrlRaw.trim() : '';
                const paymentLabel =
                  typeof (metadata as any).payment_label === 'string' && (metadata as any).payment_label
                    ? (metadata as any).payment_label
                    : 'Оплатить';
                return (
                <div
                  key={notification.id}
                  className={cn(
                    'p-3 hover:bg-muted/50 transition-colors relative group',
                    !notification.is_read && 'bg-blue-50/50 dark:bg-blue-950/20',
                    isClickable && 'cursor-pointer',
                    isBrainProposal && 'border-l-2 border-l-purple-500'
                  )}
                  onClick={isClickable ? () => handleNotificationClick(notification) : undefined}
                >
                  <div className="flex items-start gap-3">
                    {isBrainProposal ? (
                      <Brain className="h-4 w-4 mt-0.5 flex-shrink-0 text-purple-500" />
                    ) : (
                      <div
                        className={cn(
                          'w-2 h-2 rounded-full mt-2 flex-shrink-0',
                          notification.is_read ? 'bg-gray-300' : 'bg-blue-500'
                        )}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{notification.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {notification.message}
                      </p>
                      {paymentUrl && (
                        <Button
                          asChild
                          variant="link"
                          size="sm"
                          className="h-auto px-0 text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <a href={paymentUrl} target="_blank" rel="noreferrer">
                            {paymentLabel}
                          </a>
                        </Button>
                      )}
                      {isBrainProposal && (
                        <p className="text-xs text-purple-600 dark:text-purple-400 mt-1 flex items-center gap-1">
                          Нажмите для просмотра
                          <ChevronRight className="h-3 w-3" />
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(notification.created_at), {
                          addSuffix: true,
                          locale: ru,
                        })}
                      </p>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {!notification.is_read && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => {
                            e.stopPropagation();
                            markAsRead(notification.id);
                          }}
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteNotification(notification.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
