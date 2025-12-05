import { supabase } from '@/integrations/supabase/client';
import { API_BASE_URL } from '@/config/api';

export interface ROIData {
  totalRevenue: number;
  totalSpend: number;
  totalROI: number;
  totalLeads: number;
  totalConversions: number;
  campaigns: CampaignROI[];
}

// Тип для карточки карусели (синхронизирован с creativesApi.ts)
export interface CarouselCardROI {
  order: number;
  text: string;
  image_url?: string;
  image_url_4k?: string;
}

export interface CampaignROI {
  id: string;
  name: string;
  creative_url: string;
  spend: number;
  revenue: number;
  roi: number;
  leads: number;
  conversions: number;
  qualification?: {
    qualified: number;
    total: number;
    rate: number;
  };
  // Новые поля для типа медиа и миниатюр
  media_type?: 'video' | 'image' | 'carousel' | null;
  image_url?: string | null;
  thumbnail_url?: string | null; // Миниатюра для видео (скриншот первого кадра)
  carousel_data?: CarouselCardROI[] | null;
  generated_creative_id?: string | null;
}

export interface Direction {
  id: string;
  name: string;
  objective: string;
  whatsapp_phone_number: string | null;
  is_active: boolean;
  created_at: string;
  // AmoCRM key stages (up to 3)
  key_stage_1_pipeline_id?: number | null;
  key_stage_1_status_id?: number | null;
  key_stage_2_pipeline_id?: number | null;
  key_stage_2_status_id?: number | null;
  key_stage_3_pipeline_id?: number | null;
  key_stage_3_status_id?: number | null;
}

class SalesApiService {
  // Получение всех продаж по пользователю
  // accountId - UUID рекламного аккаунта для мультиаккаунтности (опционально)
  async getAllPurchases(userAccountId: string, accountId?: string): Promise<{ data: any[]; error: any }> {
    try {
      // Загружаем purchases
      let purchasesQuery = (supabase as any)
        .from('purchases')
        .select('*')
        .eq('user_account_id', userAccountId)
        .order('created_at', { ascending: false })
        .limit(10000);

      // Фильтр по account_id для мультиаккаунтности
      if (accountId) {
        purchasesQuery = purchasesQuery.eq('account_id', accountId);
      }

      const { data: purchases, error } = await purchasesQuery;

      if (error || !purchases || purchases.length === 0) {
        return { data: purchases || [], error };
      }

      // Получаем уникальные телефоны для поиска связанных лидов
      const phones = [...new Set(purchases.map((p: any) => p.client_phone))];

      // Загружаем лиды с creative_id для этих телефонов
      const { data: leads } = await (supabase as any)
        .from('leads')
        .select('chat_id, creative_id')
        .eq('user_account_id', userAccountId)
        .in('chat_id', phones)
        .not('creative_id', 'is', null);

      if (!leads || leads.length === 0) {
        return { data: purchases, error: null };
      }

      // Получаем названия креативов
      const creativeIds = [...new Set(leads.map((l: any) => l.creative_id))];
      const { data: creatives } = await (supabase as any)
        .from('user_creatives')
        .select('id, title')
        .in('id', creativeIds);

      // Создаём map phone -> creative_id -> title
      const phoneToCreativeId = new Map(leads.map((l: any) => [l.chat_id, l.creative_id]));
      const creativeIdToTitle = new Map(creatives?.map((c: any) => [c.id, c.title]) || []);

      // Добавляем название креатива к каждой продаже
      const enrichedPurchases = purchases.map((p: any) => {
        const creativeId = phoneToCreativeId.get(p.client_phone);
        const creativeName = creativeId ? creativeIdToTitle.get(creativeId) : null;
        return {
          ...p,
          campaign_name: creativeName || p.campaign_name || null
        };
      });

      return { data: enrichedPurchases, error: null };
    } catch (error) {
      return { data: [], error };
    }
  }

  // Получение списка направлений пользователя
  async getDirections(userAccountId: string): Promise<{ data: Direction[]; error: any }> {
    try {
      const response = await fetch(`${API_BASE_URL}/directions?userAccountId=${userAccountId}`);
      const result = await response.json();
      
      if (!result.success) {
        return { data: [], error: result.error };
      }
      
      return { data: result.directions || [], error: null };
    } catch (error) {
      console.error('Error fetching directions:', error);
      return { data: [], error };
    }
  }

