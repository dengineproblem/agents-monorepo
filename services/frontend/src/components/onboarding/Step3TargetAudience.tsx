/**
 * Шаг 3: Целевая аудитория
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { OnboardingData } from './OnboardingWizard';

interface Step3Props {
  data: Partial<OnboardingData>;
  onNext: (data: Partial<OnboardingData>) => void;
  onBack: () => void;
}

export const Step3TargetAudience: React.FC<Step3Props> = ({ data, onNext, onBack }) => {
  const [targetAudience, setTargetAudience] = useState(data.target_audience || '');
  const [geography, setGeography] = useState(data.geography || '');
  const [mainPains, setMainPains] = useState(data.main_pains || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext({
      target_audience: targetAudience.trim() || undefined,
      geography: geography.trim() || undefined,
      main_pains: mainPains.trim() || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold mb-4">
          Расскажите о вашей целевой аудитории
        </h3>
        <p className="text-muted-foreground mb-6">
          Понимание вашей аудитории поможет создать максимально эффективные рекламные сообщения
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="targetAudience">
            Кто ваши клиенты?
          </Label>
          <Textarea
            id="targetAudience"
            placeholder="Например: женщины 25-45 лет, активные пользователи социальных сетей, заботящиеся о здоровье и внешнем виде"
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
            rows={4}
            className="resize-none"
          />
          <p className="text-sm text-muted-foreground mt-1">
            Опишите возраст, пол, интересы, потребности вашей аудитории
          </p>
        </div>

        <div>
          <Label htmlFor="geography">
            География работы
          </Label>
          <Input
            id="geography"
            type="text"
            placeholder="Например: Алматы, Казахстан"
            value={geography}
            onChange={(e) => setGeography(e.target.value)}
          />
          <p className="text-sm text-muted-foreground mt-1">
            Укажите город, регион или страну
          </p>
        </div>

        <div>
          <Label htmlFor="mainPains">
            Основные боли и проблемы аудитории (опционально)
          </Label>
          <Textarea
            id="mainPains"
            placeholder="Например: страх боли при лечении, нехватка времени на посещение врача, неудовлетворенность внешним видом зубов"
            value={mainPains}
            onChange={(e) => setMainPains(e.target.value)}
            rows={4}
            className="resize-none"
          />
          <p className="text-sm text-muted-foreground mt-1">
            Какие проблемы, страхи и сомнения есть у вашей аудитории?
          </p>
        </div>
      </div>

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          Назад
        </Button>
        <Button type="submit" size="lg">
          Далее
        </Button>
      </div>
    </form>
  );
};

