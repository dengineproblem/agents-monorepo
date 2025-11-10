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
    ideal_client_profile: '',
    non_target_profile: '',
    client_pains: '',
    interest_and_objections: '',
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
    formData.ideal_client_profile.length >= 3 && 
    formData.non_target_profile.length >= 3 &&
    formData.client_pains.length >= 3 &&
    formData.interest_and_objections.length >= 3;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-2xl" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Добро пожаловать в WhatsApp CRM! 🎉</DialogTitle>
          <DialogDescription>
            Ответьте на 9 вопросов, чтобы AI точно анализировал ваших лидов с учётом специфики вашего бизнеса.
            Это займет 3-4 минуты.
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
                Шаг 3 из 3: Сигналы и характеристики
              </div>

              <div>
                <Label htmlFor="ideal">
                  6. Опишите идеального клиента *
                </Label>
                <Textarea
                  id="ideal"
                  placeholder="Например: B2B, владелец стоматологической клиники, есть отдел продаж, готов инвестировать от 500к/мес"
                  value={formData.ideal_client_profile}
                  onChange={(e) => setFormData({ ...formData, ideal_client_profile: e.target.value })}
                  rows={3}
                  className="mt-2"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Минимум 3 символа. Сегмент, ниша, должность, характеристики
                </p>
                {formData.ideal_client_profile.length > 0 && formData.ideal_client_profile.length < 3 && (
                  <p className="text-xs text-red-500 mt-1">
                    ⚠️ Слишком коротко, добавьте детали
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="nontarget">
                  7. Кто точно не подходит как клиент *
                </Label>
                <Textarea
                  id="nontarget"
                  placeholder="Например: B2C клиенты, начинающие без бюджета, сотрудники без полномочий"
                  value={formData.non_target_profile}
                  onChange={(e) => setFormData({ ...formData, non_target_profile: e.target.value })}
                  rows={3}
                  className="mt-2"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Минимум 3 символа. Кого мы НЕ хотим видеть в качестве клиента
                </p>
                {formData.non_target_profile.length > 0 && formData.non_target_profile.length < 3 && (
                  <p className="text-xs text-red-500 mt-1">
                    ⚠️ Слишком коротко, добавьте детали
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="pains">
                  8. Типичные боли и запросы идеальных клиентов *
                </Label>
                <Textarea
                  id="pains"
                  placeholder="Например: 'мало заявок', 'высокая стоимость лида', 'реклама не работает', 'нужно масштабироваться'"
                  value={formData.client_pains}
                  onChange={(e) => setFormData({ ...formData, client_pains: e.target.value })}
                  rows={3}
                  className="mt-2"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Минимум 3 символа. Какие проблемы они хотят решить?
                </p>
                {formData.client_pains.length > 0 && formData.client_pains.length < 3 && (
                  <p className="text-xs text-red-500 mt-1">
                    ⚠️ Слишком коротко, добавьте детали
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="signals">
                  9. Фразы интереса и типичные возражения *
                </Label>
                <Textarea
                  id="signals"
                  placeholder="Интерес: 'хочу узнать подробнее', 'сколько стоит', 'когда можем начать'. Возражения: 'дорого', 'подумаю', 'нет бюджета'"
                  value={formData.interest_and_objections}
                  onChange={(e) => setFormData({ ...formData, interest_and_objections: e.target.value })}
                  rows={4}
                  className="mt-2"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Минимум 3 символа. Что говорят заинтересованные клиенты и какие возражения озвучивают
                </p>
                {formData.interest_and_objections.length > 0 && formData.interest_and_objections.length < 3 && (
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

