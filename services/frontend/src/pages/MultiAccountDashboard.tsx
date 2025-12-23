import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { useTranslation } from '../i18n/LanguageContext';
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
} from 'lucide-react';
import { formatCurrency, formatNumber } from '../utils/formatters';
import { cn } from '@/lib/utils';
import { API_BASE_URL } from '@/config/api';
import DateRangePicker from '../components/DateRangePicker';

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

const MultiAccountDashboard: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    adAccounts,
    setCurrentAdAccountId,
    dateRange,
    loading: contextLoading,
  } = useAppContext();

  const [accountStats, setAccountStats] = useState<AccountStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // Загрузка статистики для всех аккаунтов
  useEffect(() => {
    const loadAllAccountStats = async () => {
      if (!adAccounts || adAccounts.length === 0) {
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const userData = localStorage.getItem('user');
        if (!userData) {
          setLoading(false);
          return;
        }

        const user = JSON.parse(userData);

        // Запрос статистики для всех аккаунтов
        const response = await fetch(
          `${API_BASE_URL}/ad-accounts/${user.id}/all-stats?since=${dateRange.since}&until=${dateRange.until}`
        );

        if (response.ok) {
          const data = await response.json();
          setAccountStats(data.accounts || []);
        } else {
          // Если endpoint не существует, создаём заглушки из adAccounts
          const fallbackStats: AccountStats[] = adAccounts.map((acc) => ({
            id: acc.id,
            name: acc.name,
            page_picture_url: acc.page_picture_url || null,
            connection_status: acc.connection_status || 'pending',
            is_active: acc.is_active !== false,
            stats: null,
          }));
          setAccountStats(fallbackStats);
        }
      } catch (error) {
        console.error('Ошибка загрузки статистики аккаунтов:', error);
        // Fallback
        const fallbackStats: AccountStats[] = adAccounts.map((acc) => ({
          id: acc.id,
          name: acc.name,
          page_picture_url: acc.page_picture_url || null,
          connection_status: acc.connection_status || 'pending',
          is_active: acc.is_active !== false,
          stats: null,
        }));
        setAccountStats(fallbackStats);
      } finally {
        setLoading(false);
      }
    };

    loadAllAccountStats();
  }, [adAccounts, dateRange]);

  // Агрегированная статистика
  const aggregatedStats = useMemo<AggregatedStats>(() => {
    const activeAccounts = accountStats.filter((acc) => acc.is_active);
    const accountsWithStats = activeAccounts.filter((acc) => acc.stats !== null);

    const totalSpend = accountsWithStats.reduce((sum, acc) => sum + (acc.stats?.spend || 0), 0);
    const totalLeads = accountsWithStats.reduce((sum, acc) => sum + (acc.stats?.leads || 0), 0);
    const totalImpressions = accountsWithStats.reduce(
      (sum, acc) => sum + (acc.stats?.impressions || 0),
      0
    );

    return {
      totalSpend,
      totalLeads,
      totalImpressions,
      avgCpl: totalLeads > 0 ? totalSpend / totalLeads : 0,
      accountCount: adAccounts.length,
      activeAccountCount: activeAccounts.length,
    };
  }, [accountStats, adAccounts]);

  // Обработчик клика на аккаунт
  const handleAccountClick = (accountId: string) => {
    setCurrentAdAccountId(accountId);
    navigate('/');
  };

  // Добавить новый аккаунт
  const handleAddAccount = () => {
    window.dispatchEvent(new CustomEvent('openOnboarding'));
  };

  // Статус подключения
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'connected':
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Подключён
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
            <Clock className="w-3 h-3 mr-1" />
            Ожидает
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
            <AlertCircle className="w-3 h-3 mr-1" />
            Ошибка
          </Badge>
        );
      default:
        return null;
    }
  };

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

  return (
    <div className="bg-background w-full max-w-full overflow-x-hidden">
      <Header onOpenDatePicker={() => setDatePickerOpen(true)} />

      <div className="container mx-auto py-6 px-4 pt-[76px] max-w-full">
        {/* Заголовок страницы */}
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
          <Button onClick={handleAddAccount} className="gap-2">
            <Plus className="h-4 w-4" />
            Добавить аккаунт
          </Button>
        </div>

        {/* Общая статистика */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <SummaryCard
            title="Общие расходы"
            value={formatCurrency(aggregatedStats.totalSpend)}
            icon={<CircleDollarSign className="w-5 h-5 text-green-600" />}
            subtitle={`за выбранный период`}
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

        {/* Таблица аккаунтов в стиле Facebook Apps Manager */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Рекламные аккаунты
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {accountStats.length === 0 ? (
              <div className="p-8 text-center">
                <Building2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                <h3 className="text-lg font-medium mb-2">Нет рекламных аккаунтов</h3>
                <p className="text-muted-foreground mb-4">
                  Добавьте первый рекламный аккаунт для начала работы
                </p>
                <Button onClick={handleAddAccount}>
                  <Plus className="h-4 w-4 mr-2" />
                  Добавить аккаунт
                </Button>
              </div>
            ) : (
              <div className="divide-y">
                {/* Заголовок таблицы */}
                <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 bg-muted/50 text-sm font-medium text-muted-foreground">
                  <div className="col-span-4">Аккаунт</div>
                  <div className="col-span-2 text-right">Расходы</div>
                  <div className="col-span-2 text-right">Лиды</div>
                  <div className="col-span-2 text-right">CPL</div>
                  <div className="col-span-2 text-center">Статус</div>
                </div>

                {/* Строки аккаунтов */}
                {accountStats.map((account) => (
                  <div
                    key={account.id}
                    className={cn(
                      'grid grid-cols-1 md:grid-cols-12 gap-4 px-6 py-4 cursor-pointer transition-colors',
                      'hover:bg-muted/50',
                      !account.is_active && 'opacity-50'
                    )}
                    onClick={() => handleAccountClick(account.id)}
                  >
                    {/* Аккаунт */}
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

                    {/* Расходы */}
                    <div className="col-span-2 flex items-center justify-between md:justify-end">
                      <span className="text-sm text-muted-foreground md:hidden">Расходы:</span>
                      <span className="font-medium">
                        {account.stats ? formatCurrency(account.stats.spend) : '—'}
                      </span>
                    </div>

                    {/* Лиды */}
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

                    {/* Статус */}
                    <div className="col-span-2 flex items-center justify-between md:justify-center">
                      <span className="text-sm text-muted-foreground md:hidden">Статус:</span>
                      {getStatusBadge(account.connection_status)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Подсказка */}
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

// Компонент карточки сводной статистики
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

export default MultiAccountDashboard;
