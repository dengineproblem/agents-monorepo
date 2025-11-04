/**
 * Facebook Marketing API service for ROI Analytics
 */

import { format, subDays, addDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toastT } from '@/utils/toastUtils';

// Types
export interface Campaign {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'PAYMENT_FAILED';
  objective: string;
  budget: number;
  start_time: string;
}

export interface CampaignStat {
  campaign_id: string;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  leads: number;
  messagingLeads?: number; // Количество лидов от переписок (без лидформ)
  qualityLeads?: number; // Количество качественных лидов (≥2 сообщения)
  qualityRate?: number; // Процент качества лидов
  cpl: number;
  date: string;
  _is_real_data?: boolean; // Флаг для определения реальных данных
}

export interface DateRange {
  since: string;
  until: string;
}

export interface TargetologAction {
  id: string;
  timestamp: string;
  action: string;
  campaign_name: string;
  details: string;
  type: 'budget' | 'targeting' | 'creative' | 'optimization';
}

// Функция для получения данных текущего пользователя
const getCurrentUserConfig = async () => {
  // Получаем данные из localStorage
  const storedUser = localStorage.getItem('user');
  
  if (storedUser) {
    try {
      const userData = JSON.parse(storedUser);
      
      // Убедимся, что у нас есть все необходимые данные
      if (userData && userData.ad_account_id && userData.access_token) {
        console.log('Используем учетные данные пользователя:', { 
          username: userData.username,
          ad_account_id: userData.ad_account_id,
          // Скрываем токен из логов
          access_token_length: userData.access_token ? userData.access_token.length : 0
        });
        
        return {
          access_token: userData.access_token,
          ad_account_id: userData.ad_account_id,
          api_version: 'v18.0',
          base_url: 'https://graph.facebook.com'
        };
      } else {
        // Логируем, каких данных не хватает
        console.error('Недостаточно данных пользователя:', {
          hasAdAccountId: !!userData?.ad_account_id,
          hasAccessToken: !!userData?.access_token
        });
      }
    } catch (error) {
      console.error('Ошибка при чтении данных пользователя из localStorage:', error);
    }
  } else {
    console.error('Данные пользователя не найдены в localStorage');
  }
  
  // Если не смогли получить данные из localStorage, используем моковые данные
  console.warn('Используются моковые данные. Пользователь не авторизован или нет нужных данных.');
  return {
    access_token: '',
    ad_account_id: '',
    api_version: 'v18.0',
    base_url: 'https://graph.facebook.com'
  };
};

