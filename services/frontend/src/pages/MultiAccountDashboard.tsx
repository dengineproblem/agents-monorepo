import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import Header from '../components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CircleDollarSign,
  Target,
  MousePointerClick,
  BarChart3,
  Building2,
  ChevronRight,
  Plus,
  AlertCircle,
  CheckCircle2,
  Clock,
  TrendingUp,
  Users,
  RefreshCw,
} from 'lucide-react';
import { formatCurrency, formatNumber } from '../utils/formatters';
import { cn } from '@/lib/utils';
import { API_BASE_URL } from '@/config/api';
import DateRangePicker from '../components/DateRangePicker';
import { toast } from 'sonner';

// =============================================================================
// TYPES
// =============================================================================

interface AccountStats {
  id: string;
  name: string;
  page_picture_url: string | null;
  connection_status: 'pending' | 'connected' | 'error';
  is_active: boolean;
  stats: {
    spend: number;
    leads: number;
    impressions: number;
    clicks: number;
    cpl: number;
  } | null;
}

interface AggregatedStats {
  totalSpend: number;
  totalLeads: number;
  totalImpressions: number;
  avgCpl: number;
  accountCount: number;
  activeAccountCount: number;
}

// =============================================================================
// LOGGING UTILITY
// =============================================================================

const LOG_PREFIX = '[MultiAccountDashboard]';

const logger = {
  info: (message: string, data?: Record<string, unknown>) => {
    console.log(`${LOG_PREFIX} ${message}`, data ? data : '');
  },
  warn: (message: string, data?: Record<string, unknown>) => {
    console.warn(`${LOG_PREFIX} ${message}`, data ? data : '');
  },
  error: (message: string, error?: unknown, data?: Record<string, unknown>) => {
    console.error(`${LOG_PREFIX} ${message}`, { error, ...data });
  },
  debug: (message: string, data?: Record<string, unknown>) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`${LOG_PREFIX} ${message}`, data ? data : '');
    }
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Безопасный парсинг JSON с логированием ошибок
 */
function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    logger.error('Failed to parse JSON', error, { jsonPreview: json.slice(0, 100) });
    return fallback;
  }
}

/**
 * Получение user ID из localStorage с валидацией
 */
