/**
 * TikTok Business API service for ROI Analytics
 */

import { format, subDays, addDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/config/api';

// Types
export interface TikTokCampaign {
  id: string;
  name: string;
  status: 'ENABLE' | 'DISABLE' | 'DELETE';
  objective: string;
  budget: number;
  start_time: string;
}

export interface TikTokCampaignStat {
  campaign_id: string;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  leads: number;
  cpl: number;
  date: string;
  _is_real_data?: boolean; // Флаг для определения реальных данных
}

export interface DateRange {
  since: string;
  until: string;
}

export interface TikTokInstantPage {
  page_id: string;
  page_name: string;
  page_type: string;
  status: string;
  create_time?: string;
  modify_time?: string;
}

export interface TikTokAdGroup {
  id: string;
  name: string;
  status: 'ENABLE' | 'DISABLE' | 'DELETE';
  campaign_id: string;
  budget: number;
  daily_budget?: number;
  create_time?: string;
}

export interface TikTokAdGroupStat {
  adgroup_id: string;
  adgroup_name: string;
  campaign_id: string;
  status?: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  leads: number;  // conversions / clicks для TikTok
  cpl: number;    // cost per lead / CPC
  daily_budget?: number;
  date?: string;
  _is_real_data?: boolean;
}

export interface TikTokAd {
  id: string;
  name: string;
  status: 'ENABLE' | 'DISABLE' | 'DELETE';
  adgroup_id: string;
  thumbnail_url?: string;
  create_time?: string;
}

export interface TikTokAdStat {
  ad_id: string;
  ad_name: string;
  adgroup_id: string;
  status?: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  leads: number;
  cpl: number;
  thumbnail_url?: string;
  date?: string;
  _is_real_data?: boolean;
}

// Функция для получения данных текущего пользователя TikTok
const getCurrentUserTikTokConfig = async () => {
  // Получаем данные из localStorage
  const storedUser = localStorage.getItem('user');
  
  if (storedUser) {
    try {
      const userData = JSON.parse(storedUser);
      
      // Убедимся, что у нас есть все необходимые данные
      if (userData && userData.tiktok_business_id && userData.tiktok_access_token) {

        return {
          access_token: userData.tiktok_access_token,
          advertiser_id: userData.tiktok_business_id,
          business_id: userData.tiktok_business_id,
          identity_id: userData.tiktok_account_id,
          api_version: 'v1.3',
          base_url: 'https://business-api.tiktok.com/open_api'
        };
      } else {
        // Логируем, каких данных не хватает

      }
    } catch (error) {

    }
  } else {

  }
  
  // Если не смогли получить данные из localStorage, используем моковые данные

  return {
    access_token: '',
    advertiser_id: '',
    business_id: '',
    api_version: 'v1.3',
    base_url: 'https://business-api.tiktok.com/open_api'
  };
};

// URL прокси (n8n/свой сервис)
const PROXY_URL: string = (import.meta as any)?.env?.VITE_TIKTOK_PROXY_URL || (typeof window !== 'undefined' && (window as any).__VITE_TIKTOK_PROXY_URL) || 'https://agent.performanteaiagency.com/tproxy';

// Вспомогательная функция запросов через прокси, method: 'GET' или 'POST'
const fetchFromTikTokAPI = async (
  endpoint: string,
  params: Record<string, any> = {},
  method: 'GET' | 'POST' = 'GET'
) => {
  const TIKTOK_API_CONFIG = await getCurrentUserTikTokConfig();

  if (!TIKTOK_API_CONFIG.access_token || !TIKTOK_API_CONFIG.advertiser_id) {

    throw new Error('Нет токена или advertiser_id для TikTok');
  }

  try {
    // Для POST запросов отправляем данные в теле, для GET - в query параметрах
    if (method === 'POST') {
      const requestBody = {
        endpoint,
        method: 'POST',
        access_token: TIKTOK_API_CONFIG.access_token,
        params
      };



      const response = await fetch(PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });
      
      const text = await response.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      


      if (!response.ok || (typeof data === 'object' && data?.code && data.code !== 0)) {

        if (data?.code === 40001) {
          toast.error('Ошибка авторизации TikTok. Пожалуйста, войдите снова.');
          const storedUser = localStorage.getItem('user');
          if (storedUser) {
            try {
              const userData = JSON.parse(storedUser);
              userData.tiktok_access_token = '';
              localStorage.setItem('user', JSON.stringify(userData));
            } catch (e) {

            }
          }
        }
        throw new Error(data?.message || `TikTok proxy error: ${response.status}`);
      }

      return data;
    }
    
    // Для GET используем query параметры как раньше
    const proxyUrl = new URL(PROXY_URL);
    proxyUrl.searchParams.set('endpoint', endpoint);
    proxyUrl.searchParams.set('method', method);
    proxyUrl.searchParams.set('access_token', TIKTOK_API_CONFIG.access_token);
    proxyUrl.searchParams.set('params', JSON.stringify(params || {}));

    const response = await fetch(proxyUrl.toString(), { method: 'GET' });

    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!response.ok || (typeof data === 'object' && data?.code && data.code !== 0)) {

      if (data?.code === 40001) {
        toast.error('Ошибка авторизации TikTok. Пожалуйста, войдите снова.');
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          try {
            const userData = JSON.parse(storedUser);
            userData.tiktok_access_token = '';
            localStorage.setItem('user', JSON.stringify(userData));
          } catch (e) {

          }
        }
      }
      throw new Error(data?.message || `TikTok proxy error: ${response.status}`);
    }

    return data;
  } catch (error) {

    throw error;
  }
};

