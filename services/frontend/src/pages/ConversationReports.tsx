import { useEffect } from 'react';
import { useUserAccounts } from '@/hooks/useUserAccounts';
import { useConversationReports } from '@/hooks/useConversationReports';
import { ConversationReportsList } from '@/components/reports/ConversationReportsList';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  MessageSquare,
  TrendingUp,
  Clock,
  BarChart3,
} from 'lucide-react';

export default function ConversationReports() {
  const { currentAccount } = useUserAccounts();

  const {
    reports,
    latestReport,
    stats,
    loading,
    generating,
    hasMore,
    hasPrevious,
    fetchReports,
    generateReport,
    loadMore,
    loadPrevious,
    refetch,
  } = useConversationReports({
    userAccountId: currentAccount?.id || null,
    autoFetch: true,
  });

  // Статистика за 7 дней
  const weekStats = stats;

  return (
    <div className="container mx-auto py-6 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Отчёты по перепискам</h1>
      </div>

      {/* Сводка за неделю */}
      {weekStats && weekStats.reports_count > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <BarChart3 className="w-4 h-4" />
                <span className="text-sm">Отчётов за 7 дней</span>
              </div>
              <div className="text-2xl font-bold">{weekStats.reports_count}</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <MessageSquare className="w-4 h-4" />
                <span className="text-sm">Всего диалогов</span>
              </div>
              <div className="text-2xl font-bold">{weekStats.total_dialogs}</div>
            </CardContent>
          </Card>

          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-green-700 mb-1">
                <TrendingUp className="w-4 h-4" />
                <span className="text-sm">Активных</span>
              </div>
              <div className="text-2xl font-bold text-green-600">
                {weekStats.total_active_dialogs}
              </div>
            </CardContent>
          </Card>

          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-blue-700 mb-1">
                <Clock className="w-4 h-4" />
                <span className="text-sm">Ср. ответ</span>
              </div>
              <div className="text-2xl font-bold text-blue-600">
                {weekStats.avg_response_time
                  ? `${Math.round(weekStats.avg_response_time)} мин`
                  : '—'}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Последний отчёт */}
      {latestReport && (
        <Card className="border-purple-200 bg-purple-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg text-purple-700">
              Последний отчёт
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-sm text-purple-600">Дата</div>
                <div className="font-medium">
                  {new Date(latestReport.report_date).toLocaleDateString('ru-RU')}
                </div>
              </div>
              <div>
                <div className="text-sm text-purple-600">Активных</div>
                <div className="font-medium">{latestReport.active_dialogs}</div>
              </div>
              <div>
                <div className="text-sm text-purple-600">Новых</div>
                <div className="font-medium">{latestReport.new_dialogs}</div>
              </div>
              <div>
                <div className="text-sm text-purple-600">Инсайтов</div>
                <div className="font-medium">{latestReport.insights?.length || 0}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Список отчётов */}
      <ConversationReportsList
        reports={reports}
        loading={loading}
        generating={generating}
        hasMore={hasMore}
        hasPrevious={hasPrevious}
        onGenerate={() => generateReport()}
        onLoadMore={loadMore}
        onLoadPrevious={loadPrevious}
        onRefresh={refetch}
      />
    </div>
  );
}
