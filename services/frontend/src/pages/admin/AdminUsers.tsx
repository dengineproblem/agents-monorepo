/**
 * Admin Users
 *
 * Таблица всех пользователей с фильтрами и действиями
 *
 * @module pages/admin/AdminUsers
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Filter,
  MoreVertical,
  MessageSquare,
  LogIn,
  Eye,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Settings,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { API_BASE_URL } from '@/config/api';
import { format, formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import UserChatModal from '@/components/UserChatModal';
import UserAccountEditModal from '@/components/admin/UserAccountEditModal';

interface User {
  id: string;
  username: string;
  telegram_id?: string;
  onboarding_stage: string;
  created_at: string;
  last_activity_at?: string;
  directions_count: number;
  creatives_count: number;
  leads_count: number;
}

const ONBOARDING_STAGES = [
  { value: 'all', label: 'Все этапы' },
  { value: 'new', label: 'Новый' },
  { value: 'prompt_filled', label: 'Промпт заполнен' },
  { value: 'fb_pending', label: 'FB ожидает' },
  { value: 'fb_connected', label: 'FB подключен' },
  { value: 'direction_created', label: 'Направление создано' },
  { value: 'campaign_created', label: 'Кампания создана' },
  { value: 'lead_received', label: 'Лид получен' },
  { value: 'inactive', label: 'Неактивен' },
];

const AdminUsers: React.FC = () => {
  const navigate = useNavigate();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Chat modal
  const [chatUser, setChatUser] = useState<{ id: string; username: string } | null>(null);

  // Edit modal
  const [editUserId, setEditUserId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
      });

      if (searchQuery) {
        params.append('search', searchQuery);
      }
      if (stageFilter !== 'all') {
        params.append('stage', stageFilter);
      }

      const res = await fetch(`${API_BASE_URL}/admin/users?${params}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        setTotalPages(data.totalPages || 1);
        setTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, stageFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [searchQuery, stageFilter]);

  const handleImpersonate = async (userId: string) => {
    try {
      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      const res = await fetch(`${API_BASE_URL}/admin/impersonate/${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
      });

      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('originalUser', localStorage.getItem('user') || '');
        localStorage.setItem('user', JSON.stringify(data.user));
        window.location.href = '/';
      }
    } catch (err) {
      console.error('Error impersonating user:', err);
    }
  };

  const getStageColor = (stage: string) => {
    switch (stage) {
      case 'lead_received':
        return 'bg-green-500';
      case 'campaign_created':
        return 'bg-blue-500';
      case 'fb_connected':
        return 'bg-purple-500';
      case 'fb_pending':
        return 'bg-yellow-500';
      case 'inactive':
        return 'bg-gray-500';
      default:
        return 'bg-gray-400';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Пользователи</h1>
        <p className="text-muted-foreground">
          Всего {total} пользователей
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по имени или telegram..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Этап онбординга" />
          </SelectTrigger>
          <SelectContent>
            {ONBOARDING_STAGES.map((stage) => (
              <SelectItem key={stage.value} value={stage.value}>
                {stage.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" onClick={fetchUsers} className="w-full sm:w-auto">
          <RefreshCw className="h-4 w-4 mr-2" />
          Обновить
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Пользователь</TableHead>
              <TableHead>Этап</TableHead>
              <TableHead>Регистрация</TableHead>
              <TableHead>Активность</TableHead>
              <TableHead className="text-center">Направления</TableHead>
              <TableHead className="text-center">Креативы</TableHead>
              <TableHead className="text-center">Лиды</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8">
                  <RefreshCw className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Нет пользователей
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow
                  key={user.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/admin/chats/${user.id}`)}
                >
                  <TableCell>
                    <div>
                      <p className="font-medium">{user.username}</p>
                      <p className="text-xs text-muted-foreground">
                        {user.telegram_id ? `@${user.telegram_id}` : 'Нет контакта'}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="gap-1"
                    >
                      <div className={`w-2 h-2 rounded-full ${getStageColor(user.onboarding_stage)}`} />
                      {user.onboarding_stage}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">
                      {format(new Date(user.created_at), 'd MMM yyyy', { locale: ru })}
                    </p>
                  </TableCell>
                  <TableCell>
                    {user.last_activity_at ? (
                      <p className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(user.last_activity_at), {
                          addSuffix: true,
                          locale: ru,
                        })}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">—</p>
                    )}
                  </TableCell>
                  <TableCell className="text-center">{user.directions_count}</TableCell>
                  <TableCell className="text-center">{user.creatives_count}</TableCell>
                  <TableCell className="text-center">{user.leads_count}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/admin/chats/${user.id}`);
                          }}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Чаты
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setChatUser({ id: user.id, username: user.username });
                          }}
                        >
                          <MessageSquare className="h-4 w-4 mr-2" />
                          Написать
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditUserId(user.id);
                          }}
                        >
                          <Settings className="h-4 w-4 mr-2" />
                          Настройки аккаунта
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleImpersonate(user.id);
                          }}
                        >
                          <LogIn className="h-4 w-4 mr-2" />
                          Войти как пользователь
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Страница {page} из {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Chat Modal */}
      {chatUser && (
        <UserChatModal
          userId={chatUser.id}
          username={chatUser.username}
          isOpen={!!chatUser}
          onClose={() => setChatUser(null)}
        />
      )}

      {/* Edit User Account Modal */}
      {editUserId && (
        <UserAccountEditModal
          open={!!editUserId}
          onOpenChange={(open) => !open && setEditUserId(null)}
          userId={editUserId}
          onSave={fetchUsers}
        />
      )}
    </div>
  );
};

export default AdminUsers;
