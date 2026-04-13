import { useState, useCallback, useEffect } from 'react';
import { Brain, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
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
import { StreamingMessage, type StreamingState } from '@/components/assistant/StreamingMessage';
import { MarkdownRenderer } from '@/components/assistant/MarkdownRenderer';
import type { Plan } from '@/services/assistantApi';
import type { OptimizationScope } from '@/hooks/useOptimization';
import { cn } from '@/lib/utils';

interface OptimizationModalProps {
  open: boolean;
  onClose: () => void;
  scope: OptimizationScope | null;
  streamingState: StreamingState | null;
  plan: Plan | null;
  content: string | null; // Текстовый ответ от AI
  isLoading: boolean;
  error: string | null;
  onApprove: (stepIndices: number[]) => void; // Массив выбранных индексов
  onReject: () => void;
  isExecuting: boolean;
  progressMessage?: string | null; // Сообщение прогресса от Brain Mini
}

/**
 * Модальное окно с результатами Brain Mini оптимизации
 */
export function OptimizationModal({
  open,
  onClose,
  scope,
  streamingState,
  plan,
  content,
  isLoading,
  error,
  onApprove,
  onReject,
  isExecuting,
  progressMessage,
}: OptimizationModalProps) {
  // Состояние для выбранных шагов
  const [selectedSteps, setSelectedSteps] = useState<Set<number>>(new Set());

  // Количество шагов и выбранных
  const stepsCount = plan?.steps?.length ?? 0;
  const selectedCount = selectedSteps.size;
  const allSelected = stepsCount > 0 && selectedCount === stepsCount;

  // Переключить выбор шага
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
      setSelectedSteps(new Set(Array.from({ length: stepsCount }, (_, i) => i)));
    }
  }, [allSelected, stepsCount]);

  // Сбросить выбор при смене плана
  useEffect(() => {
    if (plan?.steps) {
      // По умолчанию выбираем все шаги
      setSelectedSteps(new Set(Array.from({ length: plan.steps.length }, (_, i) => i)));
    } else {
      setSelectedSteps(new Set());
    }
  }, [plan]);

  // Не рендерим Dialog пока не открыт
  if (!open) return null;

  const hasSteps = plan?.steps && plan.steps.length > 0;
  const showApproveButtons = !isLoading && !error && hasSteps && selectedCount > 0;

  // Subtitle based on scope
  const subtitle = scope?.directionId
    ? scope.directionName
    : scope?.accountName;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            AI-оптимизация
          </DialogTitle>
          {subtitle && (
            <DialogDescription className="flex items-center gap-2">
              {scope?.directionId ? (
                <Badge variant="outline" className="text-xs">
                  Направление
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">
                  Аккаунт
                </Badge>
              )}
              {subtitle}
            </DialogDescription>
          )}
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-[200px] max-h-[50vh] pr-4 overflow-y-auto">
          {/* Progress Message from Brain Mini */}
          {isLoading && progressMessage && (
            <div className="flex items-center gap-3 py-8">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">{progressMessage}</span>
            </div>
          )}

          {/* Streaming Progress (legacy, for backward compatibility) */}
          {isLoading && !progressMessage && streamingState && (
            <div className="py-2">
              <StreamingMessage state={streamingState} />
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <AlertCircle className="h-12 w-12 text-destructive mb-4" />
              <p className="text-sm text-destructive font-medium mb-2">
                Ошибка анализа
              </p>
              <p className="text-xs text-muted-foreground max-w-sm">
                {error}
              </p>
            </div>
          )}

          {/* Plan Steps */}
          {!isLoading && !error && plan && (
            <div className="space-y-4">
              {/* Description */}
              {plan.description && (
                <p className="text-sm text-muted-foreground">
                  {plan.description}
                </p>
              )}

              {/* Steps */}
              {hasSteps ? (
                <div className="space-y-2">
                  {/* Выбрать всё */}
                  <div className="flex items-center gap-2 pb-2 border-b">
                    <Checkbox
                      id="select-all"
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                    />
                    <label
                      htmlFor="select-all"
                      className="text-sm font-medium cursor-pointer select-none"
                    >
                      {allSelected ? 'Снять выбор' : 'Выбрать всё'} ({selectedCount}/{stepsCount})
                    </label>
                  </div>
                  {/* Группировка по направлениям */}
                  {(() => {
                    // Группируем steps по direction_name
                    const grouped = new Map<string, { steps: typeof plan.steps; indices: number[] }>();
                    plan.steps.forEach((step, index) => {
                      const dirName = (step.params as { direction_name?: string })?.direction_name || 'Без направления';
                      if (!grouped.has(dirName)) {
                        grouped.set(dirName, { steps: [], indices: [] });
                      }
                      grouped.get(dirName)!.steps.push(step);
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
                              ({group.steps.length} {group.steps.length === 1 ? 'действие' : 'действий'})
                            </span>
                          </div>
                        )}
                        {group.steps.map((step, i) => (
                          <PlanStepItem
                            key={group.indices[i]}
                            step={step}
                            index={group.indices[i]}
                            checked={selectedSteps.has(group.indices[i])}
                            onToggle={() => toggleStep(group.indices[i])}
                            showDirectionName={!showGroups}
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
                    Оптимизация не требуется
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Все показатели в норме
                  </p>
                </div>
              )}

              {/* Estimated Impact */}
              {plan.estimated_impact && (
                <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground">
                    {plan.estimated_impact}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Text Content (when no plan) */}
          {!isLoading && !error && !plan && content && (
            <div className="py-4">
              <div className="p-4 bg-muted/30 rounded-lg text-sm">
                <MarkdownRenderer content={content} />
              </div>
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose} disabled={isExecuting}>
            {showApproveButtons ? 'Отмена' : 'Закрыть'}
          </Button>

          {showApproveButtons && (
            <Button
              onClick={() => onApprove(Array.from(selectedSteps).sort((a, b) => a - b))}
              disabled={isExecuting}
            >
              {isExecuting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Выполняю...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Одобрить выбранное ({selectedCount})
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PlanStepItemProps {
  step: Plan['steps'][0];
  index: number;
  checked: boolean;
  onToggle: () => void;
  showDirectionName?: boolean;
}

/**
 * Форматирование действия с бюджетом с точными цифрами
 */
function formatBudgetAction(step: Plan['steps'][0]): string {
  const params = step.params as {
    current_budget_cents?: number;
    new_budget_cents?: number;
    increase_percent?: number;
    decrease_percent?: number;
  };

  const current = params.current_budget_cents
    ? `$${(params.current_budget_cents / 100).toFixed(2)}`
    : null;
  const newBudget = params.new_budget_cents
    ? `$${(params.new_budget_cents / 100).toFixed(2)}`
    : null;

  // Определяем процент изменения
  let percentStr = '';
  if (params.increase_percent) {
    percentStr = `+${params.increase_percent}%`;
  } else if (params.decrease_percent) {
    percentStr = `-${params.decrease_percent}%`;
  }

  // Если есть все данные - показываем полную информацию
  if (current && newBudget && percentStr) {
    return `💰 ${current} → ${newBudget} (${percentStr})`;
  }
  // Если есть только новый бюджет
  if (newBudget) {
    return `💰 Бюджет → ${newBudget}`;
  }
  // Fallback
  return '💰 Изменить бюджет';
}

/**
 * Получить метку действия с деталями
 */
function getActionLabel(step: Plan['steps'][0]): string {
  switch (step.action) {
    case 'updateBudget':
      return formatBudgetAction(step);
    case 'pauseAdSet':
      return '⏸️ Поставить на паузу';
    case 'pauseAd':
      return '⏸️ Остановить объявление';
    case 'enableAdSet':
      return '▶️ Включить адсет';
    case 'enableAd':
      return '▶️ Включить объявление';
    case 'createAdSet': {
      const budgetCents = (step.params as { recommended_budget_cents?: number })?.recommended_budget_cents;
      const creativeIds = (step.params as { creative_ids?: string[] })?.creative_ids;
      const creativesCount = creativeIds?.length || 0;
      if (budgetCents) {
        return `➕ Создать новый адсет ($${(budgetCents / 100).toFixed(0)}${creativesCount > 0 ? `, ${creativesCount} креативов` : ''})`;
      }
      return '➕ Создать новый адсет';
    }
    case 'review':
      return '👀 Требует внимания';
    case 'launchNewCreatives':
      return '🚀 Запустить новые креативы';
    default:
      return step.action;
  }
}

/**
 * Перевод приоритета на русский
 */
function getPriorityLabel(priority: string | undefined): string | null {
  if (!priority) return null;
  const labels: Record<string, string> = {
    critical: '🔴 Критично',
    high: '🟠 Высокий',
    medium: '🟡 Средний',
    low: '🟢 Низкий',
  };
  return labels[priority] || null;
}

function PlanStepItem({ step, index, checked, onToggle, showDirectionName }: PlanStepItemProps) {
  // Минималистичные цвета границы по приоритету
  const priorityBorders: Record<string, string> = {
    critical: 'border-l-red-500',
    high: 'border-l-orange-400',
    medium: 'border-l-yellow-400',
    low: 'border-l-green-400',
  };

  const priority = (step as { priority?: string }).priority;
  const borderColor = priority ? priorityBorders[priority] || 'border-l-muted-foreground/30' : 'border-l-muted-foreground/30';
  const priorityLabel = getPriorityLabel(priority);

  // Название сущности (адсета) и направления из params
  const entityName = (step.params as { entity_name?: string })?.entity_name;
  const directionName = (step.params as { direction_name?: string })?.direction_name;

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
          {/* Название адсета с направлением */}
          {entityName && (
            <p className="text-xs text-muted-foreground mb-1 truncate">
              {showDirectionName && directionName && (
                <span className="text-primary font-medium">{directionName} → </span>
              )}
              {entityName}
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground">
              {getActionLabel(step)}
            </p>
            {priorityLabel && (
              <span className="text-xs text-muted-foreground/70">
                {priorityLabel}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {step.description}
          </p>
        </div>
      </div>
    </div>
  );
}

export default OptimizationModal;
