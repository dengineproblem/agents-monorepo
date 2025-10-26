import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Campaign, CampaignStat, DateRange, facebookApi } from '../services/facebookApi';
import { tiktokApi } from '@/services/tiktokApi';
import { format, subDays } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '../integrations/supabase/client';

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
  currentCampaignGoal?: 'whatsapp' | 'instagram_traffic' | 'site_leads' | null;
  platform: 'instagram' | 'tiktok';
  setPlatform: (p: 'instagram' | 'tiktok') => void;
  tiktokConnected: boolean;
  checkTikTokConnected: () => Promise<boolean>;
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
  const [currentCampaignGoal, setCurrentCampaignGoal] = useState<'whatsapp' | 'instagram_traffic' | 'site_leads' | null>(null);
  const [userTarif, setUserTarif] = useState<string | null>(null);
  const [platform, setPlatform] = useState<'instagram' | 'tiktok'>('instagram');
  const [tiktokConnected, setTiktokConnected] = useState<boolean>(false);
  
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
          .select('autopilot, current_campaign_goal, tarif, optimization, tiktok_access_token, tiktok_account_id, tiktok_business_id')
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
          // Синхронизация TikTok полей из Supabase в localStorage.user,
          // чтобы tiktokApi мог их прочитать
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
            // сохраняем обратно только если что-то изменилось
            const needSave = JSON.stringify(storedJson) !== JSON.stringify(merged);
            if (needSave) {
              localStorage.setItem('user', JSON.stringify(merged));
              console.log('Синхронизированы TikTok поля из Supabase в localStorage');
            }
            setTiktokConnected(!!merged.tiktok_business_id && !!merged.tiktok_access_token);
          } catch (e) {
            console.warn('Не удалось синхронизировать TikTok поля в localStorage:', e);
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
  }, []);

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
      
      const { error } = await supabase
        .from('user_accounts')
        .update({ autopilot: enabled })
        .eq('id', userData.id);
        
      if (error) {
        console.error('Ошибка при обновлении состояния AI автопилота:', error);
        toast.error('Не удалось обновить состояние AI автопилота');
        return;
      }
      
      setAiAutopilot(enabled);
      toast.success(`AI автопилот ${enabled ? 'включен' : 'выключен'}`);
      console.log('Обновлено состояние AI автопилота:', enabled);
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

      // Проверяем наличие Facebook данных
      const storedUser = localStorage.getItem('user');
      const userData = storedUser ? JSON.parse(storedUser) : null;
      const hasFacebookData = userData?.access_token && userData?.ad_account_id;

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

  // Обновляем данные при изменении диапазона дат
  useEffect(() => {
    console.log('Изменение параметров (даты/платформа), обновляем данные:', { dateRange, platform });
    refreshData();
  }, [dateRange, platform]);

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
