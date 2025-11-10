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
    formData.business_description.length >= 3;
  const isStep2Valid = 
    formData.target_audience.length >= 3 && 
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
                Шаг 1 из 2
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
                  rows={4}
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
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="text-sm text-gray-500 mb-4">
                Шаг 2 из 2
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

              <div>
                <Label htmlFor="challenges">
                  4. Какие задачи или проблемы вы пытаетесь решить в вашем бизнесе? *
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
          
          {step < 2 ? (
            <Button 
              onClick={() => setStep(step + 1)} 
              disabled={!isStep1Valid}
            >
              Далее →
            </Button>
          ) : (
            <Button 
              onClick={handleSubmit} 
              disabled={!isStep2Valid || loading}
            >
              {loading ? 'Сохранение...' : 'Завершить'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