// Резервные моковые данные на случай отсутствия токена
const mockTikTokCampaigns: TikTokCampaign[] = [
  {
    id: 'ttcamp_123456789001',
    name: 'TikTok Летняя коллекция 2024',
    status: 'ENABLE',
    objective: 'CONVERSIONS',
    budget: 12000,
    start_time: '2024-06-01T00:00:00+0000',
  },
  {
    id: 'ttcamp_123456789002',
    name: 'TikTok Молодежная аудитория',
    status: 'ENABLE',
    objective: 'REACH',
    budget: 8000,
    start_time: '2024-09-01T00:00:00+0000',
  },
  {
    id: 'ttcamp_123456789003',
    name: 'TikTok Праздничная промо',
    status: 'DISABLE',
    objective: 'VIDEO_VIEWS',
    budget: 15000,
    start_time: '2024-11-20T00:00:00+0000',
  },
];

// Генерация моковых статистик на случай отсутствия токена
const generateMockTikTokStats = (dateRange: DateRange): TikTokCampaignStat[] => {
  const stats: TikTokCampaignStat[] = [];
  const startDate = new Date(dateRange.since);
  const endDate = new Date(dateRange.until);

  // Create a date collection for the range
  const dates: Date[] = [];
  let currentDate = startDate;
  
  while (currentDate <= endDate) {
    dates.push(new Date(currentDate));
    currentDate = addDays(currentDate, 1);
  }

  // Generate stats for each campaign for each day
  mockTikTokCampaigns.forEach(campaign => {
    dates.forEach(date => {
      const dayOfWeek = date.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const dateStr = format(date, 'yyyy-MM-dd');
      
      // Define base metrics (slightly randomized for TikTok)
      const baseSpend = campaign.budget / 30 * (isWeekend ? 0.6 : 1.3); // TikTok более активен в будни
      const spend = parseFloat((baseSpend * (0.7 + Math.random() * 0.6)).toFixed(2));
      
      const baseImpressions = spend * 120 * (0.8 + Math.random() * 0.4); // TikTok показывает больше
      const impressions = Math.round(baseImpressions);
      
      const baseClickRate = 0.025 + Math.random() * 0.015; // TikTok имеет выше CTR
      const clicks = Math.round(impressions * baseClickRate);
      
      const ctr = parseFloat((clicks / impressions * 100).toFixed(2));
      
      // TikTok лиды (обычно меньше чем у Facebook)
      const baseTikTokLeadRate = 0.01 + Math.random() * 0.015;
      const tiktokLeads = Math.round(clicks * baseTikTokLeadRate);
      
      const leads = tiktokLeads;
      const cpl = parseFloat((spend / (leads || 1)).toFixed(2));

      // Add stat entry with flag that it's mock data
      stats.push({
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        spend,
        impressions,
        clicks,
        ctr,
        leads,
        cpl,
        date: dateStr,
        _is_real_data: false // Явно помечаем как нереальные данные
      });
    });
  });

  return stats;
};

