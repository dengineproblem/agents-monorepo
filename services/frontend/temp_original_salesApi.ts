import { supabase } from '@/integrations/supabase/client';

export interface SaleData {
  client_phone: string;
  amount: number;
  business_id: string;
  created_at?: string;
  // Поля для ручного указания существующей кампании
  manual_source_id?: string;
  manual_campaign_name?: string;
  manual_creative_url?: string;
}

export interface ROIData {
  totalRevenue: number;
  totalSpend: number;
  totalROI: number;
  totalLeads: number;
  totalConversions: number;
  campaigns: CampaignROI[];
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
}

class SalesApiService {
  // Функция для получения затрат по конкретному объявлению
  private async getAdSpend(accessToken: string, adId: string): Promise<number> {
    try {
      const baseUrl = 'https://graph.facebook.com/v18.0';
      const url = new URL(`${baseUrl}/${adId}/insights`);
      url.searchParams.append('access_token', accessToken);
      url.searchParams.append('date_preset', 'maximum');
      url.searchParams.append('fields', 'spend');

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        console.log(`⚠️ Не удалось получить затраты для объявления ${adId}`);
        return 0;
      }

      const data = await response.json();
      const spend = data.data?.[0]?.spend || 0;
      console.log(`💰 Объявление ${adId}: затраты $${spend}`);
      return parseFloat(spend);
      
    } catch (error) {
      console.error(`❌ Ошибка получения затрат для объявления ${adId}:`, error);
      return 0;
    }
  }

  // Функция для получения ID кампании по ID объявления
  private async getCampaignIdByAdId(accessToken: string, adId: string): Promise<string | null> {
    try {
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
  private async getFacebookCampaignsData(accessToken: string): Promise<Map<string, { name: string; spend: number }>> {
    const campaignsMap = new Map<string, { name: string; spend: number }>();
    const accountId = 'act_440729139081648';
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

  // Получение списка существующих кампаний для выбора
  async getExistingCampaigns(businessId: string): Promise<Array<{id: string, name: string, creative_url?: string}>> {
    try {
      console.log('🔄 Загружаем существующие кампании для business_id:', businessId);

      // Получаем уникальные source_id из таблицы leads
      const { data: campaignsData, error: campaignsError } = await (supabase as any)
        .from('leads')
        .select('source_id, creative_url')
        .eq('business_id', businessId)
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
          .select('access_token')
          .eq('business_id', businessId)
          .single();

        if (!userError && userData?.access_token) {
          console.log('✅ Загружаем реальные названия кампаний из Facebook API...');
          const facebookCampaigns = await this.getFacebookCampaignsData(userData.access_token);
          
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

  // Добавление продажи
  async addSale(saleData: SaleData): Promise<any> {
    try {
      console.log('🔄 Добавляем продажу в purchases:', saleData);
      console.log('📋 Business ID:', saleData.business_id);
      console.log('📞 Номер телефона:', saleData.client_phone);
      console.log('💰 Сумма:', saleData.amount);
      
      // Проверяем, существует ли лид с таким номером телефона
      const { data: existingLead, error: leadCheckError } = await (supabase as any)
        .from('leads')
        .select('id, chat_id, business_id')
        .eq('chat_id', saleData.client_phone)
        .eq('business_id', saleData.business_id)
        .maybeSingle();

      if (leadCheckError) {
        console.error('❌ Ошибка проверки существующего лида:', leadCheckError);
        throw new Error('Ошибка проверки лида в базе данных');
      }

      console.log('📋 Проверка лида:', existingLead ? 'Найден' : 'Не найден', existingLead);
      
      // Если лид не найден, проверяем есть ли данные для ручного создания лида
      if (!existingLead) {
        if (saleData.manual_source_id || saleData.manual_campaign_name) {
          console.log('📝 Лид не найден, создаем новый лид с указанной кампанией...');
          
          // Создаем новый лид с указанной кампанией
          const newLeadData = {
            business_id: saleData.business_id,
            chat_id: saleData.client_phone,
            source_id: saleData.manual_source_id || 'manual_created',
            conversion_source: saleData.manual_campaign_name || 'Ручное создание',
            creative_url: saleData.manual_creative_url || '',
            sale_amount: 0, // Будет обновлено после добавления продажи
            created_at: new Date().toISOString()
          };
          
          const { data: newLead, error: newLeadError } = await (supabase as any)
            .from('leads')
            .insert([newLeadData])
            .select()
            .single();
            
          if (newLeadError) {
            console.error('❌ Ошибка создания нового лида:', newLeadError);
            throw new Error(`Ошибка создания лида: ${newLeadError.message}`);
          }
          
          console.log('✅ Новый лид создан:', newLead);
        } else {
          throw new Error('Клиент с номером телефона не найден в базе лидов. Укажите кампанию для создания нового лида.');
        }
      }
      
      // Добавляем запись в purchases (приводим к any для обхода типов)
      const insertData = {
        business_id: saleData.business_id,
        client_phone: saleData.client_phone,
        amount: saleData.amount
      };
      
      console.log('📝 Данные для вставки в purchases:', insertData);
      
      const { data: purchase, error: purchaseError } = await (supabase as any)
        .from('purchases')
        .insert([insertData])
        .select()
        .single();

      if (purchaseError) {
        console.error('❌ Ошибка добавления в purchases:', purchaseError);
        console.error('❌ Детали ошибки:', JSON.stringify(purchaseError, null, 2));
        
        // Специфичные ошибки
        if (purchaseError.code === '23503') {
          throw new Error('Лид с таким номером телефона не найден в системе');
        } else if (purchaseError.code === '23505') {
          throw new Error('Продажа для этого клиента уже существует');
        } else {
          throw new Error(`Ошибка базы данных: ${purchaseError.message}`);
        }
      }

      console.log('✅ Продажа добавлена в purchases:', purchase);
      
      // Принудительно обновляем leads после добавления продажи
      console.log('🔄 Обновляем leads после добавления продажи...');
      
      // Сначала проверяем, есть ли лид с таким номером
      const { data: existingLeadAfter, error: leadAfterError } = await (supabase as any)
        .from('leads')
        .select('id, sale_amount')
        .eq('chat_id', saleData.client_phone)
        .eq('business_id', saleData.business_id)
        .maybeSingle();

      if (leadAfterError) {
        console.error('❌ Ошибка проверки лида после добавления продажи:', leadAfterError);
      }

      if (existingLeadAfter) {
        // Обновляем существующий лид
        console.log('📝 Обновляем существующий лид, текущая сумма:', existingLeadAfter.sale_amount);
        
        // Считаем общую сумму продаж для этого клиента
        const { data: purchasesSum, error: sumError } = await (supabase as any)
          .from('purchases')
          .select('amount')
          .eq('client_phone', saleData.client_phone)
          .eq('business_id', saleData.business_id);

        if (!sumError && purchasesSum) {
          const totalAmount = purchasesSum.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
          console.log('💰 Общая сумма продаж для клиента:', totalAmount);
          
          const { error: updateError } = await (supabase as any)
            .from('leads')
            .update({ sale_amount: totalAmount })
            .eq('id', existingLeadAfter.id);

          if (updateError) {
            console.error('❌ Ошибка обновления sale_amount в leads:', updateError);
          } else {
            console.log('✅ Успешно обновлен sale_amount в leads');
          }
        }
      } else {
        // Лид должен существовать, если мы дошли до этого места
        console.error('❌ Неожиданная ситуация: лид не найден после добавления продажи');
      }
      
      return purchase;
      
    } catch (error) {
      console.error('❌ Общая ошибка в addSale:', error);
      throw error;
    }
  }

  // Получение ROI данных по business_id
  async getROIData(businessId: string): Promise<ROIData> {
    try {
      console.log('🔄 Загружаем ROI данные для business_id:', businessId);

      // Получаем статистику лидов с source_id (приводим к any для обхода типов)
      const { data: leadsStats, error: leadsError } = await (supabase as any)
        .from('leads')
        .select('id, chat_id, sale_amount, source_id, creative_url')
        .eq('business_id', businessId);

      if (leadsError) {
        console.error('Ошибка загрузки лидов:', leadsError);
        throw leadsError;
      }

      console.log('📊 Загружено лидов:', leadsStats?.length || 0);

      // Получаем все продажи для подсчета количества отдельных конверсий
      const { data: purchasesStats, error: purchasesError } = await (supabase as any)
        .from('purchases')
        .select('id, client_phone, amount, created_at')
        .eq('business_id', businessId);

      if (purchasesError) {
        console.error('Ошибка загрузки продаж:', purchasesError);
        throw purchasesError;
      }

      console.log('📊 Загружено продаж:', purchasesStats?.length || 0);

      // Пытаемся получить реальные данные кампаний из Facebook
      let facebookCampaigns: Map<string, any> = new Map();
      const usdToKztRate = 500; // Курс доллара к тенге
      
      try {
        // Получаем access_token из таблицы user_accounts
        console.log('🔄 Получаем access_token из таблицы user_accounts для business_id:', businessId);
        
        const { data: userData, error: userError } = await (supabase as any)
          .from('user_accounts')
          .select('access_token, ad_account_id')
          .eq('business_id', businessId)
          .single();

        console.log('📋 Результат запроса user_accounts:', { userData, userError });

        if (userError || !userData?.access_token) {
          console.log('⚠️ Access token не найден в user_accounts:', userError);
          console.log('📊 Будут использованы временные затраты (30% от выручки)');
        } else {
          console.log('✅ Access token найден, загружаем данные из Facebook API...');
          console.log('📋 Facebook config:', { 
            hasToken: !!userData.access_token, 
            tokenLength: userData.access_token?.length,
            adAccountId: userData.ad_account_id 
          });
          
          // Получаем реальные данные кампаний
          facebookCampaigns = await this.getFacebookCampaignsData(userData.access_token);
          console.log(`✅ Получено ${facebookCampaigns.size} кампаний из Facebook API`);
          
          // Выводим все загруженные кампании
          facebookCampaigns.forEach((campaign, id) => {
            console.log(`📊 FB Кампания ${id}: ${campaign.name}, затраты: $${campaign.spend}`);
          });
        }
      } catch (fbError) {
        console.warn('⚠️ Не удалось получить данные из Facebook API:', fbError);
      }

      // Группируем по source_id (ID объявления)
      const campaignMap = new Map<string, CampaignROI>();
      let totalRevenue = 0;
      let totalLeads = leadsStats?.length || 0;
      let totalConversions = 0;

      // Обрабатываем каждый лид асинхронно
      for (const lead of leadsStats || []) {
        const sourceId = lead.source_id || 'manual_sale';
        const revenue = Number(lead.sale_amount) || 0;
        const hasConversion = revenue > 0;
        
        // Находим все продажи для этого лида
        const leadPurchases = purchasesStats?.filter(p => p.client_phone === lead.chat_id) || [];
        const purchaseCount = leadPurchases.length;
        
        console.log(`📊 Лид ${lead.id}: source_id=${sourceId}, revenue=${revenue}, hasConversion=${hasConversion}, purchases=${purchaseCount}`);
        
        if (hasConversion) {
          totalConversions += purchaseCount; // Считаем количество продаж, а не лидов
        }
        totalRevenue += revenue;

        // Группируем по source_id (ID объявления)
        if (!campaignMap.has(sourceId)) {
          // Пытаемся получить реальное название из Facebook API
          console.log(`🔍 Создаем кампанию для source_id: ${sourceId}`);
          
          let campaignName = sourceId === 'manual_sale' ? 'Ручные продажи' : `Кампания ${sourceId}`;
          
          // Если есть Facebook токен, пытаемся получить реальное название
          if (facebookCampaigns.size > 0 && sourceId !== 'manual_sale') {
            // source_id это ID объявления, нужно получить ID кампании
            try {
              const { data: userData, error: userError } = await (supabase as any)
                .from('user_accounts')
                .select('access_token')
                .eq('business_id', businessId)
                .single();

              if (!userError && userData?.access_token) {
                const campaignId = await this.getCampaignIdByAdId(userData.access_token, sourceId);
                if (campaignId) {
                  const fbCampaign = facebookCampaigns.get(campaignId);
                  if (fbCampaign) {
                    campaignName = fbCampaign.name;
                    console.log(`✅ Найдено название кампании: ${campaignName} для объявления ${sourceId}`);
                  } else {
                    console.log(`⚠️ Кампания ${campaignId} не найдена в загруженных данных Facebook`);
                  }
                }
              }
            } catch (error) {
              console.error(`❌ Ошибка получения названия кампании для объявления ${sourceId}:`, error);
            }
          }
          
          console.log(`📋 Итоговое название кампании: ${campaignName}`);
          
          campaignMap.set(sourceId, {
            id: sourceId,
            name: campaignName,
            creative_url: lead.creative_url || '',
            spend: 0, // Будет рассчитан ниже
            revenue: 0,
            roi: 0,
            leads: 0,
            conversions: 0
          });
        }

        const campaign = campaignMap.get(sourceId)!;
        campaign.leads++;
        campaign.revenue += revenue;
        if (hasConversion) campaign.conversions += purchaseCount;
        
        // Берем любую ссылку для этого source_id (как сказал пользователь)
        if (!campaign.creative_url && lead.creative_url) {
          campaign.creative_url = lead.creative_url;
        }
      }

      // Вычисляем ROI с реальными затратами или временной формулой
      const campaigns = Array.from(campaignMap.values());
      
      // Получаем реальные затраты для каждой кампании
      for (const campaign of campaigns) {
        const sourceId = campaign.id;
        let spendInKzt: number;
        
        console.log(`💰 Расчет затрат для source_id ${sourceId} (${campaign.name})`);
        
        if (sourceId !== 'manual_sale' && facebookCampaigns.size > 0) {
          try {
            // Получаем access_token
            const { data: userData, error: userError } = await (supabase as any)
              .from('user_accounts')
              .select('access_token')
              .eq('business_id', businessId)
              .single();

            if (!userError && userData?.access_token) {
              // Получаем затраты по конкретному объявлению
              const spendInUsd = await this.getAdSpend(userData.access_token, sourceId);
              spendInKzt = Math.round(spendInUsd * usdToKztRate);
              console.log(`✅ Реальные затраты объявления ${sourceId}: $${spendInUsd} = ${spendInKzt}₸`);
            } else {
              // Временная формула
              spendInKzt = Math.round(campaign.revenue * 0.3);
              console.log(`⚠️ Временная формула для ${sourceId}: ${spendInKzt}₸`);
            }
          } catch (error) {
            console.error(`❌ Ошибка получения затрат для ${sourceId}:`, error);
            spendInKzt = Math.round(campaign.revenue * 0.3);
            console.log(`⚠️ Временная формула (ошибка) для ${sourceId}: ${spendInKzt}₸`);
          }
        } else {
          // Для ручных продаж или если нет Facebook данных
          spendInKzt = Math.round(campaign.revenue * 0.3);
          console.log(`⚠️ Временная формула для ${sourceId}: ${spendInKzt}₸`);
        }
        
        const roi = spendInKzt > 0 ? Math.round(((campaign.revenue - spendInKzt) / spendInKzt) * 100) : 0;
        
        campaign.spend = spendInKzt;
        campaign.roi = roi;
      }

      const totalSpend = campaigns.reduce((sum, c) => sum + c.spend, 0);
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

  // Получение business_id текущего пользователя
  async getCurrentUserBusinessId(): Promise<string | null> {
    try {
      const storedUser = localStorage.getItem('user');
      if (!storedUser) return null;

      const userData = JSON.parse(storedUser);
      if (!userData.id) return null;

      // Получаем business_id из user_accounts
      const { data: user, error } = await supabase
        .from('user_accounts')
        .select('business_id')
        .eq('id', userData.id)
        .single();

      if (error) {
        console.error('Ошибка получения business_id:', error);
        return null;
      }

      return (user as any)?.business_id || null;
      
    } catch (error) {
      console.error('Ошибка в getCurrentUserBusinessId:', error);
      return null;
    }
  }
}

export const salesApi = new SalesApiService(); 