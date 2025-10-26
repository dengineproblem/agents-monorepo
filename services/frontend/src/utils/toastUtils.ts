import { toast } from 'sonner';
import { translations } from '../i18n/translations';
import { APP_REVIEW_MODE } from '../config/appReview';

/**
 * Get current language based on APP_REVIEW_MODE
 */
const getLang = () => {
  if (APP_REVIEW_MODE) return 'en';
  const saved = localStorage.getItem('language');
  return (saved === 'en' || saved === 'ru') ? saved : 'ru';
};

/**
 * Get translated text from toast translations
 */
const getToastText = (key: string): string => {
  const lang = getLang() as 'en' | 'ru';
  const toastTranslations = translations[lang].toast as any;
  return toastTranslations[key] || key;
};

/**
 * Toast utilities with automatic translation
 */
export const toastT = {
  error: (key: string) => toast.error(getToastText(key)),
  success: (key: string) => toast.success(getToastText(key)),
  info: (key: string) => toast.info(getToastText(key)),
  warning: (key: string) => toast.warning(getToastText(key)),
};
