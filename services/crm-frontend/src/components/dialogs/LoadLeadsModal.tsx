import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface LoadLeadsModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (instanceName: string, maxDialogs: number) => void;
  isLoading?: boolean;
}

export function LoadLeadsModal({ open, onClose, onSubmit, isLoading }: LoadLeadsModalProps) {
  const [instanceName, setInstanceName] = useState('');
  const [maxDialogs, setMaxDialogs] = useState(100);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (instanceName.trim()) {
      onSubmit(instanceName.trim(), maxDialogs);
      setInstanceName('');
      setMaxDialogs(100);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Загрузить лиды из WhatsApp</DialogTitle>
            <DialogDescription>
              Введите название вашего WhatsApp Instance для загрузки и анализа диалогов
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="instance">
                Название Instance <span className="text-red-500">*</span>
              </Label>
              <Input
                id="instance"
                placeholder="my-whatsapp-instance"
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                required
                disabled={isLoading}
              />
              <p className="text-sm text-gray-500">
                Например: business-whatsapp, my-instance
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="maxDialogs">
                Максимум диалогов для анализа
              </Label>
              <Input
                id="maxDialogs"
                type="number"
                min={1}
                max={1000}
                value={maxDialogs}
                onChange={(e) => setMaxDialogs(parseInt(e.target.value) || 100)}
                disabled={isLoading}
              />
              <p className="text-sm text-gray-500">
                Рекомендуется: 50-200 для первого запуска
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={isLoading || !instanceName.trim()}>
              {isLoading ? 'Загрузка...' : 'Загрузить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

