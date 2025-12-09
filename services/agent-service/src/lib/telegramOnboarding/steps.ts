/**
 * Определение шагов онбординга для Telegram бота
 *
 * 15 вопросов о бизнесе пользователя для настройки AI-генерации креативов
 */

export interface OnboardingStep {
  id: number;
  field: string;
  question: string;
  isRequired: boolean;
  type: 'text' | 'select' | 'multi';
  options?: string[];
  maxItems?: number;
  example?: string;
}

/**
 * Приветственное сообщение при /start
 */
export const WELCOME_MESSAGE = `👋 Добро пожаловать в Performante AI!

Я задам вам 15 вопросов о вашем бизнесе,
чтобы настроить AI для генерации рекламных креативов и правильного управления рекламой.

⏱ Это займёт ~5 минут
🎤 Можете отвечать текстом или голосом
⏭ Необязательные вопросы можно пропустить командой /skip

Готовы? Тогда начнём!

📌 Как называется ваш бизнес?`;

/**
 * 15 шагов онбординга
 */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 1,
    field: 'business_name',
    question: '📌 Как называется ваш бизнес?',
    isRequired: true,
    type: 'text',
    example: 'Например: "Студия йоги Harmony"',
  },
  {
    id: 2,
    field: 'business_niche',
    question: '🎯 В какой нише вы работаете?',
    isRequired: true,
    type: 'text',
    example: 'Например: "Фитнес и здоровье", "Образование", "Красота"',
  },
  {
    id: 3,
    field: 'instagram_url',
    question: '📸 Ссылка на ваш Instagram (или /skip)',
    isRequired: false,
    type: 'text',
    example: 'Например: @yourbusiness или instagram.com/yourbusiness',
  },
  {
    id: 4,
    field: 'website_url',
    question: '🌐 Ссылка на сайт (или /skip)',
    isRequired: false,
    type: 'text',
    example: 'Например: https://yourbusiness.com',
  },
  {
    id: 5,
    field: 'target_audience',
    question: '👥 Кто ваши клиенты? Опишите целевую аудиторию (или /skip)',
    isRequired: false,
    type: 'text',
    example: 'Например: "Женщины 25-45 лет, интересующиеся здоровым образом жизни"',
  },
  {
    id: 6,
    field: 'geography',
    question: '🗺 География работы - где находятся ваши клиенты? (или /skip)',
    isRequired: false,
    type: 'text',
    example: 'Например: "Алматы", "Казахстан", "СНГ"',
  },
  {
    id: 7,
    field: 'main_pains',
    question: '😰 Основные боли и проблемы вашей аудитории (или /skip)',
    isRequired: false,
    type: 'text',
    example: 'Например: "Нехватка времени, стресс, лишний вес"',
  },
  {
    id: 8,
    field: 'main_services',
    question: '💼 Основные услуги или продукты (или /skip)',
    isRequired: false,
    type: 'text',
    example: 'Например: "Индивидуальные тренировки, групповые занятия, онлайн-курсы"',
  },
  {
    id: 9,
    field: 'competitive_advantages',
    question: '🏆 Ваши конкурентные преимущества (или /skip)',
    isRequired: false,
    type: 'text',
    example: 'Например: "10 лет опыта, сертифицированные тренеры, удобное расположение"',
  },
  {
    id: 10,
    field: 'price_segment',
    question: `💰 Ценовой сегмент?

1️⃣ Эконом
2️⃣ Средний
3️⃣ Премиум

Отправьте цифру или название (или /skip)`,
    isRequired: false,
    type: 'select',
    options: ['эконом', 'средний', 'премиум', '1', '2', '3'],
  },
  {
    id: 11,
    field: 'tone_of_voice',
    question: '🗣 Тон общения бренда (или /skip)',
    isRequired: false,
    type: 'text',
    example: 'Например: "Дружелюбный", "Официальный", "Экспертный", "Вдохновляющий"',
  },
  {
    id: 12,
    field: 'main_promises',
    question: '✨ Главные обещания и результаты для клиентов (или /skip)',
    isRequired: false,
    type: 'text',
    example: 'Например: "Результат за 30 дней", "Гарантия возврата денег"',
  },
  {
    id: 13,
    field: 'social_proof',
    question: '⭐ Социальные доказательства - отзывы, кейсы, цифры (или /skip)',
    isRequired: false,
    type: 'text',
    example: 'Например: "500+ довольных клиентов", "Рейтинг 4.9 на Google"',
  },
  {
    id: 14,
    field: 'guarantees',
    question: '🛡 Какие гарантии вы даёте? (или /skip)',
    isRequired: false,
    type: 'text',
    example: 'Например: "Возврат денег если не понравится", "Бесплатная консультация"',
  },
  {
    id: 15,
    field: 'competitor_instagrams',
    question: '🔍 Instagram аккаунты конкурентов - до 5 штук через запятую (или /skip)',
    isRequired: false,
    type: 'multi',
    maxItems: 5,
    example: 'Например: @competitor1, @competitor2',
  },
];

/**
 * Получить шаг по номеру (1-15)
 */
export function getStep(stepId: number): OnboardingStep | null {
  return ONBOARDING_STEPS.find(s => s.id === stepId) || null;
}

/**
 * Получить следующий шаг
 */
export function getNextStep(currentStepId: number): OnboardingStep | null {
  if (currentStepId >= ONBOARDING_STEPS.length) return null;
  return ONBOARDING_STEPS[currentStepId]; // 0-indexed, так что currentStepId = следующий
}

/**
 * Проверить, можно ли пропустить шаг
 */
export function canSkipStep(stepId: number): boolean {
  const step = getStep(stepId);
  return step ? !step.isRequired : false;
}

/**
 * Нормализовать ответ на вопрос о ценовом сегменте
 */
export function normalizePriceSegment(answer: string): string {
  const normalized = answer.toLowerCase().trim();
  if (normalized === '1' || normalized.includes('эконом')) return 'эконом';
  if (normalized === '2' || normalized.includes('средн')) return 'средний';
  if (normalized === '3' || normalized.includes('преми')) return 'премиум';
  return normalized;
}

/**
 * Парсит список Instagram аккаунтов из строки
 */
export function parseCompetitorInstagrams(answer: string): string[] {
  return answer
    .split(/[,\s]+/)
    .map(handle => {
      // Убираем @ и URL части
      let clean = handle.trim().toLowerCase();
      clean = clean.replace(/^@/, '');
      clean = clean.replace(/^https?:\/\/(www\.)?instagram\.com\//, '');
      clean = clean.replace(/\/$/, '');
      return clean;
    })
    .filter(handle => handle.length > 0 && handle.length <= 30)
    .slice(0, 5); // Максимум 5
}

/**
 * Форматирует сообщение с вопросом
 */
export function formatQuestionMessage(step: OnboardingStep, currentStepNum: number): string {
  let message = `<b>Вопрос ${currentStepNum}/15</b>\n\n${step.question}`;

  if (step.example) {
    message += `\n\n<i>${step.example}</i>`;
  }

  return message;
}

/**
 * Сообщение о прогрессе
 */
export function formatProgressMessage(currentStep: number, totalSteps: number = 15): string {
  const progress = Math.round((currentStep / totalSteps) * 100);
  const filled = Math.round(progress / 10);
  const empty = 10 - filled;
  const bar = '▓'.repeat(filled) + '░'.repeat(empty);

  return `📊 Прогресс: ${bar} ${currentStep}/${totalSteps}`;
}