function getUserIdFromStorage(): string | null {
  const userData = localStorage.getItem('user');
  if (!userData) {
    logger.debug('No user data in localStorage');
    return null;
  }

  const user = safeJsonParse<{ id?: string }>(userData, {});
  if (!user.id) {
    logger.warn('User data exists but no ID found');
    return null;
  }

  return user.id;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const MultiAccountDashboard: React.FC = () => {
  const navigate = useNavigate();
  const {
    adAccounts,
    setCurrentAdAccountId,
    dateRange,
    loading: contextLoading,
  } = useAppContext();

  // State
  const [accountStats, setAccountStats] = useState<AccountStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Ref для отмены запроса при размонтировании
  const abortControllerRef = useRef<AbortController | null>(null);

  // ==========================================================================
  // DATA LOADING
  // ==========================================================================

  const loadAllAccountStats = useCallback(async (showRefreshIndicator = false) => {
    logger.info('Starting to load account stats', {
      accountsCount: adAccounts?.length,
      dateRange: { since: dateRange.since, until: dateRange.until },
    });

    // Проверка наличия аккаунтов
    if (!adAccounts || adAccounts.length === 0) {
      logger.debug('No accounts to load stats for');
      setLoading(false);
      setAccountStats([]);
      return;
    }

    // Получение user ID
    const userId = getUserIdFromStorage();
    if (!userId) {
      logger.error('Cannot load stats: no user ID');
      setError('Не удалось определить пользователя');
      setLoading(false);
      return;
    }

    // Отмена предыдущего запроса
    if (abortControllerRef.current) {
      logger.debug('Aborting previous request');
      abortControllerRef.current.abort();
    }

    // Создание нового AbortController
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    if (showRefreshIndicator) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const url = `${API_BASE_URL}/ad-accounts/${userId}/all-stats?since=${dateRange.since}&until=${dateRange.until}`;
      logger.debug('Fetching stats from API', { url: url.replace(/\?.*/, '?...') });

      const startTime = performance.now();
      const response = await fetch(url, {
        signal,
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const duration = Math.round(performance.now() - startTime);

      logger.info('API response received', {
        status: response.status,
        ok: response.ok,
        durationMs: duration,
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.accounts || !Array.isArray(data.accounts)) {
        logger.warn('Unexpected API response format', { dataKeys: Object.keys(data) });
        throw new Error('Некорректный формат ответа API');
      }

      logger.info('Stats loaded successfully', {
        accountsCount: data.accounts.length,
        accountsWithStats: data.accounts.filter((a: AccountStats) => a.stats !== null).length,
      });

      setAccountStats(data.accounts);
      setError(null);

      if (showRefreshIndicator) {
        toast.success('Данные обновлены');
      }
    } catch (err) {
      // Игнорируем ошибки отмены запроса
      if (err instanceof Error && err.name === 'AbortError') {
        logger.debug('Request was aborted');
        return;
      }

      logger.error('Failed to load account stats', err);

      // Fallback: создаём данные из adAccounts без статистики
      const fallbackStats: AccountStats[] = adAccounts.map((acc) => ({
        id: acc.id,
        name: acc.name,
        page_picture_url: acc.page_picture_url || null,
        connection_status: (acc.connection_status as 'pending' | 'connected' | 'error') || 'pending',
        is_active: acc.is_active !== false,
        stats: null,
      }));

      setAccountStats(fallbackStats);
      setError('Не удалось загрузить статистику. Показаны базовые данные.');

      if (showRefreshIndicator) {
        toast.error('Ошибка обновления данных');
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [adAccounts, dateRange]);

  // Загрузка данных при монтировании и изменении зависимостей
  useEffect(() => {
    loadAllAccountStats();

    // Cleanup: отмена запроса при размонтировании
    return () => {
      if (abortControllerRef.current) {
        logger.debug('Component unmounting, aborting pending request');
        abortControllerRef.current.abort();
      }
    };
  }, [loadAllAccountStats]);

  // ==========================================================================
  // COMPUTED VALUES
  // ==========================================================================

  const aggregatedStats = useMemo<AggregatedStats>(() => {
    const activeAccounts = accountStats.filter((acc) => acc.is_active);
    const accountsWithStats = activeAccounts.filter((acc) => acc.stats !== null);

    const totalSpend = accountsWithStats.reduce((sum, acc) => sum + (acc.stats?.spend || 0), 0);
    const totalLeads = accountsWithStats.reduce((sum, acc) => sum + (acc.stats?.leads || 0), 0);
    const totalImpressions = accountsWithStats.reduce(
      (sum, acc) => sum + (acc.stats?.impressions || 0),
      0
    );

    const stats = {
      totalSpend,
      totalLeads,
      totalImpressions,
      avgCpl: totalLeads > 0 ? totalSpend / totalLeads : 0,
      accountCount: adAccounts.length,
      activeAccountCount: activeAccounts.length,
    };

    logger.debug('Aggregated stats calculated', stats);

    return stats;
  }, [accountStats, adAccounts]);

  // ==========================================================================
  // EVENT HANDLERS
  // ==========================================================================

  const handleAccountClick = useCallback((accountId: string, accountName: string) => {
    logger.info('Account selected', { accountId, accountName });
    setCurrentAdAccountId(accountId);
    navigate('/');
  }, [setCurrentAdAccountId, navigate]);

  const handleAddAccount = useCallback(() => {
    logger.info('Opening onboarding for new account');
    window.dispatchEvent(new CustomEvent('openOnboarding'));
  }, []);

  const handleRefresh = useCallback(() => {
    logger.info('Manual refresh triggered');
    loadAllAccountStats(true);
  }, [loadAllAccountStats]);

  // ==========================================================================
  // RENDER HELPERS
  // ==========================================================================

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'connected':
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Подключён
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800">
            <Clock className="w-3 h-3 mr-1" />
            Ожидает
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800">
            <AlertCircle className="w-3 h-3 mr-1" />
            Ошибка
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900/20 dark:text-gray-400 dark:border-gray-800">
            Неизвестно
          </Badge>
        );
    }
  };

  // ==========================================================================
  // LOADING STATE
  // ==========================================================================

  if (contextLoading || loading) {
    return (
      <div className="bg-background w-full max-w-full overflow-x-hidden">
        <Header onOpenDatePicker={() => setDatePickerOpen(true)} />
        <div className="container mx-auto py-6 px-4 pt-[76px] max-w-full">
          <div className="space-y-6">
            <Skeleton className="h-12 w-64" />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
            <Skeleton className="h-96" />
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // MAIN RENDER
  // ==========================================================================

  return (
    <div className="bg-background w-full max-w-full overflow-x-hidden">
      <Header onOpenDatePicker={() => setDatePickerOpen(true)} />

      <div className="container mx-auto py-6 px-4 pt-[76px] max-w-full">
        {/* Error Banner */}
        {error && (
          <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <p className="text-sm text-yellow-700 dark:text-yellow-300">{error}</p>
            </div>
          </div>
        )}

        {/* Page Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="h-7 w-7 text-primary" />
              Мои рекламные аккаунты
            </h1>
            <p className="text-muted-foreground mt-1">
              Управление всеми вашими рекламными кабинетами
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Обновить данные"
            >
              <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
            </Button>
            <Button onClick={handleAddAccount} className="gap-2">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Добавить аккаунт</span>
            </Button>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <SummaryCard
            title="Общие расходы"
            value={formatCurrency(aggregatedStats.totalSpend)}
            icon={<CircleDollarSign className="w-5 h-5 text-green-600" />}
            subtitle="за выбранный период"
          />
          <SummaryCard
            title="Всего лидов"
            value={formatNumber(aggregatedStats.totalLeads)}
            icon={<Target className="w-5 h-5 text-blue-600" />}
            subtitle="по всем аккаунтам"
          />
          <SummaryCard
            title="Средний CPL"
            value={formatCurrency(aggregatedStats.avgCpl)}
            icon={<MousePointerClick className="w-5 h-5 text-purple-600" />}
            subtitle="стоимость лида"
          />
          <SummaryCard
            title="Активных аккаунтов"
            value={`${aggregatedStats.activeAccountCount} / ${aggregatedStats.accountCount}`}
            icon={<Users className="w-5 h-5 text-amber-600" />}
            subtitle="из всех аккаунтов"
          />
        </div>

        {/* Accounts Table */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Рекламные аккаунты
              {isRefreshing && (
                <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground ml-2" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {accountStats.length === 0 ? (
              <EmptyState onAddAccount={handleAddAccount} />
            ) : (
              <div className="divide-y">
                {/* Table Header */}
                <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 bg-muted/50 text-sm font-medium text-muted-foreground">
                  <div className="col-span-4">Аккаунт</div>
                  <div className="col-span-2 text-right">Расходы</div>
                  <div className="col-span-2 text-right">Лиды</div>
                  <div className="col-span-2 text-right">CPL</div>
                  <div className="col-span-2 text-center">Статус</div>
                </div>

                {/* Account Rows */}
                {accountStats.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    onClick={() => handleAccountClick(account.id, account.name)}
                    getStatusBadge={getStatusBadge}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Help Tip */}
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex items-start gap-3">
            <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
            <div>
              <p className="font-medium text-blue-900 dark:text-blue-100">Совет</p>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Нажмите на любой аккаунт, чтобы перейти к детальной статистике и управлению
                рекламными кампаниями.
              </p>
            </div>
          </div>
        </div>
      </div>

      <DateRangePicker open={datePickerOpen} onOpenChange={setDatePickerOpen} />
    </div>
  );
};

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

interface SummaryCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  subtitle?: string;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ title, value, icon, subtitle }) => {
  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-muted">{icon}</div>
          <p className="text-sm text-muted-foreground">{title}</p>
        </div>
        <p className="text-2xl font-bold">{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
};

interface AccountRowProps {
  account: AccountStats;
  onClick: () => void;
  getStatusBadge: (status: string) => React.ReactNode;
}

const AccountRow: React.FC<AccountRowProps> = ({ account, onClick, getStatusBadge }) => {
  return (
    <div
      className={cn(
        'grid grid-cols-1 md:grid-cols-12 gap-4 px-6 py-4 cursor-pointer transition-colors',
        'hover:bg-muted/50',
        !account.is_active && 'opacity-50'
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Account Info */}
      <div className="col-span-4 flex items-center gap-3">
        <Avatar className="h-10 w-10 border">
          <AvatarImage src={account.page_picture_url || undefined} />
          <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-sm">
            {account.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="font-medium truncate">{account.name}</p>
          <p className="text-xs text-muted-foreground">
            {account.is_active ? 'Активный' : 'Неактивный'}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground ml-auto md:hidden" />
      </div>

      {/* Spend */}
      <div className="col-span-2 flex items-center justify-between md:justify-end">
        <span className="text-sm text-muted-foreground md:hidden">Расходы:</span>
        <span className="font-medium">
          {account.stats ? formatCurrency(account.stats.spend) : '—'}
        </span>
      </div>

      {/* Leads */}
      <div className="col-span-2 flex items-center justify-between md:justify-end">
        <span className="text-sm text-muted-foreground md:hidden">Лиды:</span>
        <span className="font-medium">
          {account.stats ? formatNumber(account.stats.leads) : '—'}
        </span>
      </div>

      {/* CPL */}
      <div className="col-span-2 flex items-center justify-between md:justify-end">
        <span className="text-sm text-muted-foreground md:hidden">CPL:</span>
        <span className="font-medium">
          {account.stats ? formatCurrency(account.stats.cpl) : '—'}
        </span>
      </div>

      {/* Status */}
      <div className="col-span-2 flex items-center justify-between md:justify-center">
        <span className="text-sm text-muted-foreground md:hidden">Статус:</span>
        {getStatusBadge(account.connection_status)}
      </div>
    </div>
  );
};

interface EmptyStateProps {
  onAddAccount: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ onAddAccount }) => {
  return (
    <div className="p-8 text-center">
      <Building2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
      <h3 className="text-lg font-medium mb-2">Нет рекламных аккаунтов</h3>
      <p className="text-muted-foreground mb-4">
        Добавьте первый рекламный аккаунт для начала работы
      </p>
      <Button onClick={onAddAccount}>
        <Plus className="h-4 w-4 mr-2" />
        Добавить аккаунт
      </Button>
    </div>
  );
};

export default MultiAccountDashboard;
