/**
 * Шаг 6: Настройки бюджета и CPL для Brain Mini
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DollarSign, Target, Info } from 'lucide-react';
import type { OnboardingData } from './OnboardingWizard';

interface Step6Props {
  data: Partial<OnboardingData>;
  onNext: (data: Partial<OnboardingData>) => void;
  onBack: () => void;
}

export const Step6BudgetSettings: React.FC<Step6Props> = ({ data, onNext, onBack }) => {
  const [dailyBudget, setDailyBudget] = useState<string>(
    data.plan_daily_budget ? String(data.plan_daily_budget) : ''
  );
  const [targetCPL, setTargetCPL] = useState<string>(
    data.default_cpl_target ? String(data.default_cpl_target) : ''
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const budgetValue = dailyBudget ? parseFloat(dailyBudget) : undefined;
    const cplValue = targetCPL ? parseFloat(targetCPL) : undefined;

    onNext({
      plan_daily_budget: budgetValue && !isNaN(budgetValue) ? budgetValue : undefined,
      default_cpl_target: cplValue && !isNaN(cplValue) ? cplValue : undefined,
    });
  };

  const handleSkip = () => {
    onNext({
      plan_daily_budget: undefined,
      default_cpl_target: undefined,
    });
  };

  const handleNumberInput = (
    value: string,
    setter: React.Dispatch<React.SetStateAction<string>>
  ) => {
    // Разрешаем только цифры и точку для десятичных
    const sanitized = value.replace(/[^\d.]/g, '');
    // Не позволяем больше одной точки
    const parts = sanitized.split('.');
    if (parts.length > 2) return;
    setter(sanitized);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold mb-4">
          Настройки рекламного бюджета
        </h3>
        <p className="text-muted-foreground mb-6">
          Эти данные помогут AI-оптимизатору лучше управлять вашей рекламой.
          Вы сможете изменить их позже в настройках.
        </p>
      </div>

      <div className="space-y-4">
        {/* Дневной бюджет */}
        <div>
          <Label htmlFor="dailyBudget" className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-green-600" />
            Плановый дневной бюджет ($)
          </Label>
          <div className="relative mt-1.5">
            <Input
              id="dailyBudget"
              type="text"
              inputMode="decimal"
              placeholder="Например: 5000"
              value={dailyBudget}
              onChange={(e) => handleNumberInput(e.target.value, setDailyBudget)}
              className="pr-12"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
              $/день
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Сколько вы готовы тратить на рекламу в день?
          </p>
        </div>

        {/* Целевой CPL */}
        <div>
          <Label htmlFor="targetCPL" className="flex items-center gap-2">
            <Target className="h-4 w-4 text-blue-600" />
            Целевая стоимость заявки — CPL ($)
          </Label>
          <div className="relative mt-1.5">
            <Input
              id="targetCPL"
              type="text"
              inputMode="decimal"
              placeholder="Например: 500"
              value={targetCPL}
              onChange={(e) => handleNumberInput(e.target.value, setTargetCPL)}
              className="pr-16"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
              $/заявка
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Сколько вы готовы платить за одну заявку/лид?
          </p>
        </div>

        {/* Пояснение */}
        <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-4 flex gap-3">
          <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <strong className="text-foreground">Зачем это нужно?</strong>
            <p className="mt-1">
              AI-оптимизатор использует эти данные для:
            </p>
            <ul className="mt-2 space-y-1 list-disc list-inside">
              <li>Расчёта эффективности рекламы (Health Score)</li>
              <li>Рекомендаций по перераспределению бюджета</li>
              <li>Автоматической остановки неэффективных объявлений</li>
            </ul>
            <p className="mt-2">
              Если вы не знаете точные цифры — можете пропустить этот шаг.
              Система будет анализировать только тренды.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          Назад
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={handleSkip}>
            Пропустить
          </Button>
          <Button type="submit" size="lg">
            {dailyBudget || targetCPL ? 'Далее' : 'Пропустить'}
          </Button>
        </div>
      </div>
    </form>
  );
};
