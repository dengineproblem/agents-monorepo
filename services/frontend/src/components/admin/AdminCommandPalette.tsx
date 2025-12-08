/**
 * Admin Command Palette
 *
 * Глобальный поиск по админке (Cmd+K)
 * Позволяет быстро переходить между разделами и искать пользователей
 *
 * @module components/admin/AdminCommandPalette
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Kanban,
  BarChart3,
  Target,
  AlertTriangle,
  Settings,
  Search,
  User,
} from 'lucide-react';
import { API_BASE_URL } from '@/config/api';

interface AdminCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SearchResult {
  id: string;
  type: 'user' | 'page';
  title: string;
  subtitle?: string;
  path: string;
}

const pages = [
  { title: 'Дашборд', icon: LayoutDashboard, path: '/admin' },
  { title: 'Чаты', icon: MessageSquare, path: '/admin/chats' },
  { title: 'Пользователи', icon: Users, path: '/admin/users' },
  { title: 'Онбординг', icon: Kanban, path: '/admin/onboarding' },
  { title: 'Реклама', icon: BarChart3, path: '/admin/ads' },
  { title: 'Лиды', icon: Target, path: '/admin/leads' },
  { title: 'Ошибки', icon: AlertTriangle, path: '/admin/errors' },
  { title: 'Настройки', icon: Settings, path: '/admin/settings' },
];

const AdminCommandPalette: React.FC<AdminCommandPaletteProps> = ({
  open,
  onOpenChange,
}) => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Debounced user search
  useEffect(() => {
    if (!search || search.length < 2) {
      setUsers([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE_URL}/admin/users/search?q=${encodeURIComponent(search)}&limit=5`
        );
        if (res.ok) {
          const data = await res.json();
          setUsers(
            (data.users || []).map((user: any) => ({
              id: user.id,
              type: 'user',
              title: user.username || user.email || 'Без имени',
              subtitle: user.telegram_id ? `@${user.telegram_id}` : user.email,
              path: `/admin/users/${user.id}`,
            }))
          );
        }
      } catch (err) {
        console.error('Error searching users:', err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  const handleSelect = useCallback(
    (path: string) => {
      navigate(path);
      onOpenChange(false);
      setSearch('');
    },
    [navigate, onOpenChange]
  );

  // Filter pages by search
  const filteredPages = pages.filter((page) =>
    page.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Поиск по админке..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>
          {loading ? 'Поиск...' : 'Ничего не найдено'}
        </CommandEmpty>

        {/* Pages */}
        {filteredPages.length > 0 && (
          <CommandGroup heading="Разделы">
            {filteredPages.map((page) => (
              <CommandItem
                key={page.path}
                value={page.title}
                onSelect={() => handleSelect(page.path)}
              >
                <page.icon className="mr-2 h-4 w-4" />
                {page.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Users */}
        {users.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Пользователи">
              {users.map((user) => (
                <CommandItem
                  key={user.id}
                  value={`user-${user.id}`}
                  onSelect={() => handleSelect(user.path)}
                >
                  <User className="mr-2 h-4 w-4" />
                  <div className="flex flex-col">
                    <span>{user.title}</span>
                    {user.subtitle && (
                      <span className="text-xs text-muted-foreground">
                        {user.subtitle}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Quick Actions */}
        {!search && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Быстрые действия">
              <CommandItem
                value="search-users"
                onSelect={() => {
                  setSearch('');
                  handleSelect('/admin/users');
                }}
              >
                <Search className="mr-2 h-4 w-4" />
                Найти пользователя
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
};

export default AdminCommandPalette;
