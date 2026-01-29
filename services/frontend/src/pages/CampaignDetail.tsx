import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import CampaignDetailStats from '../components/CampaignDetailStats';
import AdsetList from '../components/AdsetList';
import DateRangePicker from '../components/DateRangePicker';
import { useAppContext } from '../context/AppContext';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft, LayoutDashboard, TrendingUp } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext';
import { REQUIRE_CONFIRMATION } from '../config/appReview';
import { invalidateCache } from '../utils/apiCache';
import { BudgetForecastTab } from '../components/budget-forecast';


const CampaignDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { campaigns, toggleCampaignStatus, loading, campaignStats, dateRange, setDateRange, refreshData } = useAppContext();
  const { t } = useTranslation();
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [forceRefresh, setForceRefresh] = useState(false);

  
  const campaign = useMemo(() => {
    return campaigns.find(c => c.id === id);
  }, [campaigns, id]);

  const handleDateRangeChange = (range) => {
    setDateRange(range);
    refreshData();
  };

  useEffect(() => {
    refreshData();
    // eslint-disable-next-line
  }, [dateRange]);

  // Убрали полноэкранный лоадер - теперь показываем страницу сразу с шиммерами
  // как в ROI аналитике
  
  const handleBack = () => {
    navigate('/');
  };
  
  const handleForceRefresh = () => {

    // Инвалидируем кэши для текущей кампании
    if (id) {
      invalidateCache(`adsets_${id}`);
      invalidateCache(`adset_stats_${id}`);
    }
    // Переключаем флаг для триггера обновления в компонентах
    setForceRefresh(prev => !prev);
    // Также обновляем данные кампаний из контекста
    refreshData();
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
        onRefresh={handleForceRefresh}
      />
      
      <div className="container mx-auto py-4 pt-[76px] max-w-full">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={handleBack}>
              <ArrowLeft size={20} />
            </Button>
            <h1 className="text-lg font-medium">{t('campaign.details')}</h1>
          </div>
          {campaign && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {campaign.status === 'ACTIVE' ? t('campaign.active') : t('campaign.suspended')}
              </span>
              <Switch 
                checked={campaign.status === 'ACTIVE'} 
                onCheckedChange={handleToggleStatus}
              />
            </div>
          )}
        </div>
        
        {id && <CampaignDetailStats campaignId={id} />}

        {id && (
          <Tabs defaultValue="overview" className="mt-4">
            <TabsList>
              <TabsTrigger value="overview" className="flex items-center gap-1.5">
                <LayoutDashboard className="h-4 w-4" />
                {t('campaign.overview') || 'Обзор'}
              </TabsTrigger>
              <TabsTrigger value="forecast" className="flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4" />
                {t('campaign.forecast') || 'Прогноз'}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4">
              <div className="mb-6">
                <h2 className="text-lg font-medium mb-3">Ad Sets</h2>
                <AdsetList campaignId={id} dateRange={dateRange} forceRefresh={forceRefresh} />
              </div>
            </TabsContent>

            <TabsContent value="forecast" className="mt-4">
              <BudgetForecastTab campaignId={id} />
            </TabsContent>
          </Tabs>
        )}
      </div>
      
      <DateRangePicker open={datePickerOpen} onOpenChange={setDatePickerOpen} />
    </div>
  );
};

export default CampaignDetail;
