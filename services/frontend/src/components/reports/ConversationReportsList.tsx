import { useState } from 'react';
import { ConversationReport } from '@/types/conversationReport';
import { ConversationReportCard } from './ConversationReportCard';
import { ConversationReportDetail } from './ConversationReportDetail';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { RefreshCw, Plus, ChevronLeft, ChevronRight } from 'lucide-react';

interface ConversationReportsListProps {
  reports: ConversationReport[];
  loading?: boolean;
  generating?: boolean;
  hasMore?: boolean;
  hasPrevious?: boolean;
  onGenerate?: () => void;
  onLoadMore?: () => void;
  onLoadPrevious?: () => void;
  onRefresh?: () => void;
}

export function ConversationReportsList({
  reports,
  loading = false,
  generating = false,
  hasMore = false,
  hasPrevious = false,
  onGenerate,
  onLoadMore,
  onLoadPrevious,
  onRefresh,
}: ConversationReportsListProps) {
  const [selectedReport, setSelectedReport] = useState<ConversationReport | null>(null);

  if (selectedReport) {
    return (
      <ConversationReportDetail
        report={selectedReport}
        onBack={() => setSelectedReport(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Отчёты по перепискам</h2>
        <div className="flex gap-2">
          {onRefresh && (
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Обновить
            </Button>
          )}
          {onGenerate && (
            <Button size="sm" onClick={onGenerate} disabled={generating}>
              <Plus className="w-4 h-4 mr-2" />
              {generating ? 'Генерация...' : 'Создать отчёт'}
            </Button>
          )}
        </div>
      </div>

      {/* Loading state */}
      {loading && reports.length === 0 && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-4"></div>
                <div className="h-20 bg-gray-200 rounded"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && reports.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="text-gray-400 text-6xl mb-4">📊</div>
            <h3 className="text-lg font-medium text-gray-700 mb-2">
              Нет отчётов
            </h3>
            <p className="text-gray-500 mb-4">
              Отчёты генерируются автоматически каждый день в 9:30.
              Вы также можете создать отчёт вручную.
            </p>
            {onGenerate && (
              <Button onClick={onGenerate} disabled={generating}>
                <Plus className="w-4 h-4 mr-2" />
                {generating ? 'Генерация...' : 'Создать первый отчёт'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Reports list */}
      {reports.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {reports.map((report) => (
            <ConversationReportCard
              key={report.id}
              report={report}
              onClick={() => setSelectedReport(report)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {(hasMore || hasPrevious) && (
        <div className="flex justify-center gap-4 mt-6">
          {hasPrevious && onLoadPrevious && (
            <Button variant="outline" onClick={onLoadPrevious} disabled={loading}>
              <ChevronLeft className="w-4 h-4 mr-2" />
              Назад
            </Button>
          )}
          {hasMore && onLoadMore && (
            <Button variant="outline" onClick={onLoadMore} disabled={loading}>
              Ещё
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