  // Обновление продажи
  async updatePurchase(id: string, updateData: Partial<{ client_phone: string; amount: number; campaign_name: string }>): Promise<any> {
    try {
      const { data, error } = await (supabase as any)
        .from('purchases')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  // Функция для получения затрат по конкретному объявлению
  private async getAdSpend(accessToken: string, adId: string, datePreset: 'last_7d' | 'last_30d' | 'last_90d'): Promise<number> {
    try {
      // Validate Ad ID format - must be all digits
      if (!/^\d+$/.test(adId)) {
        console.warn(`⚠️ Невалидный формат Ad ID: "${adId}". Facebook Ad ID должен содержать только цифры. Пропускаем запрос к Facebook API.`);
        return 0;
      }

      const baseUrl = 'https://graph.facebook.com/v18.0';
      const url = new URL(`${baseUrl}/${adId}/insights`);
      url.searchParams.append('access_token', accessToken);
      
      // Используем кастомный диапазон дат вместо date_preset
      // Это гарантирует получение данных даже для остановленных объявлений
      const timeRanges: { [key: string]: number } = {
        'last_7d': 7,
        'last_30d': 30,
        'last_90d': 90
      };
      
      const daysBack = timeRanges[datePreset];
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const sinceStr = since.toISOString().split('T')[0]; // YYYY-MM-DD
      const untilStr = new Date().toISOString().split('T')[0]; // Сегодня
      
      url.searchParams.append('time_range', JSON.stringify({
        since: sinceStr,
        until: untilStr
      }));
      url.searchParams.append('fields', 'spend');

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        console.warn(`⚠️ Не удалось получить затраты для объявления ${adId}: ${response.status}`);
        return 0;
      }

      const data = await response.json();
      const spend = data.data?.[0]?.spend || 0;
      return parseFloat(spend);
      
    } catch (error) {
      console.error(`❌ Ошибка получения затрат для объявления ${adId}:`, error);
      return 0;
    }
  }

  // Функция для получения ID кампании по ID объявления
  private async getCampaignIdByAdId(accessToken: string, adId: string): Promise<string | null> {
    try {
      // Validate Ad ID format - must be all digits
      if (!/^\d+$/.test(adId)) {
        console.warn(`⚠️ Невалидный формат Ad ID: "${adId}". Пропускаем запрос к Facebook API.`);
        return null;
      }

      const baseUrl = 'https://graph.facebook.com/v18.0';
      const url = new URL(`${baseUrl}/${adId}`);
      url.searchParams.append('access_token', accessToken);
      url.searchParams.append('fields', 'campaign_id');

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        console.log(`⚠️ Не удалось получить campaign_id для объявления ${adId}`);
        return null;
      }

      const data = await response.json();
      console.log(`📋 Объявление ${adId} → Кампания ${data.campaign_id}`);
      return data.campaign_id || null;
      
    } catch (error) {
      console.error(`❌ Ошибка получения campaign_id для объявления ${adId}:`, error);
      return null;
    }
  }

