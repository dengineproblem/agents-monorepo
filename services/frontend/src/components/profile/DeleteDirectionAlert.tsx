import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Direction } from '@/types/direction';

interface DeleteDirectionAlertProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  direction: Direction | null;
  onConfirm: () => Promise<void>;
}

export const DeleteDirectionAlert: React.FC<DeleteDirectionAlertProps> = ({
  open,
  onOpenChange,
  direction,
  onConfirm,
}) => {
  const [isDeleting, setIsDeleting] = React.useState(false);

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {

    } finally {
      setIsDeleting(false);
    }
  };

  if (!direction) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить направление "{direction.name}"?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>Это действие нельзя отменить.</p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Кампания в Facebook будет заархивирована</li>
              <li>Все креативы этого направления потеряют связь</li>
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Отмена</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Удаление...' : 'Удалить'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

