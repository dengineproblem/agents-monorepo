/**
 * Clarifying Gate - Уточняющие вопросы перед выполнением
 *
 * Задаёт 1-3 уточняющих вопроса перед выполнением запроса.
 * Минимальная агрессивность: 1 вопрос для READ с default, 2-3 для WRITE.
 */

import { logger } from '../../lib/logger.js';

/**
 * Типы уточняющих вопросов
 */
export const QUESTION_TYPES = {
  PERIOD: 'period',
  ENTITY: 'entity',
  AMOUNT: 'amount',
  METRIC: 'metric',
  CONFIRMATION: 'confirmation',
  CHOICE: 'choice',  // Выбор из вариантов (radio/select)
  STAGE: 'stage'     // Этап воронки
};

/**
 * Паттерны для извлечения ответов из сообщений
 */
const EXTRACTION_PATTERNS = {
  period: [
    // Конкретные периоды
    { pattern: /за\s*(сегодня|вчера|неделю|месяц|год)/i, extract: (m) => periodToCode(m[1]) },
    { pattern: /последн(?:ие|ий|яя|юю)\s*(\d+)\s*(дн|недел|месяц)/i, extract: (m) => `last_${m[1]}${unitToCode(m[2])}` },
    { pattern: /(7|14|30|90)\s*дн/i, extract: (m) => `last_${m[1]}d` },
    { pattern: /эту?\s*неделю/i, extract: () => 'this_week' },
    { pattern: /этот?\s*месяц/i, extract: () => 'this_month' },
    { pattern: /прошл(?:ую|ый)\s*(неделю|месяц)/i, extract: (m) => `last_${m[1] === 'неделю' ? 'week' : 'month'}` },
    // ISO dates
    { pattern: /(\d{4}-\d{2}-\d{2})/i, extract: (m) => m[1] },
    // Relative
    { pattern: /всё\s*врем/i, extract: () => 'lifetime' }
  ],

  entity: [
    // Direction IDs
    { pattern: /(?:направлени[еяю]|d)\s*#?(\d+)/i, extract: (m) => ({ type: 'direction', id: m[1] }) },
    { pattern: /\[d(\d+)\]/i, extract: (m) => ({ type: 'direction', id: m[1] }) },
    // Campaign IDs
    { pattern: /(?:кампани[юяе]|c)\s*#?(\d+)/i, extract: (m) => ({ type: 'campaign', id: m[1] }) },
    { pattern: /\[c(\d+)\]/i, extract: (m) => ({ type: 'campaign', id: m[1] }) },
    // Creative IDs
    { pattern: /(?:креатив|cr)\s*#?(\d+)/i, extract: (m) => ({ type: 'creative', id: m[1] }) },
    { pattern: /\[cr(\d+)\]/i, extract: (m) => ({ type: 'creative', id: m[1] }) },
    // Lead IDs
    { pattern: /(?:лид|lead)\s*#?(\d+)/i, extract: (m) => ({ type: 'lead', id: m[1] }) },
    // "все" / "все активные"
    { pattern: /все?\s*активн/i, extract: () => ({ type: 'all', filter: 'active' }) },
    { pattern: /все?\s*направлени/i, extract: () => ({ type: 'all_directions' }) }
  ],

  amount: [
    // Абсолютные значения
    { pattern: /(\d+(?:[.,]\d+)?)\s*(?:₽|руб|rub|р\.?)/i, extract: (m) => ({ value: parseFloat(m[1].replace(',', '.')), currency: 'RUB' }) },
    { pattern: /(\d+(?:[.,]\d+)?)\s*(?:\$|usd|долл)/i, extract: (m) => ({ value: parseFloat(m[1].replace(',', '.')), currency: 'USD' }) },
    { pattern: /(\d+)\s*(?:тыс|к)/i, extract: (m) => ({ value: parseInt(m[1]) * 1000, currency: 'RUB' }) },
    // Процентные изменения
    { pattern: /(?:на|увеличить|уменьшить)\s*(\d+)\s*%/i, extract: (m) => ({ percent: parseInt(m[1]), relative: true }) },
    { pattern: /(?:\+|-)(\d+)\s*%/i, extract: (m) => ({ percent: parseInt(m[1]), relative: true }) },
    // Просто число
    { pattern: /^(\d+(?:[.,]\d+)?)$/i, extract: (m) => ({ value: parseFloat(m[1].replace(',', '.')), currency: 'RUB' }) }
  ],

  metric: [
    { pattern: /(?:по\s*)?(cpm|ctr|cpl|cpc|roas|roi|spend|impressions?|clicks?)/i, extract: (m) => m[1].toLowerCase() },
    { pattern: /(?:по\s*)?(расход|конверс|охват|показ|клик)/i, extract: (m) => metricToCode(m[1]) }
  ],

  confirmation: [
    { pattern: /^(да|yes|ок|подтверждаю|согласен|точно|верно)$/i, extract: () => true },
    { pattern: /^(нет|no|отмена|отменить|стоп)$/i, extract: () => false }
  ],

  stage: [
    { pattern: /(?:новы[йеих]|new)/i, extract: () => 'new' },
    { pattern: /(?:в работе|in.?progress|обрабатыва)/i, extract: () => 'in_progress' },
    { pattern: /(?:квалифицирован|qualified)/i, extract: () => 'qualified' },
    { pattern: /(?:отклонён|rejected|отказ)/i, extract: () => 'rejected' },
    { pattern: /(?:все?|all)/i, extract: () => 'all' }
  ],

  choice: [
    // Для choice типа извлекаем по value из options
    { pattern: /^(\d)$/, extract: (m) => ({ optionIndex: parseInt(m[1]) - 1 }) }
  ]
};

/**
 * Паттерны для определения "размытых" сообщений
 */
const VAGUE_PATTERNS = {
  // Общие фразы без конкретики
  phrases: [
    /^(?:не работает|не работают)$/i,
    /^(?:дорого|слишком дорого)$/i,
    /^(?:плохие? лид[ыаов]?)$/i,
    /^(?:мало лидов|нет лидов)$/i,
    /^(?:что-то не так)$/i,
    /^(?:проблемы? с)$/i,
    /^(?:помоги|помогите)$/i,
    /^(?:посмотри|покажи|дай)$/i
  ],

  // Слова которые указывают на размытость
  vagueWords: [
    'что-то', 'какой-то', 'почему-то', 'вроде', 'наверное', 'кажется'
  ]
};

/**
 * Проверить, является ли сообщение "размытым"
 * @param {string} message
 * @returns {boolean}
 */
export function isVagueMessage(message) {
  if (!message) return true;

  const trimmed = message.trim();

  // Слишком короткое сообщение
  if (trimmed.length < 25) {
    // Но если это конкретная команда - не размытое
    if (/(?:покажи|дай|сколько|какой|где).*(?:направлен|кампани|креатив|лид|расход)/i.test(trimmed)) {
      return false;
    }
    return true;
  }

  // Проверяем на размытые фразы
  for (const pattern of VAGUE_PATTERNS.phrases) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  // Проверяем на размытые слова
  const lower = trimmed.toLowerCase();
  for (const word of VAGUE_PATTERNS.vagueWords) {
    if (lower.includes(word)) {
      return true;
    }
  }

  return false;
}

/**
 * Проверить, упомянут ли период в сообщении
 * @param {string} message
 * @returns {boolean}
 */
export function hasPeriodInMessage(message) {
  if (!message) return false;

  const periodPatterns = [
    /сегодня|вчера/i,
    /последн\w*\s*\d+/i,
    /за\s*(?:\d+|неделю|месяц|год)/i,
    /\d+\s*дн/i,
    /эт(?:у|от)\s*(?:недел|месяц)/i,
    /прошл\w*\s*(?:недел|месяц)/i,
    /\d{4}-\d{2}-\d{2}/
  ];

  return periodPatterns.some(p => p.test(message));
}

/**
 * Проверить, упомянута ли метрика в сообщении
 * @param {string} message
 * @returns {boolean}
 */
export function hasMetricInMessage(message) {
  if (!message) return false;

  const metricPatterns = [
    /cpm|ctr|cpl|cpc|roas|roi/i,
    /расход|конверс|охват|показ|клик/i,
    /стоимост\w*\s*лид/i
  ];

  return metricPatterns.some(p => p.test(message));
}

/**
 * Helpers для конвертации
 */
function periodToCode(word) {
  const map = {
    'сегодня': 'today',
    'вчера': 'yesterday',
    'неделю': 'last_7d',
    'месяц': 'last_30d',
    'год': 'last_365d'
  };
  return map[word.toLowerCase()] || 'last_7d';
}

function unitToCode(unit) {
  if (unit.startsWith('дн')) return 'd';
  if (unit.startsWith('недел')) return 'w';
  if (unit.startsWith('месяц')) return 'm';
  return 'd';
}

function metricToCode(word) {
  const map = {
    'расход': 'spend',
    'конверс': 'conversions',
    'охват': 'reach',
    'показ': 'impressions',
    'клик': 'clicks'
  };
  return map[word.toLowerCase()] || word;
}

/**
 * Clarifying Gate Class
 */
export class ClarifyingGate {
  constructor() {
    this.defaultPeriod = 'last_3d';  // Updated default
  }

  /**
   * Оценить, нужны ли уточняющие вопросы (legacy метод)
   * @param {Object} params
   * @param {string} params.message - Сообщение пользователя
   * @param {Object} params.policy - Policy от PolicyEngine
   * @param {Object} params.context - Контекст (история, предыдущие ответы)
   * @param {Object} params.existingAnswers - Уже полученные ответы
   * @returns {{ needsClarifying: boolean, questions: ClarifyingQuestion[], formatForUser: Function }}
   */
  evaluate({ message, policy, context = {}, existingAnswers = {} }) {
    if (!policy || !policy.clarifyingRequired) {
      return {
        needsClarifying: false,
        questions: [],
        answers: existingAnswers,
        formatForUser: () => null
      };
    }

    const requiredQuestions = policy.clarifyingQuestions || [];
    const pendingQuestions = [];

    for (const q of requiredQuestions) {
      // Проверяем, есть ли уже ответ
      if (existingAnswers[q.type]) {
        continue;
      }

      // Пробуем извлечь ответ из сообщения
      const extracted = this.extractFromMessage(message, q.type);
      if (extracted !== null) {
        existingAnswers[q.type] = extracted;
        continue;
      }

      // Проверяем контекст (предыдущие сообщения)
      const fromContext = this.extractFromContext(context, q.type);
      if (fromContext !== null) {
        existingAnswers[q.type] = fromContext;
        continue;
      }

      // Для period используем default, если указан
      if (q.type === QUESTION_TYPES.PERIOD && q.default) {
        existingAnswers[q.type] = q.default;
        continue;
      }

      // Вопрос нужен
      pendingQuestions.push(q);
    }

    const needsClarifying = pendingQuestions.length > 0;

    logger.debug({
      intent: policy.intent,
      required: requiredQuestions.length,
      answered: Object.keys(existingAnswers).length,
      pending: pendingQuestions.length
    }, 'ClarifyingGate evaluation');

    return {
      needsClarifying,
      questions: pendingQuestions,
      answers: existingAnswers,
      complete: !needsClarifying,
      formatForUser: () => this.formatQuestions(pendingQuestions, policy)
    };
  }

  /**
   * Оценить вопросы из playbook с поддержкой askIf/alwaysAsk/softConfirm
   * @param {Object} params
   * @param {string} params.message - Сообщение пользователя
   * @param {Array} params.questions - Вопросы из playbook
   * @param {Object} params.businessContext - Бизнес-контекст для условий
   * @param {Object} params.existingAnswers - Уже полученные ответы
   * @returns {{ needsClarifying: boolean, questions: Array, answers: Object, uiComponents: Array, softConfirmations: Array }}
   */
  evaluateWithPlaybook({ message, questions, businessContext = {}, existingAnswers = {} }) {
    if (!questions || questions.length === 0) {
      return {
        needsClarifying: false,
        questions: [],
        answers: existingAnswers,
        uiComponents: [],
        softConfirmations: []
      };
    }

    const pendingQuestions = [];
    const uiComponents = [];
    const softConfirmations = [];

    // Подготавливаем контекст для проверки условий
    const evalContext = {
      ...businessContext,
      extractedPeriod: hasPeriodInMessage(message),
      extractedMetric: hasMetricInMessage(message),
      extractedStage: this.extractFromMessage(message, 'stage') !== null,
      isVague: isVagueMessage(message),
      messageLength: message?.length || 0
    };

    for (const q of questions) {
      const field = q.field || q.type;

      // Проверяем, есть ли уже ответ
      if (existingAnswers[field] !== undefined) {
        continue;
      }

      // Проверяем условие askIf
      if (q.askIf && !this.evaluateAskIf(q.askIf, evalContext)) {
        // Условие не выполнено, используем default если есть
        if (q.default !== undefined) {
          existingAnswers[field] = q.default;
        }
        continue;
      }

      // Проверяем alwaysAskIf
      if (q.alwaysAskIf && !this.evaluateAskIf(q.alwaysAskIf, evalContext)) {
        // Условие не выполнено, пропускаем
        if (q.default !== undefined) {
          existingAnswers[field] = q.default;
        }
        continue;
      }

      // === softConfirm логика ===
      // Если alwaysAsk + softConfirm и период уже в сообщении — мягкое подтверждение
      if (q.alwaysAsk && q.softConfirm) {
        const extracted = this.extractFromMessage(message, q.type);
        if (extracted !== null) {
          // Период указан → используем его, но добавляем мягкое подтверждение
          existingAnswers[field] = extracted;

          // Добавляем soft confirmation для UI (не блокирует выполнение)
          softConfirmations.push({
            field: field,
            value: extracted,
            text: this.formatSoftConfirmText(q, extracted),
            options: q.options || [],
            type: 'soft_confirm'
          });
          continue;
        }

        // Период не указан → полный вопрос
        pendingQuestions.push(q);

        // Формируем UI component
        if (q.options) {
          uiComponents.push(this.createChoiceComponent(q));
        }
        continue;
      }

      // alwaysAsk без softConfirm — всегда задаём
      if (!q.alwaysAsk) {
        // Пробуем извлечь ответ из сообщения
        const extracted = this.extractFromMessage(message, q.type);
        if (extracted !== null) {
          existingAnswers[field] = extracted;
          continue;
        }

        // Для period используем default
        if (q.type === QUESTION_TYPES.PERIOD && q.default) {
          existingAnswers[field] = q.default;
          continue;
        }
      }

      // Вопрос нужен
      pendingQuestions.push(q);

      // Формируем UI component для Web
      if (q.type === QUESTION_TYPES.CHOICE || q.options) {
        uiComponents.push(this.createChoiceComponent(q));
      } else if (q.type === QUESTION_TYPES.PERIOD && q.options) {
        uiComponents.push(this.createChoiceComponent(q));
      }
    }

    const needsClarifying = pendingQuestions.length > 0;

    logger.debug({
      totalQuestions: questions.length,
      pending: pendingQuestions.length,
      softConfirms: softConfirmations.length,
      answered: Object.keys(existingAnswers).length,
      evalContext: { isVague: evalContext.isVague, extractedPeriod: evalContext.extractedPeriod }
    }, 'ClarifyingGate playbook evaluation');

    return {
      needsClarifying,
      questions: pendingQuestions,
      answers: existingAnswers,
      complete: !needsClarifying,
      uiComponents,
      softConfirmations,
      formatForUser: () => this.formatQuestions(pendingQuestions, { intent: 'playbook' })
    };
  }

  /**
   * Форматировать текст для мягкого подтверждения
   * @param {Object} question
   * @param {string} extractedValue
   * @returns {string}
   */
  formatSoftConfirmText(question, extractedValue) {
    const periodLabels = {
      'today': 'сегодня',
      'yesterday': 'вчера',
      'last_3d': 'последние 3 дня',
      'last_7d': 'последние 7 дней',
      'last_14d': 'последние 14 дней',
      'last_30d': 'последние 30 дней',
      'last_week': 'прошлую неделю',
      'last_month': 'прошлый месяц'
    };

    const label = periodLabels[extractedValue] || extractedValue;

    if (question.type === QUESTION_TYPES.PERIOD) {
      return `Смотрю за ${label}. Другой период?`;
    }

    return `Использую: ${label}. Изменить?`;
  }

  /**
   * Проверить условие askIf
   * @param {string} condition - Условие
   * @param {Object} context - Контекст с данными
   * @returns {boolean}
   */
  evaluateAskIf(condition, context) {
    // Специальные условия
    switch (condition) {
      case 'period_not_in_message':
        return !context.extractedPeriod;

      case 'metric_not_in_message':
        return !context.extractedMetric;

      case 'stage_not_in_message':
        return !context.extractedStage;

      case 'user_message_is_vague':
        return context.isVague;

      case 'directions_count > 1':
        return (context.directionsCount || context.directions_count || 0) > 1;

      case 'hasWhatsApp':
        return !!context.integrations?.whatsapp;

      case 'hasCRM':
        return !!context.integrations?.crm;

      default:
        // Попробуем как простое выражение
        if (condition.includes('>') || condition.includes('<') || condition.includes('==')) {
          try {
            // Безопасный eval для простых выражений
            const [left, op, right] = condition.split(/\s*(>|<|>=|<=|==|!=)\s*/);
            const leftVal = context[left] ?? 0;
            const rightVal = isNaN(right) ? context[right] ?? 0 : parseFloat(right);

            switch (op) {
              case '>': return leftVal > rightVal;
              case '<': return leftVal < rightVal;
              case '>=': return leftVal >= rightVal;
              case '<=': return leftVal <= rightVal;
              case '==': return leftVal == rightVal;
              case '!=': return leftVal != rightVal;
            }
          } catch (e) {
            logger.warn({ condition, error: e.message }, 'Failed to evaluate askIf condition');
          }
        }

        // По умолчанию true (задаём вопрос)
        return true;
    }
  }

  /**
   * Создать UI component для choice вопроса
   * @param {Object} question
   * @returns {Object}
   */
  createChoiceComponent(question) {
    return {
      type: 'choice',
      fieldId: question.field || question.type,
      title: question.text,
      options: (question.options || []).map(opt => ({
        value: typeof opt === 'string' ? opt : opt.value,
        label: typeof opt === 'string' ? opt : opt.label
      })),
      default: question.default,
      required: !question.optional
    };
  }

  /**
   * Извлечь значение из сообщения пользователя
   * @param {string} message
   * @param {string} questionType
   * @returns {any|null}
   */
  extractFromMessage(message, questionType) {
    const patterns = EXTRACTION_PATTERNS[questionType];
    if (!patterns) return null;

    for (const { pattern, extract } of patterns) {
      const match = message.match(pattern);
      if (match) {
        const value = extract(match);
        logger.debug({ questionType, value, pattern: pattern.source }, 'Extracted from message');
        return value;
      }
    }

    return null;
  }

  /**
   * Извлечь значение из контекста разговора
   * @param {Object} context
   * @param {string} questionType
   * @returns {any|null}
   */
  extractFromContext(context, questionType) {
    // Проверяем последние сообщения на предмет ответа
    const recentMessages = context.recentMessages || [];

    for (const msg of recentMessages.slice(-5)) {
      if (msg.role === 'user') {
        const extracted = this.extractFromMessage(msg.content, questionType);
        if (extracted !== null) {
          return extracted;
        }
      }
    }

    // Проверяем metadata контекста
    if (context.metadata) {
      if (questionType === QUESTION_TYPES.PERIOD && context.metadata.period) {
        return context.metadata.period;
      }
      if (questionType === QUESTION_TYPES.ENTITY && context.metadata.selectedEntity) {
        return context.metadata.selectedEntity;
      }
    }

    return null;
  }

  /**
   * Форматировать вопросы для пользователя
   * @param {Array} questions
   * @param {Object} policy
   * @returns {string}
   */
  formatQuestions(questions, policy) {
    if (questions.length === 0) return null;

    // Берём только первый вопрос (минимальная агрессивность)
    const q = questions[0];

    // Форматируем в зависимости от типа
    switch (q.type) {
      case QUESTION_TYPES.PERIOD:
        return this.formatPeriodQuestion(q, policy);
      case QUESTION_TYPES.ENTITY:
        return this.formatEntityQuestion(q, policy);
      case QUESTION_TYPES.AMOUNT:
        return this.formatAmountQuestion(q, policy);
      case QUESTION_TYPES.METRIC:
        return this.formatMetricQuestion(q, policy);
      case QUESTION_TYPES.CONFIRMATION:
        return this.formatConfirmationQuestion(q, policy);
      default:
        return q.text || 'Уточните параметры запроса';
    }
  }

  formatPeriodQuestion(q, policy) {
    const options = q.options || ['Сегодня', 'Вчера', '7 дней', '30 дней'];
    const optionsText = options.map((o, i) => `${i + 1}. ${o}`).join('\n');

    return `За какой период показать данные?\n\n${optionsText}\n\n(По умолчанию: последние 7 дней)`;
  }

  formatEntityQuestion(q, policy) {
    const entityName = q.entityType || 'объект';
    return q.text || `Какой ${entityName} вас интересует? Укажите номер или название.`;
  }

  formatAmountQuestion(q, policy) {
    return q.text || 'Укажите сумму (например: 5000₽ или +10%)';
  }

  formatMetricQuestion(q, policy) {
    const options = q.options || ['Spend (расход)', 'CPL (стоимость лида)', 'CTR', 'Conversions'];
    const optionsText = options.map((o, i) => `${i + 1}. ${o}`).join('\n');

    return `По какой метрике сортировать?\n\n${optionsText}`;
  }

  formatConfirmationQuestion(q, policy) {
    const action = q.action || policy.intent || 'действие';
    return `Подтвердите ${action}.\n\nОтветьте "да" для подтверждения или "нет" для отмены.`;
  }

  /**
   * Обработать ответ пользователя на уточняющий вопрос
   * @param {string} message - Сообщение пользователя
   * @param {Object} pendingQuestion - Ожидаемый вопрос
   * @param {Object} existingAnswers - Текущие ответы
   * @returns {{ answered: boolean, answers: Object }}
   */
  processAnswer(message, pendingQuestion, existingAnswers = {}) {
    const extracted = this.extractFromMessage(message, pendingQuestion.type);

    if (extracted !== null) {
      return {
        answered: true,
        answers: {
          ...existingAnswers,
          [pendingQuestion.type]: extracted
        }
      };
    }

    // Попробуем интерпретировать как номер опции
    const optionMatch = message.match(/^(\d)$/);
    if (optionMatch && pendingQuestion.options) {
      const idx = parseInt(optionMatch[1]) - 1;
      if (idx >= 0 && idx < pendingQuestion.options.length) {
        const optionValue = this.optionToValue(pendingQuestion.options[idx], pendingQuestion.type);
        return {
          answered: true,
          answers: {
            ...existingAnswers,
            [pendingQuestion.type]: optionValue
          }
        };
      }
    }

    return {
      answered: false,
      answers: existingAnswers
    };
  }

  /**
   * Конвертировать текст опции в значение
   */
  optionToValue(optionText, questionType) {
    if (questionType === QUESTION_TYPES.PERIOD) {
      const map = {
        'сегодня': 'today',
        'вчера': 'yesterday',
        '7 дней': 'last_7d',
        '30 дней': 'last_30d',
        'месяц': 'last_30d',
        'год': 'last_365d'
      };
      const lower = optionText.toLowerCase();
      return map[lower] || lower;
    }

    return optionText;
  }

  /**
   * Создать state для хранения в сессии
   */
  createState(policy) {
    return {
      required: policy.clarifyingRequired || false,
      questions: policy.clarifyingQuestions || [],
      answers: {},
      currentQuestionIdx: 0,
      complete: !policy.clarifyingRequired
    };
  }

  /**
   * Проверить, завершён ли Clarifying Gate
   */
  isComplete(state) {
    if (!state.required) return true;
    if (state.complete) return true;

    const answeredCount = Object.keys(state.answers).length;
    const requiredCount = state.questions.length;

    return answeredCount >= requiredCount;
  }
}

// Singleton instance
export const clarifyingGate = new ClarifyingGate();

// Re-export EXTRACTION_PATTERNS
export { EXTRACTION_PATTERNS };

export default {
  ClarifyingGate,
  clarifyingGate,
  QUESTION_TYPES,
  EXTRACTION_PATTERNS,
  isVagueMessage,
  hasPeriodInMessage,
  hasMetricInMessage
};
