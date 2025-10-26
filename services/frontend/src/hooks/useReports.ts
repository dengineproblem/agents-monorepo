import { toastT } from '@/utils/toastUtils';

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CampaignReport } from '@/types/report';
import { toast } from 'sonner';
import { useTelegramWebApp } from './useTelegramWebApp';

export const useReports = () => {
  const [reports, setReports] = useState<CampaignReport[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useTelegramWebApp();
  
  const fetchReports = async () => {
    if (!user?.id) {
      console.warn('Нет идентификатора пользователя Telegram для получения отчетов');
      return;
    }
    
    setLoading(true);
    try {
      console.log('Загрузка отчетов для пользователя с Telegram ID:', user.id);
      const { data, error } = await supabase
        .from('campaign_reports')
        .select('*')
        .eq('telegram_id', user.id.toString())
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Ошибка при загрузке отчетов:', error);
        toastT.error('failedToLoadReports');
        return;
      }
      
      console.log(`Получено ${data.length} отчетов:`, data);
      setReports(data);
    } catch (error) {
      console.error('Ошибка при обработке запроса отчетов:', error);
      toastT.error('reportsLoadError');
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    if (user?.id) {
      fetchReports();
    }
  }, [user?.id]);
  
  return {
    reports,
    loading,
    refetch: fetchReports
  };
};
