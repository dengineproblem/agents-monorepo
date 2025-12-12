import { Zap, ClipboardList, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMode } from '@/services/assistantApi';

interface ModeSelectorProps {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
}

const modes: { value: ChatMode; label: string; icon: React.ComponentType<{ className?: string }>; description: string }[] = [
  {
    value: 'auto',
    label: 'Auto',
    icon: Zap,
    description: 'Выполняет действия сразу',
  },
  {
    value: 'plan',
    label: 'Plan',
    icon: ClipboardList,
    description: 'Показывает план перед действием',
  },
  {
    value: 'ask',
    label: 'Ask',
    icon: HelpCircle,
    description: 'Всегда уточняет детали',
  },
];

export function ModeSelector({ mode, onChange }: ModeSelectorProps) {
  return (
    <div className="flex gap-1 p-1 bg-muted rounded-lg">
      {modes.map(({ value, label, icon: Icon, description }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          title={description}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
            mode === value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

export default ModeSelector;
