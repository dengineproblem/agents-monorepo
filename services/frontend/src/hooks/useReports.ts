import { toastT } from '@/utils/toastUtils';

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CampaignReport } from '@/types/report';
import { toast } from 'sonner';
import { useTelegramWebApp } from './useTelegramWebApp';
import { useAppContext } from '@/context/AppContext';

export const useReports = () => {
  const [reports, setReports] = useState<CampaignReport[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useTelegramWebApp();
  const { currentAdAccountId, multiAccountEnabled, platform } = useAppContext();
  const reportPlatform = platform === 'tiktok' ? 'tiktok' : 'facebook';
  
  const fetchReports = async () => {
    if (!user?.id) {

      return;
    }

    if (multiAccountEnabled && !currentAdAccountId) {

      setReports([]);
      return;
    }
    
    setLoading(true);
    try {

      let query = supabase
        .from('campaign_reports')
        .select('*')
        .eq('telegram_id', user.id.toString());

      query = query.eq('platform', reportPlatform);

      if (multiAccountEnabled && currentAdAccountId) {
        query = query.eq('account_id', currentAdAccountId);
      } else {
        query = query.is('account_id', null);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false });
      
      if (error) {

        toastT.error('failedToLoadReports');
        return;
      }

      setReports(data);
    } catch (error) {

      toastT.error('reportsLoadError');
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    if (user?.id) {
      fetchReports();
    }
  }, [user?.id, currentAdAccountId, multiAccountEnabled, platform]);
  
  return {
    reports,
    loading,
    refetch: fetchReports
  };
};