  // Функция для получения данных кампаний из Facebook API
  private async getFacebookCampaignsData(accessToken: string, adAccountId: string): Promise<Map<string, { name: string; spend: number }>> {
    const campaignsMap = new Map<string, { name: string; spend: number }>();
    const accountId = adAccountId; // Используем актуальный ID кабинета из базы данных
    const baseUrl = 'https://graph.facebook.com/v18.0';
    
    try {
      console.log('🔄 Загружаем данные кампаний из Facebook API...');
      
      const url = new URL(`${baseUrl}/${accountId}`);
      url.searchParams.append('access_token', accessToken);
      
      // Используем ваш запрос без фильтрации по активным кампаниям
      url.searchParams.append('fields', 
        'campaigns{id,name,adsets.limit(1){id,name,ads.limit(1){id,name,insights.date_preset(maximum){spend}}}}'
      );

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Facebook API error:', response.status, errorText);
        return campaignsMap;
      }

      const data = await response.json();
      console.log('📊 Facebook API response:', data);
      
      if (data.campaigns?.data) {
        data.campaigns.data.forEach((campaign: any) => {
          let totalSpend = 0;
          
          // Собираем затраты по всем объявлениям в кампании
          campaign.adsets?.data?.forEach((adset: any) => {
            adset.ads?.data?.forEach((ad: any) => {
              ad.insights?.data?.forEach((insight: any) => {
                totalSpend += parseFloat(insight.spend) || 0;
              });
            });
          });

          campaignsMap.set(campaign.id, {
            name: campaign.name,
            spend: totalSpend // в долларах
          });
          
          console.log(`📊 Кампания ${campaign.id}: ${campaign.name}, затраты: $${totalSpend}`);
        });
      }

      console.log(`✅ Загружено ${campaignsMap.size} кампаний из Facebook`);
      return campaignsMap;
      
    } catch (error) {
      console.error('❌ Ошибка загрузки данных из Facebook:', error);
      return campaignsMap;
    }
  }

  // Получение ROI данных по user_account_id с опциональным фильтром по direction и типу медиа
  // НОВАЯ ЛОГИКА: начинаем с user_creatives, метрики берём из creative_metrics_history
  // accountId - UUID рекламного аккаунта для мультиаккаунтности (опционально)
  async getROIData(
    userAccountId: string,
    directionId: string | null = null,
    timeframeDays: 7 | 30 | 90 | 'all' = 'all',
    mediaType: 'video' | 'image' | 'carousel' | null = null,
    accountId?: string
  ): Promise<ROIData> {
    try {
      console.log('🔄 Загружаем ROI данные для user_account_id:', userAccountId, 'direction:', directionId || 'все');

      // Фильтрация по периоду
      const since = (() => {
        if (timeframeDays === 'all') return null;
        const d = new Date();
        d.setDate(d.getDate() - timeframeDays);
        d.setHours(0, 0, 0, 0);
        return d.toISOString().split('T')[0]; // YYYY-MM-DD для сравнения с date
      })();

      // Курс доллара к тенге
      const usdToKztRate = 530;

      // ШАГ 1: Загружаем user_creatives для пользователя с фильтрами
      let creativesQuery = (supabase as any)
        .from('user_creatives')
        .select('id, title, created_at, media_type, image_url, thumbnail_url, carousel_data, generated_creative_id, fb_video_id, direction_id')
        .eq('user_id', userAccountId)
        .eq('status', 'ready')
        .order('created_at', { ascending: false })
        .limit(10000);

      // Фильтрация по account_id для мультиаккаунтности
      if (accountId) {
        creativesQuery = creativesQuery.eq('account_id', accountId);
      }

      // Фильтрация по направлению
      if (directionId) {
        creativesQuery = creativesQuery.eq('direction_id', directionId);
      }

      // Фильтрация по типу медиа
      if (mediaType) {
        creativesQuery = creativesQuery.eq('media_type', mediaType);
      }

      const { data: creatives, error: creativesError } = await creativesQuery;

      if (creativesError) {
        console.error('Ошибка загрузки креативов:', creativesError);
        throw creativesError;
      }

      console.log('📊 Загружено креативов:', creatives?.length || 0);

      if (!creatives || creatives.length === 0) {
        return {
          totalRevenue: 0,
          totalSpend: 0,
          totalROI: 0,
          totalLeads: 0,
          totalConversions: 0,
          campaigns: []
        };
      }

      // ВАЖНО: carousel_data в user_creatives может быть неправильной (баг миграции).
      // Всегда загружаем актуальные данные из generated_creatives по generated_creative_id
      const carouselsWithGenId = creatives.filter(
        (c: any) => c.media_type === 'carousel' && c.generated_creative_id
      );

      if (carouselsWithGenId.length > 0) {
        const generatedIds = carouselsWithGenId.map((c: any) => c.generated_creative_id);
        const { data: generatedData } = await (supabase as any)
          .from('generated_creatives')
          .select('id, carousel_data')
          .in('id', generatedIds);

        if (generatedData) {
          const generatedMap = new Map(generatedData.map((g: any) => [g.id, g.carousel_data]));
          for (const creative of creatives) {
            if (creative.media_type === 'carousel' && creative.generated_creative_id) {
              // Перезаписываем carousel_data из generated_creatives (источник правды)
              creative.carousel_data = generatedMap.get(creative.generated_creative_id) || creative.carousel_data;
            }
          }
        }
      }

      const creativeIds = creatives.map((c: any) => c.id);

      // ШАГ 2: Загружаем метрики из creative_metrics_history для всех креативов
      let metricsQuery = (supabase as any)
        .from('creative_metrics_history')
        .select('user_creative_id, impressions, reach, clicks, leads, spend, date')
        .in('user_creative_id', creativeIds)
        .eq('user_account_id', userAccountId)
        .eq('source', 'production');

      if (since) {
        metricsQuery = metricsQuery.gte('date', since);
      }

      const { data: metricsHistory, error: metricsError } = await metricsQuery;

      if (metricsError) {
        console.error('Ошибка загрузки метрик:', metricsError);
        // Продолжаем без метрик
      }

      console.log('📊 Загружено записей метрик:', metricsHistory?.length || 0);

      // Агрегируем метрики по креативам
      const metricsMap = new Map<string, { impressions: number; reach: number; clicks: number; leads: number; spend: number }>();
      for (const metric of metricsHistory || []) {
        const creativeId = metric.user_creative_id;
        if (!metricsMap.has(creativeId)) {
          metricsMap.set(creativeId, { impressions: 0, reach: 0, clicks: 0, leads: 0, spend: 0 });
        }
        const agg = metricsMap.get(creativeId)!;
        agg.impressions += metric.impressions || 0;
        agg.reach += metric.reach || 0;
        agg.clicks += metric.clicks || 0;
        agg.leads += metric.leads || 0;
        agg.spend += metric.spend || 0;
      }

      // ШАГ 3: Загружаем лиды для расчёта выручки (связь с purchases)
      let leadsQuery = (supabase as any)
        .from('leads')
        .select('id, chat_id, creative_id, direction_id, is_qualified')
        .eq('user_account_id', userAccountId)
        .in('creative_id', creativeIds);

      // Фильтрация по account_id для мультиаккаунтности
      if (accountId) {
        leadsQuery = leadsQuery.eq('account_id', accountId);
      }

      if (directionId) {
        leadsQuery = leadsQuery.eq('direction_id', directionId);
      }

      if (since) {
        leadsQuery = leadsQuery.gte('created_at', since + 'T00:00:00.000Z');
      }

      const { data: leadsData, error: leadsError } = await leadsQuery;

      if (leadsError) {
        console.error('Ошибка загрузки лидов:', leadsError);
      }

      console.log('📊 Загружено лидов для выручки:', leadsData?.length || 0);

      // ШАГ 4: Загружаем продажи для расчёта выручки
      const leadPhones = leadsData?.map((l: any) => l.chat_id).filter(Boolean) || [];

      let purchasesQuery = (supabase as any)
        .from('purchases')
        .select('id, client_phone, amount, created_at')
        .eq('user_account_id', userAccountId);

      // Фильтрация по account_id для мультиаккаунтности
      if (accountId) {
        purchasesQuery = purchasesQuery.eq('account_id', accountId);
      }

      if (leadPhones.length > 0) {
        purchasesQuery = purchasesQuery.in('client_phone', leadPhones);
      } else {
        purchasesQuery = purchasesQuery.in('client_phone', ['__no_match__']);
      }

      if (since) {
        purchasesQuery = purchasesQuery.gte('created_at', since + 'T00:00:00.000Z');
      }

      const { data: purchasesData, error: purchasesError } = await purchasesQuery;

      if (purchasesError) {
        console.error('Ошибка загрузки продаж:', purchasesError);
      }

      console.log('📊 Загружено продаж:', purchasesData?.length || 0);

      // Группируем продажи по номеру телефона
      const purchasesByPhone = new Map<string, { count: number; amount: number }>();
      for (const purchase of purchasesData || []) {
        const phone = purchase.client_phone;
        if (!purchasesByPhone.has(phone)) {
          purchasesByPhone.set(phone, { count: 0, amount: 0 });
        }
        const p = purchasesByPhone.get(phone)!;
        p.count++;
        p.amount += Number(purchase.amount) || 0;
      }

      // Группируем лиды по креативам для расчёта выручки, конверсий и квалификации
      const revenueByCreative = new Map<string, { revenue: number; conversions: number; leadsCount: number; qualifiedCount: number }>();
      for (const lead of leadsData || []) {
        const creativeId = lead.creative_id;
        if (!creativeId) continue;

        if (!revenueByCreative.has(creativeId)) {
          revenueByCreative.set(creativeId, { revenue: 0, conversions: 0, leadsCount: 0, qualifiedCount: 0 });
        }
        const rev = revenueByCreative.get(creativeId)!;
        rev.leadsCount++;

        // Считаем квалифицированных
        if (lead.is_qualified === true) {
          rev.qualifiedCount++;
        }

        const purchaseData = purchasesByPhone.get(lead.chat_id);
        if (purchaseData) {
          rev.revenue += purchaseData.amount;
          rev.conversions += purchaseData.count;
        }
      }

      // ШАГ 5: Формируем результат
      const campaigns: CampaignROI[] = [];
      let totalRevenue = 0;
      let totalSpend = 0;
      let totalLeads = 0;
      let totalConversions = 0;

      for (const creative of creatives) {
        const creativeId = creative.id;
        const metrics = metricsMap.get(creativeId) || { impressions: 0, reach: 0, clicks: 0, leads: 0, spend: 0 };
        const revenueData = revenueByCreative.get(creativeId) || { revenue: 0, conversions: 0, leadsCount: 0, qualifiedCount: 0 };

        // Лиды берём из creative_metrics_history (метрики FB), не из таблицы leads
        const leads = metrics.leads;

        // Данные о квалификации из локальной таблицы leads
        const qualifiedCount = revenueData.qualifiedCount;
        // % квал считаем от количества лидов из FB метрик, а не от локальных лидов
        const qualificationRate = leads > 0 ? (qualifiedCount / leads) * 100 : 0;
        const spend = Math.round(metrics.spend * usdToKztRate); // spend в USD -> KZT
        const revenue = revenueData.revenue;
        const conversions = revenueData.conversions;

        // ROI расчёт
        const roi = spend > 0 ? Math.round(((revenue - spend) / spend) * 100) : 0;

        // Определяем URL креатива в зависимости от типа
        let creativeUrl = '';
        if (creative.media_type === 'video' && creative.fb_video_id) {
          // Для видео - ссылка на Facebook видео
          creativeUrl = `https://www.facebook.com/watch/?v=${creative.fb_video_id}`;
        } else if (creative.media_type === 'image' && creative.image_url) {
          creativeUrl = creative.image_url;
        } else if (creative.media_type === 'carousel' && creative.carousel_data?.length > 0) {
          // Берём первую картинку карусели
          const firstCard = creative.carousel_data[0];
          creativeUrl = firstCard?.image_url_4k || firstCard?.image_url || '';
        }

        campaigns.push({
          id: creativeId,
          name: creative.title || `Креатив ${creativeId.substring(0, 8)}...`,
          creative_url: creativeUrl,
          spend,
          revenue,
          roi,
          leads,
          conversions,
          // Данные о квалификации лидов (% от FB leads, не от локальных)
          qualification: leads > 0 ? {
            qualified: qualifiedCount,
            total: leads,
            rate: qualificationRate
          } : undefined,
          // Новые поля для типа медиа и миниатюр
          media_type: creative.media_type || null,
          image_url: creative.image_url || null,
          thumbnail_url: creative.thumbnail_url || null, // Миниатюра для видео
          carousel_data: creative.carousel_data || null,
          generated_creative_id: creative.generated_creative_id || null
        });

        totalRevenue += revenue;
        totalSpend += spend;
        totalLeads += leads;
        totalConversions += conversions;
      }

      // Сортируем по количеству лидов (от большего к меньшему)
      campaigns.sort((a, b) => b.leads - a.leads);

      const totalROI = totalSpend > 0 ? Math.round(((totalRevenue - totalSpend) / totalSpend) * 100) : 0;

      const result: ROIData = {
        totalRevenue,
        totalSpend,
        totalROI,
        totalLeads,
        totalConversions,
        campaigns
      };

      console.log('✅ ROI данные загружены:', result);
      return result;

    } catch (error) {
      console.error('Ошибка в getROIData:', error);
      throw error;
    }
  }

  // Получение списка существующих кампаний для выбора
  public async getExistingCampaigns(userAccountId: string): Promise<Array<{id: string, name: string, creative_url?: string}>> {
    try {
      console.log('🔄 Загружаем существующие кампании для user_account_id:', userAccountId);

      // Получаем уникальные source_id из таблицы leads
      const { data: campaignsData, error: campaignsError } = await (supabase as any)
        .from('leads')
        .select('source_id, creative_url')
        .eq('user_account_id', userAccountId)
        .not('source_id', 'is', null);

      if (campaignsError) {
        console.error('❌ Ошибка загрузки кампаний:', campaignsError);
        throw campaignsError;
      }

      // Убираем дубликаты и создаем список кампаний
      const uniqueCampaigns = new Map<string, {id: string, name: string, creative_url?: string}>();

      for (const campaign of campaignsData || []) {
        if (campaign.source_id && !uniqueCampaigns.has(campaign.source_id)) {
          uniqueCampaigns.set(campaign.source_id, {
            id: campaign.source_id,
            name: `Кампания ${campaign.source_id}`,
            creative_url: campaign.creative_url || undefined
          });
        }
      }

      // Пытаемся получить реальные названия из Facebook API
      try {
        const { data: userData, error: userError } = await (supabase as any)
          .from('user_accounts')
          .select('access_token, ad_account_id')
          .eq('id', userAccountId)
          .single();

        if (!userError && userData?.access_token && userData?.ad_account_id) {
          console.log('✅ Загружаем реальные названия кампаний из Facebook API...');
          const facebookCampaigns = await this.getFacebookCampaignsData(userData.access_token, userData.ad_account_id);

          // Обновляем названия кампаний
          for (const [sourceId, campaignInfo] of uniqueCampaigns) {
            try {
              const campaignId = await this.getCampaignIdByAdId(userData.access_token, sourceId);
              if (campaignId) {
                const fbCampaign = facebookCampaigns.get(campaignId);
                if (fbCampaign) {
                  campaignInfo.name = fbCampaign.name;
                }
              }
            } catch (error) {
              console.warn(`⚠️ Не удалось получить название для кампании ${sourceId}:`, error);
            }
          }
        }
      } catch (fbError) {
        console.warn('⚠️ Не удалось получить данные из Facebook API для названий кампаний:', fbError);
      }

      const result = Array.from(uniqueCampaigns.values());
      console.log('✅ Загружено кампаний:', result.length);
      return result;

    } catch (error) {
      console.error('❌ Ошибка в getExistingCampaigns:', error);
      throw error;
    }
  }

  // Получение user_account_id (UUID) текущего пользователя
  // Это ID из таблицы user_accounts, используется для связи с leads/purchases
  public async getCurrentUserAccountId(): Promise<string | null> {
    try {
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        throw new Error('Пользователь не авторизован');
      }

      const userData = JSON.parse(storedUser);

      // Используем ID пользователя (UUID из user_accounts)
      if (userData.id) {
        console.log('✅ User Account ID:', userData.id);
        return userData.id;
      }

      throw new Error('User Account ID не найден');
    } catch (error) {
      console.error('Ошибка получения user_account_id:', error);
      return null;
    }
  }

  // Получение business_id текущего пользователя (legacy, для старого кода)
  public async getCurrentUserBusinessId(): Promise<string | null> {
    return this.getCurrentUserAccountId();
  }

  // Обновляем sale_amount в лиде после добавления продажи
  private async updateLeadSaleAmount(clientPhone: string, userAccountId: string) {
    try {
      console.log('🔄 Обновляем sale_amount в лиде...');
      
      // Считаем общую сумму всех продаж клиента
      const { data: totalSales, error: sumError } = await (supabase as any)
        .from('purchases')
        .select('amount')
        .eq('client_phone', clientPhone)
        .eq('user_account_id', userAccountId);

      if (sumError) {
        console.error('❌ Ошибка подсчета суммы продаж:', sumError);
        return;
      }

      const totalAmount = totalSales?.reduce((sum, sale) => sum + Number(sale.amount), 0) || 0;
      console.log('💰 Общая сумма продаж клиента:', totalAmount);

      // Обновляем sale_amount в лиде
      const { error: updateError } = await (supabase as any)
        .from('leads')
        .update({ 
          sale_amount: totalAmount,
          updated_at: new Date().toISOString()
        })
        .eq('chat_id', clientPhone)
        .eq('user_account_id', userAccountId);

      if (updateError) {
        console.error('❌ Ошибка обновления sale_amount в лиде:', updateError);
      } else {
        console.log('✅ sale_amount обновлен в лиде:', totalAmount);
      }
      
    } catch (error) {
      console.error('❌ Ошибка в updateLeadSaleAmount:', error);
    }
  }

  // Получение метрик креатива из creative_metrics_history
  // Агрегирует метрики всех ads креатива через ad_creative_mapping
  async getCreativeMetrics(creativeId: string, userAccountId: string, limit: number = 30): Promise<{ data: any[]; error: any }> {
    try {
      // Шаг 1: Получить все ad_id для этого креатива через ad_creative_mapping
      const { data: mappings, error: mappingError } = await (supabase as any)
        .from('ad_creative_mapping')
        .select('ad_id')
        .eq('user_creative_id', creativeId);

      if (mappingError) {
        console.error('Ошибка загрузки ad_creative_mapping:', mappingError);
        return { data: [], error: mappingError };
      }

      if (!mappings || mappings.length === 0) {
        console.log('Нет ad mappings для креатива:', creativeId);
        return { data: [], error: null };
      }

      const adIds = mappings.map((m: any) => m.ad_id);

      // Шаг 2: Получить метрики для всех ads за последние N дней
      const dateCutoff = new Date();
      dateCutoff.setDate(dateCutoff.getDate() - limit);

      const { data, error } = await (supabase as any)
        .from('creative_metrics_history')
        .select('*')
        .in('ad_id', adIds)
        .eq('user_account_id', userAccountId)
        .eq('source', 'production')
        .gte('date', dateCutoff.toISOString().split('T')[0])
        .order('date', { ascending: false });

      if (error) {
        console.error('Ошибка загрузки метрик из creative_metrics_history:', error);
        return { data: [], error };
      }

      // Шаг 3: Агрегировать метрики по дням
      const aggregated = this.aggregateMetricsByDate(data || []);
      
      return { data: aggregated, error: null };
    } catch (error) {
      console.error('Ошибка загрузки метрик креатива:', error);
      return { data: [], error };
    }
  }

  // Вспомогательная функция для агрегации метрик по дням
  private aggregateMetricsByDate(metrics: any[]): any[] {
    const grouped = new Map<string, any>();

    metrics.forEach(m => {
      const existing = grouped.get(m.date) || {
        date: m.date,
        impressions: 0,
        reach: 0,
        clicks: 0,
        link_clicks: 0,
        leads: 0,
        spend: 0,
        video_views: 0,
        video_views_25_percent: 0,
        video_views_50_percent: 0,
        video_views_75_percent: 0,
        video_views_95_percent: 0,
        ctr_sum: 0,
        cpm_sum: 0,
        cpl_sum: 0,
        frequency_sum: 0,
        count: 0
      };

      existing.impressions += m.impressions || 0;
      existing.reach += m.reach || 0;
      existing.clicks += m.clicks || 0;
      existing.link_clicks += m.link_clicks || 0;
      existing.leads += m.leads || 0;
      existing.spend += parseFloat(m.spend) || 0;
      existing.video_views += m.video_views || 0;
      existing.video_views_25_percent += m.video_views_25_percent || 0;
      existing.video_views_50_percent += m.video_views_50_percent || 0;
      existing.video_views_75_percent += m.video_views_75_percent || 0;
      existing.video_views_95_percent += m.video_views_95_percent || 0;
      
      if (m.ctr) existing.ctr_sum += m.ctr;
      if (m.cpm) existing.cpm_sum += m.cpm;
      if (m.cpl) existing.cpl_sum += m.cpl;
      if (m.frequency) existing.frequency_sum += m.frequency;
      existing.count++;

      grouped.set(m.date, existing);
    });

    // Вычисляем метрики заново из суммированных значений
    return Array.from(grouped.values()).map(item => {
      // Пересчитываем CTR, CPM, CPL из суммированных значений
      const ctr = item.impressions > 0 ? (item.clicks / item.impressions) : 0;
      const cpm = item.impressions > 0 ? (item.spend / item.impressions) * 1000 : 0;
      const cpl = item.leads > 0 ? item.spend / item.leads : null;
      
      return {
        date: item.date,
        impressions: item.impressions,
        reach: item.reach,
        clicks: item.clicks,
        link_clicks: item.link_clicks,
        leads: item.leads,
        spend: item.spend,
        spend_cents: Math.round(item.spend * 100),
        ctr: ctr,  // Уже в десятичной форме (0.0117 = 1.17%)
        cpm: cpm,
        cpm_cents: Math.round(cpm * 100),
        cpl: cpl,
        cpl_cents: cpl !== null ? Math.round(cpl * 100) : null,
        frequency: item.count > 0 ? item.frequency_sum / item.count : 0,
        video_views: item.video_views,
        video_views_25_percent: item.video_views_25_percent,
        video_views_50_percent: item.video_views_50_percent,
        video_views_75_percent: item.video_views_75_percent,
        video_views_95_percent: item.video_views_95_percent
      };
    });
  }

  // Получение последнего анализа креатива из creative_analysis
  async getCreativeAnalysis(creativeId: string, userAccountId: string): Promise<{ data: any | null; error: any }> {
    try {
      const { data, error } = await (supabase as any)
        .from('creative_analysis')
        .select('*')
        .eq('creative_id', creativeId)
        .eq('user_account_id', userAccountId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      return { data: data || null, error };
    } catch (error) {
      console.error('Ошибка загрузки анализа креатива:', error);
      return { data: null, error };
    }
  }

  // Добавление продажи
  // account_id - UUID рекламного аккаунта для мультиаккаунтности (опционально)
  public async addSale(saleData: {
    client_phone: string;
    amount: number;
    user_account_id: string;
    account_id?: string; // UUID для мультиаккаунтности
    manual_source_id?: string;
    manual_creative_url?: string;
    direction_id?: string;
  }) {
    try {
      console.log('🔄 Добавляем продажу:', saleData);
      console.log('📞 Номер телефона:', saleData.client_phone);
      console.log('💰 Сумма:', saleData.amount);
      console.log('👤 User Account ID:', saleData.user_account_id);
      console.log('📋 Source ID:', saleData.manual_source_id);

      // Проверяем есть ли лид с таким номером у текущего пользователя
      const { data: existingLead, error: leadCheckError } = await (supabase as any)
        .from('leads')
        .select('id, source_id, creative_url, direction_id, user_account_id, creative_id')
        .eq('user_account_id', saleData.user_account_id)
        .eq('chat_id', saleData.client_phone)
        .single();

      console.log('🔍 Поиск лида по user_account_id:', saleData.user_account_id, 'и chat_id:', saleData.client_phone);
      console.log('🔍 Результат:', existingLead);
      console.log('🔍 Ошибка:', leadCheckError);

      if (leadCheckError && leadCheckError.code !== 'PGRST116') {
        console.error('❌ Ошибка проверки лида:', leadCheckError);
        throw leadCheckError;
      }

      // Если лид не найден
      if (!existingLead) {
        // Если НЕТ manual_creative_id - выбрасываем ошибку (первый клик)
        if (!saleData.manual_source_id) {
          console.log('⚠️ Лид не найден в базе, нужно выбрать креатив');
          throw new Error(`Клиент с номером ${saleData.client_phone} не найден в базе лидов`);
        }
        
        // Если ЕСТЬ manual_source_id - создаем лид (второй клик)
        console.log('📝 Создаем новый лид для продажи...');
        
        const leadInsertData = {
          user_account_id: saleData.user_account_id,
          account_id: saleData.account_id || null, // UUID для мультиаккаунтности
          chat_id: saleData.client_phone,
          source_id: saleData.manual_source_id,
          creative_url: saleData.manual_creative_url || '',
          direction_id: saleData.direction_id || null,
          created_at: new Date().toISOString()
        };
        
        console.log('🔍 Данные для вставки лида:', leadInsertData);
        
        const { data: newLead, error: leadError } = await (supabase as any)
          .from('leads')
          .insert(leadInsertData)
          .select()
          .single();

        if (leadError) {
          console.error('❌ Ошибка создания лида:', leadError);
          throw leadError;
        }

        console.log('✅ Лид создан:', newLead);
      }

      // Добавляем продажу в таблицу purchases
      const purchaseInsertData = {
        user_account_id: saleData.user_account_id,
        account_id: saleData.account_id || null, // UUID для мультиаккаунтности
        client_phone: saleData.client_phone,
        amount: saleData.amount
      };

      console.log('🔍 Данные для вставки продажи:', purchaseInsertData);

      const { data: purchaseData, error: purchaseError } = await (supabase as any)
        .from('purchases')
        .insert(purchaseInsertData)
        .select()
        .single();

      if (purchaseError) {
        console.error('❌ Ошибка добавления продажи:', purchaseError);
        throw purchaseError;
      }

      console.log('✅ Продажа успешно добавлена:', purchaseData);

      // Обновляем sale_amount в соответствующем лиде
      await this.updateLeadSaleAmount(saleData.client_phone, saleData.user_account_id);

      return { success: true, data: purchaseData };

    } catch (error) {
      console.error('❌ Ошибка в addSale:', error);
      throw error;
    }
  }

  // Добавление продажи с выбранным креативом (когда лид не найден)
  // account_id - UUID рекламного аккаунта для мультиаккаунтности (опционально)
  public async addSaleWithCreative(saleData: {
    client_phone: string;
    amount: number;
    user_account_id: string;
    account_id?: string; // UUID для мультиаккаунтности
    creative_id: string;
    creative_url?: string;
    direction_id?: string;
  }) {
    try {
      console.log('🔄 Добавляем продажу с креативом:', saleData);

      // Создаём новый лид с привязкой к креативу
      const leadInsertData = {
        user_account_id: saleData.user_account_id,
        account_id: saleData.account_id || null, // UUID для мультиаккаунтности
        chat_id: saleData.client_phone,
        creative_id: saleData.creative_id,
        creative_url: saleData.creative_url || '',
        direction_id: saleData.direction_id || null,
        source_type: 'manual',
        created_at: new Date().toISOString()
      };

      console.log('📝 Создаём лид:', leadInsertData);

      const { data: newLead, error: leadError } = await (supabase as any)
        .from('leads')
        .insert(leadInsertData)
        .select()
        .single();

      if (leadError) {
        console.error('❌ Ошибка создания лида:', leadError);
        throw leadError;
      }

      console.log('✅ Лид создан:', newLead);

      // Добавляем продажу
      const purchaseInsertData = {
        user_account_id: saleData.user_account_id,
        account_id: saleData.account_id || null, // UUID для мультиаккаунтности
        client_phone: saleData.client_phone,
        amount: saleData.amount
      };

      const { data: purchaseData, error: purchaseError } = await (supabase as any)
        .from('purchases')
        .insert(purchaseInsertData)
        .select()
        .single();

      if (purchaseError) {
        console.error('❌ Ошибка добавления продажи:', purchaseError);
        throw purchaseError;
      }

      console.log('✅ Продажа добавлена:', purchaseData);

      // Обновляем sale_amount в лиде
      await this.updateLeadSaleAmount(saleData.client_phone, saleData.user_account_id);

      return { success: true, data: purchaseData };

    } catch (error) {
      console.error('❌ Ошибка в addSaleWithCreative:', error);
      throw error;
    }
  }
  // Получение лидов для ROI Analytics с возможностью фильтрации по направлению
  // accountId - UUID рекламного аккаунта для мультиаккаунтности (опционально)
  async getLeadsForROI(
    userAccountId: string,
    directionId: string | null,
    accountId?: string
  ): Promise<{ data: any[]; error: any }> {
    try {
      // Шаг 1: Получаем лиды
      let query = (supabase as any)
        .from('leads')
        .select(`
          id,
          chat_id,
          creative_id,
          direction_id,
          needs_manual_match,
          sale_amount,
          created_at
        `)
        .eq('user_account_id', userAccountId)
        .order('created_at', { ascending: false })
        .limit(10000);

      // Фильтрация по account_id для мультиаккаунтности
      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      if (directionId) {
        query = query.eq('direction_id', directionId);
      }

      const { data: leads, error } = await query;

      if (error) {
        console.error('Ошибка загрузки лидов:', error);
        return { data: [], error };
      }

      if (!leads || leads.length === 0) {
        return { data: [], error: null };
      }

      // Шаг 2: Собираем уникальные ID креативов и направлений
      const creativeIdsArray: string[] = [];
      const directionIdsArray: string[] = [];

      leads.forEach((lead: any) => {
        if (lead.creative_id && !creativeIdsArray.includes(lead.creative_id)) {
          creativeIdsArray.push(lead.creative_id);
        }
        if (lead.direction_id && !directionIdsArray.includes(lead.direction_id)) {
          directionIdsArray.push(lead.direction_id);
        }
      });

      // Шаг 3: Загружаем креативы
      const creativesMap: Record<string, string> = {};
      if (creativeIdsArray.length > 0) {
        const { data: creatives } = await (supabase as any)
          .from('user_creatives')
          .select('id, title')
          .in('id', creativeIdsArray);

        if (creatives) {
          creatives.forEach((c: any) => {
            creativesMap[c.id] = c.title;
          });
        }
      }

      // Шаг 4: Загружаем направления через API (RLS блокирует прямой доступ к account_directions)
      const directionsMap: Record<string, string> = {};
      if (directionIdsArray.length > 0) {
        try {
          const response = await fetch(`${API_BASE_URL}/directions?userAccountId=${userAccountId}`);
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.directions) {
              data.directions.forEach((d: any) => {
                if (directionIdsArray.includes(d.id)) {
                  directionsMap[d.id] = d.name;
                }
              });
            }
          }
        } catch (e) {
          console.error('Ошибка загрузки направлений:', e);
        }
      }

      // Шаг 5: Трансформируем данные
      const transformedData = leads.map((lead: any) => ({
        id: lead.id,
        chat_id: lead.chat_id,
        creative_id: lead.creative_id,
        creative_name: lead.creative_id ? creativesMap[lead.creative_id] || null : null,
        direction_id: lead.direction_id,
        direction_name: lead.direction_id ? directionsMap[lead.direction_id] || null : null,
        needs_manual_match: lead.needs_manual_match || false,
        sale_amount: lead.sale_amount,
        created_at: lead.created_at
      }));

      return { data: transformedData, error: null };
    } catch (error) {
      console.error('Ошибка в getLeadsForROI:', error);
      return { data: [], error };
    }
  }

  // Получение креативов для выбора при ручной привязке
  async getCreativesForAssignment(
    userAccountId: string,
    directionId: string | null
  ): Promise<{ data: any[]; error: any }> {
    try {
      let query = (supabase as any)
        .from('user_creatives')
        .select(`
          id,
          title,
          media_type,
          direction_id,
          account_directions!left(name)
        `)
        .eq('user_id', userAccountId)
        .order('created_at', { ascending: false });

      // Если указано направление, фильтруем по нему
      if (directionId) {
        query = query.eq('direction_id', directionId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Ошибка загрузки креативов:', error);
        return { data: [], error };
      }

      // Трансформируем данные
      const transformedData = (data || []).map((creative: any) => ({
        id: creative.id,
        title: creative.title || `Креатив ${creative.id.substring(0, 8)}`,
        media_type: creative.media_type || 'video',
        direction_name: creative.account_directions?.name || null
      }));

      return { data: transformedData, error: null };
    } catch (error) {
      console.error('Ошибка в getCreativesForAssignment:', error);
      return { data: [], error };
    }
  }

  // Привязка креатива к лиду
  async assignCreativeToLead(
    leadId: string,
    creativeId: string
  ): Promise<{ data: any; error: any }> {
    try {
      const { data, error } = await (supabase as any)
        .from('leads')
        .update({
          creative_id: creativeId,
          needs_manual_match: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', leadId)
        .select()
        .single();

      if (error) {
        console.error('Ошибка привязки креатива:', error);
        return { data: null, error };
      }

      console.log('✅ Креатив привязан к лиду:', data);
      return { data, error: null };
    } catch (error) {
      console.error('Ошибка в assignCreativeToLead:', error);
      return { data: null, error };
    }
  }
}

export const salesApi = new SalesApiService(); 