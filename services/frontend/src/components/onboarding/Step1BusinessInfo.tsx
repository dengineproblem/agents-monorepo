/**
 * Шаг 1: Основная информация о бизнесе
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { OnboardingData } from './OnboardingWizard';

interface Step1Props {
  data: Partial<OnboardingData>;
  onNext: (data: Partial<OnboardingData>) => void;
}

export const Step1BusinessInfo: React.FC<Step1Props> = ({ data, onNext }) => {
  const [businessName, setBusinessName] = useState(data.business_name || '');
  const [businessNiche, setBusinessNiche] = useState(data.business_niche || '');
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const newErrors: { [key: string]: string } = {};
    
    if (!businessName.trim()) {
      newErrors.businessName = 'Укажите название бизнеса';
    }
    
    if (!businessNiche.trim()) {
      newErrors.businessNiche = 'Укажите нишу бизнеса';
    }
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    
    onNext({
      business_name: businessName.trim(),
      business_niche: businessNiche.trim(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold mb-4">
          Давайте начнем с основной информации о вашем бизнесе
        </h3>
        <p className="text-muted-foreground mb-6">
          Эта информация поможет нам создать персонализированные рекламные креативы специально для вашего бизнеса
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="businessName">
            Как называется ваш бизнес? <span className="text-red-500">*</span>
          </Label>
          <Input
            id="businessName"
            type="text"
            placeholder="Например: Клиника Белоснежка"
            value={businessName}
            onChange={(e) => {
              setBusinessName(e.target.value);
              if (errors.businessName) {
                setErrors((prev) => ({ ...prev, businessName: '' }));
              }
            }}
            className={errors.businessName ? 'border-red-500' : ''}
          />
          {errors.businessName && (
            <p className="text-sm text-red-500 mt-1">{errors.businessName}</p>
          )}
        </div>

        <div>
          <Label htmlFor="businessNiche">
            В какой нише вы работаете? <span className="text-red-500">*</span>
          </Label>
          <Input
            id="businessNiche"
            type="text"
            placeholder="Например: Стоматология, Косметология, Автосервис"
            value={businessNiche}
            onChange={(e) => {
              setBusinessNiche(e.target.value);
              if (errors.businessNiche) {
                setErrors((prev) => ({ ...prev, businessNiche: '' }));
              }
            }}
            className={errors.businessNiche ? 'border-red-500' : ''}
          />
          {errors.businessNiche && (
            <p className="text-sm text-red-500 mt-1">{errors.businessNiche}</p>
          )}
          <p className="text-sm text-muted-foreground mt-1">
            Опишите вашу сферу деятельности одним-двумя словами
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" size="lg">
          Далее
        </Button>
      </div>
    </form>
  );
};

