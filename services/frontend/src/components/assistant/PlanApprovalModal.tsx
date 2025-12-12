import { useState } from 'react';
import { X, Play, PlayCircle, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Plan, PlanStep } from '@/services/assistantApi';

interface PlanApprovalModalProps {
  plan: Plan;
  open: boolean;
  onClose: () => void;
  onApprove: (mode: 'yes' | 'yes_auto' | 'yes_manual') => void;
  onReject: () => void;
  isExecuting?: boolean;
}

export function PlanApprovalModal({
  plan,
  open,
  onClose,
  onApprove,
  onReject,
  isExecuting,
}: PlanApprovalModalProps) {
  const [executingStep, setExecutingStep] = useState<number | null>(null);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayCircle className="h-5 w-5 text-primary" />
            План действий
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Description */}
          <p className="text-sm text-muted-foreground">{plan.description}</p>

          {/* Steps */}
          <div className="space-y-2">
            {plan.steps.map((step, idx) => (
              <StepItem
                key={idx}
                step={step}
                index={idx}
                isExecuting={executingStep === idx}
              />
            ))}
          </div>

          {/* Estimated impact */}
          {plan.estimated_impact && (
            <div className="text-sm p-3 bg-green-50 rounded-lg border border-green-200 text-green-700">
              <span className="font-medium">Ожидаемый эффект:</span>{' '}
              {plan.estimated_impact}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              variant="outline"
              onClick={onReject}
              disabled={isExecuting}
              className="flex-1"
            >
              <XCircle className="h-4 w-4 mr-2" />
              No
            </Button>
            <Button
              onClick={() => onApprove('yes')}
              disabled={isExecuting}
              className="flex-1"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Yes
            </Button>
            <Button
              variant="secondary"
              onClick={() => onApprove('yes_auto')}
              disabled={isExecuting}
              className="flex-1"
              title="Выполнить и автоматически корректировать при ошибках"
            >
              <Play className="h-4 w-4 mr-2" />
              Yes + Auto
            </Button>
            <Button
              variant="secondary"
              onClick={() => onApprove('yes_manual')}
              disabled={isExecuting}
              className="flex-1"
              title="Подтверждать каждый шаг отдельно"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Yes + Manual
            </Button>
          </div>

          {/* Loading state */}
          {isExecuting && (
            <div className="text-center text-sm text-muted-foreground animate-pulse">
              Выполняется...
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepItem({
  step,
  index,
  isExecuting,
}: {
  step: PlanStep;
  index: number;
  isExecuting?: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border ${
        isExecuting ? 'bg-primary/5 border-primary/20' : 'bg-muted/50'
      }`}
    >
      <span
        className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
          isExecuting
            ? 'bg-primary text-primary-foreground animate-pulse'
            : 'bg-muted-foreground/20 text-muted-foreground'
        }`}
      >
        {index + 1}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{step.description}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {step.action}
        </p>
      </div>
    </div>
  );
}

export default PlanApprovalModal;
