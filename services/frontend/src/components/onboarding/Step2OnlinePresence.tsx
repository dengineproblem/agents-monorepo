/**
 * Шаг 2: Онлайн-присутствие (Instagram + Сайт)
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { OnboardingData } from './OnboardingWizard';

interface Step2Props {
  data: Partial<OnboardingData>;
  onNext: (data: Partial<OnboardingData>) => void;
  onBack: () => void;
}

export const Step2OnlinePresence: React.FC<Step2Props> = ({ data, onNext, onBack }) => {
  const [instagramUrl, setInstagramUrl] = useState(data.instagram_url || '');
  const [websiteUrl, setWebsiteUrl] = useState(data.website_url || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext({
      instagram_url: instagramUrl.trim() || undefined,
      website_url: websiteUrl.trim() || undefined,
    });
  };

  const handleSkip = () => {
    onNext({
      instagram_url: undefined,
      website_url: undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold mb-4">
          Онлайн-присутствие вашего бизнеса
        </h3>
        <p className="text-muted-foreground mb-6">
          Укажите ссылки на ваши онлайн-ресурсы, если они есть. Это поможет AI создавать более точные креативы.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="instagramUrl">
            Ссылка на Instagram
          </Label>
          <Input
            id="instagramUrl"
            type="text"
            placeholder="https://instagram.com/your_business"
            value={instagramUrl}
            onChange={(e) => setInstagramUrl(e.target.value)}
          />
          <p className="text-sm text-muted-foreground mt-1">
            Необязательно
          </p>
        </div>

        <div>
          <Label htmlFor="websiteUrl">
            Ссылка на сайт
          </Label>
          <Input
            id="websiteUrl"
            type="text"
            placeholder="https://your-website.com"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
          />
          <p className="text-sm text-muted-foreground mt-1">
            Необязательно
          </p>
        </div>
      </div>

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          Назад
        </Button>
        <div className="flex gap-2">
          {!instagramUrl && !websiteUrl && (
            <Button type="button" variant="ghost" onClick={handleSkip}>
              Пропустить
            </Button>
          )}
          <Button type="submit" size="lg">
            Далее
          </Button>
        </div>
      </div>
    </form>
  );
};

