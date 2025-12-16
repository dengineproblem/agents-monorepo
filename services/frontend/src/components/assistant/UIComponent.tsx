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

    case 'metrics_comparison':
      return <UIMetricsComparison data={data} title={component.title} />;

    default:
      console.warn(`Unknown UI component type: ${type}`);
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

export default UIComponent;
