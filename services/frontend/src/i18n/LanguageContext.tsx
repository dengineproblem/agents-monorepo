import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations, type Language } from './translations';
import { APP_REVIEW_MODE } from '../config/appReview';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // В App Review mode по умолчанию английский, в Production - русский
  const defaultLang: Language = APP_REVIEW_MODE ? 'en' : 'ru';
  
  const [language, setLanguageState] = useState<Language>(() => {
    // В App Review mode всегда английский
    if (APP_REVIEW_MODE) return 'en';
    
    // В Production - читаем из localStorage или используем русский
    const saved = localStorage.getItem('language');
    return (saved === 'en' || saved === 'ru') ? saved : defaultLang;
  });

  useEffect(() => {
    // Сохраняем язык только в Production режиме
    if (!APP_REVIEW_MODE) {
      localStorage.setItem('language', language);
    }
  }, [language]);

  const setLanguage = (lang: Language) => {
    // В App Review mode запрещаем переключение с английского
    if (APP_REVIEW_MODE && lang !== 'en') {

      return;
    }
    setLanguageState(lang);
  };

  const t = (key: string): string => {
    const keys = key.split('.');
    let value: any = translations[language];
    
    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k];
      } else {
        return key; // Fallback to key if translation not found
      }
    }
    
    return typeof value === 'string' ? value : key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useTranslation = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used within LanguageProvider');
  }
  return context;
};

