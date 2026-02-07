/**
 * TikTok API Error Handler
 *
 * Парсинг и интерпретация ошибок TikTok Marketing API
 * Аналог facebookErrors.ts
 */

export interface TikTokErrorMeta {
  code: number;
  message?: string;
  request_id?: string;
  endpoint?: string;
  method?: string;
}

export interface TikTokErrorResolution {
  msgCode: string;
  userMessage: string;
  userMessageRu: string;
  retryable: boolean;
  action?: string;
}

/**
 * Коды ошибок TikTok API и их интерпретация
 */
const TIKTOK_ERROR_CODES: Record<number, TikTokErrorResolution> = {
  // Authentication errors (40xxx)
  40001: {
    msgCode: 'tiktok_auth_invalid',
    userMessage: 'Invalid access token',
    userMessageRu: 'Недействительный токен доступа. Переподключите TikTok аккаунт.',
    retryable: false,
    action: 'reconnect_tiktok'
  },
  // 40002 is TikTok's generic validation error — NOT just auth expired!
  // Actual message from API is used instead (see resolveTikTokError fallback)
  40100: {
    msgCode: 'tiktok_rate_limit',
    userMessage: 'Rate limit exceeded',
    userMessageRu: 'Превышен лимит запросов. Попробуйте через минуту.',
    retryable: true,
    action: 'wait_and_retry'
  },
  40104: {
    msgCode: 'tiktok_token_empty',
    userMessage: 'Access token is empty',
    userMessageRu: 'Токен доступа пустой. Переподключите TikTok аккаунт.',
    retryable: false,
    action: 'reconnect_tiktok'
  },

  // Permission errors (50xxx)
  50001: {
    msgCode: 'tiktok_no_permission',
    userMessage: 'No permission for this operation',
    userMessageRu: 'Нет разрешения на эту операцию. Проверьте права приложения.',
    retryable: false,
    action: 'check_permissions'
  },
  50002: {
    msgCode: 'tiktok_advertiser_not_authorized',
    userMessage: 'Advertiser not authorized',
    userMessageRu: 'Рекламный аккаунт не авторизован. Переподключите TikTok.',
    retryable: false,
    action: 'reconnect_tiktok'
  },

  // Invalid parameter errors (40xxx)
  40300: {
    msgCode: 'tiktok_invalid_params',
    userMessage: 'Invalid parameters',
    userMessageRu: 'Некорректные параметры запроса.',
    retryable: false
  },
  40301: {
    msgCode: 'tiktok_missing_params',
    userMessage: 'Missing required parameters',
    userMessageRu: 'Отсутствуют обязательные параметры.',
    retryable: false
  },

  // Resource errors (51xxx)
  51000: {
    msgCode: 'tiktok_resource_not_found',
    userMessage: 'Resource not found',
    userMessageRu: 'Ресурс не найден.',
    retryable: false
  },
  51001: {
    msgCode: 'tiktok_campaign_not_found',
    userMessage: 'Campaign not found',
    userMessageRu: 'Кампания не найдена.',
    retryable: false
  },
  51002: {
    msgCode: 'tiktok_adgroup_not_found',
    userMessage: 'Ad group not found',
    userMessageRu: 'Группа объявлений не найдена.',
    retryable: false
  },
  51003: {
    msgCode: 'tiktok_ad_not_found',
    userMessage: 'Ad not found',
    userMessageRu: 'Объявление не найдено.',
    retryable: false
  },

  // Budget errors (52xxx)
  52001: {
    msgCode: 'tiktok_budget_too_low',
    userMessage: 'Budget is too low',
    userMessageRu: 'Бюджет слишком маленький. Минимум 2500₸/день.',
    retryable: false,
    action: 'increase_budget'
  },
  52002: {
    msgCode: 'tiktok_insufficient_balance',
    userMessage: 'Insufficient account balance',
    userMessageRu: 'Недостаточно средств на балансе аккаунта.',
    retryable: false,
    action: 'top_up_balance'
  },

  // Creative errors (53xxx)
  53001: {
    msgCode: 'tiktok_video_processing',
    userMessage: 'Video is still processing',
    userMessageRu: 'Видео ещё обрабатывается. Подождите 1-2 минуты.',
    retryable: true,
    action: 'wait_and_retry'
  },
  53002: {
    msgCode: 'tiktok_video_invalid',
    userMessage: 'Video format or size is invalid',
    userMessageRu: 'Неверный формат или размер видео.',
    retryable: false,
    action: 'check_video_requirements'
  },
  53003: {
    msgCode: 'tiktok_image_invalid',
    userMessage: 'Image format or size is invalid',
    userMessageRu: 'Неверный формат или размер изображения.',
    retryable: false,
    action: 'check_image_requirements'
  },

  // Targeting errors (54xxx)
  54001: {
    msgCode: 'tiktok_location_invalid',
    userMessage: 'Invalid location targeting',
    userMessageRu: 'Недопустимый геотаргетинг.',
    retryable: false,
    action: 'check_targeting'
  },

  // Account errors (55xxx)
  55001: {
    msgCode: 'tiktok_account_suspended',
    userMessage: 'Advertiser account is suspended',
    userMessageRu: 'Рекламный аккаунт заблокирован.',
    retryable: false,
    action: 'contact_support'
  },
  55002: {
    msgCode: 'tiktok_account_under_review',
    userMessage: 'Advertiser account is under review',
    userMessageRu: 'Рекламный аккаунт на проверке.',
    retryable: false,
    action: 'wait_for_review'
  },

  // System errors (5xxxx)
  50000: {
    msgCode: 'tiktok_internal_error',
    userMessage: 'TikTok internal error',
    userMessageRu: 'Внутренняя ошибка TikTok. Попробуйте позже.',
    retryable: true,
    action: 'wait_and_retry'
  }
};

