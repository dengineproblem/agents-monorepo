import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import CampaignDetailStats from '../components/CampaignDetailStats';
import MetricsChart from '../components/MetricsChart';
import DateRangePicker from '../components/DateRangePicker';
import { useAppContext } from '../context/AppContext';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { facebookApi } from '../services/facebookApi';
import { useTranslation } from '../i18n/LanguageContext';
import { REQUIRE_CONFIRMATION } from '../config/appReview';


const CampaignDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { campaigns, toggleCampaignStatus, loading, campaignStats, dateRange, setDateRange, refreshData } = useAppContext();
  const { t } = useTranslation();
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [adsets, setAdsets] = useState<any[]>([]);
  const [adsetBudgets, setAdsetBudgets] = useState<Record<string, number>>({});
  const [adsetLoading, setAdsetLoading] = useState(false);
  const [adsetSaving, setAdsetSaving] = useState<Record<string, boolean>>({});

  
  const campaign = useMemo(() => {
    return campaigns.find(c => c.id === id);
  }, [campaigns, id]);
  
  React.useEffect(() => {
    if (!id) return;
    setAdsetLoading(true);
    facebookApi.getAdsetsByCampaign(id)
      .then((data) => {
        setAdsets(data);
        const budgets: Record<string, number> = {};
        data.forEach((adset: any) => {
          budgets[adset.id] = Number(adset.daily_budget || 0) / 100;
        });
        setAdsetBudgets(budgets);
      })
      .catch((e) => {
        setAdsets([]);
      })
      .finally(() => setAdsetLoading(false));
  }, [id]);

  const handleBudgetChange = (adsetId: string, value: number) => {
    setAdsetBudgets((prev) => ({ ...prev, [adsetId]: value }));
  };

  const handleBudgetSave = async (adsetId: string) => {
    setAdsetSaving((prev) => ({ ...prev, [adsetId]: true }));
    try {
      const cents = Math.round((adsetBudgets[adsetId] || 0) * 100);
      await facebookApi.updateAdsetBudget(adsetId, cents);
      // Можно добавить уведомление об успехе
    } catch (e: any) {
      // Можно добавить уведомление об ошибке
    } finally {
      setAdsetSaving((prev) => ({ ...prev, [adsetId]: false }));
    }
  };

  const handleDateRangeChange = (range) => {
    setDateRange(range);
    refreshData();
  };

  useEffect(() => {
    refreshData();
    // eslint-disable-next-line
  }, [dateRange]);

  if (loading || campaigns.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>{t('campaign.loading')}</p>
      </div>
    );
  }
  
  if (!id || !campaign) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>{t('campaign.notFound')}</p>
      </div>
    );
  }
  
  const handleBack = () => {
    navigate('/');
  };
  
  const handleToggleStatus = (checked: boolean) => {
    // App Review: Confirmation dialog перед изменением статуса (только в App Review режиме)
    if (REQUIRE_CONFIRMATION) {
      const confirmed = window.confirm(
        checked ? t('msg.confirmResume') : t('msg.confirmPause')
      );
      
      if (!confirmed) {
        return;
      }
    }
    
    toggleCampaignStatus(id, checked);
  };
  
  return (
    <div className="w-full max-w-full overflow-x-hidden">
      <Header 
        title="" 
        onOpenDatePicker={() => setDatePickerOpen(true)} 
        showBack={false}
      />
      
      <div className="container mx-auto py-4 pt-[76px] max-w-full">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={handleBack} className="md:hidden">
              <ArrowLeft size={20} />
            </Button>
            <h1 className="text-lg font-medium">{t('campaign.details')}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {campaign.status === 'ACTIVE' ? t('campaign.active') : t('campaign.suspended')}
            </span>
            <Switch 
              checked={campaign.status === 'ACTIVE'} 
              onCheckedChange={handleToggleStatus}
            />
          </div>
        </div>
        
        <CampaignDetailStats campaignId={id} />
        
        <div className="mb-6">
          <h2 className="text-lg font-medium mb-3">{t('campaign.adsetBudget')}</h2>
          {adsetLoading ? (
            <div>{t('campaign.loadingBudgets')}</div>
          ) : adsets.length === 0 ? (
            <div className="text-muted-foreground">{t('campaign.noAdsets')}</div>
          ) : (
            <div className="space-y-2">
              {adsets.map((adset) => (
                <div key={adset.id} className="flex items-center gap-2 bg-card/50 rounded p-2">
                  <span className="flex-1 truncate">{adset.name}</span>
                  <button
                    className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300"
                    onClick={() => handleBudgetChange(adset.id, Math.max(0, (adsetBudgets[adset.id] || 0) - 1))}
                    disabled={adsetSaving[adset.id]}
                  >−</button>
                  <input
                    type="number"
                    className="w-24 text-center border rounded px-2 py-1"
                    value={adsetBudgets[adset.id] || 0}
                    min={0}
                    step={1}
                    onChange={e => handleBudgetChange(adset.id, Number(e.target.value))}
                    disabled={adsetSaving[adset.id]}
                  />
                  <button
                    className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300"
                    onClick={() => handleBudgetChange(adset.id, (adsetBudgets[adset.id] || 0) + 1)}
                    disabled={adsetSaving[adset.id]}
                  >+</button>
                  <Button
                    size="sm"
                    onClick={() => handleBudgetSave(adset.id)}
                    disabled={adsetSaving[adset.id]}
                  >
                    {adsetSaving[adset.id] ? t('campaign.saving') : t('campaign.save')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="mb-4">
          <h2 className="text-lg font-medium mb-3">Графики</h2>
          <MetricsChart campaignId={id} />
        </div>
      </div>
      
      <DateRangePicker open={datePickerOpen} onOpenChange={setDatePickerOpen} />
    </div>
  );
};

export default CampaignDetail;
