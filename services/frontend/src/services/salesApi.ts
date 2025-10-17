import { supabase } from '@/integrations/supabase/client';

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
  // Получение всех продаж по бизнесу
  async getAllPurchases(businessId: string): Promise<{ data: any[]; error: any }> {
    try {
      const { data, error } = await (supabase as any)
        .from('purchases')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });
      return { data, error };
    } catch (error) {
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
  private async getAdSpend(accessToken: string, adId: string, datePreset: 'last_7d' | 'last_30d' | 'last_90d' | 'maximum'): Promise<number> {
    try {
      const baseUrl = 'https://graph.facebook.com/v18.0';
      const url = new URL(`${baseUrl}/${adId}/insights`);
      url.searchParams.append('access_token', accessToken);
      url.searchParams.append('date_preset', datePreset);
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

  // Получение ROI данных по business_id
  async getROIData(businessId: string, timeframeDays: 7 | 30 | 90 | 'all' = 'all'): Promise<ROIData> {
    try {
      console.log('🔄 Загружаем ROI данные для business_id:', businessId);

      // Фильтрация по периоду
      const since = (() => {
        if (timeframeDays === 'all') return null;
        const d = new Date();
        d.setDate(d.getDate() - timeframeDays);
        // усечем до дня
        d.setHours(0, 0, 0, 0);
        return d.toISOString();
      })();

      // Получаем статистику лидов с source_id
      let leadsQuery = (supabase as any)
        .from('leads')
        .select('id, chat_id, sale_amount, source_id, creative_url, created_at')
        .eq('business_id', businessId);
      if (since) leadsQuery = leadsQuery.gte('created_at', since);
      const { data: leadsStats, error: leadsError } = await leadsQuery;

      if (leadsError) {
        console.error('Ошибка загрузки лидов:', leadsError);
        throw leadsError;
      }

      console.log('📊 Загружено лидов:', leadsStats?.length || 0);

      // Получаем все продажи для подсчета количества отдельных конверсий
      let purchasesQuery = (supabase as any)
        .from('purchases')
        .select('id, client_phone, amount, created_at')
        .eq('business_id', businessId);
      if (since) purchasesQuery = purchasesQuery.gte('created_at', since);
      const { data: purchasesStats, error: purchasesError } = await purchasesQuery;

      if (purchasesError) {
        console.error('Ошибка загрузки продаж:', purchasesError);
        throw purchasesError;
      }

      console.log('📊 Загружено продаж:', purchasesStats?.length || 0);

      // Пытаемся получить реальные данные кампаний из Facebook
      let facebookCampaigns: Map<string, any> = new Map();
      const usdToKztRate = 500; // Курс доллара к тенге

      // Получаем access_token один раз
      let fbAccessToken: string | null = null;
      let fbAdAccountId: string | null = null;
      try {
        console.log('🔄 Получаем access_token из таблицы user_accounts для business_id:', businessId);
        const { data: userData, error: userError } = await (supabase as any)
          .from('user_accounts')
          .select('access_token, ad_account_id')
          .eq('business_id', businessId)
          .single();

        if (!userError && userData?.access_token) {
          fbAccessToken = userData.access_token;
          fbAdAccountId = userData.ad_account_id;
          console.log('✅ Access token найден');
          // Подтянем карту кампаний один раз (для названий)
          facebookCampaigns = await this.getFacebookCampaignsData(fbAccessToken, fbAdAccountId);
        } else {
          console.log('⚠️ Access token не найден, используем 30% формулу для затрат');
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
          if (facebookCampaigns.size > 0 && sourceId !== 'manual_sale' && fbAccessToken) {
            try {
              const campaignId = await this.getCampaignIdByAdId(fbAccessToken, sourceId);
              if (campaignId) {
                const fbCampaign = facebookCampaigns.get(campaignId);
                if (fbCampaign) {
                  campaignName = fbCampaign.name;
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
      
      // Получаем реальные затраты для каждой кампании (параллельно, с ограничением)
      const datePreset: 'last_7d' | 'last_30d' | 'last_90d' | 'maximum' =
        timeframeDays === 7 ? 'last_7d' : timeframeDays === 30 ? 'last_30d' : timeframeDays === 90 ? 'last_90d' : 'maximum';

      const concurrency = 6;
      const queue: Promise<void>[] = [];
      let active = 0;
      const runTask = async (task: () => Promise<void>) => {
        active++;
        try {
          await task();
        } finally {
          active--;
        }
      };

      const schedule = async (task: () => Promise<void>) => {
        while (active >= concurrency) {
          await Promise.race(queue);
        }
        const p = runTask(task);
        queue.push(p);
        p.finally(() => {
          const idx = queue.indexOf(p);
          if (idx >= 0) queue.splice(idx, 1);
        });
      };

      await Promise.all(
        campaigns.map((campaign) =>
          schedule(async () => {
            const sourceId = campaign.id;
            let spendInKzt: number;
            if (sourceId !== 'manual_sale' && facebookCampaigns.size > 0 && fbAccessToken) {
              try {
                const spendInUsd = await this.getAdSpend(fbAccessToken, sourceId, datePreset);
                spendInKzt = Math.round(spendInUsd * usdToKztRate);
              } catch (error) {
                console.error(`❌ Ошибка получения затрат для ${sourceId}:`, error);
                spendInKzt = Math.round(campaign.revenue * 0.3);
              }
            } else {
              spendInKzt = Math.round(campaign.revenue * 0.3);
            }
            const roi = spendInKzt > 0 ? Math.round(((campaign.revenue - spendInKzt) / spendInKzt) * 100) : 0;
            campaign.spend = spendInKzt;
            campaign.roi = roi;
          })
        )
      );

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

  // Получение списка существующих кампаний для выбора
  public async getExistingCampaigns(businessId: string): Promise<Array<{id: string, name: string, creative_url?: string}>> {
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
          .select('access_token, ad_account_id')
          .eq('business_id', businessId)
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

  // Получение business_id текущего пользователя
  public async getCurrentUserBusinessId(): Promise<string | null> {
    try {
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        throw new Error('Пользователь не авторизован');
      }
      
      const userData = JSON.parse(storedUser);
      
      // Если business_id есть в localStorage, используем его
      if (userData.business_id) {
        return userData.business_id;
      }
      
      // Если нет - используем ID пользователя как business_id
      if (userData.id) {
        console.log('✅ Используем user.id как business_id:', userData.id);
        return userData.id;
      }
      
      throw new Error('Business ID не найден');
    } catch (error) {
      console.error('Ошибка получения business_id:', error);
      return null;
    }
  }

  // Обновляем sale_amount в лиде после добавления продажи
  private async updateLeadSaleAmount(clientPhone: string, businessId: string) {
    try {
      console.log('🔄 Обновляем sale_amount в лиде...');
      
      // Считаем общую сумму всех продаж клиента
      const { data: totalSales, error: sumError } = await (supabase as any)
        .from('purchases')
        .select('amount')
        .eq('client_phone', clientPhone)
        .eq('business_id', businessId);

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
        .eq('business_id', businessId);

      if (updateError) {
        console.error('❌ Ошибка обновления sale_amount в лиде:', updateError);
      } else {
        console.log('✅ sale_amount обновлен в лиде:', totalAmount);
      }
      
    } catch (error) {
      console.error('❌ Ошибка в updateLeadSaleAmount:', error);
    }
  }

  // Добавление продажи
  public async addSale(saleData: {
    client_phone: string;
    amount: number;
    business_id: string;
    manual_source_id?: string;
    manual_creative_url?: string;
  }) {
    try {
      console.log('🔄 Добавляем продажу:', saleData);
      console.log('📞 Номер телефона:', saleData.client_phone);
      console.log('💰 Сумма:', saleData.amount);
      console.log('🏢 Business ID:', saleData.business_id);
      console.log('📋 Source ID:', saleData.manual_source_id);

      // Проверяем есть ли лид с таким номером
      const { data: existingLead, error: leadCheckError } = await (supabase as any)
        .from('leads')
        .select('id, source_id, creative_url')
        .eq('business_id', saleData.business_id)
        .eq('chat_id', saleData.client_phone)
        .single();

      if (leadCheckError && leadCheckError.code !== 'PGRST116') {
        console.error('❌ Ошибка проверки лида:', leadCheckError);
        throw leadCheckError;
      }

      // Если лид не найден
      if (!existingLead) {
        // Если НЕТ manual_source_id - выбрасываем ошибку (первый клик)
        if (!saleData.manual_source_id) {
          console.log('⚠️ Лид не найден в базе, нужно выбрать кампанию');
          throw new Error(`Клиент с номером ${saleData.client_phone} не найден в базе лидов`);
        }
        
        // Если ЕСТЬ manual_source_id - создаем лид (второй клик)
        console.log('📝 Создаем новый лид для продажи...');
        
        const leadInsertData = {
          business_id: saleData.business_id,
          chat_id: saleData.client_phone,
          source_id: saleData.manual_source_id,
          creative_url: saleData.manual_creative_url || '',
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

      // Добавляем продажу в таблицу purchases (только основные поля)
      const purchaseInsertData = {
        business_id: saleData.business_id,
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
      await this.updateLeadSaleAmount(saleData.client_phone, saleData.business_id);

      return { success: true, data: purchaseData };

    } catch (error) {
      console.error('❌ Ошибка в addSale:', error);
      throw error;
    }
  }
}

export const salesApi = new SalesApiService(); 