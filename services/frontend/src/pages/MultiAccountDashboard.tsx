import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import Header from '../components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BarChart3,
  ChevronRight,
  ChevronDown,
  Plus,
  AlertCircle,
  TrendingUp,
  RefreshCw,
  Loader2,
  Megaphone,
} from 'lucide-react';
import { formatCurrency, formatNumber } from '../utils/formatters';
import { cn } from '@/lib/utils';
import { API_BASE_URL } from '@/config/api';
import DateRangePicker from '../components/DateRangePicker';
import { toast } from 'sonner';
import { facebookApi } from '@/services/facebookApi';

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
    ctr: number; // Click-through rate (%)
    cpm: number; // Cost per mille
  } | null;
}

interface CampaignStats {
  campaign_id: string;
  campaign_name: string;
  spend: number;
  leads: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpl: number;
}

interface AdsetStats {
  adset_id: string;
  adset_name: string;
  spend: number;
  leads: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpl: number;
}

interface AdStats {
  ad_id: string;
  ad_name: string;
  spend: number;
  leads: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpl: number;
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

  // Hierarchical state (матрёшка)
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [campaignsData, setCampaignsData] = useState<Record<string, CampaignStats[]>>({});
  const [campaignsLoading, setCampaignsLoading] = useState<Set<string>>(new Set());

  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const [adsetsData, setAdsetsData] = useState<Record<string, AdsetStats[]>>({});
  const [adsetsLoading, setAdsetsLoading] = useState<Set<string>>(new Set());

  const [expandedAdsets, setExpandedAdsets] = useState<Set<string>>(new Set());
  const [adsData, setAdsData] = useState<Record<string, AdStats[]>>({});
  const [adsLoading, setAdsLoading] = useState<Set<string>>(new Set());

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

  // Автозагрузка кампаний для всех аккаунтов для отображения статистики
  const loadedAccountsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const loadAllCampaigns = async () => {
      if (accountStats.length === 0) return;

      for (const account of accountStats) {
        // Пропускаем если уже загружено
        if (loadedAccountsRef.current.has(account.id)) continue;
        loadedAccountsRef.current.add(account.id);

        setCampaignsLoading((prev) => new Set(prev).add(account.id));

        try {
          const storedAdAccounts = localStorage.getItem('adAccounts');
          const adAccountsList = storedAdAccounts ? JSON.parse(storedAdAccounts) : [];
          const accountData = adAccountsList.find((a: any) => a.id === account.id);

          if (!accountData) continue;

          const previousAccountId = localStorage.getItem('currentAdAccountId');
          localStorage.setItem('currentAdAccountId', account.id);

          try {
            const campaignsList = await facebookApi.getCampaigns();
            const activeCampaignIds = new Set(
              campaignsList.filter((c) => c.status === 'ACTIVE').map((c) => c.id)
            );

            const campaigns = await facebookApi.getCampaignStats(dateRange, false);

            const campaignStats: CampaignStats[] = campaigns
              .filter((c) => activeCampaignIds.has(c.campaign_id))
              .map((c) => ({
                campaign_id: c.campaign_id,
                campaign_name: c.campaign_name,
                spend: c.spend,
                leads: c.leads,
                impressions: c.impressions,
                clicks: c.clicks,
                ctr: c.ctr,
                cpl: c.cpl,
              }));

            setCampaignsData((prev) => ({ ...prev, [account.id]: campaignStats }));
          } finally {
            if (previousAccountId) {
              localStorage.setItem('currentAdAccountId', previousAccountId);
            }
          }
        } catch (err) {
          logger.warn('Failed to preload campaigns for account', { accountId: account.id });
          setCampaignsData((prev) => ({ ...prev, [account.id]: [] }));
        } finally {
          setCampaignsLoading((prev) => {
            const next = new Set(prev);
            next.delete(account.id);
            return next;
          });
        }
      }
    };

