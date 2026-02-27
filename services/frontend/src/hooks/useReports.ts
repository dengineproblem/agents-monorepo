import { toastT } from '@/utils/toastUtils';

import { useEffect, useState } from 'react';
import { CampaignReport } from '@/types/report';
import { useTelegramWebApp } from './useTelegramWebApp';
import { useAppContext } from '@/context/AppContext';
import { API_BASE_URL } from '@/config/api';

export const useReports = () => {
  const [reports, setReports] = useState<CampaignReport[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useTelegramWebApp();
  const { currentAdAccountId, multiAccountEnabled, platform } = useAppContext();
  const reportPlatform = platform === 'tiktok' ? 'tiktok' : 'facebook';

  const fetchReports = async () => {
    if (!user?.id) {
      console.warn('Нет идентификатора пользователя Telegram для получения отчетов');
      return;
    }

    if (multiAccountEnabled && !currentAdAccountId) {
      console.warn('Мультиаккаунт: отчет не запрошен, аккаунт не выбран');
      setReports([]);
      return;
    }

    setLoading(true);
    try {
      console.log('Загрузка отчетов для пользователя с Telegram ID:', user.id);

      const params = new URLSearchParams();
      params.set('platform', reportPlatform);
      if (multiAccountEnabled && currentAdAccountId) {
        params.set('accountId', currentAdAccountId);
      }

      const response = await fetch(`${API_BASE_URL}/campaign-reports?${params}`, {
        headers: { 'x-user-id': user.id.toString() },
      });

      if (!response.ok) {
        console.error('Ошибка при загрузке отчетов:', response.status);
        toastT.error('failedToLoadReports');
        return;
      }

      const data = await response.json();

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
  }, [user?.id, currentAdAccountId, multiAccountEnabled, platform]);

  return {
    reports,
    loading,
    refetch: fetchReports
  };
};
