import { supabase } from '@/integrations/supabase/client';
import { API_BASE_URL } from '@/config/api';
import { shouldFilterByAccountId } from '@/utils/multiAccountHelper';
import { userProfileApi } from '@/services/userProfileApi';

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
  // CAPI события (Meta Conversions API)
  capi_events?: {
    interest: number;    // Level 1 - Lead event (клиент отправил 3+ сообщений)
    qualified: number;   // Level 2 - CompleteRegistration (прошёл квалификацию)
    scheduled: number;   // Level 3 - Schedule (записался на ключевой этап)
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

      // Фильтр по account_id ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
      if (shouldFilterByAccountId(accountId)) {
        purchasesQuery = purchasesQuery.eq('account_id', accountId);
      }

      const { data: purchases, error } = await purchasesQuery;

      if (error || !purchases || purchases.length === 0) {
        return { data: purchases || [], error };
      }

      // Получаем уникальные телефоны для поиска связанных лидов
      const phones = [...new Set(purchases.map((p: any) => p.client_phone))];

      // Генерируем все возможные форматы для поиска по chat_id и phone
      const chatIdCandidates: string[] = [];
      const phoneCandidates: string[] = [];
      for (const phone of phones) {
        const digits = phone.replace(/\D/g, '');
        chatIdCandidates.push(digits, `${digits}@s.whatsapp.net`, `${digits}@c.us`);
        phoneCandidates.push(digits, `+${digits}`);
      }

      // Загружаем лиды с creative_id — ищем по обеим колонкам (chat_id и phone)
      const { data: leads } = await (supabase as any)
        .from('leads')
        .select('chat_id, phone, creative_id')
        .eq('user_account_id', userAccountId)
        .or(`chat_id.in.(${chatIdCandidates.join(',')}),phone.in.(${phoneCandidates.join(',')})`)
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

      // Создаём map: нормализованный телефон -> creative_id
      const phoneToCreativeId = new Map<string, string>();
      for (const lead of leads) {
        // Нормализуем chat_id или phone к цифрам для сопоставления с client_phone
        const leadPhone = (lead.chat_id || lead.phone || '').replace(/@.*$/, '').replace(/\D/g, '');
        if (leadPhone && lead.creative_id) {
          phoneToCreativeId.set(leadPhone, lead.creative_id);
        }
      }
      const creativeIdToTitle = new Map(creatives?.map((c: any) => [c.id, c.title]) || []);

      // Добавляем название креатива к каждой продаже
      const enrichedPurchases = purchases.map((p: any) => {
        const normalizedPhone = (p.client_phone || '').replace(/\D/g, '');
        const creativeId = phoneToCreativeId.get(normalizedPhone);
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
  async getDirections(
    userAccountId: string,
    platform?: 'facebook' | 'tiktok',
    accountId?: string // UUID из ad_accounts.id для мультиаккаунтности
  ): Promise<{ data: Direction[]; error: any }> {
    try {
      const params = new URLSearchParams({ userAccountId });
      if (platform) {
        params.append('platform', platform);
      }
      if (accountId) {
        params.append('accountId', accountId);
      }
      const response = await fetch(`${API_BASE_URL}/directions?${params.toString()}`);
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

  // Функция для получения затрат по конкретному объявлению (через proxy)
  private async getAdSpend(userAccountId: string, adId: string, datePreset: 'last_7d' | 'last_30d' | 'last_90d'): Promise<number> {
    try {
      if (!/^\d+$/.test(adId)) {
        console.warn(`⚠️ Невалидный формат Ad ID: "${adId}". Пропускаем запрос.`);
        return 0;
      }

      const timeRanges: { [key: string]: number } = { 'last_7d': 7, 'last_30d': 30, 'last_90d': 90 };
      const daysBack = timeRanges[datePreset];
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const sinceStr = since.toISOString().split('T')[0];
      const untilStr = new Date().toISOString().split('T')[0];

      const response = await fetch(`${API_BASE_URL}/fb-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userAccountId },
        body: JSON.stringify({
          path: `${adId}/insights`,
          params: {
            time_range: JSON.stringify({ since: sinceStr, until: untilStr }),
            fields: 'spend',
          },
          method: 'GET',
        }),
      });

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

  // Функция для получения ID кампании по ID объявления (через proxy)
  private async getCampaignIdByAdId(userAccountId: string, adId: string): Promise<string | null> {
    try {
      if (!/^\d+$/.test(adId)) {
        console.warn(`⚠️ Невалидный формат Ad ID: "${adId}". Пропускаем запрос.`);
        return null;
      }

      const response = await fetch(`${API_BASE_URL}/fb-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userAccountId },
        body: JSON.stringify({
          path: adId,
          params: { fields: 'campaign_id' },
          method: 'GET',
        }),
      });

      if (!response.ok) {
        console.log(`⚠️ Не удалось получить campaign_id для объявления ${adId}`);
        return null;
      }

      const data = await response.json();
      return data.campaign_id || null;
    } catch (error) {
      console.error(`❌ Ошибка получения campaign_id для объявления ${adId}:`, error);
      return null;
    }
  }

  // Функция для получения данных кампаний из Facebook API (через proxy)
  private async getFacebookCampaignsData(userAccountId: string, adAccountId: string): Promise<Map<string, { name: string; spend: number }>> {
    const campaignsMap = new Map<string, { name: string; spend: number }>();

    try {
      console.log('🔄 Загружаем данные кампаний из Facebook API...');

      const response = await fetch(`${API_BASE_URL}/fb-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userAccountId },
        body: JSON.stringify({
          path: adAccountId,
          params: {
            fields: 'campaigns{id,name,adsets.limit(1){id,name,ads.limit(1){id,name,insights.date_preset(maximum){spend}}}}',
          },
          method: 'GET',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Facebook API error:', response.status, errorText);
        return campaignsMap;
      }

      const data = await response.json();
      
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
    accountId?: string,
    platform?: 'instagram' | 'tiktok'
  ): Promise<ROIData> {
    try {
      console.log('🔄 Загружаем ROI данные для user_account_id:', userAccountId, 'direction:', directionId || 'все');
      const effectivePlatform = platform || 'instagram';

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

      // Фильтр по account_id ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
      if (shouldFilterByAccountId(accountId)) {
        creativesQuery = creativesQuery.eq('account_id', accountId);
      }

      // Фильтр по платформе
      if (effectivePlatform === 'tiktok') {
        creativesQuery = creativesQuery.not('tiktok_video_id', 'is', null);
      } else {
        creativesQuery = creativesQuery.is('tiktok_video_id', null);
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
      const metricsSource = effectivePlatform === 'tiktok' ? 'tiktok_batch' : 'production';
      let metricsQuery = (supabase as any)
        .from('creative_metrics_history')
        .select('user_creative_id, impressions, reach, clicks, leads, spend, date')
        .in('user_creative_id', creativeIds)
        .eq('user_account_id', userAccountId)
        .eq('source', metricsSource);

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
        .select('id, chat_id, phone, creative_id, direction_id, is_qualified')
        .eq('user_account_id', userAccountId)
        .in('creative_id', creativeIds);

      // Фильтр по account_id ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
      if (shouldFilterByAccountId(accountId)) {
        // Проверяем что account_id принадлежит userAccountId (security check)
        // Verify account ownership via backend API
        const ownershipResp = await fetch(`${API_BASE_URL}/ad-accounts/${userAccountId}/${accountId}`).catch(() => null);
        const accountOwnership = ownershipResp?.ok ? await ownershipResp.json() : null;

        if (!accountOwnership) {
          console.error('Account ownership check failed in getROIData:', {
            accountId,
            userAccountId,
            error: ownershipError
          });
          // НЕ применяем фильтр по account_id если проверка failed
          // Возвращаем пустой результат для безопасности
          return [];
        }

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
      // Нормализуем телефоны лидов к цифрам (purchases.client_phone хранит цифры)
      const leadPhoneDigits = new Set<string>();
      for (const lead of leadsData || []) {
        const phone = (lead.chat_id || lead.phone || '').replace(/@.*$/, '').replace(/\D/g, '');
        if (phone) leadPhoneDigits.add(phone);
      }
      const leadPhones = [...leadPhoneDigits];

      let purchasesQuery = (supabase as any)
        .from('purchases')
        .select('id, client_phone, amount, created_at')
        .eq('user_account_id', userAccountId);

      // Фильтр по account_id ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
      if (shouldFilterByAccountId(accountId)) {
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

      // ШАГ 4.5: Загружаем CAPI события для расчёта конверсий
      // Создаём маппинг lead_id → creative_id
      const leadIdToCreativeId = new Map<number, string>();
      const phoneToCreativeId = new Map<string, string>();
      for (const lead of leadsData || []) {
        if (lead.id && lead.creative_id) {
          leadIdToCreativeId.set(lead.id, lead.creative_id);
        }
        // Нормализуем телефон к цифрам для сопоставления
        const normalizedPhone = (lead.chat_id || lead.phone || '').replace(/@.*$/, '').replace(/\D/g, '');
        if (normalizedPhone && lead.creative_id) {
          phoneToCreativeId.set(normalizedPhone, lead.creative_id);
        }
      }

      // Загружаем CAPI события
      let capiQuery = (supabase as any)
        .from('capi_events_log')
        .select('lead_id, contact_phone, event_level, capi_status')
        .eq('user_account_id', userAccountId)
        .eq('capi_status', 'success'); // Только успешные события

      if (directionId) {
        capiQuery = capiQuery.eq('direction_id', directionId);
      }

      if (since) {
        capiQuery = capiQuery.gte('created_at', since + 'T00:00:00.000Z');
      }

      const { data: capiEventsData, error: capiError } = await capiQuery;

      if (capiError) {
        console.error('Ошибка загрузки CAPI событий:', capiError);
      }

      console.log('📊 Загружено CAPI событий:', capiEventsData?.length || 0);

      // Агрегируем CAPI события по creative_id
      const capiByCreative = new Map<string, { interest: number; qualified: number; scheduled: number }>();
      for (const event of capiEventsData || []) {
        let creativeId: string | undefined;

        // Сначала пробуем связать через lead_id
        if (event.lead_id && leadIdToCreativeId.has(event.lead_id)) {
          creativeId = leadIdToCreativeId.get(event.lead_id);
        }
        // Если нет lead_id, пробуем через contact_phone (нормализуем к цифрам)
        else if (event.contact_phone) {
          const normalizedEventPhone = event.contact_phone.replace(/@.*$/, '').replace(/\D/g, '');
          if (phoneToCreativeId.has(normalizedEventPhone)) {
            creativeId = phoneToCreativeId.get(normalizedEventPhone);
          }
        }

        if (!creativeId) continue;

        if (!capiByCreative.has(creativeId)) {
          capiByCreative.set(creativeId, { interest: 0, qualified: 0, scheduled: 0 });
        }
        const capi = capiByCreative.get(creativeId)!;

        // event_level: 1=interest, 2=qualified, 3=scheduled
        if (event.event_level === 1) capi.interest++;
        else if (event.event_level === 2) capi.qualified++;
        else if (event.event_level === 3) capi.scheduled++;
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

        // Нормализуем телефон лида к цифрам для сопоставления с purchases.client_phone
        const leadPhone = (lead.chat_id || lead.phone || '').replace(/@.*$/, '').replace(/\D/g, '');
        const purchaseData = purchasesByPhone.get(leadPhone);
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
        const spend = effectivePlatform === 'tiktok'
          ? Math.round(metrics.spend)
          : Math.round(metrics.spend * usdToKztRate); // spend в USD -> KZT
        const revenue = revenueData.revenue;
        const conversions = revenueData.conversions;

        // ROI расчёт
        const roi = spend > 0 ? Math.round(((revenue - spend) / spend) * 100) : 0;

        // Определяем URL креатива в зависимости от типа
        let creativeUrl = '';
        if (effectivePlatform === 'tiktok') {
          creativeUrl = creative.thumbnail_url || creative.image_url || '';
        } else if (creative.media_type === 'video' && creative.fb_video_id) {
          // Для видео - ссылка на Facebook видео
          creativeUrl = `https://www.facebook.com/watch/?v=${creative.fb_video_id}`;
        } else if (creative.media_type === 'image' && creative.image_url) {
          creativeUrl = creative.image_url;
        } else if (creative.media_type === 'carousel' && creative.carousel_data?.length > 0) {
          // Берём первую картинку карусели
          const firstCard = creative.carousel_data[0];
          creativeUrl = firstCard?.image_url_4k || firstCard?.image_url || '';
        }

        // CAPI события для этого креатива
        const capiData = capiByCreative.get(creativeId);

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
          // CAPI события (Meta Conversions API)
          capi_events: capiData ? {
            interest: capiData.interest,
            qualified: capiData.qualified,
            scheduled: capiData.scheduled
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
        const userData = await userProfileApi.fetchProfile(userAccountId).catch(() => null);

        if (userData?.ad_account_id) {
          console.log('✅ Загружаем реальные названия кампаний из Facebook API...');
          const facebookCampaigns = await this.getFacebookCampaignsData(userAccountId, userData.ad_account_id);

          // Обновляем названия кампаний
          for (const [sourceId, campaignInfo] of uniqueCampaigns) {
            try {
              const campaignId = await this.getCampaignIdByAdId(userAccountId, sourceId);
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

      // Лиды хранят телефон в chat_id (WhatsApp) или phone (сайт)
      const digits = clientPhone.replace(/\D/g, '');
      const chatIdCandidates = [
        digits,
        `${digits}@s.whatsapp.net`,
        `${digits}@c.us`,
      ];
      const phoneCandidates = [
        digits,
        `+${digits}`,
      ];

      // Обновляем sale_amount в лиде (ищем по обеим колонкам)
      const { error: updateError } = await (supabase as any)
        .from('leads')
        .update({
          sale_amount: totalAmount,
          updated_at: new Date().toISOString()
        })
        .eq('user_account_id', userAccountId)
        .or(`chat_id.in.(${chatIdCandidates.join(',')}),phone.in.(${phoneCandidates.join(',')})`);

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
  async getCreativeMetrics(creativeId: string, userAccountId: string, limit: number = 30, platform?: 'instagram' | 'tiktok'): Promise<{ data: any[]; error: any }> {
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

      const creativeMetricsSource = platform === 'tiktok' ? 'tiktok_batch' : 'production';
      const { data, error } = await (supabase as any)
        .from('creative_metrics_history')
        .select('*')
        .in('ad_id', adIds)
        .eq('user_account_id', userAccountId)
        .eq('source', creativeMetricsSource)
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
      // Лиды хранят телефон в двух колонках:
      //   chat_id — WhatsApp формат: '77029992936@s.whatsapp.net', '77029992936@c.us', или просто цифры
      //   phone  — сайтовые лиды: '+77029992936', '77029992936', '+7 702 999 29 36' и т.д.
      const digits = saleData.client_phone.replace(/\D/g, '');
      const chatIdCandidates = [
        digits,
        `${digits}@s.whatsapp.net`,
        `${digits}@c.us`,
      ];
      const phoneCandidates = [
        digits,
        `+${digits}`,
      ];

      // Ищем по обеим колонкам: chat_id (WhatsApp лиды) и phone (сайтовые лиды)
      const { data: existingLeads, error: leadCheckError } = await (supabase as any)
        .from('leads')
        .select('id, source_id, creative_url, direction_id, user_account_id, creative_id')
        .eq('user_account_id', saleData.user_account_id)
        .or(`chat_id.in.(${chatIdCandidates.join(',')}),phone.in.(${phoneCandidates.join(',')})`)
        .order('updated_at', { ascending: false })
        .limit(1);

      const existingLead = existingLeads?.[0] || null;

      console.log('🔍 Поиск лида по user_account_id:', saleData.user_account_id);
      console.log('🔍 chat_id candidates:', chatIdCandidates, 'phone candidates:', phoneCandidates);
      console.log('🔍 Результат:', existingLead);
      console.log('🔍 Ошибка:', leadCheckError);

      if (leadCheckError) {
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
          phone,
          creative_id,
          direction_id,
          needs_manual_match,
          sale_amount,
          created_at
        `)
        .eq('user_account_id', userAccountId)
        .order('created_at', { ascending: false })
        .limit(10000);

      // Фильтр по account_id ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
      if (shouldFilterByAccountId(accountId)) {
        // Проверяем что account_id принадлежит userAccountId (security check)
        // Verify account ownership via backend API
        const ownershipResp = await fetch(`${API_BASE_URL}/ad-accounts/${userAccountId}/${accountId}`).catch(() => null);
        const accountOwnership = ownershipResp?.ok ? await ownershipResp.json() : null;

        if (!accountOwnership) {
          console.error('Account ownership check failed:', {
            accountId,
            userAccountId,
            error: ownershipError
          });
          // НЕ применяем фильтр по account_id если проверка failed
          // Возвращаем пустой результат для безопасности
          return { data: [], error: null };
        }

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
        phone: lead.phone,
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
