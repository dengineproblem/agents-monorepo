import React, { useEffect, useState, useRef } from 'react';

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TourOverlayProps {
  isVisible: boolean;
  targetSelector?: string;
  padding?: number;
}

export const TourOverlay: React.FC<TourOverlayProps> = ({
  isVisible,
  targetSelector,
  padding = 8,
}) => {
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const [shouldRender, setShouldRender] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isVisible) {
      setShouldRender(true);
      requestAnimationFrame(() => setIsAnimating(true));
    } else {
      setIsAnimating(false);
      const timer = setTimeout(() => setShouldRender(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || !targetSelector) {
      setSpotlight(null);
      return;
    }

    const updateSpotlight = () => {
      // Пробуем найти элемент по селектору
      const selectors = targetSelector.split(', ');
      let element: Element | null = null;

      for (const sel of selectors) {
        element = document.querySelector(sel.trim());
        if (element) break;
      }

      if (element) {
        const rect = element.getBoundingClientRect();
        setSpotlight({
          top: rect.top - padding,
          left: rect.left - padding,
          width: rect.width + padding * 2,
          height: rect.height + padding * 2,
        });
      } else {
        setSpotlight(null);
      }
    };

    // Задержка для корректного расчёта после навигации
    updateTimeoutRef.current = setTimeout(updateSpotlight, 100);

    // Повторный расчёт через небольшое время (на случай анимаций)
    const secondUpdate = setTimeout(updateSpotlight, 300);

    window.addEventListener('resize', updateSpotlight);
    window.addEventListener('scroll', updateSpotlight, true);

    // MutationObserver для отслеживания изменений DOM
    const observer = new MutationObserver(() => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      updateTimeoutRef.current = setTimeout(updateSpotlight, 50);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      clearTimeout(secondUpdate);
      window.removeEventListener('resize', updateSpotlight);
      window.removeEventListener('scroll', updateSpotlight, true);
      observer.disconnect();
    };
  }, [isVisible, targetSelector, padding]);

  if (!shouldRender) return null;

  return (
    <>
      {/* Полноэкранный затемнённый overlay с вырезом */}
      <div
        className={`fixed inset-0 z-[9998] transition-opacity duration-300 ${
          isAnimating ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          background: spotlight
            ? `radial-gradient(ellipse ${spotlight.width + 20}px ${spotlight.height + 20}px at ${spotlight.left + spotlight.width / 2}px ${spotlight.top + spotlight.height / 2}px, transparent 0%, transparent 70%, rgba(0, 0, 0, 0.75) 100%)`
            : 'rgba(0, 0, 0, 0.75)',
          pointerEvents: 'none',
        }}
      />

      {/* Рамка подсветки вокруг элемента */}
      {spotlight && (
        <div
          className={`fixed z-[9999] pointer-events-none transition-all duration-300 ease-out ${
            isAnimating ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            borderRadius: '8px',
            boxShadow: `
              0 0 0 4px rgba(59, 130, 246, 0.8),
              0 0 20px 4px rgba(59, 130, 246, 0.4),
              inset 0 0 0 9999px transparent
            `,
          }}
        >
          {/* Пульсирующая анимация */}
          <div
            className="absolute inset-0 rounded-lg"
            style={{
              animation: 'tour-pulse 2s ease-in-out infinite',
            }}
          />
        </div>
      )}

      <style>{`
        @keyframes tour-pulse {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5);
          }
          50% {
            box-shadow: 0 0 0 8px rgba(59, 130, 246, 0);
          }
        }
      `}</style>
    </>
  );
};