// Проверка наличия токена и ID рекламного кабинета TikTok
const hasValidTikTokConfig = async () => {
  const TIKTOK_API_CONFIG = await getCurrentUserTikTokConfig();
  const isValid = !!TIKTOK_API_CONFIG.access_token && !!TIKTOK_API_CONFIG.advertiser_id;
  
  if (!isValid) {

  }
  
  return isValid;
};

// TikTok API сервис
export const tiktokApi = {
  // Получить все кампании TikTok
  getCampaigns: async (): Promise<TikTokCampaign[]> => {

    if (!await hasValidTikTokConfig()) {

      // Не показываем уведомление и не возвращаем моковые кампании
      return [];
    }
    
    try {
      const TIKTOK_API_CONFIG = await getCurrentUserTikTokConfig();
      const advertiserId = TIKTOK_API_CONFIG.advertiser_id;

      // Endpoint кампаний TikTok
      const endpoint = `campaign/get/`;
      const params = {
        advertiser_id: advertiserId,
        fields: ['campaign_id', 'campaign_name', 'operation_status', 'objective_type', 'budget', 'create_time'],
        page: 1,
        page_size: 100
      } as any;
      const response = await fetchFromTikTokAPI(endpoint, params, 'GET');

      if (response.code !== 0) {

        throw new Error(`TikTok API Error: ${response.message}`);
      }
      
      if (!response.data?.list || response.data.list.length === 0) {

        return [];
      }
      
      return (response.data.list || []).map((campaign: any) => ({
        id: campaign.campaign_id,
        name: campaign.campaign_name,
        status: campaign.operation_status === 'ENABLE' ? 'ENABLE' : 'DISABLE',
        objective: campaign.objective_type || 'UNKNOWN',
        budget: Number(campaign.budget) || 0,
        start_time: campaign.create_time || new Date().toISOString()
      }));
    } catch (error) {
      toast.error('Не удалось получить список TikTok кампаний. Попробуйте позже.');
      return [];
    }
  },
  
  // Получить статистику TikTok кампаний за период
  getCampaignStats: async (dateRange: DateRange): Promise<TikTokCampaignStat[]> => {

    if (!await hasValidTikTokConfig()) {

      return [];
    }
    
    try {
      const TIKTOK_API_CONFIG = await getCurrentUserTikTokConfig();
      const advertiserId = TIKTOK_API_CONFIG.advertiser_id;

      // Сначала получаем список кампаний, чтобы затем создать для них нулевую статистику при необходимости
      const campaigns = await tiktokApi.getCampaigns();
      
      if (!campaigns || campaigns.length === 0) {

        return [];
      }
      
      const endpoint = `report/integrated/get/`;

      // TikTok ограничивает span для stat_time_day 30 днями. Разбиваем диапазон на окна <=30 дней
      const MAX_DAYS = 30;
      const startDate = new Date(dateRange.since);
      const endDate = new Date(dateRange.until);
      const allItems: any[] = [];

      let windowStart = new Date(startDate);
      while (windowStart <= endDate) {
        const windowEnd = new Date(Math.min(
          addDays(windowStart, MAX_DAYS - 1).getTime(),
          endDate.getTime()
        ));

        const params = {
          advertiser_id: advertiserId,
          report_type: 'BASIC',
          service_type: 'AUCTION',
          data_level: 'AUCTION_CAMPAIGN',
          dimensions: ['campaign_id', 'stat_time_day'],
          metrics: ['spend', 'impressions', 'clicks', 'ctr', 'conversion'],
          start_date: format(windowStart, 'yyyy-MM-dd'),
          end_date: format(windowEnd, 'yyyy-MM-dd'),
          page: 1,
          page_size: 1000
        } as any;

        const response = await fetchFromTikTokAPI(endpoint, params, 'POST');
        if (response.code !== 0) {

          throw new Error(`TikTok API Error: ${response.message}`);
        }
        const items = response.data?.list || [];

        allItems.push(...items);

        windowStart = addDays(windowStart, MAX_DAYS);
      }

      // Если получены данные от API, обрабатываем их и возвращаем
      if (allItems.length > 0) {
        const result = allItems.map((stat: any) => {
          // Для TikTok считаем «переходы в WhatsApp» по кликам
          const clicks = parseInt(stat.metrics?.clicks || "0", 10);
          const leads = clicks; // переиспользуем поле leads как «переходы» для совместимости UI
          
          // Расчёт производных метрик
          const spend = parseFloat(stat.metrics?.spend || "0");
          const impressions = parseInt(stat.metrics?.impressions || "0", 10);
          const ctr = parseFloat(stat.metrics?.ctr || "0");
          const cpl = clicks > 0 ? spend / clicks : 0; // фактически CPC
          
          return {
            campaign_id: stat.dimensions?.campaign_id,
            campaign_name: stat.dimensions?.campaign_name || 'Unknown Campaign',
            spend,
            impressions,
            clicks,
            ctr,
            leads,
            cpl,
            date: stat.dimensions?.stat_time_day,
            _is_real_data: true // Помечаем как реальные данные
          };
        });

        return result;
      }
      
      // Если API вернул пустые данные, создаем нулевые статистики для каждой кампании на каждую дату

      // Получаем все даты в диапазоне для создания ежедневной статистики
      const dates: Date[] = [];
      let currentDate = new Date(dateRange.since);
      const rangeEndDate = new Date(dateRange.until);
      
      while (currentDate <= rangeEndDate) {
        dates.push(new Date(currentDate));
        currentDate = addDays(currentDate, 1);
      }
      
      // Создаем статистику с нулями для каждой кампании на каждую дату
      const zeroStats: TikTokCampaignStat[] = [];
      
      campaigns.forEach(campaign => {
        dates.forEach(date => {
          const dateStr = format(date, 'yyyy-MM-dd');
          zeroStats.push({
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            spend: 0,
            impressions: 0,
            clicks: 0,
            ctr: 0,
            leads: 0,
            cpl: 0,
            date: dateStr,
            _is_real_data: true // Это реальные данные с нулевыми значениями
          });
        });
      });

      return zeroStats;
    } catch (error) {
      toast.error('Не удалось получить статистику TikTok кампаний. Попробуйте позже.');
      return [];
    }
  },
  
  // Обновить статус TikTok кампании
  updateCampaignStatus: async (campaignId: string, isActive: boolean): Promise<boolean> => {

    if (!await hasValidTikTokConfig()) {

      toast.warning('Используются тестовые данные TikTok. Изменения не будут сохранены.');
      await new Promise(resolve => setTimeout(resolve, 600)); // Имитация задержки API
      
      const campaignIndex = mockTikTokCampaigns.findIndex(c => c.id === campaignId);
      if (campaignIndex !== -1) {
        mockTikTokCampaigns[campaignIndex].status = isActive ? 'ENABLE' : 'DISABLE';
        return true;
      }
      return false;
    }
    
    try {
      const TIKTOK_API_CONFIG = await getCurrentUserTikTokConfig();
      // Используем campaign/status/update/ - ПРАВИЛЬНЫЙ endpoint для изменения статуса!
      // Прокси сам добавит версию API
      const endpoint = `campaign/status/update/`;
      const status = isActive ? 'ENABLE' : 'DISABLE';

      // ПРАВИЛЬНЫЙ формат: campaign_ids (массив!) и operation_status
      const params = {
        advertiser_id: TIKTOK_API_CONFIG.advertiser_id,
        campaign_ids: [campaignId],  // Массив campaign_ids!
        operation_status: status
      };



      
      const response = await fetchFromTikTokAPI(endpoint, params, 'POST');




      if (response.code !== 0) {

        toast.error('Не удалось изменить статус TikTok кампании');
        throw new Error(`TikTok API Error: ${response.message}`);
      }
      
      // Проверяем, есть ли в ответе информация о том, что изменение применено
      if (response.data) {

      }

      toast.success(`TikTok кампания ${isActive ? 'запущена' : 'приостановлена'}`);
      
      return true;
    } catch (error) {

      toast.error('Не удалось обновить статус TikTok кампании');
      return false;
    }
  },
  
  // Получить статистику TikTok кампании по дням для графиков
  getCampaignStatsByDay: async (campaignId: string, dateRange: DateRange): Promise<TikTokCampaignStat[]> => {
    if (!await hasValidTikTokConfig()) {
      return [];
    }

    try {
      const TIKTOK_API_CONFIG = await getCurrentUserTikTokConfig();
      const endpoint = `report/integrated/get/`;
      const params = {
        advertiser_id: TIKTOK_API_CONFIG.advertiser_id,
        report_type: 'BASIC',
        service_type: 'AUCTION',
        data_level: 'AUCTION_CAMPAIGN',
        dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
        metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'ctr', 'conversion']),
        start_date: dateRange.since,
        end_date: dateRange.until,
        filtering: JSON.stringify([{
          field_name: 'campaign_id',
          filter_type: 'IN',
          filter_value: JSON.stringify([campaignId])
        }]),
        page: '1',
        page_size: '1000'
      };

      const response = await fetchFromTikTokAPI(endpoint, params);

      if (response.code !== 0 || !response.data?.list) {
        return [];
      }

      return (response.data.list || []).map((stat: any) => {
        const leads = parseInt(stat.metrics?.conversion || "0", 10);
        const spend = parseFloat(stat.metrics?.spend || "0");
        const impressions = parseInt(stat.metrics?.impressions || "0", 10);
        const clicks = parseInt(stat.metrics?.clicks || "0", 10);
        const ctr = parseFloat(stat.metrics?.ctr || "0");
        const cpl = leads > 0 ? spend / leads : 0;

        return {
          campaign_id: stat.dimensions?.campaign_id,
          campaign_name: stat.dimensions?.campaign_name || 'Unknown Campaign',
          spend,
          impressions,
          clicks,
          ctr,
          leads,
          cpl,
          date: stat.dimensions?.stat_time_day,
          _is_real_data: true
        };
      });
    } catch (error) {
      toast.error('Не удалось получить статистику TikTok кампании по дням.');
      return [];
    }
  },

  /**
   * Получить список Instant Pages (Lead Forms) для TikTok аккаунта
   * Вызывает backend endpoint /tiktok/instant-pages
   *
   * @param userAccountId - UUID пользователя из user_accounts (legacy mode)
   * @param adAccountId - UUID рекламного аккаунта из ad_accounts (multi-account mode)
   */
  getInstantPages: async (
    userAccountId?: string,
    adAccountId?: string
  ): Promise<TikTokInstantPage[]> => {

    try {
      const params = new URLSearchParams();
      if (userAccountId) params.append('userAccountId', userAccountId);
      if (adAccountId) params.append('adAccountId', adAccountId);

      const url = `${API_BASE_URL}/tiktok/instant-pages?${params.toString()}`;

      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok || !data.success) {

        toast.error(data.error || 'Не удалось получить список Instant Forms');
        return [];
      }

      return data.data || [];
    } catch (error) {

      toast.error('Ошибка при получении списка Instant Forms');
      return [];
    }
  },

  // Получить Ad Groups для кампании
  getAdGroupsByCampaign: async (campaignId: string): Promise<TikTokAdGroup[]> => {

    if (!await hasValidTikTokConfig()) {

      return [];
    }

    try {
      const TIKTOK_API_CONFIG = await getCurrentUserTikTokConfig();
      const endpoint = `adgroup/get/`;
      const params = {
        advertiser_id: TIKTOK_API_CONFIG.advertiser_id,
        campaign_ids: [campaignId],
        fields: ['adgroup_id', 'adgroup_name', 'operation_status', 'campaign_id', 'budget', 'create_time'],
        page: 1,
        page_size: 100
      };

      const response = await fetchFromTikTokAPI(endpoint, params, 'GET');

      if (response.code !== 0) {

        throw new Error(`TikTok API Error: ${response.message}`);
      }

      if (!response.data?.list || response.data.list.length === 0) {

        return [];
      }

      return (response.data.list || []).map((adgroup: any) => ({
        id: adgroup.adgroup_id,
        name: adgroup.adgroup_name,
        status: adgroup.operation_status === 'ENABLE' ? 'ENABLE' : 'DISABLE',
        campaign_id: adgroup.campaign_id,
        budget: Number(adgroup.budget) || 0,
        daily_budget: Number(adgroup.budget) || 0,
        create_time: adgroup.create_time
      }));
    } catch (error) {

      toast.error('Не удалось загрузить Ad Groups');
      return [];
    }
  },

  // Получить статистику Ad Groups для кампании
  getAdGroupStats: async (campaignId: string, dateRange: DateRange): Promise<TikTokAdGroupStat[]> => {

    if (!await hasValidTikTokConfig()) {
      return [];
    }

    try {
      const TIKTOK_API_CONFIG = await getCurrentUserTikTokConfig();
      const endpoint = `report/integrated/get/`;

      // TikTok ограничивает 30 днями
      const MAX_DAYS = 30;
      const startDate = new Date(dateRange.since);
      const endDate = new Date(dateRange.until);
      const allItems: any[] = [];

      let windowStart = new Date(startDate);
      while (windowStart <= endDate) {
        const windowEnd = new Date(Math.min(
          addDays(windowStart, MAX_DAYS - 1).getTime(),
          endDate.getTime()
        ));

        const params = {
          advertiser_id: TIKTOK_API_CONFIG.advertiser_id,
          report_type: 'BASIC',
          service_type: 'AUCTION',
          data_level: 'AUCTION_ADGROUP',
          dimensions: ['adgroup_id', 'stat_time_day'],
          metrics: ['spend', 'impressions', 'clicks', 'ctr', 'conversion'],
          filtering: [{
            field_name: 'campaign_id',
            filter_type: 'IN',
            filter_value: JSON.stringify([campaignId])
          }],
          start_date: format(windowStart, 'yyyy-MM-dd'),
          end_date: format(windowEnd, 'yyyy-MM-dd'),
          page: 1,
          page_size: 1000
        };

        const response = await fetchFromTikTokAPI(endpoint, params, 'POST');
        if (response.code !== 0) {
          throw new Error(`TikTok API Error: ${response.message}`);
        }
        const items = response.data?.list || [];
        allItems.push(...items);

        windowStart = addDays(windowStart, MAX_DAYS);
      }

      // Агрегируем по adgroup_id
      const statsMap = new Map<string, TikTokAdGroupStat>();

      for (const stat of allItems) {
        const adgroupId = stat.dimensions?.adgroup_id;
        if (!adgroupId) continue;

        const existing = statsMap.get(adgroupId);
        const spend = parseFloat(stat.metrics?.spend || '0');
        const impressions = parseInt(stat.metrics?.impressions || '0', 10);
        const clicks = parseInt(stat.metrics?.clicks || '0', 10);

        if (existing) {
          existing.spend += spend;
          existing.impressions += impressions;
          existing.clicks += clicks;
          existing.leads += clicks; // Используем clicks как leads для TikTok
        } else {
          statsMap.set(adgroupId, {
            adgroup_id: adgroupId,
            adgroup_name: stat.dimensions?.adgroup_name || 'Unknown Ad Group',
            campaign_id: campaignId,
            spend,
            impressions,
            clicks,
            ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
            leads: clicks,
            cpl: clicks > 0 ? spend / clicks : 0,
            _is_real_data: true
          });
        }
      }

      // Пересчитываем CTR и CPL после агрегации
      const result = Array.from(statsMap.values()).map(s => ({
        ...s,
        ctr: s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0,
        cpl: s.leads > 0 ? s.spend / s.leads : 0
      }));

      return result;
    } catch (error) {

      toast.error('Не удалось загрузить статистику Ad Groups');
      return [];
    }
  },

  // Получить Ads для Ad Group
  getAdsByAdGroup: async (adGroupId: string): Promise<TikTokAd[]> => {

    if (!await hasValidTikTokConfig()) {
      return [];
    }

    try {
      const TIKTOK_API_CONFIG = await getCurrentUserTikTokConfig();
      const endpoint = `ad/get/`;
      const params = {
        advertiser_id: TIKTOK_API_CONFIG.advertiser_id,
        adgroup_ids: [adGroupId],
        fields: ['ad_id', 'ad_name', 'operation_status', 'adgroup_id', 'create_time'],
        page: 1,
        page_size: 100
      };

      const response = await fetchFromTikTokAPI(endpoint, params, 'GET');

      if (response.code !== 0) {

        throw new Error(`TikTok API Error: ${response.message}`);
      }

      if (!response.data?.list || response.data.list.length === 0) {

        return [];
      }

      return (response.data.list || []).map((ad: any) => ({
        id: ad.ad_id,
        name: ad.ad_name,
        status: ad.operation_status === 'ENABLE' ? 'ENABLE' : 'DISABLE',
        adgroup_id: ad.adgroup_id,
        thumbnail_url: ad.image_ids?.[0] || undefined,
        create_time: ad.create_time
      }));
    } catch (error) {

      toast.error('Не удалось загрузить объявления');
      return [];
    }
  },

  // Получить статистику Ads для Ad Group
  getAdStatsByAdGroup: async (adGroupId: string, dateRange: DateRange): Promise<TikTokAdStat[]> => {

    if (!await hasValidTikTokConfig()) {
      return [];
    }

    try {
      const TIKTOK_API_CONFIG = await getCurrentUserTikTokConfig();
      const endpoint = `report/integrated/get/`;

      const MAX_DAYS = 30;
      const startDate = new Date(dateRange.since);
      const endDate = new Date(dateRange.until);
      const allItems: any[] = [];

      let windowStart = new Date(startDate);
      while (windowStart <= endDate) {
        const windowEnd = new Date(Math.min(
          addDays(windowStart, MAX_DAYS - 1).getTime(),
          endDate.getTime()
        ));

        const params = {
          advertiser_id: TIKTOK_API_CONFIG.advertiser_id,
          report_type: 'BASIC',
          service_type: 'AUCTION',
          data_level: 'AUCTION_AD',
          dimensions: ['ad_id', 'stat_time_day'],
          metrics: ['spend', 'impressions', 'clicks', 'ctr', 'conversion'],
          filtering: [{
            field_name: 'adgroup_id',
            filter_type: 'IN',
            filter_value: JSON.stringify([adGroupId])
          }],
          start_date: format(windowStart, 'yyyy-MM-dd'),
          end_date: format(windowEnd, 'yyyy-MM-dd'),
          page: 1,
          page_size: 1000
        };

        const response = await fetchFromTikTokAPI(endpoint, params, 'POST');
        if (response.code !== 0) {
          throw new Error(`TikTok API Error: ${response.message}`);
        }
        const items = response.data?.list || [];
        allItems.push(...items);

        windowStart = addDays(windowStart, MAX_DAYS);
      }

      // Агрегируем по ad_id
      const statsMap = new Map<string, TikTokAdStat>();

      for (const stat of allItems) {
        const adId = stat.dimensions?.ad_id;
        if (!adId) continue;

        const existing = statsMap.get(adId);
        const spend = parseFloat(stat.metrics?.spend || '0');
        const impressions = parseInt(stat.metrics?.impressions || '0', 10);
        const clicks = parseInt(stat.metrics?.clicks || '0', 10);

        if (existing) {
          existing.spend += spend;
          existing.impressions += impressions;
          existing.clicks += clicks;
          existing.leads += clicks;
        } else {
          statsMap.set(adId, {
            ad_id: adId,
            ad_name: stat.dimensions?.ad_name || 'Unknown Ad',
            adgroup_id: adGroupId,
            spend,
            impressions,
            clicks,
            ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
            leads: clicks,
            cpl: clicks > 0 ? spend / clicks : 0,
            _is_real_data: true
          });
        }
      }

      const result = Array.from(statsMap.values()).map(s => ({
        ...s,
        ctr: s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0,
        cpl: s.leads > 0 ? s.spend / s.leads : 0
      }));

      return result;
    } catch (error) {

      toast.error('Не удалось загрузить статистику объявлений');
      return [];
    }
  },

  // Обновить статус Ad Group
  updateAdGroupStatus: async (adGroupId: string, isActive: boolean): Promise<boolean> => {

    if (!await hasValidTikTokConfig()) {
      toast.warning('Нет подключения к TikTok');
      return false;
    }

    try {
      const TIKTOK_API_CONFIG = await getCurrentUserTikTokConfig();
      const endpoint = `adgroup/status/update/`;
      const status = isActive ? 'ENABLE' : 'DISABLE';

      const params = {
        advertiser_id: TIKTOK_API_CONFIG.advertiser_id,
        adgroup_ids: [adGroupId],
        operation_status: status
      };

      const response = await fetchFromTikTokAPI(endpoint, params, 'POST');

      if (response.code !== 0) {

        toast.error('Не удалось изменить статус Ad Group');
        return false;
      }

      toast.success(`Ad Group ${isActive ? 'запущена' : 'приостановлена'}`);
      return true;
    } catch (error) {

      toast.error('Не удалось обновить статус Ad Group');
      return false;
    }
  },

  // Обновить статус Ad
  updateAdStatus: async (adId: string, isActive: boolean): Promise<boolean> => {

    if (!await hasValidTikTokConfig()) {
      toast.warning('Нет подключения к TikTok');
      return false;
    }

    try {
      const TIKTOK_API_CONFIG = await getCurrentUserTikTokConfig();
      const endpoint = `ad/status/update/`;
      const status = isActive ? 'ENABLE' : 'DISABLE';

      const params = {
        advertiser_id: TIKTOK_API_CONFIG.advertiser_id,
        ad_ids: [adId],
        operation_status: status
      };

      const response = await fetchFromTikTokAPI(endpoint, params, 'POST');

      if (response.code !== 0) {

        toast.error('Не удалось изменить статус объявления');
        return false;
      }

      toast.success(`Объявление ${isActive ? 'запущено' : 'приостановлено'}`);
      return true;
    } catch (error) {

      toast.error('Не удалось обновить статус объявления');
      return false;
    }
  }
}; 