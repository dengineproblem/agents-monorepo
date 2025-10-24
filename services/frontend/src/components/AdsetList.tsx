import React, { useMemo, useState, useEffect } from 'react';
import { formatCurrency, formatNumber } from '../utils/formatters';
import { useTranslation } from '../i18n/LanguageContext';
import { facebookApi, type Adset, type AdsetStat, type DateRange } from '../services/facebookApi';
import EditAdsetDialog from './EditAdsetDialog';

interface AdsetListProps {
  campaignId: string;
  dateRange: DateRange;
}

const AdsetList: React.FC<AdsetListProps> = ({ campaignId, dateRange }) => {
  const { t } = useTranslation();
  const [adsets, setAdsets] = useState<Adset[]>([]);
  const [adsetStats, setAdsetStats] = useState<AdsetStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedAdset, setSelectedAdset] = useState<Adset | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Загрузка ad sets при монтировании
  useEffect(() => {
    if (!campaignId) return;
    
    setLoading(true);
    facebookApi.getAdsetsByCampaign(campaignId)
      .then((data) => {
        setAdsets(data);
      })
      .catch((e) => {
        console.error('Ошибка загрузки ad sets:', e);
        setAdsets([]);
      })
      .finally(() => setLoading(false));
  }, [campaignId]);

  // Загрузка статистики при изменении периода
  useEffect(() => {
    if (!campaignId || !dateRange) return;
    
    facebookApi.getAdsetStats(campaignId, dateRange)
      .then(setAdsetStats)
      .catch((e) => {
        console.error('Ошибка загрузки статистики ad sets:', e);
        setAdsetStats([]);
      });
  }, [campaignId, dateRange]);

  // Объединение ad sets со статистикой
  const adsetsWithStats = useMemo(() => {
    return adsets.map(adset => {
      const stats = adsetStats.filter(stat => stat.adset_id === adset.id);
      const totalSpend = stats.reduce((sum, stat) => sum + stat.spend, 0);
      const totalLeads = stats.reduce((sum, stat) => sum + (stat.leads || 0), 0);
      const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;

      return {
        ...adset,
        spend: totalSpend,
        leads: totalLeads,
        cpl: cpl
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

  if (loading && adsets.length === 0) {
    return (
      <div className="space-y-3 animate-in fade-in duration-300">
        {[1, 2].map((i) => (
          <div key={i} className="campaign-card bg-card border shadow-sm">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2 flex-1">
                <div className="h-5 w-48 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-pulse" />
                <div className="h-2 w-2 bg-muted rounded-full animate-pulse" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <div className="h-3 w-16 bg-muted/70 rounded animate-pulse" />
                <div className="h-5 w-20 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-pulse" />
              </div>
              <div className="space-y-1">
                <div className="h-3 w-16 bg-muted/70 rounded animate-pulse" />
                <div className="h-5 w-12 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-pulse" />
              </div>
              <div className="space-y-1">
                <div className="h-3 w-20 bg-muted/70 rounded animate-pulse" />
                <div className="h-5 w-16 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-pulse" />
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

