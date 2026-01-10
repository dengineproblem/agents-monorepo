import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import Header from '../components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  BarChart3,
  Building2,
  ChevronRight,
  ChevronDown,
  Plus,
  AlertCircle,
  RefreshCw,
  Loader2,
  Megaphone,
  ImageIcon,
} from 'lucide-react';
import { formatCurrency, formatNumber } from '../utils/formatters';
import { cn } from '@/lib/utils';
import { API_BASE_URL } from '@/config/api';
import DateRangePicker from '../components/DateRangePicker';
import { toast } from 'sonner';
import { facebookApi } from '@/services/facebookApi';
import { useOptimization, type OptimizationScope } from '@/hooks/useOptimization';
import { OptimizeButton, OptimizationModal } from '@/components/optimization';

// =============================================================================
// TYPES
// =============================================================================

// Facebook account_status codes:
// 1 = ACTIVE, 2 = DISABLED, 3 = UNSETTLED (задолженность)
// 7 = PENDING_RISK_REVIEW, 8 = PENDING_SETTLEMENT, 9 = IN_GRACE_PERIOD
// 100 = PENDING_CLOSURE, 101 = CLOSED
type FbAccountStatus = 1 | 2 | 3 | 7 | 8 | 9 | 100 | 101 | null;

interface AccountStats {
  id: string;
  name: string;
  fb_page_id: string | null;
  connection_status: 'pending' | 'connected' | 'error';
  is_active: boolean;
  fb_account_status: FbAccountStatus;
  fb_disable_reason: number | null;
  stats: {
    spend: number;
    leads: number;
    impressions: number;
    clicks: number;
    cpl: number;
    ctr: number; // Click-through rate (%)
    cpm: number; // Cost per mille
    messagingLeads: number;
    qualityLeads: number;
    cpql: number; // Cost per qualified lead
    qualityRate: number; // Quality rate percentage
  } | null;
}

interface CampaignStats {
  campaign_id: string;
  campaign_name: string;
  status?: string; // ACTIVE, PAUSED, etc.
  spend: number;
  leads: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpl: number;
  messagingLeads: number;
  qualityLeads: number;
  cpql: number;
  qualityRate: number;
  daily_budget: number; // Сумма бюджетов адсетов кампании
}

interface AdsetStats {
  adset_id: string;
  adset_name: string;
  status?: string; // ACTIVE, PAUSED, etc.
  spend: number;
  leads: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpl: number;
  messagingLeads: number;
  qualityLeads: number;
  cpql: number;
  qualityRate: number;
  daily_budget: number; // Установленный бюджет адсета
}

interface AdStats {
  ad_id: string;
  ad_name: string;
  status?: string; // ACTIVE, PAUSED, etc.
  thumbnail_url?: string | null; // Миниатюра креатива
  spend: number;
  leads: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpl: number;
  messagingLeads: number;
  qualityLeads: number;
  cpql: number;
  qualityRate: number;
}

