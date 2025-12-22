/**
 * Error Translations Utility
 *
 * Переводит технические сообщения об ошибках на понятный русский язык
 */

interface ErrorTranslation {
  pattern: RegExp | string;
  message: string;
}

/**
 * Словарь переводов ошибок
 * Порядок важен - первое совпадение будет использовано
 */
const errorTranslations: ErrorTranslation[] = [
  // Facebook API errors
  { pattern: /Invalid OAuth access token/i, message: 'Токен Facebook истёк. Переподключите аккаунт в настройках.' },
  { pattern: /token.*expir/i, message: 'Токен доступа истёк. Переподключите аккаунт.' },
  { pattern: /rate limit/i, message: 'Превышен лимит запросов. Подождите несколько минут.' },
  { pattern: /permission/i, message: 'Недостаточно прав для выполнения операции.' },
  { pattern: /Session has expired/i, message: 'Сессия истекла. Войдите в систему заново.' },
  { pattern: /Error validating application/i, message: 'Ошибка авторизации Facebook. Переподключите аккаунт.' },

  // Facebook Ads specific
  { pattern: /ad.*account.*disabled/i, message: 'Рекламный аккаунт отключён.' },
  { pattern: /ad.*rejected/i, message: 'Объявление отклонено Facebook.' },
  { pattern: /policy.*violation/i, message: 'Нарушение правил Facebook Ads.' },
  { pattern: /spending limit/i, message: 'Достигнут лимит расходов.' },
  { pattern: /billing/i, message: 'Проблема с оплатой в рекламном кабинете.' },
  { pattern: /payment/i, message: 'Проблема с оплатой.' },
  { pattern: /creative.*not.*found/i, message: 'Креатив не найден.' },
  { pattern: /adset.*not.*found/i, message: 'Группа объявлений не найдена.' },
  { pattern: /campaign.*not.*found/i, message: 'Кампания не найдена.' },

  // Network errors
  { pattern: /network.*error/i, message: 'Ошибка сети. Проверьте подключение к интернету.' },
  { pattern: /timeout/i, message: 'Превышено время ожидания. Попробуйте ещё раз.' },
  { pattern: /fetch failed/i, message: 'Не удалось выполнить запрос. Проверьте подключение.' },
  { pattern: /connection.*refused/i, message: 'Сервер недоступен. Попробуйте позже.' },
  { pattern: /ECONNREFUSED/i, message: 'Сервер недоступен.' },
  { pattern: /ETIMEDOUT/i, message: 'Превышено время ожидания.' },

  // Authentication errors
  { pattern: /unauthorized/i, message: 'Требуется авторизация.' },
  { pattern: /forbidden/i, message: 'Доступ запрещён.' },
  { pattern: /not.*authenticated/i, message: 'Вы не авторизованы.' },
  { pattern: /invalid.*credentials/i, message: 'Неверные учётные данные.' },
  { pattern: /login.*required/i, message: 'Требуется вход в систему.' },

  // Validation errors
  { pattern: /required.*field/i, message: 'Заполните обязательные поля.' },
  { pattern: /invalid.*format/i, message: 'Неверный формат данных.' },
  { pattern: /validation.*failed/i, message: 'Проверьте правильность введённых данных.' },
  { pattern: /already.*exists/i, message: 'Такая запись уже существует.' },
  { pattern: /not.*found/i, message: 'Запись не найдена.' },
  { pattern: /duplicate/i, message: 'Такая запись уже существует.' },

  // File upload errors
  { pattern: /file.*too.*large/i, message: 'Файл слишком большой.' },
  { pattern: /invalid.*file.*type/i, message: 'Неподдерживаемый формат файла.' },
  { pattern: /upload.*failed/i, message: 'Не удалось загрузить файл.' },

  // WhatsApp/Evolution API errors
  { pattern: /whatsapp.*not.*connected/i, message: 'WhatsApp не подключён.' },
  { pattern: /instance.*not.*found/i, message: 'WhatsApp сессия не найдена.' },
  { pattern: /qr.*code.*expired/i, message: 'QR-код истёк. Получите новый.' },

  // Generic API errors
  { pattern: /internal.*server.*error/i, message: 'Ошибка сервера. Попробуйте позже.' },
  { pattern: /bad.*request/i, message: 'Неверный запрос.' },
  { pattern: /service.*unavailable/i, message: 'Сервис временно недоступен.' },
  { pattern: /too.*many.*requests/i, message: 'Слишком много запросов. Подождите.' },

  // TikTok
  { pattern: /tiktok.*connect/i, message: 'Не удалось подключить TikTok.' },

  // AmoCRM / Bitrix24
  { pattern: /amocrm/i, message: 'Ошибка интеграции с AmoCRM.' },
  { pattern: /bitrix/i, message: 'Ошибка интеграции с Bitrix24.' },

  // Generic
  { pattern: /failed/i, message: 'Операция не выполнена. Попробуйте ещё раз.' },
  { pattern: /error/i, message: 'Произошла ошибка. Попробуйте ещё раз.' },
];

/**
 * Переводит сообщение об ошибке на русский язык
 * @param error - сообщение об ошибке или объект Error
 * @param fallback - сообщение по умолчанию
 * @returns переведённое сообщение
 */
export function translateError(error: string | Error | unknown, fallback?: string): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : String(error);

  // Если сообщение уже на русском (содержит кириллицу), возвращаем как есть
  if (/[а-яА-ЯёЁ]/.test(message)) {
    return message;
  }

  // Ищем подходящий перевод
  for (const translation of errorTranslations) {
    const pattern = translation.pattern;
    const matches = typeof pattern === 'string'
      ? message.toLowerCase().includes(pattern.toLowerCase())
      : pattern.test(message);

    if (matches) {
      return translation.message;
    }
  }

  // Возвращаем fallback или дефолтное сообщение
  return fallback || 'Произошла ошибка. Попробуйте ещё раз.';
}

/**
 * Оборачивает ошибку для показа в toast
 * @param error - ошибка
 * @param context - контекст операции для более точного сообщения
 */
export function getErrorMessage(error: unknown, context?: string): string {
  const translated = translateError(error);

  // Если есть контекст и перевод дефолтный, добавляем контекст
  if (context && translated === 'Произошла ошибка. Попробуйте ещё раз.') {
    return `Ошибка: ${context}`;
  }

  return translated;
}
