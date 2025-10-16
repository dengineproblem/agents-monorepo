import type { FacebookErrorMeta, FacebookErrorResolution } from './types.js';

// Справочник типовых ошибок Facebook Graph API и способы их обработки
// Позволяет переводить err.fb метаданные в понятные сообщения

type ErrorKey = `${number}:${number}` | `${number}:*` | `*:${number}` | `${number}` | '*';

const dictionary: Record<ErrorKey, FacebookErrorResolution> = {
  '190:*': {
    short: 'Сессия Facebook истекла. Нужна повторная авторизация в рекламном кабинете.',
    hint: 'Попросите клиента залогиниться заново и обновить токен доступа.',
    severity: 'error',
  },
  '200:0': {
    short: 'Недостаточно прав для действия в рекламном аккаунте.',
    hint: 'Проверьте роль пользователя и выдайте доступ admin/advertiser.',
    severity: 'error',
  },
  '200:1545041': {
    short: 'Facebook заблокировал создание объявлений из-за ограничений аккаунта.',
    hint: 'Проверьте статус Ads Manager, долги и ограничения по Policy.',
    severity: 'error',
  },
  '368:*': {
    short: 'Facebook временно ограничил действие из-за подозрительной активности.',
    hint: 'Попробуйте позже или свяжитесь с поддержкой Facebook.',
    severity: 'warning',
  },
  '80000:*': {
    short: 'Нет лимита бюджета/лимита кампаний для этого аккаунта.',
    hint: 'Проверьте spending limit и ограничения Business Manager.',
    severity: 'error',
  },
  '1487010:*': {
    short: 'Недоступен WhatsApp Business аккаунт или номер.',
    hint: 'Убедитесь, что номер подключён и подтверждён в WhatsApp Business Manager.',
    severity: 'error',
  },
  '1815757:*': {
    short: 'Промоция недоступна: политика Facebook запрещает контент.',
    hint: 'Проверьте рекламное объявление на соответствие политике. Требуется модерация.',
    severity: 'error',
  },
  '1:*': {
    short: 'Внутренняя ошибка Facebook. Попробуйте повторить позже.',
    hint: 'Повторить запрос через несколько минут, при повторении обратиться в поддержку FB.',
    severity: 'warning',
  },
  '*:33': {
    short: 'Рекламный объект не найден или был удалён.',
    hint: 'Проверьте наличие кампании/adset/объявления по ID.',
    severity: 'error',
  },
  '100:*': {
    short: 'Некорректные параметры запроса к Facebook API.',
    hint: 'Проверьте обязательные поля (objective, creative, budget).',
    severity: 'error',
  },
  '*': {
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