// Вспомогательная функция для запросов к Facebook API
const fetchFromFacebookAPI = async (endpoint: string, params: Record<string, string> = {}) => {
  const FB_API_CONFIG = await getCurrentUserConfig();
  
  // Проверяем, есть ли необходимые данные для запроса
  if (!FB_API_CONFIG.access_token || !FB_API_CONFIG.ad_account_id) {
    console.error('Отсутствуют необходимые данные для запроса к Facebook API:', {
      hasToken: !!FB_API_CONFIG.access_token,
      hasAdAccountId: !!FB_API_CONFIG.ad_account_id
    });
    throw new Error('Не удалось выполнить запрос: отсутствует токен или ID рекламного кабинета');
  }
  
  const url = new URL(`${FB_API_CONFIG.base_url}/${FB_API_CONFIG.api_version}/${endpoint}`);
  
  // Добавляем обязательный параметр access_token
  url.searchParams.append('access_token', FB_API_CONFIG.access_token);
  
  // Добавляем остальные параметры
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });
  
  console.log(`Выполняем запрос к Facebook API: ${endpoint}`);
  
  try {
    const response = await fetch(url.toString());
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Ошибка Facebook API:', errorData);
      
      // Проверка на истекший или недействительный токен
      if (errorData?.error?.code === 190) {
        console.error('Токен доступа недействителен или истек срок его действия');
        toastT.error('facebookAuthError');
        // Очистка токена, чтобы пользователь мог повторно авторизоваться
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          try {
            const userData = JSON.parse(storedUser);
            userData.access_token = ''; // Сбрасываем токен
            localStorage.setItem('user', JSON.stringify(userData));
          } catch (e) {
            console.error('Ошибка при обновлении данных пользователя:', e);
          }
        }
      }
      
      throw new Error(`Ошибка Facebook API: ${errorData?.error?.message || response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`Успешный ответ от Facebook API для ${endpoint}:`, {
      status: response.status,
      dataSize: data ? 'Данные получены' : 'Нет данных'
    });
    
    return data;
  } catch (error) {
    console.error('Ошибка при запросе к Facebook API:', error);
    throw error;
  }
};

// Резервные моковые данные на случай отсутствия токена
const mockCampaigns: Campaign[] = [
  {
    id: 'camp_123456789001',
    name: 'Летняя распродажа 2023',
    status: 'ACTIVE',
    objective: 'LEAD_GENERATION',
    budget: 15000,
    start_time: '2023-06-01T00:00:00+0000',
  },
  {
    id: 'camp_123456789002',
    name: 'Новая коллекция - Осень',
    status: 'ACTIVE',
    objective: 'CONVERSIONS',
    budget: 12000,
    start_time: '2023-09-01T00:00:00+0000',
  },
  {
    id: 'camp_123456789003',
    name: 'Промо подписки PRO',
    status: 'PAUSED',
    objective: 'LEAD_GENERATION',
    budget: 8000,
    start_time: '2023-07-15T00:00:00+0000',
  },
  {
    id: 'camp_123456789004',
    name: 'Черная пятница 2023',
    status: 'ACTIVE',
    objective: 'CONVERSIONS',
    budget: 25000,
    start_time: '2023-11-20T00:00:00+0000',
  },
  {
    id: 'camp_123456789005',
    name: 'Ребрендинг - Основная',
    status: 'PAUSED',
    objective: 'BRAND_AWARENESS',
    budget: 18000,
    start_time: '2023-10-01T00:00:00+0000',
  },
];

// Генерация моковых статистик на случай отсутствия токена
const generateMockStats = (dateRange: DateRange): CampaignStat[] => {
  const stats: CampaignStat[] = [];
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
  mockCampaigns.forEach(campaign => {
    dates.forEach(date => {
      const dayOfWeek = date.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const dateStr = format(date, 'yyyy-MM-dd');
      
      // Define base metrics (slightly randomized)
      const baseSpend = campaign.budget / 30 * (isWeekend ? 0.7 : 1.2);
      const spend = parseFloat((baseSpend * (0.8 + Math.random() * 0.4)).toFixed(2));
      
      const baseImpressions = spend * 100 * (0.9 + Math.random() * 0.2);
      const impressions = Math.round(baseImpressions);
      
      const baseClickRate = 0.015 + Math.random() * 0.01;
      const clicks = Math.round(impressions * baseClickRate);
      
      const ctr = parseFloat((clicks / impressions * 100).toFixed(2));
      
      // Добавляем WhatsApp сообщения к лидам - увеличиваем частоту для более реалистичной статистики
      const baseFbLeadRate = 0.02 + Math.random() * 0.02;
      const fbLeads = Math.round(clicks * baseFbLeadRate);
      
      // WhatsApp сообщения (значительно больше, чем FB лиды)
      const baseWhatsAppRate = 0.15 + Math.random() * 0.10;
      const whatsappMessages = Math.round(clicks * baseWhatsAppRate);
      
      // Общее количество "лидов" теперь включает FB лиды и WhatsApp переписки
      const leads = fbLeads + whatsappMessages;
      
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

// Проверка наличия токена и ID рекламного кабинета
const hasValidConfig = async () => {
  const FB_API_CONFIG = await getCurrentUserConfig();
  const isValid = !!FB_API_CONFIG.access_token && !!FB_API_CONFIG.ad_account_id;
  
  console.log('Проверка конфигурации Facebook API:', {
    hasToken: !!FB_API_CONFIG.access_token,
    hasAdAccountId: !!FB_API_CONFIG.ad_account_id,
    isValid: isValid
  });
  
  return isValid;
};

// Определение типов лидов, основываясь на коде n8n
const LEAD_ACTION_TYPES = [
  "onsite_conversion.lead_grouped",
  "onsite_conversion.messaging_conversation_started_7d",
  "lead",
  "lead_generation",
  "offsite_conversion.fb_form_lead",
  "onsite_conversion.lead",        // Добавлено
  "onsite_web_lead"               // Добавлено
];

// Получить adset-ы для кампании
const getAdsetsByCampaign = async (campaignId: string) => {
  const FB_API_CONFIG = await getCurrentUserConfig();
  if (!FB_API_CONFIG.access_token || !FB_API_CONFIG.ad_account_id) {
    throw new Error('Нет access_token или ad_account_id');
  }
  // ИСПРАВЛЕНО: Используем прямой endpoint кампании вместо фильтрации
  // Фильтрация через ad_account_id/adsets?filtering=... не работает для некоторых аккаунтов
  const endpoint = `${campaignId}/adsets`;
  const params = {
    fields: 'id,name,daily_budget,campaign_id,status',
    limit: '50',
  };
  
  console.log(`[facebookApi] Запрос ad sets для кампании ${campaignId}:`, {
    endpoint,
    method: 'direct campaign endpoint (без filtering)'
  });
  
  const data = await fetchFromFacebookAPI(endpoint, params);
  
  console.log(`[facebookApi] Получен ответ:`, {
    totalAdsets: data.data?.length || 0,
    campaignId,
    adsets: data.data?.map((a: any) => ({ id: a.id, name: a.name, campaign_id: a.campaign_id }))
  });
  
  return data.data || [];
};

// Получить статистику для ad sets кампании за период
const getAdsetStats = async (campaignId: string, dateRange: DateRange) => {
  const FB_API_CONFIG = await getCurrentUserConfig();
  if (!FB_API_CONFIG.access_token || !FB_API_CONFIG.ad_account_id) {
    return [];
  }
  
  try {
    const endpoint = `${FB_API_CONFIG.ad_account_id}/insights`;
    const params = {
      level: 'adset',
      fields: 'adset_id,adset_name,spend,impressions,clicks,actions',
      time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until }),
      filtering: JSON.stringify([{ field: 'campaign.id', operator: 'EQUAL', value: campaignId }]),
      // БЕЗ action_breakdowns для снижения нагрузки на API!
      limit: '500',
    };
    
    console.log(`[API] Запрос статистики ad sets для кампании ${campaignId} без action_breakdowns`);
    const response = await fetchFromFacebookAPI(endpoint, params);
    
    if (response.data && response.data.length > 0) {
      return response.data.map((stat: any) => {
        let leads = 0;
        
        // Упрощенный подсчет лидов без детализации по типам
        // Facebook вернет агрегированные данные, если не указан action_breakdowns
        if (stat.actions && Array.isArray(stat.actions)) {
          for (const action of stat.actions) {
            const actionType = action.action_type;
            
            // Собираем все типы лидов в одно значение
            if (
              actionType === 'onsite_conversion.total_messaging_connection' ||
              actionType === 'onsite_conversion.messaging_conversation_started_7d' ||
              actionType === 'onsite_web_lead' ||
              actionType === 'offsite_conversion.fb_pixel_lead' ||
              actionType === 'lead' ||
              (typeof actionType === 'string' && 
                (actionType.includes('lead') || actionType.includes('conversion')))
            ) {
              const value = parseInt(action.value || "0", 10);
              // Берем максимум, чтобы избежать дублирования
              leads = Math.max(leads, value);
            }
          }
        }
        
        const spend = parseFloat(stat.spend || "0");
        const cpl = leads > 0 ? spend / leads : 0;
        
        return {
          adset_id: stat.adset_id,
          adset_name: stat.adset_name,
          spend,
          leads,
          cpl,
          impressions: parseInt(stat.impressions || "0", 10),
          clicks: parseInt(stat.clicks || "0", 10),
        };
      });
    }
    
    return [];
  } catch (error) {
    console.error('Ошибка получения статистики ad sets:', error);
    return [];
  }
};

// Изменить daily_budget adset-а
const updateAdsetBudget = async (adsetId: string, newBudget: number) => {
  const FB_API_CONFIG = await getCurrentUserConfig();
  if (!FB_API_CONFIG.access_token) throw new Error('Нет access_token');
  const url = `${FB_API_CONFIG.base_url}/${FB_API_CONFIG.api_version}/${adsetId}`;
  const formData = new URLSearchParams();
  formData.append('access_token', FB_API_CONFIG.access_token);
  formData.append('daily_budget', String(newBudget));
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData,
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData?.error?.message || response.statusText);
  }
  return await response.json();
};

// Изменить статус adset-а (ACTIVE/PAUSED)
const updateAdsetStatus = async (adsetId: string, isActive: boolean) => {
  const FB_API_CONFIG = await getCurrentUserConfig();
  if (!FB_API_CONFIG.access_token) throw new Error('Нет access_token');
  const url = `${FB_API_CONFIG.base_url}/${FB_API_CONFIG.api_version}/${adsetId}`;
  const formData = new URLSearchParams();
  formData.append('access_token', FB_API_CONFIG.access_token);
  formData.append('status', isActive ? 'ACTIVE' : 'PAUSED');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData,
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData?.error?.message || response.statusText);
  }
  return await response.json();
};

// Получить статус рекламного кабинета и данные по бюджету
const getAccountStatus = async () => {
  const FB_API_CONFIG = await getCurrentUserConfig();
  if (!FB_API_CONFIG.access_token || !FB_API_CONFIG.ad_account_id) {
    throw new Error('Нет access_token или ad_account_id');
  }
  const endpoint = `${FB_API_CONFIG.ad_account_id}`;
  const params = { fields: 'spend_cap,amount_spent,balance,account_status,disable_reason' };
  const data = await fetchFromFacebookAPI(endpoint, params);

  // Пагинация по activities для поиска последнего ad_account_billing_charge
  let threshold_amount = null;
  let last_billing_date = null;
  let after = undefined;
  let found = false;
  let debug_activities = [];
  try {
    while (!found) {
      const url = new URL(`${FB_API_CONFIG.base_url}/${FB_API_CONFIG.api_version}/${endpoint}/activities`);
      url.searchParams.append('access_token', FB_API_CONFIG.access_token);
      url.searchParams.append('fields', 'event_time,event_type,extra_data');
      url.searchParams.append('category', 'ACCOUNT');
      url.searchParams.append('limit', '100');
      if (after) url.searchParams.append('after', after);
      const response = await fetch(url.toString());
      const activitiesData = await response.json();
      const activities = activitiesData.data || [];
      debug_activities.push(...activities.slice(0, 20).map((a: any) => ({ event_type: a.event_type, extra_data: a.extra_data, event_time: a.event_time })));
      const billingEvent = activities.find((a: any) => a.event_type === 'ad_account_billing_charge' && a.extra_data);
      if (billingEvent) {
        const extra = JSON.parse(billingEvent.extra_data);
        if (extra.threshold_amount) {
          threshold_amount = extra.threshold_amount;
        }
        if (billingEvent.event_time) {
          last_billing_date = billingEvent.event_time;
        }
        found = true;
        break;
      }
      if (activitiesData.paging && activitiesData.paging.next && activitiesData.paging.cursors && activitiesData.paging.cursors.after) {
        after = activitiesData.paging.cursors.after;
      } else {
        break;
      }
    }
  } catch (e) {
    threshold_amount = null;
    last_billing_date = null;
  }

  return { ...data, threshold_amount, last_billing_date, debug_activities: debug_activities.slice(0, 20) };
};

// Получить текущий расход в сутки (сумма daily_budget всех активных adset-ов)
const getCurrentDailySpend = async () => {
  const FB_API_CONFIG = await getCurrentUserConfig();
  if (!FB_API_CONFIG.access_token || !FB_API_CONFIG.ad_account_id) {
    throw new Error('Нет access_token или ad_account_id');
  }
  const endpoint = `${FB_API_CONFIG.ad_account_id}/adsets`;
  const params = {
    fields: 'id,name,daily_budget,status',
    limit: '100',
  };
  const data = await fetchFromFacebookAPI(endpoint, params);
  // Суммируем daily_budget только активных adset-ов
  const total = (data.data || [])
    .filter((adset: any) => adset.status === 'ACTIVE')
    .reduce((sum: number, adset: any) => sum + (Number(adset.daily_budget) || 0), 0);
  // Возвращаем в долларах
  return total / 100;
};

// Facebook API сервис
export const facebookApi = {
  // Получить список пикселей для текущего рекламного кабинета
  getPixels: async (): Promise<Array<{ id: string; name: string }>> => {
    if (!await hasValidConfig()) {
      return [];
    }
    try {
      const FB_API_CONFIG = await getCurrentUserConfig();
      // ad_account_id у нас уже может приходить с префиксом act_
      const accountId = FB_API_CONFIG.ad_account_id.startsWith('act_')
        ? FB_API_CONFIG.ad_account_id
        : FB_API_CONFIG.ad_account_id; // не добавляем префикс
      // Для рекламного кабинета нужен endpoint adspixels, а не pixels
      const endpoint = `${accountId}/adspixels`;
      const params = { fields: 'id,name', limit: '100' };
      const response = await fetchFromFacebookAPI(endpoint, params);
      return (response.data || []).map((p: any) => ({ id: String(p.id), name: p.name || p.id }));
    } catch (e) {
      console.error('Не удалось получить список пикселей:', e);
      toastT.error('failedToLoadPixels');
      return [];
    }
  },
  // Получить все кампании
  getCampaigns: async (): Promise<Campaign[]> => {
    console.log('Запрос на получение кампаний');
    
    if (!await hasValidConfig()) {
      console.warn('Нет данных для получения кампаний. Возвращаю пустой массив.');
      // Не показываем уведомление и не возвращаем моковые кампании
      return [];
    }
    
    try {
      const FB_API_CONFIG = await getCurrentUserConfig();
      const accountId = FB_API_CONFIG.ad_account_id;
      
      console.log(`Запрашиваем кампании для рекламного кабинета: ${accountId}`);
      
      const endpoint = `${accountId}/campaigns`;
      const params = {
        fields: 'id,name,status,objective,budget_remaining,start_time',
        limit: '50'
      };
      
      const response = await fetchFromFacebookAPI(endpoint, params);
      console.log('Получены данные кампаний от API:', {
        count: response.data?.length || 0
      });
      
      if (!response.data || response.data.length === 0) {
        console.warn('API вернул пустой список кампаний, возвращаю пустой массив');
        return [];
      }
      
      return (response.data || []).map((campaign: any) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
        objective: campaign.objective || 'UNKNOWN',
        budget: parseFloat(campaign.budget_remaining) || 0,
        start_time: campaign.start_time || new Date().toISOString()
      }));
    } catch (error) {
      toastT.error('failedToLoadCampaigns');
      return [];
    }
  },
  
  // Получить статистику кампаний за период
  getCampaignStats: async (dateRange: DateRange, includeLeadForms: boolean = false): Promise<CampaignStat[]> => {
    console.log('Запрос статистики кампаний за период:', dateRange);
    
    if (!await hasValidConfig()) {
      console.warn('Нет данных для получения статистики. Возвращаю пустой массив.');
      return [];
    }
    
    try {
      const FB_API_CONFIG = await getCurrentUserConfig();
      const accountId = FB_API_CONFIG.ad_account_id;
      
      console.log(`Запрашиваем статистику для рекламного кабинета: ${accountId}`);
      
      // Сначала получаем список кампаний, чтобы затем создать для них нулевую статистику при необходимости
      const campaigns = await facebookApi.getCampaigns();
      const campaignObjectiveById = new Map<string, string>();
      for (const c of campaigns) {
        // @ts-ignore - защищаемся от разных форматов
        campaignObjectiveById.set(c.id, (c.objective as string) || 'UNKNOWN');
      }
      
      if (!campaigns || campaigns.length === 0) {
        console.warn('Нет кампаний для запроса статистики, возвращаю пустой массив');
        return [];
      }
      
      const endpoint = `${accountId}/insights`;
      const params = {
        level: 'campaign',
        fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions',
        time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until }),
        // Убираем time_increment чтобы получить агрегированные данные за весь период
        limit: '500',
        // Нужна детализация по типу действия, чтобы корректно считать события сайта/пикселя
        action_breakdowns: 'action_type'
      };
      
      console.log('Отправляем запрос к Facebook API для получения статистики');
      const response = await fetchFromFacebookAPI(endpoint, params);
      console.log('Получены данные статистики от API:', {
        count: response.data?.length || 0,
        data: response.data
      });
      
      // Если получены данные от API, обрабатываем их и возвращаем
      if (response.data && response.data.length > 0) {
        console.log('Обрабатываем полученные данные статистики');
        const result = (response.data || []).map((stat: any) => {
          // Подсчитываем лиды - берем максимальное значение из всех типов лидов
          // чтобы избежать дублирования одних и тех же лидов
          let leads = 0;
          let qualityLeads = 0;
          let messagingLeads = 0;
          let siteLeads = 0;
          
          if (stat.actions && Array.isArray(stat.actions)) {
            const leadValues: number[] = [];
            
            for (const action of stat.actions) {
              // Общие лиды (messaging_connection)
              if (action.action_type === 'onsite_conversion.total_messaging_connection') {
                messagingLeads = parseInt(action.value || "0", 10);
              }
              // Качественные лиды (≥2 сообщения) - только для переписок
              else if (action.action_type === 'onsite_conversion.messaging_user_depth_2_message_send') {
                qualityLeads = parseInt(action.value || "0", 10);
              }
              // Лиды с сайта (события сайта и пикселя)
              else if (action.action_type === 'onsite_web_lead') {
                siteLeads += parseInt(action.value || "0", 10);
              }
              // Конверсии пикселя, отмеченные как lead
              else if (action.action_type === 'offsite_conversion.fb_pixel_lead') {
                siteLeads += parseInt(action.value || "0", 10);
              }
              // Кастомные конверсии пикселя (берем все custom как лиды сайта)
              else if (typeof action.action_type === 'string' && action.action_type.startsWith('offsite_conversion.custom')) {
                siteLeads += parseInt(action.value || "0", 10);
              }
              // Стандартное пиксельное событие lead (offsite)
              else if (action.action_type === 'offsite_conversion.lead') {
                siteLeads += parseInt(action.value || "0", 10);
              }
              // Любые другие offsite_conversion с lead/custom, кроме fb_form_lead
              else if (
                typeof action.action_type === 'string' &&
                action.action_type.startsWith('offsite_conversion.') &&
                !action.action_type.includes('fb_form_lead') &&
                (action.action_type.includes('lead') || action.action_type.includes('custom'))
              ) {
                siteLeads += parseInt(action.value || "0", 10);
              }
            }
            
            // Итог: только переписки + лиды сайта (без Facebook Lead Forms)
            leads = messagingLeads + siteLeads;
            
            // Без fallback к общим lead action_type, чтобы не учитывать FB Lead Forms
          }
          
          // Расчёт производных метрик
          const spend = parseFloat(stat.spend) || 0;
          const impressions = parseInt(stat.impressions, 10) || 0;
          const clicks = parseInt(stat.clicks, 10) || 0;
          const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
          const cpl = leads > 0 ? spend / leads : 0;
          // Качество считается только от переписок, не от лидформ
          const qualityRate = messagingLeads > 0 ? (qualityLeads / messagingLeads) * 100 : 0;
          
          return {
            campaign_id: stat.campaign_id,
            campaign_name: stat.campaign_name,
            objective: campaignObjectiveById.get(stat.campaign_id) || 'UNKNOWN',
            spend,
            impressions,
            clicks,
            ctr,
            leads,
            messagingLeads,
            qualityLeads,
            qualityRate,
            cpl,
            date: stat.date_start,
            _is_real_data: true // Помечаем как реальные данные
          };
        });
        
        console.log('Обработано реальных данных статистики:', result.length);
        return result;
      }
      // Если API вернул пустые данные, создаем нулевые статистики для каждой кампании на каждую дату
      console.log('API вернул пустые данные статистики, создаем нулевые записи для реальных кампаний');
      
      // Получаем все даты в диапазоне для создания ежедневной статистики
      const dates: Date[] = [];
      let currentDate = new Date(dateRange.since);
      const endDate = new Date(dateRange.until);
      
      while (currentDate <= endDate) {
        dates.push(new Date(currentDate));
        currentDate = addDays(currentDate, 1);
      }
      
      // Создаем статистику с нулями для каждой кампании на каждую дату
      const zeroStats: CampaignStat[] = [];
      
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
      
      console.log(`Создано ${zeroStats.length} записей статистики с нулевыми значениями`);
      return zeroStats;
    } catch (error) {
      toastT.error('failedToLoadStats');
      return [];
    }
  },
  
  // Обновить статус кампании
  updateCampaignStatus: async (campaignId: string, isActive: boolean): Promise<boolean> => {
    console.log(`Запрос на изменение статуса кампании ${campaignId} на ${isActive ? 'ACTIVE' : 'PAUSED'}`);
    
    if (!await hasValidConfig()) {
      console.warn('Используются моковые данные для изменения статуса. Не удалось получить данные пользователя.');
      toastT.warning('testDataWarning');
      await new Promise(resolve => setTimeout(resolve, 600)); // Имитация задержки API
      
      const campaignIndex = mockCampaigns.findIndex(c => c.id === campaignId);
      if (campaignIndex !== -1) {
        mockCampaigns[campaignIndex].status = isActive ? 'ACTIVE' : 'PAUSED';
        return true;
      }
      return false;
    }
    
    try {
      const FB_API_CONFIG = await getCurrentUserConfig();
      const endpoint = `${campaignId}`;
      const status = isActive ? 'ACTIVE' : 'PAUSED';
      
      // Для POST запросов нужно использовать fetch напрямую
      const url = `${FB_API_CONFIG.base_url}/${FB_API_CONFIG.api_version}/${endpoint}`;
      
      console.log(`Изменяем статус кампании ${campaignId} на ${status}`);
      
      const formData = new URLSearchParams();
      formData.append('access_token', FB_API_CONFIG.access_token);
      formData.append('status', status);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Ошибка Facebook API при изменении статуса:', errorData);
        
        // Проверка на истекший токен
        if (errorData?.error?.code === 190) {
          toastT.error('statusAuthError');
        } else {
          toastT.error('statusUpdateError');
        }
        
        throw new Error(`Ошибка Facebook API: ${errorData?.error?.message || response.statusText}`);
      }
      
      const result = await response.json();
      console.log('Результат изменения статуса кампании:', result);

      if (result.success === true) {
        toastT.success(isActive ? 'campaignResumed' : 'campaignPaused');
      }
      
      return result.success === true;
    } catch (error) {
      console.error('Ошибка при изменении статуса кампании:', error);
      toastT.error('statusUpdateError');
      return false;
    }
  },
  getAdsetsByCampaign,
  getAdsetStats,
  updateAdsetBudget,
  updateAdsetStatus,
  getAccountStatus,
  getCurrentDailySpend,
  /**
   * Получить список объявлений, использующих указанный creativeId
   */
  getAdsByCreative: async (creativeId: string): Promise<string[]> => {
    if (!await hasValidConfig()) {
      return [];
    }
    try {
      const FB_API_CONFIG = await getCurrentUserConfig();
      const accountId = FB_API_CONFIG.ad_account_id;
      const endpoint = `${accountId}/ads`;
      const params = {
        fields: 'id,name,creative,creative_id',
        filtering: JSON.stringify([
          { field: 'creative_id', operator: 'EQUAL', value: creativeId },
        ]),
        limit: '100',
      } as any;
      const data = await fetchFromFacebookAPI(endpoint, params);
      const ids = (data?.data || []).map((ad: any) => String(ad.id));
      return ids;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('creative') && message.includes('not supported')) {
        console.warn('getAdsByCreative: фильтрация по creative_id недоступна, возвращаем пустой список');
        return [];
      }
      console.error('getAdsByCreative error', e);
      return [];
    }
  },

  /**
   * Получить агрегированные метрики для списка adId за период
   */
  getAggregatedInsightsByAds: async (adIds: string[], dateRange: DateRange): Promise<{ spend: number; leads: number; impressions: number; clicks: number; }> => {
    if (!await hasValidConfig()) {
      return { spend: 0, leads: 0, impressions: 0, clicks: 0 };
    }
    let totalSpend = 0;
    let totalLeads = 0;
    let totalImpr = 0;
    let totalClicks = 0;
    try {
      for (const adId of adIds.slice(0, 100)) { // safety cap
        const endpoint = `${adId}/insights`;
        const params = {
          fields: 'spend,impressions,clicks,actions,date_start',
          time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until }),
          limit: '50',
        } as any;
        const res = await fetchFromFacebookAPI(endpoint, params);
        const rows = res?.data || [];
        for (const row of rows) {
          const spend = parseFloat(row.spend) || 0;
          const impressions = parseInt(row.impressions, 10) || 0;
          const clicks = parseInt(row.clicks, 10) || 0;
          let messagingLeads = 0;
          let siteLeads = 0;
          if (row.actions && Array.isArray(row.actions)) {
            for (const action of row.actions) {
              if (action.action_type === 'onsite_conversion.total_messaging_connection') {
                messagingLeads = parseInt(action.value || '0', 10);
              } else if (action.action_type === 'onsite_web_lead') {
                siteLeads += parseInt(action.value || '0', 10);
              } else if (action.action_type === 'offsite_conversion.fb_pixel_lead') {
                siteLeads += parseInt(action.value || '0', 10);
              } else if (typeof action.action_type === 'string' && action.action_type.startsWith('offsite_conversion.custom')) {
                siteLeads += parseInt(action.value || '0', 10);
              } else if (action.action_type === 'offsite_conversion.lead') {
                siteLeads += parseInt(action.value || '0', 10);
              } else if (
                typeof action.action_type === 'string' &&
                action.action_type.startsWith('offsite_conversion.') &&
                !action.action_type.includes('fb_form_lead') &&
                (action.action_type.includes('lead') || action.action_type.includes('custom'))
              ) {
                siteLeads += parseInt(action.value || '0', 10);
              }
            }
          }
          totalSpend += spend;
          totalImpr += impressions;
          totalClicks += clicks;
          totalLeads += (messagingLeads + siteLeads);
        }
      }
    } catch (e) {
      console.error('getAggregatedInsightsByAds error', e);
    }
    return { spend: totalSpend, leads: totalLeads, impressions: totalImpr, clicks: totalClicks };
  },

  /**
   * Агрегированные метрики по креативам (суммируются по всем объявлениям, где креатив использовался)
   */
  getCreativeAggregatedStats: async (creativeIds: string[], dateRange: DateRange): Promise<{ spend: number; leads: number; cpl: number; impressions: number; clicks: number; }> => {
    if (!await hasValidConfig()) {
      return { spend: 0, leads: 0, cpl: 0, impressions: 0, clicks: 0 };
    }
    let allSpend = 0;
    let allLeads = 0;
    let allImpr = 0;
    let allClicks = 0;
    try {
      for (const creativeId of creativeIds) {
        const adIds = await facebookApi.getAdsByCreative(creativeId);
        if (adIds.length === 0) continue;
        const agg = await facebookApi.getAggregatedInsightsByAds(adIds, dateRange);
        allSpend += agg.spend;
        allLeads += agg.leads;
        allImpr += agg.impressions;
        allClicks += agg.clicks;
      }
    } catch (e) {
      console.error('getCreativeAggregatedStats error', e);
    }
    const cpl = allLeads > 0 ? allSpend / allLeads : 0;
    return { spend: allSpend, leads: allLeads, cpl, impressions: allImpr, clicks: allClicks };
  },
  // Получить статистику кампании по дням для графиков
  getCampaignStatsByDay: async (campaignId: string, dateRange: DateRange): Promise<CampaignStat[]> => {
    if (!await hasValidConfig()) {
      return [];
    }
    try {
      const FB_API_CONFIG = await getCurrentUserConfig();
      const accountId = FB_API_CONFIG.ad_account_id;
      const endpoint = `${accountId}/insights`;
      const params = {
        level: 'campaign',
        fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions,date_start',
        time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until }),
        time_increment: '1',
        limit: '500'
      };
      const response = await fetchFromFacebookAPI(endpoint, params);
      if (response.data && response.data.length > 0) {
        return (response.data || [])
          .filter((stat: any) => stat.campaign_id === campaignId)
          .map((stat: any) => {
            let leads = 0;
            let qualityLeads = 0;
            
            if (stat.actions && Array.isArray(stat.actions)) {
              const leadValues: number[] = [];
              
              for (const action of stat.actions) {
                // Общие лиды (messaging_connection)
                if (action.action_type === 'onsite_conversion.total_messaging_connection') {
                  leads = parseInt(action.value || "0", 10);
                }
                // Качественные лиды (≥2 сообщения)
                else if (action.action_type === 'onsite_conversion.messaging_user_depth_2_message_send') {
                  qualityLeads = parseInt(action.value || "0", 10);
                }
                // Fallback к старому методу если нет новых action_type
                else if (LEAD_ACTION_TYPES.includes(action.action_type)) {
                  leadValues.push(parseInt(action.value || "0", 10));
                }
              }
              
              // Если не нашли новые action_type, используем старый метод
              if (leads === 0 && leadValues.length > 0) {
                leads = Math.max(...leadValues);
              }
            }
            
            const spend = parseFloat(stat.spend) || 0;
            const impressions = parseInt(stat.impressions, 10) || 0;
            const clicks = parseInt(stat.clicks, 10) || 0;
            const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
            const cpl = leads > 0 ? spend / leads : 0;
            const qualityRate = leads > 0 ? (qualityLeads / leads) * 100 : 0;
            
            return {
              campaign_id: stat.campaign_id,
              campaign_name: stat.campaign_name,
              spend,
              impressions,
              clicks,
              ctr,
              leads,
              qualityLeads,
              qualityRate,
              cpl,
              date: stat.date_start,
              _is_real_data: true
            };
          });
      }
      return [];
    } catch (error) {
      toastT.error('failedToLoadDailyStats');
      return [];
    }
  },

  // Получение последних действий таргетолога
  getTargetologActions: async (): Promise<TargetologAction[]> => {
    try {
      const config = await getCurrentUserConfig();
      if (!config) {
        console.log('Нет конфигурации пользователя');
        return [];
      }

      // Убираем дублирование префикса act_ если он уже есть
      const accountId = config.ad_account_id.startsWith('act_') 
        ? config.ad_account_id 
        : `act_${config.ad_account_id}`;

      // Используем правильный /activities endpoint для получения истории изменений
      const activities = await fetchFromFacebookAPI(`${accountId}/activities`, {
        fields: 'object_id,object_name,event_type,event_time,actor_id,changed_attributes',
        limit: '50'  // Получаем последние 50 событий
      });

      const actions: TargetologAction[] = [];

      if (activities && activities.data) {
        // Обрабатываем реальные события изменений из Facebook API
        for (const activity of activities.data) {
          // Конвертируем event_time в читаемый формат
          const eventTime = new Date(activity.event_time);
          const now = new Date();
          const daysDiff = (now.getTime() - eventTime.getTime()) / (1000 * 3600 * 24);

          // Показываем только события за последние 7 дней
          if (daysDiff <= 7) {
            // Определяем тип действия на основе event_type
            let actionType: 'budget' | 'targeting' | 'creative' | 'optimization' = 'optimization';
            let description = activity.event_type;

            // Анализируем тип события и измененные атрибуты
            if (activity.event_type?.includes('budget') || 
                activity.changed_attributes?.includes('daily_budget') ||
                activity.changed_attributes?.includes('lifetime_budget')) {
              actionType = 'budget';
              description = 'Изменение бюджета';
            } else if (activity.event_type?.includes('targeting') ||
                       activity.changed_attributes?.includes('targeting')) {
              actionType = 'targeting';
              description = 'Настройка аудитории';
            } else if (activity.event_type?.includes('creative') ||
                       activity.event_type?.includes('ad_create') ||
                       activity.changed_attributes?.includes('creative')) {
              actionType = 'creative';
              description = 'Обновление креатива';
            }

            actions.push({
              id: `${activity.object_id}_${activity.event_time}`,
              timestamp: format(eventTime, 'yyyy-MM-dd HH:mm'),
              action: description,
              campaign_name: activity.object_name || 'Неизвестный объект',
              details: `${activity.object_name || 'Объект'} - ${description}`,
              type: actionType
            });
          }
        }
      }

      // Сортируем по времени (новые сверху)
      return actions
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10); // Показываем только последние 10 действий
        
    } catch (error) {
      console.error('Ошибка при получении действий таргетолога:', error);
      // Возвращаем фолбэк данные если API недоступен
      return [
        {
          id: 'fallback_1',
          timestamp: format(new Date(), 'yyyy-MM-dd HH:mm'),
          action: 'API недоступен',
          campaign_name: 'Системное сообщение',
          details: 'Не удалось загрузить данные из Facebook API',
          type: 'optimization'
        }
      ];
    }
  }
};
