
import { useEffect, useState } from 'react';

// Объявляем типы для Telegram WebApp API
declare global {
  interface Window {
    Telegram: {
      WebApp: {
        ready: () => void;
        expand: () => void;
        close: () => void;
        isExpanded: boolean;
        MainButton: {
          text: string;
          color: string;
          textColor: string;
          isVisible: boolean;
          isActive: boolean;
          isProgressVisible: boolean;
          show: () => void;
          hide: () => void;
          enable: () => void;
          disable: () => void;
          showProgress: (leaveActive: boolean) => void;
          hideProgress: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
          setText: (text: string) => void;
        };
        BackButton: {
          isVisible: boolean;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };
        themeParams: {
          bg_color: string;
          text_color: string;
          hint_color: string;
          link_color: string;
          button_color: string;
          button_text_color: string;
          secondary_bg_color: string;
        };
        colorScheme: "light" | "dark";
        initData: string;
        initDataUnsafe: {
          query_id: string;
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            language_code?: string;
          };
          auth_date: string;
          hash: string;
        };
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
      };
    };
  }
}

interface TelegramWebApp {
  initData: string;
  tg: typeof window.Telegram.WebApp;
  user: {
    id: number;
    firstName: string;
    lastName?: string;
    username?: string;
    languageCode?: string;
  } | null;
  isReady: boolean;
}

export const useTelegramWebApp = (): TelegramWebApp => {
  const [isReady, setIsReady] = useState(false);
  
  // Проверяем, доступен ли Telegram Web App
  const isTelegramWebAppAvailable = typeof window !== 'undefined' && window.Telegram?.WebApp;
  
  // Получаем данные о пользователе из Telegram WebApp
  const user = isTelegramWebAppAvailable && window.Telegram.WebApp.initDataUnsafe.user
    ? {
        id: window.Telegram.WebApp.initDataUnsafe.user.id,
        firstName: window.Telegram.WebApp.initDataUnsafe.user.first_name,
        lastName: window.Telegram.WebApp.initDataUnsafe.user.last_name,
        username: window.Telegram.WebApp.initDataUnsafe.user.username,
        languageCode: window.Telegram.WebApp.initDataUnsafe.user.language_code,
      }
    : null;
  
  useEffect(() => {
    // Если Telegram WebApp доступен
    if (isTelegramWebAppAvailable) {
      // Сообщаем Telegram что приложение готово
      window.Telegram.WebApp.ready();
      
      // Расширяем приложение на весь экран
      window.Telegram.WebApp.expand();
      
      // Устанавливаем состояние готовности
      setIsReady(true);
    }
  }, [isTelegramWebAppAvailable]);
  
  return {
    initData: isTelegramWebAppAvailable ? window.Telegram.WebApp.initData : '',
    tg: isTelegramWebAppAvailable ? window.Telegram.WebApp : ({} as typeof window.Telegram.WebApp),
    user,
    isReady,
  };
};
