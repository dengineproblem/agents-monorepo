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
  CONFIRMATION: 'confirmation'
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
  ]
};

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
    this.defaultPeriod = 'last_7d';
  }

  /**
   * Оценить, нужны ли уточняющие вопросы
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

export default {
  ClarifyingGate,
  clarifyingGate,
  QUESTION_TYPES,
  EXTRACTION_PATTERNS
};
