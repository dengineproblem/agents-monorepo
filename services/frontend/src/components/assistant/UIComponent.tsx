import { Button } from '@/components/ui/button';
import { UICard } from './UICard';
import { UITable } from './UITable';
import { UICopyField } from './UICopyField';
import type { UIComponentData, ButtonData } from '@/types/assistantUI';

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

export default UIComponent;
