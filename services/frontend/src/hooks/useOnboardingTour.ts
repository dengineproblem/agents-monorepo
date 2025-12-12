import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { tourSteps, TOUR_STORAGE_KEY, type TourStep } from '@/content/onboarding-tour';

interface UseOnboardingTourReturn {
  // Состояние
  isActive: boolean;
  currentStep: TourStep | null;
  currentStepIndex: number;
  totalSteps: number;

  // Управление
  startTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
  completeTour: () => void;

  // Проверки
  isTourCompleted: boolean;
  shouldShowTour: (isFbConnected: boolean) => boolean;
}

// Функция для скролла к элементу
const scrollToElement = (selector: string) => {
  const element = document.querySelector(selector);
  if (element) {
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'center',
    });
  }
};

export const useOnboardingTour = (): UseOnboardingTourReturn => {
  const [isActive, setIsActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const navigationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isTourCompleted = localStorage.getItem(TOUR_STORAGE_KEY) === 'true';
  const totalSteps = tourSteps.length;
  const currentStep = isActive ? tourSteps[currentStepIndex] : null;

  // Проверка, нужно ли показывать тур
  const shouldShowTour = useCallback((isFbConnected: boolean): boolean => {
    return !isTourCompleted && isFbConnected;
  }, [isTourCompleted]);

  // Запуск тура
  const startTour = useCallback(() => {
    setCurrentStepIndex(0);
    setIsActive(true);
  }, []);

  // Переход к следующему шагу
  const nextStep = useCallback(() => {
    if (isNavigating) return;

    const currentStepData = tourSteps[currentStepIndex];
    const nextIndex = currentStepIndex + 1;

    // Если текущий шаг имеет navigateTo — сначала переходим
    if (currentStepData?.navigateTo && location.pathname !== currentStepData.navigateTo) {
      setIsNavigating(true);
      navigate(currentStepData.navigateTo);

      // После навигации переходим к следующему шагу
      navigationTimeoutRef.current = setTimeout(() => {
        if (nextIndex >= totalSteps) {
          localStorage.setItem(TOUR_STORAGE_KEY, 'true');
          setIsActive(false);
          setCurrentStepIndex(0);
        } else {
          setCurrentStepIndex(nextIndex);
        }
        setIsNavigating(false);
      }, 400);
      return;
    }

    // Если навигация не нужна — просто переходим к следующему шагу
    if (nextIndex >= totalSteps) {
      localStorage.setItem(TOUR_STORAGE_KEY, 'true');
      setIsActive(false);
      setCurrentStepIndex(0);
      return;
    }

    setCurrentStepIndex(nextIndex);
  }, [currentStepIndex, totalSteps, isNavigating, navigate, location.pathname]);

  // Переход к предыдущему шагу
  const prevStep = useCallback(() => {
    if (isNavigating) return;

    if (currentStepIndex > 0) {
      const prevIndex = currentStepIndex - 1;
      const prevStepData = tourSteps[prevIndex];

      // Находим к какой странице относится предыдущий шаг
      // Ищем последний navigateTo перед этим шагом
      let targetPath: string | undefined;
      for (let i = prevIndex; i >= 0; i--) {
        if (tourSteps[i].navigateTo) {
          targetPath = tourSteps[i].navigateTo;
          break;
        }
      }

      // Если шаг на кнопке сайдбара — не нужна навигация
      if (prevStepData.id.startsWith('sidebar-')) {
        // Нужно понять, на какой странице мы должны быть
        // Ищем предыдущий navigateTo среди более ранних шагов
        for (let i = prevIndex - 1; i >= 0; i--) {
          if (tourSteps[i].navigateTo) {
            targetPath = tourSteps[i].navigateTo;
            break;
          }
        }
      }

      if (targetPath && location.pathname !== targetPath) {
        setIsNavigating(true);
        navigate(targetPath);
        navigationTimeoutRef.current = setTimeout(() => {
          setCurrentStepIndex(prevIndex);
          setIsNavigating(false);
        }, 400);
      } else {
        setCurrentStepIndex(prevIndex);
      }
    }
  }, [currentStepIndex, isNavigating, navigate, location.pathname]);

  // Пропуск тура
  const skipTour = useCallback(() => {
    if (navigationTimeoutRef.current) {
      clearTimeout(navigationTimeoutRef.current);
    }
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    localStorage.setItem(TOUR_STORAGE_KEY, 'true');
    setIsActive(false);
    setCurrentStepIndex(0);
    setIsNavigating(false);
  }, []);

  // Завершение тура
  const completeTour = useCallback(() => {
    localStorage.setItem(TOUR_STORAGE_KEY, 'true');
    setIsActive(false);
    setCurrentStepIndex(0);
  }, []);

  // Автоскролл к элементу при смене шага
  useEffect(() => {
    if (!isActive || !currentStep || isNavigating) return;

    if (currentStep.scrollToElement && currentStep.selector) {
      scrollTimeoutRef.current = setTimeout(() => {
        scrollToElement(currentStep.selector!);
      }, currentStep.delay || 200);

      return () => {
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }
      };
    }
  }, [isActive, currentStep, currentStepIndex, isNavigating]);

  // Обработка ESC для закрытия тура
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        skipTour();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActive, skipTour]);

  // Cleanup при размонтировании
  useEffect(() => {
    return () => {
      if (navigationTimeoutRef.current) {
        clearTimeout(navigationTimeoutRef.current);
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  return {
    isActive,
    currentStep,
    currentStepIndex,
    totalSteps,
    startTour,
    nextStep,
    prevStep,
    skipTour,
    completeTour,
    isTourCompleted,
    shouldShowTour,
  };
};

// Функция для сброса тура (для повторного прохождения)
export const resetOnboardingTour = () => {
  localStorage.removeItem(TOUR_STORAGE_KEY);
};

// Функция для принудительного запуска тура (глобальное событие)
export const forceStartTour = () => {
  localStorage.removeItem(TOUR_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent('forceStartOnboardingTour'));
};
