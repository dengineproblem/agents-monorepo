import React, { useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { formatCurrency, formatPercent, formatNumber } from '../utils/formatters';
import { CircleDollarSign, Target, MousePointerClick, Eye, Megaphone, BarChart3 } from 'lucide-react';

interface CampaignDetailStatsProps {
  campaignId: string;
}

const CampaignDetailStats: React.FC<CampaignDetailStatsProps> = ({ campaignId }) => {
  const { campaignStats, loading } = useAppContext();
  
  const stats = useMemo(() => {
    if (campaignStats.length === 0) {
      return {
        spend: 0,
        leads: 0,
        cpl: 0,
        impressions: 0,
        clicks: 0,
        ctr: 0
      };
    }
    
    const campaignFilteredStats = campaignStats.filter(stat => stat.campaign_id === campaignId);
    
    const spend = campaignFilteredStats.reduce((sum, stat) => sum + stat.spend, 0);
    const leads = campaignFilteredStats.reduce((sum, stat) => sum + stat.leads, 0);
    const clicks = campaignFilteredStats.reduce((sum, stat) => sum + stat.clicks, 0);
    const impressions = campaignFilteredStats.reduce((sum, stat) => sum + stat.impressions, 0);
    
    const cpl = leads > 0 ? spend / leads : 0;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    
    const hasRealData = campaignFilteredStats.some(stat => stat._is_real_data === true);
    const isZeroData = hasRealData && spend === 0 && leads === 0 && clicks === 0 && impressions === 0;
    
    return {
      spend,
      leads,
      cpl,
      impressions,
      clicks,
      ctr,
      isZeroData
    };
  }, [campaignStats, campaignId]);

  const isMockData = useMemo(() => {
    const hasCampaignStats = campaignStats.some(stat => stat.campaign_id === campaignId);
    if (!hasCampaignStats) return false;
    
    const hasRealData = campaignStats.some(stat => 
      stat.campaign_id === campaignId && stat._is_real_data === true
    );
    
    return !hasRealData;
  }, [campaignStats, campaignId]);

  return (
    <div className="grid grid-cols-2 gap-3 mb-6">
      <StatCard 
        title="Расход" 
        value={formatCurrency(stats.spend)} 
        icon={<CircleDollarSign className="w-5 h-5 text-green-600" />} 
        loading={loading}
        isMock={isMockData}
        isZero={stats.isZeroData}
      />
      <StatCard 
        title="Лиды и чаты" 
        value={formatNumber(stats.leads)} 
        icon={<Target className="w-5 h-5 text-blue-600" />}
        loading={loading}
        isMock={isMockData}
        isZero={stats.isZeroData}
      />
      <StatCard 
        title="Стоимость лида" 
        value={formatCurrency(stats.cpl)} 
        icon={<MousePointerClick className="w-5 h-5 text-purple-600" />}
        loading={loading}
        isMock={isMockData}
        isZero={stats.isZeroData}
      />
      <StatCard 
        title="CTR" 
        value={formatPercent(stats.ctr)} 
        icon={<BarChart3 className="w-5 h-5 text-amber-600" />}
        loading={loading}
        isMock={isMockData}
        isZero={stats.isZeroData}
      />
      <StatCard 
        title="Показы" 
        value={formatNumber(stats.impressions)} 
        icon={<Eye className="w-5 h-5 text-indigo-600" />}
        loading={loading}
        isMock={isMockData}
        isZero={stats.isZeroData}
      />
      <StatCard 
        title="Клики" 
        value={formatNumber(stats.clicks)} 
        icon={<Megaphone className="w-5 h-5 text-orange-600" />}
        loading={loading}
        isMock={isMockData}
        isZero={stats.isZeroData}
      />
    </div>
  );
};

interface StatCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  loading: boolean;
  isMock?: boolean;
  isZero?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon, loading, isMock = false, isZero = false }) => {
  return (
    <div className="stat-card flex flex-col">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-sm text-muted-foreground">{title}</span>
        {isMock && (
          <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
            тест
          </span>
        )}
      </div>
      {loading ? (
        <div className="relative h-7 w-28 overflow-hidden rounded-md">
          <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 animate-pulse" />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent animate-shimmer" />
        </div>
      ) : (
        <span className="text-lg font-semibold animate-in fade-in duration-500 slide-in-from-bottom-2">{value}</span>
      )}
    </div>
  );
};

export default CampaignDetailStats;
