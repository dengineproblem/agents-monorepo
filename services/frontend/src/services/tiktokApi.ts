/**
 * TikTok Business API service for ROI Analytics
 *
 * Все запросы к TikTok API идут через бэкенд-прокси /tiktok-proxy.
 * Токен хранится только на бэкенде, фронтенд передаёт x-user-id.
 */

import { format, addDays } from 'date-fns';
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
  _is_real_data?: boolean;
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
  leads: number;
  cpl: number;
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

/**
 * Получение userAccountId и adAccountId для бэкенд-прокси.
 * Токены НЕ хранятся на фронтенде — всё через /tiktok-proxy.
 */
const getUserIds = (): { userAccountId: string; adAccountId?: string } | null => {
  const storedUser = localStorage.getItem('user');
  if (!storedUser) {
    console.error('[tiktokApi] Данные пользователя не найдены в localStorage');
    return null;
  }

  try {
    const userData = JSON.parse(storedUser);
    if (!userData?.id) {
      console.error('[tiktokApi] Нет user.id в localStorage');
      return null;
    }

    // Multi-account: currentAdAccountId из localStorage
    const multiAccountEnabled = localStorage.getItem('multiAccountEnabled') === 'true';
    const adAccountId = multiAccountEnabled ? localStorage.getItem('currentAdAccountId') || undefined : undefined;

    return { userAccountId: userData.id, adAccountId };
  } catch (error) {
    console.error('[tiktokApi] Ошибка чтения данных из localStorage:', error);
    return null;
  }
};

/**
 * Вспомогательная функция: вызов TikTok API через бэкенд-прокси /tiktok-proxy
 * Токен хранится на бэкенде, фронтенд передаёт только x-user-id.
 * advertiser_id добавляется бэкендом автоматически.
 */
