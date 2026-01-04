import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Campaign, CampaignStat, DateRange, facebookApi } from '../services/facebookApi';
import { tiktokApi } from '@/services/tiktokApi';
import { format, subDays } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '../integrations/supabase/client';
import { adAccountsApi } from '@/services/adAccountsApi';
import type { AdAccount, AdAccountSummary } from '@/types/adAccount';

interface AppContextType {
  campaigns: Campaign[];
  campaignStats: CampaignStat[];
  loading: boolean;
  error: string | null;
  dateRange: DateRange;
  refreshData: () => Promise<void>;
  setDateRange: (range: DateRange) => void;
  toggleCampaignStatus: (campaignId: string, isActive: boolean) => Promise<void>;
  selectedCampaignId: string | null;
  setSelectedCampaignId: (id: string | null) => void;
  accountStatus: any;
  accountStatusError: string | null;
  aiAutopilot: boolean;
  toggleAiAutopilot: (enabled: boolean) => Promise<void>;
  aiAutopilotLoading: boolean;
  optimization: string;
  updateOptimization: (optimizationType: string) => Promise<void>;
  businessId: string | null;
  checkBusinessId: () => Promise<boolean>;
  currentCampaignGoal?: 'whatsapp' | 'instagram_traffic' | 'site_leads' | 'lead_forms' | null;
  platform: 'instagram' | 'tiktok';
  setPlatform: (p: 'instagram' | 'tiktok') => void;
  tiktokConnected: boolean;
  checkTikTokConnected: () => Promise<boolean>;
  // Multi-account support
  multiAccountEnabled: boolean;
  adAccounts: AdAccountSummary[];
  currentAdAccountId: string | null;
  setCurrentAdAccountId: (id: string | null) => void;
  loadAdAccounts: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

interface AppProviderProps {
  children: ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = ({ children }) => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignStats, setCampaignStats] = useState<CampaignStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [accountStatus, setAccountStatus] = useState<any>(null);
  const [accountStatusError, setAccountStatusError] = useState<string | null>(null);
  const [aiAutopilot, setAiAutopilot] = useState(false);
  const [aiAutopilotLoading, setAiAutopilotLoading] = useState(false);
  const [optimization, setOptimization] = useState('lead_cost');
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [currentCampaignGoal, setCurrentCampaignGoal] = useState<'whatsapp' | 'instagram_traffic' | 'site_leads' | 'lead_forms' | null>(null);
  const [userTarif, setUserTarif] = useState<string | null>(null);
  const [platform, setPlatform] = useState<'instagram' | 'tiktok'>('instagram');
  const [tiktokConnected, setTiktokConnected] = useState<boolean>(false);