interface Direction {
  id: string;
  name: string;
  fb_campaign_id: string | null;
  target_cpl_cents: number;
  daily_budget_cents: number;
  objective: string;
  is_active: boolean;
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

/**
 * Рассчитать отклонение CPL от target_cpl в процентах
 */
function calculateCplDeviation(
  actualCpl: number,
  targetCplCents: number
): { deviation: number; formattedText: string } | null {
  if (!targetCplCents || actualCpl === 0) return null;

  const targetCpl = targetCplCents / 100; // центы → доллары
  const deviation = ((actualCpl - targetCpl) / targetCpl) * 100;

  const sign = deviation > 0 ? '+' : '';
  const formattedText = `${sign}${deviation.toFixed(0)}%`;

  return { deviation, formattedText };
}

/**
 * Получить информацию о статусе Facebook аккаунта для отображения
 */
function getFbAccountStatusInfo(status: FbAccountStatus): {
  label: string;
  variant: 'destructive' | 'warning' | 'secondary';
  show: boolean;
} | null {
  if (status === null || status === 1) return null; // ACTIVE или неизвестно

  const statusMap: Record<number, { label: string; variant: 'destructive' | 'warning' | 'secondary' }> = {
    2: { label: 'Отключён', variant: 'destructive' },
    3: { label: 'Задолженность', variant: 'destructive' },
    7: { label: 'Проверка', variant: 'warning' },
    8: { label: 'Ожидание оплаты', variant: 'warning' },
    9: { label: 'Льготный период', variant: 'warning' },
    100: { label: 'Закрывается', variant: 'destructive' },
    101: { label: 'Закрыт', variant: 'secondary' },
  };

  const info = statusMap[status];
  return info ? { ...info, show: true } : null;
}

/**
 * Получить target_cpl для уровня
 * На уровне кампании: ищем direction по fb_campaign_id
 * На уровне аккаунта: если только 1 direction - используем его, иначе null
 */
function getTargetCplForLevel(
  campaignId: string | null,
  directions: Direction[]
): number | null {
  if (!directions || directions.length === 0) return null;

  if (campaignId) {
    // Уровень кампании
    const direction = directions.find((d) => d.fb_campaign_id === campaignId);
    return direction?.target_cpl_cents || null;
  } else {
    // Уровень аккаунта: если 1 direction - вернуть, иначе null
    return directions.length === 1 ? directions[0].target_cpl_cents : null;
  }
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

  // Directions data
  const [directionsData, setDirectionsData] = useState<Record<string, Direction[]>>({});
  const [directionsLoading, setDirectionsLoading] = useState<Set<string>>(new Set());

  // Optimization hook
  const optimization = useOptimization();

  // Ref для отмены запроса при размонтировании
  const abortControllerRef = useRef<AbortController | null>(null);

  // Session ID для отмены предыдущих загрузок при refresh
  const sessionIdRef = useRef(Date.now());

  // ОПТИМИЗАЦИЯ: Кэш списков кампаний (не зависит от dateRange)
  // При смене dateRange очищается только статистика, списки остаются
  // MAX_LIST_CACHE_SIZE ограничивает размер каждого кэша
  const MAX_LIST_CACHE_SIZE = 200;

  interface CampaignListEntry {
    id: string;
    name: string;
    status: string;
  }
  const campaignsListCacheRef = useRef<Map<string, CampaignListEntry[]>>(new Map());
  const adsetsListCacheRef = useRef<Map<string, { id: string; name: string; status: string; daily_budget: number }[]>>(new Map());
  const adsListCacheRef = useRef<Map<string, { id: string; name: string; status: string; thumbnail_url?: string }[]>>(new Map());

  // Функция очистки кэшей если превышен лимит (FIFO - удаляем самые старые)
  const cleanupListCaches = useCallback(() => {
    const caches = [
      { name: 'campaigns', cache: campaignsListCacheRef.current },
      { name: 'adsets', cache: adsetsListCacheRef.current },
      { name: 'ads', cache: adsListCacheRef.current },
    ];

    caches.forEach(({ name, cache }) => {
      if (cache.size > MAX_LIST_CACHE_SIZE) {
        const toRemove = cache.size - MAX_LIST_CACHE_SIZE;
        const keys = Array.from(cache.keys()).slice(0, toRemove);
        keys.forEach(key => cache.delete(key));
        logger.debug(`Кэш ${name} очищен`, { removed: toRemove, remaining: cache.size });
      }
    });
  }, []);

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
        fb_page_id: acc.fb_page_id || null,
        connection_status: (acc.connection_status as 'pending' | 'connected' | 'error') || 'pending',
        is_active: acc.is_active !== false,
        fb_account_status: null,
        fb_disable_reason: null,
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

  /**
   * Загрузка directions для конкретного аккаунта
   */
  const loadDirectionsForAccount = useCallback(async (accountId: string) => {
    logger.debug('Loading directions for account', { accountId });

    const userId = getUserIdFromStorage();
    if (!userId) {
      logger.error('Cannot load directions: no user ID');
      return;
    }

    setDirectionsLoading((prev) => new Set(prev).add(accountId));

    try {
      const url = `${API_BASE_URL}/directions?userAccountId=${userId}&accountId=${accountId}`;
      const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Failed to load directions: ${response.status}`);
      }

      const data = await response.json();
      const directions: Direction[] = data.directions || [];

      logger.debug('Directions loaded', { accountId, count: directions.length });

      setDirectionsData((prev) => ({ ...prev, [accountId]: directions }));
    } catch (err) {
      logger.error('Failed to load directions', err, { accountId });
      setDirectionsData((prev) => ({ ...prev, [accountId]: [] }));
    } finally {
      setDirectionsLoading((prev) => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    }
  }, []);

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

  // Загрузка directions для всех аккаунтов после загрузки статистики
  useEffect(() => {
    if (accountStats.length > 0) {
      logger.debug('Loading directions for all accounts', { count: accountStats.length });
      accountStats.forEach((account) => {
        loadDirectionsForAccount(account.id);
      });
    }
  }, [accountStats, loadDirectionsForAccount]);

  // ОПТИМИЗАЦИЯ: При смене dateRange очищаем только статистику (данные в state),
  // но сохраняем кэши списков (campaignsListCacheRef, adsetsListCacheRef, adsListCacheRef)
  // Это позволяет при повторном раскрытии загружать только статистику, а не списки
  useEffect(() => {
    console.log('[MultiAccountDashboard] dateRange изменился, очищаем статистику (списки в кэше сохраняются)');
    setCampaignsData({});
    setAdsetsData({});
    setAdsData({});
    // НЕ очищаем campaignsListCacheRef, adsetsListCacheRef, adsListCacheRef - они не зависят от дат
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
    // Генерируем новый session ID чтобы отменить все предыдущие незавершенные загрузки
    sessionIdRef.current = Date.now();

    logger.info('Manual refresh triggered', {
      newSessionId: sessionIdRef.current
    });

    // Очищаем ВСЕ данные включая кэши списков (ручное обновление = полная перезагрузка)
    setCampaignsData({});
    setAdsetsData({});
    setAdsData({});
    setExpandedAccounts(new Set());
    setExpandedCampaigns(new Set());
    setExpandedAdsets(new Set());

    // Очищаем кэши списков (полная очистка при ручном refresh)
    const campaignsCacheSize = campaignsListCacheRef.current.size;
    const adsetsCacheSize = adsetsListCacheRef.current.size;
    const adsCacheSize = adsListCacheRef.current.size;

    campaignsListCacheRef.current.clear();
    adsetsListCacheRef.current.clear();
    adsListCacheRef.current.clear();

    logger.info('All caches cleared on manual refresh', {
      clearedCampaigns: campaignsCacheSize,
      clearedAdsets: adsetsCacheSize,
      clearedAds: adsCacheSize
    });
    loadAllAccountStats(true);
  }, [loadAllAccountStats]);

  // ==========================================================================
  // HIERARCHICAL EXPANSION HANDLERS
  // ==========================================================================

  const handleAccountExpand = useCallback(async (accountId: string, account: AccountStats) => {
    const isExpanded = expandedAccounts.has(accountId);

    logger.info('handleAccountExpand called', {
      accountId: accountId.slice(0, 8),
      accountName: account.name,
      isExpanded
    });

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

        // Захватываем текущий session ID чтобы проверить его перед записью данных
        const currentSessionId = sessionIdRef.current;

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
          logger.info('Switching account context', {
            from: previousAccountId?.slice(0, 8) || 'null',
            to: accountId.slice(0, 8),
            accountName: account.name
          });
          localStorage.setItem('currentAdAccountId', accountId);

          try {
            // ОПТИМИЗАЦИЯ: Проверяем кэш списков кампаний
            // Если список есть в кэше - используем его и загружаем только статистику
            const cachedList = campaignsListCacheRef.current.get(accountId);
            let campaignsList: any[];

            if (cachedList && cachedList.length > 0) {
              // Используем кэшированный список (CACHE HIT)
              campaignsList = cachedList.map(c => ({ id: c.id, name: c.name, status: c.status }));
              logger.info('Campaigns list cache HIT', {
                accountId: accountId.slice(0, 8),
                cachedCount: cachedList.length,
                cacheSize: campaignsListCacheRef.current.size
              });
            } else {
              // Загружаем список кампаний с их статусами
              campaignsList = await facebookApi.getCampaigns();

              // ПРОВЕРКА: убедимся что currentAdAccountId не изменился пока шел запрос
              const currentInLS = localStorage.getItem('currentAdAccountId');
              if (currentInLS !== accountId) {
                logger.warn('currentAdAccountId changed during request, aborting', {
                  expected: accountId.slice(0, 8),
                  actual: currentInLS?.slice(0, 8) || 'null'
                });
                return; // Прерываем загрузку
              }

              // Сохраняем список в кэш (с очисткой если превышен лимит)
              cleanupListCaches();
              campaignsListCacheRef.current.set(accountId, campaignsList.map(c => ({
                id: c.id,
                name: c.name,
                status: c.status
              })));

              logger.info('Campaigns list cached', {
                accountId: accountId.slice(0, 8),
                accountName: account.name,
                campaignsCount: campaignsList.length,
                cacheSize: campaignsListCacheRef.current.size
              });
            }

            const campaignsMap = new Map(campaignsList.map(c => [c.id, c.status]));

            // Получаем статистику кампаний (передаём campaignsList чтобы не дублировать запрос)
            const campaigns = await facebookApi.getCampaignStats(dateRange, false, campaignsList);

            // ПРОВЕРКА: убедимся что currentAdAccountId не изменился пока шел запрос
            if (localStorage.getItem('currentAdAccountId') !== accountId) {
              logger.warn('currentAdAccountId changed during getCampaignStats, aborting', {
                expected: accountId.slice(0, 8),
                actual: localStorage.getItem('currentAdAccountId')?.slice(0, 8) || 'null'
              });
              return; // Прерываем загрузку
            }

            logger.info('Campaign stats loaded', {
              accountId: accountId.slice(0, 8),
              statsCount: campaigns.length
            });

            // Добавляем статусы к кампаниям
            const campaignStats: CampaignStats[] = campaigns.map((c) => ({
                campaign_id: c.campaign_id,
                campaign_name: c.campaign_name,
                status: campaignsMap.get(c.campaign_id),
                spend: c.spend,
                leads: c.leads,
                impressions: c.impressions,
                clicks: c.clicks,
                ctr: c.ctr,
                cpl: c.cpl,
                messagingLeads: c.messagingLeads || 0,
                qualityLeads: c.qualityLeads || 0,
                cpql: c.cpql || 0,
                qualityRate: c.qualityRate || 0,
                daily_budget: c.daily_budget || 0,
              }));

            // ПРОВЕРКА: убедимся что session ID не изменился (не было refresh)
            if (sessionIdRef.current !== currentSessionId) {
              logger.warn('Session ID changed, aborting campaigns save', {
                accountId: accountId.slice(0, 8),
                currentSession: sessionIdRef.current,
                requestSession: currentSessionId
              });
              return; // Прерываем - данные устарели
            }

            logger.info('[handleAccountExpand] Saving campaigns to state', {
              accountId: accountId.slice(0, 8),
              accountName: account.name,
              campaignsCount: campaignStats.length,
              firstCampaignName: campaignStats[0]?.campaign_name || 'N/A',
              sessionId: currentSessionId
            });
            setCampaignsData((prev) => ({ ...prev, [accountId]: campaignStats }));
          } finally {
            // НЕ делаем restore! currentAdAccountId должен остаться на выбранном аккаунте
            // Он изменится только когда пользователь раскроет другой аккаунт
            logger.debug('Keeping currentAdAccountId on selected account');
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
  }, [expandedAccounts, campaignsData, campaignsLoading, dateRange, cleanupListCaches]);

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

        // Захватываем текущий session ID
        const currentSessionId = sessionIdRef.current;

        try {
          const previousAccountId = localStorage.getItem('currentAdAccountId');
          localStorage.setItem('currentAdAccountId', accountId);

          try {
            // ОПТИМИЗАЦИЯ: Проверяем кэш списков адсетов
            const cachedAdsetsList = adsetsListCacheRef.current.get(campaignId);
            let adsetsList: any[];
            let adsets: any[];

            if (cachedAdsetsList && cachedAdsetsList.length > 0) {
              // Используем кэшированный список (CACHE HIT), загружаем только статистику
              adsetsList = cachedAdsetsList;
              adsets = await facebookApi.getAdsetStats(campaignId, dateRange);
              logger.info('Adsets list cache HIT', {
                campaignId: campaignId.slice(0, 8),
                cachedCount: cachedAdsetsList.length,
                cacheSize: adsetsListCacheRef.current.size
              });
            } else {
              // ОПТИМИЗАЦИЯ: Параллельные запросы через Promise.all
              [adsetsList, adsets] = await Promise.all([
                facebookApi.getAdsetsByCampaign(campaignId),
                facebookApi.getAdsetStats(campaignId, dateRange)
              ]);

              // Сохраняем список в кэш (с очисткой если превышен лимит)
              cleanupListCaches();
              adsetsListCacheRef.current.set(campaignId, adsetsList.map((a: any) => ({
                id: a.id,
                name: a.name,
                status: a.status,
                daily_budget: parseFloat(a.daily_budget || '0') / 100
              })));
              logger.info('Adsets list cached', {
                campaignId: campaignId.slice(0, 8),
                count: adsetsList.length,
                cacheSize: adsetsListCacheRef.current.size
              });
            }

            // Создаём мапы для бюджетов и статусов
            const budgetMap = new Map(
              adsetsList.map((a: any) => [a.id, a.daily_budget !== undefined ? a.daily_budget : parseFloat(a.daily_budget || '0') / 100])
            );
            const statusMap = new Map(
              adsetsList.map((a: any) => [a.id, a.status])
            );

            // Маппим адсеты в AdsetStats с добавлением бюджетов и статусов
            const adsetStats: AdsetStats[] = adsets.map((a: any) => ({
              adset_id: a.adset_id,
              adset_name: a.adset_name,
              status: statusMap.get(a.adset_id),
              spend: a.spend || 0,
              leads: a.leads || 0,
              impressions: a.impressions || 0,
              clicks: a.clicks || 0,
              ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
              cpl: a.cpl || 0,
              messagingLeads: a.messagingLeads || 0,
              qualityLeads: a.qualityLeads || 0,
              cpql: a.cpql || 0,
              qualityRate: a.qualityRate || 0,
              daily_budget: budgetMap.get(a.adset_id) || 0,
            }));

            // ПРОВЕРКА: убедимся что session ID не изменился
            if (sessionIdRef.current !== currentSessionId) {
              logger.warn('Session ID changed, aborting adsets save', {
                campaignId: campaignId.slice(0, 8),
                currentSession: sessionIdRef.current,
                requestSession: currentSessionId
              });
              return;
            }

            setAdsetsData((prev) => ({ ...prev, [campaignId]: adsetStats }));
          } finally {
            // НЕ делаем restore! currentAdAccountId должен остаться на выбранном аккаунте
            // Он изменится только когда пользователь раскроет другой аккаунт
            logger.debug('Keeping currentAdAccountId on selected account');
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
  }, [expandedCampaigns, adsetsData, adsetsLoading, dateRange, cleanupListCaches]);

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

        // Захватываем текущий session ID
        const currentSessionId = sessionIdRef.current;

        try {
          const previousAccountId = localStorage.getItem('currentAdAccountId');
          localStorage.setItem('currentAdAccountId', accountId);

          try {
            // ОПТИМИЗАЦИЯ: Проверяем кэш списков объявлений
            const cachedAdsList = adsListCacheRef.current.get(adsetId);
            let adsList: any[];
            let ads: any[];

            if (cachedAdsList && cachedAdsList.length > 0) {
              // Используем кэшированный список (CACHE HIT), загружаем только статистику
              adsList = cachedAdsList;
              ads = await facebookApi.getAdStatsByAdset(adsetId, dateRange);
              logger.info('Ads list cache HIT', {
                adsetId: adsetId.slice(0, 8),
                cachedCount: cachedAdsList.length,
                cacheSize: adsListCacheRef.current.size
              });
            } else {
              // ОПТИМИЗАЦИЯ: Параллельные запросы через Promise.all
              [adsList, ads] = await Promise.all([
                facebookApi.getAdsByAdset(adsetId),
                facebookApi.getAdStatsByAdset(adsetId, dateRange)
              ]);

              // Сохраняем список в кэш (с очисткой если превышен лимит)
              cleanupListCaches();
              adsListCacheRef.current.set(adsetId, adsList.map((a) => ({
                id: a.id,
                name: a.name,
                status: a.status,
                thumbnail_url: a.thumbnail_url
              })));
              logger.info('Ads list cached', {
                adsetId: adsetId.slice(0, 8),
                count: adsList.length,
                cacheSize: adsListCacheRef.current.size
              });
            }

            // Создаём мапы для статусов и миниатюр
            const adsStatusMap = new Map(adsList.map((a) => [a.id, a.status]));
            const adsThumbnailMap = new Map(adsList.map((a) => [a.id, a.thumbnail_url]));

            // Маппим объявления в AdStats с добавлением статусов и миниатюр
            const adStats: AdStats[] = ads.map((a) => ({
                ad_id: a.ad_id,
                ad_name: a.ad_name,
                status: adsStatusMap.get(a.ad_id),
                thumbnail_url: adsThumbnailMap.get(a.ad_id),
                spend: a.spend || 0,
                leads: a.leads || 0,
                impressions: a.impressions || 0,
                clicks: a.clicks || 0,
                ctr: a.ctr || 0,
                cpl: a.cpl || 0,
                messagingLeads: a.messagingLeads || 0,
                qualityLeads: a.qualityLeads || 0,
                cpql: a.cpql || 0,
                qualityRate: a.qualityRate || 0,
              }));

            // ПРОВЕРКА: убедимся что session ID не изменился
            if (sessionIdRef.current !== currentSessionId) {
              logger.warn('Session ID changed, aborting ads save', {
                adsetId: adsetId.slice(0, 8),
                currentSession: sessionIdRef.current,
                requestSession: currentSessionId
              });
              return;
            }

            setAdsData((prev) => ({ ...prev, [adsetId]: adStats }));
          } finally {
            // НЕ делаем restore! currentAdAccountId должен остаться на выбранном аккаунте
            // Он изменится только когда пользователь раскроет другой аккаунт
            logger.debug('Keeping currentAdAccountId on selected account');
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
  }, [expandedAdsets, adsData, adsLoading, dateRange, cleanupListCaches]);

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
                <div className="hidden md:grid grid-cols-14 px-6 py-3 bg-muted/50 text-sm font-medium text-muted-foreground">
                  <div className="col-span-5">Аккаунт</div>
                  <div className="col-span-2 text-right">Расходы</div>
                  <div className="col-span-1 text-right">Бюджет</div>
                  <div className="col-span-1 text-right">Лиды</div>
                  <div className="col-span-1 text-right">CPL</div>
                  <div className="col-span-1 text-right">CPQL</div>
                  <div className="col-span-1 text-right">Качество</div>
                  <div className="col-span-1 text-right">CTR</div>
                  <div className="col-span-1 text-right">CPM</div>
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
                    directions={directionsData[account.id] || []}
                    onOptimize={optimization.startOptimization}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      <DateRangePicker open={datePickerOpen} onOpenChange={setDatePickerOpen} />

      {/* Brain Mini Optimization Modal */}
      <OptimizationModal
        open={optimization.state.isOpen}
        onClose={optimization.close}
        scope={optimization.state.scope}
        streamingState={optimization.state.streamingState}
        plan={optimization.state.plan}
        content={optimization.state.content}
        isLoading={optimization.state.isLoading}
        error={optimization.state.error}
        onApprove={optimization.approveAll}
        onReject={optimization.reject}
        isExecuting={optimization.state.isExecuting}
      />
    </div>
  );
};

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

/**
 * Компонент для отображения CPL с отклонением от target_cpl
 */
interface CplWithDeviationProps {
  cpl: number;
  targetCplCents: number | null;
}

const CplWithDeviation: React.FC<CplWithDeviationProps> = ({ cpl, targetCplCents }) => {
  const deviation = targetCplCents ? calculateCplDeviation(cpl, targetCplCents) : null;

  const getDeviationColor = (dev: number) => {
    if (dev <= -10) return 'text-green-600 dark:text-green-400'; // -10% и ниже = хорошо
    if (dev <= 10) return 'text-yellow-600 dark:text-yellow-400'; // -10% до +10% = норма
    return 'text-red-600 dark:text-red-400'; // +10% и выше = плохо
  };

  return (
    <div className="relative inline-flex items-center">
      <span className="font-medium text-sm">{formatCurrency(cpl)}</span>
      {deviation && (
        <span
          className={cn('absolute -top-2.5 left-full ml-0.5 text-[10px] font-medium whitespace-nowrap', getDeviationColor(deviation.deviation))}
        >
          {deviation.formattedText}
        </span>
      )}
    </div>
  );
};

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
  directions: Direction[];
  onOptimize: (scope: OptimizationScope) => void;
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
  directions,
  onOptimize,
}) => {
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Debug: log when campaigns change for this account
  React.useEffect(() => {
    logger.info('[AccountRow] Rendering with campaigns', {
      accountId: account.id.slice(0, 8),
      accountName: account.name,
      campaignsCount: campaigns.length,
      firstCampaignName: campaigns[0]?.campaign_name || 'N/A',
      isExpanded
    });
  }, [campaigns, account.id, account.name, isExpanded]);

  // Форматирование CTR
  const formatCtr = (ctr: number) => `${ctr.toFixed(2)}%`;
  // Форматирование CPM
  const formatCpm = (cpm: number) => formatCurrency(cpm);

  // Рассчитываем статистику аккаунта как сумму всех кампаний
  const calculatedStats = campaigns.length > 0 ? {
    spend: campaigns.reduce((sum, c) => sum + c.spend, 0),
    leads: campaigns.reduce((sum, c) => sum + c.leads, 0),
    messagingLeads: campaigns.reduce((sum, c) => sum + (c.messagingLeads || 0), 0),
    qualityLeads: campaigns.reduce((sum, c) => sum + (c.qualityLeads || 0), 0),
    impressions: campaigns.reduce((sum, c) => sum + c.impressions, 0),
    clicks: campaigns.reduce((sum, c) => sum + c.clicks, 0),
    get cpl() { return this.leads > 0 ? this.spend / this.leads : 0; },
    get cpql() { return this.qualityLeads > 0 ? this.spend / this.qualityLeads : 0; },
    get qualityRate() {
      return this.messagingLeads > 0 ? (this.qualityLeads / this.messagingLeads) * 100 : 0;
    },
    get ctr() { return this.impressions > 0 ? (this.clicks / this.impressions) * 100 : 0; },
    get cpm() { return this.impressions > 0 ? (this.spend / this.impressions) * 1000 : 0; },
  } : null;

  // ИСПРАВЛЕНИЕ: Всегда показываем account.stats, даже если нет campaigns
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
          'grid grid-cols-1 md:grid-cols-14 px-6 py-4 cursor-pointer transition-colors',
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
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Account Info */}
        <div className="col-span-5 flex items-center gap-2">
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
            {!imageError && account.fb_page_id && (
              <AvatarImage
                src={`https://graph.facebook.com/${account.fb_page_id}/picture?type=large`}
                onError={() => setImageError(true)}
              />
            )}
            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-xs">
              {account.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-medium truncate text-sm">{account.name}</p>
              {(() => {
                const statusInfo = getFbAccountStatusInfo(account.fb_account_status);
                if (!statusInfo) return null;
                return (
                  <Badge
                    variant={statusInfo.variant === 'warning' ? 'outline' : statusInfo.variant}
                    className={cn(
                      'text-[10px] px-1.5 py-0 h-4 flex-shrink-0',
                      statusInfo.variant === 'warning' && 'bg-yellow-50 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700',
                      statusInfo.variant === 'destructive' && 'bg-red-50 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700'
                    )}
                  >
                    {statusInfo.label}
                  </Badge>
                );
              })()}
              <OptimizeButton
                isVisible={isHovered}
                onClick={(e) => {
                  e.stopPropagation();
                  onOptimize({
                    accountId: account.id,
                    accountName: account.name,
                  });
                }}
              />
            </div>
            {/* Мобильная версия — компактная строка метрик */}
            {stats && (
              <p className="md:hidden text-xs text-muted-foreground truncate">
                {formatCurrency(stats.spend)} • {formatNumber(stats.leads)} лидов • {formatCurrency(stats.cpl)} CPL • {stats.cpql > 0 ? formatCurrency(stats.cpql) + ' CPQL' : ''} • {stats.qualityRate > 0 ? stats.qualityRate.toFixed(0) + '% качество' : ''}
              </p>
            )}
          </div>
        </div>

        {/* Десктопная версия — отдельные колонки */}
        <div className="hidden md:flex col-span-2 items-center justify-end">
          <span className="font-medium text-sm whitespace-nowrap">
            {stats ? formatCurrency(stats.spend) : '—'}
          </span>
        </div>

        {/* Бюджет */}
        <div className="hidden md:flex col-span-1 items-center justify-end">
          <span className="font-medium text-sm whitespace-nowrap">
            {campaigns.length > 0 ? formatCurrency(campaigns.reduce((sum, c) => sum + c.daily_budget, 0)) : '—'}
          </span>
        </div>

        <div className="hidden md:flex col-span-1 items-center justify-end">
          <span className="font-medium text-sm whitespace-nowrap">
            {stats ? formatNumber(stats.leads) : '—'}
          </span>
        </div>

        {/* CPL с отклонением */}
        <div className="hidden md:flex col-span-1 items-center justify-end">
          {stats ? (
            <CplWithDeviation
              cpl={stats.cpl}
              targetCplCents={getTargetCplForLevel(null, directions)}
            />
          ) : (
            <span className="font-medium text-sm">—</span>
          )}
        </div>

        {/* CPQL */}
        <div className="hidden md:flex col-span-1 items-center justify-end">
          <span className="font-medium text-sm whitespace-nowrap">
            {stats && stats.cpql > 0 ? formatCurrency(stats.cpql) : '—'}
          </span>
        </div>

        {/* Качество лидов */}
        <div className="hidden md:flex col-span-1 items-center justify-end">
          <span className="font-medium text-sm whitespace-nowrap">
            {stats && stats.qualityRate > 0 ? `${stats.qualityRate.toFixed(0)}%` : '—'}
          </span>
        </div>

        <div className="hidden md:flex col-span-1 items-center justify-end">
          <span className="font-medium text-sm whitespace-nowrap">
            {stats ? formatCtr(stats.ctr) : '—'}
          </span>
        </div>

        <div className="hidden md:flex col-span-1 items-center justify-end">
          <span className="font-medium text-sm whitespace-nowrap">
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
                directions={directions}
                accountId={account.id}
                accountName={account.name}
                onOptimize={onOptimize}
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
  directions: Direction[];
  accountId?: string;
  accountName?: string;
  onOptimize?: (scope: OptimizationScope) => void;
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
  directions,
  accountId,
  accountName,
  onOptimize,
}) => {
  const [campaignActive, setCampaignActive] = useState(campaign.status === 'ACTIVE');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Sync toggle state with campaign status
  useEffect(() => {
    setCampaignActive(campaign.status === 'ACTIVE');
  }, [campaign.status]);

  const formatCtr = (ctr: number) => `${ctr.toFixed(2)}%`;
  const formatCpm = (impressions: number, spend: number) => {
    const calculatedCpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    return formatCurrency(calculatedCpm);
  };

  const handleCampaignToggle = async (e: React.MouseEvent, checked: boolean) => {
    e.stopPropagation();
    setIsUpdatingStatus(true);
    try {
      await facebookApi.updateCampaignStatus(campaign.campaign_id, checked);
      setCampaignActive(checked);
      toast.success(checked ? 'Кампания запущена' : 'Кампания остановлена');
    } catch (error) {
      toast.error('Ошибка изменения статуса кампании');
      console.error('Campaign toggle error:', error);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Находим direction для этой кампании
  const direction = directions.find(d => d.fb_campaign_id === campaign.campaign_id);

  return (
    <div className="divide-y divide-muted/30">
      <div
        className={cn(
          'grid grid-cols-1 md:grid-cols-14 px-6 py-3 cursor-pointer transition-colors',
          'hover:bg-muted/40',
          isExpanded && 'bg-muted/30'
        )}
        onClick={onExpand}
        role="button"
        tabIndex={0}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Campaign Info */}
        <div className="col-span-5 flex items-center gap-2 pl-4 md:pl-6">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Megaphone className="h-4 w-4 text-blue-500 flex-shrink-0" />
          <Switch
            checked={campaignActive}
            disabled={isUpdatingStatus}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(checked) => handleCampaignToggle({} as React.MouseEvent, checked)}
            className="ml-2"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-medium text-sm truncate">{campaign.campaign_name}</p>
              <OptimizeButton
                isVisible={isHovered}
                onClick={(e) => {
                  e.stopPropagation();
                  onOptimize({
                    accountId,
                    accountName,
                    directionId: direction?.id,
                    directionName: direction?.name || campaign.campaign_name,
                    campaignId: campaign.campaign_id,
                  });
                }}
              />
            </div>
            {/* Мобильная версия — компактная строка метрик */}
            <p className="md:hidden text-xs text-muted-foreground truncate">
              {formatCurrency(campaign.spend)} • {formatNumber(campaign.leads)} лидов • {formatCurrency(campaign.cpl)} CPL • {campaign.cpql > 0 ? formatCurrency(campaign.cpql) + ' CPQL' : ''} • {campaign.qualityRate > 0 ? campaign.qualityRate.toFixed(0) + '% качество' : ''}
            </p>
          </div>
        </div>

        {/* Десктопная версия — отдельные колонки */}
        <div className="hidden md:flex col-span-2 items-center justify-end">
          <span className="text-sm">{formatCurrency(campaign.spend)}</span>
        </div>

        {/* Бюджет */}
        <div className="hidden md:flex col-span-1 items-center justify-end">
          <span className="text-sm">{formatCurrency(campaign.daily_budget)}</span>
        </div>

        <div className="hidden md:flex col-span-1 items-center justify-end">
          <span className="text-sm">{formatNumber(campaign.leads)}</span>
        </div>

        {/* CPL с отклонением */}
        <div className="hidden md:flex col-span-1 items-center justify-end">
          <CplWithDeviation
            cpl={campaign.cpl}
            targetCplCents={getTargetCplForLevel(campaign.campaign_id, directions)}
          />
        </div>

        {/* CPQL */}
        <div className="hidden md:flex col-span-1 items-center justify-end">
          <span className="text-sm">
            {campaign.cpql > 0 ? formatCurrency(campaign.cpql) : '—'}
          </span>
        </div>

        {/* Качество лидов */}
        <div className="hidden md:flex col-span-1 items-center justify-end">
          <span className="text-sm">
            {campaign.qualityRate > 0 ? `${campaign.qualityRate.toFixed(0)}%` : '—'}
          </span>
        </div>

        <div className="hidden md:flex col-span-1 items-center justify-end">
          <span className="text-sm">{formatCtr(campaign.ctr)}</span>
        </div>

        <div className="hidden md:flex col-span-1 items-center justify-end">
          <span className="text-sm">{formatCpm(campaign.impressions, campaign.spend)}</span>
        </div>
      </div>

      {/* Expanded Adsets */}
      {isExpanded && (
        <div className="bg-muted/10">
          {isLoading ? (
            <div className="flex items-center justify-center py-3 pl-4 md:pl-16">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
              <span className="text-sm text-muted-foreground">Загрузка адсетов...</span>
            </div>
          ) : adsets.length === 0 ? (
            <div className="flex items-center justify-center py-3 pl-4 md:pl-16">
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
                targetCplCents={getTargetCplForLevel(campaign.campaign_id, directions)}
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
  targetCplCents: number | null;
}

const AdsetRow: React.FC<AdsetRowProps> = ({
  adset,
  isExpanded,
  onExpand,
  isLoading,
  ads,
  targetCplCents,
}) => {
  const formatCtr = (ctr: number) => `${ctr.toFixed(2)}%`;
  const formatCpm = (impressions: number, spend: number) => {
    const calculatedCpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    return formatCurrency(calculatedCpm);
  };

  const [isHovered, setIsHovered] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [editedBudget, setEditedBudget] = React.useState(adset.daily_budget.toFixed(2));
  const [currentBudget, setCurrentBudget] = React.useState(adset.daily_budget);
  const [adsetActive, setAdsetActive] = React.useState(adset.status === 'ACTIVE');
  const [isUpdatingStatus, setIsUpdatingStatus] = React.useState(false);

  // Sync toggle state with adset status
  React.useEffect(() => {
    setAdsetActive(adset.status === 'ACTIVE');
  }, [adset.status]);

  const handleBudgetSave = async () => {
    const newBudget = parseFloat(editedBudget);
    if (!isNaN(newBudget) && newBudget >= 0) {
      try {
        await facebookApi.updateAdsetBudget(adset.adset_id, Math.round(newBudget * 100));
        setCurrentBudget(newBudget);
        setIsEditing(false);
      } catch (e) {
        console.error('Failed to update budget', e);
        setEditedBudget(currentBudget.toFixed(2));
      }
    }
  };

  const handleCancelEdit = React.useCallback(() => {
    setIsEditing(false);
    setEditedBudget(currentBudget.toFixed(2));
  }, [currentBudget]);

  const handleAdsetToggle = async (e: React.MouseEvent, checked: boolean) => {
    e.stopPropagation();
    setIsUpdatingStatus(true);
    try {
      await facebookApi.updateAdsetStatus(adset.adset_id, checked);
      setAdsetActive(checked);
      toast.success(checked ? 'Адсет запущен' : 'Адсет остановлен');
    } catch (error) {
      toast.error('Ошибка изменения статуса адсета');
      console.error('Adset toggle error:', error);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Закрытие при клике вне input
  React.useEffect(() => {
    if (!isEditing) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Если клик не по input бюджета - закрываем без сохранения
      if (!target.closest('[data-budget-input]')) {
        handleCancelEdit();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isEditing, handleCancelEdit]);

  return (
    <div className="divide-y divide-muted/20">
      <div
        className={cn(
          'grid grid-cols-1 md:grid-cols-14 px-6 py-2 cursor-pointer transition-colors',
          'hover:bg-muted/30',
          isExpanded && 'bg-muted/20'
        )}
        onClick={onExpand}
        role="button"
        tabIndex={0}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Adset Info */}
        <div className="col-span-5 flex items-center gap-2 pl-6 md:pl-14">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800 flex-shrink-0">
            adset
          </Badge>
          <Switch
            checked={adsetActive}
            disabled={isUpdatingStatus}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(checked) => handleAdsetToggle({} as React.MouseEvent, checked)}
            className="ml-2"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm truncate">{adset.adset_name}</p>
            {/* Мобильная версия — компактная строка метрик */}
            <div className="md:hidden text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
              <span>{formatCurrency(adset.spend)}</span>
              <span>•</span>
              {/* Бюджет с редактированием для мобильной версии */}
              {isEditing ? (
                <input
                  data-budget-input
                  type="text"
                  value={editedBudget}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '' || /^[0-9]*[.,]?[0-9]*$/.test(value)) {
                      setEditedBudget(value.replace(',', '.'));
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleBudgetSave();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      handleCancelEdit();
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-16 px-1 py-0.5 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
              ) : (
                <span
                  className="underline cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditing(true);
                  }}
                >
                  {formatCurrency(currentBudget)} бюджет
                </span>
              )}
              <span>•</span>
              <span>{formatNumber(adset.leads)} лидов</span>
              <span>•</span>
              <span>{formatCurrency(adset.cpl)} CPL</span>
              {adset.cpql > 0 && <><span>•</span><span>{formatCurrency(adset.cpql)} CPQL</span></>}
              {adset.qualityRate > 0 && <><span>•</span><span>{adset.qualityRate.toFixed(0)}% качество</span></>}
            </div>
          </div>
        </div>

        {/* Десктопная версия — отдельные колонки */}
        <div className="hidden md:flex col-span-2 items-center justify-end">
          <span className="text-sm text-muted-foreground">{formatCurrency(adset.spend)}</span>
        </div>

        {/* Бюджет с редактированием */}
        <div
          className="hidden md:flex col-span-1 items-center justify-end"
          onClick={(e) => {
            e.stopPropagation();
            if (!isEditing) {
              setIsEditing(true);
            }
          }}
        >
          {isEditing ? (
            <input
              data-budget-input
              type="text"
              value={editedBudget}
              onChange={(e) => {
                const value = e.target.value;
                // Разрешаем только цифры, точку и запятую
                if (value === '' || /^[0-9]*[.,]?[0-9]*$/.test(value)) {
                  setEditedBudget(value.replace(',', '.'));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleBudgetSave();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  handleCancelEdit();
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-20 px-2 py-1 text-sm text-right border rounded focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />
          ) : (
            <span className={cn('text-sm text-muted-foreground', isHovered && 'underline cursor-text')}>
              {formatCurrency(currentBudget)}
            </span>
          )}
        </div>

        <div className="hidden md:flex col-span-1 items-center justify-end">
          <span className="text-sm text-muted-foreground">{formatNumber(adset.leads)}</span>
        </div>

        {/* CPL с отклонением */}
        <div className="hidden md:flex col-span-1 items-center justify-end">
          <CplWithDeviation cpl={adset.cpl} targetCplCents={targetCplCents} />
        </div>

        {/* CPQL */}
        <div className="hidden md:flex col-span-1 items-center justify-end">
          <span className="text-sm text-muted-foreground">
            {adset.cpql > 0 ? formatCurrency(adset.cpql) : '—'}
          </span>
        </div>

        {/* Качество лидов */}
        <div className="hidden md:flex col-span-1 items-center justify-end">
          <span className="text-sm text-muted-foreground">
            {adset.qualityRate > 0 ? `${adset.qualityRate.toFixed(0)}%` : '—'}
          </span>
        </div>

        <div className="hidden md:flex col-span-1 items-center justify-end">
          <span className="text-sm text-muted-foreground">{formatCtr(adset.ctr)}</span>
        </div>

        <div className="hidden md:flex col-span-1 items-center justify-end">
          <span className="text-sm text-muted-foreground">{formatCpm(adset.impressions, adset.spend)}</span>
        </div>
      </div>

      {/* Expanded Ads */}
      {isExpanded && (
        <div className="bg-muted/5">
          {isLoading ? (
            <div className="flex items-center justify-center py-2 pl-6 md:pl-24">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
              <span className="text-sm text-muted-foreground">Загрузка объявлений...</span>
            </div>
          ) : ads.length === 0 ? (
            <div className="flex items-center justify-center py-2 pl-6 md:pl-24">
              <span className="text-sm text-muted-foreground">Нет объявлений за выбранный период</span>
            </div>
          ) : (
            ads.map((ad) => (
              <AdRow key={ad.ad_id} ad={ad} targetCplCents={targetCplCents} adsetBudget={adset.daily_budget} />
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
  targetCplCents: number | null;
  adsetBudget: number; // Бюджет родительского адсета
}

const AdRow: React.FC<AdRowProps> = ({ ad, targetCplCents, adsetBudget }) => {
  const [adActive, setAdActive] = React.useState(ad.status === 'ACTIVE');
  const [isUpdatingStatus, setIsUpdatingStatus] = React.useState(false);

  // Sync toggle state with ad status
  React.useEffect(() => {
    setAdActive(ad.status === 'ACTIVE');
  }, [ad.status]);

  const formatCtr = (ctr: number) => `${ctr.toFixed(2)}%`;
  const formatCpm = (impressions: number, spend: number) => {
    const calculatedCpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    return formatCurrency(calculatedCpm);
  };

  const handleAdToggle = async (e: React.MouseEvent, checked: boolean) => {
    e.stopPropagation();
    setIsUpdatingStatus(true);
    try {
      await facebookApi.updateAdStatus(ad.ad_id, checked);
      setAdActive(checked);
      toast.success(checked ? 'Объявление запущено' : 'Объявление остановлено');
    } catch (error) {
      toast.error('Ошибка изменения статуса объявления');
      console.error('Ad toggle error:', error);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const cpql = ad.cpql || (ad.qualityLeads > 0 ? ad.spend / ad.qualityLeads : 0);
  const qualityRate = ad.qualityRate || (ad.messagingLeads > 0 ? (ad.qualityLeads / ad.messagingLeads) * 100 : 0);

  return (
    <div
      className={cn(
        'grid grid-cols-1 md:grid-cols-14 px-6 py-2 transition-colors',
        'hover:bg-muted/20'
      )}
    >
      {/* Ad Info */}
      <div className="col-span-5 flex items-center gap-2 pl-8 md:pl-20">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800 flex-shrink-0">
          ad
        </Badge>
        {ad.thumbnail_url ? (
          <img
            src={ad.thumbnail_url}
            alt={ad.ad_name}
            className="w-10 h-10 rounded object-cover flex-shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <ImageIcon className="w-10 h-10 text-muted-foreground/50 flex-shrink-0" />
        )}
        <Switch
          checked={adActive}
          disabled={isUpdatingStatus}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={(checked) => handleAdToggle({} as React.MouseEvent, checked)}
          className="ml-2"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs truncate text-muted-foreground">{ad.ad_name}</p>
          {/* Мобильная версия — компактная строка метрик */}
          <p className="md:hidden text-[10px] text-muted-foreground/70 truncate">
            {formatCurrency(ad.spend)} • {formatNumber(ad.leads)} лидов • {formatCurrency(ad.cpl)} CPL
            {cpql > 0 && ` • ${formatCurrency(cpql)} CPQL`}
            {qualityRate > 0 && ` • ${qualityRate.toFixed(0)}% кач.`}
          </p>
        </div>
      </div>

      {/* Десктопная версия — отдельные колонки */}
      <div className="hidden md:flex col-span-2 items-center justify-end">
        <span className="text-xs text-muted-foreground/70">{formatCurrency(ad.spend)}</span>
      </div>

      {/* Бюджет адсета */}
      <div className="hidden md:flex col-span-1 items-center justify-end">
        <span className="text-xs text-muted-foreground/70">{formatCurrency(adsetBudget)}</span>
      </div>

      <div className="hidden md:flex col-span-1 items-center justify-end">
        <span className="text-xs text-muted-foreground/70">{formatNumber(ad.leads)}</span>
      </div>

      {/* CPL с отклонением */}
      <div className="hidden md:flex col-span-1 items-center justify-end">
        <div className="text-xs text-muted-foreground/70">
          <CplWithDeviation
            cpl={ad.cpl}
            targetCplCents={targetCplCents}
          />
        </div>
      </div>

      {/* CPQL */}
      <div className="hidden md:flex col-span-1 items-center justify-end">
        <span className="text-xs text-muted-foreground/70">
          {cpql > 0 ? formatCurrency(cpql) : '—'}
        </span>
      </div>

      {/* Качество лидов */}
      <div className="hidden md:flex col-span-1 items-center justify-end">
        <span className="text-xs text-muted-foreground/70">
          {qualityRate > 0 ? `${qualityRate.toFixed(0)}%` : '—'}
        </span>
      </div>

      <div className="hidden md:flex col-span-1 items-center justify-end">
        <span className="text-xs text-muted-foreground/70">{formatCtr(ad.ctr)}</span>
      </div>

      <div className="hidden md:flex col-span-1 items-center justify-end">
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

// Экспорт Row компонентов для переиспользования
export { CampaignRow, AdsetRow, AdRow };

// Экспорт типов
export type { CampaignStats, AdsetStats, AdStats, Direction };
