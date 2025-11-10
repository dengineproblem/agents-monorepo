import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';

interface OnboardingModalProps {
  open: boolean;
  userAccountId: string;
  onComplete: () => void;
}

export function OnboardingModal({ open, userAccountId, onComplete }: OnboardingModalProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    business_industry: '',
    business_description: '',
    target_audience: '',
    funnel_stages_description: '',
    stage_transition_criteria: '',
    positive_signals: '',
    negative_signals: '',
    main_challenges: '',
  });

  const handleSubmit = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/crm/business-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAccountId, ...formData }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to save profile');
      }

      toast({
        title: 'Профиль сохранен!',
        description: 'Теперь AI будет анализировать лиды с учетом специфики вашего бизнеса',
      });

      onComplete();
    } catch (error: any) {
      console.error('Failed to save profile:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось сохранить профиль. Попробуйте еще раз.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const isStep1Valid = 
    formData.business_industry.length >= 1 && 
    formData.business_description.length >= 3 &&
    formData.target_audience.length >= 3;
  const isStep2Valid = 
    formData.funnel_stages_description.length >= 3 && 
    formData.stage_transition_criteria.length >= 3;
  const isStep3Valid = 
    formData.positive_signals.length >= 3 && 
    formData.negative_signals.length >= 3 &&
    formData.main_challenges.length >= 3;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-2xl" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Добро пожаловать в WhatsApp CRM! 🎉</DialogTitle>
          <DialogDescription>
            Ответьте на несколько вопросов, чтобы мы могли лучше анализировать ваших лидов.
            Это займет всего 2 минуты.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {step === 1 && (
            <div className="space-y-4">
              <div className="text-sm text-gray-500 mb-4">
                Шаг 1 из 3: Базовая информация
              </div>
              
              <div>
                <Label htmlFor="industry">
                  1. Какая сфера деятельности вашей компании? *
                </Label>
                <Input
                  id="industry"
                  placeholder="Например: стоматология, косметология, инфобизнес, фитнес-клуб..."
                  value={formData.business_industry}
                  onChange={(e) => setFormData({ ...formData, business_industry: e.target.value })}
                  className="mt-2"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Укажите вашу нишу или отрасль
                </p>
              </div>

              <div>
                <Label htmlFor="description">
                  2. Что представляют собой ваши основные продукты или услуги? *
                </Label>
                <Textarea
                  id="description"
                  placeholder="Опишите кратко, что вы предлагаете клиентам..."
                  value={formData.business_description}
                  onChange={(e) => setFormData({ ...formData, business_description: e.target.value })}
                  rows={3}
                  className="mt-2"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Минимум 3 символа. Например: "Предлагаем услуги по отбеливанию зубов, установке виниров и имплантации"
                </p>
                {formData.business_description.length > 0 && formData.business_description.length < 3 && (
                  <p className="text-xs text-red-500 mt-1">
                    ⚠️ Слишком коротко, добавьте детали
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="audience">
                  3. Кто ваша целевая аудитория? *
                </Label>
                <Textarea
                  id="audience"
                  placeholder="Например: владельцы стоматологических клиник, предприниматели в медицине..."
                  value={formData.target_audience}
                  onChange={(e) => setFormData({ ...formData, target_audience: e.target.value })}
                  rows={3}
                  className="mt-2"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Минимум 3 символа. Кто обычно покупает ваши услуги/продукты?
                </p>
                {formData.target_audience.length > 0 && formData.target_audience.length < 3 && (
                  <p className="text-xs text-red-500 mt-1">
                    ⚠️ Слишком коротко, добавьте детали
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="text-sm text-gray-500 mb-4">
                Шаг 2 из 3: Воронка продаж
              </div>

              <div>
                <Label htmlFor="funnel">
                  4. Опишите этапы вашей воронки продаж *
                </Label>
                <Textarea
                  id="funnel"
                  placeholder="Например: Первый контакт → Квалификация → Консультация → Оформление сделки → Оплата"
                  value={formData.funnel_stages_description}
                  onChange={(e) => setFormData({ ...formData, funnel_stages_description: e.target.value })}
                  rows={3}
                  className="mt-2"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Минимум 3 символа. Через какие этапы проходит клиент от первого контакта до сделки?
                </p>
                {formData.funnel_stages_description.length > 0 && formData.funnel_stages_description.length < 3 && (
                  <p className="text-xs text-red-500 mt-1">
                    ⚠️ Слишком коротко, добавьте детали
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="criteria">
                  5. Критерии перехода между этапами *
                </Label>
                <Textarea
                  id="criteria"
                  placeholder="Например: На квалификацию - когда ответил на вопросы о бюджете и сроках. На консультацию - когда согласился на встречу..."
                  value={formData.stage_transition_criteria}
                  onChange={(e) => setFormData({ ...formData, stage_transition_criteria: e.target.value })}
                  rows={4}
                  className="mt-2"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Минимум 3 символа. Что должен сделать/сказать клиент, чтобы перейти на следующий этап?
                </p>
                {formData.stage_transition_criteria.length > 0 && formData.stage_transition_criteria.length < 3 && (
                  <p className="text-xs text-red-500 mt-1">
                    ⚠️ Слишком коротко, добавьте детали
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="text-sm text-gray-500 mb-4">
                Шаг 3 из 3: Сигналы и задачи
              </div>

              <div>
                <Label htmlFor="positive">
                  6. Позитивные сигналы заинтересованности *
                </Label>
                <Textarea
                  id="positive"
                  placeholder='Например: "хочу узнать подробнее", "какие результаты", "сколько стоит", "когда можем начать", "интересно"...'
                  value={formData.positive_signals}
                  onChange={(e) => setFormData({ ...formData, positive_signals: e.target.value })}
                  rows={3}
                  className="mt-2"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Минимум 3 символа. Какие фразы/вопросы говорят о том, что клиент заинтересован?
                </p>
                {formData.positive_signals.length > 0 && formData.positive_signals.length < 3 && (
                  <p className="text-xs text-red-500 mt-1">
                    ⚠️ Слишком коротко, добавьте детали
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="negative">
                  7. Типичные возражения клиентов *
                </Label>
                <Textarea
                  id="negative"
                  placeholder='Например: "дорого", "подумаю", "нет бюджета", "не подходит", "не интересно"...'
                  value={formData.negative_signals}
                  onChange={(e) => setFormData({ ...formData, negative_signals: e.target.value })}
                  rows={3}
                  className="mt-2"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Минимум 3 символа. Какие возражения чаще всего озвучивают клиенты?
                </p>
                {formData.negative_signals.length > 0 && formData.negative_signals.length < 3 && (
                  <p className="text-xs text-red-500 mt-1">
                    ⚠️ Слишком коротко, добавьте детали
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="challenges">
                  8. Главные задачи вашего бизнеса *
                </Label>
                <Textarea
                  id="challenges"
                  placeholder="Например: увеличить поток записей, улучшить конверсию из лидов, привлечь больше клиентов..."
                  value={formData.main_challenges}
                  onChange={(e) => setFormData({ ...formData, main_challenges: e.target.value })}
                  rows={3}
                  className="mt-2"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Минимум 3 символа. Что для вас наиболее важно сейчас?
                </p>
                {formData.main_challenges.length > 0 && formData.main_challenges.length < 3 && (
                  <p className="text-xs text-red-500 mt-1">
                    ⚠️ Слишком коротко, добавьте детали
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center pt-4 border-t">
          {step > 1 && (
            <Button 
              variant="outline" 
              onClick={() => setStep(step - 1)}
              disabled={loading}
            >
              ← Назад
            </Button>
          )}
          
          <div className="flex-1" />
          
          {step < 3 ? (
            <Button 
              onClick={() => setStep(step + 1)} 
              disabled={step === 1 ? !isStep1Valid : !isStep2Valid}
            >
              Далее →
            </Button>
          ) : (
            <Button 
              onClick={handleSubmit} 
              disabled={!isStep3Valid || loading}
            >
              {loading ? 'Сохранение...' : 'Завершить'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

