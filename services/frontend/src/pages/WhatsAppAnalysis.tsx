import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dialogAnalysisService } from '@/services/dialogAnalysisService';
import { DialogAnalysis, DialogFilters as DialogFiltersType } from '@/types/dialogAnalysis';
import { DialogStats } from '@/components/dialogs/DialogStats';
import { DialogFilters } from '@/components/dialogs/DialogFilters';
import { DialogCard } from '@/components/dialogs/DialogCard';
import { DialogDetailModal } from '@/components/dialogs/DialogDetailModal';
import { Button } from '@/components/ui/button';
import { Download, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function WhatsAppAnalysis() {
  const { toast } = useToast();
  const [filters, setFilters] = useState<DialogFiltersType>({});
  const [selectedDialog, setSelectedDialog] = useState<DialogAnalysis | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  // Get user from localStorage
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const userAccountId = user.id;

  // Fetch statistics
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ['dialog-stats', userAccountId],
    queryFn: () => dialogAnalysisService.getStats(userAccountId),
    enabled: !!userAccountId,
  });

  // Fetch analysis results
  const { data: analysisData, isLoading: analysisLoading, refetch: refetchAnalysis } = useQuery({
    queryKey: ['dialog-analysis', userAccountId, filters],
    queryFn: () => dialogAnalysisService.getAnalysis(userAccountId, filters),
    enabled: !!userAccountId,
  });

  // Filter results by search on client side
  const filteredResults = useMemo(() => {
    if (!analysisData?.results) return [];
    
    let results = analysisData.results;
    
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      results = results.filter(
        (dialog) =>
          dialog.contact_phone.toLowerCase().includes(searchLower) ||
          dialog.contact_name?.toLowerCase().includes(searchLower)
      );
    }
    
    return results;
  }, [analysisData, filters.search]);

  const handleRefresh = () => {
    refetchStats();
    refetchAnalysis();
    toast({
      title: 'Обновлено',
      description: 'Данные успешно обновлены',
    });
  };

  const handleResetFilters = () => {
    setFilters({});
  };

  const handleViewDetails = (dialog: DialogAnalysis) => {
    setSelectedDialog(dialog);
    setDetailModalOpen(true);
  };

  const handleExportCsv = async () => {
    try {
      const blob = await dialogAnalysisService.exportToCsv(userAccountId, filters);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `whatsapp-analysis-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: 'Экспорт выполнен',
        description: 'CSV файл загружен',
      });
    } catch (error) {
      toast({
        title: 'Ошибка экспорта',
        description: 'Не удалось экспортировать данные',
        variant: 'destructive',
      });
    }
  };

  if (!userAccountId) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600">Ошибка</h1>
          <p className="text-gray-600 mt-2">Пользователь не авторизован</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">📊 Анализ WhatsApp диалогов</h1>
          <p className="text-gray-600 mt-1">
            Результаты анализа диалогов с использованием GPT-5-mini
          </p>
        </div>
        
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Обновить
          </Button>
          <Button onClick={handleExportCsv}>
            <Download className="w-4 h-4 mr-2" />
            Экспорт CSV
          </Button>
        </div>
      </div>

      {/* Statistics */}
      <DialogStats stats={stats || null} loading={statsLoading} />

      {/* Filters */}
      <DialogFilters
        filters={filters}
        onFiltersChange={setFilters}
        onReset={handleResetFilters}
      />

      {/* Results Count */}
      <div className="mb-4 text-sm text-gray-600">
        Найдено диалогов: <span className="font-semibold">{filteredResults.length}</span>
      </div>

      {/* Loading State */}
      {analysisLoading && (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="text-gray-600 mt-4">Загрузка диалогов...</p>
        </div>
      )}

      {/* Empty State */}
      {!analysisLoading && filteredResults.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed">
          <p className="text-gray-600 text-lg">Нет диалогов для отображения</p>
          <p className="text-gray-500 text-sm mt-2">
            Попробуйте изменить фильтры или запустите анализ диалогов
          </p>
        </div>
      )}

      {/* Dialog Cards */}
      {!analysisLoading && filteredResults.length > 0 && (
        <div className="grid gap-4">
          {filteredResults.map((dialog) => (
            <DialogCard
              key={dialog.id}
              dialog={dialog}
              onViewDetails={handleViewDetails}
            />
          ))}
        </div>
      )}

      {/* Detail Modal */}
      <DialogDetailModal
        dialog={selectedDialog}
        open={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
      />
    </div>
  );
}

