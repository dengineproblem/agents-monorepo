import React, { useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { Switch } from '@/components/ui/switch';
import { formatCurrency, formatPercent, formatNumber, formatCurrencyKZT } from '../utils/formatters';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '../hooks/use-mobile';
import { useTranslation } from '../i18n/LanguageContext';
import { REQUIRE_CONFIRMATION } from '../config/appReview';

const CampaignList: React.FC = () => {
  const { campaigns, campaignStats, loading, toggleCampaignStatus, setSelectedCampaignId, platform } = useAppContext();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  
  const statusMap: Record<string, { label: string; color: string }> = {
    ACTIVE: { label: t('stats.statusActive'), color: 'bg-green-100 text-green-700' },
    PAUSED: { label: t('stats.statusPaused'), color: 'bg-gray-100 text-gray-600' },
    ERROR: { label: t('stats.statusError'), color: 'bg-red-100 text-red-700' },
    PLANNED: { label: t('stats.statusPlanned'), color: 'bg-blue-100 text-blue-700' },
    PAYMENT_FAILED: { label: t('stats.statusPaymentFailed'), color: 'bg-red-200 text-red-800' },
  };
  
  const campaignWithStats = useMemo(() => {
    const arr = campaigns.map(campaign => {
      const stats = campaignStats.filter(stat => stat.campaign_id === campaign.id);
      const totalSpend = stats.reduce((sum, stat) => sum + stat.spend, 0);
      const totalLeads = stats.reduce((sum, stat) => sum + (stat.leads || 0), 0);
      const totalClicks = stats.reduce((sum, stat) => sum + stat.clicks, 0);
      const totalImpressions = stats.reduce((sum, stat) => sum + stat.impressions, 0);
      const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
      return {
        ...campaign,
        spend: totalSpend,
        leads: totalLeads,
        cpl: cpl
      };
    });
    // Сортировка: сначала ACTIVE, потом PAUSED, внутри — по убыванию id (новые выше)
    return arr.sort((a, b) => {
      if (a.status === b.status) {
        return b.id.localeCompare(a.id);
      }
      if (a.status === 'ACTIVE') return -1;
      if (b.status === 'ACTIVE') return 1;
      // Если появятся другие статусы, они будут ниже PAUSED
      return 0;
    });
  }, [campaigns, campaignStats]);
  
  const handleViewCampaign = (id: string) => {
    setSelectedCampaignId(id);
    navigate(`/campaign/${id}`);
  };
  
  const handleToggle = (e: React.MouseEvent, campaignId: string, newStatus: boolean) => {
    e.stopPropagation(); // Останавливаем всплытие события, чтобы не вызвать onClick карточки
    toggleCampaignStatus(campaignId, newStatus);
  };
  
  if (loading && campaigns.length === 0) {
    return (
      <div className="space-y-3 animate-in fade-in duration-300">
        {[1, 2, 3].map((i) => (
          <div key={i} className="campaign-card bg-card border shadow-sm">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2 flex-1">
                <div className="h-5 w-48 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-pulse" />
                <div className="h-2 w-2 bg-muted rounded-full animate-pulse" />
              </div>
              <div className="h-6 w-11 bg-muted rounded-full animate-pulse" />
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
  
  return (
    <div className="space-y-3">
      {campaignWithStats.map((campaign, index) => (
        <div 
          key={campaign.id} 
          className="campaign-card animate-in fade-in duration-500 hover:shadow-md hover:border-gray-300 transition-all cursor-pointer group" 
          style={{ animationDelay: `${index * 50}ms` }}
          onClick={() => handleViewCampaign(campaign.id)}
        >
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <h3
                className="font-semibold truncate overflow-hidden whitespace-nowrap text-ellipsis flex-1 min-w-0 group-hover:text-gray-700 transition-colors"
                title={campaign.name}
              >
                {campaign.name}
              </h3>
              {/* colored dot вместо текста статуса */}
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full transition-all ${
                  campaign.status === 'ACTIVE' 
                    ? 'bg-gradient-to-br from-green-400 to-emerald-500 dark:from-green-500/70 dark:to-emerald-500/70 shadow-sm' 
                    : 'bg-gray-300 dark:bg-gray-600'
                }`}
                title={statusMap[campaign.status]?.label || campaign.status}
              />
            </div>
            <Switch 
              className="ml-3"
              checked={campaign.status === 'ACTIVE'}
              onClick={(e) => {
                e.stopPropagation(); 
              }}
              onCheckedChange={(checked) => {
                // App Review: Confirmation dialog перед изменением статуса (только в App Review режиме)
                if (REQUIRE_CONFIRMATION) {
                  const confirmed = window.confirm(
                    checked ? t('msg.confirmResume') : t('msg.confirmPause')
                  );
                  
                  if (!confirmed) {
                    return;
                  }
                }
                
                toggleCampaignStatus(campaign.id, checked);
              }}
            />
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs font-medium">{t('stats.spend')}</p>
              <p className="font-semibold text-base">{platform === 'tiktok' ? formatCurrencyKZT(campaign.spend) : formatCurrency(campaign.spend)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs font-medium">{platform === 'tiktok' ? t('stats.whatsappTransitions') : t('stats.leadsAndChats')}</p>
              <p className="font-semibold text-base">{formatNumber(campaign.leads)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs font-medium">{platform === 'tiktok' ? t('stats.transitionCost') : t('stats.costPerLead')}</p>
              <p className="font-semibold text-base">{platform === 'tiktok' ? formatCurrencyKZT(campaign.cpl) : formatCurrency(campaign.cpl)}</p>
            </div>
          </div>
        </div>
      ))}
      {campaignWithStats.length === 0 && !loading && (
        <div className="text-center py-8">
          <p className="text-muted-foreground">{t('stats.noCampaignsData')}</p>
        </div>
      )}
    </div>
  );
};

export default CampaignList;
