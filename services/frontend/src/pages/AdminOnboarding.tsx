/**
 * Admin Onboarding Page
 *
 * Канбан-доска для отслеживания этапов онбординга пользователей:
 * - Визуализация пользователей по этапам
 * - Карточки пользователей с тегами
 * - Кнопка подтверждения FB подключения
 * - Возможность входа под пользователем (impersonation)
 *
 * @module pages/AdminOnboarding
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Header from '../components/Header';
import UserChatModal from '@/components/UserChatModal';
import { API_BASE_URL } from '@/config/api';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Users,
  CheckCircle,
  Clock,
  Search,
  RefreshCw,
  ChevronDown,
  Facebook,
  Play,
  FileText,
  BarChart3,
  Settings,
  UserCheck,
  UserX,
  LogIn,
  MoreVertical,
  Tag,
  History,
  Activity,
  Filter,
  X,
  ArrowUpDown,
  Building2,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';

// =====================================================
// Types
// =====================================================

interface OnboardingUser {
  id: string;
  username: string;
  onboarding_stage: string;
  onboarding_tags: string[];
  is_active: boolean;
  telegram_id: string | null;
  created_at: string;
  updated_at: string;
  last_session_at: string | null;
  // Multi-account fields
  ad_account_count?: number;
  active_ad_account_count?: number;
}

interface OnboardingStage {
  id: string;
  label: string;
}

interface KanbanData {
  kanban: Record<string, OnboardingUser[]>;
  counts: Record<string, number>;
  stages: OnboardingStage[];
}

interface AdAccountInfo {
  id: string;
  name: string | null;
  is_active: boolean;
  connection_status: string;
  ad_account_id: string | null;
  created_at: string;
}

interface UserDetailData {
  user: OnboardingUser & {
    fb_connection_status: string | null;
    access_token: string | null;
    page_id: string | null;
    ad_account_id: string | null;
  };
  history: Array<{
    id: string;
    stage_from: string | null;
    stage_to: string;
    change_reason: string | null;
    created_at: string;
    changed_by_user: { username: string } | null;
  }>;
  recentEvents: Array<{
    event_category: string;
    event_action: string;
    event_label?: string;
    page_path?: string;
    created_at: string;
  }>;
  stageLabels: Record<string, string>;
  tagLabels: Record<string, string>;
  adAccounts: AdAccountInfo[];
}

// =====================================================
// Constants
// =====================================================

const STAGE_ICONS: Record<string, React.ReactNode> = {
  registered: <Users className="h-4 w-4" />,
  fb_pending: <Clock className="h-4 w-4" />,
  fb_connected: <Facebook className="h-4 w-4" />,
  direction_created: <FileText className="h-4 w-4" />,
  creative_created: <FileText className="h-4 w-4" />,
  ads_launched: <Play className="h-4 w-4" />,
  first_report: <BarChart3 className="h-4 w-4" />,
  roi_configured: <Settings className="h-4 w-4" />,
  active: <UserCheck className="h-4 w-4" />,
  inactive: <UserX className="h-4 w-4" />,
};

const STAGE_COLORS: Record<string, string> = {
  registered: 'bg-secondary border-border',
  fb_pending: 'bg-yellow-500/10 border-yellow-500/30',
  fb_connected: 'bg-blue-500/10 border-blue-500/30',
  direction_created: 'bg-purple-500/10 border-purple-500/30',
  creative_created: 'bg-pink-500/10 border-pink-500/30',
  ads_launched: 'bg-orange-500/10 border-orange-500/30',
  first_report: 'bg-teal-500/10 border-teal-500/30',
  roi_configured: 'bg-indigo-500/10 border-indigo-500/30',
  active: 'bg-green-500/10 border-green-500/30',
  inactive: 'bg-red-500/10 border-red-500/30',
};

const TAG_LABELS: Record<string, string> = {
  tiktok_connected: 'TikTok',
  generated_image: 'Изображение',
  generated_carousel: 'Карусель',
  generated_text: 'Текст',
  added_competitors: 'Конкуренты',
  added_custom_audience: 'Custom Audience',
  launched_creative_test: 'Тест креатива',
  used_llm_analysis: 'LLM анализ',
};

type SortOption = 'created_desc' | 'created_asc' | 'activity_desc' | 'activity_asc' | 'name_asc' | 'name_desc';

// =====================================================
// Helper Components
// =====================================================

const UserCard: React.FC<{
  user: OnboardingUser;
  stage: string;
  onSelect: () => void;
  onApprove?: () => void;
}> = ({ user, stage, onSelect, onApprove }) => {
  // Используем last_session_at если есть, иначе created_at
  const lastActivityDate = user.last_session_at || user.created_at;
  const daysSinceActivity = Math.floor(
    (Date.now() - new Date(lastActivityDate).getTime()) / (1000 * 60 * 60 * 24)
  );
  const isNeverActive = !user.last_session_at;

  return (
    <div
      className="p-3 bg-card text-card-foreground rounded-lg shadow-sm border cursor-pointer hover:shadow-md transition-shadow"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{user.username}</p>
          <p className="text-xs text-muted-foreground">
            {isNeverActive
              ? 'Нет сессий'
              : daysSinceActivity === 0
                ? 'Сегодня'
                : `${daysSinceActivity} дн. назад`}
          </p>
        </div>
        {stage === 'fb_pending' && onApprove && (
          <Button
            size="sm"
            variant="outline"
            className="ml-2 h-7 text-xs bg-green-500/10 hover:bg-green-500/20 border-green-500/30 text-green-600"
            onClick={(e) => {
              e.stopPropagation();
              onApprove();
            }}
          >
            <CheckCircle className="h-3 w-3 mr-1" />
            Подтв.
          </Button>
        )}
      </div>

      {user.onboarding_tags && user.onboarding_tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {user.onboarding_tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0">
              {tag === 'tiktok_connected' && 'TT'}
              {tag === 'generated_image' && 'Img'}
              {tag === 'generated_carousel' && 'Car'}
              {tag === 'generated_text' && 'Txt'}
              {tag === 'added_competitors' && 'Comp'}
              {tag === 'added_custom_audience' && 'Aud'}
              {tag === 'launched_creative_test' && 'Test'}
              {tag === 'used_llm_analysis' && 'LLM'}
            </Badge>
          ))}
          {user.onboarding_tags.length > 3 && (
            <Badge variant="outline" className="text-xs px-1.5 py-0">
              +{user.onboarding_tags.length - 3}
            </Badge>
          )}
        </div>
      )}

      {user.ad_account_count && user.ad_account_count > 0 && (
        <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
          <Building2 className="h-3 w-3" />
          <span>
            {user.active_ad_account_count}/{user.ad_account_count} акк.
          </span>
        </div>
      )}
    </div>
  );
};

const KanbanColumn: React.FC<{
  stage: OnboardingStage;
  users: OnboardingUser[];
  count: number;
  onUserSelect: (user: OnboardingUser) => void;
  onApprove: (userId: string) => void;
}> = ({ stage, users, count, onUserSelect, onApprove }) => {
  return (
    <div className={cn('flex flex-col min-w-[200px] max-w-[250px] rounded-lg border-2', STAGE_COLORS[stage.id] || 'bg-secondary border-border')}>
      <div className="p-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          {STAGE_ICONS[stage.id]}
          <span className="font-medium text-sm">{stage.label}</span>
        </div>
        <Badge variant="secondary" className="text-xs">
          {count}
        </Badge>
      </div>
      <div className="p-2 flex-1 overflow-y-auto max-h-[calc(100vh-300px)] space-y-2">
        {users.map((user) => (
          <UserCard
            key={user.id}
            user={user}
            stage={stage.id}
            onSelect={() => onUserSelect(user)}
            onApprove={stage.id === 'fb_pending' ? () => onApprove(user.id) : undefined}
          />
        ))}
        {users.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            Нет пользователей
          </p>
        )}
      </div>
    </div>
  );
};

// =====================================================
// Main Component
// =====================================================

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'created_desc', label: 'Новые сначала' },
  { value: 'created_asc', label: 'Старые сначала' },
  { value: 'activity_desc', label: 'Активные сначала' },
  { value: 'activity_asc', label: 'Неактивные сначала' },
  { value: 'name_asc', label: 'По имени А-Я' },
  { value: 'name_desc', label: 'По имени Я-А' },
];

const AdminOnboarding: React.FC = () => {
  const { toast } = useToast();
  const [kanbanData, setKanbanData] = useState<KanbanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Filters & sorting
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [sortOption, setSortOption] = useState<SortOption>('created_desc');

  // User detail modal
  const [selectedUser, setSelectedUser] = useState<OnboardingUser | null>(null);
  const [userDetail, setUserDetail] = useState<UserDetailData | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Approve confirmation
  const [approveUserId, setApproveUserId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  // Chat modal
  const [chatUser, setChatUser] = useState<{ id: string; username: string } | null>(null);

  // Fetch kanban data
  const fetchKanbanData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/onboarding/kanban`);
      if (res.ok) {
        const data = await res.json();
        setKanbanData(data);
      }
    } catch (error) {
      console.error('Failed to fetch kanban data:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось загрузить данные',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Fetch user details
  const fetchUserDetail = async (userId: string) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`${API_BASE_URL}/onboarding/user/${userId}`);
      if (res.ok) {
        const data = await res.json();
        setUserDetail(data);
      }
    } catch (error) {
      console.error('Failed to fetch user details:', error);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Approve FB connection
  const handleApprove = async (userId: string) => {
    setApproving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/onboarding/approve-fb/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendNotification: true }),
      });

      if (res.ok) {
        toast({
          title: 'Успешно',
          description: 'Facebook подключение подтверждено. Уведомление отправлено.',
        });
        setApproveUserId(null);
        fetchKanbanData(); // Refresh data
      } else {
        throw new Error('Failed to approve');
      }
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось подтвердить подключение',
        variant: 'destructive',
      });
    } finally {
      setApproving(false);
    }
  };

  // Start impersonation
  const handleImpersonate = async (userId: string) => {
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

    try {
      const res = await fetch(`${API_BASE_URL}/impersonate/${userId}`, {
        method: 'POST',
        headers: {
          'x-user-id': currentUser.id,
        },
      });

      if (res.ok) {
        const data = await res.json();

        // Store impersonation data
        sessionStorage.setItem('impersonation_mode', 'true');
        sessionStorage.setItem('impersonation_token', data.impersonationToken);
        sessionStorage.setItem('original_user', JSON.stringify(currentUser));

        // Replace user in localStorage
        localStorage.setItem('user', JSON.stringify(data.user));

        toast({
          title: 'Вход выполнен',
          description: `Вы вошли как ${data.user.username}`,
        });

        // Redirect to dashboard
        window.location.href = '/';
      } else {
        throw new Error('Failed to impersonate');
      }
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось войти под пользователем',
        variant: 'destructive',
      });
    }
  };

  // User selection handler
  const handleUserSelect = (user: OnboardingUser) => {
    setSelectedUser(user);
    fetchUserDetail(user.id);
  };

  // Initial load
  useEffect(() => {
    fetchKanbanData();
  }, [fetchKanbanData]);

  // Refresh handler
  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchKanbanData();
    setRefreshing(false);
  };

  // Filter and sort users
  const filterUsers = (users: OnboardingUser[]) => {
    let filtered = [...users];

    // Search filter (by name or telegram_id)
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (u) =>
          u.username.toLowerCase().includes(query) ||
          (u.telegram_id && u.telegram_id.toLowerCase().includes(query))
      );
    }

    // Tag filter
    if (tagFilter && tagFilter !== 'all') {
      filtered = filtered.filter(
        (u) => u.onboarding_tags && u.onboarding_tags.includes(tagFilter)
      );
    }

    // Sorting
    filtered.sort((a, b) => {
      switch (sortOption) {
        case 'created_desc':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'created_asc':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'activity_desc': {
          const aTime = a.last_session_at ? new Date(a.last_session_at).getTime() : 0;
          const bTime = b.last_session_at ? new Date(b.last_session_at).getTime() : 0;
          return bTime - aTime;
        }
        case 'activity_asc': {
          const aTime = a.last_session_at ? new Date(a.last_session_at).getTime() : 0;
          const bTime = b.last_session_at ? new Date(b.last_session_at).getTime() : 0;
          return aTime - bTime;
        }
        case 'name_asc':
          return a.username.localeCompare(b.username, 'ru');
        case 'name_desc':
          return b.username.localeCompare(a.username, 'ru');
        default:
          return 0;
      }
    });

    return filtered;
  };

  // Check if any filter is active
  const hasActiveFilters = searchQuery || tagFilter !== 'all' || sortOption !== 'created_desc';

  // Reset all filters
  const resetFilters = () => {
    setSearchQuery('');
    setTagFilter('all');
    setSortOption('created_desc');
  };

  if (loading) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <Header />
        <main className="flex-1 p-6 flex items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Header />
      <main className="flex-1 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">Онбординг</h1>
            <p className="text-muted-foreground">Отслеживание этапов пользователей</p>
          </div>
          <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={cn('h-4 w-4 mr-2', refreshing && 'animate-spin')} />
            Обновить
          </Button>
        </div>

        {/* Filter Panel */}
        <div className="flex flex-wrap items-center gap-3 mb-6 p-3 bg-muted/50 rounded-lg border">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-[300px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по имени, telegram..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Tag Filter */}
          <Select value={tagFilter} onValueChange={setTagFilter}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Фильтр по тегу" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все теги</SelectItem>
              {Object.entries(TAG_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Sort */}
          <Select value={sortOption} onValueChange={(v) => setSortOption(v as SortOption)}>
            <SelectTrigger className="w-[180px]">
              <ArrowUpDown className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Сортировка" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Reset Filters */}
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground">
              <X className="h-4 w-4 mr-1" />
              Сбросить
            </Button>
          )}
        </div>

        {/* Stats */}
        {kanbanData && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Всего пользователей</p>
                    <p className="text-2xl font-bold">
                      {Object.values(kanbanData.counts).reduce((a, b) => a + b, 0)}
                    </p>
                  </div>
                  <Users className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Ожидают подтверждения FB</p>
                    <p className="text-2xl font-bold text-yellow-600">
                      {kanbanData.counts.fb_pending || 0}
                    </p>
                  </div>
                  <Clock className="h-8 w-8 text-yellow-500" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Активные</p>
                    <p className="text-2xl font-bold text-green-600">
                      {kanbanData.counts.active || 0}
                    </p>
                  </div>
                  <UserCheck className="h-8 w-8 text-green-500" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Неактивные</p>
                    <p className="text-2xl font-bold text-red-600">
                      {kanbanData.counts.inactive || 0}
                    </p>
                  </div>
                  <UserX className="h-8 w-8 text-red-500" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Kanban Board */}
        {kanbanData && (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {kanbanData.stages.map((stage) => (
              <KanbanColumn
                key={stage.id}
                stage={stage}
                users={filterUsers(kanbanData.kanban[stage.id] || [])}
                count={kanbanData.counts[stage.id] || 0}
                onUserSelect={handleUserSelect}
                onApprove={(userId) => setApproveUserId(userId)}
              />
            ))}
          </div>
        )}

        {/* User Detail Dialog */}
        <Dialog open={!!selectedUser} onOpenChange={(open) => !open && setSelectedUser(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                {selectedUser?.username}
              </DialogTitle>
              <DialogDescription>
                Зарегистрирован{' '}
                {selectedUser &&
                  format(new Date(selectedUser.created_at), 'd MMMM yyyy', { locale: ru })}
              </DialogDescription>
            </DialogHeader>

            {loadingDetail ? (
              <div className="flex justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin" />
              </div>
            ) : userDetail ? (
              <div className="space-y-6">
                {/* Status */}
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Этап</p>
                    <Badge className="mt-1">
                      {userDetail.stageLabels[userDetail.user.onboarding_stage] ||
                        userDetail.user.onboarding_stage}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Статус FB</p>
                    <Badge
                      className="mt-1"
                      variant={
                        userDetail.user.fb_connection_status === 'approved'
                          ? 'default'
                          : 'secondary'
                      }
                    >
                      {userDetail.user.fb_connection_status || 'Не подключен'}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Активен</p>
                    <Badge className="mt-1" variant={userDetail.user.is_active ? 'default' : 'destructive'}>
                      {userDetail.user.is_active ? 'Да' : 'Нет'}
                    </Badge>
                  </div>
                </div>

                {/* Tags */}
                {userDetail.user.onboarding_tags && userDetail.user.onboarding_tags.length > 0 && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1">
                      <Tag className="h-4 w-4" /> Теги
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {userDetail.user.onboarding_tags.map((tag) => (
                        <Badge key={tag} variant="outline">
                          {userDetail.tagLabels[tag] || tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ad Accounts */}
                {userDetail.adAccounts && userDetail.adAccounts.length > 0 && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1">
                      <Building2 className="h-4 w-4" /> Рекламные аккаунты ({userDetail.adAccounts.length})
                    </p>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {userDetail.adAccounts.map((acc) => (
                        <div key={acc.id} className="flex items-center justify-between bg-muted rounded p-2 text-sm">
                          <span>{acc.name || 'Без названия'}</span>
                          <div className="flex items-center gap-2">
                            <Badge variant={acc.is_active ? 'default' : 'secondary'}>
                              {acc.is_active ? 'Активен' : 'Неактивен'}
                            </Badge>
                            <Badge
                              variant={
                                acc.connection_status === 'connected'
                                  ? 'default'
                                  : acc.connection_status === 'error'
                                    ? 'destructive'
                                    : 'secondary'
                              }
                            >
                              {acc.connection_status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* FB Data */}
                {(userDetail.user.page_id || userDetail.user.ad_account_id) && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1">
                      <Facebook className="h-4 w-4" /> Facebook данные
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="bg-muted rounded p-2">
                        <span className="text-muted-foreground">Page ID:</span>{' '}
                        {userDetail.user.page_id || '-'}
                      </div>
                      <div className="bg-muted rounded p-2">
                        <span className="text-muted-foreground">Ad Account:</span>{' '}
                        {userDetail.user.ad_account_id || '-'}
                      </div>
                    </div>
                  </div>
                )}

                {/* History */}
                {userDetail.history.length > 0 && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1">
                      <History className="h-4 w-4" /> История изменений
                    </p>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {userDetail.history.map((h) => (
                        <div key={h.id} className="text-xs bg-muted rounded p-2 flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {format(new Date(h.created_at), 'd MMM HH:mm', { locale: ru })}
                          </span>
                          <span>
                            {userDetail.stageLabels[h.stage_from || ''] || h.stage_from || 'Начало'} →{' '}
                            {userDetail.stageLabels[h.stage_to] || h.stage_to}
                          </span>
                          {h.changed_by_user && (
                            <span className="text-muted-foreground">
                              ({h.changed_by_user.username})
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent Events */}
                {userDetail.recentEvents.length > 0 && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1">
                      <Activity className="h-4 w-4" /> Последние действия
                    </p>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {userDetail.recentEvents.map((e, i) => (
                        <div key={i} className="text-xs flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {formatDistanceToNow(new Date(e.created_at), {
                              addSuffix: true,
                              locale: ru,
                            })}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {e.event_category}
                          </Badge>
                          <span className="truncate">{e.event_label || e.page_path}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-4 border-t">
                  {userDetail.user.onboarding_stage === 'fb_pending' && (
                    <Button onClick={() => setApproveUserId(userDetail.user.id)}>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Подтвердить FB
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => setChatUser({ id: userDetail.user.id, username: userDetail.user.username })}
                  >
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Написать
                  </Button>
                  <Button variant="outline" onClick={() => handleImpersonate(userDetail.user.id)}>
                    <LogIn className="h-4 w-4 mr-2" />
                    Войти как пользователь
                  </Button>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        {/* Approve Confirmation Dialog */}
        <Dialog open={!!approveUserId} onOpenChange={(open) => !open && setApproveUserId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Подтвердить подключение Facebook?</DialogTitle>
              <DialogDescription>
                Пользователю будет отправлено уведомление в Telegram о том, что его аккаунт подключен.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setApproveUserId(null)}>
                Отмена
              </Button>
              <Button onClick={() => approveUserId && handleApprove(approveUserId)} disabled={approving}>
                {approving ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                Подтвердить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* User Chat Modal */}
        {chatUser && (
          <UserChatModal
            userId={chatUser.id}
            username={chatUser.username}
            isOpen={!!chatUser}
            onClose={() => setChatUser(null)}
          />
        )}
      </main>
    </div>
  );
};

export default AdminOnboarding;
