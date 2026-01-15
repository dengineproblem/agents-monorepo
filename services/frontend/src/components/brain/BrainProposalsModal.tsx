import { useState, useCallback, useEffect } from 'react';
import { Brain, AlertCircle, CheckCircle2, Loader2, Clock, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { PendingProposal, BrainProposal, BrainProposalsModalState } from '@/hooks/useBrainProposals';

interface BrainProposalsModalProps {
  modalState: BrainProposalsModalState;
  onClose: () => void;
  onApprove: (proposalId: string, stepIndices: number[]) => Promise<boolean>;
  onReject: (proposalId: string) => Promise<boolean>;
  onPostpone: () => void;
}

/**
 * Модальное окно для одобрения/отклонения Brain proposals
 */
export function BrainProposalsModal({
  modalState,
  onClose,
  onApprove,
  onReject,
  onPostpone,
}: BrainProposalsModalProps) {
  const { isOpen, proposal, isLoading, isExecuting, error } = modalState;

  // Состояние для выбранных proposals
  const [selectedSteps, setSelectedSteps] = useState<Set<number>>(new Set());

  // Количество proposals и выбранных
  const proposalsCount = proposal?.proposals?.length ?? 0;
  const selectedCount = selectedSteps.size;
  const allSelected = proposalsCount > 0 && selectedCount === proposalsCount;

  // Переключить выбор
  const toggleStep = useCallback((index: number) => {
    setSelectedSteps(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // Выбрать/снять все
  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedSteps(new Set());
    } else {
      setSelectedSteps(new Set(Array.from({ length: proposalsCount }, (_, i) => i)));
    }
  }, [allSelected, proposalsCount]);

  // Сбросить выбор при смене proposal
  useEffect(() => {
    if (proposal?.proposals) {
      // По умолчанию выбираем все
      setSelectedSteps(new Set(Array.from({ length: proposal.proposals.length }, (_, i) => i)));
    } else {
      setSelectedSteps(new Set());
    }
  }, [proposal]);

  // Обработчик одобрения
  const handleApprove = useCallback(async () => {
    if (!proposal || selectedCount === 0) return;
    const indices = Array.from(selectedSteps).sort((a, b) => a - b);
    await onApprove(proposal.id, indices);
  }, [proposal, selectedSteps, selectedCount, onApprove]);

  // Обработчик отклонения
  const handleReject = useCallback(async () => {
    if (!proposal) return;
    await onReject(proposal.id);
  }, [proposal, onReject]);

  if (!isOpen) return null;

  const hasProposals = proposal?.proposals && proposal.proposals.length > 0;
  const showApproveButtons = !isLoading && !error && hasProposals && selectedCount > 0;

  // Время до истечения
  const expiresAt = proposal?.expires_at ? new Date(proposal.expires_at) : null;
  const now = new Date();
  const hoursLeft = expiresAt ? Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60))) : null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-500" />
            Предложения Brain
          </DialogTitle>
          {proposal && (
            <DialogDescription className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="text-xs">
                {proposal.ad_account_name || 'Рекламный аккаунт'}
              </Badge>
              {hoursLeft !== null && hoursLeft <= 24 && (
                <Badge variant="outline" className="text-xs flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {hoursLeft > 0 ? `Истекает через ${hoursLeft}ч` : 'Истекает скоро'}
                </Badge>
              )}
            </DialogDescription>
          )}
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-[200px] max-h-[50vh] pr-4 overflow-y-auto">
          {/* Loading State */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground">
                Загрузка предложений...
              </p>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <AlertCircle className="h-12 w-12 text-destructive mb-4" />
              <p className="text-sm text-destructive font-medium mb-2">
                Ошибка
              </p>
              <p className="text-xs text-muted-foreground max-w-sm">
                {error}
              </p>
            </div>
          )}

          {/* Summary */}
          {!isLoading && !error && proposal?.context?.summary && typeof proposal.context.summary === 'string' && (
            <div className="mb-4 p-3 bg-muted/30 rounded-lg">
              <p className="text-sm text-muted-foreground">
                {proposal.context.summary}
              </p>
            </div>
          )}

          {/* Proposals List */}
          {!isLoading && !error && proposal && (
            <div className="space-y-4">
              {hasProposals ? (
                <div className="space-y-2">
                  {/* Выбрать всё */}
                  <div className="flex items-center gap-2 pb-2 border-b">
                    <Checkbox
                      id="select-all-proposals"
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                    />
                    <label
                      htmlFor="select-all-proposals"
                      className="text-sm font-medium cursor-pointer select-none"
                    >
                      {allSelected ? 'Снять выбор' : 'Выбрать всё'} ({selectedCount}/{proposalsCount})
                    </label>
                  </div>

                  {/* Список proposals с группировкой по направлениям */}
                  {(() => {
                    // Группируем proposals по direction_name
                    const grouped = new Map<string, { proposals: typeof proposal.proposals; indices: number[] }>();
                    proposal.proposals.forEach((p, index) => {
                      const dirName = p.direction_name || 'Без направления';
                      if (!grouped.has(dirName)) {
                        grouped.set(dirName, { proposals: [], indices: [] });
                      }
                      grouped.get(dirName)!.proposals.push(p);
                      grouped.get(dirName)!.indices.push(index);
                    });

                    // Если все в одном направлении - не показываем заголовок группы
                    const showGroups = grouped.size > 1 || !grouped.has('Без направления');

                    return Array.from(grouped.entries()).map(([dirName, group]) => (
                      <div key={dirName} className="space-y-2">
                        {showGroups && (
                          <div className="flex items-center gap-2 mt-3 mb-1">
                            <Badge variant="outline" className="text-xs font-medium">
                              {dirName}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              ({group.proposals.length})
                            </span>
                          </div>
                        )}
                        {group.proposals.map((p, i) => (
                          <ProposalItem
                            key={group.indices[i]}
                            proposal={p}
                            index={group.indices[i]}
                            checked={selectedSteps.has(group.indices[i])}
                            onToggle={() => toggleStep(group.indices[i])}
                          />
                        ))}
                      </div>
                    ));
                  })()}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
                  <p className="text-sm font-medium mb-2">
                    Нет предложений
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Все показатели в норме
                  </p>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="mt-4 flex-wrap gap-2">
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              onClick={onPostpone}
              disabled={isExecuting}
              className="flex-1 sm:flex-none"
            >
              Позже
            </Button>
            {hasProposals && (
              <Button
                variant="ghost"
                onClick={handleReject}
                disabled={isExecuting}
                className="text-destructive hover:text-destructive flex-1 sm:flex-none"
              >
                <X className="h-4 w-4 mr-1" />
                Отклонить
              </Button>
            )}
          </div>

          {showApproveButtons && (
            <Button
              onClick={handleApprove}
              disabled={isExecuting}
              className="w-full sm:w-auto"
            >
              {isExecuting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Выполняю...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Одобрить ({selectedCount})
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ProposalItemProps {
  proposal: BrainProposal;
  index: number;
  checked: boolean;
  onToggle: () => void;
}

/**
 * Получить метку действия
 */
function getActionLabel(action: string, params?: Record<string, any>): string {
  switch (action) {
    case 'update_budget':
    case 'updateBudget':
      if (params?.new_budget_cents) {
        const newBudget = (params.new_budget_cents / 100).toFixed(2);
        if (params.current_budget_cents) {
          const currentBudget = (params.current_budget_cents / 100).toFixed(2);
          return `$${currentBudget} → $${newBudget}`;
        }
        return `Бюджет → $${newBudget}`;
      }
      return 'Изменить бюджет';
    case 'pause_adset':
    case 'pauseAdSet':
      return 'Поставить на паузу';
    case 'pause_ad':
    case 'pauseAd':
      return 'Остановить объявление';
    case 'enable_adset':
    case 'enableAdSet':
      return 'Включить адсет';
    case 'enable_ad':
    case 'enableAd':
      return 'Включить объявление';
    case 'review':
      return 'Требует внимания';
    default:
      return action;
  }
}

/**
 * Получить иконку действия
 */
function getActionIcon(action: string): string {
  switch (action) {
    case 'update_budget':
    case 'updateBudget':
      return '💰';
    case 'pause_adset':
    case 'pauseAdSet':
    case 'pause_ad':
    case 'pauseAd':
      return '⏸️';
    case 'enable_adset':
    case 'enableAdSet':
    case 'enable_ad':
    case 'enableAd':
      return '▶️';
    case 'review':
      return '👀';
    default:
      return '🔧';
  }
}

/**
 * Перевод приоритета на русский
 */
function getPriorityLabel(priority: string): string {
  const labels: Record<string, string> = {
    critical: 'Критично',
    high: 'Высокий',
    medium: 'Средний',
    low: 'Низкий',
  };
  return labels[priority] || priority;
}

function ProposalItem({ proposal, index, checked, onToggle }: ProposalItemProps) {
  // Цвета границы по приоритету
  const priorityBorders: Record<string, string> = {
    critical: 'border-l-red-500',
    high: 'border-l-orange-400',
    medium: 'border-l-yellow-400',
    low: 'border-l-green-400',
  };

  // Цвета badge по приоритету
  const priorityBadges: Record<string, string> = {
    critical: 'bg-red-100 text-red-800 border-red-300',
    high: 'bg-orange-100 text-orange-800 border-orange-300',
    medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    low: 'bg-green-100 text-green-800 border-green-300',
  };

  const borderColor = priorityBorders[proposal.priority] || 'border-l-muted-foreground/30';
  const badgeClass = priorityBadges[proposal.priority] || '';

  return (
    <div
      className={cn(
        'p-3 rounded-md border-l-2 transition-colors',
        borderColor,
        checked ? 'bg-muted/30' : 'bg-muted/10 opacity-60'
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={checked}
          onCheckedChange={onToggle}
          className="mt-0.5"
        />
        <div className="flex-1 min-w-0">
          {/* Название сущности */}
          {proposal.entity_name && (
            <p className="text-xs text-muted-foreground mb-1 truncate">
              {proposal.entity_name}
            </p>
          )}

          {/* Действие и приоритет */}
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground">
              {getActionIcon(proposal.action)} {getActionLabel(proposal.action, proposal.suggested_action_params)}
            </p>
            <Badge variant="outline" className={cn('text-xs', badgeClass)}>
              {getPriorityLabel(proposal.priority)}
            </Badge>
            {proposal.health_score !== undefined && (
              <span className="text-xs text-muted-foreground">
                HS: {proposal.health_score}
              </span>
            )}
          </div>

          {/* Причина */}
          <p className="text-sm text-muted-foreground mt-1">
            {proposal.reason}
          </p>

          {/* Метрики */}
          {proposal.metrics && Object.keys(proposal.metrics).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {proposal.metrics.spend !== undefined && (
                <span className="text-xs text-muted-foreground">
                  Расход: ${(proposal.metrics.spend / 100).toFixed(2)}
                </span>
              )}
              {proposal.metrics.leads !== undefined && (
                <span className="text-xs text-muted-foreground">
                  Лиды: {proposal.metrics.leads}
                </span>
              )}
              {proposal.metrics.cpl !== undefined && (
                <span className="text-xs text-muted-foreground">
                  CPL: ${(proposal.metrics.cpl / 100).toFixed(2)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default BrainProposalsModal;
