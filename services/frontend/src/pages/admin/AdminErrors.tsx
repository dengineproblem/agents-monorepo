/**
 * Admin Errors
 *
 * Логи ошибок с LLM расшифровкой
 *
 * @module pages/admin/AdminErrors
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Search,
  Filter,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  XCircle,
  Lightbulb,
  Clock,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { API_BASE_URL } from '@/config/api';
import { format, formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface ErrorLog {
  id: string;
  user_account_id?: string;
  user_username?: string;
  error_type: string;
  error_code?: string;
  raw_error: string;
  stack_trace?: string;
  action?: string;
  endpoint?: string;
  request_data?: any;
  llm_explanation?: string;
  llm_solution?: string;
  severity: 'critical' | 'warning' | 'info';
  is_resolved: boolean;
  resolved_at?: string;
  resolved_by?: string;
  created_at: string;
}

const ERROR_TYPES = [
  { value: 'all', label: 'Все типы' },
  { value: 'api', label: 'API' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'cron', label: 'CRON' },
  { value: 'frontend', label: 'Frontend' },
];

const SEVERITIES = [
  { value: 'all', label: 'Все' },
  { value: 'critical', label: 'Критические' },
  { value: 'warning', label: 'Предупреждения' },
  { value: 'info', label: 'Информационные' },
];

const AdminErrors: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [resolvedFilter, setResolvedFilter] = useState('unresolved');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Selected error for detail view
  const [selectedError, setSelectedError] = useState<ErrorLog | null>(null);
  const [resolving, setResolving] = useState(false);

  const fetchErrors = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
      });

      if (typeFilter !== 'all') {
        params.append('type', typeFilter);
      }
      if (severityFilter !== 'all') {
        params.append('severity', severityFilter);
      }
      if (resolvedFilter !== 'all') {
        params.append('resolved', resolvedFilter === 'resolved' ? 'true' : 'false');
      }

      const res = await fetch(`${API_BASE_URL}/admin/errors?${params}`);
      if (res.ok) {
        const data = await res.json();
        setErrors(data.errors || []);
        setTotalPages(data.totalPages || 1);
        setTotal(data.total || 0);

        // Check if specific error ID in URL
        const errorId = searchParams.get('id');
        if (errorId) {
          const error = data.errors.find((e: ErrorLog) => e.id === errorId);
          if (error) {
            setSelectedError(error);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching errors:', err);
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, severityFilter, resolvedFilter, searchParams]);

  useEffect(() => {
    fetchErrors();
  }, [fetchErrors]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [typeFilter, severityFilter, resolvedFilter]);

  const handleResolve = async (errorId: string) => {
    setResolving(true);
    try {
      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      const res = await fetch(`${API_BASE_URL}/admin/errors/${errorId}/resolve`, {
        method: 'POST',
        headers: {
          'x-user-id': currentUser.id || '',
        },
      });

      if (res.ok) {
        // Update in list
        setErrors((prev) =>
          prev.map((e) =>
            e.id === errorId
              ? { ...e, is_resolved: true, resolved_at: new Date().toISOString() }
              : e
          )
        );
        // Update selected
        if (selectedError?.id === errorId) {
          setSelectedError({
            ...selectedError,
            is_resolved: true,
            resolved_at: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      console.error('Error resolving:', err);
    } finally {
      setResolving(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-500 text-white';
      case 'warning':
        return 'bg-yellow-500 text-white';
      default:
        return 'bg-blue-500 text-white';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Clock className="h-4 w-4 text-blue-500" />;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ошибки</h1>
        <p className="text-muted-foreground">
          Логи ошибок с LLM расшифровкой
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[150px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ERROR_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEVERITIES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={resolvedFilter} onValueChange={setResolvedFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="unresolved">Нерешённые</SelectItem>
            <SelectItem value="resolved">Решённые</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" onClick={fetchErrors}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Обновить
        </Button>

        <div className="ml-auto text-sm text-muted-foreground">
          Всего: {total} ошибок
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]"></TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Ошибка</TableHead>
              <TableHead>Пользователь</TableHead>
              <TableHead>Действие</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead className="w-[100px]">Статус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <RefreshCw className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : errors.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Нет ошибок
                </TableCell>
              </TableRow>
            ) : (
              errors.map((error) => (
                <TableRow
                  key={error.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedError(error)}
                >
                  <TableCell>{getSeverityIcon(error.severity)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{error.error_type}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    <p className="truncate text-sm">{error.raw_error}</p>
                    {error.llm_explanation && (
                      <p className="text-xs text-muted-foreground truncate mt-1">
                        💡 {error.llm_explanation}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>{error.user_username || 'Система'}</TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1 rounded">
                      {error.action || error.endpoint || '—'}
                    </code>
                  </TableCell>
                  <TableCell>
                    {formatDistanceToNow(new Date(error.created_at), {
                      addSuffix: true,
                      locale: ru,
                    })}
                  </TableCell>
                  <TableCell>
                    {error.is_resolved ? (
                      <Badge variant="outline" className="text-green-600">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Решено
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-yellow-600">
                        Открыто
                      </Badge>
                    )}
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

      {/* Error Detail Dialog */}
      <Dialog open={!!selectedError} onOpenChange={(open) => !open && setSelectedError(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedError && getSeverityIcon(selectedError.severity)}
              Детали ошибки
            </DialogTitle>
            <DialogDescription>
              {selectedError && format(new Date(selectedError.created_at), 'd MMMM yyyy HH:mm:ss', { locale: ru })}
            </DialogDescription>
          </DialogHeader>

          {selectedError && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4">
                {/* Meta Info */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={getSeverityColor(selectedError.severity)}>
                    {selectedError.severity}
                  </Badge>
                  <Badge variant="outline">{selectedError.error_type}</Badge>
                  {selectedError.error_code && (
                    <Badge variant="secondary">{selectedError.error_code}</Badge>
                  )}
                  {selectedError.user_username && (
                    <Badge variant="outline">
                      Пользователь: {selectedError.user_username}
                    </Badge>
                  )}
                </div>

                {/* LLM Explanation */}
                {selectedError.llm_explanation && (
                  <Card className="border-blue-200 dark:border-blue-800">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Lightbulb className="h-4 w-4 text-blue-500" />
                        Объяснение ошибки
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm">{selectedError.llm_explanation}</p>
                    </CardContent>
                  </Card>
                )}

                {/* LLM Solution */}
                {selectedError.llm_solution && (
                  <Card className="border-green-200 dark:border-green-800">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        Рекомендуемое решение
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm">{selectedError.llm_solution}</p>
                    </CardContent>
                  </Card>
                )}

                {/* Raw Error */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Текст ошибки</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap">
                      {selectedError.raw_error}
                    </pre>
                  </CardContent>
                </Card>

                {/* Stack Trace */}
                {selectedError.stack_trace && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Stack Trace</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                        {selectedError.stack_trace}
                      </pre>
                    </CardContent>
                  </Card>
                )}

                {/* Request Data */}
                {selectedError.request_data && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Данные запроса</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                        {JSON.stringify(selectedError.request_data, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                )}

                {/* Context */}
                {(selectedError.action || selectedError.endpoint) && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Контекст</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {selectedError.action && (
                        <p className="text-sm">
                          <span className="text-muted-foreground">Действие:</span>{' '}
                          <code className="bg-muted px-1 rounded">{selectedError.action}</code>
                        </p>
                      )}
                      {selectedError.endpoint && (
                        <p className="text-sm">
                          <span className="text-muted-foreground">Endpoint:</span>{' '}
                          <code className="bg-muted px-1 rounded">{selectedError.endpoint}</code>
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            </ScrollArea>
          )}

          <DialogFooter>
            {selectedError && !selectedError.is_resolved && (
              <Button onClick={() => handleResolve(selectedError.id)} disabled={resolving}>
                {resolving ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                Отметить решённой
              </Button>
            )}
            {selectedError?.is_resolved && (
              <Badge variant="outline" className="text-green-600">
                <CheckCircle className="h-3 w-3 mr-1" />
                Решено {selectedError.resolved_at && formatDistanceToNow(new Date(selectedError.resolved_at), { addSuffix: true, locale: ru })}
              </Badge>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminErrors;
