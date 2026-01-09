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
import { StreamingMessage, type StreamingState } from '@/components/assistant/StreamingMessage';
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
  onApprove: () => void;
  onReject: () => void;
  isExecuting: boolean;
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
}: OptimizationModalProps) {
  // Не рендерим Dialog пока не открыт
  if (!open) return null;

  const hasSteps = plan?.steps && plan.steps.length > 0;
  const showApproveButtons = !isLoading && !error && hasSteps;

  // Subtitle based on scope
  const subtitle = scope?.directionId
    ? `${scope.accountName} / ${scope.directionName}`
    : scope?.accountName;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Brain Mini Оптимизация
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
          {/* Streaming Progress */}
          {isLoading && streamingState && (
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
                  <p className="text-sm font-medium">
                    Предлагаемые действия ({plan.steps.length}):
                  </p>
                  {plan.steps.map((step, index) => (
                    <PlanStepItem key={index} step={step} index={index} />
                  ))}
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
              <div className="p-4 bg-muted/30 rounded-lg">
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {content}
                </p>
              </div>
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose} disabled={isExecuting}>
            {showApproveButtons ? 'Отмена' : 'Закрыть'}
          </Button>

          {showApproveButtons && (
            <Button onClick={onApprove} disabled={isExecuting}>
              {isExecuting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Выполняю...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Одобрить всё
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
}

/**
 * Перевод action на русский язык
 */
function getActionLabel(action: string): string {
  const actionLabels: Record<string, string> = {
    updateBudget: '💰 Изменить бюджет',
    pauseAdSet: '⏸️ Поставить на паузу',
    pauseAd: '⏸️ Остановить объявление',
    enableAdSet: '▶️ Включить адсет',
    enableAd: '▶️ Включить объявление',
    createAdSet: '➕ Создать новый адсет',
    review: '👀 Требует внимания',
    launchNewCreatives: '🚀 Запустить новые креативы',
  };
  return actionLabels[action] || action;
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

function PlanStepItem({ step, index }: PlanStepItemProps) {
  // Определяем цвет по приоритету если есть (light + dark mode)
  const priorityColors: Record<string, string> = {
    critical: 'border-l-red-600 bg-red-50/50 dark:bg-red-950/30',
    high: 'border-l-red-500 bg-red-50/30 dark:bg-red-950/20',
    medium: 'border-l-yellow-500 bg-yellow-50/30 dark:bg-yellow-950/20',
    low: 'border-l-green-500 bg-green-50/30 dark:bg-green-950/20',
  };

  const priority = (step as { priority?: string }).priority;
  const borderColor = priority ? priorityColors[priority] || '' : '';
  const priorityLabel = getPriorityLabel(priority);

  return (
    <div
      className={cn(
        'p-3 rounded-lg border-l-4',
        borderColor || 'border-l-primary/50 bg-muted/30'
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-medium flex items-center justify-center">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground">
              {getActionLabel(step.action)}
            </p>
            {priorityLabel && (
              <span className="text-xs text-muted-foreground">
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
