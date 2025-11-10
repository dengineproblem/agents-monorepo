import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { KanbanBoard } from '@/components/whatsapp-crm/KanbanBoard';
import { AddLeadModal } from '@/components/whatsapp-crm/AddLeadModal';
import { DialogDetailModal } from '@/components/dialogs/DialogDetailModal';
import { DialogFilters } from '@/components/dialogs/DialogFilters';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { dialogAnalysisService } from '@/services/dialogAnalysisService';
import { DialogAnalysis, DialogFilters as DialogFiltersType, FunnelStage } from '@/types/dialogAnalysis';
import { Plus, Download, RefreshCw } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export function WhatsAppCRM() {
  const queryClient = useQueryClient();
  
  // Hardcoded user account ID - в реальном приложении получать из auth
  const userAccountId = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';
  
  // State
  const [filters, setFilters] = useState<DialogFiltersType>({});
  const [selectedDialog, setSelectedDialog] = useState<DialogAnalysis | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Fetch leads
  const { data: leads = [], isLoading, refetch } = useQuery({
    queryKey: ['leads', userAccountId, filters],
    queryFn: () => dialogAnalysisService.getAnalysis(userAccountId, filters),
  });

  // Fetch stats
  const { data: stats } = useQuery({
    queryKey: ['lead-stats', userAccountId],
    queryFn: () => dialogAnalysisService.getStats(userAccountId),
  });

  // Update lead stage mutation
  const updateStageMutation = useMutation({
    mutationFn: ({ leadId, newStage }: { leadId: string; newStage: FunnelStage }) =>
      dialogAnalysisService.updateLeadStage(leadId, newStage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
      toast({ title: 'Этап воронки обновлён' });
    },
    onError: () => {
      toast({ title: 'Ошибка при обновлении этапа', variant: 'destructive' });
    },
  });

  // Add lead mutation
  const addLeadMutation = useMutation({
    mutationFn: (leadData: any) => dialogAnalysisService.addLead(userAccountId, leadData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
      toast({ title: 'Лид добавлен успешно' });
    },
    onError: () => {
      toast({ title: 'Ошибка при добавлении лида', variant: 'destructive' });
    },
  });

  // Delete lead mutation
  const deleteLeadMutation = useMutation({
    mutationFn: (leadId: string) => dialogAnalysisService.deleteLead(leadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
      toast({ title: 'Лид удалён' });
    },
    onError: () => {
      toast({ title: 'Ошибка при удалении лида', variant: 'destructive' });
    },
  });

  // Handlers
  const handleMoveCard = (leadId: string, newStage: FunnelStage) => {
    updateStageMutation.mutate({ leadId, newStage });
  };

  const handleCardClick = (lead: DialogAnalysis) => {
    setSelectedDialog(lead);
    setIsDetailModalOpen(true);
  };

  const handleAddLead = (leadData: any) => {
    addLeadMutation.mutate(leadData);
  };

  const handleDeleteLead = (lead: DialogAnalysis) => {
    if (confirm(`Вы уверены, что хотите удалить лида ${lead.contact_name || lead.contact_phone}?`)) {
      deleteLeadMutation.mutate(lead.id);
    }
  };

  const handleExportCsv = async () => {
    try {
      const csvData = await dialogAnalysisService.exportCsv(userAccountId, filters);
      const blob = new Blob([csvData], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads-${new Date().toISOString()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({ title: 'CSV экспортирован' });
    } catch (error) {
      toast({ title: 'Ошибка при экспорте CSV', variant: 'destructive' });
    }
  };

  const handleResetFilters = () => {
    setFilters({});
  };

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="container mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">WhatsApp CRM</h1>
          <div className="flex gap-2">
            <Button onClick={() => refetch()} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Обновить
            </Button>
            <Button onClick={handleExportCsv} variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Экспорт CSV
            </Button>
            <Button onClick={() => setIsAddModalOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Добавить лида
            </Button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="p-6">
                <div className="text-3xl font-bold text-red-600">{stats.hot}</div>
                <div className="text-sm text-gray-600">🔥 Горячие</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-3xl font-bold text-orange-600">{stats.warm}</div>
                <div className="text-sm text-gray-600">☀️ Тёплые</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-3xl font-bold text-blue-600">{stats.cold}</div>
                <div className="text-sm text-gray-600">❄️ Холодные</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-3xl font-bold text-gray-600">{stats.total}</div>
                <div className="text-sm text-gray-600">📊 Всего</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters */}
        <DialogFilters
          filters={filters}
          onFiltersChange={setFilters}
          onReset={handleResetFilters}
        />

        {/* Kanban Board */}
        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            <p className="mt-4 text-gray-600">Загрузка лидов...</p>
          </div>
        ) : (
          <KanbanBoard
            leads={leads}
            onMoveCard={handleMoveCard}
            onCardClick={handleCardClick}
            onDelete={handleDeleteLead}
          />
        )}

        {/* Modals */}
        <AddLeadModal
          open={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          onSubmit={handleAddLead}
          userAccountId={userAccountId}
        />

        <DialogDetailModal
          dialog={selectedDialog}
          open={isDetailModalOpen}
          onClose={() => {
            setIsDetailModalOpen(false);
            setSelectedDialog(null);
          }}
        />
      </div>
    </DndProvider>
  );
}
