import type { FacebookErrorMeta, FacebookErrorResolution } from './types.js';

// Справочник типовых ошибок Facebook Graph API и способы их обработки
// Позволяет переводить err.fb метаданные в понятные сообщения

type ErrorKey = `${number}:${number}` | `${number}:*` | `*:${number}` | `${number}` | '*';

const dictionary: Record<ErrorKey, FacebookErrorResolution> = {
  '190:*': {
    msgCode: 'fb_token_expired',
    short: 'Сессия Facebook истекла. Нужна повторная авторизация в рекламном кабинете.',
    hint: 'Попросите клиента залогиниться заново и обновить токен доступа.',
    severity: 'error',
  },
  '4:*': {
    msgCode: 'fb_rate_limit',
    short: 'Facebook ограничил частоту запросов (код 4)',
    hint: 'Подождите несколько минут и повторите попытку',
    severity: 'warning',
  },
  '17:*': {
    msgCode: 'fb_rate_limit',
    short: 'Превышен лимит запросов API (код 17)',
    hint: 'Снизьте частоту запросов или запросите повышение лимита в Business Manager',
    severity: 'warning',
  },
  '200:0': {
    msgCode: 'fb_permission_error',
    short: 'Недостаточно прав для действия в рекламном аккаунте.',
    hint: 'Проверьте роль пользователя и выдайте доступ admin/advertiser.',
    severity: 'error',
  },
  '200:1545041': {
    msgCode: 'fb_account_restricted',
    short: 'Facebook заблокировал создание объявлений из-за ограничений аккаунта.',
    hint: 'Проверьте статус Ads Manager, долги и ограничения по Policy.',
    severity: 'error',
  },
  '200:1815694': {
    msgCode: 'fb_budget_permission_error',
    short: 'Недостаточно прав для изменения бюджета. Возможно задолженность в кабинете.',
    hint: 'Проверьте статус кабинета (account_status) и баланс в Facebook Ads Manager.',
    severity: 'error',
  },
  '200:*': {
    msgCode: 'fb_permission_error',
    short: 'Ошибка прав доступа Facebook (код 200)',
    hint: 'Проверьте права доступа к рекламному аккаунту',
    severity: 'error',
  },
  '368:*': {
    msgCode: 'fb_temporary_restriction',
    short: 'Facebook временно ограничил действие из-за подозрительной активности.',
    hint: 'Попробуйте позже или свяжитесь с поддержкой Facebook.',
    severity: 'warning',
  },
  '80000:*': {
    msgCode: 'fb_budget_limit',
    short: 'Нет лимита бюджета/лимита кампаний для этого аккаунта.',
    hint: 'Проверьте spending limit и ограничения Business Manager.',
    severity: 'error',
  },
  '1487010:*': {
    msgCode: 'fb_whatsapp_error',
    short: 'Недоступен WhatsApp Business аккаунт или номер.',
    hint: 'Убедитесь, что номер подключён и подтверждён в WhatsApp Business Manager.',
    severity: 'error',
  },
  '1815757:*': {
    msgCode: 'fb_policy_violation',
    short: 'Промоция недоступна: политика Facebook запрещает контент.',
    hint: 'Проверьте рекламное объявление на соответствие политике. Требуется модерация.',
    severity: 'error',
  },
  '1:*': {
    msgCode: 'fb_internal_error',
    short: 'Внутренняя ошибка Facebook. Попробуйте повторить позже.',
    hint: 'Повторить запрос через несколько минут, при повторении обратиться в поддержку FB.',
    severity: 'warning',
  },
  '*:33': {
    msgCode: 'fb_not_found',
    short: 'Рекламный объект не найден или был удалён.',
    hint: 'Проверьте наличие кампании/adset/объявления по ID.',
    severity: 'error',
  },
  '100:1359188': {
    msgCode: 'fb_payment_method_missing',
    short: 'Не настроен способ оплаты в рекламном кабинете.',
    hint: 'Добавьте карту или другой способ оплаты в Facebook Ads Manager → Настройки оплаты.',
    severity: 'error',
  },
  '100:2446885': {
    msgCode: 'fb_whatsapp_number_invalid',
    short: 'Некорректный номер WhatsApp привязан к аккаунту.',
    hint: 'Проверьте привязку номера в WhatsApp Business Manager и убедитесь, что он подтверждён.',
    severity: 'error',
  },
  '100:1487891': {
    msgCode: 'fb_cta_incompatible',
    short: 'Некорректный call-to-action для данного типа кампании.',
    hint: 'Пересоздайте креатив — возможно нужно обновить тип CTA под цель кампании.',
    severity: 'error',
  },
  '100:1815166': {
    msgCode: 'fb_welcome_message_unsupported',
    short: 'Аккаунт не поддерживает Welcome Message в креативе.',
    hint: 'Креатив будет создан без приветственного сообщения. Попробуйте повторно.',
    severity: 'warning',
  },
  '100:2923012': {
    msgCode: 'fb_status_invalid',
    short: 'Невозможно изменить статус объекта (уже в этом статусе или недоступен для изменений).',
    hint: 'Проверьте текущий статус объекта перед изменением. Используйте GET запрос.',
    severity: 'warning',
  },
  '100:*': {
    msgCode: 'fb_invalid_params',
    short: 'Некорректные параметры запроса к Facebook API.',
    hint: 'Проверьте обязательные поля (objective, creative, budget).',
    severity: 'error',
  },
  '*': {
    msgCode: 'fb_api_error',
    short: 'Facebook вернул ошибку. Проверьте детали и повторите попытку.',
    hint: 'Смотрите лог err.fb для детальной информации.',
    severity: 'error',
  }
};

function buildKey(meta: FacebookErrorMeta): ErrorKey[] {
  const { code, error_subcode } = meta;
  const keys: ErrorKey[] = [];
  if (code !== undefined && error_subcode !== undefined) {
    keys.push(`${code}:${error_subcode}` as ErrorKey);
    keys.push(`${code}:*` as ErrorKey);
    keys.push(`*:${error_subcode}` as ErrorKey);
  }
  if (code !== undefined) keys.push(`${code}` as ErrorKey);
  keys.push('*');
  return keys;
}

export function resolveFacebookError(meta: FacebookErrorMeta | undefined): FacebookErrorResolution {
  if (!meta) return dictionary['*'];
  const keys = buildKey(meta);
  for (const key of keys) {
    const entry = dictionary[key];
    if (entry) return entry;
  }
  return dictionary['*'];
}
