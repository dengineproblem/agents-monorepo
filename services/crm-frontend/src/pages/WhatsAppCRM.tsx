import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { KanbanBoard } from '@/components/whatsapp-crm/KanbanBoard';
import { AddLeadModal } from '@/components/whatsapp-crm/AddLeadModal';
import { DialogDetailModal } from '@/components/dialogs/DialogDetailModal';
import { DialogFilters } from '@/components/dialogs/DialogFilters';
import { OnboardingModal } from '@/components/onboarding/OnboardingModal';
import { LoadLeadsModal } from '@/components/dialogs/LoadLeadsModal';
import { CampaignQueueModal } from '@/components/dialogs/CampaignQueueModal';
import { Button } from '@/components/ui/button';
import { dialogAnalysisService } from '@/services/dialogAnalysisService';
import { DialogAnalysis, DialogFilters as DialogFiltersType, FunnelStage } from '@/types/dialogAnalysis';
import { Plus, Download, RefreshCw, Filter, Moon, Sun, Send, Play } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function WhatsAppCRM() {
  const queryClient = useQueryClient();
  
  // Hardcoded user account ID - в реальном приложении получать из auth
  const userAccountId = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';
  
  // State
  const [filters, setFilters] = useState<DialogFiltersType>({});
  const [selectedDialog, setSelectedDialog] = useState<DialogAnalysis | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isLoadLeadsModalOpen, setIsLoadLeadsModalOpen] = useState(false);
  const [isCampaignQueueModalOpen, setIsCampaignQueueModalOpen] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved === 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

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

  // Check for business profile (onboarding)
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['business-profile', userAccountId],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/crm/business-profile/${userAccountId}`);
        
        // Если 404 - профиля нет, это нормально
        if (response.status === 404) {
          return null;
        }
        
        if (!response.ok) {
          throw new Error('Failed to fetch profile');
        }
        
        const data = await response.json();
        return data.profile;
      } catch (error) {
        console.error('Error fetching profile:', error);
        // При ошибке возвращаем null (покажем онбординг)
        return null;
      }
    },
  });

  // Show onboarding if no profile exists
  useEffect(() => {
    // Ждем завершения загрузки
    if (profileLoading) return;
    
    // Показываем онбординг если профиля нет или была ошибка
    if (profile === null || profile === undefined) {
      setNeedsOnboarding(true);
    }
  }, [profile, profileLoading]);

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

  // Analyze dialogs mutation
  const analyzeDialogsMutation = useMutation({
    mutationFn: async ({ maxDialogs }: { maxDialogs: number }) => {
      return dialogAnalysisService.analyzeDialogs({
        userAccountId,
        instanceName: '', // Backend will auto-detect from user_account_id
        minIncoming: 3,
        maxDialogs,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
      setIsLoadLeadsModalOpen(false);
      toast({ 
        title: '✅ Анализ запущен!',
        description: `Найдено диалогов: ${data.dialogsFound || 0}. Обновите страницу через минуту.`
      });
    },
    onError: (error: any) => {
      toast({ 
        title: 'Ошибка при анализе',
        description: error.message,
        variant: 'destructive' 
      });
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
      <div className="container mx-auto p-6 min-h-screen">
        {/* Compact Toolbar */}
        <TooltipProvider>
          <div className="flex items-center justify-between mb-6 bg-card rounded-lg shadow-sm p-3 border">
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    onClick={() => setIsAddModalOpen(true)} 
                    variant="ghost" 
                    size="icon"
                    className="h-9 w-9"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Добавить лида</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    onClick={handleExportCsv} 
                    variant="ghost" 
                    size="icon"
                    className="h-9 w-9"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Экспорт CSV</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    onClick={() => setShowFilters(!showFilters)} 
                    variant="ghost" 
                    size="icon"
                    className={`h-9 w-9 ${showFilters ? 'bg-accent' : ''}`}
                  >
                    <Filter className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Фильтры</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    onClick={() => refetch()} 
                    variant="ghost" 
                    size="icon"
                    className="h-9 w-9"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Обновить</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    onClick={() => setIsDarkMode(!isDarkMode)} 
                    variant="ghost" 
                    size="icon"
                    className="h-9 w-9"
                  >
                    {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Переключить тему</TooltipContent>
              </Tooltip>
            </div>

            <div className="flex items-center gap-2">
              {stats && (
                <div className="flex items-center gap-2 text-xs mr-2 bg-muted/30 px-2 py-1 rounded">
                  <span>🔥 <span className="font-semibold">{stats.hot || 0}</span></span>
                  <span>☀️ <span className="font-semibold">{stats.warm || 0}</span></span>
                  <span>❄️ <span className="font-semibold">{stats.cold || 0}</span></span>
                  <span className="border-l pl-2 ml-1">Всего: <span className="font-semibold">{stats.total || 0}</span></span>
                </div>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => setIsLoadLeadsModalOpen(true)}
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Запустить анализ всех диалогов</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => setIsCampaignQueueModalOpen(true)}
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Рассылки</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </TooltipProvider>

        {/* Filters */}
        {showFilters && (
          <div className="mb-6">
            <DialogFilters
              filters={filters}
              onFiltersChange={setFilters}
              onReset={handleResetFilters}
            />
          </div>
        )}

        {/* Kanban Board */}
        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            <p className="mt-4 text-gray-600">Загрузка лидов...</p>
          </div>
        ) : (
          <KanbanBoard
            leads={leads.filter(lead => {
              // Search filter
              if (filters.search) {
                const searchLower = filters.search.toLowerCase();
                const matchesPhone = lead.contact_phone?.toLowerCase().includes(searchLower);
                const matchesName = lead.contact_name?.toLowerCase().includes(searchLower);
                if (!matchesPhone && !matchesName) return false;
              }
              // Interest level filter
              if (filters.interestLevel && lead.interest_level !== filters.interestLevel) {
                return false;
              }
              // Funnel stage filter
              if (filters.funnelStage && lead.funnel_stage !== filters.funnelStage) {
                return false;
              }
              // Min score filter
              if (filters.minScore !== undefined && (lead.score || 0) < filters.minScore) {
                return false;
              }
              return true;
            })}
            onMoveCard={handleMoveCard}
            onCardClick={handleCardClick}
            onDelete={handleDeleteLead}
          />
        )}

        {/* Modals */}
        <LoadLeadsModal
          open={isLoadLeadsModalOpen}
          onClose={() => setIsLoadLeadsModalOpen(false)}
          onSubmit={(maxDialogs) => {
            analyzeDialogsMutation.mutate({ maxDialogs });
          }}
          isLoading={analyzeDialogsMutation.isPending}
        />

        <CampaignQueueModal
          open={isCampaignQueueModalOpen}
          onClose={() => setIsCampaignQueueModalOpen(false)}
        />

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

        <OnboardingModal
          open={needsOnboarding}
          userAccountId={userAccountId}
          onComplete={() => {
            setNeedsOnboarding(false);
            queryClient.invalidateQueries({ queryKey: ['business-profile'] });
          }}
        />
      </div>
    </DndProvider>
  );
}