    loadAllCampaigns();
  }, [accountStats, dateRange]);

  // Сброс загруженных аккаунтов при смене dateRange
  useEffect(() => {
    loadedAccountsRef.current.clear();
    setCampaignsData({});
  }, [dateRange]);

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
  // HIERARCHICAL EXPANSION HANDLERS
  // ==========================================================================

  const handleAccountExpand = useCallback(async (accountId: string, account: AccountStats) => {
    const isExpanded = expandedAccounts.has(accountId);

    if (isExpanded) {
      // Collapse
      setExpandedAccounts((prev) => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    } else {
      // Expand - load campaigns if not loaded
      setExpandedAccounts((prev) => new Set(prev).add(accountId));

      if (!campaignsData[accountId] && !campaignsLoading.has(accountId)) {
        setCampaignsLoading((prev) => new Set(prev).add(accountId));

        try {
          // Temporarily switch to this account's context
          const storedAdAccounts = localStorage.getItem('adAccounts');
          const adAccountsList = storedAdAccounts ? JSON.parse(storedAdAccounts) : [];
          const accountData = adAccountsList.find((a: any) => a.id === accountId);

          if (!accountData) {
            throw new Error('Account not found in localStorage');
          }

          // Set this account as current for API calls
          const previousAccountId = localStorage.getItem('currentAdAccountId');
          localStorage.setItem('currentAdAccountId', accountId);

          try {
            // Получаем список кампаний с их статусами
            const campaignsList = await facebookApi.getCampaigns();
            const activeCampaignIds = new Set(
              campaignsList.filter((c) => c.status === 'ACTIVE').map((c) => c.id)
            );

            // Получаем статистику кампаний
            const campaigns = await facebookApi.getCampaignStats(dateRange, false);

            // Фильтруем только активные кампании
            const campaignStats: CampaignStats[] = campaigns
              .filter((c) => activeCampaignIds.has(c.campaign_id))
              .map((c) => ({
                campaign_id: c.campaign_id,
                campaign_name: c.campaign_name,
                spend: c.spend,
                leads: c.leads,
                impressions: c.impressions,
                clicks: c.clicks,
                ctr: c.ctr,
                cpl: c.cpl,
              }));

            setCampaignsData((prev) => ({ ...prev, [accountId]: campaignStats }));
          } finally {
            // Restore previous account
            if (previousAccountId) {
              localStorage.setItem('currentAdAccountId', previousAccountId);
            }
          }
        } catch (err) {
          logger.error('Failed to load campaigns', err, { accountId });
          setCampaignsData((prev) => ({ ...prev, [accountId]: [] }));
        } finally {
          setCampaignsLoading((prev) => {
            const next = new Set(prev);
            next.delete(accountId);
            return next;
          });
        }
      }
    }
  }, [expandedAccounts, campaignsData, campaignsLoading, dateRange]);

  const handleCampaignExpand = useCallback(async (campaignId: string, accountId: string) => {
    const isExpanded = expandedCampaigns.has(campaignId);

    if (isExpanded) {
      setExpandedCampaigns((prev) => {
        const next = new Set(prev);
        next.delete(campaignId);
        return next;
      });
    } else {
      setExpandedCampaigns((prev) => new Set(prev).add(campaignId));

      if (!adsetsData[campaignId] && !adsetsLoading.has(campaignId)) {
        setAdsetsLoading((prev) => new Set(prev).add(campaignId));

        try {
          const previousAccountId = localStorage.getItem('currentAdAccountId');
          localStorage.setItem('currentAdAccountId', accountId);

          try {
            // Получаем список адсетов с их статусами
            const adsetsList = await facebookApi.getAdsetsByCampaign(campaignId);
            const activeAdsetIds = new Set(
              adsetsList.filter((a: any) => a.status === 'ACTIVE').map((a: any) => a.id)
            );

            // Получаем статистику адсетов
            const adsets = await facebookApi.getAdsetStats(campaignId, dateRange);

            // Фильтруем только активные адсеты
            const adsetStats: AdsetStats[] = adsets
              .filter((a: any) => activeAdsetIds.has(a.adset_id))
              .map((a: any) => ({
                adset_id: a.adset_id,
                adset_name: a.adset_name,
                spend: a.spend || 0,
                leads: a.leads || 0,
                impressions: a.impressions || 0,
                clicks: a.clicks || 0,
                ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
                cpl: a.cpl || 0,
              }));

            setAdsetsData((prev) => ({ ...prev, [campaignId]: adsetStats }));
          } finally {
            if (previousAccountId) {
              localStorage.setItem('currentAdAccountId', previousAccountId);
            }
          }
        } catch (err) {
          logger.error('Failed to load adsets', err, { campaignId });
          setAdsetsData((prev) => ({ ...prev, [campaignId]: [] }));
        } finally {
          setAdsetsLoading((prev) => {
            const next = new Set(prev);
            next.delete(campaignId);
            return next;
          });
        }
      }
    }
  }, [expandedCampaigns, adsetsData, adsetsLoading, dateRange]);

  const handleAdsetExpand = useCallback(async (adsetId: string, accountId: string) => {
    const isExpanded = expandedAdsets.has(adsetId);

    if (isExpanded) {
      setExpandedAdsets((prev) => {
        const next = new Set(prev);
        next.delete(adsetId);
        return next;
      });
    } else {
      setExpandedAdsets((prev) => new Set(prev).add(adsetId));

      if (!adsData[adsetId] && !adsLoading.has(adsetId)) {
        setAdsLoading((prev) => new Set(prev).add(adsetId));

        try {
          const previousAccountId = localStorage.getItem('currentAdAccountId');
          localStorage.setItem('currentAdAccountId', accountId);

          try {
            // Получаем список объявлений с их статусами
            const adsList = await facebookApi.getAdsByAdset(adsetId);
            const activeAdIds = new Set(
              adsList.filter((a) => a.status === 'ACTIVE').map((a) => a.id)
            );

            // Получаем статистику объявлений
            const ads = await facebookApi.getAdStatsByAdset(adsetId, dateRange);

            // Фильтруем только активные объявления
            const adStats: AdStats[] = ads
              .filter((a) => activeAdIds.has(a.ad_id))
              .map((a) => ({
                ad_id: a.ad_id,
                ad_name: a.ad_name,
                spend: a.spend || 0,
                leads: a.leads || 0,
                impressions: a.impressions || 0,
                clicks: a.clicks || 0,
                ctr: a.ctr || 0,
                cpl: a.cpl || 0,
              }));

            setAdsData((prev) => ({ ...prev, [adsetId]: adStats }));
          } finally {
            if (previousAccountId) {
              localStorage.setItem('currentAdAccountId', previousAccountId);
            }
          }
        } catch (err) {
          logger.error('Failed to load ads', err, { adsetId });
          setAdsData((prev) => ({ ...prev, [adsetId]: [] }));
        } finally {
          setAdsLoading((prev) => {
            const next = new Set(prev);
            next.delete(adsetId);
            return next;
          });
        }
      }
    }
  }, [expandedAdsets, adsData, adsLoading, dateRange]);

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

        {/* Page Header - только кнопки */}
        <div className="flex items-center justify-end mb-4 gap-2">
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
                <div className="hidden md:grid grid-cols-11 gap-2 px-6 py-3 bg-muted/50 text-sm font-medium text-muted-foreground">
                  <div className="col-span-3">Аккаунт</div>
                  <div className="col-span-2 text-right">Расходы</div>
                  <div className="col-span-1 text-right">Лиды</div>
                  <div className="col-span-2 text-right">CPL</div>
                  <div className="col-span-1 text-right">CTR</div>
                  <div className="col-span-2 text-right">CPM</div>
                </div>

                {/* Account Rows */}
                {accountStats.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    onClick={() => handleAccountClick(account.id, account.name)}
                    isExpanded={expandedAccounts.has(account.id)}
                    onExpand={() => handleAccountExpand(account.id, account)}
                    isLoading={campaignsLoading.has(account.id)}
                    campaigns={campaignsData[account.id] || []}
                    expandedCampaigns={expandedCampaigns}
                    onCampaignExpand={(campaignId) => handleCampaignExpand(campaignId, account.id)}
                    campaignsLoading={adsetsLoading}
                    adsetsData={adsetsData}
                    expandedAdsets={expandedAdsets}
                    onAdsetExpand={(adsetId) => handleAdsetExpand(adsetId, account.id)}
                    adsLoading={adsLoading}
                    adsData={adsData}
                    dateRange={dateRange}
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

interface AccountRowProps {
  account: AccountStats;
  onClick: () => void;
  isExpanded: boolean;
  onExpand: () => void;
  isLoading: boolean;
  campaigns: CampaignStats[];
  expandedCampaigns: Set<string>;
  onCampaignExpand: (campaignId: string) => void;
  campaignsLoading: Set<string>;
  adsetsData: Record<string, AdsetStats[]>;
  expandedAdsets: Set<string>;
  onAdsetExpand: (adsetId: string) => void;
  adsLoading: Set<string>;
  adsData: Record<string, AdStats[]>;
  dateRange: { since: string; until: string };
}

const AccountRow: React.FC<AccountRowProps> = ({
  account,
  onClick,
  isExpanded,
  onExpand,
  isLoading,
  campaigns,
  expandedCampaigns,
  onCampaignExpand,
  campaignsLoading,
  adsetsData,
  expandedAdsets,
  onAdsetExpand,
  adsLoading,
  adsData,
}) => {
  const [imageError, setImageError] = useState(false);

  // Форматирование CTR
  const formatCtr = (ctr: number) => `${ctr.toFixed(2)}%`;
  // Форматирование CPM
  const formatCpm = (cpm: number) => formatCurrency(cpm);

  // Рассчитываем статистику аккаунта как сумму всех кампаний
  const calculatedStats = campaigns.length > 0 ? {
    spend: campaigns.reduce((sum, c) => sum + c.spend, 0),
    leads: campaigns.reduce((sum, c) => sum + c.leads, 0),
    impressions: campaigns.reduce((sum, c) => sum + c.impressions, 0),
    clicks: campaigns.reduce((sum, c) => sum + c.clicks, 0),
    get cpl() { return this.leads > 0 ? this.spend / this.leads : 0; },
    get ctr() { return this.impressions > 0 ? (this.clicks / this.impressions) * 100 : 0; },
    get cpm() { return this.impressions > 0 ? (this.spend / this.impressions) * 1000 : 0; },
  } : null;

  // Используем рассчитанные данные если есть кампании, иначе данные с бэкенда
  const stats = calculatedStats || account.stats;

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onExpand();
  };

  return (
    <div className="divide-y divide-muted/50">
      {/* Account Row */}
      <div
        className={cn(
          'grid grid-cols-1 md:grid-cols-11 gap-2 px-6 py-4 cursor-pointer transition-colors',
          'hover:bg-muted/50',
          !account.is_active && 'opacity-50',
          isExpanded && 'bg-muted/30'
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
        <div className="col-span-3 flex items-center gap-2">
          <button
            onClick={handleExpandClick}
            className="p-1 hover:bg-muted rounded transition-colors"
            aria-label={isExpanded ? 'Свернуть' : 'Развернуть'}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          <Avatar className="h-8 w-8 border flex-shrink-0">
            {!imageError && account.page_picture_url && (
              <AvatarImage
                src={account.page_picture_url}
                onError={() => setImageError(true)}
              />
            )}
            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-xs">
              {account.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="font-medium truncate text-sm">{account.name}</p>
          </div>
        </div>

        {/* Spend */}
        <div className="col-span-2 flex items-center justify-between md:justify-end">
          <span className="text-sm text-muted-foreground md:hidden">Расходы:</span>
          <span className="font-medium text-sm">
            {stats ? formatCurrency(stats.spend) : '—'}
          </span>
        </div>

        {/* Leads */}
        <div className="col-span-1 flex items-center justify-between md:justify-end">
          <span className="text-sm text-muted-foreground md:hidden">Лиды:</span>
          <span className="font-medium text-sm">
            {stats ? formatNumber(stats.leads) : '—'}
          </span>
        </div>

        {/* CPL */}
        <div className="col-span-2 flex items-center justify-between md:justify-end">
          <span className="text-sm text-muted-foreground md:hidden">CPL:</span>
          <span className="font-medium text-sm">
            {stats ? formatCurrency(stats.cpl) : '—'}
          </span>
        </div>

        {/* CTR */}
        <div className="col-span-1 flex items-center justify-between md:justify-end">
          <span className="text-sm text-muted-foreground md:hidden">CTR:</span>
          <span className="font-medium text-sm">
            {stats ? formatCtr(stats.ctr) : '—'}
          </span>
        </div>

        {/* CPM */}
        <div className="col-span-2 flex items-center justify-between md:justify-end">
          <span className="text-sm text-muted-foreground md:hidden">CPM:</span>
          <span className="font-medium text-sm">
            {stats ? formatCpm(stats.cpm) : '—'}
          </span>
        </div>
      </div>

      {/* Expanded Campaigns */}
      {isExpanded && (
        <div className="bg-muted/20">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
              <span className="text-sm text-muted-foreground">Загрузка кампаний...</span>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="flex items-center justify-center py-4">
              <span className="text-sm text-muted-foreground">Нет кампаний за выбранный период</span>
            </div>
          ) : (
            campaigns.map((campaign) => (
              <CampaignRow
                key={campaign.campaign_id}
                campaign={campaign}
                isExpanded={expandedCampaigns.has(campaign.campaign_id)}
                onExpand={() => onCampaignExpand(campaign.campaign_id)}
                isLoading={campaignsLoading.has(campaign.campaign_id)}
                adsets={adsetsData[campaign.campaign_id] || []}
                expandedAdsets={expandedAdsets}
                onAdsetExpand={onAdsetExpand}
                adsLoading={adsLoading}
                adsData={adsData}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// CAMPAIGN ROW
// =============================================================================

interface CampaignRowProps {
  campaign: CampaignStats;
  isExpanded: boolean;
  onExpand: () => void;
  isLoading: boolean;
  adsets: AdsetStats[];
  expandedAdsets: Set<string>;
  onAdsetExpand: (adsetId: string) => void;
  adsLoading: Set<string>;
  adsData: Record<string, AdStats[]>;
}

const CampaignRow: React.FC<CampaignRowProps> = ({
  campaign,
  isExpanded,
  onExpand,
  isLoading,
  adsets,
  expandedAdsets,
  onAdsetExpand,
  adsLoading,
  adsData,
}) => {
  const formatCtr = (ctr: number) => `${ctr.toFixed(2)}%`;
  const formatCpm = (impressions: number, spend: number) => {
    const calculatedCpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    return formatCurrency(calculatedCpm);
  };

  return (
    <div className="divide-y divide-muted/30">
      <div
        className={cn(
          'grid grid-cols-1 md:grid-cols-11 gap-2 px-6 py-3 cursor-pointer transition-colors',
          'hover:bg-muted/40 pl-12',
          isExpanded && 'bg-muted/30'
        )}
        onClick={onExpand}
        role="button"
        tabIndex={0}
      >
        {/* Campaign Info */}
        <div className="col-span-3 flex items-center gap-2">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Megaphone className="h-4 w-4 text-blue-500" />
          <span className="font-medium text-sm truncate">{campaign.campaign_name}</span>
        </div>

        {/* Spend */}
        <div className="col-span-2 flex items-center justify-end">
          <span className="text-sm">{formatCurrency(campaign.spend)}</span>
        </div>

        {/* Leads */}
        <div className="col-span-1 flex items-center justify-end">
          <span className="text-sm">{formatNumber(campaign.leads)}</span>
        </div>

        {/* CPL */}
        <div className="col-span-2 flex items-center justify-end">
          <span className="text-sm">{formatCurrency(campaign.cpl)}</span>
        </div>

        {/* CTR */}
        <div className="col-span-1 flex items-center justify-end">
          <span className="text-sm">{formatCtr(campaign.ctr)}</span>
        </div>

        {/* CPM */}
        <div className="col-span-2 flex items-center justify-end">
          <span className="text-sm">{formatCpm(campaign.impressions, campaign.spend)}</span>
        </div>
      </div>

      {/* Expanded Adsets */}
      {isExpanded && (
        <div className="bg-muted/10">
          {isLoading ? (
            <div className="flex items-center justify-center py-3 pl-16">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
              <span className="text-sm text-muted-foreground">Загрузка адсетов...</span>
            </div>
          ) : adsets.length === 0 ? (
            <div className="flex items-center justify-center py-3 pl-16">
              <span className="text-sm text-muted-foreground">Нет адсетов за выбранный период</span>
            </div>
          ) : (
            adsets.map((adset) => (
              <AdsetRow
                key={adset.adset_id}
                adset={adset}
                isExpanded={expandedAdsets.has(adset.adset_id)}
                onExpand={() => onAdsetExpand(adset.adset_id)}
                isLoading={adsLoading.has(adset.adset_id)}
                ads={adsData[adset.adset_id] || []}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// ADSET ROW
// =============================================================================

interface AdsetRowProps {
  adset: AdsetStats;
  isExpanded: boolean;
  onExpand: () => void;
  isLoading: boolean;
  ads: AdStats[];
}

const AdsetRow: React.FC<AdsetRowProps> = ({
  adset,
  isExpanded,
  onExpand,
  isLoading,
  ads,
}) => {
  const formatCtr = (ctr: number) => `${ctr.toFixed(2)}%`;
  const formatCpm = (impressions: number, spend: number) => {
    const calculatedCpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    return formatCurrency(calculatedCpm);
  };

  return (
    <div className="divide-y divide-muted/20">
      <div
        className={cn(
          'grid grid-cols-1 md:grid-cols-11 gap-2 px-6 py-2 cursor-pointer transition-colors',
          'hover:bg-muted/30 pl-20',
          isExpanded && 'bg-muted/20'
        )}
        onClick={onExpand}
        role="button"
        tabIndex={0}
      >
        {/* Adset Info */}
        <div className="col-span-3 flex items-center gap-2">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">
            adset
          </Badge>
          <span className="text-sm truncate">{adset.adset_name}</span>
        </div>

        {/* Spend */}
        <div className="col-span-2 flex items-center justify-end">
          <span className="text-sm text-muted-foreground">{formatCurrency(adset.spend)}</span>
        </div>

        {/* Leads */}
        <div className="col-span-1 flex items-center justify-end">
          <span className="text-sm text-muted-foreground">{formatNumber(adset.leads)}</span>
        </div>

        {/* CPL */}
        <div className="col-span-2 flex items-center justify-end">
          <span className="text-sm text-muted-foreground">{formatCurrency(adset.cpl)}</span>
        </div>

        {/* CTR */}
        <div className="col-span-1 flex items-center justify-end">
          <span className="text-sm text-muted-foreground">{formatCtr(adset.ctr)}</span>
        </div>

        {/* CPM */}
        <div className="col-span-2 flex items-center justify-end">
          <span className="text-sm text-muted-foreground">{formatCpm(adset.impressions, adset.spend)}</span>
        </div>
      </div>

      {/* Expanded Ads */}
      {isExpanded && (
        <div className="bg-muted/5">
          {isLoading ? (
            <div className="flex items-center justify-center py-2 pl-24">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
              <span className="text-sm text-muted-foreground">Загрузка объявлений...</span>
            </div>
          ) : ads.length === 0 ? (
            <div className="flex items-center justify-center py-2 pl-24">
              <span className="text-sm text-muted-foreground">Нет объявлений за выбранный период</span>
            </div>
          ) : (
            ads.map((ad) => (
              <AdRow key={ad.ad_id} ad={ad} />
            ))
          )}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// AD ROW
// =============================================================================

interface AdRowProps {
  ad: AdStats;
}

const AdRow: React.FC<AdRowProps> = ({ ad }) => {
  const formatCtr = (ctr: number) => `${ctr.toFixed(2)}%`;
  const formatCpm = (impressions: number, spend: number) => {
    const calculatedCpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    return formatCurrency(calculatedCpm);
  };

  return (
    <div
      className={cn(
        'grid grid-cols-1 md:grid-cols-11 gap-2 px-6 py-2 transition-colors',
        'hover:bg-muted/20 pl-28'
      )}
    >
      {/* Ad Info */}
      <div className="col-span-3 flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800">
          ad
        </Badge>
        <span className="text-xs truncate text-muted-foreground">{ad.ad_name}</span>
      </div>

      {/* Spend */}
      <div className="col-span-2 flex items-center justify-end">
        <span className="text-xs text-muted-foreground/70">{formatCurrency(ad.spend)}</span>
      </div>

      {/* Leads */}
      <div className="col-span-1 flex items-center justify-end">
        <span className="text-xs text-muted-foreground/70">{formatNumber(ad.leads)}</span>
      </div>

      {/* CPL */}
      <div className="col-span-2 flex items-center justify-end">
        <span className="text-xs text-muted-foreground/70">{formatCurrency(ad.cpl)}</span>
      </div>

      {/* CTR */}
      <div className="col-span-1 flex items-center justify-end">
        <span className="text-xs text-muted-foreground/70">{formatCtr(ad.ctr)}</span>
      </div>

      {/* CPM */}
      <div className="col-span-2 flex items-center justify-end">
        <span className="text-xs text-muted-foreground/70">{formatCpm(ad.impressions, ad.spend)}</span>
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
