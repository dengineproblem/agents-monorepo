import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { TourOverlay } from './TourOverlay';
import { TourTooltip } from './TourTooltip';
import { TourModal } from './TourModal';
import { useOnboardingTour } from '@/hooks/useOnboardingTour';
import { tourSteps } from '@/content/onboarding-tour';

interface OnboardingTourProps {
  isFbConnected: boolean;
  autoStart?: boolean;
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({
  isFbConnected,
  autoStart = true,
}) => {
  const {
    isActive,
    currentStep,
    currentStepIndex,
    startTour,
    nextStep,
    prevStep,
    skipTour,
    shouldShowTour,
  } = useOnboardingTour();

  // Автоматический запуск тура при первом входе после подключения FB
  useEffect(() => {
    const shouldStart = shouldShowTour(isFbConnected);
    console.log('[OnboardingTour] Check:', {
      autoStart,
      isFbConnected,
      shouldStart,
      isActive,
      isTourCompleted: localStorage.getItem('onboardingTourCompleted'),
    });

    if (autoStart && shouldStart && !isActive) {
      console.log('[OnboardingTour] Starting tour in 500ms...');
      const timer = setTimeout(() => {
        console.log('[OnboardingTour] Starting tour NOW');
        startTour();
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [autoStart, isFbConnected, shouldShowTour, isActive, startTour]);

  // Слушаем событие принудительного запуска тура
  useEffect(() => {
    const handleForceStart = () => {
      console.log('[OnboardingTour] Force start event received');
      startTour();
    };

    window.addEventListener('forceStartOnboardingTour', handleForceStart);
    return () => window.removeEventListener('forceStartOnboardingTour', handleForceStart);
  }, [startTour]);

  // Если тур не активен, ничего не рендерим
  if (!isActive || !currentStep) {
    return null;
  }

  const isWelcomeModal = currentStep.type === 'modal' && currentStep.id === 'welcome';
  const isCompletionModal = currentStep.type === 'modal' && currentStep.id === 'completion';
  const isTooltip = currentStep.type === 'tooltip';

  // Фильтруем только tooltip-шаги для расчёта прогресса (без модалок)
  const tooltipSteps = tourSteps.filter(s => s.type === 'tooltip');
  const tooltipIndex = tooltipSteps.findIndex(s => s.id === currentStep.id);
  const tooltipTotal = tooltipSteps.length;

  // Проверяем, можно ли идти назад (не на первом tooltip и не на модалках)
  const canGoPrev = isTooltip && tooltipIndex > 0;

  const tourContent = (
    <>
      {/* Welcome Modal */}
      <TourModal
        type="welcome"
        isVisible={isWelcomeModal}
        title={currentStep.title}
        content={currentStep.content}
        onAction={nextStep}
        onSkip={skipTour}
      />

      {/* Completion Modal */}
      <TourModal
        type="completion"
        isVisible={isCompletionModal}
        title={currentStep.title}
        content={currentStep.content}
        onAction={skipTour}
      />

      {/* Tooltip с Overlay */}
      {isTooltip && (
        <>
          <TourOverlay
            isVisible={true}
            targetSelector={currentStep.selector}
          />
          <TourTooltip
            step={currentStep}
            currentStepIndex={tooltipIndex}
            totalSteps={tooltipTotal}
            isVisible={true}
            onNext={nextStep}
            onPrev={canGoPrev ? prevStep : undefined}
            onSkip={skipTour}
          />
        </>
      )}
    </>
  );

  // Рендерим в портал для правильного z-index
  return createPortal(tourContent, document.body);
};

// Экспортируем для использования в других компонентах
export { useOnboardingTour, resetOnboardingTour, forceStartTour } from '@/hooks/useOnboardingTour';
