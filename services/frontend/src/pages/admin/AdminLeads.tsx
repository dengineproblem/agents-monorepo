/**
 * Admin Leads
 *
 * Все лиды по всем пользователям с фильтрами и статистикой
 *
 * @module pages/admin/AdminLeads
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Target,
  Search,
  Filter,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  DollarSign,
  Calendar,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { API_BASE_URL } from '@/config/api';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface Lead {
  id: string;
  user_username: string;
  lead_name?: string;
  phone?: string;
  campaign_name?: string;
  creative_name?: string;
  direction_name?: string;
  cost: number;
  created_at: string;
}

interface LeadsStats {
  total: number;
  averageCpl: number;
  totalSpend: number;
}

const PERIODS = [
  { value: 'today', label: 'Сегодня' },
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: 'all', label: 'Всё время' },
];

const AdminLeads: React.FC = () => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<LeadsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('7d');
  const [userFilter, setUserFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Available users for filter
  const [users, setUsers] = useState<{ id: string; username: string }[]>([]);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        period,
        page: String(page),
        limit: '20',
      });

      if (userFilter && userFilter !== 'all') {
        params.append('userId', userFilter);
      }

      const res = await fetch(`${API_BASE_URL}/admin/leads?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads || []);
        setStats(data.stats || null);
        setTotalPages(data.totalPages || 1);
        setTotal(data.total || 0);
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error('Error fetching leads:', err);
    } finally {
      setLoading(false);
    }
  }, [period, userFilter, page]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [period, userFilter]);

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Лиды</h1>
        <p className="text-muted-foreground">
          Все лиды по всем пользователям
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Всего лидов</CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
              <p className="text-xs text-muted-foreground">За выбранный период</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Средний CPL</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(stats.averageCpl)}</div>
              <p className="text-xs text-muted-foreground">Стоимость лида</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Общий расход</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(stats.totalSpend)}</div>
              <p className="text-xs text-muted-foreground">На привлечение лидов</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4 flex-wrap">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <Calendar className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={userFilter} onValueChange={setUserFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Все пользователи" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все пользователи</SelectItem>
            {users.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.username}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" onClick={fetchLeads} className="w-full sm:w-auto">
          <RefreshCw className="h-4 w-4 mr-2" />
          Обновить
        </Button>

        <div className="sm:ml-auto text-sm text-muted-foreground text-center sm:text-left">
          Всего: {total} лидов
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Пользователь</TableHead>
              <TableHead>Лид</TableHead>
              <TableHead>Телефон</TableHead>
              <TableHead>Источник</TableHead>
              <TableHead className="text-right">Стоимость</TableHead>
              <TableHead>Дата</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  <RefreshCw className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Нет лидов за выбранный период
                </TableCell>
              </TableRow>
            ) : (
              leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="font-medium">{lead.user_username}</TableCell>
                  <TableCell>{lead.lead_name || '—'}</TableCell>
                  <TableCell>
                    {lead.phone ? (
                      <code className="text-sm bg-muted px-1 rounded">{lead.phone}</code>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {lead.direction_name && (
                        <Badge variant="outline" className="text-xs">
                          {lead.direction_name}
                        </Badge>
                      )}
                      {lead.campaign_name && (
                        <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                          {lead.campaign_name}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {lead.cost > 0 ? (
                      <Badge variant="secondary">{formatCurrency(lead.cost)}</Badge>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    {format(new Date(lead.created_at), 'd MMM HH:mm', { locale: ru })}
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
    </div>
  );
};

export default AdminLeads;
