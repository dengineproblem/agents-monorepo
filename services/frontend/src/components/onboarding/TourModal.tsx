import React, { useEffect, useState } from 'react';
import { Rocket, PartyPopper, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TourModalProps {
  type: 'welcome' | 'completion';
  isVisible: boolean;
  title: string;
  content: string;
  onAction: () => void;
  onSkip?: () => void;
}

export const TourModal: React.FC<TourModalProps> = ({
  type,
  isVisible,
  title,
  content,
  onAction,
  onSkip,
}) => {
  const [shouldRender, setShouldRender] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showContent, setShowContent] = useState(false);

  const isWelcome = type === 'welcome';

  useEffect(() => {
    if (isVisible) {
      setShouldRender(true);
      // Запускаем анимацию появления
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsAnimating(true);
          // Показываем контент с задержкой
          setTimeout(() => setShowContent(true), 200);
        });
      });
    } else {
      setIsAnimating(false);
      setShowContent(false);
      const timer = setTimeout(() => setShouldRender(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 transition-opacity duration-300 ${
        isAnimating ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Backdrop с blur */}
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          isAnimating ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onSkip}
      />

      {/* Модальное окно */}
      <div
        className={`relative bg-card rounded-2xl shadow-2xl border border-border max-w-md w-full overflow-hidden transition-all duration-300 ease-out ${
          isAnimating
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-95 translate-y-5'
        }`}
      >
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10 pointer-events-none" />

        {/* Кнопка закрытия (только для welcome) */}
        {isWelcome && onSkip && (
          <button
            onClick={onSkip}
            className="absolute top-4 right-4 p-2 rounded-full hover:bg-muted transition-colors z-10"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        )}

        {/* Контент */}
        <div className="relative p-8 text-center">
          {/* Иконка */}
          <div
            className={`mx-auto mb-6 transition-all duration-300 ease-out ${
              showContent ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
            }`}
            style={{ transitionDelay: '100ms' }}
          >
            <div className="relative inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10">
              {isWelcome ? (
                <PartyPopper className="w-10 h-10 text-primary" />
              ) : (
                <Rocket className="w-10 h-10 text-primary" />
              )}

              {/* Анимированные круги */}
              <div className="absolute inset-0 rounded-full bg-primary/20 animate-pulse-slow" />
              <div
                className="absolute inset-0 rounded-full bg-primary/10 animate-pulse-slower"
                style={{ animationDelay: '0.3s' }}
              />
            </div>
          </div>

          {/* Заголовок */}
          <h2
            className={`text-2xl font-bold text-foreground mb-3 transition-all duration-300 ${
              showContent
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 translate-y-3'
            }`}
            style={{ transitionDelay: '200ms' }}
          >
            {isWelcome ? '🎉 ' : '🚀 '}
            {title}
          </h2>

          {/* Описание */}
          <p
            className={`text-muted-foreground mb-8 leading-relaxed transition-all duration-300 ${
              showContent
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 translate-y-3'
            }`}
            style={{ transitionDelay: '300ms' }}
          >
            {content}
          </p>

          {/* Кнопки */}
          <div
            className={`flex flex-col gap-3 transition-all duration-300 ${
              showContent
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 translate-y-3'
            }`}
            style={{ transitionDelay: '400ms' }}
          >
            <Button
              size="lg"
              onClick={onAction}
              className="w-full bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-white font-semibold shadow-lg shadow-primary/25 transition-all hover:shadow-xl hover:shadow-primary/30"
            >
              {isWelcome ? 'Поехали!' : 'Начать работу'}
            </Button>

            {isWelcome && onSkip && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onSkip}
                className="text-muted-foreground hover:text-foreground"
              >
                Пропустить обучение
              </Button>
            )}
          </div>
        </div>

        {/* Декоративные элементы для completion */}
        {!isWelcome && (
          <>
            <div
              className={`absolute top-4 left-4 text-2xl transition-all duration-300 ${
                showContent
                  ? 'opacity-100 translate-x-0'
                  : 'opacity-0 -translate-x-5'
              }`}
              style={{ transitionDelay: '500ms' }}
            >
              ✨
            </div>
            <div
              className={`absolute top-8 right-8 text-xl transition-all duration-300 ${
                showContent
                  ? 'opacity-100 translate-x-0'
                  : 'opacity-0 translate-x-5'
              }`}
              style={{ transitionDelay: '600ms' }}
            >
              🎯
            </div>
            <div
              className={`absolute bottom-12 left-8 text-lg transition-all duration-300 ${
                showContent
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 translate-y-5'
              }`}
              style={{ transitionDelay: '700ms' }}
            >
              💪
            </div>
          </>
        )}
      </div>

      {/* CSS для пульсирующей анимации */}
      <style>{`
        @keyframes pulse-slow {
          0%, 100% {
            transform: scale(1);
            opacity: 0.5;
          }
          50% {
            transform: scale(1.2);
            opacity: 0.2;
          }
        }
        @keyframes pulse-slower {
          0%, 100% {
            transform: scale(1);
            opacity: 0.3;
          }
          50% {
            transform: scale(1.4);
            opacity: 0.1;
          }
        }
        .animate-pulse-slow {
          animation: pulse-slow 2s ease-in-out infinite;
        }
        .animate-pulse-slower {
          animation: pulse-slower 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};
