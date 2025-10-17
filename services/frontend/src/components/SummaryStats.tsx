import React, { useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { formatCurrency, formatPercent, formatPercentWhole, formatNumber, formatCurrencyKZT } from '../utils/formatters';
import { CircleDollarSign, Target, MousePointerClick, BarChart3, TrendingUp, Percent } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { toast } from 'sonner';

interface SummaryStatsProps {
  showTitle?: boolean;
}

const SummaryStats: React.FC<SummaryStatsProps> = ({ showTitle = false }) => {
  const { campaignStats, loading, error, platform } = useAppContext();
  
  const stats = useMemo(() => {
    if (campaignStats.length === 0) {
      return {
        totalSpend: 0,
        totalLeads: 0,
        totalMessagingLeads: 0,
        totalQualityLeads: 0,
        qualityRate: 0,
        avgCpl: 0,
        avgCpql: 0,
        totalImpressions: 0,
        isMockData: false,
        isZeroData: true
      };
    }
    
    const hasRealData = campaignStats.some(stat => stat._is_real_data === true);
    if (!hasRealData) {
      return {
        totalSpend: 0,
        totalLeads: 0,
        totalMessagingLeads: 0,
        totalQualityLeads: 0,
        qualityRate: 0,
        avgCpl: 0,
        avgCpql: 0,
        totalImpressions: 0,
        isMockData: false,
        isZeroData: true
      };
    }
    
    const totalSpend = campaignStats.reduce((sum, stat) => sum + stat.spend, 0);
    const totalLeads = campaignStats.reduce((sum, stat) => sum + (stat.leads || 0), 0);
    const totalMessagingLeads = campaignStats.reduce((sum, stat) => sum + (stat.messagingLeads || 0), 0);
    const totalQualityLeads = campaignStats.reduce((sum, stat) => sum + (stat.qualityLeads || 0), 0);
    const totalImpressions = campaignStats.reduce((sum, stat) => sum + stat.impressions, 0);
    
    const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
    const qualityRate = totalMessagingLeads > 0 ? (totalQualityLeads / totalMessagingLeads) * 100 : 0;
    const avgCpql = totalQualityLeads > 0 ? totalSpend / totalQualityLeads : 0;
    
    const isZeroData = hasRealData && totalSpend === 0 && totalLeads === 0 && totalImpressions === 0;
    if (isZeroData) {
      console.log('Данные реальные, но все значения нулевые - нет активности за период');
    }
    
    return {
      totalSpend,
      totalLeads,
      totalMessagingLeads,
      totalQualityLeads,
      qualityRate,
      avgCpl,
      avgCpql,
      totalImpressions,
      isMockData: false,
      isZeroData
    };
  }, [campaignStats]);

  // Для Target тарифа - с Card оберткой, для остальных - просто grid
  if (showTitle) {
    return (
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Общая статистика
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
          <StatCard 
            title="Общий расход" 
            value={platform === 'tiktok' ? formatCurrencyKZT(stats.totalSpend) : formatCurrency(stats.totalSpend)} 
            icon={<CircleDollarSign className="w-4 h-4 text-green-600 dark:text-green-500/70" />} 
            loading={loading}
            isMock={stats.isMockData}
            isZero={stats.isZeroData}
          />
          <StatCard 
            title={platform === 'tiktok' ? 'Переходы в WhatsApp' : 'Всего лидов'} 
            value={formatNumber(stats.totalLeads)} 
            icon={<Target className="w-4 h-4 text-blue-600 dark:text-gray-500/70" />}
            loading={loading}
            isMock={stats.isMockData}
            isZero={stats.isZeroData}
          />
          <StatCard 
            title={platform === 'tiktok' ? 'Средняя стоимость клика' : 'Средний CPL'} 
            value={platform === 'tiktok' ? formatCurrencyKZT(stats.avgCpl) : formatCurrency(stats.avgCpl)} 
            icon={<MousePointerClick className="w-5 h-5 text-purple-600 dark:text-purple-500/70" />}
            loading={loading}
            isMock={stats.isMockData}
            isZero={stats.isZeroData}
          />
          <StatCard 
            title="Всего показов" 
            value={formatNumber(stats.totalImpressions)} 
            icon={<BarChart3 className="w-5 h-5 text-amber-600 dark:text-amber-500/70" />}
            loading={loading}
            isMock={stats.isMockData}
            isZero={stats.isZeroData}
          />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Для обычных тарифов - просто grid без Card обертки
  return (
    <div className="grid grid-cols-2 gap-2 mb-4">
      <StatCard 
        title="Общий расход" 
        value={platform === 'tiktok' ? formatCurrencyKZT(stats.totalSpend) : formatCurrency(stats.totalSpend)} 
        icon={<CircleDollarSign className="w-4 h-4 text-green-600 dark:text-green-500/70" />} 
        loading={loading}
        isMock={stats.isMockData}
        isZero={stats.isZeroData}
      />
      <StatCard 
        title={platform === 'tiktok' ? 'Переходы в WhatsApp' : 'Всего лидов'} 
        value={formatNumber(stats.totalLeads)} 
        icon={<Target className="w-4 h-4 text-blue-600 dark:text-blue-500/70" />}
        loading={loading}
        isMock={stats.isMockData}
        isZero={stats.isZeroData}
      />
      <StatCard 
        title={platform === 'tiktok' ? 'Средняя стоимость перехода' : 'Средний CPL'} 
        value={platform === 'tiktok' ? formatCurrencyKZT(stats.avgCpl) : formatCurrency(stats.avgCpl)} 
        icon={<MousePointerClick className="w-4 h-4 text-purple-600 dark:text-purple-500/70" />}
        loading={loading}
        isMock={stats.isMockData}
        isZero={stats.isZeroData}
      />
      {platform !== 'tiktok' && (
        <>
          <StatCard 
            title="Качество лидов" 
            value={formatPercentWhole(stats.qualityRate)} 
            icon={<Percent className="w-4 h-4 text-orange-600 dark:text-orange-500/70" />} 
            loading={loading}
            isMock={stats.isMockData}
            isZero={stats.isZeroData}
          />
          <StatCard 
            title="Средний CPQL" 
            value={formatCurrency(stats.avgCpql)} 
            icon={<Target className="w-4 h-4 text-emerald-600 dark:text-emerald-500/70" />} 
            loading={loading}
            isMock={stats.isMockData}
            isZero={stats.isZeroData}
          />
        </>
      )}
      <StatCard 
        title="Всего показов" 
        value={formatNumber(stats.totalImpressions)} 
        icon={<BarChart3 className="w-4 h-4 text-amber-600 dark:text-amber-500/70" />}
        loading={loading}
        isMock={stats.isMockData}
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
    <Card className="transition-all duration-200 hover:shadow-md shadow-sm">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="p-1.5 rounded-lg bg-muted flex-shrink-0">
            {icon}
          </div>
          <p className="text-xs text-muted-foreground leading-tight flex-1">{title}</p>
          {isMock && (
            <Badge variant="secondary" className="text-xs flex-shrink-0">
              тест
            </Badge>
          )}
        </div>
        {loading ? (
          <div className="relative h-6 w-24 overflow-hidden rounded-md">
            <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 animate-pulse" />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent animate-shimmer" />
          </div>
        ) : (
          <p className="text-lg font-semibold animate-in fade-in duration-500">{value}</p>
        )}
      </CardContent>
    </Card>
  );
};

export default SummaryStats;