  // Multi-account state - инициализируем из localStorage для мгновенного редиректа
  const [multiAccountEnabled, setMultiAccountEnabled] = useState<boolean>(() => {
    return localStorage.getItem('multiAccountEnabled') === 'true';
  });
  const [adAccounts, setAdAccounts] = useState<AdAccountSummary[]>(() => {
    const stored = localStorage.getItem('adAccounts');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return [];
      }
    }
    return [];
  });
  const [currentAdAccountId, setCurrentAdAccountIdState] = useState<string | null>(() => {
    return localStorage.getItem('currentAdAccountId');
  });

  // Обёртка для setCurrentAdAccountId — сохраняет в localStorage
  const setCurrentAdAccountId = useCallback((id: string | null) => {
    setCurrentAdAccountIdState(id);
    if (id) {
      localStorage.setItem('currentAdAccountId', id);
    } else {
      localStorage.removeItem('currentAdAccountId');
    }
  }, []);

  // Устанавливаем значение по умолчанию для диапазона дат (только сегодня)
  const today = new Date();
  const [dateRange, setDateRange] = useState<DateRange>({
    since: format(today, 'yyyy-MM-dd'),
    until: format(today, 'yyyy-MM-dd')
  });

  // --- Persist and restore UI state (platform, dateRange) across refreshes ---
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const urlPlatform = url.searchParams.get('p') as 'instagram' | 'tiktok' | null;
      const urlSince = url.searchParams.get('since');
      const urlUntil = url.searchParams.get('until');

      // 1) URL имеет наивысший приоритет
      if (urlPlatform === 'instagram' || urlPlatform === 'tiktok') {
        setPlatform(urlPlatform);
      } else {
        // 2) иначе читаем из localStorage
        const savedPlatform = localStorage.getItem('app_platform');
        if (savedPlatform === 'instagram' || savedPlatform === 'tiktok') {
          setPlatform(savedPlatform as 'instagram' | 'tiktok');
        }
      }

      if (urlSince && urlUntil) {
        setDateRange({ since: urlSince, until: urlUntil });
      } else {
        const savedRange = localStorage.getItem('app_date_range');
        if (savedRange) {
          try {
            const parsed = JSON.parse(savedRange);
            if (parsed?.since && parsed?.until) {
              setDateRange({ since: parsed.since, until: parsed.until });
            }
          } catch {/* ignore */}
        }
      }
    } catch {/* ignore */}
  }, []);

  // Сохраняем в localStorage и URL при любых изменениях
  useEffect(() => {
    try {
      localStorage.setItem('app_platform', platform);
      localStorage.setItem('app_date_range', JSON.stringify(dateRange));

      const url = new URL(window.location.href);
      url.searchParams.set('p', platform);
      url.searchParams.set('since', dateRange.since);
      url.searchParams.set('until', dateRange.until);
      window.history.replaceState(null, '', url.toString());
    } catch {/* ignore */}
  }, [platform, dateRange]);

  // Загружаем состояние AI автопилота из Supabase при инициализации
  useEffect(() => {
    const loadAiAutopilotState = async () => {
      try {
        const storedUser = localStorage.getItem('user');
        if (!storedUser) return;
        
        const userData = JSON.parse(storedUser);
        if (!userData.id) return;
        
        const { data, error } = await supabase
          .from('user_accounts')
          .select('autopilot, current_campaign_goal, tarif, optimization, tiktok_access_token, tiktok_account_id, tiktok_business_id, prompt1')
          .eq('id', userData.id)
          .single();
          
        if (error) {
          console.error('Ошибка при загрузке состояния AI автопилота:', error);
          return;
        }
        
        if (data) {
          if (data.autopilot !== undefined) {
            setAiAutopilot(!!data.autopilot);
            console.log('Загружено состояние AI автопилота:', !!data.autopilot);
          }

          if (data.current_campaign_goal) {
            setCurrentCampaignGoal(data.current_campaign_goal as any);
            console.log('Загружена текущая цель кампании:', data.current_campaign_goal);
          }
          if (data.tarif) {
            setUserTarif(data.tarif);
            console.log('Загружен тариф пользователя:', data.tarif);
          }
          if ((data as any).optimization) {
            setOptimization((data as any).optimization);
            console.log('Загружен параметр optimization:', (data as any).optimization);
          }
          // Синхронизация полей из Supabase в localStorage.user
          // (TikTok, prompt1 и др.), чтобы они были актуальны
          try {
            const existingStored = localStorage.getItem('user');
            const storedJson = existingStored ? JSON.parse(existingStored) : {};
            const merged = { ...storedJson };
            if ((data as any).tiktok_access_token) {
              merged.tiktok_access_token = (data as any).tiktok_access_token;
            }
            if ((data as any).tiktok_business_id) {
              merged.tiktok_business_id = (data as any).tiktok_business_id;
            }
            if ((data as any).tiktok_account_id) {
              merged.tiktok_account_id = (data as any).tiktok_account_id;
            }
            // Синхронизация prompt1 (для определения статуса онбординга)
            if ((data as any).prompt1 !== undefined) {
              merged.prompt1 = (data as any).prompt1;
            }
            // сохраняем обратно только если что-то изменилось
            const needSave = JSON.stringify(storedJson) !== JSON.stringify(merged);
            if (needSave) {
              localStorage.setItem('user', JSON.stringify(merged));
              console.log('[AppContext] Синхронизированы поля из Supabase в localStorage (TikTok, prompt1)');
            }
            setTiktokConnected(!!merged.tiktok_business_id && !!merged.tiktok_access_token);
          } catch (e) {
            console.warn('Не удалось синхронизировать поля в localStorage:', e);
            setTiktokConnected(!!(data as any).tiktok_business_id && !!(data as any).tiktok_access_token);
          }
        }

        // Отдельно загружаем business_id
        await checkBusinessId();
      } catch (err) {
        console.error('Ошибка при инициализации состояния AI автопилота:', err);
      }
    };
    
    loadAiAutopilotState();
    loadAdAccounts();

    // Слушаем событие перезагрузки аккаунтов (после онбординга в мультиаккаунтном режиме)
    const handleReloadAdAccounts = () => {
      loadAdAccounts();
    };
    window.addEventListener('reloadAdAccounts', handleReloadAdAccounts);
    return () => window.removeEventListener('reloadAdAccounts', handleReloadAdAccounts);
  }, []);

  // При смене currentAdAccountId загружаем статус автопилота для этого аккаунта
  useEffect(() => {
    const loadAutopilotStatus = async () => {
      console.log('[AppContext] loadAutopilotStatus called:', {
        multiAccountEnabled,
        currentAdAccountId,
        mode: multiAccountEnabled ? 'multi_account' : 'legacy'
      });

      try {
        if (multiAccountEnabled && currentAdAccountId) {
          // Мультиаккаунтный режим — берём из ad_accounts
          const { data, error } = await (supabase as any)
            .from('ad_accounts')
            .select('autopilot')
            .eq('id', currentAdAccountId)
            .single();

          if (error) {
            console.error('[AppContext] Ошибка загрузки autopilot из ad_accounts:', {
              accountId: currentAdAccountId,
              error: error.message
            });
            setAiAutopilot(false);
            return;
          }

          const autopilotStatus = data?.autopilot ?? false;
          setAiAutopilot(autopilotStatus);
          console.log('[AppContext] Загружен статус autopilot (multi-account):', {
            accountId: currentAdAccountId,
            autopilot: autopilotStatus,
            source: 'ad_accounts'
          });
        } else if (!multiAccountEnabled) {
          // Legacy режим — берём из user_accounts
          const storedUser = localStorage.getItem('user');
          if (storedUser) {
            const userData = JSON.parse(storedUser);
            const { data, error } = await supabase
              .from('user_accounts')
              .select('autopilot')
              .eq('id', userData.id)
              .single();

            if (error) {
              console.error('[AppContext] Ошибка загрузки autopilot из user_accounts:', {
                userId: userData.id,
                error: error.message
              });
              setAiAutopilot(false);
              return;
            }

            const autopilotStatus = data?.autopilot ?? false;
            setAiAutopilot(autopilotStatus);
            console.log('[AppContext] Загружен статус autopilot (legacy):', {
              userId: userData.id,
              autopilot: autopilotStatus,
              source: 'user_accounts'
            });
          }
        }
      } catch (err) {
        console.error('[AppContext] Критическая ошибка в loadAutopilotStatus:', err);
        setAiAutopilot(false);
      }
    };

    loadAutopilotStatus();
  }, [currentAdAccountId, multiAccountEnabled]);

  // Функция для переключения состояния AI автопилота
  const toggleAiAutopilot = async (enabled: boolean) => {
    setAiAutopilotLoading(true);
    try {
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        toast.error('Пользователь не авторизован');
        return;
      }

      const userData = JSON.parse(storedUser);
      if (!userData.id) {
        toast.error('ID пользователя не найден');
        return;
      }

      // В мультиаккаунтном режиме обновляем ad_accounts.autopilot
      if (multiAccountEnabled && currentAdAccountId) {
        const { error } = await (supabase as any)
          .from('ad_accounts')
          .update({ autopilot: enabled })
          .eq('id', currentAdAccountId);

        if (error) {
          console.error('Ошибка при обновлении autopilot в ad_accounts:', error);
          toast.error('Не удалось обновить состояние AI автопилота');
          return;
        }
        console.log('Обновлено состояние AI автопилота в ad_accounts:', { accountId: currentAdAccountId, enabled });
      } else {
        // Legacy режим - обновляем user_accounts.autopilot
        const { error } = await supabase
          .from('user_accounts')
          .update({ autopilot: enabled })
          .eq('id', userData.id);

        if (error) {
          console.error('Ошибка при обновлении состояния AI автопилота:', error);
          toast.error('Не удалось обновить состояние AI автопилота');
          return;
        }
        console.log('Обновлено состояние AI автопилота в user_accounts:', enabled);
      }

      setAiAutopilot(enabled);
      toast.success(`AI автопилот ${enabled ? 'включен' : 'выключен'}`);
    } catch (err) {
      console.error('Ошибка при переключении AI автопилота:', err);
      toast.error('Произошла ошибка при обновлении настроек');
    } finally {
      setAiAutopilotLoading(false);
    }
  };

  // Функция для проверки авторизации пользователя (только username, Facebook данные опциональны)
  const checkUserAuth = () => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      console.warn('Пользователь не авторизован. Необходима авторизация.');
      return false;
    }

    try {
      const userData = JSON.parse(storedUser);
      // Проверяем только наличие username - Facebook данные опциональны
      if (!userData || !userData.username) {
        console.warn('Недостаточно данных пользователя:', {
          hasUsername: !!userData?.username
        });
        return false;
      }

      console.log('Пользователь авторизован:', {
        username: userData.username,
        hasFacebookData: !!(userData.access_token && userData.ad_account_id)
      });
      return true;
    } catch (e) {
      console.error('Ошибка при проверке данных пользователя:', e);
      return false;
    }
  };

  const refreshData = async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('Обновление данных приложения...');

      // Проверяем авторизацию пользователя (только username)
      if (!checkUserAuth()) {
        console.warn('Невозможно обновить данные: пользователь не авторизован');
        setLoading(false);
        return;
      }

      // Проверяем наличие Facebook данных с учётом мультиаккаунтного режима
      const storedUser = localStorage.getItem('user');
      const userData = storedUser ? JSON.parse(storedUser) : null;

      // Проверяем мультиаккаунтный режим из localStorage (он сохраняется в loadAdAccounts)
      const storedMultiAccountEnabled = localStorage.getItem('multiAccountEnabled') === 'true';
      const storedAdAccounts = localStorage.getItem('adAccounts');

      let hasFacebookData = false;
      if (storedMultiAccountEnabled && storedAdAccounts) {
        // В мультиаккаунтном режиме проверяем данные в текущем выбранном ad_account
        const parsedAccounts = JSON.parse(storedAdAccounts);
        const storedCurrentAdAccountId = localStorage.getItem('currentAdAccountId');
        const currentAcc = parsedAccounts.find((a: any) => a.id === storedCurrentAdAccountId) || parsedAccounts[0];
        // Для manual-connect достаточно ad_account_id (access_token получается позже)
        hasFacebookData = !!currentAcc?.ad_account_id;
        console.log('[AppContext] Мультиаккаунт: hasFacebookData =', hasFacebookData, { ad_account_id: currentAcc?.ad_account_id, currentAdAccountId: storedCurrentAdAccountId });
      } else {
        // Legacy режим — проверяем в user_accounts
        hasFacebookData = !!(userData?.access_token && userData?.ad_account_id);
      }

      if (!hasFacebookData) {
        console.log('Facebook данные отсутствуют. Пропускаем загрузку данных Facebook.');
        setCampaigns([]);
        setCampaignStats([]);
        setLoading(false);
        return;
      }
      
      if (platform === 'instagram') {
        // Загружаем список кампаний (Instagram/Facebook)
        console.log('Запрашиваем список кампаний (Instagram/Facebook)...');
        const campaignsData = await facebookApi.getCampaigns();
        setCampaigns(campaignsData);
        console.log(`Получено ${campaignsData.length} кампаний`);

        // Загружаем статистику кампаний
        console.log('Запрашиваем статистику кампаний (Instagram/Facebook)...');
        // Для тарифа Target включаем лидформы в подсчет лидов
        const includeLeadForms = userTarif === 'target';
        const statsData = await facebookApi.getCampaignStats(dateRange, includeLeadForms);
        setCampaignStats(statsData);
      } else {
        // TikTok: загружаем кампании и статистику и маппим к общему формату
        console.log('Запрашиваем список кампаний (TikTok)...');
        const ttCampaigns = await tiktokApi.getCampaigns();
        const mappedCampaigns: Campaign[] = (ttCampaigns || []).map((c: any) => ({
          id: c.id,
          name: c.name,
          status: c.status === 'ENABLE' ? 'ACTIVE' : 'PAUSED',
          objective: c.objective || 'UNKNOWN',
          budget: Number(c.budget) || 0,
          start_time: c.start_time || new Date().toISOString(),
        }));
        setCampaigns(mappedCampaigns);
        console.log(`Получено ${mappedCampaigns.length} TikTok кампаний`);

        console.log('Запрашиваем статистику кампаний (TikTok)...');
        const ttStats = await tiktokApi.getCampaignStats(dateRange);
        const mappedStats: CampaignStat[] = (ttStats || []).map((s: any) => ({
          campaign_id: s.campaign_id,
          campaign_name: s.campaign_name,
          spend: Number(s.spend) || 0,
          impressions: Number(s.impressions) || 0,
          clicks: Number(s.clicks) || 0,
          ctr: Number(s.ctr) || 0,
          leads: Number(s.leads) || 0,
          cpl: Number(s.cpl) || (Number(s.leads) > 0 ? Number(s.spend) / Number(s.leads) : 0),
          date: s.date,
          _is_real_data: s._is_real_data,
        }));
        setCampaignStats(mappedStats);
      }
      
      // Загружаем статус рекламного кабинета
      try {
        const accStatus = await facebookApi.getAccountStatus();
        console.log('DEBUG: accStatus из facebookApi.getAccountStatus:', accStatus);
        setAccountStatus(accStatus);
        setAccountStatusError(null);
      } catch (e: any) {
        console.error('DEBUG: Ошибка при получении accStatus', e);
        setAccountStatus(null);
        setAccountStatusError(e?.message || String(e));
      }
      
      // Проверяем реальные это данные или моковые
      const statsToCheck = platform === 'instagram' ? campaignStats : campaignStats;
      const hasRealData = statsToCheck.some(stat => stat._is_real_data === true);
      console.log(`Получена статистика: ${statsToCheck.length} записей, содержит реальные данные: ${hasRealData}`);
      
      if (!hasRealData && statsToCheck.length > 0) {
        toast.warning('За выбранный период нет данных статистики. Пожалуйста, измените диапазон дат.', {
          id: 'no-real-data-warning',
          duration: 5000
        });
      }
      
    } catch (err: any) {
      // Проверяем ошибку на наличие сообщения о недействительности токена
      if (err.message && err.message.includes('Error validating application')) {
        toast.error('Ошибка авторизации в Facebook. Пожалуйста, войдите снова.');
        setError('Ошибка авторизации в Facebook. Пожалуйста, войдите в систему повторно.');
      } else {
        setError('Не удалось загрузить данные. Пожалуйста, попробуйте позже.');
        toast.error('Ошибка при загрузке данных');
      }
      console.error('Ошибка при загрузке данных:', err);
    } finally {
      setLoading(false);
    }
  };

  // Первоначальная загрузка данных при монтировании компонента
  useEffect(() => {
    refreshData();
  }, []); // Только при первом рендере

  // Следим за изменением пользователя в localStorage и обновляем данные
  useEffect(() => {
    const handleStorageChange = () => {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        refreshData();
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const toggleCampaignStatus = async (campaignId: string, isActive: boolean) => {
    setLoading(true);
    try {
      console.log(`Изменение статуса кампании ${campaignId} на ${isActive ? 'активный' : 'приостановленный'}`);
      let success = false;
      if (platform === 'instagram') {
        success = await facebookApi.updateCampaignStatus(campaignId, isActive);
      } else {
        success = await tiktokApi.updateCampaignStatus(campaignId, isActive);
      }
      
      if (success) {
        // Обновляем локальное состояние кампаний
        setCampaigns(prevCampaigns => 
          prevCampaigns.map(campaign => 
            campaign.id === campaignId 
              ? { ...campaign, status: isActive ? 'ACTIVE' : 'PAUSED' }
              : campaign
          )
        );
        
        console.log(`Статус кампании ${campaignId} успешно изменен`);
        
        // Для TikTok добавляем небольшую задержку и перезагружаем данные
        if (platform === 'tiktok') {
          console.log('TikTok: Ждем 1 секунду перед обновлением данных...');
          setTimeout(async () => {
            console.log('TikTok: Перезагружаем данные для проверки статуса...');
            await refreshData();
          }, 1000);
        }
      } else {
        console.error(`Не удалось изменить статус кампании ${campaignId}`);
      }
    } catch (err) {
      setError('Не удалось обновить статус кампании.');
      toast.error('Ошибка при обновлении статуса');
      console.error('Ошибка при изменении статуса кампании:', err);
    } finally {
      setLoading(false);
    }
  };

  // Обновляем данные при изменении диапазона дат, платформы или текущего аккаунта
  useEffect(() => {
    console.log('Изменение параметров (даты/платформа/currentAdAccountId), обновляем данные:', { dateRange, platform, currentAdAccountId });
    refreshData();
  }, [dateRange, platform, currentAdAccountId]);

  // Функция для проверки наличия business_id
  const checkBusinessId = async (): Promise<boolean> => {
    try {
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        return false;
      }
      
      const userData = JSON.parse(storedUser);
      if (!userData.id) {
        return false;
      }
      
      // Используем прямой SQL запрос для получения business_id
      const { data, error } = await supabase
        .from('user_accounts')
        .select('*')
        .eq('id', userData.id)
        .single();
        
      if (error) {
        console.error('Ошибка при проверке business_id:', error);
        return false;
      }
      
      const businessIdValue = (data as any)?.business_id || null;
      const tiktokBizId = (data as any)?.tiktok_business_id || null;
      const hasBusinessId = !!(businessIdValue);
      setBusinessId(businessIdValue);
      setTiktokConnected(!!tiktokBizId);
      return hasBusinessId;
    } catch (err) {
      console.error('Ошибка при проверке business_id:', err);
      return false;
    }
  };

  const checkTikTokConnected = async (): Promise<boolean> => {
    try {
      const storedUser = localStorage.getItem('user');
      if (!storedUser) return false;
      const userData = JSON.parse(storedUser);
      if (!userData.id) return false;
      const { data, error } = await supabase
        .from('user_accounts')
        .select('tiktok_business_id')
        .eq('id', userData.id)
        .single();
      if (error) return false;
      const isConnected = !!(data as any)?.tiktok_business_id;
      setTiktokConnected(isConnected);
      return isConnected;
    } catch {
      return false;
    }
  };

  // Функция для загрузки рекламных аккаунтов (мультиаккаунтность)
  const loadAdAccounts = async () => {
    try {
      const storedUser = localStorage.getItem('user');
      if (!storedUser) return;

      const userData = JSON.parse(storedUser);
      if (!userData.id) return;

      // Очищаем старый кэш перед загрузкой свежих данных
      localStorage.removeItem('adAccounts');
      console.log('[AppContext] Очищен кэш adAccounts, загружаем свежие данные...');

      const response = await adAccountsApi.list(userData.id);

      // DEBUG: что пришло с API (RAW данные)
      console.log('[AppContext] === RAW API RESPONSE ===');
      response.ad_accounts.forEach((acc, i) => {
        console.log(`[AppContext] RAW[${i}]:`, {
          id: acc.id?.slice(0, 8),
          name: acc.name,
          fb_ad_account_id: acc.fb_ad_account_id,
          fb_page_id: acc.fb_page_id,
        });
      });

      const mappedAccounts = response.ad_accounts.map(acc => {
        // Автоматически определяем connection_status на основе наличия всех обязательных полей
        const hasAllFbFields = !!(
          acc.fb_page_id &&
          acc.fb_instagram_id &&
          acc.fb_access_token &&
          acc.fb_ad_account_id
        );
        const computedStatus = hasAllFbFields ? 'connected' : (acc.connection_status || 'pending');

        return {
          id: acc.id,
          name: acc.name,
          username: acc.username,
          is_active: acc.is_active,
          tarif: acc.tarif,
          tarif_expires: acc.tarif_expires,
          connection_status: computedStatus as 'pending' | 'connected' | 'error',
          ad_account_id: acc.fb_ad_account_id,  // Бэкенд возвращает fb_ad_account_id
          access_token: acc.fb_access_token,    // Бэкенд возвращает fb_access_token
          page_id: acc.fb_page_id,              // Бэкенд возвращает fb_page_id (для Lead Forms)
          fb_page_id: acc.fb_page_id,           // Для аватара (используется в компонентах)
        };
      });

      setMultiAccountEnabled(response.multi_account_enabled);
      setAdAccounts(mappedAccounts);

      // Сохраняем в localStorage для использования в facebookApi
      localStorage.setItem('multiAccountEnabled', String(response.multi_account_enabled));
      localStorage.setItem('adAccounts', JSON.stringify(mappedAccounts));

      // Оповещаем App.tsx что данные о мультиаккаунтности загружены
      window.dispatchEvent(new CustomEvent('multiAccountLoaded'));

      // Устанавливаем текущий аккаунт (только из активных)
      if (response.multi_account_enabled && response.ad_accounts.length > 0) {
        const activeAccounts = response.ad_accounts.filter(a => a.is_active);

        if (activeAccounts.length > 0) {
          // Восстанавливаем из localStorage или берём первый активный
          const savedAdAccountId = localStorage.getItem('currentAdAccountId');
          const validSavedId = activeAccounts.find(a => a.id === savedAdAccountId);

          if (validSavedId) {
            setCurrentAdAccountIdState(savedAdAccountId);
          } else {
            // Берём первый активный аккаунт
            const accountToUse = activeAccounts[0];
            setCurrentAdAccountIdState(accountToUse.id);
            localStorage.setItem('currentAdAccountId', accountToUse.id);
          }
        } else {
          // Нет активных аккаунтов
          setCurrentAdAccountIdState(null);
          localStorage.removeItem('currentAdAccountId');
        }
      }
      // Legacy режим: currentAdAccountId может оставаться в localStorage,
      // но API слой (creativesApi) проверяет флаг multi_account_enabled
      // и ИГНОРИРУЕТ accountId в legacy режиме (см. MULTI_ACCOUNT_GUIDE.md)

      console.log('[AppContext] Загружены рекламные аккаунты:', {
        multiAccountEnabled: response.multi_account_enabled,
        count: response.ad_accounts.length,
      });

      // DEBUG: детальный лог для диагностики проблемы с перепутанными аккаунтами
      console.log('[AppContext] === ДЕТАЛИ АККАУНТОВ ===');
      mappedAccounts.forEach((acc, i) => {
        console.log(`[AppContext] Аккаунт ${i}:`, {
          id: acc.id.slice(0, 8),
          name: acc.name,
          ad_account_id: acc.ad_account_id,
          fb_page_id: acc.fb_page_id,
        });
      });
    } catch (error) {
      console.error('[AppContext] Ошибка загрузки рекламных аккаунтов:', error);
    }
  };

  // Сохраняем currentAdAccountId в localStorage при изменении
  useEffect(() => {
    if (currentAdAccountId) {
      localStorage.setItem('currentAdAccountId', currentAdAccountId);
    }
  }, [currentAdAccountId]);

  // Функция для обновления параметра оптимизации
  const updateOptimization = async (optimizationType: string) => {
    // Проверяем business_id для ROI оптимизации
    if (optimizationType === 'roi') {
      const hasBusinessId = await checkBusinessId();
      if (!hasBusinessId) {
        toast.error('Для выбора оптимизации по ROI необходимо подключить WhatsApp аккаунт для отслеживания лидов. Обратитесь в тех поддержку.');
        return;
      }
    }

    // Блокируем несовместимые режимы
    if (currentCampaignGoal === 'site_leads') {
      if (optimizationType === 'qual_lead' || optimizationType === 'roi') {
        toast.error('Эта оптимизация недоступна для цели «Лиды на сайте». Доступна только оптимизация по стоимости лида.');
        return;
      }
    }

    try {
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        toast.error('Пользователь не авторизован');
        return;
      }
      
      const userData = JSON.parse(storedUser);
      if (!userData.id) {
        toast.error('ID пользователя не найден');
        return;
      }
      
      const { error } = await supabase
        .from('user_accounts')
        .update({ optimization: optimizationType })
        .eq('id', userData.id);
        
      if (error) {
        console.error('Ошибка при обновлении параметров оптимизации:', error);
        toast.error('Не удалось обновить параметры оптимизации');
        return;
      }
      
      setOptimization(optimizationType);
      toast.success('Параметры оптимизации обновлены');
      console.log('Обновлен параметр optimization:', optimizationType);
    } catch (err) {
      console.error('Ошибка при обновлении параметров оптимизации:', err);
      toast.error('Произошла ошибка при обновлении настроек');
    }
  };

  return (
    <AppContext.Provider value={{
      campaigns,
      campaignStats,
      loading,
      error,
      dateRange,
      refreshData,
      setDateRange,
      toggleCampaignStatus,
      selectedCampaignId,
      setSelectedCampaignId,
      accountStatus,
      accountStatusError,
      aiAutopilot,
      toggleAiAutopilot,
      aiAutopilotLoading,
      optimization,
      updateOptimization,
      businessId,
      checkBusinessId,
      currentCampaignGoal,
      platform,
      setPlatform,
      tiktokConnected,
      checkTikTokConnected,
      // Multi-account support
      multiAccountEnabled,
      adAccounts,
      currentAdAccountId,
      setCurrentAdAccountId,
      loadAdAccounts,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext должен использоваться внутри AppProvider');
  }
  return context;
};