/**
 * Разрешить ошибку TikTok API
 */
export function resolveTikTokError(meta: TikTokErrorMeta): TikTokErrorResolution {
  const code = meta.code;

  // Проверяем точное совпадение
  if (TIKTOK_ERROR_CODES[code]) {
    return TIKTOK_ERROR_CODES[code];
  }

  // 40000-40999: Validation/auth errors — use actual TikTok message
  if (code >= 40000 && code < 41000) {
    return {
      msgCode: 'tiktok_validation_error',
      userMessage: meta.message || 'Validation error',
      userMessageRu: meta.message || 'Ошибка валидации TikTok.',
      retryable: false
    };
  }

  if (code >= 50000 && code < 51000) {
    return {
      msgCode: 'tiktok_permission_error',
      userMessage: meta.message || 'Permission error',
      userMessageRu: meta.message || 'Ошибка доступа.',
      retryable: false
    };
  }

  if (code >= 51000 && code < 52000) {
    return {
      msgCode: 'tiktok_not_found',
      userMessage: meta.message || 'Resource not found',
      userMessageRu: meta.message || 'Ресурс не найден.',
      retryable: false
    };
  }

  if (code >= 52000 && code < 53000) {
    return {
      msgCode: 'tiktok_budget_error',
      userMessage: meta.message || 'Budget error',
      userMessageRu: meta.message || 'Ошибка бюджета.',
      retryable: false
    };
  }

  if (code >= 53000 && code < 54000) {
    return {
      msgCode: 'tiktok_creative_error',
      userMessage: meta.message || 'Creative error',
      userMessageRu: meta.message || 'Ошибка креатива.',
      retryable: false
    };
  }

  // Дефолтная ошибка
  return {
    msgCode: 'tiktok_unknown_error',
    userMessage: meta.message || `TikTok API error (code: ${code})`,
    userMessageRu: meta.message || `Ошибка TikTok API (код: ${code})`,
    retryable: false
  };
}

/**
 * Проверить, является ли ошибка повторяемой
 */
export function isTikTokRetryable(error: any): boolean {
  if (error?.tiktok?.code) {
    const resolution = resolveTikTokError(error.tiktok);
    return resolution.retryable;
  }

  // Сетевые ошибки - повторяемые
  if (error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT') {
    return true;
  }

  return false;
}

/**
 * Получить действие для ошибки
 */
export function getTikTokErrorAction(error: any): string | undefined {
  if (error?.tiktok?.code) {
    const resolution = resolveTikTokError(error.tiktok);
    return resolution.action;
  }
  return undefined;
}

export default {
  resolveTikTokError,
  isTikTokRetryable,
  getTikTokErrorAction
};
