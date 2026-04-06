import { useState, useEffect, useCallback, useMemo } from 'react';
import { Rocket, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { Direction } from '@/types/direction';
import { getDirectionObjectiveLabel } from '@/types/direction';

interface AILaunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  directions: Direction[];
  launchLoading: boolean;
  onLaunch: (directionIds: string[], startMode: 'now' | 'midnight_almaty') => void;
}

export function AILaunchDialog({
  open,
  onOpenChange,
  directions,
  launchLoading,
  onLaunch,
}: AILaunchDialogProps) {
  const [startMode, setStartMode] = useState<'now' | 'midnight_almaty'>('midnight_almaty');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Мемоизируем фильтрацию, чтобы не пересоздавать массив каждый рендер
  const activeDirections = useMemo(
    () => directions.filter(d => d.is_active),
    [directions]
  );

  const allSelected = activeDirections.length > 0 && selectedIds.size === activeDirections.length;

  // Сброс состояния при открытии диалога.
  // Зависимость только от `open` — не нужно сбрасывать выбор при изменении directions пока диалог открыт.
  // activeDirections берётся из замыкания и будет актуальным на момент вызова.
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(activeDirections.map(d => d.id)));
      setStartMode('midnight_almaty');
      console.log('[AILaunchDialog] Opened, selected all active directions:', activeDirections.length);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDirection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(activeDirections.map(d => d.id)));
    }
  }, [allSelected, activeDirections]);

  const handleLaunch = () => {
    const ids = Array.from(selectedIds);
    console.log('[AILaunchDialog] Launch requested:', {
      directionIds: ids,
      startMode,
      selectedCount: ids.length,
      totalActive: activeDirections.length,
    });
    onLaunch(ids, startMode);
  };

  // Описание: показываем имя единственного направления или счётчик
  const description = activeDirections.length === 1
    ? `Направление: ${activeDirections[0].name}`
    : selectedIds.size === activeDirections.length
      ? 'Реклама будет запущена для всех активных направлений'
      : `Выбрано направлений: ${selectedIds.size} из ${activeDirections.length}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Запуск с AI</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* Выбор направлений (показываем при 2+ активных) */}
        {activeDirections.length > 1 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Направления</Label>
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs text-primary hover:underline"
              >
                {allSelected ? 'Снять все' : 'Выбрать все'}
              </button>
            </div>
            <div className="max-h-[200px] overflow-y-auto space-y-1.5 rounded-md border p-2">
              {activeDirections.map(d => (
                <label
                  key={d.id}
                  className="flex items-center gap-2 py-1 px-1 rounded hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={selectedIds.has(d.id)}
                    onCheckedChange={() => toggleDirection(d.id)}
                  />
                  <span className="text-sm flex-1 truncate">{d.name}</span>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {getDirectionObjectiveLabel(d)}
                  </Badge>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Время запуска */}
        <div className="space-y-2">
          <Label>Время запуска</Label>
          <RadioGroup
            value={startMode}
            onValueChange={(v: 'now' | 'midnight_almaty') => setStartMode(v)}
            className="grid grid-cols-1 gap-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="midnight_almaty" id="ai-start-midnight" />
              <Label htmlFor="ai-start-midnight" className="cursor-pointer">С полуночи</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="now" id="ai-start-now" />
              <Label htmlFor="ai-start-now" className="cursor-pointer">Сейчас</Label>
            </div>
          </RadioGroup>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={launchLoading}>
            Отмена
          </Button>
          <Button
            onClick={handleLaunch}
            disabled={launchLoading || selectedIds.size === 0}
            className="dark:bg-gray-700 dark:hover:bg-gray-800"
          >
            {launchLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Запуск...
              </>
            ) : (
              <>
                <Rocket className="h-4 w-4 mr-2" />
                Запустить{selectedIds.size < activeDirections.length ? ` (${selectedIds.size})` : ''}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AILaunchDialog;
