import React, { useState, useEffect, useMemo } from 'react';
import { formatCurrency, formatNumber } from '../utils/formatters';
import { useTranslation } from '../i18n/LanguageContext';
import { facebookApi, type Adset, type DateRange } from '../services/facebookApi';
import EditAdsetDialog from './EditAdsetDialog';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { REQUIRE_CONFIRMATION } from '../config/appReview';
import { getCachedData, setCachedData, invalidateCache } from '../utils/apiCache';

interface AdsetListProps {
  campaignId: string;
  dateRange: DateRange;
  forceRefresh?: boolean; // Флаг для принудительной перезагрузки данных
}

interface AdsetStat {
  adset_id: string;
  adset_name: string;
  spend: number;
  leads: number;
  cpl: number;
  impressions: number;
  clicks: number;
}

const AdsetList: React.FC<AdsetListProps> = ({ campaignId, dateRange, forceRefresh = false }) => {
  const { t } = useTranslation();
  const [adsets, setAdsets] = useState<Adset[]>([]);
  const [adsetStats, setAdsetStats] = useState<AdsetStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedAdset, setSelectedAdset] = useState<Adset | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState<Record<string, boolean>>({});

  // Загрузка ad sets при монтировании с кэшированием
  useEffect(() => {
    if (!campaignId) return;
    
    const cacheKey = `adsets_${campaignId}`;
    
    // Проверяем кэш, если не форсируем обновление
    if (!forceRefresh) {
      const cached = getCachedData<Adset[]>(cacheKey);
      if (cached) {
        setAdsets(cached);
        setLoading(false);
        return;
      }
    }
    
    // Загружаем из API
    setLoading(true);

    facebookApi.getAdsetsByCampaign(campaignId)
      .then((data) => {

        setAdsets(data);
        // НЕ кэшируем пустые массивы - они могут быть временным состоянием
        if (data.length > 0) {
          setCachedData(cacheKey, data, 10); // Кэш на 10 минут

        } else {

        }
      })
      .catch((e) => {

        setAdsets([]);
      })
      .finally(() => setLoading(false));
  }, [campaignId, forceRefresh]);

  // Загрузка статистики при изменении периода с кэшированием
  useEffect(() => {
    if (!campaignId || !dateRange) return;
    
    const statsCacheKey = `adset_stats_${campaignId}_${dateRange.since}_${dateRange.until}`;
    
    // Проверяем кэш, если не форсируем обновление
    if (!forceRefresh) {
      const cached = getCachedData<AdsetStat[]>(statsCacheKey);
      if (cached) {
        setAdsetStats(cached);
        return;
      }
    }
    
    // Загружаем из API
    facebookApi.getAdsetStats(campaignId, dateRange)
      .then((stats) => {
        setAdsetStats(stats);
        setCachedData(statsCacheKey, stats, 5); // Кэш на 5 минут
      })
      .catch((e) => {

        setAdsetStats([]);
      });
  }, [campaignId, dateRange.since, dateRange.until, forceRefresh]);

  // Объединение ad sets со статистикой
  const adsetsWithStats = useMemo(() => {
    return adsets.map(adset => {
      const stats = adsetStats.find(stat => stat.adset_id === adset.id);
      
      return {
        ...adset,
        spend: stats?.spend || 0,
        leads: stats?.leads || 0,
        cpl: stats?.cpl || 0,
        impressions: stats?.impressions || 0,
        clicks: stats?.clicks || 0,
      };
    });
  }, [adsets, adsetStats]);

  const handleAdsetClick = (adset: Adset) => {
    setSelectedAdset(adset);
    setEditDialogOpen(true);
  };

  const handleAdsetUpdate = (updatedAdset: Adset) => {
    // Обновляем локальное состояние
    setAdsets(prev => prev.map(a => a.id === updatedAdset.id ? updatedAdset : a));
    setEditDialogOpen(false);
    setSelectedAdset(null);
  };

  const handleToggleStatus = async (e: React.MouseEvent, adsetId: string, currentStatus: string) => {
    e.stopPropagation(); // Останавливаем всплытие события
    
    const newStatus = currentStatus === 'ACTIVE';
    
    if (REQUIRE_CONFIRMATION) {
      const confirmed = window.confirm(
        newStatus ? t('msg.confirmPause') : t('msg.confirmResume')
      );
      
      if (!confirmed) {
        return;
      }
    }
    
    setUpdatingStatus(prev => ({ ...prev, [adsetId]: true }));
    
    try {
      await facebookApi.updateAdsetStatus(adsetId, !newStatus);
      
      // Инвалидируем кэш списка ad sets после изменения статуса
      invalidateCache(`adsets_${campaignId}`);
      
      // Обновляем локальное состояние
      setAdsets(prev => prev.map(adset => 
        adset.id === adsetId 
          ? { ...adset, status: !newStatus ? 'ACTIVE' : 'PAUSED' }
          : adset
      ));
      
      toast.success(
        !newStatus 
          ? 'Ad set успешно возобновлен' 
          : 'Ad set успешно приостановлен'
      );
    } catch (error) {

      toast.error('Не удалось изменить статус ad set');
    } finally {
      setUpdatingStatus(prev => ({ ...prev, [adsetId]: false }));
    }
  };

  if (loading && adsets.length === 0) {
    return (
      <div className="space-y-3 animate-in fade-in duration-300">
        {[1, 2].map((i) => (
          <div key={i} className="campaign-card bg-card border shadow-sm">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2 flex-1">
                <div className="h-5 w-48 bg-muted/70 rounded animate-pulse" />
                <div className="h-2 w-2 bg-muted rounded-full animate-pulse" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <div className="h-3 w-16 bg-muted/70 rounded animate-pulse" />
                <div className="relative h-5 w-20 overflow-hidden rounded-md">
                  <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700 animate-pulse" />
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 dark:via-white/20 to-transparent animate-shimmer" />
                </div>
              </div>
              <div className="space-y-1">
                <div className="h-3 w-16 bg-muted/70 rounded animate-pulse" />
                <div className="relative h-5 w-12 overflow-hidden rounded-md">
                  <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700 animate-pulse" />
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 dark:via-white/20 to-transparent animate-shimmer" />
                </div>
              </div>
              <div className="space-y-1">
                <div className="h-3 w-20 bg-muted/70 rounded animate-pulse" />
                <div className="relative h-5 w-16 overflow-hidden rounded-md">
                  <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700 animate-pulse" />
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 dark:via-white/20 to-transparent animate-shimmer" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (adsetsWithStats.length === 0 && !loading) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">{t('campaign.noAdsets')}</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {adsetsWithStats.map((adset, index) => (
          <div 
            key={adset.id} 
            className="campaign-card animate-in fade-in duration-500 hover:shadow-md hover:border-gray-300 transition-all cursor-pointer group" 
            style={{ animationDelay: `${index * 50}ms` }}
            onClick={() => handleAdsetClick(adset)}
          >
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <h3
                  className="font-semibold truncate overflow-hidden whitespace-nowrap text-ellipsis flex-1 min-w-0 group-hover:text-gray-700 transition-colors"
                  title={adset.name}
                >
                  {adset.name}
                </h3>
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full transition-all ${
                    adset.status === 'ACTIVE' 
                      ? 'bg-gradient-to-br from-green-400 to-emerald-500 dark:from-green-500/70 dark:to-emerald-500/70 shadow-sm' 
                      : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                  title={adset.status}
                />
              </div>
              <Switch 
                className="ml-3"
                checked={adset.status === 'ACTIVE'}
                disabled={updatingStatus[adset.id]}
                onClick={(e) => {
                  e.stopPropagation(); 
                }}
                onCheckedChange={(checked) => {
                  if (REQUIRE_CONFIRMATION) {
                    const confirmed = window.confirm(
                      checked ? t('msg.confirmResume') : t('msg.confirmPause')
                    );
                    
                    if (!confirmed) {
                      return;
                    }
                  }
                  
                  handleToggleStatus(
                    { stopPropagation: () => {} } as React.MouseEvent,
                    adset.id,
                    adset.status
                  );
                }}
              />
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs font-medium">{t('stats.spend')}</p>
                <p className="font-semibold text-base">{formatCurrency(adset.spend)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs font-medium">{t('stats.leadsAndChats')}</p>
                <p className="font-semibold text-base">{formatNumber(adset.leads)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs font-medium">{t('stats.costPerLead')}</p>
                <p className="font-semibold text-base">{formatCurrency(adset.cpl)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {selectedAdset && (
        <EditAdsetDialog
          adset={selectedAdset}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onUpdate={handleAdsetUpdate}
        />
      )}
    </>
  );
};

export default AdsetList;
