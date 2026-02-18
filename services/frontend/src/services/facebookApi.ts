/**
 * Facebook Marketing API service for ROI Analytics
 */

import { format, subDays, addDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toastT } from '@/utils/toastUtils';
import { API_BASE_URL } from '@/config/api';

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
  cpql?: number; // Cost per qualified lead (стоимость качественного лида)
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

      // Проверяем мультиаккаунтный режим
      const storedAdAccounts = localStorage.getItem('adAccounts');
      const storedMultiAccountEnabled = localStorage.getItem('multiAccountEnabled');

      if (storedMultiAccountEnabled === 'true' && storedAdAccounts) {
        // Мультиаккаунтный режим — берём данные из текущего выбранного аккаунта
        const adAccounts = JSON.parse(storedAdAccounts);
        const currentAdAccountId = localStorage.getItem('currentAdAccountId');

        // DEBUG: детальный лог localStorage
        console.log('[facebookApi] === READING LOCALSTORAGE ===');
        console.log('[facebookApi] currentAdAccountId:', currentAdAccountId?.slice(0, 8));
        adAccounts.forEach((a: any, i: number) => {
          console.log(`[facebookApi] LS[${i}]:`, a.id?.slice(0, 8), a.name, a.ad_account_id, a.fb_page_id);
        });

        // ВАЖНО: ищем только по точному совпадению id
        const currentAcc = adAccounts.find((a: any) => a.id === currentAdAccountId);

        if (!currentAcc) {
          console.error('[facebookApi] !!! НЕ НАЙДЕН по id:', currentAdAccountId);
          console.error('[facebookApi] !!! Доступные аккаунты:', adAccounts.map((a: any) => a.id?.slice(0, 8)));
          console.warn('[facebookApi] !!! Fallback на legacy режим - может быть неправильный ad_account_id!');
        } else {
          console.log('[facebookApi] НАЙДЕН:', currentAcc.name, currentAcc.ad_account_id, currentAcc.fb_page_id);
        }

        if (currentAcc && currentAcc.ad_account_id) {
          console.log('[facebookApi] >>> ИСПОЛЬЗУЕМ:', currentAcc.name, currentAcc.ad_account_id);

          return {
            access_token: '', // токен теперь на бэкенде, не передаём на фронтенд
            ad_account_id: currentAcc.ad_account_id,
            api_version: 'v18.0',
            base_url: 'https://graph.facebook.com'
          };
        }
      }

      // Legacy режим — берём данные из user_accounts
      if (userData && userData.ad_account_id) {
        console.log('Используем учетные данные пользователя:', {
          username: userData.username,
          ad_account_id: userData.ad_account_id,
        });

        return {
          access_token: '', // токен теперь на бэкенде
          ad_account_id: userData.ad_account_id,
          api_version: 'v18.0',
          base_url: 'https://graph.facebook.com'
        };
      } else {
        console.error('Недостаточно данных пользователя:', {
          hasAdAccountId: !!userData?.ad_account_id,
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

// Получить userId для x-user-id header
const getUserId = (): string | undefined => {
  try { return JSON.parse(localStorage.getItem('user') || '{}').id; } catch { return undefined; }
};

// Получить текущий internal adAccountId (UUID из нашей БД, не Facebook act_XXX)
const getCurrentInternalAdAccountId = (): string | undefined => {
  return localStorage.getItem('currentAdAccountId') || undefined;
};

// Вспомогательная функция для запросов к Facebook API через бэкенд-proxy
const fetchFromFacebookAPI = async (endpoint: string, params: Record<string, string> = {}) => {
  const FB_API_CONFIG = await getCurrentUserConfig();

  if (!FB_API_CONFIG.ad_account_id) {
    console.error('Отсутствует ad_account_id для запроса к Facebook API');
    throw new Error('Не удалось выполнить запрос: отсутствует ID рекламного кабинета');
  }

  console.log(`[fbProxy] Запрос: ${endpoint}`);

  const userId = getUserId();
  const adAccountId = getCurrentInternalAdAccountId();

  try {
    const response = await fetch(`${API_BASE_URL}/fb-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(userId ? { 'x-user-id': userId } : {}),
      },
      body: JSON.stringify({
        path: endpoint,
        params,
        method: 'GET',
        adAccountId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const fbError = errorData.facebook_error;

      // Проверка на истекший или недействительный токен
      if (fbError?.code === 190) {
        toastT.error('facebookAuthError');
      }

      // Проверка на rate limit
      if (fbError?.code === 4 || fbError?.code === 17 || fbError?.code === 613) {
        toastT.error('rateLimitError');
      }

      throw new Error(`Ошибка Facebook API: ${fbError?.message || errorData.error || response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[fbProxy] Ошибка:', error);
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

// Проверка наличия ID рекламного кабинета (токен теперь на бэкенде)
const hasValidConfig = async () => {
  const FB_API_CONFIG = await getCurrentUserConfig();
  const isValid = !!FB_API_CONFIG.ad_account_id && !!getUserId();
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
  if (!FB_API_CONFIG.ad_account_id) {
    throw new Error('Нет ad_account_id');
  }
  // ИСПРАВЛЕНО: Используем прямой endpoint кампании вместо фильтрации
  // Фильтрация через ad_account_id/adsets?filtering=... не работает для некоторых аккаунтов
  const endpoint = `${campaignId}/adsets`;
  const params = {
    fields: 'id,name,daily_budget,campaign_id,status',
    limit: '200',
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
  if (!FB_API_CONFIG.ad_account_id) {
    return [];
  }

  try {
    const endpoint = `${FB_API_CONFIG.ad_account_id}/insights`;
    const params = {
      level: 'adset',
      fields: 'adset_id,adset_name,spend,impressions,clicks,actions',
      time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until }),
      filtering: JSON.stringify([{ field: 'campaign.id', operator: 'EQUAL', value: campaignId }]),
      // Добавляем action_breakdowns для получения детализации по типам действий (как на дашборде)
      action_breakdowns: 'action_type',
      limit: '500',
    };

    const response = await fetchFromFacebookAPI(endpoint, params);

    if (response.data && response.data.length > 0) {
      const result = response.data.map((stat: any) => {
        // Используем ту же логику подсчёта лидов, что и на главном дашборде (getCampaignStats)
        let messagingLeads = 0;
        let qualityLeads = 0;
        let siteLeads = 0;
        let leadFormLeads = 0;

        if (stat.actions && Array.isArray(stat.actions)) {
          for (const action of stat.actions) {
            // Общие лиды (messaging_connection)
            if (action.action_type === 'onsite_conversion.total_messaging_connection') {
              messagingLeads = parseInt(action.value || "0", 10);
            }
            // Качественные лиды (2+ сообщения)
            else if (action.action_type === 'onsite_conversion.messaging_user_depth_2_message_send') {
              qualityLeads = parseInt(action.value || "0", 10);
            }
            // Лиды с сайта - используем ТОЛЬКО offsite_conversion.fb_pixel_lead
            // чтобы избежать дублирования с onsite_web_lead
            else if (action.action_type === 'offsite_conversion.fb_pixel_lead') {
              siteLeads = parseInt(action.value || "0", 10);
            }
            // Кастомные конверсии пикселя (берем все custom как лиды сайта) - ТОЛЬКО если нет fb_pixel_lead
            else if (!siteLeads && typeof action.action_type === 'string' && action.action_type.startsWith('offsite_conversion.custom')) {
              siteLeads = parseInt(action.value || "0", 10);
            }
            // Facebook Lead Forms - ТОЛЬКО onsite_conversion.lead_grouped
            // НЕ считаем 'lead' - это агрегат который дублирует pixel_lead для site кампаний
            else if (action.action_type === 'onsite_conversion.lead_grouped') {
              leadFormLeads = parseInt(action.value || "0", 10);
            }
          }
        }

        // Итог: переписки + лиды сайта + лидформы
        const leads = messagingLeads + siteLeads + leadFormLeads;

        const spend = parseFloat(stat.spend || "0");
        const cpl = leads > 0 ? spend / leads : 0;
        const cpql = qualityLeads > 0 ? spend / qualityLeads : 0;
        const qualityRate = messagingLeads > 0 ? (qualityLeads / messagingLeads) * 100 : 0;

        return {
          adset_id: stat.adset_id,
          adset_name: stat.adset_name,
          spend,
          leads,
          cpl,
          impressions: parseInt(stat.impressions || "0", 10),
          clicks: parseInt(stat.clicks || "0", 10),
          messagingLeads,
          qualityLeads,
          cpql,
          qualityRate,
        };
      });

      console.log(`[API] getAdsetStats returning ${result.length} mapped adsets`);
      return result;
    }

    return [];
  } catch (error) {
    console.error('Ошибка получения статистики ad sets:', error);
    return [];
  }
};

// Изменить daily_budget adset-а (через бэкенд proxy)
const updateAdsetBudget = async (adsetId: string, newBudget: number) => {
  const userId = getUserId();
  const adAccountId = getCurrentInternalAdAccountId();
  const response = await fetch(`${API_BASE_URL}/fb-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(userId ? { 'x-user-id': userId } : {}),
    },
    body: JSON.stringify({
      path: adsetId,
      params: { daily_budget: String(newBudget) },
      method: 'POST',
      adAccountId,
    }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.facebook_error?.message || errorData?.error || response.statusText);
  }
  return await response.json();
};

// Изменить статус adset-а (ACTIVE/PAUSED) (через бэкенд proxy)
const updateAdsetStatus = async (adsetId: string, isActive: boolean) => {
  const userId = getUserId();
  const adAccountId = getCurrentInternalAdAccountId();
  const response = await fetch(`${API_BASE_URL}/fb-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(userId ? { 'x-user-id': userId } : {}),
    },
    body: JSON.stringify({
      path: adsetId,
      params: { status: isActive ? 'ACTIVE' : 'PAUSED' },
      method: 'POST',
      adAccountId,
    }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.facebook_error?.message || errorData?.error || response.statusText);
  }
  return await response.json();
};

/**
 * Обновить статус объявления (ACTIVE/PAUSED) (через бэкенд proxy)
 */
const updateAdStatus = async (adId: string, isActive: boolean) => {
  const userId = getUserId();
  const adAccountId = getCurrentInternalAdAccountId();
  const response = await fetch(`${API_BASE_URL}/fb-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(userId ? { 'x-user-id': userId } : {}),
    },
    body: JSON.stringify({
      path: adId,
      params: { status: isActive ? 'ACTIVE' : 'PAUSED' },
      method: 'POST',
      adAccountId,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.facebook_error?.message || errorData?.error || response.statusText);
  }

  return await response.json();
};

// Получить статус рекламного кабинета и данные по бюджету
const getAccountStatus = async () => {
  const FB_API_CONFIG = await getCurrentUserConfig();
  if (!FB_API_CONFIG.ad_account_id) {
    throw new Error('Нет access_token или ad_account_id');
  }
  const endpoint = `${FB_API_CONFIG.ad_account_id}`;
  const params = { fields: 'spend_cap,amount_spent,balance,account_status,disable_reason' };
  const data = await fetchFromFacebookAPI(endpoint, params);

  // Пагинация по activities для поиска последнего ad_account_billing_charge (через proxy)
  let threshold_amount = null;
  let last_billing_date = null;
  let after: string | undefined = undefined;
  let found = false;
  let debug_activities: any[] = [];
  try {
    while (!found) {
      const actParams: Record<string, string> = {
        fields: 'event_time,event_type,extra_data',
        category: 'ACCOUNT',
        limit: '100',
      };
      if (after) actParams.after = after;
      const activitiesData = await fetchFromFacebookAPI(`${endpoint}/activities`, actParams);
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
      if (activitiesData.paging?.cursors?.after) {
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
  if (!FB_API_CONFIG.ad_account_id) {
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

// Получить page_id из текущей конфигурации (для Lead Forms)
const getCurrentPageId = async (): Promise<string | null> => {
  const storedUser = localStorage.getItem('user');

  if (storedUser) {
    try {
      const userData = JSON.parse(storedUser);

      // Проверяем мультиаккаунтный режим
      const storedAdAccounts = localStorage.getItem('adAccounts');
      const storedMultiAccountEnabled = localStorage.getItem('multiAccountEnabled');

      if (storedMultiAccountEnabled === 'true' && storedAdAccounts) {
        const adAccounts = JSON.parse(storedAdAccounts);
        const currentAdAccountId = localStorage.getItem('currentAdAccountId');
        const currentAcc = adAccounts.find((a: any) => a.id === currentAdAccountId);

        if (currentAcc && currentAcc.page_id) {
          return currentAcc.page_id;
        }
      }

      // Legacy режим
      if (userData && userData.page_id) {
        return userData.page_id;
      }
    } catch (error) {
      console.error('Ошибка при чтении page_id из localStorage:', error);
    }
  }

  return null;
};

// Facebook API сервис
export const facebookApi = {
  // Получить список лидформ для текущей страницы Facebook
  getLeadForms: async (): Promise<Array<{ id: string; name: string; status: string }>> => {
    if (!await hasValidConfig()) {
      return [];
    }

    const pageId = await getCurrentPageId();
    if (!pageId) {
      console.warn('Page ID не найден для загрузки лидформ');
      return [];
    }

    try {
      // Используем специализированный бэкенд-endpoint для lead forms
      // (он сам получает Page Access Token через /me/accounts)
      console.log('Запрашиваем лидформы через proxy для страницы:', pageId);

      const userId = getUserId();
      const adAccountId = getCurrentInternalAdAccountId();

      const response = await fetch(`${API_BASE_URL}/fb-proxy/lead-forms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userId ? { 'x-user-id': userId } : {}),
        },
        body: JSON.stringify({ pageId, adAccountId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.facebook_error?.message || errorData?.error || response.statusText);
      }

      const formsData = await response.json();
      const forms = formsData.data || [];

      console.log(`Получено лидформ: ${forms.length}`);

      if (forms.length === 0) {
        console.info('На странице не найдено лидформ');
      }

      return forms;
    } catch (e) {
      console.error('Не удалось получить список лидформ:', e);
      const errorMessage = e instanceof Error ? e.message : String(e);
      if (!errorMessage.includes('Empty response') && !errorMessage.includes('data')) {
        toastT.error('failedToLoadLeadForms');
      }
      return [];
    }
  },

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
      const pixels = (response.data || []).map((p: any) => ({ id: String(p.id), name: p.name || p.id }));

      console.log(`Получено пикселей: ${pixels.length}`);

      // Не показываем ошибку если просто нет пикселей - это нормально
      if (pixels.length === 0) {
        console.info('В рекламном кабинете не найдено пикселей');
      }

      return pixels;
    } catch (e) {
      console.error('Не удалось получить список пикселей:', e);
      // Показываем ошибку только если это реальная ошибка API, а не просто пустой результат
      const errorMessage = e instanceof Error ? e.message : String(e);
      if (!errorMessage.includes('Empty response') && !errorMessage.includes('data')) {
        toastT.error('failedToLoadPixels');
      }
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
        limit: '200'
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
  // campaigns - опциональный параметр, если передан - используем его, иначе загружаем (для избежания дублирования запросов)
  getCampaignStats: async (dateRange: DateRange, includeLeadForms: boolean = false, campaigns?: Campaign[]): Promise<CampaignStat[]> => {
    console.log('Запрос статистики кампаний за период:', dateRange);

    if (!await hasValidConfig()) {
      console.warn('Нет данных для получения статистики. Возвращаю пустой массив.');
      return [];
    }

    try {
      const FB_API_CONFIG = await getCurrentUserConfig();
      const accountId = FB_API_CONFIG.ad_account_id;

      console.log(`Запрашиваем статистику для рекламного кабинета: ${accountId}`);

      // Используем переданные кампании или загружаем (если не переданы)
      // Это позволяет избежать дублирования запросов при вызове из AppContext
      const campaignsToUse = campaigns || await facebookApi.getCampaigns();
      const campaignObjectiveById = new Map<string, string>();
      for (const c of campaignsToUse) {
        // @ts-ignore - защищаемся от разных форматов
        campaignObjectiveById.set(c.id, (c.objective as string) || 'UNKNOWN');
      }
      
      if (!campaignsToUse || campaignsToUse.length === 0) {
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
          let leadFormLeads = 0;

          if (stat.actions && Array.isArray(stat.actions)) {
            let hasPixelLead = false;

            for (const action of stat.actions) {
              // Общие лиды (messaging_connection)
              if (action.action_type === 'onsite_conversion.total_messaging_connection') {
                messagingLeads = parseInt(action.value || "0", 10);
              }
              // Качественные лиды (≥2 сообщения) - только для переписок
              else if (action.action_type === 'onsite_conversion.messaging_user_depth_2_message_send') {
                qualityLeads = parseInt(action.value || "0", 10);
              }
              // Лиды с сайта - fb_pixel_lead имеет приоритет
              else if (action.action_type === 'offsite_conversion.fb_pixel_lead') {
                siteLeads = parseInt(action.value || "0", 10);
                hasPixelLead = true;
              }
              // Кастомные конверсии - ТОЛЬКО если нет fb_pixel_lead (избегаем дублирования)
              else if (!hasPixelLead && typeof action.action_type === 'string' && action.action_type.startsWith('offsite_conversion.custom')) {
                siteLeads = parseInt(action.value || "0", 10);
              }
              // Facebook Lead Forms - ТОЛЬКО onsite_conversion.lead_grouped (настоящие лидформы)
              // НЕ считаем 'lead' - это агрегат который дублирует pixel_lead для site кампаний
              else if (action.action_type === 'onsite_conversion.lead_grouped') {
                leadFormLeads = parseInt(action.value || "0", 10);
              }
            }

            // Итог: переписки + лиды сайта + лидформы
            leads = messagingLeads + siteLeads + leadFormLeads;
          }
          
          // Расчёт производных метрик
          const spend = parseFloat(stat.spend) || 0;
          const impressions = parseInt(stat.impressions, 10) || 0;
          const clicks = parseInt(stat.clicks, 10) || 0;
          const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
          const cpl = leads > 0 ? spend / leads : 0;
          // Качество считается только от переписок, не от лидформ
          const qualityRate = messagingLeads > 0 ? (qualityLeads / messagingLeads) * 100 : 0;
          const cpql = qualityLeads > 0 ? spend / qualityLeads : 0;

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
            cpql,
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

      campaignsToUse.forEach(campaign => {
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
            messagingLeads: 0,
            qualityLeads: 0,
            qualityRate: 0,
            cpl: 0,
            cpql: 0,
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
      const status = isActive ? 'ACTIVE' : 'PAUSED';
      console.log(`Изменяем статус кампании ${campaignId} на ${status}`);

      const userId = getUserId();
      const adAccountId = getCurrentInternalAdAccountId();
      const response = await fetch(`${API_BASE_URL}/fb-proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userId ? { 'x-user-id': userId } : {}),
        },
        body: JSON.stringify({
          path: campaignId,
          params: { status },
          method: 'POST',
          adAccountId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Ошибка Facebook API при изменении статуса:', errorData);

        // Проверка на истекший токен
        if (errorData?.facebook_error?.code === 190) {
          toastT.error('statusAuthError');
        } else {
          toastT.error('statusUpdateError');
        }

        throw new Error(`Ошибка Facebook API: ${errorData?.facebook_error?.message || errorData?.error || response.statusText}`);
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

  // Получить бюджеты всех адсетов аккаунта (1 запрос на аккаунт)
  getAdsetBudgetsByAccount: async (): Promise<Array<{ id: string; campaign_id: string; daily_budget: number; status: string }>> => {
    try {
      const FB_API_CONFIG = await getCurrentUserConfig();
      if (!FB_API_CONFIG.ad_account_id) {
        return [];
      }
      const endpoint = `${FB_API_CONFIG.ad_account_id}/adsets`;
      const params = {
        fields: 'id,campaign_id,daily_budget,status',
        limit: '500',
      };
      const data = await fetchFromFacebookAPI(endpoint, params);
      return (data.data || []).map((a: any) => ({
        id: a.id,
        campaign_id: a.campaign_id,
        daily_budget: parseFloat(a.daily_budget || '0') / 100,
        status: a.status,
      }));
    } catch (error) {
      console.error('Ошибка при получении бюджетов адсетов:', error);
      return [];
    }
  },

  // Получить бюджеты адсетов для конкретного аккаунта через бэкенд proxy
  // adAccountId — Facebook act_XXX, internalId — UUID из нашей БД (для proxy)
  getAdsetBudgetsForAccount: async (adAccountId: string, _accessToken: string, internalId?: string): Promise<{ totalBudget: number; activeAdsetsCount: number }> => {
    try {
      const userId = getUserId();
      const proxyBody = (path: string) => ({
        path,
        params: {},
        method: 'GET' as const,
        adAccountId: internalId || getCurrentInternalAdAccountId(),
      });
      const proxyHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(userId ? { 'x-user-id': userId } : {}),
      };

      // Параллельно получаем кампании и адсеты через proxy
      const [campaignsRes, adsetsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/fb-proxy`, {
          method: 'POST', headers: proxyHeaders,
          body: JSON.stringify({ ...proxyBody(`${adAccountId}/campaigns`), params: { fields: 'id,status', limit: '500' } }),
        }),
        fetch(`${API_BASE_URL}/fb-proxy`, {
          method: 'POST', headers: proxyHeaders,
          body: JSON.stringify({ ...proxyBody(`${adAccountId}/adsets`), params: { fields: 'id,campaign_id,daily_budget,status', limit: '500' } }),
        }),
      ]);

      if (!campaignsRes.ok || !adsetsRes.ok) {
        throw new Error('Failed to fetch data from proxy');
      }

      const [campaignsData, adsetsData] = await Promise.all([
        campaignsRes.json(),
        adsetsRes.json()
      ]);

      const activeCampaignIds = new Set(
        (campaignsData.data || [])
          .filter((c: any) => c.status === 'ACTIVE')
          .map((c: any) => c.id)
      );

      const activeAdsets = (adsetsData.data || []).filter((a: any) =>
        a.status === 'ACTIVE' && activeCampaignIds.has(a.campaign_id)
      );

      const totalBudget = activeAdsets.reduce((sum: number, a: any) =>
        sum + parseFloat(a.daily_budget || '0') / 100, 0
      );

      return { totalBudget, activeAdsetsCount: activeAdsets.length };
    } catch (error) {
      console.error(`Ошибка при получении бюджетов адсетов для ${adAccountId}:`, error);
      return { totalBudget: 0, activeAdsetsCount: 0 };
    }
  },

  updateAdsetBudget,
  updateAdsetStatus,
  updateAdStatus,
  getAccountStatus,
  getCurrentDailySpend,

  /**
   * Получить объявления для адсета
   */
  getAdsByAdset: async (adsetId: string): Promise<Array<{ id: string; name: string; status: string; thumbnail_url?: string | null }>> => {
    if (!await hasValidConfig()) {
      return [];
    }
    try {
      const endpoint = `${adsetId}/ads`;
      const params = {
        fields: 'id,name,status,creative{thumbnail_url,image_url}',
        limit: '200',
      };
      const data = await fetchFromFacebookAPI(endpoint, params);
      return (data?.data || []).map((ad: any) => ({
        id: ad.id,
        name: ad.name,
        status: ad.status,
        thumbnail_url: ad.creative?.thumbnail_url || ad.creative?.image_url || null,
      }));
    } catch (e) {
      console.error('getAdsByAdset error', e);
      return [];
    }
  },

  /**
   * Получить статистику объявлений для адсета за период
   */
  getAdStatsByAdset: async (adsetId: string, dateRange: DateRange): Promise<Array<{
    ad_id: string;
    ad_name: string;
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
  }>> => {
    if (!await hasValidConfig()) {
      return [];
    }
    try {
      const FB_API_CONFIG = await getCurrentUserConfig();
      const endpoint = `${FB_API_CONFIG.ad_account_id}/insights`;
      const params = {
        level: 'ad',
        fields: 'ad_id,ad_name,spend,impressions,clicks,actions',
        time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until }),
        filtering: JSON.stringify([{ field: 'adset.id', operator: 'EQUAL', value: adsetId }]),
        action_breakdowns: 'action_type',
        limit: '500',
      };

      const response = await fetchFromFacebookAPI(endpoint, params);

      if (response.data && response.data.length > 0) {
        return response.data.map((stat: any) => {
          // Используем ту же логику подсчёта лидов
          let messagingLeads = 0;
          let qualityLeads = 0;
          let siteLeads = 0;
          let leadFormLeads = 0;

          if (stat.actions && Array.isArray(stat.actions)) {
            for (const action of stat.actions) {
              if (action.action_type === 'onsite_conversion.total_messaging_connection') {
                messagingLeads = parseInt(action.value || "0", 10);
              } else if (action.action_type === 'onsite_conversion.messaging_user_depth_2_message_send') {
                qualityLeads = parseInt(action.value || "0", 10);
              } else if (action.action_type === 'offsite_conversion.fb_pixel_lead') {
                siteLeads = parseInt(action.value || "0", 10);
              } else if (!siteLeads && typeof action.action_type === 'string' && action.action_type.startsWith('offsite_conversion.custom')) {
                siteLeads = parseInt(action.value || "0", 10);
              } else if (action.action_type === 'onsite_conversion.lead_grouped') {
                leadFormLeads = parseInt(action.value || "0", 10);
              }
            }
          }

          const leads = messagingLeads + Math.max(siteLeads, leadFormLeads);
          const spend = parseFloat(stat.spend || '0');
          const impressions = parseInt(stat.impressions || '0', 10);
          const clicks = parseInt(stat.clicks || '0', 10);
          const cpql = qualityLeads > 0 ? spend / qualityLeads : 0;
          const qualityRate = messagingLeads > 0 ? (qualityLeads / messagingLeads) * 100 : 0;

          return {
            ad_id: stat.ad_id,
            ad_name: stat.ad_name,
            spend,
            leads,
            impressions,
            clicks,
            ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
            cpl: leads > 0 ? spend / leads : 0,
            messagingLeads,
            qualityLeads,
            cpql,
            qualityRate,
          };
        });
      }
      return [];
    } catch (e) {
      console.error('getAdStatsByAdset error', e);
      return [];
    }
  },

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
          let leadFormLeads = 0;
          if (row.actions && Array.isArray(row.actions)) {
            for (const action of row.actions) {
              if (action.action_type === 'onsite_conversion.total_messaging_connection') {
                messagingLeads = parseInt(action.value || '0', 10);
              }
              // Лиды с сайта - используем ТОЛЬКО offsite_conversion.fb_pixel_lead
              // чтобы избежать дублирования с onsite_web_lead
              else if (action.action_type === 'offsite_conversion.fb_pixel_lead') {
                siteLeads = parseInt(action.value || '0', 10);
              }
              // Кастомные конверсии пикселя - ТОЛЬКО если нет fb_pixel_lead
              else if (!siteLeads && typeof action.action_type === 'string' && action.action_type.startsWith('offsite_conversion.custom')) {
                siteLeads = parseInt(action.value || '0', 10);
              }
              // Facebook Lead Forms - ТОЛЬКО onsite_conversion.lead_grouped
              // НЕ считаем 'lead' - это агрегат который дублирует pixel_lead для site кампаний
              else if (action.action_type === 'onsite_conversion.lead_grouped') {
                leadFormLeads = parseInt(action.value || '0', 10);
              }
            }
          }
          totalSpend += spend;
          totalImpr += impressions;
          totalClicks += clicks;
          totalLeads += (messagingLeads + siteLeads + leadFormLeads);
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
            let messagingLeads = 0;
            let siteLeads = 0;
            let leadFormLeads = 0;
            let qualityLeads = 0;

            if (stat.actions && Array.isArray(stat.actions)) {
              for (const action of stat.actions) {
                // Общие лиды (messaging_connection)
                if (action.action_type === 'onsite_conversion.total_messaging_connection') {
                  messagingLeads = parseInt(action.value || "0", 10);
                }
                // Качественные лиды (≥2 сообщения)
                else if (action.action_type === 'onsite_conversion.messaging_user_depth_2_message_send') {
                  qualityLeads = parseInt(action.value || "0", 10);
                }
                // Лиды с сайта
                else if (action.action_type === 'offsite_conversion.fb_pixel_lead') {
                  siteLeads = parseInt(action.value || "0", 10);
                }
                // Кастомные конверсии пикселя - ТОЛЬКО если нет fb_pixel_lead
                else if (!siteLeads && typeof action.action_type === 'string' && action.action_type.startsWith('offsite_conversion.custom')) {
                  siteLeads = parseInt(action.value || "0", 10);
                }
                // Facebook Lead Forms - ТОЛЬКО onsite_conversion.lead_grouped
                // НЕ считаем 'lead' - это агрегат который дублирует pixel_lead для site кампаний
                else if (action.action_type === 'onsite_conversion.lead_grouped') {
                  leadFormLeads = parseInt(action.value || "0", 10);
                }
              }
            }

            const leads = messagingLeads + siteLeads + leadFormLeads;
            const spend = parseFloat(stat.spend) || 0;
            const impressions = parseInt(stat.impressions, 10) || 0;
            const clicks = parseInt(stat.clicks, 10) || 0;
            const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
            const cpl = leads > 0 ? spend / leads : 0;
            const qualityRate = messagingLeads > 0 ? (qualityLeads / messagingLeads) * 100 : 0;

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
  },

  /**
   * Submit manual Facebook connection for review
   * User provides IDs manually after granting access via Business Portfolio
   */
  submitManualConnection: async (data: {
    page_id: string;
    instagram_id?: string;
    ad_account_id: string;
    account_id?: string; // UUID ad_accounts.id для мультиаккаунтного режима
  }): Promise<{ success: boolean; error?: string }> => {
    try {
      // Get user_id from localStorage
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        return { success: false, error: 'Пользователь не авторизован' };
      }

      const userData = JSON.parse(storedUser);
      if (!userData.id) {
        return { success: false, error: 'ID пользователя не найден' };
      }

      // Для мультиаккаунтного режима: используем переданный account_id или fallback на localStorage
      const multiAccountEnabled = localStorage.getItem('multiAccountEnabled') === 'true';
      const currentAdAccountId = data.account_id || localStorage.getItem('currentAdAccountId');

      console.log('[facebookApi] Submitting manual connection:', {
        user_id: userData.id,
        account_id: multiAccountEnabled ? currentAdAccountId : null,
        page_id: data.page_id,
        instagram_id: data.instagram_id,
        ad_account_id: data.ad_account_id
      });

      const response = await fetch(`${API_BASE_URL}/facebook/manual-connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userData.id,
          account_id: multiAccountEnabled ? currentAdAccountId : null, // UUID для мультиаккаунтности
          page_id: data.page_id,
          instagram_id: data.instagram_id || null,
          ad_account_id: data.ad_account_id
        })
      });

      const result = await response.json();

      if (result.success) {
        // Update localStorage with new data
        userData.page_id = data.page_id;
        userData.instagram_id = data.instagram_id || null;
        userData.ad_account_id = data.ad_account_id.startsWith('act_')
          ? data.ad_account_id
          : `act_${data.ad_account_id}`;
        userData.fb_connection_status = 'pending_review';
        localStorage.setItem('user', JSON.stringify(userData));

        // Для мультиаккаунтного режима: обновляем adAccounts в localStorage
        if (multiAccountEnabled && currentAdAccountId) {
          const storedAdAccounts = localStorage.getItem('adAccounts');
          if (storedAdAccounts) {
            const adAccounts = JSON.parse(storedAdAccounts);
            const updatedAccounts = adAccounts.map((acc: any) => {
              if (acc.id === currentAdAccountId) {
                return {
                  ...acc,
                  ad_account_id: data.ad_account_id.startsWith('act_')
                    ? data.ad_account_id
                    : `act_${data.ad_account_id}`,
                  connection_status: 'pending_review',
                };
              }
              return acc;
            });
            localStorage.setItem('adAccounts', JSON.stringify(updatedAccounts));
          }
        }

        console.log('[facebookApi] Manual connection submitted successfully');
      }

      return result;
    } catch (error) {
      console.error('[facebookApi] Error submitting manual connection:', error);
      return { success: false, error: 'Не удалось подключиться к серверу' };
    }
  }
};
