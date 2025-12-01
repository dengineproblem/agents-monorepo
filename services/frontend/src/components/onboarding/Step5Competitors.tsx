/**
 * Шаг 5: Конкуренты (опциональный)
 * Пользователь может указать до 5 Instagram аккаунтов конкурентов
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X, Plus, Instagram } from 'lucide-react';
import type { OnboardingData } from './OnboardingWizard';

interface Step5Props {
  data: Partial<OnboardingData>;
  onNext: (data: Partial<OnboardingData>) => void;
  onBack: () => void;
}

const MAX_COMPETITORS = 5;

/**
 * Нормализует Instagram handle (удаляет @ и URL части)
 */
function normalizeInstagramHandle(input: string): string {
  let handle = input.trim().toLowerCase();

  // Удаляем URL части если это полная ссылка
  if (handle.includes('instagram.com')) {
    const match = handle.match(/instagram\.com\/([a-z0-9._]+)/i);
    if (match) {
      handle = match[1];
    }
  }

  // Удаляем @ в начале
  handle = handle.replace(/^@/, '');

  // Удаляем trailing slash и query params
  handle = handle.split('/')[0].split('?')[0];

  return handle;
}

/**
 * Проверяет валидность Instagram handle
 */
function isValidInstagramHandle(handle: string): boolean {
  // Instagram handles: 1-30 символов, буквы, цифры, точки, подчеркивания
  return /^[a-z0-9._]{1,30}$/i.test(handle);
}

export const Step5Competitors: React.FC<Step5Props> = ({ data, onNext, onBack }) => {
  const [competitors, setCompetitors] = useState<string[]>(
    data.competitor_instagrams || []
  );
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState('');

  const handleAddCompetitor = () => {
    if (!inputValue.trim()) return;

    const handle = normalizeInstagramHandle(inputValue);

    if (!isValidInstagramHandle(handle)) {
      setError('Некорректный Instagram аккаунт');
      return;
    }

    if (competitors.includes(handle)) {
      setError('Этот аккаунт уже добавлен');
      return;
    }

    if (competitors.length >= MAX_COMPETITORS) {
      setError(`Максимум ${MAX_COMPETITORS} конкурентов`);
      return;
    }

    setCompetitors([...competitors, handle]);
    setInputValue('');
    setError('');
  };

  const handleRemoveCompetitor = (index: number) => {
    setCompetitors(competitors.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddCompetitor();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext({
      competitor_instagrams: competitors.length > 0 ? competitors : undefined,
    });
  };

  const handleSkip = () => {
    onNext({
      competitor_instagrams: undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold mb-4">
          Ваши конкуренты
        </h3>
        <p className="text-muted-foreground mb-6">
          Укажите Instagram аккаунты конкурентов (до {MAX_COMPETITORS}).
          Мы будем отслеживать их рекламные креативы и показывать вам лучшие идеи.
        </p>
      </div>

      <div className="space-y-4">
        {/* Список добавленных конкурентов */}
        {competitors.length > 0 && (
          <div className="space-y-2">
            <Label>Добавленные конкуренты</Label>
            <div className="flex flex-wrap gap-2">
              {competitors.map((handle, index) => (
                <div
                  key={handle}
                  className="flex items-center gap-2 bg-muted px-3 py-1.5 rounded-full"
                >
                  <Instagram className="h-4 w-4 text-pink-500" />
                  <span className="text-sm">@{handle}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveCompetitor(index)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Поле ввода */}
        {competitors.length < MAX_COMPETITORS && (
          <div>
            <Label htmlFor="competitor">
              Добавить конкурента
            </Label>
            <div className="flex gap-2 mt-1.5">
              <div className="relative flex-1">
                <Instagram className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="competitor"
                  placeholder="@username или ссылка на Instagram"
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    setError('');
                  }}
                  onKeyDown={handleKeyDown}
                  className="pl-10"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleAddCompetitor}
                disabled={!inputValue.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {error && (
              <p className="text-sm text-destructive mt-1">{error}</p>
            )}
            <p className="text-sm text-muted-foreground mt-1">
              Введите @username или вставьте ссылку на профиль
            </p>
          </div>
        )}

        {/* Подсказка */}
        <div className="bg-muted/50 rounded-lg p-4">
          <p className="text-sm text-muted-foreground">
            <strong>Зачем это нужно?</strong><br />
            Мы найдём рекламные объявления ваших конкурентов в Meta Ads Library
            и покажем вам самые эффективные креативы. Вы сможете вдохновляться
            их идеями и создавать ещё более привлекательную рекламу.
          </p>
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
            {competitors.length > 0 ? 'Далее' : 'Пропустить'}
          </Button>
        </div>
      </div>
    </form>
  );
};
