/**
 * Шаг 9: Финальный экран - генерация промпта
 */

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Check, AlertCircle } from 'lucide-react';
import { briefingApi } from '@/services/briefingApi';
import type { OnboardingData } from './OnboardingWizard';

interface Step9Props {
  data: OnboardingData;
  onComplete: () => void;
  onBack: () => void;
}

export const Step9Completion: React.FC<Step9Props> = ({ data, onComplete, onBack }) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    // Автоматически начинаем генерацию при монтировании компонента
    generatePrompt();
  }, []);

  const generatePrompt = async () => {
    setStatus('loading');
    setErrorMessage('');

    try {
      const response = await briefingApi.generatePrompt(data);

      if (response.success) {
        setStatus('success');
        // Даем пользователю увидеть сообщение об успехе
        setTimeout(() => {
          onComplete();
        }, 1500);
      } else {
        setStatus('error');
        setErrorMessage(response.error || 'Произошла ошибка при генерации промпта');
      }
    } catch (error) {
      setStatus('error');
      setErrorMessage('Не удалось подключиться к серверу. Проверьте интернет-соединение.');
      console.error('Ошибка при генерации промпта:', error);
    }
  };

  return (
    <div className="space-y-6 py-8">
      <div className="text-center">
        {status === 'idle' && (
          <>
            <h3 className="text-xl font-semibold mb-4">
              Готовы создать ваш персональный промпт?
            </h3>
            <p className="text-muted-foreground mb-6">
              Нажмите кнопку ниже, чтобы начать генерацию
            </p>
          </>
        )}

        {status === 'loading' && (
          <>
            <div className="flex justify-center mb-4">
              <Loader2 className="h-16 w-16 animate-spin text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-4">
              Создаем ваш персональный промпт...
            </h3>
            <p className="text-muted-foreground mb-6">
              Это может занять несколько секунд. AI анализирует информацию о вашем бизнесе 
              и создает оптимальную стратегию для рекламных креативов.
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="flex justify-center mb-4">
              <div className="rounded-full bg-green-100 p-4">
                <Check className="h-16 w-16 text-green-600" />
              </div>
            </div>
            <h3 className="text-xl font-semibold mb-4 text-green-600">
              Промпт успешно создан!
            </h3>
            <p className="text-muted-foreground mb-6">
              Ваш персональный AI-помощник готов генерировать эффективные рекламные креативы. 
              Сейчас вы будете перенаправлены в приложение.
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="flex justify-center mb-4">
              <div className="rounded-full bg-red-100 p-4">
                <AlertCircle className="h-16 w-16 text-red-600" />
              </div>
            </div>
            <h3 className="text-xl font-semibold mb-4 text-red-600">
              Произошла ошибка
            </h3>
            <p className="text-muted-foreground mb-6">
              {errorMessage}
            </p>
          </>
        )}
      </div>

      {status === 'error' && (
        <div className="flex justify-between">
          <Button type="button" variant="outline" onClick={onBack} disabled={status === 'loading'}>
            Назад
          </Button>
          <Button onClick={generatePrompt} disabled={status === 'loading'}>
            Попробовать снова
          </Button>
        </div>
      )}
    </div>
  );
};


