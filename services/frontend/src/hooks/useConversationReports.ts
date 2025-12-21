import { useState, useEffect, useCallback } from 'react';
import { ConversationReport, ConversationReportStats } from '@/types/conversationReport';
import { conversationReportService } from '@/services/conversationReportService';
import { toast } from 'sonner';

interface UseConversationReportsOptions {
  userAccountId: string | null;
  autoFetch?: boolean;
  limit?: number;
}

export function useConversationReports(options: UseConversationReportsOptions) {
  const { userAccountId, autoFetch = true, limit = 30 } = options;

  const [reports, setReports] = useState<ConversationReport[]>([]);
  const [latestReport, setLatestReport] = useState<ConversationReport | null>(null);
  const [stats, setStats] = useState<ConversationReportStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  // Загрузка списка отчётов
  const fetchReports = useCallback(async (newOffset = 0) => {
    if (!userAccountId) return;

    setLoading(true);
    try {
      const result = await conversationReportService.getReports(userAccountId, {
        limit,
        offset: newOffset,
      });
      setReports(result.reports);
      setTotal(result.total);
      setOffset(newOffset);
    } catch (error: any) {
      console.error('Failed to fetch reports:', error);
      toast.error('Не удалось загрузить отчёты');
    } finally {
      setLoading(false);
    }
  }, [userAccountId, limit]);

  // Загрузка последнего отчёта
  const fetchLatestReport = useCallback(async () => {
    if (!userAccountId) return;

    try {
      const report = await conversationReportService.getLatestReport(userAccountId);
      setLatestReport(report);
    } catch (error: any) {
      console.error('Failed to fetch latest report:', error);
    }
  }, [userAccountId]);

  // Загрузка статистики
  const fetchStats = useCallback(async (days = 7) => {
    if (!userAccountId) return;

    try {
      const statsData = await conversationReportService.getStats(userAccountId, days);
      setStats(statsData);
    } catch (error: any) {
      console.error('Failed to fetch stats:', error);
    }
  }, [userAccountId]);

  // Генерация нового отчёта
  const generateReport = useCallback(async (date?: string) => {
    if (!userAccountId) return null;

    setGenerating(true);
    try {
      const report = await conversationReportService.generateReport(userAccountId, date);
      toast.success('Отчёт успешно сгенерирован');

      // Обновляем списки
      await fetchReports();
      setLatestReport(report);

      return report;
    } catch (error: any) {
      console.error('Failed to generate report:', error);
      toast.error(error.message || 'Не удалось сгенерировать отчёт');
      return null;
    } finally {
      setGenerating(false);
    }
  }, [userAccountId, fetchReports]);

  // Пагинация
  const loadMore = useCallback(() => {
    if (loading || reports.length >= total) return;
    fetchReports(offset + limit);
  }, [loading, reports.length, total, offset, limit, fetchReports]);

  const loadPrevious = useCallback(() => {
    if (loading || offset === 0) return;
    fetchReports(Math.max(0, offset - limit));
  }, [loading, offset, limit, fetchReports]);

  // Автозагрузка при монтировании
  useEffect(() => {
    if (autoFetch && userAccountId) {
      fetchReports();
      fetchLatestReport();
      fetchStats();
    }
  }, [autoFetch, userAccountId, fetchReports, fetchLatestReport, fetchStats]);

  return {
    // Данные
    reports,
    latestReport,
    stats,
    total,
    offset,

    // Состояния
    loading,
    generating,
    hasMore: reports.length < total,
    hasPrevious: offset > 0,

    // Действия
    fetchReports,
    fetchLatestReport,
    fetchStats,
    generateReport,
    loadMore,
    loadPrevious,
    refetch: () => {
      fetchReports();
      fetchLatestReport();
      fetchStats();
    },
  };
}
