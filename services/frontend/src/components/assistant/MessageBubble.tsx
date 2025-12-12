import { User, Bot, CheckCircle, XCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessage, ExecutedAction, Plan } from '@/services/assistantApi';
import ReactMarkdown from 'react-markdown';

interface MessageBubbleProps {
  message: ChatMessage;
  onApprove?: (plan: Plan) => void;
}

export function MessageBubble({ message, onApprove }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <div
      className={cn(
        'flex gap-3 p-4',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {/* Avatar */}
      {!isUser && (
        <div
          className={cn(
            'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
            isSystem ? 'bg-amber-100' : 'bg-primary/10'
          )}
        >
          <Bot className={cn('h-4 w-4', isSystem ? 'text-amber-600' : 'text-primary')} />
        </div>
      )}

      {/* Message content */}
      <div
        className={cn(
          'max-w-[80%] rounded-lg p-3',
          isUser
            ? 'bg-primary text-primary-foreground'
            : isSystem
            ? 'bg-amber-50 border border-amber-200'
            : 'bg-muted'
        )}
      >
        {/* Message text */}
        <div className={cn('prose prose-sm max-w-none', isUser && 'prose-invert')}>
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>

        {/* Executed actions */}
        {message.actions_json && message.actions_json.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Выполненные действия:</p>
            {message.actions_json.map((action: ExecutedAction, idx: number) => (
              <ActionItem key={idx} action={action} />
            ))}
          </div>
        )}

        {/* Plan preview */}
        {message.plan_json && (
          <PlanPreview plan={message.plan_json} onApprove={onApprove} />
        )}

        {/* Timestamp */}
        <p className="text-[10px] opacity-50 mt-2">
          {new Date(message.created_at).toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
          <User className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function ActionItem({ action }: { action: ExecutedAction }) {
  const isSuccess = action.result === 'success';

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-xs p-2 rounded',
        isSuccess ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
      )}
    >
      {isSuccess ? (
        <CheckCircle className="h-3 w-3" />
      ) : (
        <XCircle className="h-3 w-3" />
      )}
      <span className="font-medium">{action.tool}</span>
      {action.message && <span className="opacity-70">- {action.message}</span>}
    </div>
  );
}

function PlanPreview({ plan, onApprove }: { plan: Plan; onApprove?: (plan: Plan) => void }) {
  return (
    <div className="mt-3 border rounded-lg p-3 bg-background">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="h-4 w-4 text-amber-500" />
        <span className="font-medium text-sm">План действий</span>
      </div>

      <p className="text-sm text-muted-foreground mb-2">{plan.description}</p>

      <ol className="space-y-1 text-sm">
        {plan.steps.map((step, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs">
              {idx + 1}
            </span>
            <span>{step.description}</span>
          </li>
        ))}
      </ol>

      {plan.estimated_impact && (
        <p className="text-xs text-muted-foreground mt-2">
          Ожидаемый эффект: {plan.estimated_impact}
        </p>
      )}

      {plan.requires_approval && onApprove && (
        <p className="text-xs text-amber-600 mt-2">
          Требуется подтверждение для выполнения
        </p>
      )}
    </div>
  );
}

export default MessageBubble;
