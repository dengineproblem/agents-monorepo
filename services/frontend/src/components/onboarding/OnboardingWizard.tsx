/**
 * Главный компонент онбординг-wizard для брифа AI-таргетолог
 */

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { Step1BusinessInfo } from './Step1BusinessInfo';
import { Step2OnlinePresence } from './Step2OnlinePresence';
import { Step3TargetAudience } from './Step3TargetAudience';
import { Step4ProductInfo } from './Step4ProductInfo';
import { Step5Competitors } from './Step5Competitors';
import { Step6BudgetSettings } from './Step6BudgetSettings';
import { Step5Completion } from './Step5Completion';
import type { BriefingFormData } from '@/services/briefingApi';

const TOTAL_STEPS = 7;

export type OnboardingData = BriefingFormData;

interface OnboardingWizardProps {
  onComplete: () => void;
  onClose?: () => void; // Опциональный callback для закрытия (для мультиаккаунтного режима)
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onComplete, onClose }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<Partial<OnboardingData>>({});

  const progress = (currentStep / TOTAL_STEPS) * 100;

  const updateFormData = (data: Partial<OnboardingData>) => {
    setFormData((prev) => ({ ...prev, ...data }));
  };

  const goToNextStep = () => {
    if (currentStep < TOTAL_STEPS) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const goToPreviousStep = () => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <Step1BusinessInfo
            data={formData}
            onNext={(data) => {
              updateFormData(data);
              goToNextStep();
            }}
          />
        );
      case 2:
        return (
          <Step2OnlinePresence
            data={formData}
            onNext={(data) => {
              updateFormData(data);
              goToNextStep();
            }}
            onBack={goToPreviousStep}
          />
        );
      case 3:
        return (
          <Step3TargetAudience
            data={formData}
            onNext={(data) => {
              updateFormData(data);
              goToNextStep();
            }}
            onBack={goToPreviousStep}
          />
        );
      case 4:
        return (
          <Step4ProductInfo
            data={formData}
            onNext={(data) => {
              updateFormData(data);
              goToNextStep();
            }}
            onBack={goToPreviousStep}
          />
        );
      case 5:
        return (
          <Step5Competitors
            data={formData}
            onNext={(data) => {
              updateFormData(data);
              goToNextStep();
            }}
            onBack={goToPreviousStep}
          />
        );
      case 6:
        return (
          <Step6BudgetSettings
            data={formData}
            onNext={(data) => {
              updateFormData(data);
              goToNextStep();
            }}
            onBack={goToPreviousStep}
          />
        );
      case 7:
        return (
          <Step5Completion
            data={formData as OnboardingData}
            onComplete={onComplete}
            onBack={goToPreviousStep}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-background z-50 overflow-y-auto">
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          {/* Прогресс */}
          <div className="mb-8">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-2xl font-bold">Настройка AI-таргетолог</h2>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Шаг {currentStep} из {TOTAL_STEPS}
                </span>
                {/* Кнопка закрытия (только для мультиаккаунтного режима) */}
                {onClose && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={onClose}
                    title="Закрыть"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Контент шага */}
          <Card>
            <CardContent className="pt-6">
              {renderStep()}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

