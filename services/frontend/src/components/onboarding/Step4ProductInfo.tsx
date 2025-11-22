/**
 * Шаг 4: Информация о продуктах/услугах
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { OnboardingData } from './OnboardingWizard';

interface Step4Props {
  data: Partial<OnboardingData>;
  onNext: (data: Partial<OnboardingData>) => void;
  onBack: () => void;
}

export const Step4ProductInfo: React.FC<Step4Props> = ({ data, onNext, onBack }) => {
  const [mainServices, setMainServices] = useState(data.main_services || '');
  const [competitiveAdvantages, setCompetitiveAdvantages] = useState(data.competitive_advantages || '');
  const [priceSegment, setPriceSegment] = useState(data.price_segment || 'средний');
  const [mainPromises, setMainPromises] = useState(data.main_promises || '');
  const [socialProof, setSocialProof] = useState(data.social_proof || '');
  const [guarantees, setGuarantees] = useState(data.guarantees || '');
  const [toneOfVoice, setToneOfVoice] = useState(data.tone_of_voice || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext({
      main_services: mainServices.trim() || undefined,
      competitive_advantages: competitiveAdvantages.trim() || undefined,
      price_segment: priceSegment,
      main_promises: mainPromises.trim() || undefined,
      social_proof: socialProof.trim() || undefined,
      guarantees: guarantees.trim() || undefined,
      tone_of_voice: toneOfVoice.trim() || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold mb-4">
          О ваших продуктах и услугах
        </h3>
        <p className="text-muted-foreground mb-6">
          Последний шаг! Расскажите что делает ваш бизнес особенным
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="mainServices">
            Основные услуги или продукты
          </Label>
          <Textarea
            id="mainServices"
            placeholder="Например: Профессиональная чистка зубов, отбеливание, установка виниров, имплантация"
            value={mainServices}
            onChange={(e) => setMainServices(e.target.value)}
            rows={4}
            className="resize-none"
          />
          <p className="text-sm text-muted-foreground mt-1">
            Перечислите основные направления вашего бизнеса
          </p>
        </div>

        <div>
          <Label htmlFor="competitiveAdvantages">
            Конкурентные преимущества
          </Label>
          <Textarea
            id="competitiveAdvantages"
            placeholder="Например: Современное оборудование, опытные врачи с 15+ лет стажа, безболезненное лечение, гарантия на работы"
            value={competitiveAdvantages}
            onChange={(e) => setCompetitiveAdvantages(e.target.value)}
            rows={4}
            className="resize-none"
          />
          <p className="text-sm text-muted-foreground mt-1">
            Что отличает вас от конкурентов?
          </p>
        </div>

        <div>
          <Label className="text-base mb-3 block">
            Ценовой сегмент
          </Label>
          <RadioGroup
            value={priceSegment}
            onValueChange={(value) => setPriceSegment(value)}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="эконом" id="price-economy" />
              <Label htmlFor="price-economy" className="font-normal cursor-pointer">
                Эконом — доступные цены, массовый рынок
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="средний" id="price-mid" />
              <Label htmlFor="price-mid" className="font-normal cursor-pointer">
                Средний — оптимальное соотношение цены и качества
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="премиум" id="price-premium" />
              <Label htmlFor="price-premium" className="font-normal cursor-pointer">
                Премиум — высокое качество, эксклюзивность
              </Label>
            </div>
          </RadioGroup>
        </div>

        <div>
          <Label htmlFor="mainPromises">
            Главные обещания и результаты (опционально)
          </Label>
          <Textarea
            id="mainPromises"
            placeholder="Например: белоснежная улыбка за 1 процедуру, безболезненное лечение, результат которого сохраняется 5+ лет"
            value={mainPromises}
            onChange={(e) => setMainPromises(e.target.value)}
            rows={3}
            className="resize-none"
          />
          <p className="text-sm text-muted-foreground mt-1">
            Какие результаты вы обещаете клиентам?
          </p>
        </div>

        <div>
          <Label htmlFor="socialProof">
            Социальные доказательства (опционально)
          </Label>
          <Textarea
            id="socialProof"
            placeholder="Например: 5000+ довольных клиентов, 500+ отзывов с оценкой 4.9/5, работаем с 2010 года"
            value={socialProof}
            onChange={(e) => setSocialProof(e.target.value)}
            rows={3}
            className="resize-none"
          />
          <p className="text-sm text-muted-foreground mt-1">
            Количество клиентов, отзывы, кейсы, награды
          </p>
        </div>

        <div>
          <Label htmlFor="guarantees">
            Гарантии (опционально)
          </Label>
          <Textarea
            id="guarantees"
            placeholder="Например: гарантия на работы 2 года, возврат 100% если не понравится, бесплатная консультация"
            value={guarantees}
            onChange={(e) => setGuarantees(e.target.value)}
            rows={3}
            className="resize-none"
          />
          <p className="text-sm text-muted-foreground mt-1">
            Какие гарантии вы даёте клиентам?
          </p>
        </div>

        <div>
          <Label htmlFor="toneOfVoice">
            Тон общения бренда (опционально)
          </Label>
          <Textarea
            id="toneOfVoice"
            placeholder="Например: дружелюбный и заботливый, экспертный и профессиональный, вдохновляющий"
            value={toneOfVoice}
            onChange={(e) => setToneOfVoice(e.target.value)}
            rows={2}
            className="resize-none"
          />
          <p className="text-sm text-muted-foreground mt-1">
            Как вы общаетесь с клиентами в соцсетях и рекламе?
          </p>
        </div>
      </div>

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          Назад
        </Button>
        <Button type="submit" size="lg">
          Создать промпт
        </Button>
      </div>
    </form>
  );
};

