/**
 * usePageTracking Hook
 *
 * Автоматически отслеживает page views при навигации
 * Используется в App.tsx для глобального трекинга
 *
 * @module hooks/usePageTracking
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { analytics } from '@/lib/analytics';

// Маппинг путей к человекочитаемым названиям
const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/login': 'Login',
  '/signup': 'Signup',
  '/profile': 'Profile',
  '/roi': 'ROI Analytics',
  '/creatives': 'Creative Generation',
  '/videos': 'Creatives Library',
  '/carousel-test': 'Carousel Test',
  '/competitors': 'Competitors',
  '/ad-settings': 'Ad Settings',
  '/whatsapp-analysis': 'WhatsApp Analysis',
  '/consultations': 'Consultations',
  '/knowledge-base': 'Knowledge Base',
  '/admin/analytics': 'Admin Analytics',
  '/privacy': 'Privacy Policy',
  '/terms': 'Terms of Service',
  '/oauth/callback': 'OAuth Callback'
};

/**
 * Получить заголовок страницы по пути
 */
function getPageTitle(pathname: string): string {
  // Точное совпадение
  if (PAGE_TITLES[pathname]) {
    return PAGE_TITLES[pathname];
  }

  // Динамические роуты
  if (pathname.startsWith('/campaign/')) {
    return 'Campaign Detail';
  }
  if (pathname.startsWith('/knowledge-base/')) {
    return 'Knowledge Base Article';
  }

  // Fallback - используем сам путь
  return pathname;
}

/**
 * Hook для автоматического отслеживания page views
 * Должен быть вызван внутри Router
 */
export function usePageTracking(): void {
  const location = useLocation();

  useEffect(() => {
    const title = getPageTitle(location.pathname);
    analytics.trackPageView(location.pathname, title);
  }, [location.pathname]);
}
