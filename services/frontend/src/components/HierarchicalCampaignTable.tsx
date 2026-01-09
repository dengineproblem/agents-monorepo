import React, { useEffect, useState, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency, formatNumber } from '../utils/formatters';
import { facebookApi } from '@/services/facebookApi';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/config/api';
import {
  CampaignRow,
  AdsetRow,
  AdRow,
  type CampaignStats,
  type AdsetStats,
  type AdStats,
  type Direction,
} from '../pages/MultiAccountDashboard';

// Logger placeholder
const logger = {
  error: (msg: string, err: any, meta?: any) => console.error(msg, err, meta),
  debug: (msg: string, meta?: any) => console.log(msg, meta),
};

// Helper functions
function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    logger.error('Failed to parse JSON', error);
    return fallback;
  }
}

function getUserIdFromStorage(): string | null {
  const userData = localStorage.getItem('user');
  if (!userData) {
    logger.debug('No user data in localStorage');
    return null;
  }

  const user = safeJsonParse<{ id?: string }>(userData, {});
  if (!user.id) {
    return null;
  }

  return user.id;
}

interface HierarchicalCampaignTableProps {
  accountId?: string;
}

const HierarchicalCampaignTable: React.FC<HierarchicalCampaignTableProps> = ({ accountId }) => {
  const { dateRange, currentAdAccountId, multiAccountEnabled, adAccounts } = useAppContext();

  const effectiveAccountId = accountId || currentAdAccountId;

  // State для кампаний
  const [campaigns, setCampaigns] = useState<CampaignStats[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);

  // State для раскрытия иерархии
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const [expandedAdsets, setExpandedAdsets] = useState<Set<string>>(new Set());

  // State для загрузки адсетов и объявлений
  const [adsetsData, setAdsetsData] = useState<Record<string, AdsetStats[]>>({});
  const [adsetsLoading, setAdsetsLoading] = useState<Set<string>>(new Set());

  const [adsData, setAdsData] = useState<Record<string, AdStats[]>>({});
  const [adsLoading, setAdsLoading] = useState<Set<string>>(new Set());

  // State для directions (для расчета target CPL)
  const [directions, setDirections] = useState<Direction[]>([]);

  // Загрузка кампаний
  useEffect(() => {
    const loadCampaigns = async () => {
      // Для мультиаккаунтного режима требуется effectiveAccountId
      // Для легаси юзеров (multiAccountEnabled = false) загружаем данные напрямую
      if (multiAccountEnabled && !effectiveAccountId) return;

      setCampaignsLoading(true);
      try {
        // Получаем ВСЕ кампании из рекламного кабинета
        const campaignsList = await facebookApi.getCampaigns();

        // Получаем статистику кампаний
        const campaignsStats = await facebookApi.getCampaignStats(dateRange, false);

        // Создаем Map статистики для быстрого поиска
        const statsMap = new Map(campaignsStats.map(s => [s.campaign_id, s]));

        // Создаем данные для ВСЕХ кампаний, добавляя статистику если есть
        const campaignData: CampaignStats[] = campaignsList.map((c) => {
          const stats = statsMap.get(c.id);
          return {
            campaign_id: c.id,
            campaign_name: c.name,
            status: c.status,
            spend: stats?.spend || 0,
            leads: stats?.leads || 0,
            impressions: stats?.impressions || 0,
            clicks: stats?.clicks || 0,
            ctr: stats?.ctr || 0,
            cpl: stats?.cpl || 0,
            messagingLeads: stats?.messagingLeads || 0,
            qualityLeads: stats?.qualityLeads || 0,
            cpql: stats?.cpql || 0,
            qualityRate: stats?.qualityRate || 0,
            daily_budget: stats?.daily_budget || 0,
          };
        });

        // Сортировка: ACTIVE наверху, потом остальные
        campaignData.sort((a, b) => {
          if (a.status === b.status) return 0;
          if (a.status === 'ACTIVE') return -1;
          if (b.status === 'ACTIVE') return 1;
          return 0;
        });

        setCampaigns(campaignData);
      } catch (err) {
        logger.error('Failed to load campaigns', err, { accountId: effectiveAccountId });
        toast.error('Ошибка загрузки кампаний');
      } finally {
        setCampaignsLoading(false);
      }
    };

    loadCampaigns();
  }, [effectiveAccountId, dateRange, multiAccountEnabled]);

  // Загрузка directions
  useEffect(() => {
    const loadDirections = async () => {
      if (!effectiveAccountId) return;

      const userId = getUserIdFromStorage();
      if (!userId) {
        logger.error('Cannot load directions: no user ID');
        return;
      }

      try {
        const url = `${API_BASE_URL}/directions?userAccountId=${userId}&accountId=${effectiveAccountId}`;
        const response = await fetch(url, {
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Failed to load directions: ${response.status}`);
        }

        const data = await response.json();
        const directions: Direction[] = data.directions || [];

        logger.debug('Directions loaded', { accountId: effectiveAccountId, count: directions.length });
        setDirections(directions);
      } catch (err) {
        logger.error('Failed to load directions', err, { accountId: effectiveAccountId });
        setDirections([]);
      }
    };

    loadDirections();
  }, [effectiveAccountId]);

  // Обработчик раскрытия кампании
  const handleCampaignExpand = useCallback(async (campaignId: string) => {
    const isExpanded = expandedCampaigns.has(campaignId);

    if (isExpanded) {
      setExpandedCampaigns((prev) => {
        const next = new Set(prev);
        next.delete(campaignId);
        return next;
      });
    } else {
      setExpandedCampaigns((prev) => new Set(prev).add(campaignId));

      if (!adsetsData[campaignId] && !adsetsLoading.has(campaignId)) {
        setAdsetsLoading((prev) => new Set(prev).add(campaignId));

        try {
          // Получаем список адсетов с бюджетами и статусами
          const adsetsList = await facebookApi.getAdsetsByCampaign(campaignId);

          // Создаём мапы для бюджетов и статусов
          const budgetMap = new Map(
            adsetsList.map((a: any) => [a.id, parseFloat(a.daily_budget || '0') / 100])
          );
          const statusMap = new Map(
            adsetsList.map((a: any) => [a.id, a.status])
          );

          // Получаем статистику адсетов
          const adsets = await facebookApi.getAdsetStats(campaignId, dateRange);

          // Маппим адсеты в AdsetStats с добавлением бюджетов и статусов
          const adsetStats: AdsetStats[] = adsets.map((a: any) => ({
            adset_id: a.adset_id,
            adset_name: a.adset_name,
            status: statusMap.get(a.adset_id),
            spend: a.spend || 0,
            leads: a.leads || 0,
            impressions: a.impressions || 0,
            clicks: a.clicks || 0,
            ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
            cpl: a.cpl || 0,
            messagingLeads: a.messagingLeads || 0,
            qualityLeads: a.qualityLeads || 0,
            cpql: a.cpql || 0,
            qualityRate: a.qualityRate || 0,
            daily_budget: budgetMap.get(a.adset_id) || 0,
          }));

          // Сортировка: ACTIVE наверху
          adsetStats.sort((a, b) => {
            if (a.status === b.status) return 0;
            if (a.status === 'ACTIVE') return -1;
            if (b.status === 'ACTIVE') return 1;
            return 0;
          });

          setAdsetsData((prev) => ({ ...prev, [campaignId]: adsetStats }));
        } catch (err) {
          logger.error('Failed to load adsets', err, { campaignId });
          toast.error('Ошибка загрузки адсетов');
          setAdsetsData((prev) => ({ ...prev, [campaignId]: [] }));
        } finally {
          setAdsetsLoading((prev) => {
            const next = new Set(prev);
            next.delete(campaignId);
            return next;
          });
        }
      }
    }
  }, [expandedCampaigns, adsetsData, adsetsLoading, dateRange]);

  // Обработчик раскрытия адсета
  const handleAdsetExpand = useCallback(async (adsetId: string) => {
    const isExpanded = expandedAdsets.has(adsetId);

    if (isExpanded) {
      setExpandedAdsets((prev) => {
        const next = new Set(prev);
        next.delete(adsetId);
        return next;
      });
    } else {
      setExpandedAdsets((prev) => new Set(prev).add(adsetId));

      if (!adsData[adsetId] && !adsLoading.has(adsetId)) {
        setAdsLoading((prev) => new Set(prev).add(adsetId));

        try {
          // Получаем список объявлений с их статусами и миниатюрами
          const adsList = await facebookApi.getAdsByAdset(adsetId);

          // Создаём мапы для статусов и миниатюр
          const adsStatusMap = new Map(adsList.map((a) => [a.id, a.status]));
          const adsThumbnailMap = new Map(adsList.map((a) => [a.id, a.thumbnail_url]));

          // Получаем статистику объявлений
          const ads = await facebookApi.getAdStatsByAdset(adsetId, dateRange);

          // Маппим объявления в AdStats с добавлением статусов и миниатюр
          const adStats: AdStats[] = ads.map((a) => ({
            ad_id: a.ad_id,
            ad_name: a.ad_name,
            status: adsStatusMap.get(a.ad_id),
            thumbnail_url: adsThumbnailMap.get(a.ad_id),
            spend: a.spend || 0,
            leads: a.leads || 0,
            impressions: a.impressions || 0,
            clicks: a.clicks || 0,
            ctr: a.ctr || 0,
            cpl: a.cpl || 0,
            messagingLeads: a.messagingLeads || 0,
            qualityLeads: a.qualityLeads || 0,
            cpql: a.cpql || 0,
            qualityRate: a.qualityRate || 0,
          }));

          // Сортировка: ACTIVE наверху
          adStats.sort((a, b) => {
            if (a.status === b.status) return 0;
            if (a.status === 'ACTIVE') return -1;
            if (b.status === 'ACTIVE') return 1;
            return 0;
          });

          setAdsData((prev) => ({ ...prev, [adsetId]: adStats }));
        } catch (err) {
          logger.error('Failed to load ads', err, { adsetId });
          toast.error('Ошибка загрузки объявлений');
          setAdsData((prev) => ({ ...prev, [adsetId]: [] }));
        } finally {
          setAdsLoading((prev) => {
            const next = new Set(prev);
            next.delete(adsetId);
            return next;
          });
        }
      }
    }
  }, [expandedAdsets, adsData, adsLoading, dateRange]);

  // Loading state
  if (campaignsLoading && campaigns.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!campaignsLoading && campaigns.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-muted-foreground">Нет кампаний для отображения</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        {/* Header таблицы */}
        <div className="hidden md:grid grid-cols-14 px-6 py-3 bg-muted/50 text-sm font-medium text-muted-foreground">
          <div className="col-span-5">Кампания</div>
          <div className="col-span-2 text-right">Расходы</div>
          <div className="col-span-1 text-right">Бюджет</div>
          <div className="col-span-1 text-right">Лиды</div>
          <div className="col-span-1 text-right">CPL</div>
          <div className="col-span-1 text-right">CPQL</div>
          <div className="col-span-1 text-right">Качество</div>
          <div className="col-span-1 text-right">CTR</div>
          <div className="col-span-1 text-right">CPM</div>
        </div>

        {/* Список кампаний */}
        <div className="divide-y">
          {campaigns.map((campaign) => (
            <CampaignRow
              key={campaign.campaign_id}
              campaign={campaign}
              isExpanded={expandedCampaigns.has(campaign.campaign_id)}
              onExpand={() => handleCampaignExpand(campaign.campaign_id)}
              isLoading={adsetsLoading.has(campaign.campaign_id)}
              adsets={adsetsData[campaign.campaign_id] || []}
              expandedAdsets={expandedAdsets}
              onAdsetExpand={handleAdsetExpand}
              adsLoading={adsLoading}
              adsData={adsData}
              directions={directions}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default HierarchicalCampaignTable;
