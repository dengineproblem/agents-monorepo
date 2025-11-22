/**
 * Главный компонент онбординг-wizard для брифа AI-таргетолог
 */

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Step1BusinessInfo } from './Step1BusinessInfo';
import { Step2OnlinePresence } from './Step2OnlinePresence';
import { Step3TargetAudience } from './Step3TargetAudience';
import { Step4ProductInfo } from './Step4ProductInfo';
import { Step5Completion } from './Step5Completion';
import type { BriefingFormData } from '@/services/briefingApi';

const TOTAL_STEPS = 5;

export type OnboardingData = BriefingFormData;

interface OnboardingWizardProps {
  onComplete: () => void;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onComplete }) => {
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
              <span className="text-sm text-muted-foreground">
                Шаг {currentStep} из {TOTAL_STEPS}
              </span>
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

