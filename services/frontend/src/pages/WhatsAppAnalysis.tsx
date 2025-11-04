import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { dialogAnalysisService } from '@/services/dialogAnalysisService';
import { DialogAnalysis, FunnelStage, DialogFilters as DialogFiltersType } from '@/types/dialogAnalysis';
import { KanbanBoard } from '@/components/whatsapp-crm/KanbanBoard';
import { AddLeadModal } from '@/components/whatsapp-crm/AddLeadModal';
import { DialogDetailModal } from '@/components/dialogs/DialogDetailModal';
import { useToast } from '@/hooks/use-toast';
import Header from '@/components/Header';
import PageHero from '@/components/common/PageHero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Plus, 
  Filter, 
  Download,
  TrendingUp,
  Users,
  Flame,
  Snowflake,
  LayoutGrid,
  List,
  TableIcon
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DialogFilters } from '@/components/dialogs/DialogFilters';

export default function WhatsAppAnalysis() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedDialog, setSelectedDialog] = useState<DialogAnalysis | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [addLeadModalOpen, setAddLeadModalOpen] = useState(false);
  const [filters, setFilters] = useState<DialogFiltersType>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeView, setActiveView] = useState<'kanban' | 'list' | 'table'>('kanban');

  // Get user from localStorage
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const userAccountId = user.id;

  // Fetch leads
  const { data: analysisData, isLoading } = useQuery({
    queryKey: ['dialog-analysis', userAccountId, filters],
    queryFn: () => dialogAnalysisService.getAnalysis(userAccountId, filters),
    enabled: !!userAccountId,
    refetchInterval: 30000,
  });

  // Update funnel stage mutation
  const updateStageMutation = useMutation({
    mutationFn: ({ leadId, newStage }: { leadId: string; newStage: FunnelStage }) =>
      dialogAnalysisService.updateLead(leadId, userAccountId, { funnelStage: newStage }),
    onSuccess: () => {
      queryClient.invalidateQueries(['dialog-analysis']);
      toast({ 
        title: '✅ Лид перемещен',
        description: 'Статус лида обновлен',
      });
    },
    onError: (error: any) => {
      toast({ 
        title: '❌ Ошибка',
        description: error.message || 'Не удалось переместить лида',
        variant: 'destructive',
      });
    },
  });

  // Create lead mutation
  const createLeadMutation = useMutation({
    mutationFn: (data: any) =>
      dialogAnalysisService.createLead({
        ...data,
        userAccountId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries(['dialog-analysis']);
      toast({ 
        title: '✅ Лид создан',
        description: 'Новый лид добавлен в систему',
      });
    },
    onError: (error: any) => {
      toast({ 
        title: '❌ Ошибка',
        description: error.message || 'Не удалось создать лида',
        variant: 'destructive',
      });
    },
  });

  // Delete lead mutation
  const deleteLeadMutation = useMutation({
    mutationFn: (leadId: string) =>
      dialogAnalysisService.deleteAnalysis(leadId, userAccountId),
    onSuccess: () => {
      queryClient.invalidateQueries(['dialog-analysis']);
      toast({ 
        title: '✅ Лид удален',
        description: 'Лид удален из системы',
      });
    },
    onError: (error: any) => {
      toast({ 
        title: '❌ Ошибка',
        description: error.message || 'Не удалось удалить лида',
        variant: 'destructive',
      });
    },
  });

  const handleMoveCard = (leadId: string, newStage: FunnelStage) => {
    const lead = analysisData?.results.find(l => l.id === leadId);
    if (lead && lead.funnel_stage !== newStage) {
      updateStageMutation.mutate({ leadId, newStage });
    }
  };

  const handleAddLead = (data: any) => {
    createLeadMutation.mutate(data);
  };

  const handleDeleteLead = (lead: DialogAnalysis) => {
    if (confirm(`Удалить лида ${lead.contact_name || lead.contact_phone}?`)) {
      deleteLeadMutation.mutate(lead.id);
    }
  };

  const handleResetFilters = () => {
    setFilters({});
  };

  const handleExport = async () => {
    try {
      const blob = await dialogAnalysisService.exportToCsv(userAccountId, filters);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `whatsapp-leads-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({ title: '✅ Экспорт завершен' });
    } catch (error: any) {
      toast({ 
        title: '❌ Ошибка экспорта',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  // Calculate stats
  const leads = analysisData?.results || [];
  const hotCount = leads.filter(l => l.interest_level === 'hot').length;
  const warmCount = leads.filter(l => l.interest_level === 'warm').length;
  const coldCount = leads.filter(l => l.interest_level === 'cold').length;
  const totalCount = leads.length;

  if (!userAccountId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Card>
          <CardContent className="p-8 text-center">
            <h1 className="text-2xl font-bold text-red-600 mb-2">Ошибка</h1>
            <p className="text-gray-600">Пользователь не авторизован</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <>
        <Header />
        <div className="flex items-center justify-center h-[calc(100vh-60px)]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 text-lg">Загрузка лидов...</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="min-h-screen bg-background">
        <Header />
        
        {/* Hero Section */}
        <PageHero
          title="WhatsApp CRM"
          description="Управление лидами из WhatsApp с AI-анализом"
        >
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAddLeadModalOpen(true)} size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Новый лид
            </Button>
            
            <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter className="w-4 h-4 mr-2" />
                  Фильтры
                  {(filters.interestLevel || filters.funnelStage || filters.minScore) && (
                    <Badge variant="secondary" className="ml-2">
                      {Object.keys(filters).filter(k => filters[k as keyof DialogFiltersType]).length}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-96" align="start">
                <DialogFilters
                  filters={filters}
                  onFiltersChange={setFilters}
                  onReset={handleResetFilters}
                />
              </PopoverContent>
            </Popover>

            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="w-4 h-4 mr-2" />
              Экспорт
            </Button>
          </div>
        </PageHero>

        {/* Stats Cards */}
        <div className="container mx-auto px-4 py-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">HOT лиды</CardTitle>
                <Flame className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">{hotCount}</div>
                <p className="text-xs text-muted-foreground">
                  Высокий приоритет
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">WARM лиды</CardTitle>
                <TrendingUp className="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">{warmCount}</div>
                <p className="text-xs text-muted-foreground">
                  Средний приоритет
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">COLD лиды</CardTitle>
                <Snowflake className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">{coldCount}</div>
                <p className="text-xs text-muted-foreground">
                  Низкий приоритет
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Всего лидов</CardTitle>
                <Users className="h-4 w-4 text-gray-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalCount}</div>
                <p className="text-xs text-muted-foreground">
                  В системе
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Tabs */}
          <Tabs value={activeView} onValueChange={(v) => setActiveView(v as any)} className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="kanban">
                <LayoutGrid className="w-4 h-4 mr-2" />
                Kanban
              </TabsTrigger>
              <TabsTrigger value="list">
                <List className="w-4 h-4 mr-2" />
                Список
              </TabsTrigger>
              <TabsTrigger value="table">
                <TableIcon className="w-4 h-4 mr-2" />
                Таблица
              </TabsTrigger>
            </TabsList>

            <TabsContent value="kanban" className="mt-0">
              <KanbanBoard
                leads={leads}
                onMoveCard={handleMoveCard}
                onCardClick={(lead) => {
                  setSelectedDialog(lead);
                  setDetailModalOpen(true);
                }}
                onDelete={handleDeleteLead}
              />
            </TabsContent>

            <TabsContent value="list" className="mt-0">
              <Card>
                <CardContent className="p-6">
                  <p className="text-center text-muted-foreground">
                    Список режим в разработке
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="table" className="mt-0">
              <Card>
                <CardContent className="p-6">
                  <p className="text-center text-muted-foreground">
                    Табличный режим в разработке
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Modals */}
        <DialogDetailModal
          dialog={selectedDialog}
          open={detailModalOpen}
          onClose={() => {
            setDetailModalOpen(false);
            setSelectedDialog(null);
          }}
        />

        <AddLeadModal
          open={addLeadModalOpen}
          onClose={() => setAddLeadModalOpen(false)}
          onSubmit={handleAddLead}
          userAccountId={userAccountId}
        />
      </div>
    </DndProvider>
  );
}
