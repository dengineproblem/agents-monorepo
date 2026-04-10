import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Direction {
  id: string;
  name: string;
  [key: string]: any;
}

interface DirectionMultiSelectProps {
  directions: Direction[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  renderLabel?: (direction: Direction) => string;
  className?: string;
}

export function DirectionMultiSelect({
  directions,
  selectedIds,
  onChange,
  disabled = false,
  placeholder = 'Выберите направления',
  renderLabel,
  className,
}: DirectionMultiSelectProps) {
  const getLabel = (d: Direction) => renderLabel ? renderLabel(d) : d.name;

  const triggerText = (() => {
    if (selectedIds.length === 0) return placeholder;
    const first = directions.find(d => d.id === selectedIds[0]);
    if (!first) return placeholder;
    if (selectedIds.length === 1) return getLabel(first);
    return `${getLabel(first)}, +${selectedIds.length - 1}`;
  })();

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(x => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            'w-full justify-between font-normal',
            selectedIds.length === 0 && 'text-muted-foreground',
            className
          )}
        >
          <span className="truncate">{triggerText}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full min-w-[240px] p-1" align="start">
        {directions.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">Направления не найдены</p>
        ) : (
          directions.map((direction) => (
            <div
              key={direction.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-accent"
              onClick={() => toggle(direction.id)}
            >
              <Checkbox
                checked={selectedIds.includes(direction.id)}
                onCheckedChange={() => toggle(direction.id)}
                onClick={(e) => e.stopPropagation()}
              />
              <span className="text-sm truncate">{getLabel(direction)}</span>
            </div>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
