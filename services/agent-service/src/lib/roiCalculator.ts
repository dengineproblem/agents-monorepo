/**
 * ROI Calculator - Расчет окупаемости креативов
 * 
 * Загружает данные о лидах, продажах и затратах креативов
 * для расчета реального ROI по каждому креативу
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const FB_API_VERSION = 'v18.0';
const USD_TO_KZT_RATE = 500; // Курс доллара к тенге

export interface CreativeROIData {
  revenue: number;      // Выручка (сумма продаж) в тенге
  spend: number;        // Затраты в тенге
  roi: number;          // ROI в процентах: ((revenue - spend) / spend) * 100
  conversions: number;  // Количество продаж
  leads: number;        // Количество лидов
}

/**
 * Получить затраты объявления из Facebook API
 */
async function getAdSpend(
  accessToken: string,
  adId: string,
  datePreset: 'last_7d' | 'last_30d' | 'last_90d' = 'last_30d'
): Promise<number> {
  try {
    // Validate Ad ID format - must be all digits
    if (!/^\d+$/.test(adId)) {
      return 0;
    }

    const baseUrl = `https://graph.facebook.com/${FB_API_VERSION}`;
    const url = new URL(`${baseUrl}/${adId}/insights`);
    url.searchParams.append('access_token', accessToken);
    
    // Используем кастомный диапазон дат
    const timeRanges: { [key: string]: number } = {
      'last_7d': 7,
      'last_30d': 30,
      'last_90d': 90
    };
    
    const daysBack = timeRanges[datePreset];
    const since = new Date();
    since.setDate(since.getDate() - daysBack);
    const sinceStr = since.toISOString().split('T')[0]; // YYYY-MM-DD
    const untilStr = new Date().toISOString().split('T')[0];
    
    url.searchParams.append('time_range', JSON.stringify({
      since: sinceStr,
      until: untilStr
    }));
    url.searchParams.append('fields', 'spend');

    const response = await fetch(url.toString());
    
    if (!response.ok) {
      return 0;
    }

    const data = await response.json();
    const spend = data.data?.[0]?.spend || 0;
    return parseFloat(spend);
    
  } catch (error) {
    return 0;
  }
}

/**
 * Рассчитать ROI по каждому креативу
 * 
 * @param userAccountId - UUID пользователя
 * @param directionId - UUID направления (опционально)
 * @param timeframeDays - Период для анализа (по умолчанию 30 дней)
 * @param supabase - Supabase клиент (опционально, создается автоматически)
 * @returns Map<creative_id, CreativeROIData>
 */
