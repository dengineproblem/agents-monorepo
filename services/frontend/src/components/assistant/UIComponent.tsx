import { Button } from '@/components/ui/button';
import { UICard } from './UICard';
import { UITable } from './UITable';
import { UICopyField } from './UICopyField';
import { UIMetricsComparison } from './UIMetricsComparison';
import type { UIComponentData, ButtonData, QuickActionsData, QuickAction } from '@/types/assistantUI';

interface UIComponentProps {
  component: UIComponentData;
  onAction?: (action: string, params: Record<string, unknown>) => void;
}

export function UIComponent({ component, onAction }: UIComponentProps) {
  const { type, data } = component;

  switch (type) {
    case 'card':
      return <UICard data={data} onAction={onAction} />;

    case 'table':
      return <UITable data={data} />;

    case 'copy_field':
      return <UICopyField data={data} />;

    case 'button':
      return <UIButton data={data as ButtonData} onAction={onAction} />;

    case 'quick_actions':
      return <UIQuickActions data={data as QuickActionsData} onAction={onAction} />;

    case 'actions':
      // Backend sends flat structure for actions
      return <UIActionsFlat component={component} onAction={onAction} />;

    case 'alert':
      // Backend sends flat structure for alerts
      return <UIAlertFlat component={component} />;

    case 'metrics_comparison':
      return <UIMetricsComparison data={data} title={component.title} />;

    default:

      return null;
  }
}

function UIButton({
  data,
  onAction,
}: {
  data: ButtonData;
  onAction?: (action: string, params: Record<string, unknown>) => void;
}) {
  const { label, action, params, variant = 'secondary' } = data;

  const variantMap = {
    primary: 'default' as const,
    secondary: 'outline' as const,
    danger: 'destructive' as const,
  };

  return (
    <Button
      size="sm"
      variant={variantMap[variant]}
      onClick={() => onAction?.(action, params)}
      className="text-xs"
    >
      {label}
    </Button>
  );
}

function UIQuickActions({
  data,
  onAction,
}: {
  data: QuickActionsData;
  onAction?: (action: string, params: Record<string, unknown>) => void;
}) {
  const { title, actions } = data;

  const variantMap = {
    primary: 'default' as const,
    secondary: 'outline' as const,
    danger: 'destructive' as const,
  };

  return (
    <div className="space-y-2">
      {title && (
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((action: QuickAction, idx: number) => (
          <Button
            key={idx}
            size="sm"
            variant={variantMap[action.variant || 'secondary']}
            onClick={() => onAction?.(action.action, action.params)}
            className="text-xs"
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

// Flat structure components (backend sends type + flat fields, not { type, data })
interface ActionItem {
  id: string;
  label: string;
  icon?: string;
  payload?: Record<string, unknown>;
  style?: string;
  disabled?: boolean;
}

interface ActionsComponent {
  type: 'actions';
  title?: string;
  items: ActionItem[];
  layout?: 'horizontal' | 'vertical';
}

function UIActionsFlat({
  component,
  onAction,
}: {
  component: ActionsComponent;
  onAction?: (action: string, params: Record<string, unknown>) => void;
}) {
  const { title, items, layout = 'horizontal' } = component;

  return (
    <div className="space-y-2">
      {title && (
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
      )}
      <div className={layout === 'horizontal' ? 'flex flex-wrap gap-2' : 'flex flex-col gap-2'}>
        {items.map((item, idx) => (
          <Button
            key={item.id || idx}
            size="sm"
            variant="outline"
            disabled={item.disabled}
            onClick={() => onAction?.(item.payload?.action as string || item.id, item.payload || {})}
            className="text-xs"
          >
            {item.icon && <span className="mr-1">{item.icon}</span>}
            {item.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

interface AlertComponent {
  type: 'alert';
  alertType: 'info' | 'warning' | 'error' | 'success';
  title?: string;
  message: string;
  dismissible?: boolean;
}

function UIAlertFlat({ component }: { component: AlertComponent }) {
  const { alertType, title, message } = component;

  const alertStyles = {
    info: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/50 dark:border-blue-800 dark:text-blue-300',
    warning: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-300',
    error: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/50 dark:border-red-800 dark:text-red-300',
    success: 'bg-green-50 border-green-200 text-green-800 dark:bg-green-950/50 dark:border-green-800 dark:text-green-300',
  };

  const iconMap = {
    info: 'ℹ️',
    warning: '⚠️',
    error: '❌',
    success: '✅',
  };

  return (
    <div className={`rounded-lg border p-3 ${alertStyles[alertType]}`}>
      <div className="flex items-start gap-2">
        <span>{iconMap[alertType]}</span>
        <div>
          {title && <p className="font-medium text-sm">{title}</p>}
          <p className="text-sm">{message}</p>
        </div>
      </div>
    </div>
  );
}

export default UIComponent;
