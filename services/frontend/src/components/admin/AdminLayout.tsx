/**
 * Admin Layout
 *
 * Главный layout для админ-панели с сайдбаром и хедером.
 * Полностью изолирован от пользовательского интерфейса.
 *
 * @module components/admin/AdminLayout
 */

import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import AdminSidebar from './AdminSidebar';
import AdminHeader from './AdminHeader';
import AdminCommandPalette from './AdminCommandPalette';
import { cn } from '@/lib/utils';
import { API_BASE_URL } from '@/config/api';

const AdminLayout: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Stats for badges
  const [unreadChats, setUnreadChats] = useState(0);
  const [unresolvedErrors, setUnresolvedErrors] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  // Fetch stats for badges
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
        const headers: HeadersInit = currentUser.id
          ? { 'x-user-id': currentUser.id }
          : {};

        // Fetch unread chats count
        const chatsRes = await fetch(`${API_BASE_URL}/admin/chats/unread-count`, { headers });
        if (chatsRes.ok) {
          const data = await chatsRes.json();
          setUnreadChats(data.count || 0);
        }

        // Fetch unresolved errors count
        const errorsRes = await fetch(`${API_BASE_URL}/admin/errors/unresolved-count`, { headers });
        if (errorsRes.ok) {
          const data = await errorsRes.json();
          setUnresolvedErrors(data.count || 0);
        }

        // Fetch unread notifications count
        const notificationsRes = await fetch(`${API_BASE_URL}/admin/notifications/unread-count`, { headers });
        if (notificationsRes.ok) {
          const data = await notificationsRes.json();
          setUnreadNotifications(data.count || 0);
        }
      } catch (err) {

      }
    };

    fetchStats();

    // Refresh stats every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  // Load sidebar state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('adminSidebarCollapsed');
    if (saved !== null) {
      setSidebarCollapsed(saved === 'true');
    }
  }, []);

  const handleSidebarToggle = () => {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    localStorage.setItem('adminSidebarCollapsed', String(newState));
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <AdminHeader
        unreadChats={unreadChats}
        unresolvedErrors={unresolvedErrors}
        unreadNotifications={unreadNotifications}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      />

      {/* Sidebar */}
      <AdminSidebar
        collapsed={sidebarCollapsed}
        onToggle={handleSidebarToggle}
        unreadChats={unreadChats}
        unresolvedErrors={unresolvedErrors}
      />

      {/* Main Content */}
      <main
        className={cn(
          'pt-[60px] min-h-screen transition-all duration-300',
          sidebarCollapsed ? 'pl-16' : 'pl-64'
        )}
      >
        <div className="p-6">
          <Outlet />
        </div>
      </main>

      {/* Command Palette */}
      <AdminCommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
      />
    </div>
  );
};

export default AdminLayout;