export async function calculateCreativeROI(
  userAccountId: string,
  directionId?: string | null,
  timeframeDays: 7 | 30 | 90 | 'all' = 30,
  supabase?: SupabaseClient
): Promise<Map<string, CreativeROIData>> {
  
  const supabaseClient = supabase || createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE!
  );

  try {
    // Определяем временной диапазон
    const since = (() => {
      if (timeframeDays === 'all') return null;
      const d = new Date();
      d.setDate(d.getDate() - timeframeDays);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    })();

    // 1. Загружаем лиды с фильтрацией
    let leadsQuery = supabaseClient
      .from('leads')
      .select('id, chat_id, sale_amount, source_id, creative_id, created_at, direction_id')
      .eq('user_account_id', userAccountId);
    
    if (directionId) {
      leadsQuery = leadsQuery.eq('direction_id', directionId);
    }
    
    if (since) {
      leadsQuery = leadsQuery.gte('created_at', since);
    }
    
    const { data: leadsStats, error: leadsError } = await leadsQuery;

    if (leadsError) {
      console.error('[ROI Calculator] Error loading leads:', leadsError);
      throw leadsError;
    }

    if (!leadsStats || leadsStats.length === 0) {
      return new Map(); // Нет лидов - нет ROI данных
    }

    // 2. Загружаем продажи через JOIN с leads (по client_phone)
    const leadPhones = leadsStats.map(l => l.chat_id).filter(Boolean);
    
    let purchasesQuery = supabaseClient
      .from('purchases')
      .select('id, client_phone, amount, created_at')
      .eq('user_account_id', userAccountId)
      .in('client_phone', leadPhones.length > 0 ? leadPhones : ['__no_match__']);
    
    if (since) {
      purchasesQuery = purchasesQuery.gte('created_at', since);
    }
    
    const { data: purchasesStats, error: purchasesError } = await purchasesQuery;

    if (purchasesError) {
      console.error('[ROI Calculator] Error loading purchases:', purchasesError);
      throw purchasesError;
    }

    // 3. Получаем access_token для Facebook API
    const { data: userData, error: userError } = await supabaseClient
      .from('user_accounts')
      .select('access_token, ad_account_id')
      .eq('id', userAccountId)
      .single();

    const fbAccessToken = userData?.access_token || null;
    const fbAdAccountId = userData?.ad_account_id || null;

    if (!fbAccessToken) {
      console.warn('[ROI Calculator] No Facebook access token found, using 30% spend formula');
    }

    // 4. Группируем данные по creative_id
    const creativeMap = new Map<string, {
      revenue: number;
      leads: number;
      conversions: number;
      sourceIds: Set<string>; // Все source_id (ad_id) для этого креатива
    }>();

    // Обрабатываем каждый лид
    for (const lead of leadsStats) {
      const creativeId = lead.creative_id || 'unknown_creative';
      const revenue = Number(lead.sale_amount) || 0;
      
      // Находим все продажи для этого лида
      const leadPurchases = purchasesStats?.filter(p => p.client_phone === lead.chat_id) || [];
      const purchaseCount = leadPurchases.length;
      const hasConversion = revenue > 0;

      if (!creativeMap.has(creativeId)) {
        creativeMap.set(creativeId, {
          revenue: 0,
          leads: 0,
          conversions: 0,
          sourceIds: new Set()
        });
      }

      const creative = creativeMap.get(creativeId)!;
      creative.leads++;
      creative.revenue += revenue;
      if (hasConversion) {
        creative.conversions += purchaseCount;
      }
      
      // Собираем source_id для расчета затрат
      if (lead.source_id) {
        creative.sourceIds.add(lead.source_id);
      }
    }

    // 5. Рассчитываем затраты для каждого креатива
    const resultMap = new Map<string, CreativeROIData>();
    
    // Определяем date preset для Facebook API
    const datePreset: 'last_7d' | 'last_30d' | 'last_90d' =
      timeframeDays === 7 ? 'last_7d' : timeframeDays === 30 ? 'last_30d' : 'last_90d';

    // Обрабатываем каждый креатив
    const creativeEntries = Array.from(creativeMap.entries());
    
    for (const [creativeId, data] of creativeEntries) {
      let spendInKzt = 0;
      
      // Собираем затраты со всех source_id (объявлений)
      if (data.sourceIds.size > 0 && fbAccessToken) {
        const sourceIdsArray = Array.from(data.sourceIds);
        for (const sourceId of sourceIdsArray) {
          try {
            const spendInUsd = await getAdSpend(fbAccessToken, sourceId, datePreset);
            spendInKzt += Math.round(spendInUsd * USD_TO_KZT_RATE);
          } catch (error) {
            console.error(`[ROI Calculator] Error getting spend for ad ${sourceId}:`, error);
          }
        }
        
        // Если не удалось получить затраты, используем формулу
        if (spendInKzt === 0) {
          spendInKzt = Math.round(data.revenue * 0.3);
        }
      } else {
        // Нет source_id или нет доступа к Facebook API - используем формулу
        spendInKzt = Math.round(data.revenue * 0.3);
      }
      
      const roi = spendInKzt > 0 
        ? Math.round(((data.revenue - spendInKzt) / spendInKzt) * 100) 
        : 0;
      
      resultMap.set(creativeId, {
        revenue: data.revenue,
        spend: spendInKzt,
        roi,
        conversions: data.conversions,
        leads: data.leads
      });
    }

    console.log(`[ROI Calculator] Calculated ROI for ${resultMap.size} creatives`);
    return resultMap;

  } catch (error) {
    console.error('[ROI Calculator] Error calculating ROI:', error);
    throw error;
  }
}

