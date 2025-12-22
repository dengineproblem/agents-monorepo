import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { facebookApi, type Adset } from '../services/facebookApi';
import { useTranslation } from '../i18n/LanguageContext';
import { toast } from 'sonner';
import { translateError } from '@/utils/errorTranslations';
import { REQUIRE_CONFIRMATION } from '../config/appReview';

interface EditAdsetDialogProps {
  adset: Adset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (updatedAdset: Adset) => void;
}

const EditAdsetDialog: React.FC<EditAdsetDialogProps> = ({
  adset,
  open,
  onOpenChange,
  onUpdate,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState(adset.name);
  const [budget, setBudget] = useState(Number(adset.daily_budget || 0) / 100);
  const [saving, setSaving] = useState(false);

  // Обновляем локальное состояние при изменении ad set
  useEffect(() => {
    setName(adset.name);
    setBudget(Number(adset.daily_budget || 0) / 100);
  }, [adset]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const budgetCents = Math.round(budget * 100);

      // App Review: Confirmation dialog перед изменением бюджета (только в App Review режиме)
      if (budgetCents !== adset.daily_budget && REQUIRE_CONFIRMATION) {
        const confirmMessage = t('msg.confirmBudgetChange').replace('${budget}', `$${budget}`);
        const confirmed = window.confirm(confirmMessage);

        if (!confirmed) {
          setSaving(false);
          return;
        }
      }

      // Обновляем название, если изменилось
      if (name !== adset.name) {
        await facebookApi.updateAdsetName(adset.id, name);
      }

      // Обновляем бюджет, если изменился
      if (budgetCents !== adset.daily_budget) {
        await facebookApi.updateAdsetBudget(adset.id, budgetCents);
      }

      toast.success('Ad set обновлен успешно');

      // Уведомляем родительский компонент об обновлении
      onUpdate({
        ...adset,
        name,
        daily_budget: budgetCents,
      });

    } catch (error: any) {
      console.error('Ошибка при сохранении ad set:', error);
      toast.error(translateError(error, 'Не удалось сохранить изменения'));
    } finally {
      setSaving(false);
    }
  };

  const handleBudgetChange = (value: number) => {
    // Ограничиваем минимум $1
    setBudget(Math.max(1, value));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Редактировать Ad Set</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Название</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Введите название ad set"
              disabled={saving}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="budget">Дневной бюджет ($)</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => handleBudgetChange(budget - 1)}
                disabled={saving || budget <= 1}
              >
                −
              </Button>
              <Input
                id="budget"
                type="number"
                value={budget}
                onChange={(e) => handleBudgetChange(Number(e.target.value))}
                min={1}
                step={1}
                disabled={saving}
                className="text-center"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => handleBudgetChange(budget + 1)}
                disabled={saving}
              >
                +
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Минимальный бюджет: $1
            </p>
          </div>
          
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <div className="flex justify-between items-center mb-1">
              <span className="text-muted-foreground">ID:</span>
              <span className="font-mono text-xs">{adset.id}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Статус:</span>
              <span className={`font-medium ${
                adset.status === 'ACTIVE' ? 'text-green-600' : 'text-gray-600'
              }`}>
                {adset.status}
              </span>
            </div>
          </div>
        </div>
        
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Отмена
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || (!name.trim())}
          >
            {saving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditAdsetDialog;

