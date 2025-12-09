/**
 * State Machine для Telegram онбординга
 *
 * Управляет состоянием диалога:
 * - Хранение сессий в PostgreSQL
 * - Переходы между шагами
 * - Обработка ответов
 */

import { supabase } from '../supabase.js';
import { createLogger } from '../logger.js';
import {
  ONBOARDING_STEPS,
  getStep,
  canSkipStep,
  normalizePriceSegment,
  parseCompetitorInstagrams,
  formatQuestionMessage,
  formatProgressMessage,
  WELCOME_MESSAGE,
} from './steps.js';
import {
  createUserFromOnboarding,
  buildFacebookOAuthUrl,
  formatCompletionMessage,
  type OnboardingAnswers,
} from './credentialsGenerator.js';
import { generatePrompt1, generatePrompt4 } from '../openaiPromptGenerator.js';

const log = createLogger({ module: 'telegramOnboardingMachine' });

// =====================================================
// Типы
// =====================================================

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface OnboardingSession {
  id: string;
  telegram_id: string;
  current_step: number;
  is_completed: boolean;
  answers: Record<string, any>;
  user_account_id: string | null;
  first_name: string | null;
  last_name: string | null;
  tg_username: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface BotResponse {
  messages: string[];
  parseMode?: 'HTML' | 'Markdown';
}

// =====================================================
// Функции работы с сессией
// =====================================================

/**
 * Получить сессию по telegram_id
 */
export async function getSession(telegramId: string): Promise<OnboardingSession | null> {
  const { data, error } = await supabase
    .from('telegram_onboarding_sessions')
    .select('*')
    .eq('telegram_id', telegramId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as OnboardingSession;
}

/**
 * Создать новую сессию
 */
export async function createSession(
  telegramId: string,
  userData: TelegramUser
): Promise<OnboardingSession | null> {
  const { data, error } = await supabase
    .from('telegram_onboarding_sessions')
    .insert({
      telegram_id: telegramId,
      current_step: 0,
      is_completed: false,
      answers: {},
      first_name: userData.first_name || null,
      last_name: userData.last_name || null,
      tg_username: userData.username || null,
    })
    .select()
    .single();

  if (error) {
    log.error({ error, telegramId }, 'Failed to create onboarding session');
    return null;
  }

  log.info({ telegramId, sessionId: data.id }, 'Created new onboarding session');
  return data as OnboardingSession;
}

/**
 * Получить или создать сессию
 */
export async function getOrCreateSession(
  telegramId: string,
  userData: TelegramUser
): Promise<OnboardingSession | null> {
  let session = await getSession(telegramId);

  if (!session) {
    session = await createSession(telegramId, userData);
  }

  return session;
}

/**
 * Обновить сессию
 */
export async function updateSession(
  telegramId: string,
  updates: Partial<OnboardingSession>
): Promise<boolean> {
  const { error } = await supabase
    .from('telegram_onboarding_sessions')
    .update(updates)
    .eq('telegram_id', telegramId);

  if (error) {
    log.error({ error, telegramId }, 'Failed to update session');
    return false;
  }

  return true;
}

/**
 * Сбросить сессию (для /restart)
 */
export async function resetSession(telegramId: string): Promise<boolean> {
  return updateSession(telegramId, {
    current_step: 0,
    is_completed: false,
    answers: {},
    user_account_id: null,
    completed_at: null,
  });
}

// =====================================================
// Обработка шагов
// =====================================================

/**
 * Начать онбординг - отправить приветствие и первый вопрос
 */
export async function startOnboarding(
  telegramId: string,
  userData: TelegramUser
): Promise<BotResponse> {
  const session = await getOrCreateSession(telegramId, userData);

  if (!session) {
    return {
      messages: ['Произошла ошибка. Пожалуйста, попробуйте позже.'],
    };
  }

  // Если сессия уже завершена - сообщаем об этом
  if (session.is_completed) {
    return {
      messages: [
        'Вы уже прошли регистрацию! Если хотите начать заново, отправьте /restart',
      ],
    };
  }

  // Сбрасываем на начало если уже была сессия
  if (session.current_step > 0) {
    await updateSession(telegramId, {
      current_step: 1,
      answers: {},
    });
  } else {
    // Переходим на шаг 1
    await updateSession(telegramId, { current_step: 1 });
  }

  return {
    messages: [WELCOME_MESSAGE],
    parseMode: 'HTML',
  };
}

/**
 * Обработать ответ пользователя
 */
export async function processAnswer(
  telegramId: string,
  text: string
): Promise<BotResponse> {
  const session = await getSession(telegramId);

  if (!session) {
    return {
      messages: ['Сессия не найдена. Отправьте /start для начала.'],
    };
  }

  if (session.is_completed) {
    return {
      messages: ['Вы уже прошли регистрацию! Если хотите начать заново, отправьте /restart'],
    };
  }

  const currentStep = session.current_step;
  const step = getStep(currentStep);

  if (!step) {
    log.error({ telegramId, currentStep }, 'Invalid step');
    return {
      messages: ['Произошла ошибка. Отправьте /start для начала.'],
    };
  }

  // Валидация обязательных полей
  if (step.isRequired && (!text || text.trim().length === 0)) {
    return {
      messages: [`Это обязательный вопрос. Пожалуйста, ответьте на него.\n\n${step.question}`],
      parseMode: 'HTML',
    };
  }

  // Нормализация ответа в зависимости от типа
  let processedAnswer: string | string[] = text.trim();

  if (step.field === 'price_segment') {
    processedAnswer = normalizePriceSegment(text);
  } else if (step.field === 'competitor_instagrams') {
    processedAnswer = parseCompetitorInstagrams(text);
  }

  // Сохраняем ответ
  const newAnswers = { ...session.answers, [step.field]: processedAnswer };
  const nextStepId = currentStep + 1;

  // Проверяем, закончились ли вопросы
  if (nextStepId > ONBOARDING_STEPS.length) {
    // Завершаем онбординг
    return completeOnboarding(telegramId, newAnswers);
  }

  // Переходим к следующему шагу
  await updateSession(telegramId, {
    current_step: nextStepId,
    answers: newAnswers,
  });

  const nextStep = getStep(nextStepId);
  if (!nextStep) {
    return completeOnboarding(telegramId, newAnswers);
  }

  const progressMessage = formatProgressMessage(nextStepId - 1);
  const questionMessage = formatQuestionMessage(nextStep, nextStepId);

  return {
    messages: [progressMessage, questionMessage],
    parseMode: 'HTML',
  };
}

/**
 * Пропустить текущий вопрос
 */
export async function skipStep(telegramId: string): Promise<BotResponse> {
  const session = await getSession(telegramId);

  if (!session) {
    return {
      messages: ['Сессия не найдена. Отправьте /start для начала.'],
    };
  }

  if (session.is_completed) {
    return {
      messages: ['Вы уже прошли регистрацию!'],
    };
  }

  const currentStep = session.current_step;
  const step = getStep(currentStep);

  if (!step) {
    return {
      messages: ['Произошла ошибка. Отправьте /start для начала.'],
    };
  }

  // Проверяем, можно ли пропустить
  if (!canSkipStep(currentStep)) {
    return {
      messages: [`Этот вопрос обязателен и его нельзя пропустить.\n\n${step.question}`],
      parseMode: 'HTML',
    };
  }

  const nextStepId = currentStep + 1;

  // Проверяем, закончились ли вопросы
  if (nextStepId > ONBOARDING_STEPS.length) {
    return completeOnboarding(telegramId, session.answers);
  }

  // Переходим к следующему шагу
  await updateSession(telegramId, {
    current_step: nextStepId,
  });

  const nextStep = getStep(nextStepId);
  if (!nextStep) {
    return completeOnboarding(telegramId, session.answers);
  }

  const progressMessage = formatProgressMessage(nextStepId - 1);
  const questionMessage = formatQuestionMessage(nextStep, nextStepId);

  return {
    messages: ['⏭ Пропущено', progressMessage, questionMessage],
    parseMode: 'HTML',
  };
}

/**
 * Вернуться к предыдущему вопросу
 */
export async function goBack(telegramId: string): Promise<BotResponse> {
  const session = await getSession(telegramId);

  if (!session) {
    return {
      messages: ['Сессия не найдена. Отправьте /start для начала.'],
    };
  }

  if (session.is_completed) {
    return {
      messages: ['Вы уже прошли регистрацию! Если хотите начать заново, отправьте /restart'],
    };
  }

  const currentStep = session.current_step;

  if (currentStep <= 1) {
    return {
      messages: ['Вы на первом вопросе, некуда возвращаться.'],
    };
  }

  const prevStepId = currentStep - 1;
  const prevStep = getStep(prevStepId);

  if (!prevStep) {
    return {
      messages: ['Произошла ошибка.'],
    };
  }

  // Удаляем ответ на предыдущий вопрос
  const newAnswers = { ...session.answers };
  delete newAnswers[prevStep.field];

  await updateSession(telegramId, {
    current_step: prevStepId,
    answers: newAnswers,
  });

  const progressMessage = formatProgressMessage(prevStepId - 1);
  const questionMessage = formatQuestionMessage(prevStep, prevStepId);

  return {
    messages: ['⬅️ Вернулись назад', progressMessage, questionMessage],
    parseMode: 'HTML',
  };
}

/**
 * Показать текущий прогресс
 */
export async function showStatus(telegramId: string): Promise<BotResponse> {
  const session = await getSession(telegramId);

  if (!session) {
    return {
      messages: ['Сессия не найдена. Отправьте /start для начала.'],
    };
  }

  if (session.is_completed) {
    return {
      messages: ['✅ Вы уже прошли регистрацию!'],
    };
  }

  const currentStep = session.current_step;
  const answeredCount = Object.keys(session.answers).length;
  const progressMessage = formatProgressMessage(currentStep - 1);

  const step = getStep(currentStep);
  const currentQuestion = step ? `\n\nТекущий вопрос: ${step.question}` : '';

  return {
    messages: [
      `📊 <b>Ваш прогресс</b>\n\n${progressMessage}\n\nОтвечено вопросов: ${answeredCount}${currentQuestion}`,
    ],
    parseMode: 'HTML',
  };
}

/**
 * Завершить онбординг - создать пользователя и отправить credentials
 */
async function completeOnboarding(
  telegramId: string,
  answers: Record<string, any>
): Promise<BotResponse> {
  log.info({ telegramId, answersCount: Object.keys(answers).length }, 'Completing onboarding');

  // Создаём пользователя
  const result = await createUserFromOnboarding(telegramId, answers as OnboardingAnswers);

  if (!result.success || !result.username || !result.password) {
    log.error({ telegramId, error: result.error }, 'Failed to create user');

    if (result.error?.includes('уже зарегистрирован')) {
      return {
        messages: [
          `Вы уже зарегистрированы в системе!\n\nВаш логин: <code>${result.username}</code>\n\nЕсли забыли пароль, напишите в поддержку.`,
        ],
        parseMode: 'HTML',
      };
    }

    return {
      messages: ['Произошла ошибка при создании аккаунта. Пожалуйста, попробуйте позже или напишите в поддержку.'],
    };
  }

  // Помечаем сессию как завершённую
  await updateSession(telegramId, {
    is_completed: true,
    user_account_id: result.userId || null,
    completed_at: new Date().toISOString(),
  });

  // Генерируем промпты асинхронно (не блокируем)
  if (result.userId) {
    generatePromptsAsync(result.userId, answers as OnboardingAnswers).catch(err => {
      log.error({ error: String(err), userId: result.userId }, 'Failed to generate prompts');
    });
  }

  // Формируем FB OAuth ссылку
  const fbOAuthUrl = buildFacebookOAuthUrl(result.userId);

  // Финальное сообщение
  const completionMessage = formatCompletionMessage(
    result.username,
    result.password,
    fbOAuthUrl
  );

  log.info(
    { telegramId, userId: result.userId, username: result.username },
    'Onboarding completed successfully'
  );

  return {
    messages: ['🎊 Отлично! Вы ответили на все вопросы!', completionMessage],
    parseMode: 'HTML',
  };
}

/**
 * Асинхронная генерация промптов
 */
async function generatePromptsAsync(
  userId: string,
  answers: OnboardingAnswers
): Promise<void> {
  try {
    log.info({ userId }, 'Starting async prompt generation');

    const [prompt1, prompt4] = await Promise.all([
      generatePrompt1(answers),
      generatePrompt4(answers),
    ]);

    await supabase
      .from('user_accounts')
      .update({
        prompt1,
        prompt4,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    log.info({ userId, prompt1Length: prompt1.length, prompt4Length: prompt4.length }, 'Prompts generated successfully');
  } catch (error) {
    log.error({ error: String(error), userId }, 'Error generating prompts');
    throw error;
  }
}
