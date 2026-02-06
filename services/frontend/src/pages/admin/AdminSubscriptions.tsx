/**
 * Admin Subscriptions
 *
 * Раздел подписок в админке /admin.
 *
 * @module pages/admin/AdminSubscriptions
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, RefreshCw, CreditCard, Settings, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { API_BASE_URL } from '@/config/api';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import UserAccountEditModal from '@/components/admin/UserAccountEditModal';

interface SubscriptionUser {
  id: string;
  username: string;
  telegram_id?: string;
  created_at?: string;
  is_active?: boolean | null;
  tarif?: string | null;
  tarif_expires?: string | null;
  tarif_renewal_cost?: number | null;
}

interface SubscriptionSummary {
  total: number;
  active: number;
  expiringSoon: number;
  expiredOrDisabled: number;
}

const TARIF_LABELS: Record<string, string> = {
  subscription_1m: 'Подписка 1 мес',
  subscription_3m: 'Подписка 3 мес',
  subscription_12m: 'Подписка 12 мес',
};

const DEFAULT_COST_BY_MONTHS: Record<number, number> = {
  1: 49000,
  3: 99000,
  12: 299000,
};

type SortField = 'tarif' | 'tarif_expires' | 'status';
type SortDirection = 'asc' | 'desc';

const AdminSubscriptions: React.FC = () => {
  const [users, setUsers] = useState<SubscriptionUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('tarif_expires');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [renewingKey, setRenewingKey] = useState<string | null>(null);
  const [summary, setSummary] = useState<SubscriptionSummary>({
    total: 0,
    active: 0,
    expiringSoon: 0,
    expiredOrDisabled: 0,
  });

  const fetchSubscriptions = useCallback(async () => {
    setLoading(true);
    try {
      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        subscriptions_only: 'true',
      });

      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }

      const res = await fetch(`${API_BASE_URL}/admin/users?${params.toString()}`, {
        headers: { 'x-user-id': currentUser.id || '' },
      });

      if (!res.ok) return;

      const data = await res.json();
      setUsers(data.users || []);
      setTotalPages(data.totalPages || 1);
      setTotal(data.total || 0);
      setSummary({
        total: data.subscriptionSummary?.total || 0,
        active: data.subscriptionSummary?.active || 0,
        expiringSoon: data.subscriptionSummary?.expiringSoon || 0,
        expiredOrDisabled: data.subscriptionSummary?.expiredOrDisabled || 0,
      });
    } catch (err) {
      console.error('Error fetching subscriptions:', err);
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery]);

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

  const getTarifLabel = (tarif?: string | null) => {
    if (!tarif) return '—';
    return TARIF_LABELS[tarif] || tarif;
  };

  const formatExpiry = (tarifExpires?: string | null) => {
    if (!tarifExpires) return '—';
    const d = new Date(`${tarifExpires}T00:00:00`);
    if (Number.isNaN(d.getTime())) return tarifExpires;
    return format(d, 'd MMM yyyy', { locale: ru });
  };

  const formatRenewal = (value?: number | null) => {
    if (value === null || value === undefined) return '—';
    return `${Number(value).toLocaleString('ru-RU')} KZT`;
  };

  const getStatus = (user: SubscriptionUser) => {
    if (!user.is_active) {
      return { label: 'Отключена', variant: 'destructive' as const, rank: 4 };
    }
    if (!user.tarif_expires) {
      return { label: 'Нет даты', variant: 'secondary' as const, rank: 5 };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(`${user.tarif_expires}T00:00:00`);
    if (Number.isNaN(expiry.getTime())) {
      return { label: 'Некорректная дата', variant: 'secondary' as const, rank: 6 };
    }
    if (expiry < today) {
      return { label: 'Просрочена', variant: 'destructive' as const, rank: 3 };
    }

    const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / 86400000);
    if (diffDays <= 7) {
      return { label: `Истекает через ${diffDays} дн`, variant: 'secondary' as const, rank: 2 };
    }
    return { label: 'Активна', variant: 'default' as const, rank: 1 };
  };

  const sortedUsers = useMemo(() => {
    const list = [...users];
    const direction = sortDirection === 'asc' ? 1 : -1;

    list.sort((a, b) => {
      if (sortField === 'tarif') {
        const av = getTarifLabel(a.tarif).toLowerCase();
        const bv = getTarifLabel(b.tarif).toLowerCase();
        return av.localeCompare(bv, 'ru') * direction;
      }

      if (sortField === 'tarif_expires') {
        const ad = a.tarif_expires ? new Date(`${a.tarif_expires}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
        const bd = b.tarif_expires ? new Date(`${b.tarif_expires}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
        return (ad - bd) * direction;
      }

      const as = getStatus(a).rank;
      const bs = getStatus(b).rank;
      return (as - bs) * direction;
    });

    return list;
  }, [users, sortField, sortDirection]);

  const addMonthsToDate = (date: Date, months: number) => {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
  };

  const computeNewExpiry = (user: SubscriptionUser, months: number) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expiryDate = user.tarif_expires ? new Date(`${user.tarif_expires}T00:00:00`) : null;
    const baseDate = expiryDate && !Number.isNaN(expiryDate.getTime()) && expiryDate >= today ? expiryDate : today;
    return addMonthsToDate(baseDate, months);
  };

  const getSubscriptionTarifByMonths = (months: number): string => {
    if (months === 1) return 'subscription_1m';
    if (months === 3) return 'subscription_3m';
    if (months === 12) return 'subscription_12m';
    return `subscription_${months}m`;
  };

  const quickRenew = async (user: SubscriptionUser, months: number) => {
    const requestKey = `${user.id}:${months}`;
    setRenewingKey(requestKey);

    try {
      const expiry = computeNewExpiry(user, months);
      const expiryString = expiry.toISOString().slice(0, 10);
      const renewalCost = user.tarif_renewal_cost ?? DEFAULT_COST_BY_MONTHS[months] ?? null;
      const nextTarif = getSubscriptionTarifByMonths(months);

      const res = await fetch(`${API_BASE_URL}/admin/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tarif: nextTarif,
          tarif_expires: expiryString,
          tarif_renewal_cost: renewalCost,
          is_active: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Не удалось продлить подписку');
      }

      toast.success(`Подписка продлена на ${months} мес.`);
      await fetchSubscriptions();
    } catch (error) {
      console.error('Quick renew error:', error);
      toast.error(error instanceof Error ? error.message : 'Ошибка продления');
    } finally {
      setRenewingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Подписки</h1>
        <p className="text-muted-foreground">Всего {total} пользователей с подпиской</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Подписок всего</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Активные</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.active}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Истекают за 7 дней</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.expiringSoon}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Просрочены/отключены</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.expiredOrDisabled}</p>
          </CardContent>
        </Card>
      </div>

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
        <Select value={sortField} onValueChange={(v: SortField) => setSortField(v)}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="Сортировать по" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tarif">По тарифу</SelectItem>
            <SelectItem value="tarif_expires">По окончанию</SelectItem>
            <SelectItem value="status">По статусу</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortDirection} onValueChange={(v: SortDirection) => setSortDirection(v)}>
          <SelectTrigger className="w-full sm:w-[190px]">
            <SelectValue placeholder="Порядок" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asc">По возрастанию</SelectItem>
            <SelectItem value="desc">По убыванию</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={fetchSubscriptions} className="w-full sm:w-auto">
          <RefreshCw className="h-4 w-4 mr-2" />
          Обновить
        </Button>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Пользователь</TableHead>
              <TableHead>Тариф</TableHead>
              <TableHead>Окончание</TableHead>
              <TableHead>Стоимость продления</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-[320px]">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  <RefreshCw className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Подписки не найдены
                </TableCell>
              </TableRow>
            ) : (
              sortedUsers.map((user) => {
                const status = getStatus(user);
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{user.username}</p>
                        <p className="text-xs text-muted-foreground">
                          {user.telegram_id ? `@${user.telegram_id}` : 'Нет контакта'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{getTarifLabel(user.tarif)}</span>
                      </div>
                    </TableCell>
                    <TableCell>{formatExpiry(user.tarif_expires)}</TableCell>
                    <TableCell>{formatRenewal(user.tarif_renewal_cost)}</TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditUserId(user.id)}
                        >
                          <Settings className="h-4 w-4 mr-1" />
                          Редактировать
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={renewingKey !== null}
                          onClick={() => quickRenew(user, 1)}
                        >
                          +1 мес
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={renewingKey !== null}
                          onClick={() => quickRenew(user, 3)}
                        >
                          +3 мес
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={renewingKey !== null}
                          onClick={() => quickRenew(user, 12)}
                        >
                          +12 мес
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Страница {page} из {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {editUserId && (
        <UserAccountEditModal
          open={!!editUserId}
          userId={editUserId}
          onOpenChange={(open) => !open && setEditUserId(null)}
          onSave={fetchSubscriptions}
        />
      )}
    </div>
  );
};

export default AdminSubscriptions;