const fetchFromTikTokAPI = async (
  endpoint: string,
  params: Record<string, any> = {},
  method: 'GET' | 'POST' = 'GET'
) => {
  const ids = getUserIds();
  if (!ids) {
    throw new Error('Пользователь не авторизован');
  }

  try {
    console.log('[TikTokProxy] Запрос через бэкенд:', { endpoint, method });

    const response = await fetch(`${API_BASE_URL}/tiktok-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': ids.userAccountId,
      },
      body: JSON.stringify({
        endpoint,
        params,
        method,
        adAccountId: ids.adAccountId,
      }),
    });

    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!response.ok || (typeof data === 'object' && data?.code && data.code !== 0)) {
      console.error('[TikTokProxy] Ошибка:', data);
      if (data?.code === 40001) {
        toast.error('Ошибка авторизации TikTok. Пожалуйста, войдите снова.');
      }
      throw new Error(data?.message || data?.error || `TikTok proxy error: ${response.status}`);
    }

    return data;
  } catch (error) {
    console.error('[TikTokProxy] Ошибка при запросе:', error);
    throw error;
  }
};

// Проверка наличия авторизации для TikTok запросов
const hasValidTikTokConfig = () => {
  return !!getUserIds();
};

// TikTok API сервис
export const tiktokApi = {
  // Получить все кампании TikTok
  getCampaigns: async (): Promise<TikTokCampaign[]> => {
    console.log('Запрос на получение TikTok кампаний');

    if (!hasValidTikTokConfig()) {
      console.warn('Нет данных для получения TikTok кампаний. Возвращаю пустой массив.');
      return [];
    }

    try {
      const endpoint = `campaign/get/`;
      const params = {
        fields: ['campaign_id', 'campaign_name', 'operation_status', 'objective_type', 'budget', 'create_time'],
        page: 1,
        page_size: 100
      };
      const response = await fetchFromTikTokAPI(endpoint, params, 'GET');
      console.log('Получены данные TikTok кампаний от API:', {
        code: response.code,
        count: response.data?.list?.length || 0
      });

      if (response.code !== 0) {
        console.error('TikTok API вернул ошибку:', response.message);
        throw new Error(`TikTok API Error: ${response.message}`);
      }

      if (!response.data?.list || response.data.list.length === 0) {
        console.warn('TikTok API вернул пустой список кампаний, возвращаю пустой массив');
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
    console.log('Запрос статистики TikTok кампаний за период:', dateRange);

    if (!hasValidTikTokConfig()) {
      console.warn('Нет данных для получения статистики TikTok. Возвращаю пустой массив.');
      return [];
    }

    try {
      // Сначала получаем список кампаний, чтобы затем создать для них нулевую статистику при необходимости
      const campaigns = await tiktokApi.getCampaigns();

      if (!campaigns || campaigns.length === 0) {
        console.warn('Нет TikTok кампаний для запроса статистики, возвращаю пустой массив');
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
          report_type: 'BASIC',
          service_type: 'AUCTION',
          data_level: 'AUCTION_CAMPAIGN',
          dimensions: ['campaign_id', 'stat_time_day'],
          metrics: ['spend', 'impressions', 'clicks', 'ctr', 'conversion'],
          start_date: format(windowStart, 'yyyy-MM-dd'),
          end_date: format(windowEnd, 'yyyy-MM-dd'),
          page: 1,
          page_size: 1000
        };

        console.log('Отправляем запрос к TikTok API для окна:', {
          since: format(windowStart, 'yyyy-MM-dd'),
          until: format(windowEnd, 'yyyy-MM-dd')
        });

        const response = await fetchFromTikTokAPI(endpoint, params, 'GET');
        if (response.code !== 0) {
          console.error('TikTok API вернул ошибку:', response.message);
          throw new Error(`TikTok API Error: ${response.message}`);
        }
        const items = response.data?.list || [];
        console.log('Получено записей для окна:', items.length);
        allItems.push(...items);

        windowStart = addDays(windowStart, MAX_DAYS);
      }

      // Если получены данные от API, обрабатываем их и возвращаем
      if (allItems.length > 0) {
        console.log('Обрабатываем агрегированные данные статистики TikTok (все окна)');
        const result = allItems.map((stat: any) => {
          const clicks = parseInt(stat.metrics?.clicks || "0", 10);
          const leads = parseInt(stat.metrics?.conversion || "0", 10);

          const spend = parseFloat(stat.metrics?.spend || "0");
          const impressions = parseInt(stat.metrics?.impressions || "0", 10);
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

        console.log('Обработано реальных данных статистики TikTok:', result.length);
        return result;
      }

      // Если API вернул пустые данные, создаем нулевые статистики для каждой кампании на каждую дату
      console.log('TikTok API вернул пустые данные статистики, создаем нулевые записи для реальных кампаний');

      const dates: Date[] = [];
      let currentDate = new Date(dateRange.since);
      const rangeEndDate = new Date(dateRange.until);

      while (currentDate <= rangeEndDate) {
        dates.push(new Date(currentDate));
        currentDate = addDays(currentDate, 1);
      }

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
            _is_real_data: true
          });
        });
      });

      console.log(`Создано ${zeroStats.length} записей статистики TikTok с нулевыми значениями`);
      return zeroStats;
    } catch (error) {
      toast.error('Не удалось получить статистику TikTok кампаний. Попробуйте позже.');
      return [];
    }
  },

  // Обновить статус TikTok кампании
  updateCampaignStatus: async (campaignId: string, isActive: boolean): Promise<boolean> => {
    console.log(`Запрос на изменение статуса TikTok кампании ${campaignId} на ${isActive ? 'ENABLE' : 'DISABLE'}`);

    if (!hasValidTikTokConfig()) {
      toast.warning('Нет подключения к TikTok');
      return false;
    }

    try {
      const endpoint = `campaign/status/update/`;
      const status = isActive ? 'ENABLE' : 'DISABLE';

      const params = {
        campaign_ids: [campaignId],
        operation_status: status
      };

      const response = await fetchFromTikTokAPI(endpoint, params, 'POST');

      if (response.code !== 0) {
        console.error('Ошибка TikTok API при изменении статуса:', response.message);
        toast.error('Не удалось изменить статус TikTok кампании');
        throw new Error(`TikTok API Error: ${response.message}`);
      }

      console.log('Результат изменения статуса TikTok кампании - успешно');
      toast.success(`TikTok кампания ${isActive ? 'запущена' : 'приостановлена'}`);

      return true;
    } catch (error) {
      console.error('Ошибка при изменении статуса TikTok кампании:', error);
      toast.error('Не удалось обновить статус TikTok кампании');
      return false;
    }
  },

  // Получить статистику TikTok кампании по дням для графиков
  getCampaignStatsByDay: async (campaignId: string, dateRange: DateRange): Promise<TikTokCampaignStat[]> => {
    if (!hasValidTikTokConfig()) {
      return [];
    }

    try {
      const endpoint = `report/integrated/get/`;
      const params = {
        report_type: 'BASIC',
        service_type: 'AUCTION',
        data_level: 'AUCTION_CAMPAIGN',
        dimensions: ['campaign_id', 'stat_time_day'],
        metrics: ['spend', 'impressions', 'clicks', 'ctr', 'conversion'],
        start_date: dateRange.since,
        end_date: dateRange.until,
        filtering: {
          campaign_ids: [campaignId]
        },
        page: 1,
        page_size: 1000
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
   */
  getInstantPages: async (
    userAccountId?: string,
    adAccountId?: string
  ): Promise<TikTokInstantPage[]> => {
    console.log('[tiktokApi] getInstantPages', { userAccountId, adAccountId });

    try {
      const params = new URLSearchParams();
      if (userAccountId) params.append('userAccountId', userAccountId);
      if (adAccountId) params.append('adAccountId', adAccountId);

      const url = `${API_BASE_URL}/tiktok/instant-pages?${params.toString()}`;
      console.log('[tiktokApi] Fetching instant pages from:', url);

      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok || !data.success) {
        console.error('[tiktokApi] Error fetching instant pages:', data.error);
        toast.error(data.error || 'Не удалось получить список Instant Forms');
        return [];
      }

      console.log('[tiktokApi] Got instant pages:', data.data?.length || 0);
      return data.data || [];
    } catch (error) {
      console.error('[tiktokApi] Exception fetching instant pages:', error);
      toast.error('Ошибка при получении списка Instant Forms');
      return [];
    }
  },

  // Получить Ad Groups для кампании
  getAdGroupsByCampaign: async (campaignId: string): Promise<TikTokAdGroup[]> => {
    console.log('[tiktokApi] getAdGroupsByCampaign:', campaignId);

    if (!hasValidTikTokConfig()) {
      console.warn('Нет данных для получения TikTok Ad Groups');
      return [];
    }

    try {
      const endpoint = `adgroup/get/`;
      const params = {
        filtering: { campaign_ids: [campaignId] },
        fields: ['adgroup_id', 'adgroup_name', 'operation_status', 'campaign_id', 'budget', 'create_time'],
        page: 1,
        page_size: 100
      };

      const response = await fetchFromTikTokAPI(endpoint, params, 'GET');

      if (response.code !== 0) {
        console.error('TikTok API error:', response.message);
        throw new Error(`TikTok API Error: ${response.message}`);
      }

      if (!response.data?.list || response.data.list.length === 0) {
        console.log('No ad groups found for campaign:', campaignId);
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
      console.error('Error fetching TikTok ad groups:', error);
      toast.error('Не удалось загрузить Ad Groups');
      return [];
    }
  },

  // Получить статистику Ad Groups для кампании
  getAdGroupStats: async (campaignId: string, dateRange: DateRange): Promise<TikTokAdGroupStat[]> => {
    console.log('[tiktokApi] getAdGroupStats:', { campaignId, dateRange });

    if (!hasValidTikTokConfig()) {
      return [];
    }

    try {
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
          report_type: 'BASIC',
          service_type: 'AUCTION',
          data_level: 'AUCTION_ADGROUP',
          dimensions: ['adgroup_id', 'stat_time_day'],
          metrics: ['spend', 'impressions', 'clicks', 'ctr', 'conversion'],
          filtering: [
            { field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify([campaignId]) }
          ],
          start_date: format(windowStart, 'yyyy-MM-dd'),
          end_date: format(windowEnd, 'yyyy-MM-dd'),
          page: 1,
          page_size: 1000
        };

        const response = await fetchFromTikTokAPI(endpoint, params, 'GET');
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
        const conversions = parseInt(stat.metrics?.conversion || '0', 10);

        if (existing) {
          existing.spend += spend;
          existing.impressions += impressions;
          existing.clicks += clicks;
          existing.leads += conversions;
        } else {
          statsMap.set(adgroupId, {
            adgroup_id: adgroupId,
            adgroup_name: stat.dimensions?.adgroup_name || 'Unknown Ad Group',
            campaign_id: campaignId,
            spend,
            impressions,
            clicks,
            ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
            leads: conversions,
            cpl: conversions > 0 ? spend / conversions : 0,
            _is_real_data: true
          });
        }
      }

      const result = Array.from(statsMap.values()).map(s => ({
        ...s,
        ctr: s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0,
        cpl: s.leads > 0 ? s.spend / s.leads : 0
      }));

      console.log('[tiktokApi] Ad Group stats result:', result.length);
      return result;
    } catch (error) {
      console.error('Error fetching TikTok ad group stats:', error);
      toast.error('Не удалось загрузить статистику Ad Groups');
      return [];
    }
  },

  // Получить Ads для Ad Group
  getAdsByAdGroup: async (adGroupId: string): Promise<TikTokAd[]> => {
    console.log('[tiktokApi] getAdsByAdGroup:', adGroupId);

    if (!hasValidTikTokConfig()) {
      return [];
    }

    try {
      const endpoint = `ad/get/`;
      const params = {
        filtering: { adgroup_ids: [adGroupId] },
        fields: ['ad_id', 'ad_name', 'operation_status', 'adgroup_id', 'create_time'],
        page: 1,
        page_size: 100
      };

      const response = await fetchFromTikTokAPI(endpoint, params, 'GET');

      if (response.code !== 0) {
        console.error('TikTok API error:', response.message);
        throw new Error(`TikTok API Error: ${response.message}`);
      }

      if (!response.data?.list || response.data.list.length === 0) {
        console.log('No ads found for ad group:', adGroupId);
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
      console.error('Error fetching TikTok ads:', error);
      toast.error('Не удалось загрузить объявления');
      return [];
    }
  },

  // Получить статистику Ads для Ad Group
  getAdStatsByAdGroup: async (adGroupId: string, dateRange: DateRange): Promise<TikTokAdStat[]> => {
    console.log('[tiktokApi] getAdStatsByAdGroup:', { adGroupId, dateRange });

    if (!hasValidTikTokConfig()) {
      return [];
    }

    try {
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
          report_type: 'BASIC',
          service_type: 'AUCTION',
          data_level: 'AUCTION_AD',
          dimensions: ['ad_id', 'stat_time_day'],
          metrics: ['spend', 'impressions', 'clicks', 'ctr', 'conversion'],
          filtering: [
            { field_name: 'adgroup_ids', filter_type: 'IN', filter_value: JSON.stringify([adGroupId]) }
          ],
          start_date: format(windowStart, 'yyyy-MM-dd'),
          end_date: format(windowEnd, 'yyyy-MM-dd'),
          page: 1,
          page_size: 1000
        };

        const response = await fetchFromTikTokAPI(endpoint, params, 'GET');
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
        const conversions = parseInt(stat.metrics?.conversion || '0', 10);

        if (existing) {
          existing.spend += spend;
          existing.impressions += impressions;
          existing.clicks += clicks;
          existing.leads += conversions;
        } else {
          statsMap.set(adId, {
            ad_id: adId,
            ad_name: stat.dimensions?.ad_name || 'Unknown Ad',
            adgroup_id: adGroupId,
            spend,
            impressions,
            clicks,
            ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
            leads: conversions,
            cpl: conversions > 0 ? spend / conversions : 0,
            _is_real_data: true
          });
        }
      }

      const result = Array.from(statsMap.values()).map(s => ({
        ...s,
        ctr: s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0,
        cpl: s.leads > 0 ? s.spend / s.leads : 0
      }));

      console.log('[tiktokApi] Ad stats result:', result.length);
      return result;
    } catch (error) {
      console.error('Error fetching TikTok ad stats:', error);
      toast.error('Не удалось загрузить статистику объявлений');
      return [];
    }
  },

  // Обновить статус Ad Group
  updateAdGroupStatus: async (adGroupId: string, isActive: boolean): Promise<boolean> => {
    console.log(`[tiktokApi] updateAdGroupStatus: ${adGroupId} -> ${isActive ? 'ENABLE' : 'DISABLE'}`);

    if (!hasValidTikTokConfig()) {
      toast.warning('Нет подключения к TikTok');
      return false;
    }

    try {
      const endpoint = `adgroup/status/update/`;
      const status = isActive ? 'ENABLE' : 'DISABLE';

      const params = {
        adgroup_ids: [adGroupId],
        operation_status: status
      };

      const response = await fetchFromTikTokAPI(endpoint, params, 'POST');

      if (response.code !== 0) {
        console.error('TikTok API error:', response.message);
        toast.error('Не удалось изменить статус Ad Group');
        return false;
      }

      toast.success(`Ad Group ${isActive ? 'запущена' : 'приостановлена'}`);
      return true;
    } catch (error) {
      console.error('Error updating TikTok ad group status:', error);
      toast.error('Не удалось обновить статус Ad Group');
      return false;
    }
  },

  // Обновить статус Ad
  updateAdStatus: async (adId: string, isActive: boolean): Promise<boolean> => {
    console.log(`[tiktokApi] updateAdStatus: ${adId} -> ${isActive ? 'ENABLE' : 'DISABLE'}`);

    if (!hasValidTikTokConfig()) {
      toast.warning('Нет подключения к TikTok');
      return false;
    }

    try {
      const endpoint = `ad/status/update/`;
      const status = isActive ? 'ENABLE' : 'DISABLE';

      const params = {
        ad_ids: [adId],
        operation_status: status
      };

      const response = await fetchFromTikTokAPI(endpoint, params, 'POST');

      if (response.code !== 0) {
        console.error('TikTok API error:', response.message);
        toast.error('Не удалось изменить статус объявления');
        return false;
      }

      toast.success(`Объявление ${isActive ? 'запущено' : 'приостановлено'}`);
      return true;
    } catch (error) {
      console.error('Error updating TikTok ad status:', error);
      toast.error('Не удалось обновить статус объявления');
      return false;
    }
  }
};
