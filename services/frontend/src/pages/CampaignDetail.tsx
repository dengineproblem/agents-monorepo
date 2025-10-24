import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import CampaignDetailStats from '../components/CampaignDetailStats';
import AdsetList from '../components/AdsetList';
import DateRangePicker from '../components/DateRangePicker';
import { useAppContext } from '../context/AppContext';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext';
import { REQUIRE_CONFIRMATION } from '../config/appReview';


const CampaignDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { campaigns, toggleCampaignStatus, loading, campaignStats, dateRange, setDateRange, refreshData } = useAppContext();
  const { t } = useTranslation();
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  
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
          <h2 className="text-lg font-medium mb-3">Ad Sets</h2>
          <AdsetList campaignId={id} dateRange={dateRange} />
        </div>
      </div>
      
      <DateRangePicker open={datePickerOpen} onOpenChange={setDatePickerOpen} />
    </div>
  );
};

export default CampaignDetail;
