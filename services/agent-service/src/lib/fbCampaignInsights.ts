/**
 * Facebook Campaign Insights
 *
 * Получение метрик кампаний напрямую из Facebook API
 * Поддерживает batch запросы для оптимизации
 */

const FB_API_VERSION = 'v18.0';

export interface CampaignInsights {
  campaignId: string;
  spend: number;        // в долларах
  leads: number;        // все типы лидов
  impressions: number;
  clicks: number;
  cpl: number;          // в центах
}

/**
 * Получить метрики одной кампании из Facebook API
 */
export async function getCampaignInsights(
  campaignId: string,
  accessToken: string,
  period: '7d' | '14d' | '30d' | 'all' = '7d'
): Promise<CampaignInsights | null> {
  try {
    if (!campaignId || !accessToken) {
      return null;
    }

    // Формируем time_range
    const timeRange = getTimeRange(period);

    const baseUrl = `https://graph.facebook.com/${FB_API_VERSION}`;
    const url = new URL(`${baseUrl}/${campaignId}/insights`);
    url.searchParams.append('access_token', accessToken);
    url.searchParams.append('fields', 'spend,impressions,clicks,actions');

    if (timeRange) {
      url.searchParams.append('time_range', JSON.stringify(timeRange));
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
      const error = await response.json();
      console.error(`[FB Insights] Error for campaign ${campaignId}:`, error.error?.message);
      return null;
    }

    const data = await response.json();
    const insights = data.data?.[0];

    if (!insights) {
      return {
        campaignId,
        spend: 0,
        leads: 0,
        impressions: 0,
        clicks: 0,
        cpl: 0
      };
    }

    const spend = parseFloat(insights.spend || 0);
    const impressions = parseInt(insights.impressions || 0);
    const clicks = parseInt(insights.clicks || 0);

    // Извлекаем все типы лидов из actions
    const actions = insights.actions || [];
    const leads = extractLeads(actions);

    const cpl = leads > 0 ? Math.round((spend / leads) * 100) : 0;

    return {
      campaignId,
      spend,
      leads,
      impressions,
      clicks,
      cpl
    };
  } catch (error) {
    console.error(`[FB Insights] Exception for campaign ${campaignId}:`, error);
    return null;
  }
}

/**
 * Batch запрос для получения метрик нескольких кампаний
 * Facebook позволяет до 50 запросов в одном batch
 */
export async function getCampaignInsightsBatch(
  campaigns: { campaignId: string; accessToken: string }[],
  period: '7d' | '14d' | '30d' | 'all' = '7d'
): Promise<Map<string, CampaignInsights>> {
  const results = new Map<string, CampaignInsights>();

  if (campaigns.length === 0) {
    return results;
  }

  // Группируем по access_token (batch запросы должны использовать один токен)
  const byToken = new Map<string, string[]>();
  for (const { campaignId, accessToken } of campaigns) {
    if (!byToken.has(accessToken)) {
      byToken.set(accessToken, []);
    }
    byToken.get(accessToken)!.push(campaignId);
  }

  const timeRange = getTimeRange(period);
  const baseUrl = `https://graph.facebook.com/${FB_API_VERSION}`;

  // Обрабатываем каждую группу токенов
  for (const [accessToken, campaignIds] of byToken) {
    // Разбиваем на batch по 50 запросов
    const chunks = chunkArray(campaignIds, 50);

    for (const chunk of chunks) {
      try {
        // Формируем batch запрос
        const batch = chunk.map(campaignId => {
          let relativeUrl = `${campaignId}/insights?fields=spend,impressions,clicks,actions`;
          if (timeRange) {
            relativeUrl += `&time_range=${encodeURIComponent(JSON.stringify(timeRange))}`;
          }
          return {
            method: 'GET',
            relative_url: relativeUrl
          };
        });

        const response = await fetch(`${baseUrl}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            access_token: accessToken,
            batch: JSON.stringify(batch)
          })
        });

        if (!response.ok) {
          console.error('[FB Insights Batch] Request failed:', response.status);
          continue;
        }

        const batchResults = await response.json();

        // Обрабатываем результаты
        for (let i = 0; i < batchResults.length; i++) {
          const campaignId = chunk[i];
          const result = batchResults[i];

          if (result.code !== 200) {
            results.set(campaignId, {
              campaignId,
              spend: 0,
              leads: 0,
              impressions: 0,
              clicks: 0,
              cpl: 0
            });
            continue;
          }

          try {
            const body = JSON.parse(result.body);
            const insights = body.data?.[0];

            if (!insights) {
              results.set(campaignId, {
                campaignId,
                spend: 0,
                leads: 0,
                impressions: 0,
                clicks: 0,
                cpl: 0
              });
              continue;
            }

            const spend = parseFloat(insights.spend || 0);
            const impressions = parseInt(insights.impressions || 0);
            const clicks = parseInt(insights.clicks || 0);
            const actions = insights.actions || [];
            const leads = extractLeads(actions);
            const cpl = leads > 0 ? Math.round((spend / leads) * 100) : 0;

            results.set(campaignId, {
              campaignId,
              spend,
              leads,
              impressions,
              clicks,
              cpl
            });
          } catch (e) {
            results.set(campaignId, {
              campaignId,
              spend: 0,
              leads: 0,
              impressions: 0,
              clicks: 0,
              cpl: 0
            });
          }
        }
      } catch (error) {
        console.error('[FB Insights Batch] Exception:', error);
      }
    }
  }

  return results;
}

/**
 * Извлечь лиды из actions
 *
 * ВАЖНО: Используем ту же логику, что и на Dashboard (facebookApi.ts)
 * - messagingLeads: onsite_conversion.total_messaging_connection (WhatsApp/Messenger)
 * - siteLeads: offsite_conversion.fb_pixel_lead (лиды с сайта через пиксель)
 *
 * НЕ включаем:
 * - 'lead' - это дублирует другие типы
 * - 'onsite_conversion.lead_grouped' - это агрегированное значение
 * - 'onsite_conversion.messaging_first_reply' - это дублирует messaging_connection
 */
function extractLeads(actions: any[]): number {
  let messagingLeads = 0;
  let siteLeads = 0;

  for (const action of actions) {
    // Общие лиды от переписок (WhatsApp/Messenger)
    if (action.action_type === 'onsite_conversion.total_messaging_connection') {
      messagingLeads = parseInt(action.value || '0', 10);
    }
    // Лиды с сайта через пиксель
    else if (action.action_type === 'offsite_conversion.fb_pixel_lead') {
      siteLeads = parseInt(action.value || '0', 10);
    }
    // Кастомные конверсии пикселя
    else if (typeof action.action_type === 'string' && action.action_type.startsWith('offsite_conversion.custom')) {
      siteLeads += parseInt(action.value || '0', 10);
    }
  }

  return messagingLeads + siteLeads;
}

/**
 * Получить time_range для периода
 */
function getTimeRange(period: '7d' | '14d' | '30d' | 'all'): { since: string; until: string } | null {
  if (period === 'all') {
    return null;
  }

  const days = {
    '7d': 7,
    '14d': 14,
    '30d': 30
  }[period];

  const until = new Date();
  const since = new Date();
  since.setDate(since.getDate() - days);

  return {
    since: since.toISOString().split('T')[0],
    until: until.toISOString().split('T')[0]
  };
}

/**
 * Разбить массив на части
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
